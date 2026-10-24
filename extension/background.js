// Extension host: the same requests the desktop connector serves, backed by
// chrome.* APIs. Mod JS runs only through chrome.userScripts, which the user
// turns on with "Allow User Scripts". Without it a mod's CSS still shows (the
// content script adds it as a style) and its JS waits; nothing in the
// extension runs a string as code (docs/store/README.md, "Code that Morse runs").
//
// Models: either the Morse helper on this computer (`morse serve`: Claude
// Code, Codex or API keys kept there), or an Anthropic API key stored in
// chrome.storage.local and called straight from this worker. Bundled with
// core/ and the Anthropic SDK by scripts/build.js.

import { runMorse } from "../core/engine.js";
import { streamChat, settingsLabel, NoModelError, PROVIDERS, HELPER_URL } from "../core/providers.js";
import { createMod, encodeShare, decodeShare, toUserscript, validateMod, modMatches, hostOf, byCreated, saveKeepsScope } from "../core/mod.js";
import { wrapModCode } from "../core/kit.js";
import { asReviewed } from "../core/summary.js"; // installs keep only the reviewed code
import { HANG_MS, FROZE_ERROR } from "../core/guard.js"; // guard hook: frozen pages
import { clipAdd } from "../core/clipboard.js"; // God mode clipboard
import { BAR_REQUESTS, handleBarRequest, gens, getPrefs, voiceInfo } from "./bar-host.js"; // command bar: stop, settings, history, voice
import { CONTROL_REQUESTS, handleControlRequest } from "./control-host.js"; // user control: pause, safe start, install review, backup
import { serialized } from "./bar-host.js"; // hardening: one queue for every storage read-modify-write
import { ONBOARDING_REQUESTS, handleOnboarding, Practice, setModelResolver, practiceSample, SAMPLE_ONLY, openSetup } from "./onboarding-host.js"; // onboarding hook: welcome page, first-run state, practice area
import { GALLERY_REQUESTS, handleGallery } from "./gallery-host.js"; // gallery hook: Mods for this site

const get = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;
const set = (k, v) => chrome.storage.local.set({ [k]: v });

// chrome.storage.local "model": { backend: "helper"|"anthropic"|"" (auto),
//   helperModel, anthropicKey, anthropicModel }
// chrome.storage.local "helper": { token, url } once paired with the Morse
// helper (bar-host.js reads the same record for voice).
async function modelPrefs() {
  const p = await get("model", {});
  const h = await get("helper", null);
  return { ...p, helperToken: h?.token || "" };
}
async function saveModelPrefs(p) {
  const { helperToken, ...rest } = p;
  await set("model", rest);
}

