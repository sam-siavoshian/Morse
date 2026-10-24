// User control and trust: the off switch, pausing Morse here or everywhere,
// safe start, the review before installing, where each mod came from, Show
// code, and export/import. The host side is core/control-host.js; the plain
// words come from core/summary.js and the pause/safe-start rules from
// core/control.js (both inlined by runtime/bundle.js).
//
// Hooks elsewhere (one marked line each): 30-mods.js applyMod (modHeld,
// modRan), 70-panel.js renderPanel (controlPanel), 80-modals.js showImport
// (reviewImport), 95-keys.js (offSwitch), 96-shortcuts.js, 97-boot.js
// (controlBoot, controlReady), 10-dom.js (CONTROL_CSS).

const Control = {
  pause: { all: false, sites: {} },
  off: false,       // the off switch: every mod off in this tab until turned back on (survives reloads)
  held: new Set(),  // safe start: mods held back on this load
  suspect: null,
  tab: "",          // tells this tab's loads apart from other tabs of the same site
};
try { Control.off = sessionStorage.getItem("morse:off") === "1"; } catch {}
try {
  Control.tab = sessionStorage.getItem("morse:tab") || uid();
  sessionStorage.setItem("morse:tab", Control.tab);
} catch {}
if (typeof HOTKEY_HELP === "object") HOTKEY_HELP.off = "Turn off every mod on this page at once";

const here = () => ({ url: location.href, app: S.app });
const hereName = () => S.appName || controlKey(here());
const pausedHere = () => isPaused({ pause: Control.pause }, here());
function modHeld(m) { return Control.off || pausedHere() || Control.held.has(m.id); }
const running = m => !!m.enabled && !modHeld(m);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Requests that older hosts (and demo hosts) may not answer.
function ctl(type, payload = {}, ms = 4000) {
  return Promise.race([
    call(type, { url: location.href, app: S.app, tab: Control.tab, ...payload }),
    new Promise(r => setTimeout(() => r(null), ms)),
  ]).catch(() => null);
}

// Applies a change to what's held, then turns mods off or on to match. CSS
// goes first and synchronously, so the off switch is instant.
async function changeHeld(fn) {
  const before = new Map(S.mods.map(m => [m.id, running(m)]));
  fn();
  const off = S.mods.filter(m => before.get(m.id) && !running(m));
  const on = S.mods.filter(m => !before.get(m.id) && running(m));
  off.forEach(m => setCss(m.id, ""));
  await Promise.all(off.filter(m => m.js.trim()).map(m => call("off", { modId: m.id }).catch(() => {})));
  for (const m of on) await applyMod(m);
  if (!panel.hidden) renderPanel();
  return { off: off.length, on: on.length };
}

// ---- the off switch (⌥⇧0 / Alt+Shift+0 by default)

function rememberOff() {
  try { Control.off ? sessionStorage.setItem("morse:off", "1") : sessionStorage.removeItem("morse:off"); } catch {}
}
async function offSwitch() {
  if (Control.off) return turnBackOn();
  const { off } = await changeHeld(() => { Control.off = true; rememberOff(); });
  controlToast(off ? `Turned off ${plural(off, "mod")} on this page` : "Mods are off on this page", [["Turn back on", turnBackOn]]);
  announce?.("All mods are off on this page.");
}
async function turnBackOn() {
  const { on } = await changeHeld(() => { Control.off = false; rememberOff(); });
  if (pausedHere()) return controlToast(`Morse is still paused ${Control.pause.all ? "everywhere" : `on ${hereName()}`}.`, [["Resume", resumeHere]]);
  controlToast(on ? `Turned ${plural(on, "mod")} back on` : "Mods are back on");
}

// ---- pause here / everywhere

async function applyPause(pause) {
  if (pause && typeof pause === "object") await changeHeld(() => { Control.pause = normalizeControl({ pause }).pause; });
}
async function setPauseHere(on) {
  const r = await ctl("control.pause", { scope: "site", on });
  await applyPause(r?.pause || setPause({ pause: Control.pause }, { key: controlKey(here()), on }).pause);
  controlToast(on ? `Paused Morse on ${hereName()}. Your mods are saved.` : `Morse is back on for ${hereName()}`, on ? [["Undo", () => setPauseHere(false)]] : []);
}
async function setPauseAll(on) {
  const r = await ctl("control.pause", { scope: "all", on });
  await applyPause(r?.pause || setPause({ pause: Control.pause }, { all: on }).pause);
  controlToast(on ? "Paused Morse everywhere" : "Morse is back on everywhere");
}
async function resumeHere() {
  if (Control.pause.all) await setPauseAll(false);
  if (Control.pause.sites?.[controlKey(here())]) await setPauseHere(false);
}
onEvent(msg => {
  if (msg.type === "control.changed") applyPause(msg.pause);
  // From the share page, through the extension. Any page can ask, so this only
  // opens the review (one at a time); installing takes a click inside it.
  if (msg.type === "install.request" && typeof msg.source === "string" && modal.hidden) {
    reviewImport(msg.source, { onDone: r => window.postMessage({ morseInstalled: r }, "*") });
  }
});

