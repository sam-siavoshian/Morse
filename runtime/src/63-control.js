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

// perf: boot.js applies mods before the UI exists, so it owns this state
// (same shape: pause, off, held, suspect, tab): it reads morse:off and
// morse:tab from sessionStorage and asks control.boot once per load (the
// host's off switch wins over a page that cleared its storage).
const Control = B.control;
// (HOTKEY_HELP.off, the words for the off switch's shortcut: 56-settings.js)

const here = () => ({ url: location.href, app: S.app });
const hereName = () => S.appName || controlKey(here());
// dogfood: in a desktop app the off switch says "in Obsidian", not "on this page"
const offWords = id => (S.mode === "desktop" && S.appName ? `${id}App` : id);
const pausedHere = () => isPaused({ pause: Control.pause }, here());
function modHeld(m) { return Control.off || pausedHere() || Control.held.has(m.id); }
const running = m => !!m.enabled && !modHeld(m);

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

// The host keeps it (control.off), where the page can't clear it; the
// sessionStorage copy is for hosts that don't.
function rememberOff() {
  try { Control.off ? sessionStorage.setItem("morse:off", "1") : sessionStorage.removeItem("morse:off"); } catch {}
  ctl("control.off", { on: Control.off });
}
async function offSwitch() {
  if (Control.off) return turnBackOn();
  const { off } = await changeHeld(() => { Control.off = true; rememberOff(); });
  controlToast(off ? t(offWords("ctl.offN"), { n: off, app: S.appName }) : t(offWords("ctl.offNone"), { app: S.appName }), [[t("ctl.turnBackOn"), turnBackOn]]);
  announce?.(t(offWords("ctl.offSay"), { app: S.appName }));
}
async function turnBackOn() {
  const { on } = await changeHeld(() => { Control.off = false; rememberOff(); });
  if (pausedHere()) return controlToast(Control.pause.all ? t("ctl.stillPausedAll") : t("ctl.stillPausedOn", { where: hereName() }), [[t("ctl.resume"), resumeHere]]);
  controlToast(on ? t("ctl.onN", { n: on }) : t("ctl.backOn"));
}

// ---- pause here / everywhere

async function applyPause(pause) {
  if (pause && typeof pause === "object") await changeHeld(() => { Control.pause = normalizeControl({ pause }).pause; });
}
async function setPauseHere(on) {
  const r = await ctl("control.pause", { scope: "site", on });
  await applyPause(r?.pause || setPause({ pause: Control.pause }, { key: controlKey(here()), on }).pause);
  controlToast(on ? t("ctl.pausedOnToast", { where: hereName() }) : t("ctl.backOnFor", { where: hereName() }), on ? [[t("btn.undo"), () => setPauseHere(false)]] : []);
}
async function setPauseAll(on) {
  const r = await ctl("control.pause", { scope: "all", on });
  await applyPause(r?.pause || setPause({ pause: Control.pause }, { all: on }).pause);
  controlToast(on ? t("ctl.pausedAllToast") : t("ctl.backAll"));
}
async function resumeHere() {
  if (Control.pause.all) await setPauseAll(false);
  if (Control.pause.sites?.[controlKey(here())]) await setPauseHere(false);
}
// The share page's Install button. Any page can ask, so this only opens the
// review (one at a time); installing takes a click inside it.
function installRequest(source) {
  if (typeof source === "string" && modal.hidden) reviewImport(source, { onDone: r => window.postMessage({ morseInstalled: r }, "*") });
}
onEvent(msg => {
  if (msg.type === "control.changed") applyPause(msg.pause);
  if (msg.type === "install.request") installRequest(msg.source);
});
document.documentElement.dataset.morseShare = "1"; // the share page hands its link to Morse (not data-morse: that marks Morse's own UI)
listen("message", e => { if (e.source === window && e.data?.morseInstall) installRequest(e.data.morseInstall); });

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
  if (typeof r.off === "boolean") Control.off = r.off;
  if (r.suspect?.id) { Control.suspect = r.suspect; Control.held.add(r.suspect.id); }
}
function controlReady() {
  const sus = Control.suspect;
  const m = sus && S.mods.find(x => x.id === sus.id);
  if (sus && (!m || !m.enabled)) { forgive(sus.id); }
  else if (m) showSuspect(m);
  else if (Control.off && S.mods.some(x => x.enabled)) controlToast(t(offWords("ctl.offNone"), { app: S.appName }), [[t("ctl.turnBackOn"), turnBackOn]]);
}
function forgive(id) {
  Control.held.delete(id);
  if (Control.suspect?.id === id) Control.suspect = null;
  ctl("control.forgive");
}
function showSuspect(m) {
  controlToast(t("ctl.suspect", { title: m.title }),
    [[t("ctl.keepOff"), () => keepOff(m)], [t("ctl.turnItBackOn"), () => runAgain(m)]], { sticky: true, title: t("ctl.safeStart") });
}
async function keepOff(m) {
  m.enabled = false;
  await call("mods.save", { mod: m }).catch(() => {});
  forgive(m.id);
  if (!panel.hidden) renderPanel();
  controlToast(t("ctl.keptOff", { title: m.title }));
}
async function runAgain(m) {
  await changeHeld(() => forgive(m.id));
  controlToast(t("ctl.isBackOn", { title: m.title }));
}

