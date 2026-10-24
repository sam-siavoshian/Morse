// The desktop connector: attaches to every window, webview and app frame of a
// Chromium/Electron app over CDP (and keeps up as they come, go, reload or
// crash), injects the Morse runtime, and serves its requests (generate, run,
// save, share). CDP evaluation is exempt from the page's CSP, so mods work in
// locked-down apps too.

import { spawn } from "node:child_process";
import { mkdirSync, watch } from "node:fs";
import path from "node:path";
import { CDPSession, listTargets } from "./cdp.js";
import { modsFor, saveMod, deleteMod, writeExport, readClipboard, putClipboard } from "./store.js";
import { createMod, encodeShare, decodeShare, toUserscript, validateMod, hostOf } from "../core/mod.js";
import { wrapModCode } from "../core/kit.js";
import { runMorse } from "../core/engine.js";
import { settingsLabel } from "./models.js"; // also registers the Claude Code / Codex providers
import { Recorder } from "./record.js";
import { loadPrefs, savePrefs, loadHistory, addHistory } from "./store.js";
import { Generations } from "../core/cancel.js";
import { cachedVoiceStatus, transcribeAudio } from "./voice.js";
import { HOME, listMods } from "./store.js";
import { classifyTarget, describeTarget } from "./targets.js";
import { ONBOARDING_REQUESTS, handleOnboarding } from "./onboarding.js"; // onboarding hook: first-run state

import { bundleRuntime } from "../runtime/bundle.js";
const RUNTIME = bundleRuntime();

// Shim + boot: the runtime starts once per document. In a window it runs in the
// top frame only; in an iframe target (an app webview) it runs in that frame
// but not in frames nested inside it.
const shim = frame => `(() => {
  const nested = ${frame ? "(() => { try { return window.parent !== window && !!window.parent.document; } catch { return false; } })()" : "window.top !== window"};
  if (nested || globalThis.__morseHost) return;
  const send = globalThis.__morseHostSend;
  if (typeof send !== "function") return;
  const subs = [];
  globalThis.__morseHost = { send: m => send(JSON.stringify(m)), onMessage: fn => subs.push(fn) };
  globalThis.__morseHostReceive = m => subs.forEach(f => f(m));
})();`;

// Page.addScriptToEvaluateOnNewDocument runs before <html> exists.
const boot = frame => `(() => { const go = () => { ${shim(frame)}\n${RUNTIME} }; document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go, { once: true }) : go(); })();`;
const BOOT = { window: boot(false), frame: boot(true) };

