// First run, inside the app. The first time the bar opens anywhere, a compact
// three-step coach sits at the top of it (point, describe, keep) until the
// first change is kept or the coach is hidden; then it never shows again.
// After that: a one-time tip for the first saved mod and for the first share,
// a notice when no model is connected or user scripts are off, plain words
// (and a button) for generation errors, and the Mods panel's empty state.
//
// Progress lives in the host (onboarding.get / onboarding.set):
// chrome.storage.local in the extension, ~/.morse/onboarding.json on the
// desktop. A host without that store shows none of it. The rules (state shape,
// error wording) are core/onboarding.js, inlined by runtime/bundle.js.
// Hooks into shared files, each marked "onboarding hook": 10-dom.js (CSS),
// 50-bar.js (Help in the menu), 70-panel.js (empty state), 96-shortcuts.js
// (Examples). The help pane itself is 59-help.js.

const Onboarding = (() => {
  let st = null;   // normalized progress; null until the host answers, and for good if it can't
  let status = {}; // what the host knows: { mode, model: { connected }, userScripts }
  let loadedAt = 0, shownStep = "", shownNote = "";
  let tipSaved = false, tipShare = false;
  const CHECK = `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>`;

  const coachEl = tBind(makeEl("div", { className: "ob-coach", hidden: true }, { role: "group" }), "aria-label", "ob.coach");
  const noteEl = makeEl("div", { className: "ob-note", hidden: true }, { role: "note" });
  bar.prepend(coachEl);
  statusRow.before(noteEl);

  async function load() {
    loadedAt = Date.now();
    try {
      const r = await call("onboarding.get", { url: location.href });
      if (r && typeof r === "object" && r.state) { st = normalizeOnboarding(r.state); status = r.status || {}; }
    } catch {}
    sync();
  }
  function save(patch) {
    if (!st) return;
    st = mergeOnboarding(st, patch);
    call("onboarding.set", { patch }).catch(() => {});
    sync();
  }

  // ---- the coach
  const STEPS = [["point", "welcome.step2.b"], ["describe", "welcome.step3.b"], ["keep", "btn.save"]];
  function step() {
    if (S.phase === "result") return ["keep", t("ob.keep")];
    if (S.phase === "working") return ["describe", t("ob.working")];
    if (S.phase === "error") { // first-run hook: say what to do about this error, not "try other words" for a missing model
      const why = explainError(hint.title || hint.textContent), raw = hint.title || hint.textContent;
      if (why?.action === "model" || why?.action === "setup" || /no model connected|sample answers/i.test(raw)) return ["describe", t("ob.needModel")];
      return ["describe", t("ob.failed")];
    }
    if (S.target || input.value.trim()) return ["describe", t("ob.describe")];
    return ["point", t("ob.point")];
  }
  const coachOn = () => !!st && st.coach !== "done" && S.open && !bar.hidden && !paneKind;
  function renderCoach() {
    const on = coachOn();
    coachEl.hidden = !on;
    if (!on) { shownStep = ""; return; }
    const [id, say] = step();
    if (shownStep === id + say) return;
    shownStep = id + say;
    const at = STEPS.findIndex(s => s[0] === id);
    const examples = id === "describe" && S.phase === "idle" ? ` <button type="button" class="ob-link" data-ob="help">${t("ob.examples")}</button>` : "";
    coachEl.innerHTML = `
      <ol class="ob-steps">${STEPS.map(([, label], i) => `<li class="${i < at ? "done" : i === at ? "now" : ""}"${i === at ? ` aria-current="step"` : ""}><span class="n">${i < at ? CHECK : i + 1}</span>${t(label)}</li>`).join("")}</ol>
      <button type="button" class="ob-hide" data-ob="skip">${t("ob.hideTips")}</button>
      <p class="ob-say">${say}${examples}</p>`;
  }

  // ---- one notice at a time under the input: no model, then user scripts off
  function noteNow() {
    if (!st || coachOn() || !S.open || bar.hidden || S.phase !== "idle" || paneKind) return null;
    if (modelMissing(status, S.label) && !st.dismissed.model && !status.sample) // the practice page's sample answers need no model
      return { id: "model", text: t("ob.noModel"), btn: t("welcome.model.b"), act: "model" };
    if (status.userScripts === false && !st.dismissed.userScripts)
      return { id: "userScripts", text: t("ob.scriptsOff"), btn: t("popup.turnItOn"), act: "userscripts" };
    return null;
  }
  function renderNote() {
    const n = noteNow();
    noteEl.hidden = !n;
    if ((n?.id || "") === shownNote) return;
    shownNote = n?.id || "";
    noteEl.innerHTML = n ? `<span class="ob-dot" aria-hidden="true"></span><span class="ob-text">${esc(n.text)}</span>
      <button type="button" data-ob="${n.act}">${esc(n.btn)}</button>
      <button type="button" class="ob-close" data-ob="dismiss" data-id="${n.id}" aria-label="${esc(t("ob.dontShow"))}" title="${esc(t("ob.dontShow"))}">×</button>` : "";
  }

  // ---- errors in plain words, with a button that does something about it
  const ACTION_LABEL = { userscripts: "help.userScripts", model: "ob.modelSettings", setup: "ob.copySetup" };
  function explainFailure() {
    if (S.phase !== "error" || hint.querySelector(".ob-why")) return;
    const why = explainError(hint.title || hint.textContent);
    if (!why) return;
    hint.innerHTML = t("result.failedNote", { detail: `<span class="ob-why">${esc(why.text)}</span>` });
    const label = ACTION_LABEL[why.action] && t(ACTION_LABEL[why.action]);
    if (label && !actions.querySelector("[data-ob]")) actions.insertAdjacentHTML("afterbegin", `<button type="button" data-ob="${why.action}">${esc(label)}</button>`);
  }

  // ---- progressive reveal (first-run hook). Until the first change is saved
  // (or tips are hidden), the bar shows the basics: describe, point, talk,
  // Mods. Page tools, the Edit tools that pop up on what you point at,
  // "Mods for this site" and Show me once come after; Ctrl+E (in the hint) and Help bring them
  // sooner. Only CSS: :host([data-new]) in 98-onboarding-css.js.
  let seenAll = false;
  const isNew = () => !!st && st.coach !== "done" && !st.tips.saved && !seenAll;
  function applyReveal() {
    if (paneKind === "help") seenAll = true; // asked for everything
    if (hostEl.hasAttribute("data-new") !== isNew()) hostEl.toggleAttribute("data-new", isNew());
  }

  function sync() {
    renderCoach();
    renderNote();
    explainFailure();
    applyReveal();
  }

  // ---- actions behind every button above
  async function copyCommand(cmd) {
    let copied = false;
    try { await navigator.clipboard.writeText(cmd); copied = true; } catch {}
    showTip(copied ? t("ob.copied", { cmd }) : t("ob.run", { cmd }), 7000);
  }
  async function act(what, btn) {
    if (what === "skip") return save({ coach: "done" });
    if (what === "dismiss") return save({ dismissed: { [btn.dataset.id]: true } });
    if (what === "help") return toggleHelp();
    if (what === "start") { panel.hidden = true; return openBar(); }
    if (what === "tour") { save({ coach: "" }); return closePane(); }
    if (what === "setup") return copyCommand("morse setup");
    // "model", "userscripts": the host opens the right settings page
    let r = null;
    try { r = await call("onboarding.open", { what }); } catch {}
    if (r && r.copy) return copyCommand(r.copy);
    if (!r) showTip(what === "userscripts" ? t("ob.howScripts") : S.mode === "extension" ? t("ob.howModelExt") : t("ob.howModel"), 9000);
  }
  for (const el of [coachEl, noteEl, actions]) el.addEventListener("click", e => {
    const b = e.target.closest("[data-ob]");
    if (b) act(b.dataset.ob, b);
  });
  panel.addEventListener("click", e => {
    const b = e.target.closest("[data-ob]");
    if (!b) return;
    panel.hidden = true;
    openBar();
    if (b.dataset.ob === "help") toggleHelp();
  });

  // ---- one-time tips: the first saved mod, the first share
  function showTip(text, ms = 8000) {
    toast(text);
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (toastEl.hidden = true), ms);
  }
  const where = () => S.appName || (/^https?:$/.test(location.protocol) && location.host) || t("panel.thisPage");
  function savedTip() {
    tipSaved = false;
    celebrate(S.mods[S.mods.length - 1]);
  }

  // ---- the first saved change (first-run hook): a small card instead of the
  // toast. The mark's squares settle into a check; it explains "mod" once,
  // and names what just showed up in the bar (progressive reveal, above).
  const winEl = makeEl("div", { className: "ob-win", hidden: true }, { role: "status", "aria-live": "polite" });
  root.append(winEl);
  let winMod = null;
  function celebrate(m) {
    toastEl.hidden = true;
    clearTimeout(toast.t);
    winMod = m || null;
    const k = id => (hotkey(id) ? caps(hotkey(id)) : "");
    const edit = hotkey("godmode") ? caps(hotkey("godmode")) : caps([primaryMod, "E"]);
    const next = [
      typeof GodQuick !== "undefined" && [t("quick.title"), esc(t("ob.win.quick"))],
      [t("hk.godmode"), t("ob.win.edit", { key: edit })],
      [t("ob.win.ask"), esc(t("ob.win.ask.d"))],
    ].filter(Boolean);
    winEl.innerHTML = `<div class="ob-win-mark" aria-hidden="true">${radar(30)}<svg class="ob-win-check" viewBox="0 0 16 16" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg></div>
      <div class="ob-win-body">
        <b>${t("ob.win.title")}</b>
        <p>${t("ob.win.body", { mod: m ? `“${esc(m.title)}”` : t("ob.win.it"), where: esc(where()), key: k("mods") || t("bar.mods") })}</p>
        <h4>${t("ob.win.now")}</h4>
        <ul>${next.map(([title, d]) => `<li><b>${esc(title)}</b><span>${d}</span></li>`).join("")}</ul>
        <div class="ob-win-row">${m ? `<button type="button" class="primary" data-win="share">${t("ob.win.share")}</button>` : ""}<button type="button" data-win="done">${t("btn.done")}</button><span>${t("ob.win.help")}</span></div>
      </div>`;
    winEl.hidden = false;
    clearTimeout(celebrate.t);
    celebrate.t = setTimeout(closeWin, 45000);
  }
  function closeWin() { clearTimeout(celebrate.t); winEl.hidden = true; }
  winEl.addEventListener("click", e => {
    const a = e.target.closest("[data-win]")?.dataset.win;
    if (!a) return;
    closeWin();
    if (a === "share" && winMod) showShare(S.mods.find(x => x.id === winMod.id) || winMod);
  });
  listen("keydown", e => { if (e.isTrusted && e.key === "Escape" && !winEl.hidden && !S.open && modal.hidden) { e.stopPropagation(); closeWin(); } }, true);
  new MutationObserver(() => { if (!bar.hidden && !winEl.hidden) closeWin(); }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });
  outgoing.push(m => {
    if (!st) return;
    // Only a change the model made and you saved counts: edit-tool sessions
    // ("manual") and page tools ("quick") save on their own and keep their own undo toast.
    if (m.type === "mods.save" && m.draft && m.draft.kind !== "manual" && m.draft.kind !== "quick") {
      if (!st.tips.saved) { tipSaved = true; setTimeout(() => tipSaved && savedTip(), 3000); }
      if (st.coach !== "done" || !st.tips.saved) save({ coach: "done", tips: { saved: true } });
    }
    if (m.type === "share" && m.kind === "link" && !st.tips.share) { tipShare = true; save({ tips: { share: true } }); }
  });
  // The bar's own "Saved" toast is replaced by the longer first-time tip.
  new MutationObserver(() => { if (tipSaved && !toastEl.hidden) savedTip(); })
    .observe(toastEl, { attributes: true, attributeFilter: ["hidden"], childList: true });
  new MutationObserver(() => {
    const card = !modal.hidden && modal.querySelector(".card");
    if (!tipShare || !card || !card.querySelector(".exports")) return;
    tipShare = false;
    card.insertAdjacentHTML("beforeend", `<p class="ob-tip">${radar(12)}<span>${t("ob.shareTip")}</span></p>`);
  }).observe(modal, { childList: true, attributes: true, attributeFilter: ["hidden"] });

  // ---- follow the bar: open/close, target, phase, panes
  let wasOpen = false;
  new MutationObserver(recs => {
    if (recs.every(r => coachEl.contains(r.target) || noteEl.contains(r.target))) return;
    const open = S.open && !bar.hidden;
    // Re-read on open: a model or user scripts may have been set up meanwhile.
    if (open && !wasOpen && Date.now() - loadedAt > 2000) load();
    wasOpen = open;
    sync();
  }).observe(bar, { attributes: true, attributeFilter: ["class", "hidden"], subtree: true });
  input.addEventListener("input", sync);

  // ---- the Mods panel with nothing in it (70-panel.js hook)
  function emptyMods() {
    const open = hotkey("open");
    return `<div class="empty ob-empty">${radar(22)}<b>${t("ob.empty.title", { where: esc(where()) })}</b>
      <span>${open ? t("ob.empty.press", { key: caps(open) }) : t("ob.empty.open")}</span>
      <div class="ob-row"><button type="button" class="primary" data-ob="start">${t("ob.empty.make")}</button><button type="button" data-ob="help">${t("ob.examples")}</button></div></div>`;
  }

  load();
  return { act, emptyMods, state: () => st, status: () => status };
})();
function emptyModsHtml() { return Onboarding.emptyMods(); } // 70-panel.js hook
// Asking for the Edit tools (their shortcut) shows them even before the first
// saved change (progressive reveal, above). 45-godmode.js calls this.
function revealEditTools() { hostEl.setAttribute("data-tools", ""); } // first-run hook
