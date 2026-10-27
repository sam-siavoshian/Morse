// Your style, everywhere: one style that follows the person to every site and
// app (core/style.js has the words and the rules, core/style-host.js the code
// and the requests). The host puts it first in every page's mod list, so
// 30-mods.js (or a lean boot) puts it on the page like any mod: CSS at boot, no
// model call, and the off switch, pause and Safe start hold it back too. This
// file is the UI:
//   - the bar: "…everywhere" / "on every site" makes it or adds to it, shown
//     live with Save and Undo; "not on this site" leaves this site out
//   - the Mods panel: "Your style" at the top, with its switch, Change, Not on
//     this site (or Use on this site) and Fit to this site
//   - Settings: Your style, block by block, and the sites and apps it skips
//   - fitting it to a site with the model, only when the person turned that
//     on: once per site, on the first visit, shown in the bar for review; the
//     saved fix is a mod for that site (parent: STYLE_ID)
//
// Hooks (one marked line each): 50-bar.js send (fromBar), 56-settings.js
// paintSettings (settingsHtml) and focusKeyOf, 60-generate.js keep (d.style),
// 70-panel.js renderList (rowHtml), 97-boot.js (ready), 10-dom.js (STYLE_CSS),
// 46-quick.js reset and 71-heal.js checkable (the style is skipped).