// ---- toast with actions (the plain toast() can't hold buttons)

const ctlToast = document.createElement("div");
ctlToast.className = "ctl-toast";
ctlToast.hidden = true;
ctlToast.setAttribute("role", "group");
ctlToast.setAttribute("aria-label", "Morse");
root.append(ctlToast);
let ctlToastTimer = 0;
function controlToast(msg, actions = [], { sticky = false, title = "" } = {}) {
  toastEl.hidden = true;
  ctlToast.classList.toggle("inline", actions.length <= 1 && msg.length < 60);
  ctlToast.innerHTML = `<div class="ctl-msg">${radar(12)}<span>${title ? `<b>${esc(title)}</b> ` : ""}${esc(msg)}</span></div>
    ${actions.length ? `<div class="ctl-acts">${actions.map(([label], i) => `<button class="btn${i === actions.length - 1 ? " primary" : ""}" data-i="${i}">${esc(label)}</button>`).join("")}</div>` : ""}
    <button class="ibtn xs close ctl-x" data-i="-1" title="${esc(t("btn.close"))}" aria-label="${esc(t("btn.close"))}">×</button>`;
  ctlToast.hidden = false;
  // Said once, with what can be done; it stays while it has focus or the pointer.
  announce(`${title ? title + " " : ""}${msg}${actions.length ? `. ${actions.map(([l]) => l).join(" or ")}, in Morse's message at the bottom of the page.` : ""}`, { again: true });
  ctlToast.onclick = e => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    ctlToast.hidden = true;
    clearTimeout(ctlToastTimer);
    actions[+b.dataset.i]?.[1]();
  };
  clearTimeout(ctlToastTimer);
  const later = () => { if (!sticky) ctlToastTimer = setTimeout(() => (ctlToast.hidden = true), actions.length ? 8000 : 3200); };
  ctlToast.onmouseenter = ctlToast.onfocusin = () => clearTimeout(ctlToastTimer);
  ctlToast.onmouseleave = ctlToast.onfocusout = e => { if (!ctlToast.contains(e.relatedTarget) && !ctlToast.matches(":hover")) later(); };
  later();
}

// ---- plain-language summary (install review, Show code)

// Same rule as modMatches (core/summary.js modHosts): no host list means every website.
const whereFor = m => whereRuns(m);
const everywhere = m => !m.match?.app && !!modHosts(m)?.includes("*");
function summaryHtml(m) {
  const s = summarizeMod(m);
  if (s.empty) return `<ul class="ctl-items"><li><b>${t("sum.empty")}</b><small>${t("install.noCode")}</small></li></ul>`;
  return `<ul class="ctl-items">${s.items.map(i => `<li data-s="${i.id}"><b>${esc(i.text)}</b>${i.detail ? `<small>${esc(i.detail)}</small>` : ""}</li>`).join("")}</ul>
    ${s.notes.map(n => `<p class="ctl-warn" data-s="${n.id}"><b>${t("ctl.note")}</b>${esc(n.text)}</p>`).join("")}`;
}
function codeHtml(m) {
  return `${m.css.trim() ? `<label>${t("code.style")} <span class="dim">CSS</span></label><pre class="code ctl-pre" tabindex="0" role="region" aria-label="${esc(t("code.styleCode"))}">${esc(shownCode(m.css.trim()))}</pre>` : ""}
    ${m.js.trim() ? `<label>${t("code.script")} <span class="dim">${t("code.scriptRuns")}</span></label><pre class="code ctl-pre" tabindex="0" role="region" aria-label="${esc(t("code.scriptCode"))}">${esc(shownCode(m.js.trim()))}</pre>` : ""}
    ${!m.css.trim() && !m.js.trim() ? `<p class="dim">${t("ctl.noCode")}</p>` : ""}`;
}

