// What a mod does, in plain words, for people deciding whether to install it.
//
// This is simple pattern matching over the mod's CSS and JS, not a proof. It
// errs on the side of mentioning things: a word in a string or a comment can
// add a line, and nothing is ever left out because it looked harmless. Code
// that builds itself while it runs (eval, encoded strings, window["..."])
// gets its own note, because then reading the code isn't enough.
//
// Pure and dependency-free: the share page imports it, the hosts import it,
// and runtime/bundle.js inlines it into the in-app runtime (so no imports).

// Every line a summary can contain, in the order they're shown.
export const SUMMARY_ITEMS = [
  { id: "looks", text: "Changes how the page looks" },
  { id: "hides", text: "Hides or removes parts of the page" },
  { id: "text", text: "Changes text on the page" },
  { id: "buttons", text: "Adds buttons to the page" },
  { id: "adds", text: "Adds new things to the page" },
  { id: "clicks", text: "Reacts when you click, scroll or point" },
  { id: "typing", text: "Reads what you type in this page", detail: "Including text you enter in boxes and fields." },
  { id: "acts", text: "Clicks or submits things for you" },
  { id: "ongoing", text: "Keeps running while the page is open", detail: "It checks the page again as it changes." },
  { id: "storage", text: "Remembers settings on this site", detail: "Saved in your browser for this site only." },
  { id: "cookies", text: "Reads or changes this site's cookies", detail: "Cookies can include what keeps you signed in." },
  { id: "clipboard", text: "Uses your clipboard", detail: "Copying, and possibly reading what you copied." },
  { id: "navigates", text: "Opens or reloads pages" },
  { id: "loads", text: "Loads files from another website", detail: "That website can tell when you open this page." },
  { id: "network", text: "Sends data to another website", detail: "What it sends could include what you see or type here." },
  { id: "device", text: "Asks for your camera, microphone or location", detail: "Your browser asks you first." },
  { id: "notify", text: "Shows notifications" },
  { id: "dynamic", text: "Runs code it builds while running", detail: "So the code below may not show everything it does." },
  { id: "code", text: "Runs its own code on this page", detail: "Code here can see everything on this page that you can." },
];

// The ones that get a clearly worded note above the Install button.
export const SUMMARY_NOTES = {
  network: "This mod can send information from this page to another website, including things you see or type here. Install it only if you trust the person who shared it.",
  typing: "This mod can read what you type on this page. That can include messages and passwords.",
  dynamic: "Part of this mod's code is put together while it runs, so reading it won't tell you everything it does.",
};

const TYPING_EVENTS = /^(input|beforeinput|change|key(down|up|press)|paste|cut|copy|composition(start|update|end)|submit|formdata|select|selectionchange)$/i;
const POINTER_EVENTS = /^(click|dblclick|auxclick|contextmenu|mouse\w*|pointer\w*|touch\w*|wheel|scroll\w*|drag\w*|drop|focus\w*|blur|hover)$/i;

const has = (src, re) => re.test(src);