async function helperHealth(token) {
  try {
    const r = await fetch(`${HELPER_URL}/v1/health`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(1200) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Resolves which model to use: { kind: helper|anthropic|none, settings, label, helper, reason }
let cached = null, cachedAt = 0;
async function backend(fresh = false) {
  if (!fresh && cached && Date.now() - cachedAt < 10000) return cached;
  const p = await modelPrefs();
  const want = p.backend || "";
  const helper = want === "anthropic" ? null : await helperHealth(p.helperToken);
  let out;
  if (want !== "anthropic" && helper?.paired) {
    const label = p.helperModel ? settingsLabel({ provider: helper.provider, model: p.helperModel }) : helper.label;
    out = { kind: "helper", label, helper, settings: { provider: "helper", baseUrl: HELPER_URL, token: p.helperToken, model: p.helperModel || "", label } };
  } else if (want !== "helper" && p.anthropicKey) {
    const settings = { provider: "anthropic", apiKey: p.anthropicKey, model: p.anthropicModel || PROVIDERS.anthropic.defaultModel };
    out = { kind: "anthropic", label: settingsLabel(settings), settings, helper };
  } else {
    const reason = want === "anthropic" ? "Add your Anthropic API key below."
      : helper ? "Pair this browser with the Morse helper below."
      : "Run morse serve on your computer, or add an Anthropic API key.";
    out = { kind: "none", label: "Connect a model", helper, reason, settings: { provider: "none" } };
  }
  cached = out; cachedAt = Date.now();
  return out;
}
setModelResolver(async () => {
  const b = await backend();
  return { connected: b.kind !== "none", provider: b.settings?.provider || "", label: b.label || "" };
});

// first-run hook: "connect a model" opens the welcome page's one-command
// step (onboarding-host.js) rather than the settings page.
function openSettings() {
  return openSetup("model").catch(() => chrome.runtime.openOptionsPage().catch(() => {}));
}

export function userScriptsAvailable() {
  try { chrome.userScripts.getScripts; return !!chrome.userScripts?.execute; } catch { return false; }
}

// Why mod JS can't run in this tab, or null when it can. Mod JS runs only
// through chrome.userScripts; there is no other way in. The practice area (the
// welcome page's sandboxed sample article) shows style changes only.
export const NOT_RUN = {
  userScripts: "This change also adds features. They run once you turn on “Allow User Scripts” for Morse. The new look works now.",
  practice: "The practice page shows how changes look. Changes that add features work on real websites.",
};
function cantRun(target) {
  if (Practice.has(target.tabId)) return "practice"; // onboarding hook: the welcome page's practice area
  return userScriptsAvailable() ? null : "userScripts";
}

async function execIn(target, code) {
  const [r] = await chrome.userScripts.execute({ target, js: [{ code }], world: "USER_SCRIPT", worldId: "morse", injectImmediately: true });
  if (r?.error) return { ok: false, error: r.error };
  return r?.result;
}

// { ok } when it ran; { ok: false, waiting: "userScripts" | "practice", error }
// when it was not run at all (not the model's mistake, so no second try).
//
// guard hook: mod code that doesn't finish has frozen the page. Only a
// debugger can interrupt it (daemon/guard.js does, on the desktop), and Morse
// doesn't ask for that permission, so here a saved mod is turned off with why
// (it won't run on the next load) and a change being made fails its run.
// Freezes later on, in a callback, are left to Chrome's "Page unresponsive"
// dialog and safe start (core/control.js).
async function exec(target, modId, js) {
  const why = cantRun(target);
  if (why) return { ok: false, waiting: why, error: NOT_RUN[why] };
  const hung = {};
  const ran = await Promise.race([execIn(target, wrapModCode(modId, js)), new Promise(r => setTimeout(() => r(hung), HANG_MS))]);
  if (ran === hung) {
    const m = (await allMods())[modId];
    if (m?.enabled && m.js === js) await putMod({ ...m, enabled: false, paused: { why: "froze", at: new Date().toISOString(), error: FROZE_ERROR } });
    return { ok: false, error: FROZE_ERROR };
  }
  const res = ran || { ok: false, error: "The change didn't run on this page. Reload the page and try again." };
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
  if (CONTROL_REQUESTS.has(msg.type)) return handleControlRequest({ ...msg, url: here.url }, port); // user control (control-host.js)
  if (ONBOARDING_REQUESTS.has(msg.type)) return handleOnboarding(msg, { practice: Practice.has(tab.id) }); // onboarding hook
  if (GALLERY_REQUESTS.has(msg.type)) return handleGallery(msg, here.url); // gallery hook: Mods for this site
  switch (msg.type) {
    case "hello": {
      const b = await backend();
      const sample = b.kind === "none" && Practice.has(tab.id); // first-run hook: the practice page's sample answers
      const label = (sample ? "Sample answers" : b.label) + (userScriptsAvailable() || sample ? "" : " · “Allow User Scripts” off");
      // The practice area doesn't use up the "Morse is ready" toast for the first real site (first-run hook).
      const quiet = Practice.has(tab.id) || (!(await get("welcomed", false)) ? (await set("welcomed", true), false) : true);
      return { mode: "extension", app: null, label, quiet, needsModel: b.kind === "none", connect: b.kind === "none" ? b.reason : undefined,
        settings: await getPrefs(), voice: await voiceInfo() };
    }
    case "mods.list":
      return Object.values(await allMods()).filter(m => modMatches(m, here)).sort(byCreated); // hardening: caller's page
    case "mods.save": {
      // As on the desktop (daemon/connector.js): a page's Morse changes only
      // mods for its own page, and can't widen where one runs.
      const id = msg.draft ? msg.draft.id : validateMod(msg.mod).id;
      const existing = id ? (await allMods())[id] : null;
      if (existing && !modMatches(existing, here)) throw new Error("That mod belongs to another app or site");
      if (msg.draft) return putMod(createMod({ ...msg.draft, url: here.url, app: null, model: msg.draft.model || (await backend()).label })); // hardening: filed under the caller's page
      if (!saveKeepsScope(msg.mod.match, existing?.match, here)) throw new Error("That mod is for another app or site");
      return putMod(msg.mod);
    }
    case "mods.delete": {
      await serialized(async () => { // hardening: serialized
        const all = await allMods();
        if (all[msg.modId] && !modMatches(all[msg.modId], here)) throw new Error("That mod belongs to another app or site");
        delete all[msg.modId];
        await set("mods", all);
      });
      return true;
    }
    // Decode and validate a shared mod without saving it (install confirmation).
    case "mods.import": {
      const src = msg.source.trim();
      const mod = src.includes("#m=") ? await decodeShare(src) : validateMod(JSON.parse(src));
      return putMod({ ...asReviewed(mod), enabled: true, imported: true, match: mod.match || { hosts: [hostOf(here.url)], app: null } }); // hardening: caller's page
    }
    // God mode: cross-app clipboard (see core/clipboard.js)
    case "clipboard.list": return get("clipboard", []);
    case "clipboard.put": return serialized(async () => { const list = clipAdd(await get("clipboard", []), msg.item); await set("clipboard", list); return list; }); // hardening: serialized
    case "exec":
      return exec(target, msg.modId, msg.js);
    case "off":
      if (!cantRun(target)) await execIn(target, `globalThis.morse && morse.__off(${JSON.stringify(msg.modId)})`);
      return true;
    case "stats": // repair: does a saved mod still find its elements? (core/kit.js __stats)
      return cantRun(target) ? null : (await execIn(target, `globalThis.morse?.__stats?.(${JSON.stringify(msg.modId)}) ?? null`)) ?? null;
    case "heal.badge": // self-heal hook: a dot on the toolbar button while a mod here stopped working (runtime/src/71-heal.js)
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#f2555a" }).catch(() => {});
      await chrome.action.setBadgeText({ tabId: tab.id, text: msg.count > 0 ? " " : "" }).catch(() => {});
      await chrome.action.setTitle({ tabId: tab.id, title: msg.count > 0 ? "Morse: a mod stopped working after this site changed" : "Morse" }).catch(() => {});
      return true;
    case "generate": {
      let b = await backend();
      if (b.kind === "none") b = await backend(true);
      if (b.kind === "none" && Practice.has(tab.id)) { // first-run hook: sample answers on the practice page, before a model is connected
        if (!practiceSample(msg.request) || msg.base) throw new Error(SAMPLE_ONLY);
        b = { kind: "sample", label: "Sample answers", settings: { provider: "demo" } };
      }
      if (b.kind === "none") {
        openSettings();
        throw new NoModelError(`No model connected yet. Morse's welcome page just opened to connect one.`);
      }
      // gens.run's signal aborts the model call (the helper kills the harness
      // process when the connection closes): Stop in the bar, or closing the tab.
      port.__gens.add(msg.genId);
      // Chrome stops an idle service worker after about 30 seconds, and a
      // model can think longer than that without a word. Waiting on fetch
      // doesn't count as activity; calling an extension API does.
      const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
      try {
        const res = await gens.run(msg.genId, signal => runMorse({
          settings: b.settings,
          request: msg.request,
          context: msg.context,
          base: msg.base, // refine / fix: the mod as it is now (core/prompt.js)
          signal,
          exec: js => exec(target, msg.genId, js),
          emit: ev => { if (!signal.aborted) try { port.postMessage({ ...ev, genId: msg.genId }); } catch {} },
        }));
        if (res.cancelled) return res;
        return { ok: res.ok, error: res.error, title: res.title, css: res.css, js: res.js, attempts: res.attempts, waiting: res.waiting };
      } catch (e) {
        if (e.code === "no_model") { cached = null; openSettings(); }
        throw e;
      } finally {
        clearInterval(keepAlive);
        port.__gens.delete(msg.genId);
      }
    }
    case "capture": {
      // captureVisibleTab takes whatever tab is in front: only while that is
      // the one asking, so a picture of another tab never goes to the model.
      const showing = async () => (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0]?.id === tab.id;
      const away = "Morse can only take a picture of this tab while it is in front. Switch back to it and try again.";
      if (!(await showing())) throw new Error(away);
      const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      if (!(await showing())) throw new Error(away);
      return shot;
    }
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
      // "morse:connect" opens Morse's settings (the runtime's "Connect a model" button).
      if (msg.url === "morse:connect" || msg.url === "morse:settings") { await openSettings(); return true; }
      if (!/^https:\/\//.test(msg.url)) throw new Error("Refusing to open non-https URL");
      await chrome.tabs.create({ url: msg.url });
      return true;
    default:
      throw new Error(`Unknown request ${msg.type}`);
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "morse") return;
  // Closing the tab aborts its generations (and the helper kills the harness).
  port.__gens = new Set();
  port.onDisconnect.addListener(() => { for (const id of port.__gens) gens.cancel(id); });
  port.onMessage.addListener(async msg => {
    try { port.postMessage({ reply: msg.id, result: await dispatch(msg, port) }); }
    catch (e) { try { port.postMessage({ reply: msg.id, error: e.message || String(e) }); } catch {} }
  });
});

// ---- popup / options page

const maskKey = k => (k ? `${k.slice(0, 7)}…${k.slice(-4)}` : "");

async function popupState(url, fresh = true) {
  const b = await backend(fresh);
  const p = await modelPrefs();
  const helper = b.helper ?? (p.backend === "anthropic" ? await helperHealth(p.helperToken) : null);
  const mods = url ? Object.values(await allMods()).filter(m => modMatches(m, { url, app: null })) : [];
  return {
    label: b.label, kind: b.kind, reason: b.reason || "",
    backend: p.backend || "", helper, helperModel: p.helperModel || "", paired: !!helper?.paired,
    anthropicKey: maskKey(p.anthropicKey), anthropicModel: p.anthropicModel || PROVIDERS.anthropic.defaultModel,
    anthropicModels: PROVIDERS.anthropic.models, providers: PROVIDERS,
    userScripts: userScriptsAvailable(), mods,
  };
}

async function popup(msg) {
  switch (msg.type) {
    case "popup.state":
      return popupState(msg.url);
    case "popup.save": {
      await serialized(async () => { // hardening: serialized
        const p = await modelPrefs();
        for (const k of ["backend", "helperModel", "anthropicModel"]) if (typeof msg[k] === "string") p[k] = msg[k].trim();
        if (typeof msg.anthropicKey === "string") p.anthropicKey = msg.anthropicKey.trim();
        await saveModelPrefs(p);
      });
      cached = null;
      return popupState(msg.url);
    }
    case "popup.pair": {
      let r;
      try {
        r = await fetch(`${HELPER_URL}/v1/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: String(msg.code || "").trim().toUpperCase() }), signal: AbortSignal.timeout(5000) });
      } catch {
        return { error: "Can't reach the Morse helper. Run morse serve on this computer." };
      }
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.token) return { error: body.error || `Pairing didn't work (error ${r.status}). Run morse pair for a new code and try again.` };
      const p = await modelPrefs();
      await set("helper", { token: body.token, url: HELPER_URL });
      await saveModelPrefs({ ...p, backend: p.backend === "anthropic" ? "anthropic" : "helper" });
      cached = null;
      return popupState(msg.url);
    }
    case "popup.unpair": {
      await chrome.storage.local.remove(["helper", "bridge", "pairing"]);
      cached = null;
      return popupState(msg.url);
    }
    case "popup.test": {
      const b = await backend(true);
      if (b.kind === "none") return { ok: false, error: b.reason };
      const t0 = Date.now();
      try {
        const text = await streamChat(b.settings, [
          { role: "system", content: "You are a connectivity check. Reply with exactly: OK" },
          { role: "user", content: "ping" },
        ], { maxTokens: 200, signal: AbortSignal.timeout(130000) });
        return { ok: true, text: text.trim().slice(0, 60), ms: Date.now() - t0, label: b.label };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !msg?.type?.startsWith("popup.")) return;
  // Only extension pages (popup/options) may change settings, not content scripts.
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  popup(msg).then(respond, e => respond({ error: e.message || String(e) }));
  return true;
});

chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== "toggle-morse") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { morseToggle: true }).catch(() => {});
});

// first-run hook: on install only the welcome page opens (onboarding-host.js).
// Its first step connects a model, so the settings page no longer opens too.
