// onboarding v2: the “Allow User Scripts” window (allow.html). Opened next to
// Morse's details in Chrome by onboarding-host.js allowUserScripts():
//   ?details=<tab id>  the chrome://extensions tab with the switch
//   ?back=<tab id>     the tab the change happened in
// When the switch comes on: both close and that tab is in front again, where
// the waiting mods run (runtime/src/64-waiting.js retries on focus).
import "./i18n-page.js";
import { t } from "./core/i18n.js";

const q = new URLSearchParams(location.search);
const details = Number(q.get("details")) || null, back = Number(q.get("back")) || null;
const on = () => { try { chrome.userScripts.getScripts; return !!chrome.userScripts?.execute; } catch { return false; } };
const SETTINGS = `chrome://extensions/?id=${chrome.runtime.id}`;

async function finish() {
  document.getElementById("live").classList.add("ok");
  document.getElementById("say").textContent = t("allow.done");
  document.querySelector(".row").hidden = true;
  await new Promise(r => setTimeout(r, 900));
  if (details) await chrome.tabs.remove(details).catch(() => {});
  if (back) {
    const tab = await chrome.tabs.update(back, { active: true }).catch(() => null);
    if (tab) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await chrome.tabs.sendMessage(back, { morseRetry: true }).catch(() => {}); // the waiting mods run now
  }
  window.close();
}
let finishing = false;
const check = () => { if (!finishing && on()) { finishing = true; finish(); } };
setInterval(check, 400);
check();

// Show me the switch: Morse's details in front again.
document.getElementById("show").addEventListener("click", async () => {
  const tab = details ? await chrome.tabs.update(details, { active: true }).catch(() => null) : null;
  if (!tab) await chrome.tabs.create({ url: SETTINGS });
  else await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
});
document.getElementById("later").addEventListener("click", async () => {
  if (details) await chrome.tabs.remove(details).catch(() => {});
  window.close();
});
// The details tab closed without the switch: nothing left to point at.
chrome.tabs.onRemoved.addListener(id => { if (id === details && !on()) window.close(); });
