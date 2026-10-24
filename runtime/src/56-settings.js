// The Settings sheet (bar overflow menu, or ⌘, / Ctrl+, while the bar is
// open): hotkeys with a recorder, voice, effects, position, theme, welcome.
// Every change saves immediately through savePrefs().

const HOTKEY_HELP = {
  open: "Works anywhere in the app",
  talk: "Hold to talk, release to finish",
  mods: "See and manage the mods here",
  godmode: "Show the Edit tools",
};

// recording: { id, partial, error } while a hotkey button is listening for keys
let recording = null;
const hkNotes = {}; // id -> { level, message } shown under the row after saving

function segHtml(key, label, options, value, extra = "") {
  return `<div class="seg" role="radiogroup" aria-label="${esc(label)}" data-k="${key}">${options.map(([v, t]) =>
    `<button type="button" role="radio" aria-checked="${v === value}" tabindex="${v === value ? 0 : -1}" data-v="${v}">${esc(t)}</button>`).join("")}</div>${extra}`;
}
function switchHtml(key, on, label) {
  return `<label class="sw"><input type="checkbox" data-k="${key}" ${on ? "checked" : ""} aria-label="${esc(label)}"><span></span></label>`;
}

// Re-rendering keeps keyboard focus on the same control.
function focusKeyOf(n) {
  if (!n || !pane.contains(n)) return "";
  for (const a of ["hk", "off", "reset", "act", "ys" /* your-style hook */]) if (n.dataset[a]) return `[data-${a}="${n.dataset[a]}"]`;
  if (n.dataset.v) return `.seg[data-k="${n.closest(".seg").dataset.k}"] [data-v="${n.dataset.v}"]`;
  if (n.dataset.k) return `[data-k="${n.dataset.k}"]`;
  return "";
}
function renderSettings() {
  if (paneKind !== "settings") return;
  const keep = focusKeyOf(root.activeElement), scroll = pane.scrollTop;
  paintSettings();
  pane.scrollTop = scroll;
  if (keep) pane.querySelector(keep)?.focus({ preventScroll: true });
}
function paintSettings() {
  const v = Voice.summary();
  const fx = effectLevel();
  const keyRows = HOTKEY_ACTIONS.map(({ id, label }) => {
    const rec = recording?.id === id;
    const n = rec ? recording : hkNotes[id];
    const msg = rec
      ? (recording.error ? `<span class="bad">${esc(recording.error)}</span>` : `Press the new shortcut · <kbd>Esc</kbd> to cancel · <kbd>${PLATFORM === "mac" ? "⌫" : "Backspace"}</kbd> to reset`)
      : n?.message ? `<span class="${n.level === "warn" ? "warn" : ""}">${esc(n.message)}</span>` : esc(HOTKEY_HELP[id]);
    const shown = rec
      ? `<span class="rec">${recording.partial ? caps(comboParts({ ...flagsOf(recording.partial), code: "X" }, PLATFORM).slice(0, -1)) : ""}<span class="dots">${radar(12)}</span></span>`
      : caps(hotkey(id));
    const custom = PREFS.hotkeys[id] !== "";
    const shake = rec && recording.shake;
    if (shake) recording.shake = false;
    return `<div class="srow hkrow${rec ? " recording" : ""}${shake ? " shake" : ""}" data-id="${esc(id)}">
      <div class="lbl"><span>${esc(label)}</span><small id="hk-${id}-msg">${msg}</small></div>
      <div class="ctl">
        ${rec && id !== "open" ? `<button type="button" class="tbtn" data-off="${id}">Turn off</button>` : ""}
        ${!rec && custom ? `<button type="button" class="tbtn" data-reset="${id}" title="Back to ${esc(formatCombo(resolveHotkeys({}, PLATFORM)[id], PLATFORM))}">Reset</button>` : ""}
        <button type="button" class="hk field" data-hk="${id}" aria-describedby="hk-${id}-msg" aria-label="${esc(label)} shortcut: ${esc(hotkeyText(id) || "off")}. Press to change.">${shown}</button>
      </div>
    </div>`;
  }).join("");
  pane.innerHTML = `
    <div class="sheet" role="group" aria-label="Settings">
      <header><b>Settings</b><span class="flash" aria-hidden="true"></span><button type="button" class="tbtn" data-act="done">Done</button></header>
      ${YourStyle.settingsHtml() /* your-style hook: 72-style.js */}
      <section><h4>Shortcuts</h4>${keyRows}</section>
      <section><h4>Voice</h4>
        <div class="srow"><div class="lbl"><span>Send after a pause</span><small>Sends when you stop talking</small></div><div class="ctl">${switchHtml("autoSubmit", PREFS.voice.autoSubmit, "Send after a pause")}</div></div>
        <div class="srow"><div class="lbl"><span>Speech to text</span><small class="${v.ok ? "" : "warn"}">${esc(v.text)}</small></div><div class="ctl"><span class="pill ${v.ok ? "on" : ""}">${v.ok ? "Ready" : "Off"}</span></div></div>
      </section>
      <section><h4>Appearance</h4>
        <div class="srow"><div class="lbl"><span>Effects</span><small>${PREFS.effects ? "The animation while Morse works" : `Follows your system's motion setting`}</small></div><div class="ctl">${segHtml("effects", "Effects", [["full", "Full"], ["subtle", "Subtle"], ["off", "Off"]], fx)}</div></div>
        <div class="srow"><div class="lbl"><span>Bar position</span><small>Auto moves away from what you point at</small></div><div class="ctl">${segHtml("barPosition", "Bar position", [["auto", "Auto"], ["top", "Top"], ["bottom", "Bottom"]], PREFS.barPosition)}</div></div>
        <div class="srow"><div class="lbl"><span>Theme</span></div><div class="ctl">${segHtml("theme", "Theme", [["auto", "Match app"], ["light", "Light"], ["dark", "Dark"]], PREFS.theme)}</div></div>
      </section>
      <section><h4>General</h4>
        <div class="srow"><div class="lbl"><span>Welcome message</span><small>“Morse is ready” when an app or page loads</small></div><div class="ctl">${switchHtml("welcome", PREFS.welcome, "Welcome message")}</div></div>
        <div class="srow"><div class="lbl"><span>Show mods others made</span><small>Mods from the Morse gallery for the site you're on</small></div><div class="ctl">${switchHtml("gallery", PREFS.gallery, "Show mods others made")}</div></div><!-- gallery hook: 68-gallery.js -->
        <div class="srow"><div class="lbl"><span>Fix my mods automatically when a site changes</span><small>Fixes them in the background and tells you, with Undo</small></div><div class="ctl">${switchHtml("autoFix", PREFS.autoFix, "Fix my mods automatically when a site changes")}</div></div><!-- self-heal hook: 71-heal.js -->
      </section>
      <footer><button type="button" class="tbtn" data-act="reset-all">Reset all settings</button><span class="dim">${esc(S.mode === "extension" ? "Synced with your Chrome profile" : S.mode === "desktop" ? "Saved on this computer" : "")}</span></footer>
    </div>`;
}
const flagsOf = partial => ({ ctrl: /Ctrl/.test(partial), alt: /Alt/.test(partial), shift: /Shift/.test(partial), meta: /Meta/.test(partial) });

function flashSaved() {
  const s = pane.querySelector(".flash");
  if (!s) return;
  s.textContent = "Saved";
  s.classList.remove("show"); void s.offsetWidth; s.classList.add("show");
}
async function saveSetting(patch, focusSel) {
  await savePrefs(patch);
  renderSettings();
  flashSaved();
  if (focusSel) pane.querySelector(focusSel)?.focus();
}

// ---- hotkey recorder
function startRecording(id) {
  recording = { id, partial: "", error: "" };
  renderSettings();
  pane.querySelector(`[data-hk="${id}"]`)?.focus();
  announce("Press the new shortcut. Escape cancels.");
}
function stopRecording(focus = true) {
  if (!recording) return;
  const id = recording.id;
  recording = null;
  renderSettings();
  if (focus) pane.querySelector(`[data-hk="${id}"]`)?.focus();
}
async function commitHotkey(id, value, verdict) {
  recording = null;
  hkNotes[id] = verdict && verdict.message ? verdict : null;
  await saveSetting({ hotkeys: { [id]: value } }, `[data-hk="${id}"]`);
  announce(`${HOTKEY_ACTIONS.find(a => a.id === id).label}: ${hotkeyText(id) || "off"}. ${verdict?.message || ""}`);
}

listen("keydown", e => {
  if (!e.isTrusted || !recording) return;
  if (e.isComposing || e.keyCode === 229) return;
  // The recorder owns the keyboard while armed: nothing reaches the page or our hotkeys.
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  const { combo, partial } = comboFromEvent(e);
  if (!combo) { recording.partial = partial; renderSettings(); return; }
  const bare = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
  const id = recording.id;
  if (bare && e.code === "Escape") return stopRecording();
  if (bare && (e.code === "Backspace" || e.code === "Delete")) return commitHotkey(id, "", null);
  if (bare && e.code === "Tab") { stopRecording(false); return trapTab(e); }
  const others = { ...HOTKEYS };
  delete others[id];
  const verdict = checkCombo(combo, PLATFORM, { self: id, others });
  if (verdict.level === "error") {
    recording.error = verdict.message;
    recording.shake = true;
    recording.partial = "";
    renderSettings();
    announce(verdict.message);
    return;
  }
  commitHotkey(id, combo, verdict);
}, true);
listen("keyup", e => {
  if (!e.isTrusted || !recording) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  recording.partial = comboFromEvent(e).partial;
  renderSettings();
}, true);
// Click away (or blur the window) and the recorder gives up.
root.addEventListener("pointerdown", e => { if (recording && !e.composedPath().some(n => n?.dataset?.hk || n?.dataset?.off)) stopRecording(false); });
listen("blur", () => stopRecording(false));

pane.addEventListener("click", e => {
  const t = e.target;
  const hk = t.closest("[data-hk]");
  if (hk) return recording?.id === hk.dataset.hk ? stopRecording() : startRecording(hk.dataset.hk);
  const off = t.closest("[data-off]");
  if (off) return commitHotkey(off.dataset.off, "none", null);
  const reset = t.closest("[data-reset]");
  if (reset) { hkNotes[reset.dataset.reset] = null; return saveSetting({ hotkeys: { [reset.dataset.reset]: "" } }, `[data-hk="${reset.dataset.reset}"]`); }
  const seg = t.closest(".seg [data-v]");
  if (seg) { const k = seg.closest(".seg").dataset.k; return saveSetting({ [k]: seg.dataset.v }, `.seg[data-k="${k}"] [data-v="${seg.dataset.v}"]`); }
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "done") return closePane();
  if (act === "reset-all") { for (const k in hkNotes) hkNotes[k] = null; return saveSetting(structuredClone(DEFAULT_PREFS), `[data-act="reset-all"]`); }
});
pane.addEventListener("change", e => {
  const k = e.target.dataset?.k;
  if (k === "autoSubmit") saveSetting({ voice: { autoSubmit: e.target.checked } }, `[data-k="autoSubmit"]`);
  if (k === "welcome") saveSetting({ welcome: e.target.checked }, `[data-k="welcome"]`);
  if (k === "gallery") saveSetting({ gallery: e.target.checked }, `[data-k="gallery"]`); // gallery hook: 68-gallery.js
  if (k === "autoFix") saveSetting({ autoFix: e.target.checked }, `[data-k="autoFix"]`); // self-heal hook: 71-heal.js
});
// Radio groups: arrows move and select, like native radios.
pane.addEventListener("keydown", e => {
  const b = e.target.closest?.(".seg [data-v]");
  if (!b || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
  e.preventDefault();
  const all = [...b.parentElement.children], i = all.indexOf(b);
  const n = all[(i + (/Right|Down/.test(e.key) ? 1 : -1) + all.length) % all.length];
  n.click();
});
// Enter on a switch toggles it, as Space does.
pane.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches?.(".sw input")) { e.preventDefault(); e.target.click(); } });
prefsSubs.add(() => { if (paneKind === "settings" && !recording) renderSettings(); });
