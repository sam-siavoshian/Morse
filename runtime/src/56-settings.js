// The Settings sheet (bar overflow menu, or ⌘, / Ctrl+, while the bar is
// open): hotkeys with a recorder, voice, effects, position, theme, welcome.
// Every change saves immediately through savePrefs().

const HOTKEY_HELP = {
  get open() { return t("hk.help.open"); },
  get talk() { return t("hk.help.talk"); },
  get mods() { return t("hk.help.mods"); },
  get godmode() { return t("hk.help.godmode"); },
  get off() { return t("hk.help.off"); }, // the off switch (63-control.js)
};

// recording: { id, partial, error } while a hotkey button is listening for keys
let recording = null;
let settingsMore = false; // simplify: More settings is open (stays open while the bar is)
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
  const keyRow = ({ id, label }) => {
    const rec = recording?.id === id;
    const n = rec ? recording : hkNotes[id];
    const msg = rec
      ? (recording.error ? `<span class="bad">${esc(recording.error)}</span>` : t("settings.recording", { back: PLATFORM === "mac" ? "⌫" : "Backspace" }))
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
        ${rec && id !== "open" ? `<button type="button" class="tbtn" data-off="${id}">${t("settings.turnOff")}</button>` : ""}
        ${!rec && custom ? `<button type="button" class="tbtn" data-reset="${id}" title="${esc(t("settings.backTo", { key: formatCombo(resolveHotkeys({}, PLATFORM)[id], PLATFORM) }))}">${t("settings.reset")}</button>` : ""}
        <button type="button" class="hk field" data-hk="${id}" aria-describedby="hk-${id}-msg" aria-label="${esc(t("settings.hkLabel", { label, key: hotkeyText(id) || t("settings.off") }))}">${shown}</button>
      </div>
    </div>`;
  };
  // simplify: Open Morse is the one shortcut most people ever look for; the
  // rest wait under More settings with everything else (docs/dev/simplify.md).
  const openRow = keyRow(HOTKEY_ACTIONS.find(a => a.id === "open"));
  const otherKeys = HOTKEY_ACTIONS.filter(a => a.id !== "open").map(keyRow).join("");
  pane.innerHTML = `
    <div class="sheet" role="group" aria-label="${esc(t("settings.title"))}">
      <header><b>${t("settings.title")}</b><span class="flash" aria-hidden="true"></span><button type="button" class="tbtn" data-act="done">${t("btn.done")}</button></header>
      ${YourStyle.settingsHtml() /* your-style hook: 72-style.js */}
      <section>
        ${openRow}
        <div class="srow"><div class="lbl"><span>${t("settings.theme")}</span></div><div class="ctl">${segHtml("theme", t("settings.theme"), [["auto", t("settings.theme.auto")], ["light", t("settings.theme.light")], ["dark", t("settings.theme.dark")]], PREFS.theme)}</div></div>
        ${languageRowHtml()}
        <div class="srow"><div class="lbl"><span>${t("settings.autoFix")}</span><small>${t("settings.autoFix.help")}</small></div><div class="ctl">${switchHtml("autoFix", PREFS.autoFix, t("settings.autoFix"))}</div></div><!-- self-heal hook: 71-heal.js -->
      </section>
      <button type="button" class="tbtn more-set" data-act="more" aria-expanded="${settingsMore}" aria-controls="m-more-settings">${t("settings.more")}</button>
      <div id="m-more-settings" class="more-settings"${settingsMore ? "" : " hidden"}>
      <section><h4>${t("settings.shortcuts")}</h4>${otherKeys}</section>
      <section><h4>${t("settings.voice")}</h4>
        <div class="srow"><div class="lbl"><span>${t("settings.autoSubmit")}</span><small>${t("settings.autoSubmit.help")}</small></div><div class="ctl">${switchHtml("autoSubmit", PREFS.voice.autoSubmit, t("settings.autoSubmit"))}</div></div>
        <div class="srow"><div class="lbl"><span>${t("settings.speech")}</span><small class="${v.ok ? "" : "warn"}">${esc(v.text)}</small></div><div class="ctl"><span class="pill ${v.ok ? "on" : ""}">${v.ok ? t("settings.ready") : t("settings.off")}</span></div></div>
      </section>
      <section><h4>${t("settings.appearance")}</h4>
        <div class="srow"><div class="lbl"><span>${t("settings.effects")}</span><small>${PREFS.effects ? t("settings.effects.help") : t("settings.effects.system")}</small></div><div class="ctl">${segHtml("effects", t("settings.effects"), [["full", t("settings.effects.full")], ["subtle", t("settings.effects.subtle")], ["off", t("settings.off")]], fx)}</div></div>
        <div class="srow"><div class="lbl"><span>${t("settings.position")}</span><small>${t("settings.position.help")}</small></div><div class="ctl">${segHtml("barPosition", t("settings.position"), [["auto", t("settings.position.auto")], ["top", t("settings.position.top")], ["bottom", t("settings.position.bottom")]], PREFS.barPosition)}</div></div>
      </section>
      ${modelSection()}
      <section><h4>${t("settings.changes")}</h4>
        <div class="srow"><div class="lbl"><span>${t("settings.polish")}</span><small>${t("settings.polish.help")}</small></div><div class="ctl">${switchHtml("polish", PREFS.polish, t("settings.polish"))}</div></div><!-- polish: core/polish.js -->
      </section>
      <section><h4>${t("settings.general")}</h4>
        <div class="srow"><div class="lbl"><span>${t("settings.welcome")}</span><small>${t("settings.welcome.help")}</small></div><div class="ctl">${switchHtml("welcome", PREFS.welcome, t("settings.welcome"))}</div></div>
        <div class="srow"><div class="lbl"><span>${t("settings.gallery")}</span><small>${t("settings.gallery.help")}</small></div><div class="ctl">${switchHtml("gallery", PREFS.gallery, t("settings.gallery"))}</div></div><!-- gallery hook: 68-gallery.js -->
      </section>
      <footer><button type="button" class="tbtn" data-act="reset-all">${t("settings.resetAll")}</button><span class="dim">${esc(S.mode === "extension" ? t("settings.synced") : S.mode === "desktop" ? t("settings.savedHere") : "")}</span></footer>
      </div>
    </div>`;
}
// models (core/route.js): Automatic, Always fast, Always best, and the two
// names. The names are set with morse setup / morse config, or in the popup.
function modelSection() {
  const m = S.models;
  if (!m) return "";
  const head = `<section><h4>${t("settings.model")}</h4>`;
  if (m.pinned) return `${head}<div class="srow"><div class="lbl"><span>${t("settings.model")}</span><small>${esc(t("settings.model.pinned", { model: m.pinned }))}</small></div></div></section>`;
  const mode = PREFS.modelMode || "auto";
  const note = t(`settings.model.note.${mode}`, { fast: m.fast, best: m.best });
  return `${head}
        <div class="srow"><div class="lbl"><span>${t("settings.model")}</span><small>${esc(note)}</small></div><div class="ctl">${segHtml("modelMode", t("settings.model"), [["auto", t("settings.model.auto")], ["fast", t("settings.model.fast")], ["best", t("settings.model.best")]], mode)}</div></div>
      </section>`;
}
// Language: "Same as my computer" (the default), or one of core/i18n.js LANGUAGES,
// each named in its own language. The label also says "Language" in English, so
// someone who picked a language by mistake can find the way back.
function languageRowHtml() {
  const sys = languageName(systemLanguage());
  const opts = [["", t("settings.language.system", { name: sys })], ...LANGUAGES.map(l => [l.code, l.name])];
  const label = t("settings.language");
  return `<div class="srow lang"><div class="lbl"><span>${esc(label)}${getLanguage() === "en" ? "" : ` <span class="dim">· <span lang="en" dir="ltr">Language</span></span>`}</span><small>${t("settings.language.help")}</small></div>
    <div class="ctl"><select class="field" data-k="language" aria-label="${esc(label)}">${opts.map(([v, name]) =>
      `<option value="${esc(v)}"${v === PREFS.language ? " selected" : ""}${v ? ` lang="${esc(v)}"` : ""}>${esc(name)}</option>`).join("")}</select></div></div>`;
}
const flagsOf = partial => ({ ctrl: /Ctrl/.test(partial), alt: /Alt/.test(partial), shift: /Shift/.test(partial), meta: /Meta/.test(partial) });

function flashSaved() {
  const s = pane.querySelector(".flash");
  if (!s) return;
  s.textContent = t("settings.saved");
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
  if (id !== "open") settingsMore = true; // its row is under More settings
  recording = { id, partial: "", error: "" };
  renderSettings();
  pane.querySelector(`[data-hk="${id}"]`)?.focus();
  announce(t("settings.recording.say"));
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
  announce(`${HOTKEY_ACTIONS.find(a => a.id === id).label}: ${hotkeyText(id) || t("settings.off")}. ${verdict?.message || ""}`);
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
  if (act === "more") { settingsMore = !settingsMore; renderSettings(); return pane.querySelector("[data-act=more]")?.focus(); }
  if (act === "reset-all") { for (const k in hkNotes) hkNotes[k] = null; return saveSetting(structuredClone(DEFAULT_PREFS), `[data-act="reset-all"]`); }
});
pane.addEventListener("change", e => {
  const k = e.target.dataset?.k;
  if (k === "autoSubmit") saveSetting({ voice: { autoSubmit: e.target.checked } }, `[data-k="autoSubmit"]`);
  if (k === "welcome") saveSetting({ welcome: e.target.checked }, `[data-k="welcome"]`);
  if (k === "gallery") saveSetting({ gallery: e.target.checked }, `[data-k="gallery"]`); // gallery hook: 68-gallery.js
  if (k === "autoFix") saveSetting({ autoFix: e.target.checked }, `[data-k="autoFix"]`); // self-heal hook: 71-heal.js
  if (k === "polish") saveSetting({ polish: e.target.checked }, `[data-k="polish"]`); // polish: core/polish.js
  if (k === "language") saveSetting({ language: e.target.value }, `[data-k="language"]`);
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
langSubs.add(() => { if (paneKind === "settings" && !recording) renderSettings(); }); // a language whose words came after the change (04-i18n.js)
