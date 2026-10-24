// Extension host: the same requests the desktop connector serves, backed by
// chrome.* APIs. Mod JS runs through chrome.userScripts (exempt from page CSP);
// without it, Morse falls back to the page's main world, which strict-CSP
// sites block.

import { runMorse } from "./core/engine.js";
import { resolveSettings, settingsLabel, DEFAULT_SETTINGS } from "./core/providers.js";
import { createMod, encodeShare, decodeShare, toUserscript, validateMod, modMatches, hostOf } from "./core/mod.js";
import { wrapModCode } from "./core/kit.js";
import { BAR_REQUESTS, handleBarRequest, gens, getPrefs, voiceInfo } from "./bar-host.js"; // command bar: stop, settings, history, voice
import { serialized } from "./bar-host.js"; // hardening: one queue for every storage read-modify-write
import { clipAdd } from "./core/clipboard.js"; // God mode clipboard

const get = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;
const set = (k, v) => chrome.storage.local.set({ [k]: v });

let resolved = null, resolvedAt = 0;
async function settings() {
  if (resolved && Date.now() - resolvedAt < 15000) return resolved;
  resolved = await resolveSettings({ ...DEFAULT_SETTINGS, ...(await get("settings", {})) });
  resolvedAt = Date.now();
  return resolved;
}

export function userScriptsAvailable() {
  try { chrome.userScripts.getScripts; return !!chrome.userScripts?.execute; } catch { return false; }
}

async function execIn(target, code) {
  if (userScriptsAvailable()) {
    const [r] = await chrome.userScripts.execute({ target, js: [{ code }], world: "USER_SCRIPT", worldId: "morse", injectImmediately: true });
    if (r?.error) return { ok: false, error: r.error };
    return r?.result;
  }
  const [r] = await chrome.scripting.executeScript({
    target, world: "MAIN",
    func: src => { try { return (0, eval)(src); } catch (e) { return { ok: false, error: String(e && e.message || e) }; } },
    args: [code],
  });
  const res = r?.result;
  if (res && !res.ok && /unsafe-eval|Content Security Policy/i.test(res.error)) {
    res.error = "This site blocks injected scripts. Turn on “Allow User Scripts” for Morse in chrome://extensions.";
  }
  return res;
}

async function exec(target, modId, js) {
  const res = (await execIn(target, wrapModCode(modId, js))) || { ok: false, error: "no result" };
  if (!res.ok) return res;
  await new Promise(r => setTimeout(r, 600));
  const errs = (await execIn(target, `morse.__errors(${JSON.stringify(modId)})`)) || [];
  return errs.length ? { ok: false, error: String(errs[0]).split("\n")[0] } : { ok: true };
}

async function allMods() { return get("mods", {}); }
// hardening: serialized so concurrent saves/deletes can't drop each other
async function putMod(m) { validateMod(m); await serialized(async () => { const all = await allMods(); all[m.id] = m; await set("mods", all); }); return m; }

