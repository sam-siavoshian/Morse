// The desktop connector: attaches to every window of a Chromium/Electron app
// over CDP, injects the Morse runtime, and serves its requests (generate, run,
// save, share). CDP evaluation is exempt from the page's CSP, so mods work in
// locked-down apps too.

import { spawn } from "node:child_process";
import { CDPSession, listTargets } from "./cdp.js";
import { modsFor, saveMod, deleteMod, writeExport } from "./store.js";
import { createMod, encodeShare, decodeShare, toUserscript, validateMod, hostOf } from "../core/mod.js";
import { wrapModCode } from "../core/kit.js";
import { runMorse } from "../core/engine.js";
import { settingsLabel } from "./models.js"; // also registers the Claude Code / Codex providers
import { Recorder } from "./record.js";

import { bundleRuntime } from "../runtime/bundle.js";
const RUNTIME = bundleRuntime();

const SHIM = `(() => {
  if (window.top !== window || globalThis.__morseHost) return;
  const send = globalThis.__morseHostSend;
  if (typeof send !== "function") return;
  const subs = [];
  globalThis.__morseHost = { send: m => send(JSON.stringify(m)), onMessage: fn => subs.push(fn) };
  globalThis.__morseHostReceive = m => subs.forEach(f => f(m));
})();`;

// Page.addScriptToEvaluateOnNewDocument runs before <html> exists.
const BOOT = `(() => { const go = () => { ${SHIM}\n${RUNTIME} }; document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go, { once: true }) : go(); })();`;

export class Connector {
  constructor({ port, app = null, settings, log = console.log }) {
    Object.assign(this, { port, app, settings, log });
    this.pages = new Map();
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
    // Listen before injecting: the runtime says hello during evaluation.
    s.on("Runtime.bindingCalled", p => {
      if (p.name !== "__morseHostSend") return;
      let msg;
      try { msg = JSON.parse(p.payload); } catch { return; }
      this.handle(s, p.executionContextId, msg);
    });
    await s.send("Runtime.enable");
    await s.send("Page.enable");
    await s.send("Runtime.addBinding", { name: "__morseHostSend" });
    await s.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT });
    await s.send("Runtime.evaluate", { expression: BOOT });
    this.log(`  ✓ attached to ${target.title || target.url}`);
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
    switch (msg.type) {
      case "hello":
        return { mode: "desktop", app: this.app?.id || null, appName: this.app?.name || null, label: settingsLabel(this.settings) };
      case "mods.list":
        return modsFor({ url: msg.url, app: this.app?.id || null });
      case "mods.save": {
        if (msg.draft) return saveMod(createMod({ ...msg.draft, app: this.app?.id || null, model: this.settings.model }));
        return saveMod(msg.mod);
      }
      case "mods.delete":
        return deleteMod(msg.modId);
      case "mods.import": {
        const src = msg.source.trim();
        const mod = src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
        return saveMod({ ...mod, enabled: true, imported: true, match: mod.match || { hosts: [hostOf(where.url)], app: where.app } });
      }
      case "exec":
        return this.exec(s, ctx, msg.modId, msg.js);
      case "off":
        await s.send("Runtime.evaluate", { expression: `globalThis.morse && morse.__off(${JSON.stringify(msg.modId)})`, contextId: ctx });
        return true;
      case "generate": {
        const t0 = Date.now();
        const res = await runMorse({
          settings: this.settings,
          request: msg.request,
          context: { ...msg.context, app: this.app?.name || msg.context.app },
          exec: js => this.exec(s, ctx, msg.genId, js),
          emit: ev => this.push(s, ctx, { ...ev, genId: msg.genId }),
        });
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
      default:
        throw new Error(`Unknown request ${msg.type}`);
    }
  }
}
