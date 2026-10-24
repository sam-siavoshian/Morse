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

  const coachEl = makeEl("div", { className: "ob-coach", hidden: true }, { role: "group", "aria-label": "Getting started" });
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
  const STEPS = [["point", "Point"], ["describe", "Describe"], ["keep", "Save"]];
  function step() {
    if (S.phase === "result") return ["keep", `Like it? <b>Save</b> keeps it for next time. <b>Undo</b> puts the page back.`];
    if (S.phase === "working") return ["describe", `Morse is making the change. You'll see it as it happens. <kbd>Esc</kbd> stops it.`];
    if (S.phase === "error") return ["describe", `That didn't work. Try other words, or point at something else.`];
    if (S.target || input.value.trim()) return ["describe", `Say what you want, like “make this bigger”, then press <kbd>Enter</kbd>.`];
    return ["point", `Click the part of the page you want to change. Or skip this and describe a change to the whole page.`];
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
    const examples = id === "describe" && S.phase === "idle" ? ` <button type="button" class="ob-link" data-ob="help">See examples</button>` : "";
    coachEl.innerHTML = `
      <ol class="ob-steps">${STEPS.map(([, label], i) => `<li class="${i < at ? "done" : i === at ? "now" : ""}"${i === at ? ` aria-current="step"` : ""}><span class="n">${i < at ? CHECK : i + 1}</span>${label}</li>`).join("")}</ol>
      <button type="button" class="ob-hide" data-ob="skip">Hide tips</button>
      <p class="ob-say">${say}${examples}</p>`;
  }

  // ---- one notice at a time under the input: no model, then user scripts off
  function noteNow() {
    if (!st || coachOn() || !S.open || bar.hidden || S.phase !== "idle" || paneKind) return null;
    if (modelMissing(status, S.label) && !st.dismissed.model)
      return { id: "model", text: "No model connected yet. Connect one so Morse can make changes.", btn: "Connect a model", act: "model" };
    const waiting = Waiting.list(); // waiting hook: mods here whose code waits for “Allow User Scripts” (64-waiting.js)
    if (waiting.length && !Waiting.quiet)
      return { id: `waiting:${waiting.length}`, text: Waiting.text(waiting), btn: "Turn it on", act: "userscripts" };
    if (status.userScripts === false && !st.dismissed.userScripts)
      return { id: "userScripts", text: "“Allow User Scripts” is off, so changes that add buttons or features won't run. Changes to how pages look still work.", btn: "Turn it on", act: "userscripts" };
    return null;
  }
  function renderNote() {
    const n = noteNow();
    noteEl.hidden = !n;
    if ((n?.id || "") === shownNote) return;
    shownNote = n?.id || "";
    noteEl.innerHTML = n ? `<span class="ob-dot" aria-hidden="true"></span><span class="ob-text">${esc(n.text)}</span>
      <button type="button" data-ob="${n.act}">${esc(n.btn)}</button>
      <button type="button" class="ob-close" data-ob="dismiss" data-id="${n.id}" aria-label="Don't show this again" title="Don't show this again">×</button>` : "";
  }

  // ---- errors in plain words, with a button that does something about it
  const ACTION_LABEL = { userscripts: "Turn on Allow User Scripts", model: "Model settings", setup: "Copy “morse setup”" };
  function explainFailure() {
    if (S.phase !== "error" || hint.querySelector(".ob-why")) return;
    const why = explainError(hint.title || hint.textContent);
    if (!why) return;
    hint.innerHTML = `That didn't work: <span class="ob-why">${esc(why.text)}</span>`;
    const label = ACTION_LABEL[why.action];
    if (label && !actions.querySelector("[data-ob]")) actions.insertAdjacentHTML("afterbegin", `<button type="button" data-ob="${why.action}">${esc(label)}</button>`);
  }

  function sync() {
    renderCoach();
    renderNote();
    explainFailure();
  }

  // ---- actions behind every button above
  async function copyCommand(cmd) {
    let copied = false;
    try { await navigator.clipboard.writeText(cmd); copied = true; } catch {}
    showTip(copied ? `Copied “${cmd}”. Paste it in a terminal and press Enter.` : `Run “${cmd}” in a terminal.`, 7000);
  }
  async function act(what, btn) {
    if (what === "skip") return save({ coach: "done" });
    if (what === "dismiss" && btn.dataset.id?.startsWith("waiting")) { Waiting.quiet = true; return sync(); } // waiting hook: for this page only
    if (what === "dismiss") return save({ dismissed: { [btn.dataset.id]: true } });
    if (what === "help") return toggleHelp();
    if (what === "start") { panel.hidden = true; return openBar(); }
    if (what === "tour") { save({ coach: "" }); return closePane(); }
    if (what === "setup") return copyCommand("morse setup");
    // "model", "userscripts": the host opens the right settings page
    let r = null;
    try { r = await call("onboarding.open", { what }); } catch {}
    if (r && r.copy) return copyCommand(r.copy);
    if (!r) showTip(what === "userscripts"
      ? "Open chrome://extensions, click Details under Morse, and turn on “Allow User Scripts”."
      : S.mode === "extension" ? "Click the Morse icon in Chrome's toolbar, then open Model." : "Run “morse setup” in a terminal to connect a model.", 9000);
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
  const where = () => S.appName || (/^https?:$/.test(location.protocol) && location.host) || "this page";
  function savedTip() {
    tipSaved = false;
    const m = S.mods[S.mods.length - 1];
    const keys = hotkeyText("mods");
    showTip(`Saved${m ? ` “${m.title}”` : ""} as a mod. It comes back every time you open ${where()}. To turn it off, edit or share it, open Mods${keys ? ` (${keys})` : ""}.`);
  }
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
    card.insertAdjacentHTML("beforeend", `<p class="ob-tip">${radar(12)}<span>Anyone with Morse can install it from this link. The Tampermonkey download runs in Tampermonkey or Violentmonkey without Morse. People see the code before they install it.</span></p>`);
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
    return `<div class="empty ob-empty">${radar(22)}<b>No mods on ${esc(where())} yet</b>
      <span>${open ? `Press ${caps(open)}, point` : "Open Morse, point"} at something and say what you want changed. What you save shows up here, to turn off, edit or share.</span>
      <div class="ob-row"><button type="button" class="primary" data-ob="start">Make a change</button><button type="button" data-ob="help">See examples</button></div></div>`;
  }

  load();
  return { act, emptyMods, state: () => st, status: () => status };
})();
function emptyModsHtml() { return Onboarding.emptyMods(); } // 70-panel.js hook
