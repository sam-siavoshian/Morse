// The command bar: open/close, pointing, typing, and the behaviors people
// expect from a command bar (stop, history, suggestions, cheat sheet,
// settings, focus that stays put and comes back). Voice is 55, settings 56,
// history 57, suggestions 58, the cheat sheet 96, global keys 95.

// ---- DOM additions to the base bar in 10-dom.js
const row = $(".row"), goBtn = $(".go"), statusRow = $(".status");
bar.setAttribute("role", "dialog");
bar.setAttribute("aria-modal", "true");
tBind(bar, "aria-label", "bar.dialog");
tBind(input, "aria-label", "bar.input");
goBtn.setAttribute("aria-label", t("bar.send"));
goBtn.innerHTML = `<svg class="i-go" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h9.5M8.75 4.25 12.5 8l-3.75 3.75"/></svg><svg class="i-stop" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>`;
const micBtn = tBind(makeEl("button", { className: "mic ibtn", type: "button" }), "aria-label", "bar.talk");
goBtn.before(micBtn);
const sugEl = tBind(makeEl("div", { className: "sugs", hidden: true }, { role: "toolbar" }), "aria-label", "bar.suggestions");
const pane = makeEl("div", { className: "pane", hidden: true });
row.after(sugEl, pane);
const moreBtn = tBind(tBind(makeEl("button", { className: "more ibtn sm", type: "button" }, { "aria-haspopup": "menu", "aria-expanded": "false" }), "title", "bar.more.title"), "aria-label", "bar.more");
moreBtn.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/></svg>`;
statusRow.append(moreBtn);
const menuEl = makeEl("div", { className: "bmenu menu", hidden: true }, { role: "menu", "aria-label": "Morse" });
const liveEl = makeEl("div", { className: "sr" }, { role: "status", "aria-live": "polite" });
bar.append(menuEl, liveEl);

function makeEl(tag, props = {}, attrs = {}) {
  const n = Object.assign(document.createElement(tag), props);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// ---- screen readers hear what the status line says
let lastSaid = "";
function announce(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t === lastSaid) return;
  lastSaid = t;
  liveEl.textContent = t;
}
new MutationObserver(() => { clearTimeout(announce.t); announce.t = setTimeout(() => announce(hint.textContent), 120); })
  .observe(hint, { childList: true, subtree: true, characterData: true });

// ---- the input grows with its text up to five lines; Shift+Enter is a newline
const LINE = 21, MAX_LINES = 5;
function autosize() {
  input.style.height = "auto";
  const h = Math.min(input.scrollHeight, LINE * MAX_LINES + 8);
  input.style.height = h + "px";
  input.style.overflowY = input.scrollHeight > h + 1 ? "auto" : "hidden";
  bar.classList.toggle("multi", h > LINE + 10);
}
function setInput(text) {
  input.value = text;
  autosize();
  input.setSelectionRange(text.length, text.length);
  updateChips();
}

// ---- pointing
function setTarget(el) {
  S.target = el;
  S.picking = false;
  hl.hidden = true;
  root.host.style.cursor = "";
  if (el) {
    boxTo(el, selBox);
    placeBar(el.getBoundingClientRect());
    chip.hidden = false;
    chip.querySelector("span").textContent = describe(el);
  } else { selBox.hidden = true; chip.hidden = true; }
  setHint();
  updateChips();
  input.focus();
  GodMode.onTarget(el); // God mode: edit toolbar for the selection
}
chip.querySelector(".x").onclick = () => { setTarget(null); startPicking(); };
tBind(chip.querySelector(".x"), "aria-label", "bar.repoint");
tBind(chip.querySelector(".x"), "title", "bar.repoint");
langSubs.add(() => { if (S.open && S.phase === "idle") setHint(); });

// ---- the status line. A note (voice errors, "Stopped") sits on top of the
// default hint for a few seconds; a sticky hint stays while voice is live.
let hintNote = "", hintSticky = "";
function note(html, ms = 6000) {
  hintNote = html;
  clearTimeout(note.t);
  if (ms) note.t = setTimeout(() => { hintNote = ""; setHint(); }, ms);
  setHint();
}
function stickyHint(html) { hintSticky = html; setHint(); }
function setHint() {
  if (S.phase !== "idle") return;
  hint.innerHTML = hintSticky || hintNote || (S.picking ? t("bar.hint.pointing") : S.target ? t("bar.hint.target") : t("bar.hint.page"));
  ticker.textContent = "";
  actions.innerHTML = `<button data-a="mods">${t("bar.mods")}${S.mods.length ? ` <em>${S.mods.length}</em>` : ""}</button><span class="model">${esc(S.label)}</span>`;
}
function startPicking() { S.picking = true; setHint(); }

// ---- position: auto dodges what you point at; Settings can pin it
function applyBarPosition() { bar.dataset.pos = PREFS.barPosition; }
prefsSubs.add(applyBarPosition);
const barIsTop = () => { const r = bar.getBoundingClientRect(); return r.top + r.height / 2 < innerHeight / 2; };

// ---- focus: remembered on open, given back on close
let returnFocus = null;
function deepActive() {
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a;
}
function restoreFocus() {
  const f = returnFocus;
  returnFocus = null;
  if (f && f.isConnected && typeof f.focus === "function") try { f.focus({ preventScroll: true }); } catch {}
}
// Tab and Shift+Tab cycle through the bar while it's open.
function barFocusables() {
  return [...bar.querySelectorAll("button, textarea, input, [tabindex]")]
    .filter(n => !n.disabled && n.tabIndex >= 0 && !n.closest("[hidden]") && n.getClientRects().length);
}
function trapTab(e) {
  const list = barFocusables();
  e.preventDefault();
  if (!list.length) return;
  // From the input, Tab goes straight to the suggestions when they're showing.
  if (!e.shiftKey && root.activeElement === input && !sugEl.hidden) return sugEl.querySelector(".sug[tabindex='0']")?.focus();
  const i = list.indexOf(root.activeElement);
  const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
  list[next].focus();
}

function openBar() {
  if (S.phase === "working") return;
  if (!S.open) {
    const a = deepActive();
    returnFocus = a && a !== document.body && a !== document.documentElement && a !== hostEl ? a : null;
  }
  S.open = true;
  applyTheme();
  applyBarPosition();
  S.phase = "idle";
  bar.hidden = false;
  bar.classList.remove("done", "err", "working");
  bar.classList.toggle("top", pointerY > innerHeight * 0.55);
  input.disabled = false;
  hintNote = ""; hintSticky = "";
  hideMenu();
  showPane("");
  PromptHistory.reset();
  setInput("");
  setTarget(null);
  startPicking();
  Voice.refresh();
  requestAnimationFrame(() => input.focus());
  call("clip.start").catch(() => {});
  refreshPrefs();
  PromptHistory.load();
}
function closeBar() {
  if (S.phase === "working") return;
  // Dismissing a result keeps it; Undo is always one click away in Mods.
  if (S.phase === "result" && S.draft && !S.draft.saved) { keep(); return; }
  if (S.phase !== "result") call("clip.cancel").catch(() => {});
  Voice.cancel();
  stopRecording();
  S.open = false; S.picking = false;
  bar.hidden = true; hl.hidden = true; selBox.hidden = true;
  S.phase = "idle";
  hideMenu();
  showPane("");
  restoreFocus();
}
// While pointing, the bar dodges the cursor so nothing is unreachable.
bar.addEventListener("mouseenter", () => { if (S.picking && !input.value && !paneKind && PREFS.barPosition === "auto") bar.classList.toggle("top"); });

// ---- sending, stopping
function send(text) {
  if (S.phase !== "idle" || !text) return;
  hintNote = "";
  Voice.cancel();
  hideMenu();
  showPane("");
  sugEl.hidden = true;
  PromptHistory.add(text);
  if (YourStyle.fromBar(text)) return; // your-style hook: "…everywhere" and "not on this site" (72-style.js)
  submit(text);
}

// 60-generate.js races the model call against this, so Stop is instant even
// when the host is slow to abort (or predates generate.cancel).
const cancelWaiters = new Map();
function cancelSignal(genId) {
  cancelWaiters.clear();
  return new Promise(resolve => cancelWaiters.set(genId, resolve));
}
function stopGeneration() {
  if (S.phase !== "working" || !S.draft) return false;
  const id = S.draft.id;
  call("generate.cancel", { genId: id }).catch(() => {});
  setCss(id, "");
  cancelWaiters.get(id)?.({ ok: false, cancelled: true, error: "Stopped" });
  cancelWaiters.delete(id);
  return true;
}
// Called by 60-generate.js once the effect has wound down.
function onCancelled(id) {
  setCss(id, "");
  call("off", { modId: id }).catch(() => {});
  call("clip.cancel").catch(() => {});
  S.draft = null;
  S.phase = "idle";
  bar.classList.remove("err", "done", "working");
  input.disabled = false;
  autosize();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  if (S.target?.isConnected) boxTo(S.target, selBox);
  note(t("bar.stopped"), 0);
  // The prompt stays in the input; any edit clears the note.
  input.addEventListener("input", () => { hintNote = ""; setHint(); }, { once: true });
}

// ---- panes inside the bar: settings, shortcuts
let paneKind = "";
function showPane(kind) {
  if (paneKind === "settings" && kind !== "settings") stopRecording();
  paneKind = kind;
  pane.hidden = !kind;
  pane.dataset.kind = kind;
  bar.classList.toggle("has-pane", !!kind);
  if (kind === "settings") renderSettings();
  else if (kind === "shortcuts") renderShortcuts();
  else pane.innerHTML = "";
  updateChips();
}
function closePane() { showPane(""); input.focus(); }
function toggleSettings() {
  if (!S.open) openBar();
  if (paneKind === "settings") return closePane();
  showPane("settings");
  pane.querySelector(".hk")?.focus();
}

// ---- overflow menu
function menuItems() {
  return [
    { id: "showonce", label: t("menu.showonce"), keys: null }, // show-once hook: 64-show-once.js
    { id: "settings", label: t("menu.settings"), keys: [primaryMod, ","] },
    { id: "shortcuts", label: t("menu.shortcuts"), keys: ["?"] },
    { id: "voice", label: t("bar.talk"), keys: comboParts(hotkey("talk"), PLATFORM), sub: hotkey("talk") === hotkey("open") ? t("menu.hold") : "" },
    { id: "mods", label: t("menu.mods"), keys: comboParts(hotkey("mods"), PLATFORM) },
    { id: "help", label: t("menu.help"), keys: ["F1"] }, // onboarding hook: 59-help.js
  ];
}
function showMenu() {
  menuEl.innerHTML = menuItems().map(m => `<button role="menuitem" tabindex="-1" data-m="${m.id}"><span>${esc(m.label)}</span>${m.sub ? `<small>${esc(m.sub)}</small>` : ""}${m.keys ? caps(m.keys) : ""}</button>`).join(""); // show-once hook: no keys
  menuEl.hidden = false;
  menuEl.classList.toggle("below", barIsTop());
  moreBtn.setAttribute("aria-expanded", "true");
  menuEl.querySelector("button").focus();
}
function hideMenu() {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  moreBtn.setAttribute("aria-expanded", "false");
}
function runMenu(id) {
  hideMenu();
  if (id === "settings") toggleSettings();
  if (id === "shortcuts") { showPane(paneKind === "shortcuts" ? "" : "shortcuts"); input.focus(); }
  if (id === "voice") Voice.start("tap");
  if (id === "mods") openPanel();
  if (id === "help") toggleHelp(); // onboarding hook: 59-help.js
  if (id === "showonce") ShowOnce.start(); // show-once hook
}
moreBtn.addEventListener("click", () => (menuEl.hidden ? showMenu() : hideMenu()));
menuEl.addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (b) runMenu(b.dataset.m); });
menuEl.addEventListener("keydown", e => {
  const items = [...menuEl.querySelectorAll("[data-m]")];
  const i = items.indexOf(root.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  } else if (e.key === "Home" || e.key === "End") { e.preventDefault(); items[e.key === "Home" ? 0 : items.length - 1].focus(); }
});
// Clicking anywhere else closes the menu.
root.addEventListener("pointerdown", e => { if (!menuEl.hidden && !e.composedPath().some(n => n === menuEl || n === moreBtn)) hideMenu(); });

// Esc peels one layer at a time: menu, voice, generation, pane, bar.
function barEscape() {
  if (!menuEl.hidden) { hideMenu(); moreBtn.focus(); return; }
  if (Voice.active()) { Voice.stop({ submit: false }); return; }
  if (S.phase === "working") { stopGeneration(); return; }
  if (sugEl.contains(root.activeElement)) { input.focus(); return; }
  if (paneKind) { closePane(); return; }
  closeBar();
}

// ---- typing
input.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.isComposing || e.keyCode === 229) return;
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  if (e.key === "Enter" && !e.shiftKey && plain) {
    e.preventDefault();
    const v = input.value.trim();
    if (v) send(v);
    return;
  }
  if (e.key === "?" && plain && !input.value) {
    e.preventDefault();
    showPane(paneKind === "shortcuts" ? "" : "shortcuts");
    return;
  }
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && plain && !e.shiftKey) {
    if (PromptHistory.browse(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
  }
});
input.addEventListener("input", () => {
  autosize();
  PromptHistory.edited();
  if (paneKind === "shortcuts") showPane("");
  input.classList.remove("interim");
  updateChips();
});
for (const t of ["keyup", "keypress", "input"]) input.addEventListener(t, e => e.stopPropagation());
goBtn.onclick = () => {
  if (S.phase === "working") return stopGeneration();
  const v = input.value.trim();
  if (v) send(v);
};
// The run button becomes Stop while the model works; keep focus on it so
// Enter/Space stop too (the input is disabled meanwhile).
new MutationObserver(() => {
  const working = bar.classList.contains("working");
  goBtn.setAttribute("aria-label", working ? t("bar.stop") : t("bar.send"));
  goBtn.title = working ? t("bar.stop.title", { key: `${primaryMod}.` }) : t("bar.send.title");
  if (working && (!root.activeElement || root.activeElement === input)) goBtn.focus({ preventScroll: true });
}).observe(bar, { attributes: true, attributeFilter: ["class"] });

actions.addEventListener("click", e => {
  const a = e.target.closest("button")?.dataset.a;
  if (a === "mods") openPanel();
  if (a === "keep") keep();
  if (a === "undo") undo();
  if (a === "code") showCode(S.draft);
  if (a === "share") keep().then(m => m && showShare(m));
  if (a === "again") { S.phase = "idle"; bar.classList.remove("err"); input.disabled = false; input.focus(); setHint(); updateChips(); }
});
