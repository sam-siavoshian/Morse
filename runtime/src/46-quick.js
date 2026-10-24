// Page tools: one-click changes from the bar's quick menu (dark mode, text
// size, hide ads, focus mode, reset). Each tool is a small "quick" mod whose
// code comes from core/edits.js, so it persists and shares like any mod.

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
    { k: "dark", label: "Dark mode" },
    { k: "light", label: "Light mode" },
    { k: "bigger", label: "Bigger text" },
    { k: "smaller", label: "Smaller text" },
    { k: "noads", label: "Hide ads and pop-ups" },
    { k: "focus", label: "Focus mode" },
    null,
    { k: "reset", label: "Turn off all mods here" },
  ];

  const btn = document.createElement("button");
  btn.className = "gm-qbtn ibtn";
  btn.setAttribute("aria-label", "Page tools");
  btn.setAttribute("aria-haspopup", "menu");
  btn.innerHTML = svg(I.tools) + GodMode.tip("Page tools", "");
  const row = bar.querySelector(".row");
  row.insertBefore(btn, row.querySelector(".go"));
  const menu = document.createElement("div");
  menu.className = "gm-menu menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  bar.append(menu);

  const quickMod = k => S.mods.find(m => m.kind === "quick" && m.edits?.[0]?.kind === k);
  const where = () => S.appName || location.host || "this page";
  const titleFor = e => e.kind === "zoom" ? `Text size ${Math.round(zoomFor(e.level) * 100)}%` : PAGE_TOOLS[e.kind].title;

  function render() {
    const z = quickMod("zoom");
    const level = z?.enabled ? z.edits[0].level || 0 : 0;
    const state = k => {
      if (k === "bigger" || k === "smaller") return level && (k === "bigger") === level > 0 ? `${Math.round(zoomFor(level) * 100)}%` : "";
      if (k === "reset") return "";
      return quickMod(k)?.enabled ? svg(I.check) : "";
    };
    menu.innerHTML = `<header>Page tools<small>${esc(where())}</small></header>` + ITEMS.map(it => it
      ? `<button role="menuitem" data-k="${it.k}" aria-checked="${!!quickMod(it.k)?.enabled}">${svg(I[it.k])}<span>${it.label}</span><span class="gm-state">${state(it.k)}</span></button>`
      : `<hr>`).join("");
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
    if (refocus) btn.focus({ preventScroll: true });
  }
  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  menu.addEventListener("click", e => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    close();
    act(b.dataset.k).catch(err => toast(plainError(err))).finally(() => GodCapture.refresh());
  });
  // Escape and arrows while the menu is open (registered before 95-keys.js).
  listen("keydown", e => {
    if (!e.isTrusted || menu.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(true); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      const items = [...menu.querySelectorAll("button")], i = items.indexOf(root.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }, true);
  listen("pointerdown", e => {
    if (!menu.hidden && !e.composedPath().some(n => n === menu || n === btn)) close();
  }, true);
  new MutationObserver(() => { if (bar.hidden) close(); }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });

  async function create(edits) {
    const { css, js } = compileEdits(edits);
    const title = titleFor(edits[0]);
    const mod = await call("mods.save", { draft: { id: uid(), title, prompt: `Page tool: ${title}`, css, js, url: location.href, app: S.app, kind: "quick", edits } });
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
    const title = PAGE_TOOLS[k].title, existing = quickMod(k);
    if (existing?.enabled) { await drop(existing); return toast(`${title} off`); }
    if (k === "dark" && !quickMod("light")?.enabled && pageIsDark()) return toast("This page is already dark");
    if (k === "light" && !quickMod("dark")?.enabled && !pageIsDark()) return toast("This page is already light");
    if (existing) await drop(existing);
    if (k === "dark" || k === "light") { const other = quickMod(k === "dark" ? "light" : "dark"); if (other) await drop(other); }
    const edit = { op: "page", kind: k };
    if (k === "focus") {
      const main = mainContent();
      if (!main) return toast("Couldn't find the main part of this page. Point at it and describe the change instead.");
      Object.assign(edit, GodMode.targetOf(main), { label: describe(main) });
    }
    await create([edit]);
    toast(`${title} on for ${where()}`);
  }
  async function zoom(d) {
    const m = quickMod("zoom");
    const level = Math.max(-6, Math.min(8, (m?.enabled ? m.edits[0].level || 0 : 0) + d));
    if (!level) { if (m) await drop(m); return toast("Text size back to 100%"); }
    const edits = [{ op: "page", kind: "zoom", level }];
    if (!m) await create(edits);
    else {
      const { css, js } = compileEdits(edits), title = titleFor(edits[0]);
      const next = await call("mods.save", { mod: { ...m, title, prompt: `Page tool: ${title}`, css, js, edits, enabled: true, updated: new Date().toISOString() } });
      S.mods = S.mods.map(x => (x.id === next.id ? next : x));
      await applyMod(next);
    }
    toast(`Text size ${Math.round(zoomFor(level) * 100)}%`);
  }
  async function reset() {
    const s = GodMode.resetSession();
    if (s.id) await removeMod(s.id);
    const on = S.mods.filter(m => m.enabled);
    if (!on.length && !s.history.length) return toast("Nothing to reset here");
    for (const m of on) {
      m.enabled = false;
      await call("mods.save", { mod: m });
      await removeMod(m.id);
    }
    toast(`Turned off ${on.length} mod${on.length === 1 ? "" : "s"} here. Turn them back on in Mods.`);
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
