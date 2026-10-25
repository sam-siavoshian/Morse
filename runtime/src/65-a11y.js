// Easier to use: accessibility for any app, no model needed for the basics.
//   - The "Easier to use" group in the page tools menu: eight page tools
//     (core/a11y.js writes their code), each a quick mod saved per site and
//     turned off by clicking it again, plus Read aloud (66-read-aloud.js) and
//     Check this page (67-audit.js).
//   - The "Accessibility fixes" mod that Check this page and Describe this
//     image (68-describe.js) save into: one per site, every fix undoable.
//   - Read aloud and Describe on the edit toolbar, for what you point at.
// Hooks: 46-quick.js (quickMenuGroups), 10-dom.js (A11Y_CSS in 98-a11y-css.js).

const A11y = (() => {
  const svg = (d, n = 16) => `<svg viewBox="0 0 16 16" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    contrast: '<circle cx="8" cy="8" r="5.75"/><path d="M8 2.25v11.5A5.75 5.75 0 0 0 8 2.25z" fill="currentColor"/>',
    targets: '<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/><path d="M2.25 5.5h1.5M12.25 10.5h1.5"/>',
    readable: '<path d="M2 12.75 5.25 3.5l3.25 9.25M3.15 9.75h4.2M10 7.5h4M10 10h4M10 12.5h2.5"/>',
    underline: '<path d="M4.5 2.5v4.25a3.5 3.5 0 0 0 7 0V2.5M3 13.75h10"/>',
    still: '<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2"/><path d="M6.25 5.5v5M9.75 5.5v5"/>',
    outline: '<rect x="4.25" y="5.25" width="7.5" height="5.5" rx="1"/><rect x="2" y="3" width="12" height="10" rx="2.5" stroke-dasharray="2 1.6"/>',
    ruler: '<path d="M1.75 5.25h12.5M1.75 10.75h12.5"/><path d="M1.75 2.5h12.5M1.75 13.5h12.5" opacity=".35"/>',
    calm: '<path d="M2.75 8s2-4.25 5.25-4.25S13.25 8 13.25 8 11.25 12.25 8 12.25 2.75 8 2.75 8z"/><circle cx="8" cy="8" r="1.75"/><path d="M2.5 13.5l11-11"/>',
    read: '<path d="M2.75 6.25h2l3-2.5v8.5l-3-2.5h-2z"/><path d="M10.25 6a2.75 2.75 0 0 1 0 4M12 4.25a5.25 5.25 0 0 1 0 7.5"/>',
    check: '<path d="M5.75 3.25h6.5M5.75 8h6.5M5.75 12.75h6.5"/><path d="M1.75 3.25l.9.9 1.6-1.8M1.75 8l.9.9 1.6-1.8M1.75 12.75l.9.9 1.6-1.8"/>',
    describe: '<rect x="2.25" y="3" width="11.5" height="10" rx="1.75"/><circle cx="6" cy="6.5" r="1.1"/><path d="M2.5 11.25 6 8.5l2.5 2 1.75-1.25 3.25 2.25"/>',
    on: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>',
    person: '<circle cx="8" cy="3.25" r="1.25"/><path d="M3 5.75l5 1 5-1M8 6.75v3.25M8 10l-2.25 3.75M8 10l2.25 3.75"/>',
  };
  const where = () => S.appName || location.host || t("panel.thisPage");

  // Saved per site as quick mods: { kind: "quick", edits: [{ op: "a11y", kind, ...opts }] }.
  const modFor = k => S.mods.find(m => m.kind === "quick" && m.edits?.[0]?.op === "a11y" && m.edits[0].kind === k);
  const isOn = k => !!modFor(k)?.enabled;

  // ---- the menu group (46-quick.js rebuilds the menu each time it opens).
  // simplify: it opens from one "Easier to use" item in the page tools, so
  // the menu shows 9 things instead of 19 (docs/dev/simplify.md).
  const onCount = () => [...A11Y_KINDS, "fixes"].filter(isOn).length;
  quickMenuItems.push(() => {
    const n = onCount();
    return `<button role="menuitem" tabindex="-1" data-a11y="more" aria-haspopup="menu" aria-expanded="false" aria-controls="m-a11y-group">${svg(I.person)}<span>${t("a11y.title")}</span><span class="gm-state">${n ? svg(I.on) : ""}<span class="a11y-chev" aria-hidden="true">›</span></span></button>`;
  });
  quickMenuGroups.push(() => {
    const r = modFor("readable");
    const item = (k, label, on, cls = "") => `<button role="menuitemcheckbox" tabindex="-1" class="${cls}" data-a11y="${k}" aria-checked="${on}">${cls ? "" : svg(I[k])}<span>${label}</span><span class="gm-state">${on ? svg(I.on) : ""}</span></button>`;
    return `<div class="a11y-group menu" id="m-a11y-group" role="group" aria-label="${esc(t("a11y.title"))}" hidden>
      <header aria-hidden="true">${t("a11y.title")}<small>${t("a11y.noModel")}</small></header>
      ${A11Y_KINDS.map(k => item(k, t(`a11y.${k}`), isOn(k)) + (k === "readable" ? item("dyslexia", t("a11y.dyslexia"), !!(r?.enabled && r.edits[0].dyslexia), "a11y-sub") : "")).join("")}
      <hr>
      <button role="menuitem" tabindex="-1" data-a11y="read">${svg(I.read)}<span>${t("a11y.read")}</span><span class="gm-state">${ReadAloud.hasSelection() ? t("a11y.selection") : ""}</span></button>
      <button role="menuitem" tabindex="-1" data-a11y="check">${svg(I.check)}<span>${t("a11y.check")}</span><span class="gm-state"></span></button>
    </div>`;
  });
  const menu = bar.querySelector(".gm-menu");
  function showGroup(on) {
    const g = menu?.querySelector(".a11y-group"), b = menu?.querySelector("[data-a11y=more]");
    if (!g || !b) return;
    g.hidden = !on;
    b.setAttribute("aria-expanded", String(on));
    const to = on ? g.querySelector("[role^=menuitem]") : b;
    for (const x of menu.querySelectorAll("[role^=menuitem]")) x.tabIndex = x === to ? 0 : -1;
    to?.focus({ preventScroll: true });
  }
  // The arrow toward the group opens it from its item, the other one goes back (any app's submenu).
  menu?.addEventListener("keydown", e => {
    const rtl = getComputedStyle(menu).direction === "rtl";
    const into = rtl ? "ArrowLeft" : "ArrowRight", back = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === into && e.target.closest?.("[data-a11y=more]")) { e.preventDefault(); e.stopPropagation(); showGroup(true); }
    else if (e.key === back && e.target.closest?.(".a11y-group")) { e.preventDefault(); e.stopPropagation(); showGroup(false); }
  });
  menu?.addEventListener("click", e => {
    const b = e.target.closest("button[data-a11y]");
    if (!b) return;
    if (b.dataset.a11y === "more") return showGroup(b.getAttribute("aria-expanded") !== "true");
    GodQuick.close();
    act(b.dataset.a11y).catch(err => toast(err.message));
  });

  async function act(k) {
    if (k === "read") return ReadAloud.fromPage();
    if (k === "check") return Audit.run();
    if (k === "dyslexia") {
      const r = modFor("readable"), on = !!(r?.enabled && r.edits[0].dyslexia);
      await set("readable", on ? {} : { dyslexia: true });
      return toast(on ? t("quick.toolOff", { title: t("a11y.dyslexia") }) : t("quick.toolOn", { title: t("a11y.dyslexia"), where: where() }));
    }
    if (!A11Y_TOOLS[k]) return;
    if (isOn(k)) { await drop(modFor(k)); return toast(t("quick.toolOff", { title: t(`a11y.${k}`) })); }
    await set(k, {});
    toast(t("quick.toolOn", { title: t(`a11y.${k}`), where: where() }));
  }

  // Turns a tool on with these options (replacing any earlier copy of it).
  async function set(k, opts) {
    const old = modFor(k);
    if (old) await drop(old);
    const { css, js } = compileA11y(k, opts);
    const title = k === "readable" && opts?.dyslexia ? t("a11y.dyslexia") : t(`a11y.${k}`);
    const mod = await call("mods.save", { draft: { id: uid(), title, prompt: t("quick.prompt", { title }), css, js, url: location.href, app: S.app, kind: "quick", edits: [{ op: "a11y", kind: k, ...opts }] } });
    S.mods.push(mod);
    await applyMod(mod);
    return mod;
  }
  async function drop(m) {
    await removeMod(m.id);
    await call("mods.delete", { modId: m.id });
    S.mods = S.mods.filter(x => x.id !== m.id);
  }

  // ---- the "Accessibility fixes" mod: fixes merge into it, newest wins.
  async function addFixes(list) {
    const m = modFor("fixes");
    const fixes = mergeFixes(m?.edits?.[0]?.fixes || [], list);
    const { css, js } = compileFixes(fixes);
    const edits = [{ op: "a11y", kind: "fixes", fixes }];
    const prompt = `Accessibility fixes: ${summarizeFixes(fixes).toLowerCase()}`;
    let mod;
    if (m) {
      mod = await call("mods.save", { mod: { ...m, css, js, edits, prompt, enabled: true, updated: new Date().toISOString() } });
      S.mods = S.mods.map(x => (x.id === mod.id ? mod : x));
    } else {
      mod = await call("mods.save", { draft: { id: uid(), title: t("a11y.fixes"), prompt, css, js, url: location.href, app: S.app, kind: "quick", edits } });
      S.mods.push(mod);
    }
    await applyMod(mod);
    return mod;
  }

  // ---- Read aloud and Describe on the edit toolbar
  const tb = root.querySelector(".gm-tb");
  const sep = document.createElement("span");
  sep.className = "gm-sep a11y-tb";
  const tbBtn = (k, id) => {
    const b = document.createElement("button");
    b.className = "ibtn a11y-tb";
    b.dataset.a11yTb = k;
    const words = () => { b.setAttribute("aria-label", t(id)); b.innerHTML = svg(I[k]) + GodMode.tip(t(id), ""); };
    words();
    langSubs.add(words);
    return b;
  };
  const readBtn = tbBtn("read", "a11y.read"), descBtn = tbBtn("describe", "a11y.describe");
  if (tb) {
    const seps = tb.querySelectorAll(".gm-sep");
    tb.insertBefore(sep, seps[seps.length - 1] || null);
    sep.after(readBtn, descBtn);
    const refresh = () => {
      const el = GodMode.selected;
      readBtn.hidden = !el || !ReadAloud.readable(el);
      descBtn.hidden = !el || !DescribeImage.imageOf(el);
      sep.hidden = readBtn.hidden && descBtn.hidden;
    };
    new MutationObserver(refresh).observe(tb.querySelector(".gm-tag"), { childList: true, characterData: true, subtree: true });
    new MutationObserver(refresh).observe(tb.closest(".gm"), { attributes: true, attributeFilter: ["hidden"] });
    refresh();
    readBtn.addEventListener("click", () => ReadAloud.start(GodMode.selected));
    descBtn.addEventListener("click", () => DescribeImage.start(GodMode.selected));
  }

  return { act, set, drop, addFixes, isOn, modFor, icon: k => svg(I[k]), svg };
})();
