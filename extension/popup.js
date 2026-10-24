// Toolbar popup, and (with <body data-page="options">) the options page.
import { plainError } from "./core/onboarding.js";
import { resolveHotkeys, formatCombo, detectPlatform } from "./core/hotkeys.js";
import { normalizePrefs } from "./core/prefs.js";
const $ = id => document.getElementById(id);
const isOptions = document.body.dataset.page === "options";
const [tab] = isOptions ? [null] : await chrome.tabs.query({ active: true, currentWindow: true });
// The in-page Open Morse hotkey as the user has it set (Settings in the bar),
// read where bar-host.js keeps it: chrome.storage.sync, local when sync is off.
{
  const PREFS_KEY = "morse.settings";
  let stored;
  try { stored = (await chrome.storage.sync.get(PREFS_KEY))[PREFS_KEY]; } catch {}
  if (stored === undefined) try { stored = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY]; } catch {}
  const platform = detectPlatform(navigator);
  const openKey = resolveHotkeys(normalizePrefs(stored).hotkeys, platform).open;
  $("key").textContent = openKey ? formatCombo(openKey, platform) : "";
  $("key").hidden = !openKey;
}

// ?url= lets the popup be opened as a page (screenshots, debugging).
const url = new URLSearchParams(location.search).get("url") || tab?.url || "";
const send = msg => chrome.runtime.sendMessage({ ...msg, url });

let st = await send({ type: "popup.state" });
render(st);

function render(s) {
  st = s;
  $("label").textContent = s.label;
  $("page").hidden = isOptions;
  $("warn").hidden = s.userScripts;
  $("count").textContent = s.mods.length ? `· ${s.mods.length}` : "";
  $("mods").innerHTML = s.mods.length
    ? s.mods.map(m => `<li><i class="${m.enabled ? "on" : ""}"></i>${esc(m.title)}<small>“${esc(m.prompt)}”</small></li>`).join("")
    : `<li class="empty">No mods on this site yet.</li>`;

  $("connect").hidden = s.kind !== "none";
  $("reason").textContent = s.reason;

  // Auto (no explicit choice): show whichever is in use, else the helper.
  const backend = s.backend || (s.kind === "anthropic" ? "anthropic" : "helper");
  for (const r of document.querySelectorAll("input[name=backend]")) r.checked = r.value === backend;
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.dataset.for !== backend;

  const h = s.helper;
  $("hdot").className = "dot " + (h?.paired ? "ok" : h ? "warn" : "off");
  $("hstatus").textContent = !h ? "The Morse helper isn't running on this computer"
    : !h.paired ? `Helper running · ${h.label} · not paired yet`
    : `Paired · ${h.label}`;
  $("pairrow").hidden = !!h?.paired;
  $("hhint").hidden = !!h?.paired;
  $("unpair").hidden = !h?.paired;
  const hp = h?.provider && s.providers[h.provider];
  $("helperModels").innerHTML = (hp?.models || []).map(m => `<option value="${esc(m)}">`).join("");
  $("helperModel").placeholder = h?.model ? `${h.model} (the helper's choice)` : "The helper's choice";
  if (document.activeElement !== $("helperModel")) $("helperModel").value = s.helperModel;

  $("anthropicModel").innerHTML = s.anthropicModels.map(m => `<option${m === s.anthropicModel ? " selected" : ""}>${esc(m)}</option>`).join("");
  $("anthropicKey").placeholder = s.anthropicKey ? `Saved: ${s.anthropicKey}` : "sk-ant-…";
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
  note("Key saved.");
};
$("code").oninput = () => { $("code").value = $("code").value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
$("code").onkeydown = e => { if (e.key === "Enter") $("pair").click(); };
$("pair").onclick = async () => {
  const code = $("code").value.trim();
  if (code.length !== 6) return note("Type the 6-character code that morse serve shows.", true);
  $("pair").disabled = true;
  const r = await send({ type: "popup.pair", code });
  $("pair").disabled = false;
  if (r.error) return note(r.error, true);
  $("code").value = "";
  render(r);
  note("Paired. Morse can use your model now.");
};
$("unpair").onclick = async () => render(await send({ type: "popup.unpair" }));
$("test").onclick = async () => {
  $("test").disabled = true;
  note("Testing. Claude Code can take a few seconds to start.");
  const r = await send({ type: "popup.test" });
  $("test").disabled = false;
  if (!r.ok) return note(r.error || "The test didn't work. Check the model settings and try again.", true);
  note(`It works. ${r.label} replied “${r.text}” in ${(r.ms / 1000).toFixed(1)}s.`);
};
$("go").onclick = async () => { await chrome.tabs.sendMessage(tab.id, { morseToggle: true }).catch(() => {}); window.close(); };

// Keep the helper status fresh while the page is open (e.g. after `morse serve`).
setInterval(async () => { if (document.activeElement?.tagName !== "INPUT") render(await send({ type: "popup.state" })); }, 4000);

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