// Read-only: what it does, where it came from, then the code.
function showModCode(m) {
  openModal(`
    <header><b>${esc(m.title)}</b><small>“${esc(m.prompt)}”</small><button data-a="close" aria-label="${esc(t("btn.close"))}">×</button></header>
    <p class="ctl-from">${esc(t("ctl.runsOn", { origin: modOrigin(m), where: whereFor(m) }))}</p>
    <h4 class="ctl-h eyebrow">${t("ctl.whatItDoes")}</h4>
    ${summaryHtml(m)}
    ${codeHtml(m)}
    <footer><button data-c="edit">${t("btn.editCode")}</button><button class="primary" data-a="close">${t("btn.done")}</button></footer>`);
  modal.querySelector("[data-c=edit]").onclick = () => showCode(m);
}

// Before anything is installed: what each mod does, the code folded below,
// and an explicit Install. Nothing is saved until Install is pressed.
// trial: { run(mod) } turns it into the review before trying one mod (Mods for
// this site, 68-gallery.js): the same review, with Try it instead of Install.
async function reviewImport(source, { onDone, trial = null } = {}) {
  const done = r => { const f = onDone; onDone = null; f?.(r); };
  if (!trial && Packs.isAddress(source)) return Packs.reviewAddress(source, { onDone: done }); // packs hook: a pack's address (69-packs.js)
  let r;
  try { r = await call("mods.preview", { source }); }
  catch (e) { const msg = plainError(e); toast(msg); return done({ error: msg }); }
  if (r?.kind === "pack" && !trial) return Packs.review(r, { source, onDone: done }); // packs hook: the pack review (69-packs.js)
  if (!r?.mods?.length) { const e = t("ctl.notShare"); toast(e); return done({ error: e }); }
  if (trial) r.mods = r.mods.slice(0, 1);
  const many = r.mods.length > 1;
  const hostHere = controlKey(here());
  const other = m => !m.match?.app && !(modHosts(m) || []).some(h => h === "*" || h === hostHere || (h.startsWith("*.") && hostHere.endsWith(h.slice(1))));
  applyTheme();
  openModal(`
    <header><b>${trial ? t("ctl.tryTitle", { title: esc(r.mods[0].title) }) : many ? t("ctl.installMany", { n: r.mods.length }) : t("ctl.installOne", { title: esc(r.mods[0].title) })}</b>
      <small>${trial ? t("ctl.trySub") : `${r.kind === "backup" ? t("ctl.fromBackup") : ""}${t("ctl.installSub", { n: r.mods.length })}`}</small>
      <button data-a="close" aria-label="${esc(t("btn.close"))}">×</button></header>
    ${r.mods.map(m => `<section class="ctl-review">
      ${many ? `<h3>${esc(m.title)}</h3>` : ""}
      <p class="ctl-prompt">“${esc(m.prompt)}”</p>
      <p class="ctl-from">${esc(t("ctl.for", { where: whereFor(m) }))}${m.author ? esc(t("ctl.madeBy", { author: m.author })) : ""}${m.model ? esc(t("ctl.writtenBy", { model: m.model })) : ""}${other(m) ? ` · <span>${t("ctl.notThisPage")}</span>` : ""}</p>
      <h4 class="ctl-h eyebrow">${t("ctl.whatItDoes")}</h4>
      ${summaryHtml(m)}
      ${everywhere(m) ? `<p class="ctl-warn" data-s="everywhere"><b>${t("ctl.note")}</b>${esc(t("install.everywhere"))}</p>`
        : broadEndings(m).length ? `<p class="ctl-warn" data-s="everywhere"><b>${t("ctl.note")}</b>${esc(t("install.broad", { endings: broadEndings(m).join(t("install.or")) }))}</p>` : ""}
      <details class="ctl-code"><summary>${t("ctl.showCode")}</summary>${codeHtml(m)}</details>
    </section>`).join("")}
    ${r.errors?.length ? `<p class="dim ctl-skip">${esc(t("ctl.skipped", { list: r.errors.join("; ") }))}</p>` : ""}
    <footer><button data-a="close">${t("btn.cancel")}</button><button class="primary" data-a="install" data-settle>${trial ? t("ctl.tryIt") : t("ctl.installN", { n: r.mods.length })}</button></footer>`, { review: true }); // top layer, 80-modals.js
  modal.querySelector(".card").classList.add("ctl-card");
  modal.querySelector("[data-a=close]:not(header [data-a])")?.focus(); // Cancel, never Install: a page could make someone press Enter
  const watch = new MutationObserver(() => { if (modal.hidden) { watch.disconnect(); done({ error: t("ctl.cancelled") }); } });
  watch.observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  modal.querySelector("[data-a=install]").onclick = async e => {
    if (trial) { watch.disconnect(); modal.hidden = true; done({ title: r.mods[0].title }); return trial.run(r.mods[0]); }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.dataset.settle = "busy"; // a review brought back on top doesn't turn it on again mid-install (80-modals.js)
    try {
      const saved = await call("control.install", { url: location.href, app: S.app, mods: r.mods, kind: r.kind });
      watch.disconnect();
      modal.hidden = true;
      toast(saved.length === 1 ? t("ctl.installedOne", { title: saved[0].title }) : t("ctl.installedMany", { n: saved.length }));
      done({ title: saved.map(m => m.title).join(", ") });
      await syncMods();
    } catch (err) { btn.disabled = false; btn.dataset.settle = ""; toast(plainError(err)); }
  };
}