// ---- safe start

let aliveTimers = [];
function modRan(m) {
  ctl("control.applied", { mod: { id: m.id, title: m.title, updated: m.updated || "", js: !!m.js.trim() } });
  aliveTimers.forEach(clearTimeout);
  aliveTimers = [2000, 5000, SAFE_WINDOW + 1000].map(ms => setTimeout(() => ctl("control.alive"), ms));
}
async function controlBoot() {
  const r = await ctl("control.boot", {}, 2500);
  if (!r) return;
  if (r.pause) Control.pause = normalizeControl({ pause: r.pause }).pause;
  if (r.suspect?.id) { Control.suspect = r.suspect; Control.held.add(r.suspect.id); }
}
function controlReady() {
  const sus = Control.suspect;
  const m = sus && S.mods.find(x => x.id === sus.id);
  if (sus && (!m || !m.enabled)) { forgive(sus.id); }
  else if (m) showSuspect(m);
  else if (Control.off && S.mods.some(x => x.enabled)) controlToast("Mods are off on this page", [["Turn back on", turnBackOn]]);
}
function forgive(id) {
  Control.held.delete(id);
  if (Control.suspect?.id === id) Control.suspect = null;
  ctl("control.forgive");
}
function showSuspect(m) {
  controlToast(`“${m.title}” is off for now. This page closed or reloaded within seconds after it ran, more than once.`,
    [["Keep it off", () => keepOff(m)], ["Turn it back on", () => runAgain(m)]], { sticky: true, title: "Safe start" });
}
async function keepOff(m) {
  m.enabled = false;
  await call("mods.save", { mod: m }).catch(() => {});
  forgive(m.id);
  if (!panel.hidden) renderPanel();
  controlToast(`“${m.title}” is turned off. You can turn it on again in the Mods panel.`);
}
async function runAgain(m) {
  await changeHeld(() => forgive(m.id));
  controlToast(`“${m.title}” is back on`);
}

// ---- toast with actions (the plain toast() can't hold buttons)

const ctlToast = document.createElement("div");
ctlToast.className = "ctl-toast";
ctlToast.hidden = true;
ctlToast.setAttribute("role", "status");
ctlToast.setAttribute("aria-live", "polite");
root.append(ctlToast);
let ctlToastTimer = 0;
function controlToast(msg, actions = [], { sticky = false, title = "" } = {}) {
  toastEl.hidden = true;
  ctlToast.classList.toggle("inline", actions.length <= 1 && msg.length < 60);
  ctlToast.innerHTML = `<div class="ctl-msg">${radar(12)}<span>${title ? `<b>${esc(title)}</b> ` : ""}${esc(msg)}</span></div>
    ${actions.length ? `<div class="ctl-acts">${actions.map(([label], i) => `<button data-i="${i}"${i === actions.length - 1 ? ` class="primary"` : ""}>${esc(label)}</button>`).join("")}</div>` : ""}
    <button class="ctl-x" data-i="-1" title="Close" aria-label="Close">×</button>`;
  ctlToast.hidden = false;
  ctlToast.onclick = e => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    ctlToast.hidden = true;
    clearTimeout(ctlToastTimer);
    actions[+b.dataset.i]?.[1]();
  };
  clearTimeout(ctlToastTimer);
  const later = () => { if (!sticky) ctlToastTimer = setTimeout(() => (ctlToast.hidden = true), actions.length ? 8000 : 3200); };
  ctlToast.onmouseenter = () => clearTimeout(ctlToastTimer);
  ctlToast.onmouseleave = later;
  later();
}

// ---- plain-language summary (install review, Show code)