const YourStyle = (() => {
  let info = null, infoAt = 0;  // the last style.get reply
  let preview = null;           // the bar, while a style change shows and isn't saved: { words, r, adapt }
  let fitting = false;
  // Words are message ids (core/locales/en.js): "ys.<block>" and "ys.<block>.help".
  const SIZES = () => [[-2, t("ys.smaller")], [0, t("ys.asIs")], [2, t("ys.bigger")], [4, t("ys.biggest")]];
  const SPACINGS = () => [["", t("ys.asIs")], ["roomy", t("ys.more")], ["roomier", t("ys.most")]];
  const SWITCHES = ["soft", "redgreen", "dark", "lessMotion", "noAutoplay", "underline"];

  const whereName = () => S.appName || location.host || t("panel.thisPage");
  // Where a saved style shows (core/style-host.js reach): Chrome and the apps
  // share it only when Chrome is paired with the Morse helper.
  const reachWords = r => (r?.reach === "web" ? t("ys.everySiteWeb") : r?.reach === "apps" ? t("ys.everyAppHere") : t("ys.everySiteApp"));
  const savedWords = r => (r?.reach === "web" ? t("ys.savedWeb") : r?.reach === "apps" ? t("ys.savedApps") : t("ys.saved"));
  const entry = () => S.mods.find(m => m.kind === "style") || null;
  const plainList = a => (a.length > 1 ? t("ys.list", { first: a.slice(0, -1).join(", "), last: a.at(-1) }) : a[0] || "");
  function ask(type, payload = {}, ms = 8000) {
    return Promise.race([
      call(type, { url: location.href, app: S.app, ...payload }),
      new Promise((_, no) => setTimeout(() => no(new Error(t("ys.noAnswer"))), ms)),
    ]);
  }
  async function refresh() {
    try { info = await ask("style.get"); } catch {}
    infoAt = Date.now();
    return info;
  }
  // After any change: the page gets the new style, then the panel and Settings redraw.
  async function changed(r) {
    if (r && "style" in r) { info = r; infoAt = Date.now(); }
    await syncMods().catch(() => {});
    applyTheme(); // the overlay undoes the style's color filter (overlayUnfilter)
    if (!panel.hidden) renderPanel();
    if (paneKind === "settings") renderSettings();
  }

  // Puts style code on the page under the style's id (the old code is undone first).
  async function show(e) {
    setCss(STYLE_ID, e?.css || "");
    if (e?.js?.trim()) await call("exec", { modId: STYLE_ID, js: e.js }).catch(() => {});
    else await call("off", { modId: STYLE_ID }).catch(() => {});
  }
  // Back to what is saved (or nothing), as the page would show it.
  async function restore() {
    const e = entry();
    if (e && e.enabled && !modHeld(e)) await show(e);
    else await show(null);
  }

  // ---- the bar

  // From 50-bar.js send(): true when this is about Your style.
  function fromBar(text) {
    if (isNotHere(text)) {
      if (!entry()) return false;
      leaveOut().catch(e => toast(plainError(e)));
      return true;
    }
    // Naming this app or site ("make VS Code…, black text everywhere") keeps it a change here.
    if (!isEverywhere(text, { here: [S.appName, location.hostname.replace(/^www\./, "").split(".")[0]] })) return false;
    const p = parseStyleWords(text);
    // Pointing at something and asking for something no block covers: a change
    // for this page, as usual.
    if (S.target && !Object.keys(p.blocks).length && !p.except.length) return false;
    make(text).catch(e => toast(plainError(e)));
    return true;
  }

  async function make(words) {
    S.phase = "style-wait"; // "style" once it shows, with Save and Undo
    input.disabled = true;
    bar.classList.remove("done", "err");
    bar.classList.add("working");
    hint.textContent = t("ys.making");
    actions.innerHTML = "";
    let r;
    try { r = await ask("style.preview", { words }); }
    catch (e) {
      bar.classList.remove("working");
      if (bar.hidden) return;
      bar.classList.add("err");
      S.phase = "error";
      input.disabled = false;
      hint.innerHTML = t("result.failed", { detail: esc(plainError(e).slice(0, 120)) });
      actions.innerHTML = `<button data-a="again">${t("result.again")}</button>`;
      return;
    }
    bar.classList.remove("working");
    if (bar.hidden || S.phase !== "style-wait") return restore(); // closed meanwhile: nothing changes
    const nothingElse = !Object.keys(r.parsed.blocks).length && !r.parsed.except.length;
    // Something only the model can do: ask for it per site (they can switch it off here).
    const adapt = r.style.adapt || (!!r.parsed.extra && nothingElse);
    preview = { words, r, adapt };
    if (r.entry) await show(r.entry);
    showPreview();
  }

  function sheetHtml() {
    const { r, adapt } = preview;
    const p = r.parsed;
    const notes = [];
    if (p.notes.includes("font")) notes.push(`<p class="ys-note">${t("ys.whichFont")}</p>`);
    if (p.except.length) notes.push(`<p class="ys-note">${esc(t("ys.notOn", { list: plainList(p.except.map(exceptionName)) }))}</p>`);
    return `<div class="sheet ys-sheet" role="group" aria-label="${esc(t("ys.title"))}">
      <header><b>${t("ys.title")}</b><span class="dim">${reachWords(r)}</span></header>
      ${r.summary.length ? `<div class="tags ys-tags">${r.summary.map(t => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
      ${notes.join("")}
      ${p.extra || r.style.extra ? `<div class="srow"><div class="lbl"><span>${t("ys.adapt")}</span><small>${t("ys.adaptFor", { extra: esc(r.style.extra.slice(0, 90)) })}</small></div>
        <div class="ctl"><label class="sw"><input type="checkbox" data-ys="adapt-new" ${adapt ? "checked" : ""} aria-label="${esc(t("ys.adapt"))}"><span></span></label></div></div>` : ""}
    </div>`;
  }
  function showPreview() {
    S.phase = "style";
    bar.classList.add("done");
    input.disabled = false;
    setInput("");
    input.placeholder = t("ys.addMore");
    const n = preview.r.summary.length;
    hint.innerHTML = `<b class="ok">${t("ys.title")}</b>${n ? ` <span class="dim">${t("ys.changes", { n })}</span>` : ""}`; // where it shows: the sheet's header says it (reachWords)
    actions.innerHTML = `<button data-a="ys-save" class="primary">${t("btn.save")} <kbd>↵</kbd></button><button data-a="ys-undo">${t("btn.undo")}</button>`;
    showPane("");
    paneKind = "ys";
    pane.dataset.kind = "ys";
    pane.hidden = false;
    bar.classList.add("has-pane");
    pane.innerHTML = sheetHtml();
    input.focus({ preventScroll: true });
  }
  async function save() {
    const p = preview;
    if (!p) return;
    preview = null;
    const r = await ask("style.save", { add: p.words, adapt: p.adapt }).catch(e => { toast(plainError(e)); return null; });
    S.phase = "idle";
    input.placeholder = PLACEHOLDER();
    closeBar();
    if (!r) return restore();
    await changed(r);
    toast(r.here?.excepted ? t("ys.savedOff", { where: whereName() }) : savedWords(r));
    if (r.style?.adapt) ready(800);
  }
  async function undoPreview() {
    if (!preview) return;
    preview = null;
    S.phase = "idle";
    input.placeholder = PLACEHOLDER();
    closeBar();
    await restore();
    toast(t("toast.undone"));
  }
  async function addMore(text) {
    const words = `${preview.words}, ${text}`;
    preview = null;
    showPane("");
    await make(words);
  }
  actions.addEventListener("click", e => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "ys-save") save();
    if (a === "ys-undo") undoPreview();
  });
  input.addEventListener("keydown", e => {
    if (S.phase !== "style" || !preview || e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const v = input.value.trim();
      v ? addMore(v) : save();
    }
  });
  goBtn.addEventListener("click", () => {
    if (S.phase !== "style" || !preview) return;
    const v = input.value.trim();
    v ? addMore(v) : save();
  });
  pane.addEventListener("change", e => { if (e.target.dataset?.ys === "adapt-new" && preview) preview.adapt = e.target.checked; });
  // Closing the bar keeps what it shows, like any change (Undo is the way out).
  new MutationObserver(() => { if (bar.hidden && preview) save(); }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });

  // ---- this site: leave it out, or use the style here again

  async function leaveOut() {
    const r = await ask("style.except", { on: true });
    if (S.open && S.phase === "idle") closeBar();
    await changed(r);
    controlToast(t("ys.offOn", { where: whereName() }), [[t("btn.undo"), useHere]]);
  }
  async function useHere() {
    const r = await ask("style.except", { on: false });
    await changed(r);
    controlToast(t("ys.backOn", { where: whereName() }));
  }
  async function setOn(on) {
    const r = await ask("style.save", { patch: { enabled: on } });
    await changed(r);
    controlToast(on ? t("ys.onAll") : t("ys.offAll"), on ? [] : [[t("btn.undo"), () => setOn(true)]]);
  }

  // ---- fitting it to this site (the model; only when turned on)

  async function fit() {
    const e = entry();
    if (!e || !e.enabled || fitting || S.phase === "working" || (S.open && S.phase !== "idle")) return;
    fitting = true;
    try {
      await ask("style.tried").catch(() => {});
      const style = (await refresh())?.style || { words: e.prompt, extra: e.extra };
      panel.hidden = true;
      if (!S.open) openBar();
      showPane("");
      const run = submit(adaptRequest(style, e.css, fitFacts()));
      // The fix is saved as a mod for this site that belongs to the style (60-generate.js keep).
      if (S.draft) S.draft.style = { parent: STYLE_ID, title: t("ys.forSite", { where: whereName() }), prompt: t("ys.fitPrompt") };
      await run;
      const meta = S.phase === "result" && hint.querySelector(".dim");
      // (a title that already says "Your style for …" needs no second "Your style")
      if (meta && !/^Your style\b/.test(S.draft?.title || "")) meta.textContent = [t("ys.title"), meta.textContent].filter(Boolean).join(" · ");
      if (S.phase === "error") {
        const fine = S.draft?.title === FIT_TITLE;
        S.phase = "idle";
        bar.classList.remove("err");
        closeBar();
        toast(fine ? t("ys.fits", { where: whereName() }) : t("ys.fitFailed", { where: whereName() }));
      }
    } finally { fitting = false; }
  }
  // What the style visibly broke here, measured, for the model: big parts of
  // the page that now end past the window's edges where nobody can scroll to them.
  function fitFacts() {
    const out = [], vw = innerWidth, vh = innerHeight;
    const scrolls = el => /auto|scroll/.test(getComputedStyle(el).overflowY);
    const pageScrolls = document.documentElement.scrollHeight > vh + 2 && getComputedStyle(document.documentElement).overflowY !== "hidden" && getComputedStyle(document.body).overflowY !== "hidden";
    const seen = new Set();
    for (const el of document.querySelectorAll("body > *, body > * > *, header, footer, nav, aside, main, [role=banner], [role=contentinfo], [role=navigation]")) {
      if (out.length >= 6 || seen.has(el) || el.closest("[data-morse-ui]")) continue;
      seen.add(el);
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width * r.height < 2000 || cs.visibility === "hidden") continue;
      const pinned = cs.position === "fixed" || cs.position === "sticky";
      let inScroller = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (scrolls(p)) { inScroller = true; break; }
      const sel = selectorFor(el);
      if (r.bottom > vh + 4 && r.top < vh + 400 && (pinned || (!pageScrolls && !inScroller))) out.push(`\`${sel}\` ends at ${Math.round(r.bottom)}px, below the bottom of the window (${vh}px), and can't be scrolled to`);
      else if (r.right > vw + 4 && r.left < vw && !inScroller) out.push(`\`${sel}\` ends at ${Math.round(r.right)}px, past the right edge of the window (${vw}px)`);
    }
    if (document.documentElement.scrollWidth > vw + 4) out.push(`the page is ${document.documentElement.scrollWidth}px wide, wider than the window (${vw}px)`);
    return out;
  }

  // After boot (97-boot.js), and after saving: on a site the style hasn't been
  // fitted to yet, once the page has settled and nothing else is open.
  function ready(wait = 2500) {
    const e = entry();
    if (!e || !e.enabled || !e.adapt || e.fitted || S.mods.some(isStyleChild) || window.top !== window || modHeld(e)) return;
    const go = () => { if (live() && !S.open && panel.hidden && modal.hidden && !entry()?.fitted) fit(); };
    setTimeout(() => (typeof requestIdleCallback === "function" ? requestIdleCallback(go, { timeout: 3000 }) : go()), wait);
  }

  // ---- the Mods panel: "Your style" at the top

  function rowHtml() {
    const e = entry();
    if (!e) return "";
    const fitted = S.mods.some(m => isStyleChild(m) && m.enabled);
    const but = (e.except || []).map(exceptionName);
    const state = !e.on ? t("ys.state.off") : e.excepted ? t("ys.state.offOn", { where: whereName() }) : modHeld(e) ? t("ys.state.notRunning")
      : but.length ? t("ys.state.onExcept", { list: plainList(but.slice(0, 3)), more: but.length > 3 ? t("ys.andMore", { n: but.length - 3 }) : "" }) : t("ys.state.on");
    const label = t("ys.rowLabel", { state });
    return `<section class="ys-row${e.enabled ? "" : " off"}" aria-label="${esc(label)}">
      <label class="sw" title="${esc(e.on ? t("ys.turnOffAll") : t("ys.turnOnAll"))}"><input type="checkbox" data-y="on" aria-label="${esc(t("ys.onEverySite"))}" ${e.on ? "checked" : ""}><span></span></label>
      <div class="meta"><b>${t("ys.title")}</b><small>“${esc(e.prompt)}”</small>
        <div class="tags">${e.summary.map(s => `<span>${esc(s)}</span>`).join("")}${fitted ? `<span>${t("ys.fitted")}</span>` : ""}<em class="when">${esc(state)}</em></div>
      </div>
      <div class="btns"><button data-y="change">${t("btn.change")}</button>${e.excepted ? `<button data-y="use-here">${t("ys.useHere")}</button>`
        : e.on ? `<button data-y="not-here">${t("ys.notHere")}</button>` : ""}${e.enabled && !fitted ? `<button data-y="fit" title="${esc(t("ys.fitTitle"))}">${t("ys.fit")}</button>` : ""}</div>
    </section>`;
  }
  panel.addEventListener("click", e => {
    const b = e.target.closest("[data-y]");
    if (!b || b.dataset.y === "on") return;
    const y = b.dataset.y;
    if (y === "change") openSettings();
    if (y === "not-here") leaveOut().catch(err => toast(plainError(err)));
    if (y === "use-here") useHere().catch(err => toast(plainError(err)));
    if (y === "fit") fit();
  });
  panel.addEventListener("change", e => {
    if (e.target.dataset?.y === "on") setOn(e.target.checked).catch(err => toast(plainError(err)));
  });

  // ---- Settings: Your style

  function openSettings() {
    panel.hidden = true;
    if (!S.open) openBar();
    settingsMore = true;
    if (paneKind !== "settings") showPane("settings");
    refresh().then(() => {
      renderSettings();
      const sec = pane.querySelector("[data-ys-sec]");
      if (sec?.closest("details")) sec.closest("details").open = true;
      sec?.scrollIntoView({ block: "start" });
      sec?.querySelector("input, button")?.focus({ preventScroll: true });
    });
  }
  const sw = (k, on, label) => `<label class="sw"><input type="checkbox" data-ys="${k}" ${on ? "checked" : ""} aria-label="${esc(label)}"><span></span></label>`;
  const seg = (k, label, options, value) => `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${options.map(([v, words]) =>
    `<button type="button" role="radio" aria-checked="${v === value}" tabindex="${v === value ? 0 : -1}" data-ys="${k}:${v}">${esc(words)}</button>`).join("")}</div>`;

  function settingsHtml() {
    if (Date.now() - infoAt > 4000) { infoAt = Date.now(); refresh().then(() => { if (paneKind === "settings") renderSettings(); }); }
    const s = info?.style;
    if (!s) {
      return `<section data-ys-sec><h4>${t("ys.title")}</h4>
        <div class="srow"><div class="lbl"><span>${t("ys.title")}</span><small>${t("ys.intro")}</small></div>
          <div class="ctl"><button type="button" class="btn" data-ys="start">${t("ys.setUp")}</button></div></div></section>`;
    }
    const b = s.blocks;
    const hereKey = info.here?.key || "";
    return `<section data-ys-sec><h4>${t("ys.title")}</h4>
      <div class="srow"><div class="lbl"><span>${t("ys.title")}</span><small>${s.words ? `“${esc(s.words.slice(0, 140))}”` : t("ys.everySiteAppOn")}</small></div><div class="ctl">${sw("enabled", s.enabled, t("ys.onEverySite"))}</div></div>
      <div class="srow"><div class="lbl"><span>${t("ys.font")}</span><small>${t("ys.font.help")}</small></div>
        <div class="ctl"><input class="field ys-field" data-ys="font" value="${esc(b.font === "readable" ? t("ys.fontReadable") : b.font === "dyslexia" ? t("ys.fontDyslexia") : b.font)}" placeholder="${esc(t("ys.fontAsIs"))}" spellcheck="false" autocomplete="off" aria-label="${esc(t("ys.font"))}"></div></div>
      <div class="srow"><div class="lbl"><span>${t("gm.type")}</span></div><div class="ctl">${seg("size", t("gm.type"), SIZES(), b.size)}</div></div>
      <div class="srow"><div class="lbl"><span>${t("ys.spacing")}</span></div><div class="ctl">${seg("spacing", t("ys.spacing"), SPACINGS(), b.spacing)}</div></div>
      ${SWITCHES.map(k => `<div class="srow"><div class="lbl"><span>${esc(t(`ys.${k}`))}</span><small>${esc(t(`ys.${k}.help`))}</small></div><div class="ctl">${sw(k, b[k], t(`ys.${k}`))}</div></div>`).join("")}
      <div class="srow"><div class="lbl"><span>${t("ys.adapt")}</span><small>${s.extra ? `${t("ys.alsoDoes", { extra: esc(s.extra.slice(0, 80)) })} ` : ""}${t("ys.adapt.help")}</small></div><div class="ctl">${sw("adapt", s.adapt, t("ys.adapt"))}</div></div>
      <div class="srow ys-except"><div class="lbl"><span>${t("ys.except")}</span>
          <div class="ys-chips">${s.except.length ? s.except.map(x => `<span class="chip ys-chip"><span>${esc(exceptionName(x))}</span><button type="button" class="x" data-ys="rm:${esc(x)}" aria-label="${esc(t("ys.useAgainOn", { where: exceptionName(x) }))}" title="${esc(t("ys.useAgain"))}">×</button></span>`).join("") : `<small>${t("ys.noExcept")}</small>`}</div></div>
        <div class="ctl"><input class="field ys-field" data-ys="add-except" placeholder="${esc(t("ys.addExcept"))}" spellcheck="false" autocomplete="off" aria-label="${esc(t("ys.addExcept.label"))}">
          ${hereKey && !info.here.excepted ? `<button type="button" class="tbtn" data-ys="not-here">${t("ys.notHere")}</button>` : ""}</div></div>
      <div class="srow"><div class="lbl"><span>${t("ys.startOver")}</span><small>${t("ys.startOver.help")}</small></div><div class="ctl"><button type="button" class="tbtn" data-ys="delete">${t("ys.delete")}</button></div></div>
    </section>`;
  }

  async function patch(p, focusSel) {
    try {
      const r = await ask("style.save", { patch: p });
      await changed(r);
      flashSaved();
      if (focusSel) pane.querySelector(focusSel)?.focus({ preventScroll: true });
    } catch (e) { toast(plainError(e)); }
  }
  function fontValue(v) {
    const low = v.trim().toLowerCase();
    const is = id => [t(id), t(id, {}, "en")].some(w => w.toLowerCase() === low); // what the field showed, or the English
    return is("ys.fontReadable") ? "readable" : is("ys.fontDyslexia") ? "dyslexia" : v.trim();
  }
  pane.addEventListener("click", e => {
    const b = e.target.closest("button[data-ys]");
    if (!b) return;
    const [k, v] = b.dataset.ys.split(/:(.*)/s);
    if (k === "start") {
      closePane();
      input.placeholder = t("ys.startPlaceholder");
      note(t("ys.startHint"), 12000);
      input.focus();
    }
    if (k === "size") patch({ blocks: { size: Number(v) } }, `[data-ys="size:${v}"]`);
    if (k === "spacing") patch({ blocks: { spacing: v } }, `[data-ys="spacing:${v}"]`);
    if (k === "rm") ask("style.except", { on: false, key: v }).then(r => changed(r)).then(flashSaved, err => toast(plainError(err)));
    if (k === "not-here") ask("style.except", { on: true }).then(r => changed(r)).then(flashSaved, err => toast(plainError(err)));
    if (k === "delete") ask("style.save", { reset: true }).then(r => changed(r)).then(() => toast(t("ys.deleted")), err => toast(plainError(err)));
  });
  pane.addEventListener("change", e => {
    const k = e.target.dataset?.ys;
    if (!k || k === "adapt-new") return;
    if (k === "enabled" || k === "adapt") return patch({ [k]: e.target.checked }, `[data-ys="${k}"]`);
    if (k === "font") return patch({ blocks: { font: fontValue(e.target.value) } });
    if (k === "add-except") {
      const v = e.target.value.trim();
      if (v) ask("style.except", { on: true, key: v }).then(r => changed(r)).then(() => { flashSaved(); pane.querySelector('[data-ys="add-except"]')?.focus(); }, err => toast(plainError(err)));
      return;
    }
    if (SWITCHES.includes(k)) patch({ blocks: { [k]: e.target.checked } }, `[data-ys="${k}"]`);
  });
  // Enter in a field saves it; arrows move through a choice like radio buttons.
  pane.addEventListener("keydown", e => {
    const t = e.target;
    if (t.matches?.("input.ys-field") && e.key === "Enter") { e.preventDefault(); t.dispatchEvent(new Event("change", { bubbles: true })); return; }
    const b = t.closest?.(".seg [data-ys]");
    if (!b || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    e.preventDefault();
    const all = [...b.parentElement.children], i = all.indexOf(b);
    all[(i + (/Right|Down/.test(e.key) ? 1 : -1) + all.length) % all.length].click();
  });

  return { fromBar, rowHtml, settingsHtml, ready, fit, openSettings, leaveOut, useHere, info: () => info };
})();

// your-style hook (10-dom.js applyTheme): softer colors filter <html>. The
// overlay lives in the top layer (10-dom.js TopLayer), which a filter on <html>
// never reaches, so there it takes no filter at all and looks exactly as it
// does without the style. Only where there is no top layer (older desktop
// apps) does the page's filter reach it; there it takes the opposite filter.
// (Gray stays gray under the red and green filter, so the overlay needs
// nothing for it.)
function overlayUnfilter() {
  if (TopLayer.ok) return "none";
  const f = getComputedStyle(document.documentElement).filter;
  if (!f || f === "none" || /invert|hue-rotate|sepia|grayscale|blur|drop-shadow|opacity/.test(f)) return "none";
  const fns = [...f.matchAll(/\b(saturate|contrast|brightness)\(([\d.]+)\)/g)];
  return fns.length ? fns.reverse().map(([, fn, v]) => `${fn}(${(1 / Math.max(0.05, Number(v))).toFixed(4)})`).join(" ") : "none";
}
