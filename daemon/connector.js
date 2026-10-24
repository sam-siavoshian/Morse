// The desktop connector: attaches to every window of a Chromium/Electron app
// over CDP, injects the Morse runtime, and serves its requests (generate, run,
// save, share). CDP evaluation is exempt from the page's CSP, so mods work in
// locked-down apps too.
//
// Two JS worlds per page:
//   - Morse's isolated world ("morse"): the runtime and the __morseHostSend
//     binding live here, so the app's own scripts (or a website loaded in an
//     attached browser) can't see or call the host API. The runtime only
//     needs the DOM, which both worlds share.
//   - the page's main world: mod code runs here (Runtime.evaluate with the
//     main context id), because mods need the page's own JS objects.
// Host requests are answered for the page that asked: mods, history and
// saves are scoped to the calling document's URL (read from Morse's world)
// and app, never to what the message claims.

import { spawn } from "node:child_process";
import { CDPSession, listTargets } from "./cdp.js";
import { modsFor, saveMod, deleteMod, getMod, writeExport, readClipboard, putClipboard } from "./store.js";
import { createMod, encodeShare, decodeShare, toUserscript, validateMod, hostOf, modMatches } from "../core/mod.js";
import { wrapModCode } from "../core/kit.js";
import { runMorse } from "../core/engine.js";
import { settingsLabel } from "../core/providers.js";
import { Recorder } from "./record.js";
import { loadPrefs, savePrefs, loadHistory, addHistory } from "./store.js";
import { Generations } from "../core/cancel.js";
import { cachedVoiceStatus, transcribeAudio } from "./voice.js";

import { bundleRuntime } from "../runtime/bundle.js";
const RUNTIME = bundleRuntime();

export const WORLD = "morse";            // the isolated world's name
export const BINDING = "__morseHostSend"; // exists only in that world

// Runs inside Morse's world.
const SHIM = `(() => {
  if (window.top !== window || globalThis.__morseHost) return;
  const send = globalThis.${BINDING};
  if (typeof send !== "function") return;
  const subs = [];
  globalThis.__morseHost = { send: m => send(JSON.stringify(m)), onMessage: fn => subs.push(fn) };
  globalThis.__morseHostReceive = m => subs.forEach(f => f(m));
})();`;

// Page.addScriptToEvaluateOnNewDocument runs before <html> exists.
export const BOOT = `(() => { const go = () => { ${SHIM}\n${RUNTIME} }; document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go, { once: true }) : go(); })();`;

export class Connector {
  constructor({ port, app = null, settings, log = console.log }) {
    Object.assign(this, { port, app, settings, log });
    this.pages = new Map();
    this.gens = new Generations();
  }