function whereFor(m) {
  return m.match?.app || (m.match?.hosts || []).map(h => (h === "*" ? "every site" : h === "file" ? "local files" : h)).join(", ") || "this page";
}
function summaryHtml(m) {
  const s = summarizeMod(m);
  if (s.empty) return `<ul class="ctl-items"><li><b>Doesn't change anything</b><small>It has no code.</small></li></ul>`;
  return `<ul class="ctl-items">${s.items.map(i => `<li data-s="${i.id}"><b>${esc(i.text)}</b>${i.detail ? `<small>${esc(i.detail)}</small>` : ""}</li>`).join("")}</ul>
    ${s.notes.map(n => `<p class="ctl-warn" data-s="${n.id}"><b>Note</b>${esc(n.text)}</p>`).join("")}`;
}
function codeHtml(m) {
  return `${m.css.trim() ? `<label>Style <span class="dim">CSS</span></label><pre class="code ctl-pre">${esc(m.css.trim())}</pre>` : ""}
    ${m.js.trim() ? `<label>Script <span class="dim">JavaScript, runs with the <code>morse</code> helpers</span></label><pre class="code ctl-pre">${esc(m.js.trim())}</pre>` : ""}
    ${!m.css.trim() && !m.js.trim() ? `<p class="dim">No code.</p>` : ""}`;
}

// Read-only: what it does, where it came from, then the code.
function showModCode(m) {
  openModal(`
    <header><b>${esc(m.title)}</b><small>“${esc(m.prompt)}”</small><button data-a="close" aria-label="Close">×</button></header>
    <p class="ctl-from">${esc(modOrigin(m))} · runs on ${esc(whereFor(m))}</p>
    <h4 class="ctl-h">What it does</h4>
    ${summaryHtml(m)}
    ${codeHtml(m)}
    <footer><button data-c="edit">Edit code</button><button class="primary" data-a="close">Done</button></footer>`);
  modal.querySelector("[data-c=edit]").onclick = () => showCode(m);
}

// Before anything is installed: what each mod does, the code folded below,
// and an explicit Install. Nothing is saved until Install is pressed.
async function reviewImport(source, { onDone } = {}) {
  const done = r => { const f = onDone; onDone = null; f?.(r); };
  let r;
  try { r = await call("mods.preview", { source }); }
  catch (e) { const msg = plainError(e); toast(msg); return done({ error: msg }); }
  if (!r?.mods?.length) { const e = "This isn't a Morse share link or mod file. Check that you copied all of it."; toast(e); return done({ error: e }); }
  const many = r.mods.length > 1;
  const hostHere = controlKey(here());
  const other = m => !m.match?.app && !(m.match?.hosts || []).some(h => h === "*" || h === hostHere || (h.startsWith("*.") && hostHere.endsWith(h.slice(1))));
  applyTheme();
  openModal(`
    <header><b>${many ? `Install ${r.mods.length} mods?` : `Install “${esc(r.mods[0].title)}”?`}</b>
      <small>${r.kind === "backup" ? "From a backup file. " : ""}Here is what ${many ? "they do" : "it does"}. Nothing is installed until you press Install.</small>
      <button data-a="close" aria-label="Close">×</button></header>
    ${r.mods.map(m => `<section class="ctl-review">
      ${many ? `<h3>${esc(m.title)}</h3>` : ""}
      <p class="ctl-prompt">“${esc(m.prompt)}”</p>
      <p class="ctl-from">For ${esc(whereFor(m))}${m.author ? ` · made by ${esc(m.author)}` : ""}${m.model ? ` · written by ${esc(m.model)}` : ""}${other(m) ? ` · <span>not this page</span>` : ""}</p>
      <h4 class="ctl-h">What it does</h4>
      ${summaryHtml(m)}
      <details class="ctl-code"><summary>Show code</summary>${codeHtml(m)}</details>
    </section>`).join("")}
    ${r.errors?.length ? `<p class="dim ctl-skip">Skipped ${esc(r.errors.join("; "))}</p>` : ""}
    <footer><button data-a="close">Cancel</button><button class="primary" data-a="install">Install${many ? ` ${r.mods.length}` : ""}</button></footer>`);
  modal.querySelector(".card").classList.add("ctl-card");
  modal.querySelector("[data-a=close]:not(header [data-a])")?.focus(); // Cancel, never Install: a page could make someone press Enter
  const watch = new MutationObserver(() => { if (modal.hidden) { watch.disconnect(); done({ error: "Not installed. You cancelled it." }); } });
  watch.observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  modal.querySelector("[data-a=install]").onclick = async e => {
    e.currentTarget.disabled = true;
    try {
      const saved = await call("control.install", { url: location.href, app: S.app, mods: r.mods, kind: r.kind });
      watch.disconnect();
      modal.hidden = true;
      toast(saved.length === 1 ? `Installed “${saved[0].title}”` : `Installed ${saved.length} mods`);
      done({ title: saved.map(m => m.title).join(", ") });
      await syncMods();
    } catch (err) { e.currentTarget.disabled = false; toast(plainError(err)); }
  };
}