// What `morse stop` leaves behind: no bar, no mods, no hooks for new pages.
const cleanup = ids => `(() => { try {
  globalThis.__morseGen = (globalThis.__morseGen || 0) + 1; // the runtime here goes quiet
  for (const s of document.querySelectorAll("style[data-morse-css]")) { globalThis.morse?.__off?.(s.dataset.morseCss); s.remove(); }
  for (const id of ${JSON.stringify(ids)}) globalThis.morse?.__off?.(id);
  document.querySelectorAll("[data-morse-ui]").forEach(e => e.remove());
  delete globalThis.__morseHost; delete globalThis.__morseHostReceive; delete globalThis.__morseRuntime;
} catch {} })()`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Connector {
  // watch: keep waiting when the app quits and attach again when it's back.
  // verify(): called before attaching again after a restart; { ok, why }.
  // onChange(connector): windows or state changed (for `morse status`).
  constructor({ port, app = null, settings, log = console.log, watch = false, verify = null, onChange = null, interval = 1000 }) {
    Object.assign(this, { port, app, settings, log, watch, verify, onChange, interval });
    this.pages = new Map();   // target id -> CDPSession (null while connecting)
    this.windows = new Map(); // target id -> { id, type, kind, title, url, frame, session, since }
    this.retry = new Map();   // target id -> { at, n } after a failed attach
    this.recentSaves = new Map();
    this.gens = new Generations();
    this.state = "starting";  // starting | attached | waiting | stopped
  }

  get appName() { return this.app?.name || "The app"; }

  changed() { try { this.onChange?.(this); } catch {} }

  // Polls the app's target list: new windows, popups, webviews and frames get
  // attached as they appear; resolves when the app quits (unless watching) or
  // on stop().
  async run() {
    this.running = true;
    this.watchMods();
    let misses = 0;
    while (this.running) {
      let list = null;
      try { list = await listTargets(this.port); misses = 0; }
      catch (e) { misses += /ECONNREFUSED|ECONNRESET/.test(String(e?.cause?.code || e?.code || e?.message)) ? 3 : 1; }
      if (!this.running) break; // stop() landed during the poll: don't mark attached or attach again
      if (list && this.state === "waiting") {
        const v = this.verify ? await this.verify().catch(e => ({ ok: false, why: e.message })) : { ok: true };
        if (!this.running) break;
        if (!v.ok) {
          if (this.refused !== v.why) this.log(`  ! Morse didn't connect: ${v.why}.`);
          this.refused = v.why;
          list = null;
        } else {
          this.refused = null;
          this.log(`  ↻ ${this.appName} is open again. Connecting.`);
        }
      }
      if (list) {
        if (this.state !== "attached") { this.state = "attached"; this.changed(); }
        this.sync(list);
      } else if (misses >= 3 && this.state === "attached") {
        this.dropAll();
        if (!this.watch) { this.log(`${this.appName} closed, so Morse stopped.`); this.state = "stopped"; break; }
        this.state = "waiting";
        this.log(`  … ${this.appName} closed. Waiting for it to open again (Ctrl+C to stop).`);
        this.changed();
      }
      await sleep(this.interval);
    }
    this.running = false;
    this.modWatcher?.close();
    return this.state;
  }

  sync(list) {
    const byId = new Map(list.map(t => [t.id, t]));
    let dirty = false;
    for (const t of list) {
      const w = this.windows.get(t.id);
      if (w) {
        if (w.title !== t.title || w.url !== t.url) { w.title = t.title; w.url = t.url; dirty = true; }
        continue;
      }
      if (this.pages.has(t.id)) continue;
      const c = classifyTarget(t, t.parentId ? byId.get(t.parentId)?.url : null);
      if (!c.attach) continue;
      const r = this.retry.get(t.id);
      if (r && Date.now() < r.at) continue;
      this.pages.set(t.id, null);
      this.attach(t, c).then(() => this.retry.delete(t.id), e => {
        this.pages.delete(t.id);
        this.windows.get(t.id)?.session?.close();
        this.windows.delete(t.id);
        const n = (r?.n || 0) + 1;
        this.retry.set(t.id, { at: Date.now() + Math.min(30000, 500 * 2 ** n), n });
        if (n === 1) this.log(`  ! Couldn't connect to ${describeTarget(t).title}: ${e.message}`);
      });
    }
    if (dirty) this.changed();
  }

  async attach(target, how = classifyTarget(target)) {
    const s = await CDPSession.connect(target.webSocketDebuggerUrl);
    if (!this.running && this.state === "stopped") { s.close(); return; }
    const { kind, title } = describeTarget(target);
    const w = { id: target.id, type: target.type, kind, title: target.title, url: target.url, frame: !!how.frame, session: s, since: Date.now() };
    const source = how.frame ? BOOT.frame : BOOT.window;
    this.pages.set(target.id, s);
    this.windows.set(target.id, w);
    this.everAttached = true;
    s.on("close", () => {
      this.pages.delete(target.id);
      this.windows.delete(target.id);
      this.changed();
      // A window closing on its own (the app keeps running) is worth a line.
      if (!w.crashed && !w.detaching && this.state === "attached") setTimeout(() => {
        if (this.state === "attached" && !this.pages.has(target.id)) listTargets(this.port).then(l => {
          if (!l.some(t => t.id === target.id)) this.log(`  − ${kind} closed: ${describeTarget(w).title}`);
        }, () => {});
      }, 600);
    });
    // The renderer died (sad page). Drop this session; the target usually
    // stays listed, so the next poll attaches a fresh one, and the runtime
    // comes back with the page's next document.
    s.on("Inspector.targetCrashed", () => {
      w.crashed = true;
      this.log(`  ! ${describeTarget(w).title} stopped working. Morse will connect again when it reloads.`);
      s.close();
    });
    // Listen before injecting: the runtime says hello during evaluation.
    s.on("Runtime.bindingCalled", p => {
      if (p.name !== "__morseHostSend") return;
      let msg;
      try { msg = JSON.parse(p.payload); } catch { return; }
      const done = this.handle(s, p.executionContextId, msg);
      if (/^mods\.(save|delete|import)$/.test(msg.type)) Promise.resolve(done).finally(() => this.modsChanged(s));
    });
    // Belt and braces for documents the new-document script misses (a renderer
    // that came back after a crash): boot again; the shim makes it a no-op twice.
    // A document that committed in a new renderer while we were attaching (an
    // app still starting up) can come without the binding: add it back first.
    const bootIn = async contextId => {
      const has = await s.send("Runtime.evaluate", { expression: "typeof globalThis.__morseHostSend", contextId, returnByValue: true }).catch(() => null);
      if (has && has.result?.value !== "function") await s.send("Runtime.addBinding", { name: "__morseHostSend" }).catch(() => {});
      await s.send("Runtime.evaluate", { expression: source, ...(contextId && { contextId }) }).catch(() => {});
    };
    s.on("Runtime.executionContextCreated", ({ context }) => {
      if (context.auxData?.isDefault && w.frameId && context.auxData.frameId === w.frameId) bootIn(context.id);
    });
    s.on("Page.frameNavigated", ({ frame }) => {
      if (frame.id === w.frameId && frame.url !== w.url) { w.url = frame.url; this.changed(); }
    });
    // Frame targets are listed by url; read their document title for `morse status`.
    const readTitle = () => s.send("Runtime.evaluate", { expression: "document.title", returnByValue: true })
      .then(r => { const t = r?.result?.value; if (t && t !== w.docTitle) { w.docTitle = t; this.changed(); } }, () => {});
    s.on("Page.loadEventFired", readTitle);
    await s.send("Inspector.enable").catch(() => {});
    await s.send("Page.enable");
    w.frameId = (await s.send("Page.getFrameTree").catch(() => null))?.frameTree?.frame?.id || target.id;
    await s.send("Runtime.addBinding", { name: "__morseHostSend" });
    w.script = (await s.send("Page.addScriptToEvaluateOnNewDocument", { source }))?.identifier;
    await s.send("Runtime.enable");
    // A page that is mid-crash or mid-navigation gets the runtime from its next document.
    await bootIn();
    readTitle();
    this.log(`  ✓ connected to ${title}${kind === "window" ? "" : ` (${kind})`}`);
    this.changed();
  }

  // Tell every other window to re-read its mods, so a mod saved in one window
  // (or with `morse install` / `morse rm`) shows up in all windows it matches.
  modsChanged(origin = null) {
    if (origin) this.recentSaves.set(origin, Date.now());
    clearTimeout(this.modsTimer);
    this.modsTimer = setTimeout(() => {
      const now = Date.now();
      for (const w of this.windows.values()) {
        if (!w.session || now - (this.recentSaves.get(w.session) || 0) < 1500) continue;
        w.session.send("Runtime.evaluate", { expression: `globalThis.__morseHostReceive && __morseHostReceive({ type: "mods.changed" })` }).catch(() => {});
      }
      for (const [s, t] of this.recentSaves) if (now - t > 5000) this.recentSaves.delete(s);
    }, 300);
  }

  watchMods() {
    try {
      const dir = path.join(HOME, "mods");
      mkdirSync(dir, { recursive: true });
      this.modWatcher = watch(dir, () => this.modsChanged());
      this.modWatcher.on("error", () => {});
    } catch {}
  }

  dropAll() {
    for (const w of this.windows.values()) { w.detaching = true; w.session?.close(); }
    this.windows.clear();
    this.pages.clear();
    this.retry.clear();
  }

  // Detach from every window: stop injecting into new pages, take the bar and
  // the mods off the open ones, close the sessions. The app keeps running.
  async stop() {
    this.running = false;
    this.state = "stopped";
    this.modWatcher?.close();
    const ids = (await listMods().catch(() => [])).map(m => m.id);
    await Promise.all([...this.windows.values()].map(async w => {
      w.detaching = true;
      const s = w.session;
      try {
        if (w.script) await s.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: w.script });
        await s.send("Runtime.evaluate", { expression: cleanup(ids) });
        await s.send("Runtime.removeBinding", { name: "__morseHostSend" });
      } catch {}
      s.close();
    }));
    this.windows.clear();
    this.pages.clear();
    this.changed();
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

  push(s, ctx, msg) {
    return s.send("Runtime.evaluate", { expression: `globalThis.__morseHostReceive && __morseHostReceive(${JSON.stringify(msg)})`, contextId: ctx }).catch(() => {});
  }

  async exec(s, ctx, modId, js) {
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

  async handle(s, ctx, msg) {
    const reply = (result, error) => this.push(s, ctx, { reply: msg.id, result, error });
    try { reply(await this.dispatch(s, ctx, msg)); }
    catch (e) { reply(null, e.message || String(e)); }
  }

  async dispatch(s, ctx, msg) {
    const where = { url: msg.url, app: this.app?.id || null };
    if (ONBOARDING_REQUESTS.has(msg.type)) return handleOnboarding(msg, { settings: this.settings }); // onboarding hook
    switch (msg.type) {
      case "hello":
        this.grantMic(s, msg.url);
        return { mode: "desktop", app: this.app?.id || null, appName: this.app?.name || null, label: settingsLabel(this.settings),
          settings: await loadPrefs(), voice: await cachedVoiceStatus() };
      case "mods.list":
        return modsFor({ url: msg.url, app: this.app?.id || null });
      case "mods.save": {
        if (msg.draft) return saveMod(createMod({ ...msg.draft, app: this.app?.id || null, model: msg.draft.model || settingsLabel(this.settings) }));
        return saveMod(msg.mod);
      }
      case "mods.delete":
        return deleteMod(msg.modId);
      // Decode and validate a shared mod without saving it (install confirmation).
      case "mods.preview": {
        const src = msg.source.trim();
        return src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
      }
      case "mods.import": {
        const src = msg.source.trim();
        const mod = src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
        return saveMod({ ...mod, enabled: true, imported: true, match: mod.match || { hosts: [hostOf(where.url)], app: where.app } });
      }
      // God mode: cross-app clipboard (Capture in one app, rebuild in another)
      case "clipboard.list":
        return readClipboard();
      case "clipboard.put":
        return putClipboard({ ...msg.item, from: { ...msg.item?.from, app: this.app?.name || msg.item?.from?.app || null } });
      case "exec":
        return this.exec(s, ctx, msg.modId, msg.js);
      case "off":
        await s.send("Runtime.evaluate", { expression: `globalThis.morse && morse.__off(${JSON.stringify(msg.modId)})`, contextId: ctx });
        return true;
      case "stats": // repair: does a saved mod still find its elements? (core/kit.js __stats)
        return (await s.send("Runtime.evaluate", { expression: `globalThis.morse?.__stats?.(${JSON.stringify(msg.modId)}) ?? null`, contextId: ctx, returnByValue: true })).result?.value ?? null;
      case "generate": {
        if (!this.settings?.provider || this.settings.provider === "none")
          throw new Error("No model is connected. Run morse doctor in a terminal to set one up.");
        const t0 = Date.now();
        const res = await this.gens.run(msg.genId, signal => runMorse({
          settings: this.settings,
          request: msg.request,
          context: { ...msg.context, app: this.app?.name || msg.context.app },
          base: msg.base, // refine / fix: the mod as it is now (core/prompt.js)
          exec: js => this.exec(s, ctx, msg.genId, js),
          emit: ev => { if (!signal.aborted) this.push(s, ctx, { ...ev, genId: msg.genId }); },
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
        return loadHistory(String(msg.scope || where.app || hostOf(msg.url)));
      case "history.add":
        return addHistory(String(msg.scope || where.app || hostOf(msg.url)), msg.text);
      case "transcribe":
        return transcribeAudio({ audio: msg.audio, mime: msg.mime });
      default:
        throw new Error(`Unknown request ${msg.type}`);
    }
  }
}
