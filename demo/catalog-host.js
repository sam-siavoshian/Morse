// A scriptable fake host for the UI catalog (demo/ui-catalog.js).
//
// It speaks the same protocol as the extension and the desktop connector, but
// generation never runs on its own: the catalog drives it step by step through
// globalThis.__cat (token / phase / done), so every state can be frozen and
// photographed. Load it before runtime.js. Query params:
//   ?mods=0|1|12   fixture mods for the panel
//   ?label=...     model label shown in the bar and panel footer
//   ?voice=0|none  host can't transcribe (0: with a setup hint, none: no hint)
//   ?clips=1       fixture snapshots on the Morse clipboard
//   ?hist=1        fixture prompt history
//   ?gallery=1 ?suspect=1 ?paused=1 ?versions=1   see the round 3 fixtures below
//   ?style= ?guard=1 ?onboard=   see the round 4 fixtures below
(() => {
  if (globalThis.__morseHost) return;
  try { localStorage.setItem("morse:debug", "1"); } catch {}
  const q = new URLSearchParams(location.search);
  const subs = [];
  const emit = m => setTimeout(() => subs.forEach(f => f(m)), 0);
  const now = new Date("2026-10-24T09:00:00Z").toISOString();

  const LONG_PROMPT = "make every playlist row show the total duration, the date I last played it, and a small button that shuffles only the songs I have never skipped, and keep it working when the list re-renders";
  const fixture = (i, over = {}) => ({
    id: `mod${i}`, title: `Mod ${i}`, prompt: "make it airier", css: ".x { gap: 12px }", js: "", enabled: true,
    url: location.href, match: { hosts: [location.host], app: null }, target: { label: "div · “Toolbar”" }, created: now, updated: now, ...over,
  });
  const MODS = {
    0: [],
    1: [fixture(1, { title: "Airier toolbar", prompt: "make the toolbar airier", js: "morse.watch('#toolbar', t => t.dataset.airy = 1)" })],
    12: [
      fixture(1, { title: "Airier toolbar", prompt: "make the toolbar airier" }),
      fixture(2, { title: "Sleep timer in the player bar that fades the volume out over the last thirty seconds", prompt: LONG_PROMPT, js: "morse.el('button')" }),
      fixture(3, { title: "Hide ads", prompt: "hide every ad slot", target: null }),
      fixture(4, { title: "Compact sidebar", prompt: "make the sidebar narrower", enabled: false }),
      fixture(5, { title: "Word count", prompt: "show a live word count under the composer", js: "morse.watch('textarea', ...)", target: { label: "textarea · “Message Parley”" } }),
      fixture(6, { title: "Supercalifragilisticexpialidocious_unbroken_identifier_title_without_spaces", prompt: "averyveryverylongpromptwithoutanyspacesatallthatshouldnotblowupthelayout_ever_ever", enabled: false }),
      fixture(7, { title: "Bigger album art", prompt: "double the album art size", css: ".cv { width: 96px }" }),
      fixture(8, { title: "Copy as markdown", prompt: "add a button that copies the conversation as markdown", js: "morse.el('button')", target: { label: "header · “Parley 4o”" } }),
      fixture(9, { title: "Serif headlines", prompt: "use a serif for headlines", target: null }),
      fixture(10, { title: "Broken: keyboard shortcuts", prompt: "add j/k to move between messages", js: "throw new Error('x')", broken: "TypeError: Cannot read properties of null (reading 'addEventListener')" }),
      fixture(11, { title: "Dim read messages", prompt: "dim messages I've already read", enabled: false, target: null }),
      fixture(12, { title: "Shuffle unskipped", prompt: "shuffle only songs I never skip", js: "morse.el('button')" }),
    ],
  };
  const C = globalThis.__cat = {
    mods: structuredClone(MODS[q.get("mods") || "0"] || []),
    label: q.get("label") || "Claude Code · sonnet",
    gen: null, execFail: null, importFail: null, calls: [],
    settings: {}, history: q.get("hist") ? ["make the toolbar airier", "hide the cookie banner on every page", "add a sleep timer to the player"] : [],
    clips: [], transcript: "make the toolbar airier", transcribeFail: null, holdTranscribe: false,
    token(text) { if (C.gen) emit({ type: "token", text, genId: C.gen.genId }); },
    phase(phase, error) { if (C.gen) emit({ type: "phase", phase, error, genId: C.gen.genId }); },
    css(css) { if (C.gen) emit({ type: "css", css, genId: C.gen.genId }); },
    done(res) { const g = C.gen; C.gen = null; g?.reply(res); },
    push(m) { emit(m); },
  };
  const card = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#0b0b0c"/><text x="40" y="92" fill="#f4f4f5" font-family="sans-serif" font-size="34">“make the toolbar airier”</text><rect x="40" y="206" width="548" height="400" rx="14" fill="#18181b" stroke="#3a3a40" stroke-width="2"/><rect x="612" y="206" width="548" height="400" rx="14" fill="#18181b" stroke="#f4f4f5" stroke-width="2"/></svg>')}`;

  const thumb = (w, h, bg, fg) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/><rect x="12" y="${h / 2 - 6}" width="${w / 2}" height="12" rx="3" fill="${fg}"/></svg>`)}`;
  if (q.get("clips")) C.clips = [
    { id: "c1", label: "div · “The Daily Byte”", note: "red masthead, bold white type", thumb: thumb(240, 64, "#c8102e", "#fff"), from: { app: "The Daily Byte", url: "http://byte/", title: "The Daily Byte" }, created: now },
    { id: "c2", label: "button · “Subscribe to the weekly newsletter for product designers”", note: "", from: { app: "Parley", url: "http://parley/", title: "Parley" }, created: now },
    { id: "c3", label: "nav · “Library”", note: "", thumb: thumb(120, 140, "#18181b", "#a0a0a8"), from: { app: "Tunes", url: "http://tunes/", title: "Tunes" }, created: now },
  ];
  // ---- round 3 fixtures: Mods for this site, user control, version history, a broken mod
  //   ?gallery=1   three mods others made for this page (+ an installed v1 with an update)
  //   ?suspect=1   safe start: the first mod is held back on this load
  //   ?paused=1    Morse paused everywhere
  //   ?versions=1  the first fixture mod has three earlier versions
  //   (a fixture with `broken` fails when it runs, so the panel flags it)
  const SLEEP_JS = "morse.watch('#toolbar', bar => {\n  const btn = morse.el('button', { text: 'Sleep' });\n  bar.append(btn);\n  let left = 0;\n  morse.on(btn, 'click', () => { left = left ? 0 : 30; });\n  morse.every(1000, () => { if (left > 0) left--; });\n});";
  const GALLERY = q.get("gallery") ? [
    { id: "cat-sleep-timer", title: "Sleep timer", prompt: "add a sleep timer to the player that fades out", author: "Ana", version: 2, changes: "Fades out over 30 seconds instead of stopping at once.",
      mod: { title: "Sleep timer", prompt: "add a sleep timer to the player that fades out", css: ".sleep { margin-left: 8px; }\n.sleep.on { font-weight: 600; }", js: SLEEP_JS + "\n// v2: fade\nmorse.every(250, () => {});", version: 2, match: { hosts: [location.host] } } },
    { id: "cat-no-promos", title: "No promo banners", prompt: "hide the promo banners and the upgrade button", author: "morse", version: 1,
      mod: { title: "No promo banners", prompt: "hide the promo banners and the upgrade button", css: ".promo, [data-upsell] { display: none !important; }", js: "", version: 1, match: { hosts: [location.host] } } },
    { id: "cat-draft-keeper", title: "Draft keeper", prompt: "keep a copy of what I type so I never lose a draft", author: "Sam",
      mod: { title: "Draft keeper", prompt: "keep a copy of what I type so I never lose a draft", css: "", js: "morse.watch('textarea', box => morse.on(box, 'input', () => fetch('https://drafts.example.net/save', { method: 'POST', body: box.value })));", match: { hosts: [location.host] } } },
  ] : [];
  if (q.get("gallery")) C.mods.push(fixture(20, { title: "Sleep timer", prompt: "add a sleep timer to the player", js: SLEEP_JS, css: ".sleep { margin-left: 8px; }",
    imported: true, importedFrom: "gallery", importedAt: now, author: "Ana", version: 1, gallery: { id: "cat-sleep-timer", version: 1 }, target: null }));
  if (q.get("versions") && C.mods[0]) C.mods[0].history = [
    { prompt: "make the toolbar airier", css: ".x { gap: 8px }", js: "", at: "2026-10-20T09:00:00Z" },
    { prompt: "a bit more space between the buttons", css: ".x { gap: 12px }", js: "", at: "2026-10-22T09:00:00Z" },
    { prompt: "and round the corners of the whole toolbar so it matches the cards below it", css: ".x { gap: 12px; border-radius: 12px }", js: "", at: "2026-10-23T09:00:00Z" },
  ];
  if (C.mods[0] && q.get("versions")) C.mods[0].refined = "make the icons a little larger";
  // ?heal=1: a gallery mod whose fingerprint (globalThis.__catHealFp, worked out
  // by the catalog with core/heal.js) points at an album grid this page no longer has
  if (q.get("heal") && globalThis.__catHealFp) C.mods.push(fixture(30, { ...globalThis.__catHealMod, fp: globalThis.__catHealFp }));
  if (q.get("autofix")) C.settings.autoFix = true;
  C.control = { pause: { all: !!q.get("paused"), sites: {} } };
  const b64 = s => { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); } catch { return null; } };
  function preview(src) {
    src = String(src || "").trim();
    if (C.preview) return C.preview;
    if (src.includes("#m=")) { const m = b64(src.split("#m=")[1]); return m ? { kind: "link", mods: [{ css: "", js: "", ...m }], errors: [] } : null; }
    let data; try { data = JSON.parse(src); } catch { return null; }
    const list = Array.isArray(data) ? data : Array.isArray(data?.mods) ? data.mods : [data];
    return { kind: Array.isArray(data) || data?.mods ? "backup" : "mod", mods: list.map(m => ({ css: "", js: "", ...m })), errors: [] };
  }

  // ---- round 4 fixtures: Your style, guards, first run
  //   ?style=1|off|except|fitted   Your style (the real core/style-host.js, kept in memory):
  //                  on everywhere, off everywhere, off on this site, fitted to this site
  //   ?guard=1       three mods the guards paused (slowing, froze, hid) and one that is
  //                  about to slow the page (C.slow: the kit's __stats says so)
  //   ?onboard=new|nomodel|noscripts|done   first-run progress (onboarding.get)
  const where = () => ({ url: location.href, app: null });
  const styleHost = q.get("style") ? import("/core/style-host.js").then(async ({ createStyleHost }) => {
    const { parseStyleWords, mergeStyle, styleKey } = await import("/core/style.js");
    const words = "Georgia font, bigger text, softer colors and underline links everywhere except figma and slack";
    let s = mergeStyle(null, parseStyleWords(words), words, now);
    if (q.get("style") === "off") s = { ...s, enabled: false };
    if (q.get("style") === "except") s = { ...s, except: [...s.except, styleKey(where())] };
    if (q.get("style") === "fitted") s = { ...s, adapt: true, tried: { [styleKey(where())]: now } };
    if (q.get("style") === "plain") s = null;
    let stored = s;
    return createStyleHost({ load: async () => stored, save: async v => { stored = v; }, now: () => now });
  }) : null;
  if (q.get("guard")) {
    const at = new Date(Date.now() - 20000).toISOString();
    C.mods.push(
      fixture(40, { title: "Live word count", prompt: "show a live word count under every text box", js: "morse.watch('textarea', t => {})", enabled: false, paused: { why: "loop", at, error: "" } }),
      fixture(41, { title: "Infinite scroll for the archive", prompt: "load the next page of the archive when I reach the bottom", js: "while (true) {}", enabled: false, paused: { why: "froze", at, reloaded: true, error: "" } }),
      fixture(42, { title: "Focus mode", prompt: "hide everything except the article", css: "body { display: none }", enabled: false, paused: { why: "hid", at, error: "" } }),
      fixture(43, { title: "Highlight new messages", prompt: "highlight messages that arrived since my last visit", js: "morse.watch('.msg', m => {})" }),
    );
    C.slow = { mod43: { why: "slow", at } };
  }
  if (q.get("style") === "fitted") C.mods.push(fixture(50, { title: `Your style for ${location.host}`, prompt: "Fit Your style to this site", parent: "morse-style", css: ".app { max-width: 100vw }" }));
  const ONBOARD = {
    new: { state: {}, status: { mode: "catalog", model: { connected: true }, userScripts: true } },
    nomodel: { state: { coach: "done" }, status: { mode: "catalog", model: { connected: false }, userScripts: true } },
    noscripts: { state: { coach: "done" }, status: { mode: "catalog", model: { connected: true }, userScripts: false } },
    done: { state: { coach: "done", tips: { saved: true } }, status: { mode: "catalog", model: { connected: true }, userScripts: true } },
  }[q.get("onboard") || ""];

  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(a[k] || {}), ...v } : v; return o; };
  const voice = q.get("voice") === "none" ? null : q.get("voice") === "0"
    ? { transcribe: false, provider: null, label: "", hint: "Voice: add an OpenAI key in the Morse popup, or run the Morse helper" }
    : { transcribe: true, provider: "openai", label: "OpenAI gpt-4o-mini-transcribe", hint: "" };

  globalThis.__morseHost = {
    onMessage: fn => subs.push(fn),
    async send(m) {
      C.calls.push(m.type);
      const reply = result => emit({ reply: m.id, result });
      const fail = error => emit({ reply: m.id, error });
      if (styleHost) {
        const sh = await styleHost;
        if (sh.owns(m)) { try { return reply(await sh.handle(m, where())); } catch (e) { return fail(e.message); } }
        if (m.type === "mods.list") return reply(await sh.list(structuredClone(C.mods), where()));
      }
      if (ONBOARD) {
        if (m.type === "onboarding.get") return reply(structuredClone(ONBOARD));
        if (m.type === "onboarding.set") { ONBOARD.state = merge(ONBOARD.state, m.patch); return reply(true); }
        if (m.type === "onboarding.open") return reply(null);
      }
      if (m.type === "stats" && C.slow?.[m.modId]) return reply({ watches: [], paused: C.slow[m.modId] });
      switch (m.type) {
        case "hello": return reply({ mode: "catalog", label: C.label, quiet: q.get("quiet") !== "0", appName: q.get("app") || null, settings: C.settings, voice });
        case "settings.get": return reply(C.settings);
        case "settings.set": C.settings = merge(C.settings, m.settings); return reply(structuredClone(C.settings));
        case "history.get": return reply(C.history.slice());
        case "history.add": C.history = C.history.filter(x => x !== m.text).concat(m.text).slice(-50); return reply(C.history.slice());
        case "clipboard.list": return reply(structuredClone(C.clips));
        case "clipboard.put": C.clips = [m.item, ...C.clips]; return reply(structuredClone(C.clips));
        case "transcribe": {
          if (!voice?.transcribe) return fail("Unknown request transcribe");
          if (m.partial) return reply({ text: C.transcript.split(" ").slice(0, 3).join(" ") });
          const answer = () => C.transcribeFail ? fail(C.transcribeFail) : reply({ text: C.transcript });
          if (C.holdTranscribe) { C.release = answer; return; }
          return setTimeout(answer, 200);
        }
        case "generate.cancel": return reply(true);
        case "mods.list": return reply(structuredClone(C.mods));
        case "mods.save": {
          if (m.draft) {
            const mod = { ...m.draft, enabled: true, created: now, updated: now };
            C.mods.push(mod);
            return reply(structuredClone(mod));
          }
          const i = C.mods.findIndex(x => x.id === m.mod.id);
          if (i >= 0) C.mods[i] = structuredClone(m.mod);
          return reply(structuredClone(m.mod));
        }
        case "mods.delete": C.mods = C.mods.filter(x => x.id !== m.modId); return reply(true);
        case "mods.import":
          if (C.importFail) return fail(C.importFail);
          return reply(fixture(99, { title: "Imported mod" }));
        case "exec": { const f = C.mods.find(x => x.id === m.modId)?.broken; return reply(C.execFail || f ? { ok: false, error: C.execFail || f } : { ok: true }); }
        case "stats": return reply({ watches: [] });
        case "gallery.list": return reply({ items: structuredClone(GALLERY), site: location.host });
        case "mods.preview": { const r = preview(m.source); return r ? reply(r) : fail("This isn't a Morse share link or mod file. Check that you copied all of it."); }
        case "control.boot": return reply({ pause: C.control.pause, suspect: q.get("suspect") && C.mods[0] ? { id: C.mods[0].id, title: C.mods[0].title } : null });
        case "control.get": return reply({ pause: C.control.pause });
        case "control.pause": {
          if (m.scope === "all") C.control.pause.all = !!m.on;
          else { const k = location.host; if (m.on) C.control.pause.sites[k] = true; else delete C.control.pause.sites[k]; }
          return reply({ pause: structuredClone(C.control.pause) });
        }
        case "control.install": { const saved = (m.mods || []).map((x, i) => ({ ...fixture(90 + i), ...x, enabled: true, imported: true, importedFrom: "link", importedAt: now })); C.mods.push(...saved); return reply(structuredClone(saved)); }
        case "control.exportAll": return reply({ filename: "morse-mods-2026-10-24.json", content: JSON.stringify({ morse: "backup", mods: C.mods }), count: C.mods.length });
        case "open": C.opened = m.url; return reply(true);
        case "off": return reply(true);
        case "capture": return reply(globalThis.__catCapture ? await globalThis.__catCapture() : card);
        case "generate": C.gen = { genId: m.genId, reply }; return;
        case "share": return reply(m.kind === "link"
          ? { link: `https://morse.sh/install#m=${btoa(JSON.stringify({ t: m.mod.title })).slice(0, 48)}…` }
          : { path: `~/Downloads/${m.kind === "json" ? "mod.morse.json" : "mod.user.js"}` });
        case "export": return reply({ path: `~/Downloads/${m.filename}` });
        case "clip.stop": return reply(q.get("clip") ? { kind: "gif", path: "~/Movies/morse/clip.gif" } : null);
        default: return reply(null);
      }
    },
  };
})();
