// Page tools: one-click changes from the bar's quick menu (dark mode, text
// size, hide ads, focus mode, reset). Each tool is a small "quick" mod whose
// code comes from core/edits.js, so it persists and shares like any mod.

const quickMenuGroups = []; // hook: more groups for the menu, as functions returning HTML (65-a11y.js)
const quickMenuItems = []; // hook: more items before "Turn off all mods here", as functions returning HTML (65-a11y.js)

const GodQuick = (() => {
  const svg = d => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    tools: '<path d="M2.25 4.5h6.5M11.75 4.5h2M2.25 11.5h2M7.25 11.5h6.5"/><circle cx="10.25" cy="4.5" r="1.5"/><circle cx="5.75" cy="11.5" r="1.5"/>',
    dark: '<path d="M13.25 9.6A5.5 5.5 0 1 1 6.4 2.75a4.5 4.5 0 0 0 6.85 6.85z"/>',
    light: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/>',
    bigger: '<path d="M1.75 12.75 5 4l3.25 8.75M2.9 9.75h4.2M12 4.75v5M9.5 7.25h5"/>',
    smaller: '<path d="M1.75 12.75 5 4l3.25 8.75M2.9 9.75h4.2M9.5 7.25h5"/>',
    noads: '<path d="M8 1.75 13.25 3.5v4c0 3.1-2.2 5.55-5.25 6.75C4.95 13.05 2.75 10.6 2.75 7.5v-4L8 1.75z"/><path d="M5.75 5.75l4.5 4.5"/>',
    focus: '<rect x="3.25" y="2.25" width="9.5" height="11.5" rx="1.5"/><path d="M5.75 5.25h4.5M5.75 8h4.5M5.75 10.75h2.5"/>',
    reset: '<path d="M2.75 8a5.25 5.25 0 1 0 1.55-3.7"/><path d="M2.5 2.25V5h2.75"/>',
    check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>',
  };
  const ITEMS = [
    { k: "dark", label: "quick.dark" }, // message ids (core/locales/en.js)
    { k: "light", label: "quick.light" },
    { k: "bigger", label: "quick.bigger" },
    { k: "smaller", label: "quick.smaller" },
    { k: "noads", label: "quick.noads" },
    { k: "focus", label: "quick.focus" },
    null,
    { k: "reset", label: "quick.reset" },
  ];

  const btn = document.createElement("button");
  btn.className = "gm-qbtn ibtn";
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "m-page-tools");
  const label = () => { btn.setAttribute("aria-label", t("quick.title")); btn.innerHTML = svg(I.tools) + GodMode.tip(t("quick.title"), ""); };
  label();
  langSubs.add(label);
  const row = bar.querySelector(".row");
  // Page tools live in the bar’s More menu; retain the trigger for hooks.
  btn.hidden = true;
  row.insertBefore(btn, row.querySelector(".go"));
  const menu = document.createElement("div");
  menu.className = "gm-menu menu";
  menu.id = "m-page-tools";
  menu.setAttribute("role", "menu");
  tBind(menu, "aria-label", "quick.title");
  menu.hidden = true;
  bar.append(menu);

  const quickMod = k => S.mods.find(m => m.kind === "quick" && m.edits?.[0]?.kind === k);
  const where = () => S.appName || location.host || t("panel.thisPage");
  const titleFor = e => e.kind === "zoom" ? t("quick.zoom", { pct: Math.round(zoomFor(e.level) * 100) }) : PAGE_TOOLS[e.kind] ? t(`quick.${e.kind}`) : PAGE_TOOLS[e.kind]?.title;

  function render() {
    const z = quickMod("zoom");
    const level = z?.enabled ? z.edits[0].level || 0 : 0;
    const state = k => {
      if (k === "bigger" || k === "smaller") return level && (k === "bigger") === level > 0 ? `${Math.round(zoomFor(level) * 100)}%` : "";
      if (k === "reset") return "";
      return quickMod(k)?.enabled ? svg(I.check) : "";
    };
    // On/off tools are checkboxes in the menu; Bigger, Smaller and Turn off all are plain actions (they say their level).
    const ONOFF = new Set(["dark", "light", "noads", "focus"]);
    menu.innerHTML = `<header aria-hidden="true">${t("quick.title")}<small>${esc(where())}</small></header>` + ITEMS.map(it => it
      ? `<button ${ONOFF.has(it.k) ? `role="menuitemcheckbox" aria-checked="${!!quickMod(it.k)?.enabled}"` : `role="menuitem"`} tabindex="-1" data-k="${it.k}">${svg(I[it.k])}<span>${t(it.label)}</span><span class="gm-state">${state(it.k)}</span></button>`
      : quickMenuItems.map(g => g()).join("") + `<hr>`).join("") + quickMenuGroups.map(g => g()).join(""); // hook: 65-a11y.js
    for (const b of menu.querySelectorAll("button")) b.tabIndex = -1; // one Tab stop: the menu's arrows do the rest
    const first = menu.querySelector("[role^=menuitem]");
    if (first) first.tabIndex = 0; // (a menu that scrolls on a small screen still has a way in)
  }
  function open() {
    render();
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus({ preventScroll: true });
  }
  function close(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (refocus) moreBtn.focus({ preventScroll: true });
  }
  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  menu.addEventListener("click", e => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    close();
    act(b.dataset.k).catch(err => toast(plainError(err))).finally(() => GodCapture.refresh());
  });
  // Escape, Tab, arrows, Home/End and type-ahead while the menu is open (registered before 95-keys.js).
  listen("keydown", e => {
    if (!e.isTrusted || menu.hidden) return;
    if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); close(true); return; }
    if (!menu.contains(root.activeElement)) return;
    if (menuKeys(e, menu)) e.stopImmediatePropagation();
  }, true);
  // A press anywhere else closes it. Outside Morse the window hears it; inside,
  // the shadow root does: seen from the window, a closed shadow root (every
  // page but the tests') hides the menu from composedPath, so a press on a
  // menu item would close the menu before its click.
  listen("pointerdown", e => { if (!menu.hidden && !e.composedPath().includes(hostEl)) close(); }, true);
  root.addEventListener("pointerdown", e => {
    if (!menu.hidden && !e.composedPath().some(n => n === menu || n === btn)) close();
  }, true);
  new MutationObserver(() => { if (bar.hidden) close(); }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });

  async function create(edits) {
    const { css, js } = compileEdits(edits);
    const title = titleFor(edits[0]);
    const mod = await call("mods.save", { draft: { id: uid(), title, prompt: t("quick.prompt", { title }), css, js, url: location.href, app: S.app, kind: "quick", edits } });
    S.mods.push(mod);
    await applyMod(mod);
    return mod;
  }
  async function drop(m) {
    await removeMod(m.id);
    await call("mods.delete", { modId: m.id });
    S.mods = S.mods.filter(x => x.id !== m.id);
  }

  async function act(k) {
    if (k === "reset") return reset();
    if (k === "bigger" || k === "smaller") return zoom(k === "bigger" ? 1 : -1);
    const title = t("quick." + k), existing = quickMod(k);
    if (existing?.enabled) { await drop(existing); return toast(t("quick.toolOff", { title })); }
    if (k === "dark" && !quickMod("light")?.enabled && pageIsDark()) return toast(t("quick.alreadyDark"));
    if (k === "light" && !quickMod("dark")?.enabled && !pageIsDark()) return toast(t("quick.alreadyLight"));
    if (existing) await drop(existing);
    if (k === "dark" || k === "light") { const other = quickMod(k === "dark" ? "light" : "dark"); if (other) await drop(other); }
    const edit = { op: "page", kind: k };
    if (k === "focus") {
      const main = mainContent();
      if (!main) return toast(t("quick.noMain"));
      Object.assign(edit, GodMode.targetOf(main), { label: describe(main) });
    }
    await create([edit]);
    toast(t("quick.toolOn", { title, where: where() }));
  }
  async function zoom(d) {
    const m = quickMod("zoom");
    const level = Math.max(-6, Math.min(8, (m?.enabled ? m.edits[0].level || 0 : 0) + d));
    if (!level) { if (m) await drop(m); return toast(t("quick.zoomReset")); }
    const edits = [{ op: "page", kind: "zoom", level }];
    if (!m) await create(edits);
    else {
      const { css, js } = compileEdits(edits), title = titleFor(edits[0]);
      const next = await call("mods.save", { mod: { ...m, title, prompt: t("quick.prompt", { title }), css, js, edits, enabled: true, updated: new Date().toISOString() } });
      S.mods = S.mods.map(x => (x.id === next.id ? next : x));
      await applyMod(next);
    }
    toast(t("quick.zoom", { pct: Math.round(zoomFor(level) * 100) }));
  }
  async function reset() {
    const s = GodMode.resetSession();
    if (s.id) await removeMod(s.id);
    const on = S.mods.filter(m => m.enabled && m.kind !== "style"); // your-style hook: "Not on this site" is in the Mods panel
    if (!on.length && !s.history.length) return toast(t("quick.nothing"));
    for (const m of on) {
      m.enabled = false;
      await call("mods.save", { mod: m });
      await removeMod(m.id);
    }
    toast(t("quick.resetDone", { n: on.length }));
  }

  // The smallest landmark holding most of the page's text, else the block
  // with the most paragraph text.
  function mainContent() {
    const ok = el => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 100 && !el.closest("[data-morse-ui]"); };
    const len = el => (el.innerText || "").length;
    const marks = [...document.querySelectorAll("article, main, [role=main]")].filter(ok).sort((a, b) => len(b) - len(a));
    if (marks.length) {
      let best = marks[0];
      for (const c of marks) if (c !== best && best.contains(c) && len(c) > len(best) * 0.6) best = c;
      return best;
    }
    const score = new Map();
    for (const p of document.querySelectorAll("p, h1, h2, h3, li")) {
      const t = len(p);
      for (let n = p.parentElement, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) score.set(n, (score.get(n) || 0) + t / (i + 1));
    }
    let best = null, top = 0;
    for (const [n, s] of score) if (s > top && ok(n)) { best = n; top = s; }
    return best;
  }

  return { open, close, act };
})();