// ---- export and import

async function exportAll() {
  const r = await ctl("control.exportAll");
  if (!r) return toast(t("ctl.noBackup"));
  try {
    const saved = await call("export", { filename: r.filename, content: r.content });
    toast(t("ctl.savedN", { n: r.count, path: saved?.path || r.filename }));
  } catch (e) { toast(plainError(e)); }
}
function importFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    if (f.size > 5_000_000) return toast(t("ctl.tooLarge"));
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
    Control.pause.all && `<div class="ctl-note"><span>${t("ctl.pausedAllNote")}</span><button data-c="resume-all">${t("ctl.resume")}</button></div>`,
    Control.off && `<div class="ctl-note"><span>${esc(t(offWords("ctl.offNote"), { app: S.appName }))}</span><button data-c="back-on">${t("ctl.turnBackOn")}</button></div>`,
    sus && `<div class="ctl-note"><span>${t("ctl.heldNote", { title: esc(sus.title) })}</span><button data-c="keep-off">${t("ctl.keepOff")}</button><button data-c="run-again">${t("btn.turnOn")}</button></div>`,
  ].filter(Boolean).join("");
  panel.querySelector("header")?.insertAdjacentHTML("afterend", `<div class="ctl-strip">
    <label class="ctl-row"><span class="ctl-l"><span>${esc(t("ctl.pauseOn", { site: where }))}</span><small>${site ? t("ctl.pausedHere2") : S.mode === "desktop" && S.app ? t("ctl.stopsApp") : t("ctl.pauseHere.help")}</small></span>
      <span class="sw"><input type="checkbox" data-c="pause-site" ${site ? "checked" : ""} aria-label="${esc(t("ctl.pauseOn", { site: where }))}"><span></span></span></label>
    ${notes}</div>`);
  panel.querySelector("footer")?.insertAdjacentHTML("beforebegin", `<div class="ctl-backup"><span class="eyebrow">${t("ctl.backup")}</span><button data-c="export">${t("ctl.exportAll")}</button></div>`); // simplify: Install from a file… is in Install a mod… (80-modals.js)
}
// Each row in the list (re-run whenever the list is redrawn, e.g. by search).
function controlRows() {
  for (const a of panel.querySelectorAll(".list article[data-id]")) {
    const m = S.mods.find(x => x.id === a.dataset.id);
    const meta = a.querySelector(".meta");
    if (!m || !meta) continue;
    const tags = meta.querySelector(".tags");
    (tags || meta).insertAdjacentHTML("beforebegin", `<small class="ctl-origin">${esc(modOrigin(m))}</small>`); // Show code is in the row's More (70-panel.js)
    if (m.enabled && modHeld(m)) tags?.insertAdjacentHTML("afterbegin", `<span>${t("ctl.notRunning")}</span>`);
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
  const el = e.target;
  if (el.dataset?.c === "pause-site") setPauseHere(el.checked);
  // Turning a held-back mod on by hand is a decision: let it run.
  if (el.dataset?.a === "toggle" && el.checked) {
    const id = el.closest("article")?.dataset.id;
    if (id && Control.held.has(id)) { const m = S.mods.find(x => x.id === id); changeHeld(() => forgive(id)).then(() => m && controlToast(t("ctl.isBackOn", { title: m.title }))); }
  }
});
