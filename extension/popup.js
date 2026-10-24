const $ = id => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const isMac = navigator.platform.includes("Mac");
$("key").textContent = isMac ? "⌥ Space" : "Alt+Space";

// ?url= lets the popup be opened as a page (screenshots, debugging).
const url = new URLSearchParams(location.search).get("url") || tab?.url || "";
const st = await chrome.runtime.sendMessage({ type: "popup.state", url });
$("label").textContent = st.label;
$("warn").hidden = st.userScripts;
$("count").textContent = st.mods.length ? `· ${st.mods.length}` : "";
$("mods").innerHTML = st.mods.length
  ? st.mods.map(m => `<li>${m.enabled ? "●" : "○"} ${esc(m.title)}<small>“${esc(m.prompt)}”</small></li>`).join("")
  : `<li class="empty">None yet.</li>`;
for (const k of ["provider", "baseUrl", "model", "apiKey"]) if (st.saved[k]) $(k).value = st.saved[k];

$("go").onclick = async () => { await chrome.tabs.sendMessage(tab.id, { morseToggle: true }).catch(() => {}); window.close(); };
$("save").onclick = async () => {
  const settings = {};
  for (const k of ["provider", "baseUrl", "model", "apiKey"]) if ($(k).value) settings[k] = $(k).value;
  const r = await chrome.runtime.sendMessage({ type: "popup.settings", settings });
  $("label").textContent = r.label;
};
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