  async run() {
    for (;;) {
      try {
        for (const t of await listTargets(this.port)) {
          if (t.type !== "page" || this.pages.has(t.id) || /^(devtools|chrome-extension|chrome):/.test(t.url)) continue;
          this.pages.set(t.id, null);
          this.attach(t).catch(e => { this.pages.delete(t.id); this.log(`  ! ${t.title || t.url}: ${e.message}`); });
        }
      } catch {
        if (this.everAttached) { this.log("App closed. Bye."); return; }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  async attach(target) {
    const s = await CDPSession.connect(target.webSocketDebuggerUrl);
    this.pages.set(target.id, s);
    this.everAttached = true;
    s.on("close", () => this.pages.delete(target.id));

    // Execution contexts per frame: the page's main world and Morse's world.
    // Each document gets new ones, so these follow navigations.
    const frames = new Map(); // frameId -> { main, world }
    const worlds = new Map(); // Morse world context id -> frameId
    const frame = id => frames.get(id) || frames.set(id, { main: null, world: null }).get(id);
    s.on("Runtime.executionContextCreated", ({ context: c }) => {
      const frameId = c.auxData?.frameId;
      if (!frameId) return;
      if (c.auxData.isDefault) frame(frameId).main = c.id;
      else if (c.name === WORLD) { frame(frameId).world = c.id; worlds.set(c.id, frameId); }
    });
    s.on("Runtime.executionContextDestroyed", ({ executionContextId: id }) => {
      worlds.delete(id);
      for (const f of frames.values()) { if (f.main === id) f.main = null; if (f.world === id) f.world = null; }
    });
    s.on("Runtime.executionContextsCleared", () => { frames.clear(); worlds.clear(); });
    s.on("Page.frameDetached", ({ frameId }) => frames.delete(frameId));

    // Listen before injecting: the runtime says hello during evaluation.
    s.on("Runtime.bindingCalled", p => {
      if (p.name !== BINDING) return;
      // Only Morse's own world can reach the host. (The binding exists only
      // there; this also refuses any context we don't know.)
      const frameId = worlds.get(p.executionContextId);
      if (!frameId) return;
      let msg;
      try { msg = JSON.parse(p.payload); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      // Pin the caller's documents now: if the page navigates mid-request,
      // these contexts die with it and nothing lands on the next page.
      this.handle(s, { world: p.executionContextId, main: frames.get(frameId)?.main ?? null, frameId }, msg);
    });

    await s.send("Runtime.addBinding", { name: BINDING, executionContextName: WORLD });
    await s.send("Runtime.enable"); // reports existing contexts, including a Morse world left by an earlier session
    await s.send("Page.enable");
    // Every new document: Chromium creates Morse's world and runs the runtime in it.
    await s.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT, worldName: WORLD });
    // The document that's already loaded.
    const { frameTree } = await s.send("Page.getFrameTree");
    const top = frameTree.frame.id;
    if (!frames.get(top)?.world) { // reattaching keeps the runtime that's already there
      const { executionContextId } = await s.send("Page.createIsolatedWorld", { frameId: top, worldName: WORLD });
      await s.send("Runtime.evaluate", { expression: BOOT, contextId: executionContextId });
    }
    this.log(`  ✓ attached to ${target.title || target.url}`);
  }

  // The URL of the document that called, read from Morse's own world (the
  // page can't change what our world sees, and it follows pushState).
  async callerUrl(s, caller) {
    const r = await s.send("Runtime.evaluate", { expression: "location.href", contextId: caller.world, returnByValue: true });
    if (typeof r.result?.value !== "string") throw new Error("The page went away");
    return r.result.value;
  }

  // A mod the caller may change: one that applies to the caller's page.
  async ownMod(id, where) {
    const existing = await getMod(id);
    if (existing && !modMatches(existing, where)) throw new Error("That mod belongs to another app or site");
    return existing;
  }

  // Voice input records in the page; let it use the microphone without a
  // prompt the app may never show. Scoped to this page's origin.
  async grantMic(s, url) {
    let origin;
    try { origin = new URL(url).origin; } catch { return; }
    if (!/^https?:/.test(origin) || this.granted?.has(origin)) return;
    try {
      const info = await s.send("Target.getTargetInfo").catch(() => null);
      const browserContextId = info?.targetInfo?.browserContextId;
      await s.send("Browser.grantPermissions", { origin, permissions: ["audioCapture"], ...(browserContextId && { browserContextId }) });
      (this.granted ||= new Set()).add(origin);
    } catch {}
  }

  // To the runtime, in Morse's world.
  push(s, caller, msg) {
    return s.send("Runtime.evaluate", { expression: `globalThis.__morseHostReceive && __morseHostReceive(${JSON.stringify(msg)})`, contextId: caller.world }).catch(() => {});
  }

  // Mod code, in the page's main world of the document that asked.
  async exec(s, caller, modId, js) {
    const ctx = caller.main;
    if (ctx == null) return { ok: false, error: "The page isn't ready yet. Try again." };
    const r = await s.send("Runtime.evaluate", { expression: wrapModCode(modId, js), contextId: ctx, returnByValue: true });
    if (r.exceptionDetails) return { ok: false, error: r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text };
    const res = r.result?.value || { ok: false, error: "no result" };
    if (!res.ok) return res;
    // Errors inside watch/on callbacks surface a moment later.
    await new Promise(r2 => setTimeout(r2, 600));
    const e = await s.send("Runtime.evaluate", { expression: `morse.__errors(${JSON.stringify(modId)})`, contextId: ctx, returnByValue: true });
    const errs = e.result?.value || [];
    return errs.length ? { ok: false, error: errs[0].split("\n")[0] } : { ok: true };
  }

  // caller: { world, main, frameId } of the document whose runtime asked.
  async handle(s, caller, msg) {
    const reply = (result, error) => this.push(s, caller, { reply: msg.id, result, error });
    try { reply(await this.dispatch(s, caller, msg)); }
    catch (e) { reply(null, e.message || String(e)); }
  }

  async dispatch(s, caller, msg) {
    const app = this.app?.id || null;
    // Where the caller is, from the caller's document, not from the message.
    let at;
    const here = async () => ({ url: await (at ||= this.callerUrl(s, caller)), app });
    // App-wide in desktop apps, per site in a browser.
    const historyScope = async () => app || hostOf((await here()).url);
    switch (msg.type) {
      case "hello":
        this.grantMic(s, (await here()).url);
        return { mode: "desktop", app, appName: this.app?.name || null, label: settingsLabel(this.settings),
          settings: await loadPrefs(), voice: await cachedVoiceStatus() };
      case "mods.list":
        return modsFor(await here());
      case "mods.save": {
        const where = await here();
        if (msg.draft) {
          await this.ownMod(msg.draft.id, where);
          return saveMod(createMod({ ...msg.draft, url: where.url, app, model: this.settings.model }));
        }
        validateMod(msg.mod);
        await this.ownMod(msg.mod.id, where);
        if (!modMatches(msg.mod, where)) throw new Error("That mod is for another app or site");
        return saveMod(msg.mod);
      }
      case "mods.delete":
        await this.ownMod(msg.modId, await here());
        return deleteMod(msg.modId);
      // Decode and validate a shared mod without saving it (install confirmation).
      case "mods.preview": {
        const src = msg.source.trim();
        return src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
      }
      case "mods.import": {
        const src = msg.source.trim();
        const mod = src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
        const where = await here(); // the user confirmed this install in the runtime (64-install.js, 80-modals.js)
        return saveMod({ ...mod, enabled: true, imported: true, match: mod.match || { hosts: [hostOf(where.url)], app: where.app } });
      }
      // God mode: cross-app clipboard (Capture in one app, rebuild in another)
      case "clipboard.list":
        return readClipboard();
      case "clipboard.put":
        return putClipboard({ ...msg.item, from: { ...msg.item?.from, app: this.app?.name || msg.item?.from?.app || null } });
      case "exec":
        return this.exec(s, caller, msg.modId, msg.js);
      case "off":
        if (caller.main == null) return true;
        await s.send("Runtime.evaluate", { expression: `globalThis.morse && morse.__off(${JSON.stringify(msg.modId)})`, contextId: caller.main });
        return true;
      case "generate": {
        const t0 = Date.now();
        const res = await this.gens.run(msg.genId, signal => runMorse({
          settings: this.settings,
          request: msg.request,
          context: { ...msg.context, app: this.app?.name || msg.context.app },
          exec: js => this.exec(s, caller, msg.genId, js),
          emit: ev => { if (!signal.aborted) this.push(s, caller, { ...ev, genId: msg.genId }); },
          signal,
        }));
        if (res.cancelled) { this.log(`  ■ "${msg.request}" stopped after ${Date.now() - t0}ms`); return res; }
        this.log(`  ${res.ok ? "✓" : "✗"} "${msg.request}" → ${res.title || "-"} (${Date.now() - t0}ms, ${res.attempts} attempt${res.attempts > 1 ? "s" : ""})`);
        return { ok: res.ok, error: res.error, title: res.title, css: res.css, js: res.js, attempts: res.attempts };
      }
      case "capture": {
        const from = Date.now() / 1000 - 0.15;
        const r = await s.send("Page.captureScreenshot", { format: "png" });
        this.recorder?.drop(from, Date.now() / 1000 + 0.1);
        return `data:image/png;base64,${r.data}`;
      }
      case "clip.start":
        this.recorder?.stop();
        this.recorder = new Recorder(s);
        await this.recorder.start();
        return true;
      case "clip.cancel":
        this.recorder?.stop();
        this.recorder = null;
        return true;
      case "clip.stop": {
        if (!this.recorder) return null;
        const rec = this.recorder;
        this.recorder = null;
        await new Promise(r => setTimeout(r, 900));
        return rec.finish(msg.modId);
      }
      case "export": {
        const data = msg.dataUrl ? Buffer.from(msg.dataUrl.split(",")[1], "base64") : msg.content;
        return { path: await writeExport(msg.filename, data) };
      }
      case "share": {
        const slug = msg.mod.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mod";
        if (msg.kind === "link") return { link: await encodeShare(msg.mod) };
        if (msg.kind === "json") return { path: await writeExport(`${slug}.morse.json`, JSON.stringify(msg.mod, null, 2)) };
        if (msg.kind === "userscript") return { path: await writeExport(`${slug}.user.js`, toUserscript(msg.mod)) };
        throw new Error(`Unknown share kind ${msg.kind}`);
      }
      case "open": {
        if (!/^https:\/\//.test(msg.url)) throw new Error("Refusing to open non-https URL");
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
        spawn(cmd, [msg.url], { detached: true, stdio: "ignore" }).unref();
        return true;
      }
      // ---- command bar: stop, settings, history, voice
      case "generate.cancel":
        return this.gens.cancel(msg.genId);
      case "settings.get":
        return loadPrefs();
      case "settings.set":
        return savePrefs(msg.settings);
      case "history.get":
        return loadHistory(await historyScope());
      case "history.add":
        return addHistory(await historyScope(), msg.text);
      case "transcribe":
        return transcribeAudio({ audio: msg.audio, mime: msg.mime });
      default:
        throw new Error(`Unknown request ${msg.type}`);
    }
  }
}
