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
    url: location.href, match: location.host, target: { label: "div · “Toolbar”" }, created: now, updated: now, ...over,
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
        // Install a mod: the review (63-control.js) asks what a link holds, then installs it
        case "mods.preview":
          if (C.importFail) return fail(C.importFail);
          if (!/morse|install/i.test(m.source || "")) return fail("This isn't a Morse share link or mod file. Check that you copied all of it.");
          return reply({ kind: "link", mods: [fixture(98, { id: undefined, title: "Bigger buttons", prompt: "make every button bigger", css: "button { min-height: 40px }" })] });
        case "control.install": {
          const saved = m.mods.map((x, i) => ({ ...x, id: `installed${C.mods.length + i}`, enabled: true, created: now, updated: now }));
          C.mods.push(...saved);
          return reply(structuredClone(saved));
        }
        case "exec": return reply(C.execFail ? { ok: false, error: C.execFail } : { ok: true });
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