function download(filename, url) {
  return chrome.downloads.download({ url, filename: `morse/${filename}`, saveAs: false }).then(() => ({ path: `Downloads/morse/${filename}` }));
}
function textUrl(text, mime) {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(s)}`;
}

async function dispatch(msg, port) {
  const tab = port.sender.tab;
  // Pin execution to the exact document that asked: if the tab navigates
  // mid-generation, the code must not land on whatever page loaded next.
  const target = port.sender.documentId
    ? { tabId: tab.id, documentIds: [port.sender.documentId] }
    : { tabId: tab.id, frameIds: [port.sender.frameId ?? 0] };
  // hardening: reads and saves answer for the page that asked, not for what
  // the message claims. The content script reports location.href (it follows
  // pushState); it's trusted only within the sender document's own site.
  const sent = port.sender.url || tab?.url || "";
  const here = { url: msg.url && hostOf(msg.url) === hostOf(sent) ? msg.url : sent, app: null };
  if (BAR_REQUESTS.has(msg.type)) return handleBarRequest({ ...msg, url: here.url, scope: undefined }); // history per caller's site
  switch (msg.type) {
    case "hello": {
      const s = await settings();
      const label = settingsLabel(s) + (userScriptsAvailable() ? "" : " · user scripts off");
      return { mode: "extension", app: null, label, quiet: !(await get("welcomed", false)) ? (await set("welcomed", true), false) : true,
        settings: await getPrefs(), voice: await voiceInfo() };
    }
    case "mods.list":
      return Object.values(await allMods()).filter(m => modMatches(m, here)).sort((a, b) => a.created.localeCompare(b.created)); // hardening: caller's page
    case "mods.save": {
      const s = await settings();
      if (msg.draft) return putMod(createMod({ ...msg.draft, url: here.url, app: null, model: s.model })); // hardening: filed under the caller's page
      return putMod(msg.mod);
    }
    case "mods.delete": {
      await serialized(async () => { // hardening: serialized
        const all = await allMods();
        delete all[msg.modId];
        await set("mods", all);
      });
      return true;
    }
    // Decode and validate a shared mod without saving it (install confirmation).
    case "mods.preview": {
      const src = msg.source.trim();
      return src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
    }
    case "mods.import": {
      const src = msg.source.trim();
      const mod = src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
      return putMod({ ...mod, enabled: true, imported: true, match: mod.match || { hosts: [hostOf(here.url)], app: null } }); // hardening: caller's page
    }
    // God mode: cross-app clipboard (see core/clipboard.js)
    case "clipboard.list": return get("clipboard", []);
    case "clipboard.put": return serialized(async () => { const list = clipAdd(await get("clipboard", []), msg.item); await set("clipboard", list); return list; }); // hardening: serialized
    case "exec":
      return exec(target, msg.modId, msg.js);
    case "off":
      await execIn(target, `globalThis.morse && morse.__off(${JSON.stringify(msg.modId)})`);
      return true;
    case "generate": {
      const s = await settings();
      (port.genIds ||= new Set()).add(msg.genId);
      const res = await gens.run(msg.genId, signal => runMorse({
        settings: s,
        request: msg.request,
        context: msg.context,
        exec: js => exec(target, msg.genId, js),
        emit: ev => { if (!signal.aborted) try { port.postMessage({ ...ev, genId: msg.genId }); } catch {} },
        signal,
      }));
      if (res.cancelled) return res;
      return { ok: res.ok, error: res.error, title: res.title, css: res.css, js: res.js, attempts: res.attempts };
    }
    case "capture":
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    case "clip.start":
    case "clip.stop":
    case "clip.cancel":
      return null; // clips are recorded by the desktop connector in v1
    case "export":
      return download(msg.filename, msg.dataUrl || textUrl(msg.content, "text/plain"));
    case "share": {
      const slug = msg.mod.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mod";
      if (msg.kind === "link") return { link: await encodeShare(msg.mod) };
      if (msg.kind === "json") return download(`${slug}.morse.json`, textUrl(JSON.stringify(msg.mod, null, 2), "application/json"));
      if (msg.kind === "userscript") return download(`${slug}.user.js`, textUrl(toUserscript(msg.mod), "text/javascript"));
      throw new Error(`Unknown share kind ${msg.kind}`);
    }
    case "open":
      if (!/^https:\/\//.test(msg.url)) throw new Error("Refusing to open non-https URL");
      await chrome.tabs.create({ url: msg.url });
      return true;
    default:
      throw new Error(`Unknown request ${msg.type}`);
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "morse") return;
  // The page went away (navigation, close, reload): stop its generations.
  port.onDisconnect.addListener(() => { for (const id of port.genIds || []) gens.cancel(id); });
  port.onMessage.addListener(async msg => {
    try { port.postMessage({ reply: msg.id, result: await dispatch(msg, port) }); }
    catch (e) { try { port.postMessage({ reply: msg.id, error: e.message || String(e) }); } catch {} }
  });
});

// Popup and keyboard command.
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    if (msg.type === "popup.state") {
      const s = await settings();
      const mods = Object.values(await allMods()).filter(m => modMatches(m, { url: msg.url, app: null }));
      respond({ label: settingsLabel(s), provider: s.provider, saved: await get("settings", {}), userScripts: userScriptsAvailable(), mods });
    } else if (msg.type === "popup.settings") {
      await serialized(() => set("settings", msg.settings)); // hardening: serialized
      resolved = null;
      respond({ label: settingsLabel(await settings()) });
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== "toggle-morse") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { morseToggle: true }).catch(() => {});
});
