// Toolbar popup, and (with <body data-page="options">) the options page.
import "./i18n-page.js"; // the page in the person's language, before anything below runs
import { t } from "./core/i18n.js";
import { plainError } from "./core/onboarding.js";
import { normalizePrefs } from "./core/prefs.js";
import { detectPlatform, resolveHotkeys, formatCombo } from "./core/hotkeys.js";
import { modExtras } from "./popup-control.js"; // user control: pause switches, where each mod came from, Show code
import { DOWNLOAD } from "./core/links.js";
const $ = id => document.getElementById(id);
const isOptions = document.body.dataset.page === "options";
const [tab] = isOptions ? [null] : await chrome.tabs.query({ active: true, currentWindow: true });

// The Open Morse shortcut as set in the bar's settings (bar-host.js keeps them
// in chrome.storage.sync, or local when sync is unavailable).
async function openHotkey() {
  let stored;
  try { stored = (await chrome.storage.sync.get("morse.settings"))["morse.settings"]; } catch {}
  if (stored === undefined) stored = (await chrome.storage.local.get("morse.settings"))["morse.settings"];
  const platform = detectPlatform(navigator);
  const open = resolveHotkeys(normalizePrefs(stored).hotkeys, platform).open;
  return open && open !== "none" ? formatCombo(open, platform) : "";
}
{
  const key = await openHotkey().catch(() => "");
  $("key").textContent = key;
  $("key").hidden = !key;
}

// ?url= lets the popup be opened as a page (screenshots, debugging).
const url = new URLSearchParams(location.search).get("url") || tab?.url || "";
const send = msg => chrome.runtime.sendMessage({ ...msg, url });

// The marks of the models (brand/, desktop-app/ui/icons/NOTICE), for the Morse app's card below.
const MARK_OF = { "claude-code": ["claude"], codex: ["openai"], anthropic: ["anthropic"], openai: ["openai"] };
const marks = p => (MARK_OF[p] || []).map(n => `<img src="brand/${n}.png" alt=""${n === "claude" ? "" : ' class="mono"'}>`).join("");
let devOpened = false;
let st = await send({ type: "popup.state" });
render(st);

function render(s) {
  st = s;
  $("label").textContent = s.label;
  $("page").hidden = isOptions;
  // Without “Allow User Scripts” a mod's code doesn't run (background.js cantRun): say which mods here wait for it.
  const waits = m => !s.userScripts && m.enabled && !!m.js?.trim();
  const waiting = s.mods.filter(waits);
  $("warn").hidden = s.userScripts || !waiting.length; // onboarding v2: only when a mod here needs it
  $("warntext").innerHTML = waiting.length
    ? t("popup.waiting", { n: waiting.length, list: waiting.map(m => `“${esc(m.title)}”`).join(", ") })
    : t("popup.warnOff");
  $("count").textContent = s.mods.length ? `· ${s.mods.length}` : "";
  $("mods").innerHTML = s.mods.length
    ? s.mods.map(m => `<li><i class="${m.enabled ? "on" : ""}"></i>${esc(m.title)}<small>“${esc(m.prompt)}”</small>${waits(m) ? `<small class="waiting">${esc(t("popup.waits"))}</small>` : ""}${modExtras(m)}</li>`).join("")
    : `<li class="empty">${esc(t("popup.noMods"))}</li>`;

  renderApp(s);

  // Auto (no explicit choice): show whichever is in use, else the helper.
  const backend = s.backend || (s.kind === "anthropic" ? "anthropic" : "helper");
  for (const r of document.querySelectorAll("input[name=backend]")) r.checked = r.value === backend;
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.dataset.for !== backend;

  const h = s.helper;
  $("hdot").className = "dot " + (h?.paired ? "ok" : h ? "warn" : "off");
  $("hstatus").textContent = !h ? t("popup.helper.off")
    : !h.paired ? t("popup.helper.unpaired", { label: h.label })
    : t("popup.helper.paired", { label: h.label });
  $("pairrow").hidden = !!h?.paired;
  $("hhint").hidden = !!h?.paired;
  $("unpair").hidden = !h?.paired;
  // The helper's mark: what it uses (Claude Code, Codex, a key), both while that's unknown.
  const marks = { "claude-code": ["claude"], codex: ["openai"], anthropic: ["anthropic"], openai: ["openai"] }[h?.provider] || ["claude", "openai"];
  $("hmark").innerHTML = marks.map(n => `<img src="brand/${n}.png" alt=""${n === "claude" ? "" : ' class="mono"'}>`).join("");
  const hp = h?.provider && s.providers[h.provider];
  $("helperModels").innerHTML = (hp?.models || []).map(m => `<option value="${esc(m)}">`).join("");
  $("helperModel").placeholder = h?.model ? t("popup.helperChoice.model", { model: h.model }) : t("popup.helperChoice");
  if (document.activeElement !== $("helperModel")) $("helperModel").value = s.helperModel;

  $("anthropicModel").innerHTML = s.anthropicModels.map(m => `<option${m === s.anthropicModel ? " selected" : ""}>${esc(m)}</option>`).join("");
  $("anthropicKey").placeholder = s.anthropicKey ? t("popup.keySaved.placeholder", { key: s.anthropicKey }) : "sk-ant-…";
}

