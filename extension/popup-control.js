// Popup, user control: "Pause Morse here" and "Pause everywhere" switches, and
// for each mod in the list where it came from plus a Show code fold with what
// it does in plain words. Loaded by popup.js; talks to control-host.js.

import { t } from "./core/i18n.js";
import { summarizeMod, modOrigin } from "./core/summary.js";
import { resolveHotkeys, formatCombo, detectPlatform } from "./core/hotkeys.js";
import { normalizePrefs } from "./core/prefs.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Extra lines for one mod in the popup's list.
export function modExtras(m) {
  const s = summarizeMod(m);
  const items = s.empty ? `<li>${esc(t("sum.empty"))}</li>` : s.items.map(i => `<li>${esc(i.text)}</li>`).join("");
  return `<span class="ctl-origin">${esc(modOrigin(m))}</span>
    <details class="ctl-code"><summary>${esc(t("ctl.showCode"))}</summary>
      <ul class="ctl-items">${items}</ul>
      ${s.notes.map(n => `<p class="ctl-warn">${esc(n.text)}</p>`).join("")}
      ${m.css?.trim() ? `<pre>${esc(m.css.trim())}</pre>` : ""}${m.js?.trim() ? `<pre>${esc(m.js.trim())}</pre>` : ""}
    </details>`;
}

// The off switch as the person set it (Settings → Shortcuts), "" when turned off.
async function offKey() {
  let saved;
  try { saved = (await chrome.storage.sync.get("morse.settings"))["morse.settings"]; } catch {}
  if (saved === undefined) saved = (await chrome.storage.local.get("morse.settings"))["morse.settings"];
  const platform = detectPlatform(navigator);
  return formatCombo(resolveHotkeys(normalizePrefs(saved).hotkeys, platform).off, platform);
}

const ask = msg => chrome.runtime.sendMessage(msg).then(r => { if (r?.error) throw new Error(r.error); return r?.result; });

async function mount() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "popup-control.css";
  document.head.append(link);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URLSearchParams(location.search).get("url") || tab?.url || "";
  let host = "";
  try { const u = new URL(url); host = /^https?:$/.test(u.protocol) ? u.host : u.protocol === "file:" ? t("ctl.localFiles") : ""; } catch {}

  const box = document.createElement("section");
  box.id = "ctl";
  box.setAttribute("aria-label", t("ctl.pauseMorse"));
  (document.getElementById("warn") || document.getElementById("go"))?.after(box);

  const key = await offKey().catch(() => "");
  const render = st => {
    const p = st?.info || { all: false, here: false };
    box.innerHTML = `
      ${host ? `<label class="ctl-row"><span class="ctl-l"><b>${esc(t("ctl.pauseOn", { site: host }))}</b><small>${esc(p.here ? t("ctl.pausedHere") : t("ctl.pauseHere.help"))}</small></span>
        <span class="ctl-sw"><input type="checkbox" data-scope="site" ${p.here ? "checked" : ""}><i></i></span></label>` : ""}
      <label class="ctl-row"><span class="ctl-l"><b>${esc(t("ctl.pauseAll"))}</b><small>${esc(p.all ? t("ctl.pausedAll") : t("ctl.pauseAll.help"))}</small></span>
        <span class="ctl-sw"><input type="checkbox" data-scope="all" ${p.all ? "checked" : ""}><i></i></span></label>
      ${key ? `<p class="ctl-hint">${esc(t("ctl.offHint"))} <kbd>${esc(key)}</kbd></p>` : ""}`;
    document.body.classList.toggle("ctl-paused", !!(p.all || p.here));
  };
  render(await ask({ type: "control.get", url }).catch(() => null));
  box.addEventListener("change", async e => {
    const scope = e.target.dataset.scope;
    if (!scope) return;
    const r = await ask({ type: "control.pause", url, scope, on: e.target.checked }).catch(() => null);
    render(r ? { info: r.info } : await ask({ type: "control.get", url }).catch(() => null));
  });
}

if (globalThis.chrome?.runtime?.id) mount().catch(e => console.warn("[morse]", e));
