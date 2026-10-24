// A stand-in for the Morse extension on the Riverside Library demo site
// (demo/sites/a11y), for tests/a11y-ui.test.js and demo/shoot-a11y.js. The
// real runtime runs on the page; this host keeps mods in localStorage, runs
// their code with the real kit, and answers model requests with the real
// engine and the demo model (core/demo.js). Screenshots of the page ("capture")
// come from window.__morseShot when the test or script provides one.
//
// Load it as a module before the runtime: <script type="module" src="/demo/a11y-host.js">.

import { wrapModCode } from "../core/kit.js";
import { createMod, modMatches } from "../core/mod.js";
import { runMorse } from "../core/engine.js";
import { pageCollapse } from "../core/guard.js";

const fake = window.__fake = { requests: [] };
const KEY = "morse:a11y-host:";
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(KEY + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(KEY + k, JSON.stringify(v)); },
};
localStorage.setItem("morse:debug", "1");
const subs = [], gens = new Map();
const emit = m => subs.forEach(f => f(m));
function run(id, js) {
  try {
    const r = (0, eval)(wrapModCode(id, js));
    const errs = r && r.ok ? globalThis.morse.__errors(id) : [];
    return errs.length ? { ok: false, error: errs[0] } : r;
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

globalThis.__morseHost = {
  onMessage: fn => subs.push(fn),
  async send(m) {
    const reply = (result, error) => setTimeout(() => emit({ reply: m.id, result, error }), 5);
    switch (m.type) {
      case "hello": return reply({ mode: "playground", label: "demo replay", quiet: true });
      case "mods.list": return reply(Object.values(store.get("mods", {})).filter(x => modMatches(x, { url: m.url || location.href, app: null })));
      case "mods.save": {
        const x = m.draft ? createMod({ ...m.draft, app: null, model: "demo replay" }) : m.mod;
        const all = store.get("mods", {});
        all[x.id] = x;
        store.set("mods", all);
        return reply(x);
      }
      case "mods.delete": { const all = store.get("mods", {}); delete all[m.modId]; store.set("mods", all); return reply(true); }
      case "exec": return reply(run(m.modId, m.js));
      case "off": globalThis.morse?.__off(m.modId); return reply(true);
      case "capture": return reply(window.__morseShot ? await window.__morseShot() : null);
      case "generate.cancel": gens.get(m.genId)?.abort(); return reply(true);
      case "generate": {
        fake.requests.push({ request: m.request, context: m.context });
        const ac = new AbortController();
        gens.set(m.genId, ac);
        try {
          const res = await runMorse({
            settings: { provider: "demo" }, request: m.request, context: m.context, signal: ac.signal,
            emit: ev => { if (!ac.signal.aborted) emit({ ...ev, genId: m.genId }); },
            exec: async js => run(m.genId, js),
            collapse: async css => pageCollapse(css, m.genId), // guard hook
          });
          return reply({ ok: res.ok, error: res.error, title: res.title, css: res.css, js: res.js, attempts: res.attempts });
        } catch (e) {
          return ac.signal.aborted ? reply({ ok: false, cancelled: true, error: "Stopped" }) : reply(null, e.message);
        } finally { gens.delete(m.genId); }
      }
      default: return reply(null);
    }
  },
};