// Event names the code listens for: addEventListener("x"), morse.on(t, "x"),
// morse.el(..., { on: { x } }), el.onx = ... Quoted words right after a
// listener call are taken as event names when they look like one.
function eventNames(js) {
  const out = new Set();
  for (const m of js.matchAll(/(?:addEventListener|\.on|\bon)\s*\(([\s\S]{0,200})/g)) {
    for (const q of m[1].matchAll(/["'`]([a-z][a-z-]*)["'`]/gi)) out.add(q[1].toLowerCase());
  }
  for (const m of js.matchAll(/\bon\s*:\s*\{([^}]{0,400})\}/g)) {
    for (const k of m[1].matchAll(/["']?([a-z]+)["']?\s*(?::|\()/gi)) out.add(k[1].toLowerCase());
  }
  for (const m of js.matchAll(/\.on([a-z]+)\s*=(?!=)/gi)) out.add(m[1].toLowerCase());
  for (const m of js.matchAll(/\bon([a-z]+)\s*=\s*["'`]/gi)) out.add(m[1].toLowerCase()); // inline HTML handlers
  return out;
}

// -> { items: [{ id, text, detail }], notes: [{ id, text }], empty }
export function summarizeMod(mod) {
  const css = String(mod?.css || "");
  const js = String(mod?.js || "");
  const found = new Set();
  const add = id => found.add(id);

  // ---- CSS
  if (css.trim()) {
    add("looks");
    if (has(css, /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|\[hidden\]/i)) add("hides");
    if (has(css, /content\s*:\s*(["'])(?!\1)/i) || has(css, /content\s*:\s*(attr|counter)\(/i)) add("text");
    if (has(css, /url\(\s*["']?\s*(https?:)?\/\//i) || has(css, /@import/i) || has(css, /image-set\(\s*["']?(https?:)?\/\//i)) add("loads");
    if (has(css, /url\(\s*["']?\s*https?:[^)]*[?&][^)]*=/i)) add("network"); // a URL carrying data
  }

  if (js.trim()) {
    add("code");
    const ev = eventNames(js);

    // looks
    if (has(js, /\.style\b|morse\.css\s*\(|classList|className\s*=|setAttribute\s*\(\s*["'`](style|class)|insertRule|createElement\s*\(\s*["'`]style|<style/i)) add("looks");
    // hides
    if (has(js, /\.remove\s*\(\s*\)|removeChild\s*\(|\.hidden\s*=\s*(true|!0|1)|display\s*[:=]\s*["'`]?none|visibility\s*[:=]\s*["'`]?hidden|replaceChildren\s*\(\s*\)|setAttribute\s*\(\s*["'`]hidden|toggleAttribute\s*\(\s*["'`]hidden/i)) add("hides");
    // text
    if (has(js, /\b(textContent|innerText|nodeValue|outerText|placeholder)\s*\+?=(?!=)|\b(inner|outer)HTML\s*\+?=(?!=)|document\.title\s*=(?!=)/)) add("text");
    // buttons, other new things
    if (has(js, /(morse\.el|createElement)\s*\(\s*["'`]button|<button|role\s*[:=,]\s*["'`]?button|type\s*:\s*["'`]button/i)) add("buttons");
    if (has(js, /morse\.el\s*\(|createElement(NS)?\s*\(|insertAdjacent(HTML|Element|Text)|\.(append|prepend|after|before|appendChild|insertBefore|replaceWith|replaceChildren)\s*\(|\binnerHTML\s*\+?=(?!=)|cloneNode\s*\(/)) add("adds");
    // listening to the person
    const evs = [...ev];
    if (evs.some(e => TYPING_EVENTS.test(e)) || has(js, /\.value\b|getSelection\s*\(|selection(Start|End)|isContentEditable|contenteditable|new\s+FormData|type\s*[=:]\s*["'`]?password|\binput\[|\btextarea\b/i)) add("typing");
    if (evs.some(e => POINTER_EVENTS.test(e))) add("clicks");
    if (has(js, /\.click\s*\(\s*\)|\.submit\s*\(\s*\)|requestSubmit\s*\(|dispatchEvent\s*\(|new\s+(Mouse|Keyboard|Pointer|Input|Touch|Submit)Event\b/)) add("acts");
    // keeps running
    if (has(js, /morse\.(every|watch)\s*\(|setInterval\s*\(|MutationObserver|requestAnimationFrame|ResizeObserver|IntersectionObserver/)) add("ongoing");
    // remembers
    if (has(js, /morse\.store\b|localStorage|sessionStorage|indexedDB|\bcaches\s*\.|openDatabase/)) add("storage");
    if (has(js, /document\s*\.\s*cookie|cookieStore/)) add("cookies");
    if (has(js, /navigator\s*\.\s*clipboard|execCommand\s*\(\s*["'`](copy|cut|paste)|ClipboardItem|clipboardData/i)) add("clipboard");
    // leaves the page
    if (has(js, /window\s*\.\s*open\s*\(|\bopen\s*\(\s*["'`]https?:|location\s*(\.\s*href\s*)?=(?!=)|location\s*\.\s*(assign|replace|reload)\s*\(|history\s*\.\s*(pushState|replaceState|go|back|forward)\s*\(/)) add("navigates");
    if (has(js, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|\bnew\s+Image\b|\.src\s*=(?!=)|\.(srcset|action|formAction|ping)\s*=(?!=)|setAttribute\s*\(\s*["'`](src|srcset|action|formaction|ping)["'`]|\bimport\s*\(|importScripts|postMessage\s*\(|new\s+Worker|serviceWorker|<(img|script|iframe|link|object|embed|form|video|audio|source)\b[^>]*\b(src|href|action|data)\s*=|\b(src|srcset|action)\s*:\s*["'`]?\s*(https?:)?\/\//)) add("network");
    if (has(js, /url\(\s*["']?\s*(https?:)?\/\//i) || has(js, /@import/)) add("loads");
    if (has(js, /getUserMedia|getDisplayMedia|mediaDevices|geolocation|DeviceOrientation|DeviceMotion/)) add("device");
    if (has(js, /\bNotification\b|showNotification/)) add("notify");
    // code that writes code, or hides what it calls
    if (has(js, /\beval\s*\(|new\s+Function\b|\bFunction\s*\(|set(Timeout|Interval)\s*\(\s*["'`]|createElement\s*\(\s*["'`]script|<script|\bimport\s*\(|\batob\s*\(|fromCharCode|(window|globalThis|self|top|parent|frames|document|navigator)\s*\[|\bReflect\s*\.|\bProxy\b|\.constructor\s*[([]|\bwith\s*\(/)
      || has(js, /\\x[0-9a-f]{2}|\\u00[0-7][0-9a-f]|\\u\{0*[0-7]?[0-9a-f]\}/i)) add("dynamic");
  }

  const items = SUMMARY_ITEMS.filter(i => found.has(i.id)).map(i => ({ ...i, detail: i.detail || "" }));
  // "Adds new things" is implied when the new things are buttons and nothing else.
  const onlyButtons = found.has("buttons") && found.has("adds") && !has(js, /morse\.el\s*\(\s*["'`](?!button)|createElement\s*\(\s*["'`](?!button)|insertAdjacent|innerHTML/);
  const shown = onlyButtons ? items.filter(i => i.id !== "adds") : items;
  const notes = Object.keys(SUMMARY_NOTES).filter(id => found.has(id)).map(id => ({ id, text: SUMMARY_NOTES[id] }));
  return { items: shown, notes, empty: !css.trim() && !js.trim() };
}

// For the terminal: one line per item, notes last.
export function summaryLines(mod) {
  const s = summarizeMod(mod);
  if (s.empty) return ["Doesn't change anything (it has no code)"];
  return [...s.items.map(i => i.text), ...s.notes.map(n => `Note: ${n.text}`)];
}

// The sites a mod runs on, exactly as modMatches (core/mod.js) reads them:
// no host list means every site; a list that isn't non-empty strings is
// broken (null), and a broken mod runs nowhere.
export function modHosts(mod) {
  const m = mod?.match;
  if (m === undefined || m === null) return ["*"];
  if (typeof m !== "object" || Array.isArray(m)) return null;
  const h = m.hosts;
  if (h === undefined || h === null) return ["*"];
  if (!Array.isArray(h) || !h.length || !h.every(x => typeof x === "string" && x)) return null;
  return h;
}

// Wildcards that cover a whole top-level domain ("*.com", "*.co.uk"): close to
// every website, though not written as "*". -> the endings, e.g. [".com"].
const SUFFIX2 = /^(co|com|net|org|gov|edu|ac|or|ne|go|gob|nic|mil|ltd|plc)\.[a-z]{2}$/i;
export function broadEndings(mod) {
  if (mod?.match?.app) return [];
  return (modHosts(mod) || []).filter(h => {
    if (!h.startsWith("*.")) return false;
    const rest = h.slice(2).replace(/:\d+$/, "").replace(/\.$/, "");
    return !rest.includes(".") || SUFFIX2.test(rest);
  }).map(h => h.slice(1));
}

// "Where it runs", in words, from the same rule.
export function whereRuns(mod) {
  const app = mod?.match?.app;
  if (typeof app === "string" && app) return app;
  const h = modHosts(mod);
  if (!h) return "nowhere (its list of sites is broken)";
  if (h.includes("*")) return "every website";
  return h.map(x => (x === "file" ? "files on this computer" : x)).join(", ");
}

// Where a mod came from, in a few words (Mods panel, popup, CLI).
export function modOrigin(mod) {
  const day = iso => {
    try {
      const d = new Date(iso);
      if (isNaN(d)) return "";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
    } catch { return ""; }
  };
  const by = typeof mod?.author === "string" && mod.author.trim() ? ` by ${mod.author.trim().slice(0, 60)}` : "";
  if (mod?.imported && mod.gallery?.id) return `Installed from the Morse gallery${by}${mod.importedAt ? ` on ${day(mod.importedAt)}` : ""}`; // gallery hook (68-gallery.js)
  if (mod?.imported) {
    const how = mod.importedFrom === "file" ? "Imported from a file" : mod.importedFrom === "backup" ? "Restored from a backup" : "Installed from a shared link";
    const when = mod.importedAt ? ` on ${day(mod.importedAt)}` : "";
    return `${how}${by}${when}`;
  }
  if (mod?.from && (mod.from.title || mod.from.app || mod.from.url)) {
    let where = mod.from.title || mod.from.app || "";
    if (!where) { try { where = new URL(mod.from.url).host; } catch { where = "another page"; } }
    return `Rebuilt from something in ${where}${by}`;
  }
  if (mod?.kind === "manual" || mod?.kind === "quick") return `Your own edits${mod.created ? `, ${day(mod.created)}` : ""}`;
  return `Made here${mod?.model ? ` with ${mod.model}` : ""}${by}${mod?.created ? `, ${day(mod.created)}` : ""}`;
}