// Morse in Chrome gets its model from the Morse app: what it uses now, or
// the one thing to do (connect on the welcome page, or get the app). The
// rest (an API key, a code) waits under Developer.
function renderApp(s) {
  const h = s.helper;
  let html;
  if (s.kind === "helper") html = `<span class="pmark" aria-hidden="true">${marks(h?.provider)}</span><span><b>${esc(t("popup.app.using", { label: s.label }))}</b><small>${esc(h?.app === "desktop" ? t("popup.app.fromApp") : t("popup.app.fromHelper"))}</small></span>`;
  else if (s.kind === "anthropic") html = `<span class="pmark" aria-hidden="true">${marks("anthropic")}</span><span><b>${esc(t("popup.app.using", { label: s.label }))}</b><small>${esc(t("popup.app.fromKey"))}</small></span>`;
  else if (h) html = `<span><b>${esc(h.app === "desktop" ? t("popup.app.found") : t("popup.app.foundHelper"))}</b><small>${esc(t("popup.app.allow"))}</small><button type="button" class="primary" id="app-connect">${esc(t("popup.app.connect"))}</button></span>`;
  else html = `<span><b>${esc(t("popup.app.none"))}</b><small>${esc(t("popup.app.none.d"))}</small><a class="btn primary" id="app-download" href="${esc(DOWNLOAD)}" target="_blank" rel="noopener">${esc(t("start.download"))}</a></span>`;
  if ($("app").dataset.html !== html) {
    $("app").dataset.html = html;
    $("app").innerHTML = html;
    $("app-connect")?.addEventListener("click", () => send({ type: "onboarding.open", what: "model" }).then(() => window.close()));
  }
  // The developer ways open by themselves when one is in use.
  if (!devOpened && (s.kind === "anthropic" || s.backend === "anthropic")) { devOpened = true; $("dev").open = true; }
}

async function save(patch) {
  const r = await send({ type: "popup.save", ...patch });
  if (r.error) return note(r.error, true);
  render(r);
}

function note(text, bad) {
  $("result").textContent = bad ? plainError(text) : text;
  $("result").className = "hint" + (bad ? " bad" : "");
}

for (const r of document.querySelectorAll("input[name=backend]")) r.onchange = () => save({ backend: r.value });
$("helperModel").onchange = () => save({ helperModel: $("helperModel").value });
$("anthropicModel").onchange = () => save({ anthropicModel: $("anthropicModel").value });
$("anthropicKey").onchange = async () => {
  const v = $("anthropicKey").value.trim();
  if (!v) return;
  await save({ anthropicKey: v, backend: "anthropic" });
  $("anthropicKey").value = "";
  note(t("welcome.key.saved"));
};
$("code").oninput = () => { $("code").value = $("code").value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
$("code").onkeydown = e => { if (e.key === "Enter") $("pair").click(); };
$("pair").onclick = async () => {
  const code = $("code").value.trim();
  if (code.length !== 6) return note(t("popup.code.short"), true);
  $("pair").disabled = true;
  const r = await send({ type: "popup.pair", code });
  $("pair").disabled = false;
  if (r.error) return note(r.error, true);
  $("code").value = "";
  render(r);
  note(t("popup.paired"));
};
$("unpair").onclick = async () => render(await send({ type: "popup.unpair" }));
$("test").onclick = async () => {
  $("test").disabled = true;
  note(t("popup.testing"));
  const r = await send({ type: "popup.test" });
  $("test").disabled = false;
  if (!r.ok) return note(r.error || t("popup.test.failed"), true);
  note(t("popup.test.ok", { label: r.label, text: r.text, secs: (r.ms / 1000).toFixed(1) }));
};
$("go").onclick = async () => { await chrome.tabs.sendMessage(tab.id, { morseToggle: true }).catch(() => {}); window.close(); };

// Keep the helper status fresh while the page is open (e.g. after `morse serve`).
setInterval(async () => { if (document.activeElement?.tagName !== "INPUT") render(await send({ type: "popup.state" })); }, 4000);

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
