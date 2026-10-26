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
const moreBtn = tBind(tBind(makeEl("button", { className: "more ibtn sm", type: "button" }, { "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "m-more-menu" }), "title", "bar.more.title"), "aria-label", "bar.more");
moreBtn.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/></svg>`;
statusRow.append(moreBtn);
const menuEl = makeEl("div", { className: "bmenu menu", hidden: true, id: "m-more-menu" }, { role: "menu", "aria-label": "Morse" });
const liveEl = makeEl("div", { className: "sr" }, { role: "status", "aria-live": "polite" });
bar.append(menuEl, liveEl);

function makeEl(tag, props = {}, attrs = {}) {
  const n = Object.assign(document.createElement(tag), props);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// ---- screen readers hear what the status line says (announce: 12-focus.js).
// Only while idle: notes, voice, "Stopped". A change being made says its few
// steps itself (60-generate.js), so the streaming code is never read out.
new MutationObserver(() => {
  clearTimeout(announce.t);
  // A message said just now (what was chosen, a step of Choose with keys) isn't talked over by the status line.
  announce.t = setTimeout(() => { if (S.phase === "idle" && !bar.hidden && !KeyPick.on && Date.now() - lastSaidAt > 400) announce(hint.textContent); }, 120);
}).observe(hint, { childList: true, subtree: true, characterData: true });

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
  if (S.target && S.target !== el) unmarkHost(S.target);
  S.target = el;
  S.picking = false;
  hl.hidden = true;
  root.host.style.cursor = "";
  if (el) {
    pinned = true;
    watchHost(el);
    el.classList.add("morse-selected");
    syncPickFlag();
    boxTo(el, selBox);
    placeBar(el.getBoundingClientRect());
    chip.hidden = false;
    chip.querySelector("span").textContent = describe(el);
  } else { chip.hidden = true; releasePick(); }
  setHint();
  updateChips();
  input.focus();
  GodMode.onTarget(el); // God mode: edit toolbar for the selection
  if (el) announce(t("bar.chosenSay", { what: describe(el), hint: hint.textContent })); // screen readers hear what was picked, then what's next
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
  hint.innerHTML = hintSticky || hintNote || (S.picking
    ? `${t("bar.hint.pointing")}<span class="sr"> · ${t("bar.hint.keys", { key: PLATFORM === "mac" ? "Option" : "Alt" })}</span>`
    : S.target ? `${t("bar.hint.target")} · ${t("bar.hint.wider", { key: PLATFORM === "mac" ? "⌥↑" : "Alt+↑" })}` : t("bar.hint.page")); // dogfood: Alt+↑
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
  if (f && f.isConnected && typeof f.focus === "function") try { f.focus({ preventScroll: true }); return; } catch {}
  if (bar.contains(root.activeElement)) focusPageTop();
}
// Tab and Shift+Tab cycle through the bar while it's open (it is a modal
// dialog: the page is for pointing at, not typing in). The Edit tools that
// float by the selection count as part of it (45-godmode.js).
function barFocusables() {
  return [bar, ...barExtras].flatMap(tabbables);
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
  // soak: the clip starts with the change (60-generate.js submit), not here: on
  // the desktop it screencasts every frame, which made the bar, the Edit tools
  // and the page tools 2 to 4 times slower for as long as the bar was open.
  warmedFor = "";
  call("warm").catch(() => {}); // speed: the model gets ready while you point and type
  refreshPrefs();
  PromptHistory.load();
}
function closeBar() {
  if (S.phase === "working") return;
  // Dismissing a result (Esc, the hotkey, a click away) keeps it, and its
  // toast says so, with Undo (60-generate.js keep).
  if (S.phase === "result" && S.draft && !S.draft.saved) { keep({ closed: true }); return; }
  if (S.phase !== "result") call("clip.cancel").catch(() => {});
  Voice.cancel();
  stopRecording();
  S.open = false; S.picking = false;
  S.target = null;
  chip.hidden = true;
  releasePick();
  bar.hidden = true; hl.hidden = true; selBox.hidden = true;
  S.phase = "idle";
  hideMenu();
  showPane("");
  restoreFocus();
}
// The bar (and Morse's other see-through surfaces) let a calm page show
// through. When the page's own words sit right under one (an article on a
// phone), it turns solid, so its words never read over the page's.
// perf: a look is up to 20 hit tests, a few ms each on a big page, so it is
// taken only where a surface hasn't looked since the page last moved (shown,
// moved to the top or bottom, dragged, grown, or a new phase such as a
// result), and after a scroll only once the page rests. A key, a pointer move
// or a row changing inside the bar costs a rect read at most, and nothing
// runs while every surface is hidden (docs/perf/report.md, tests/perf.test.js).
const Backing = (() => {
  const SURFACES = ".bar, .so-strip, .guide, .ds";
  const SHOWN = ".bar:not([hidden]), .so-strip:not([hidden]), .guide:not([hidden]), .ds:not([hidden])";
  const REST = 200; // ms without a scroll
  const answers = new Map(); // "left,top,width,height" -> words under it, until the page moves
  const sizes = new ResizeObserver(() => soon()), sized = new WeakSet(); // grown or shrunk: a row inside shown or hidden, a second line typed
  let timer = 0, scrolledAt = 0;
  // Is page text under this box? A few points across it, the page's topmost
  // part of the page at each, and that part's own lines of text.
  function textUnder(r) {
    const seen = new Set();
    for (const fx of [0.04, 0.25, 0.5, 0.75, 0.96]) for (const fy of [0.04, 0.35, 0.65, 0.96]) {
      const top = document.elementsFromPoint(r.left + r.width * fx, r.top + r.height * fy).find(n => n !== hostEl && !hostEl.contains(n));
      if (!top || seen.has(top)) continue;
      seen.add(top);
      for (const t of top.childNodes) {
        if (t.nodeType !== 3 || !t.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(t);
        for (const b of range.getClientRects()) if (b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) return true;
      }
    }
    return false;
  }
  function check() {
    timer = 0;
    const rest = scrolledAt + REST - performance.now();
    if (rest > 0) { timer = setTimeout(check, rest); return; } // still scrolling: look once it rests
    for (const el of root.querySelectorAll(SURFACES)) {
      if (el.hidden) continue;
      if (!sized.has(el)) { sized.add(el); sizes.observe(el); }
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const at = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      // Same place over the same page, same answer: the bar stepping between
      // top and bottom while you point looks twice, not on every step.
      let solid = answers.get(at);
      if (solid === undefined) {
        if (answers.size > 40) answers.clear();
        answers.set(at, solid = textUnder(r));
      }
      if (el.classList.contains("solid") !== solid) el.classList.toggle("solid", solid);
    }
  }
  const soon = () => { if (!timer && live()) timer = setTimeout(check, 120); };
  const pageMoves = () => {
    answers.clear();
    if (!root.querySelector(SHOWN)) return; // closed: nothing to look for
    scrolledAt = performance.now();
    soon();
  };
  listen("scroll", pageMoves, { capture: true, passive: true });
  listen("resize", pageMoves);
  // A surface shown, hidden, moved (top or bottom, dragged) or in a new phase
  // (working, a result, a sheet): its own attributes only, not every class and
  // style inside it (the input's height on each key); a change of size comes
  // from the ResizeObserver. Moving keeps what it saw; anything else may come
  // with a changed page (a change applied, time gone by while hidden), so it
  // looks anew. The same class set again (the picker's add("top") on every
  // pointer move) is nothing.
  const MOVES = new Set(["top", "solid"]);
  new MutationObserver(recs => {
    let seen = false;
    for (const r of recs) {
      if (!r.target.matches?.(SURFACES)) continue;
      if (r.attributeName === "class") {
        const was = new Set(String(r.oldValue || "").split(/\s+/).filter(Boolean)), now = r.target.classList;
        const changed = [...was].filter(c => !now.contains(c)).concat([...now].filter(c => !was.has(c)));
        if (!changed.length) continue;
        if (changed.some(c => !MOVES.has(c))) answers.clear();
      } else if (r.attributeName === "hidden") answers.clear();
      seen = true;
    }
    if (seen) soon();
  }).observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["hidden", "style", "class", "data-pos"] });
  return { check: soon };
})();
// While pointing, the bar steps aside so nothing under it is unreachable, but
// only once the pointer rests on it away from its controls. A pointer heading
// for a button, a suggestion or the page tools never makes it jump.
let dodgeTimer = 0;
const dodgeOk = t => S.picking && !input.value && !paneKind && PREFS.barPosition === "auto" && !S.target && !GodMode.selected &&
  !t?.closest?.("button, .chip, .sugs, .gm-clips, .menu") && !bar.querySelector(".menu:not([hidden])");
bar.addEventListener("pointermove", e => {
  clearTimeout(dodgeTimer);
  if (dodgeOk(e.target)) dodgeTimer = setTimeout(() => { if (dodgeOk(e.target) && bar.matches(":hover")) bar.classList.toggle("top"); }, 350);
});
bar.addEventListener("pointerleave", () => clearTimeout(dodgeTimer));

// ---- sending, stopping
function send(text) {
  if (S.phase !== "idle" || !text) return;
  hintNote = "";
  clearTimeout(warmTimer); warmedFor = ""; // models: the request itself picks the model now
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
  releasePick(); // before idle, so the frame cannot flash back on
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
  note(t("bar.stopped"), 0);
  // The prompt stays in the input; any edit clears the note.
  input.addEventListener("input", () => { hintNote = ""; setHint(); }, { once: true });
}

// ---- panes inside the bar: settings, shortcuts
let paneKind = "";
function showPane(kind) {
  if (paneKind === "settings" && kind !== "settings") stopRecording();
  // soak: focus leaves the pane before it is hidden and emptied. Hidden with
  // the focus inside, the page's document kept the pane in a table of its own
  // (and through its listeners the whole UI, after morse stop).
  if (kind !== paneKind && pane.contains(root.activeElement)) input.focus({ preventScroll: true });
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

// ---- overflow menu: only what has no button of its own (docs/dev/simplify.md).
// Talk is the mic button, Mods the button beside this one, and Choose with
// keys (Alt+↓) and the shortcut list (?) are one click away in Help; their
// keys still work everywhere.
function menuItems() {
  // A change waiting to be saved: Edit code and Share are here, not on the bar.
  const draft = S.phase === "result" && S.draft && !S.draft.saved;
  return [
    ...(draft ? [{ id: "code", label: t("btn.editCode"), keys: null }, { id: "share", label: t("btn.share"), keys: null }] : []),
    { id: "showonce", label: t("menu.showonce"), keys: null }, // show-once hook: 64-show-once.js
    { id: "settings", label: t("menu.settings"), keys: [primaryMod, ","] },
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
  if (id === "help") toggleHelp(); // onboarding hook: 59-help.js
  if (id === "showonce") ShowOnce.start(); // show-once hook
  if (id === "code" && S.draft) showCode(S.draft);
  if (id === "share" && S.draft) keep().then(m => m && showShare(m));
}
moreBtn.addEventListener("click", () => (menuEl.hidden ? showMenu() : hideMenu()));
menuEl.addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (b) runMenu(b.dataset.m); });
menuEl.addEventListener("keydown", e => {
  if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); hideMenu(); moreBtn.focus(); return; } // Tab leaves a menu, as in any app
  if (menuKeys(e, menuEl)) e.stopPropagation();
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
    const dir = e.key === "ArrowUp" ? -1 : 1;
    // history.get may still be in flight (the bar no longer waits on it).
    // Hold the key and recall once the list is here, instead of dropping it.
    if (PromptHistory.loaded()) { if (PromptHistory.browse(dir)) e.preventDefault(); }
    else { e.preventDefault(); PromptHistory.load().then(() => { if (S.open) PromptHistory.browse(dir); }).catch(() => {}); }
  }
});
// speed, models: a pause in typing tells the host what the request looks like
// so far; under Automatic it gets the model that request would start on ready
// (the strong one for new UI and features, core/route.js warmSettings). The
// words go only to the host on this computer or the extension's worker.
let warmTimer = 0, warmedFor = "";
function warmAsYouType() {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    const v = input.value.trim();
    if (!v || v === warmedFor || S.phase === "working") return;
    warmedFor = v;
    call("warm", { request: v.slice(0, 500) }).catch(() => {});
  }, 500);
}
input.addEventListener("input", () => {
  autosize();
  PromptHistory.edited();
  if (paneKind === "shortcuts") showPane("");
  input.classList.remove("interim");
  warmAsYouType();
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