// ---- export and import

async function exportAll() {
  const r = await ctl("control.exportAll");
  if (!r) return toast("This version of Morse can't back up mods. Update Morse and try again.");
  try {
    const saved = await call("export", { filename: r.filename, content: r.content });
    toast(`Saved ${plural(r.count, "mod")} to ${saved?.path || r.filename}`);
  } catch (e) { toast(plainError(e)); }
}
function importFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    if (f.size > 5_000_000) return toast("That file is too large to be a Morse backup.");
    reviewImport(await f.text());
  };
  input.click();
}

// ---- the Mods panel: pause switch, notices and backup (controlPanel, from
// renderPanel), where each mod came from and Show code (controlRows, from renderList)

function controlPanel() {
  const where = hereName();
  const site = !!Control.pause.sites?.[controlKey(here())];
  const sus = Control.suspect && S.mods.find(m => m.id === Control.suspect.id && Control.held.has(m.id));
  const notes = [
    Control.pause.all && `<div class="ctl-note"><span>Morse is paused everywhere. Your mods are saved but not running.</span><button data-c="resume-all">Resume</button></div>`,
    Control.off && `<div class="ctl-note"><span>Mods are turned off on this page.</span><button data-c="back-on">Turn back on</button></div>`,
    sus && `<div class="ctl-note"><span>“${esc(sus.title)}” is held back: this page closed or reloaded right after it ran.</span><button data-c="keep-off">Keep it off</button><button data-c="run-again">Turn on</button></div>`,
  ].filter(Boolean).join("");
  panel.querySelector("header")?.insertAdjacentHTML("afterend", `<div class="ctl-strip">
    <label class="ctl-row"><span class="ctl-l"><span>Pause Morse on ${esc(where)}</span><small>${site ? "Your mods here are saved but not running" : "Stops every mod on this site"}</small></span>
      <span class="sw"><input type="checkbox" data-c="pause-site" ${site ? "checked" : ""} aria-label="Pause Morse on ${esc(where)}"><span></span></span></label>
    ${notes}</div>`);
  panel.querySelector("footer")?.insertAdjacentHTML("beforebegin", `<div class="ctl-backup"><span>Backup</span><button data-c="export">Export all mods</button><button data-c="import-file">Install from a file…</button></div>`);
}
// Each row in the list (re-run whenever the list is redrawn, e.g. by search).
function controlRows() {
  for (const a of panel.querySelectorAll(".list article[data-id]")) {
    const m = S.mods.find(x => x.id === a.dataset.id);
    const meta = a.querySelector(".meta");
    if (!m || !meta) continue;
    const tags = meta.querySelector(".tags");
    const show = `<button class="ctl-link" data-c="show" title="What it does, and its code">Show code</button>`;
    (tags || meta).insertAdjacentHTML("beforebegin", `<small class="ctl-origin">${esc(modOrigin(m))}</small>`);
    if (tags) tags.insertAdjacentHTML("beforeend", show); else meta.insertAdjacentHTML("beforeend", show);
    if (m.enabled && modHeld(m)) tags?.insertAdjacentHTML("afterbegin", `<span>not running</span>`);
  }
}
panel.addEventListener("click", e => {
  const b = e.target.closest("button[data-c]");
  if (!b) return;
  const m = S.mods.find(x => x.id === b.closest("article")?.dataset.id);
  const c = b.dataset.c;
  if (c === "show" && m) showModCode(m);
  if (c === "export") exportAll();
  if (c === "import-file") importFile();
  if (c === "resume-all") setPauseAll(false);
  if (c === "back-on") turnBackOn();
  const sus = Control.suspect && S.mods.find(x => x.id === Control.suspect.id);
  if (c === "keep-off" && sus) keepOff(sus);
  if (c === "run-again" && sus) runAgain(sus);
});
panel.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset?.c === "pause-site") setPauseHere(t.checked);
  // Turning a held-back mod on by hand is a decision: let it run.
  if (t.dataset?.a === "toggle" && t.checked) {
    const id = t.closest("article")?.dataset.id;
    if (id && Control.held.has(id)) { const m = S.mods.find(x => x.id === id); changeHeld(() => forgive(id)).then(() => m && controlToast(`“${m.title}” is back on`)); }
  }
});
