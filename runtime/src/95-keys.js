// Global keys. While the bar is closed Morse takes only its configured
// hotkeys from the page; every other key passes through untouched.
//
// When push-to-talk and Open Morse share a combo (the default), a tap opens
// or closes the bar and a hold (> HOLD_MS) talks until release.

const HOLD_MS = 280;
let held = null; // { combo, timer, talking, closeOnUp }

function hotkeyFor(e) {
  for (const { id } of HOTKEY_ACTIONS) {
    const c = hotkey(id);
    if (c && matchCombo(e, c)) return id;
  }
  return "";
}

function runHotkey(id) {
  const talkSame = hotkey("talk") && hotkey("talk") === hotkey("open");
  if (id === "open") {
    const wasOpen = S.open;
    if (!wasOpen) openBar();
    if (talkSame) {
      held = { combo: hotkey("open"), closeOnUp: wasOpen, talking: false };
      held.timer = setTimeout(() => {
        if (!held || S.phase !== "idle") return;
        held.closeOnUp = false;
        held.talking = true;
        Voice.start("hold");
      }, HOLD_MS);
    } else if (wasOpen) closeBar();
    return;
  }
  if (id === "talk") {
    held = { combo: hotkey("talk"), talking: true };
    Voice.start("hold");
    return;
  }
  if (id === "mods") { panel.hidden ? openPanel() : (panel.hidden = true); return; }
  // God mode lives in its own module; it listens for this.
  if (id === "godmode") listeners.forEach(fn => fn({ type: "godmode.toggle" }));
}

function release() {
  const h = held;
  held = null;
  clearTimeout(h.timer);
  if (h.talking) Voice.stop({ submit: PREFS.voice.autoSubmit });
  else if (h.closeOnUp) closeBar();
}

addEventListener("keydown", e => {
  if (e.isComposing || e.keyCode === 229) return;
  const id = hotkeyFor(e);
  if (id) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat && !held) runHotkey(id);
    return;
  }
  if (!S.open && panel.hidden && modal.hidden) return; // closed: hands off the page's keys
  const consume = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  const primary = PLATFORM === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (S.open && modal.hidden && primary && !e.altKey && !e.shiftKey) {
    if (e.code === "Period" && S.phase === "working") { consume(); stopGeneration(); return; }
    if (e.code === "Comma") { consume(); toggleSettings(); return; }
  }
  if (e.key === "Escape") {
    if (!modal.hidden) { consume(); modal.hidden = true; }
    else if (!panel.hidden) { consume(); panel.hidden = true; }
    else if (S.open) { consume(); barEscape(); }
    return;
  }
  if (e.key === "Tab" && S.open && modal.hidden && panel.hidden && !e.altKey && !e.ctrlKey && !e.metaKey) trapTab(e);
}, true);

addEventListener("keyup", e => {
  if (!held || !releasesCombo(e, held.combo)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  release();
}, true);
// Switching windows mid-hold never delivers the keyup.
addEventListener("blur", () => { if (held) release(); });
