// Take this, Bring here: take a feature from one app or site and bring it
// into another, built from that app's own parts.
//
//   Take   In app A the person points at a feature, or opens it while Morse
//          watches, and chooses Take this. The runtime (runtime/src/73-take.js)
//          keeps what it takes to rebuild it: the feature's markup (trimmed and
//          redacted like everything the model reads), the styles that matter,
//          how it opened (Show me once steps), a small picture and where it
//          came from. The model then writes its name and a few plain lines
//          about what it does (describeMessages). The hosts keep the list
//          (core/take-host.js): ~/.morse/taken.json on the computer, or
//          chrome.storage.local "taken", shared through the Morse helper
//          when Chrome is paired with it.
//   Bring  In app B the person picks one (Bring here…), or types "add VS
//          Code's command palette here". bringPrompt() joins the request
//          (core/prompt.js): build the feature so it works the way it did,
//          from B's own fonts, colors, spacing, radius and components. No
//          taken feature fits? The model may use what it knows of a
//          well-known one. The result is a normal change: Save, Undo, Share.
//
// Pure and dependency-free: the hosts, core/prompt.js and the runtime
// (inlined by runtime/bundle.js) all use it.

export const TAKEN_MAX = 30;
const MAX_ITEM_BYTES = 360_000; // the picture is most of it
const MAX_THUMB = 280_000;
const MAX_STEPS = 12;

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const line = (v, n) => str(v, n * 4).replace(/\s+/g, " ").trim().slice(0, n);
const STEP_DO = /^(click|type|choose|check|uncheck|key)$/;

// One step of how it opened, as core/showonce.js stepsForModel writes it,
// cut down to plain strings and numbers.
function cleanStep(s, i) {
  if (!s || typeof s !== "object" || !STEP_DO.test(s.do)) return null;
  const o = { n: i + 1, do: s.do, selector: line(s.selector, 200) };
  for (const k of ["text", "label", "role", "key"]) if (typeof s[k] === "string" && s[k].trim()) o[k] = line(s[k], 80);
  if (s.hidden) o.hidden = true;
  else if (typeof s.value === "string" && s.value) o.value = line(s.value, 60);
  return o;
}

// Styles from God mode's snapshot (runtime/src/47-capture.js): { root, size,
// parts: [{ path, styles }] }, only strings, and small.
function cleanStyles(st) {
  if (!st || typeof st !== "object") return null;
  const flat = o => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {})
    .filter(([k, v]) => /^[a-z-]{2,40}$/.test(k) && typeof v === "string").slice(0, 30).map(([k, v]) => [k, v.slice(0, 200)]));
  const out = { root: flat(st.root), size: line(st.size, 20), parts: [] };
  for (const p of Array.isArray(st.parts) ? st.parts.slice(0, 12) : []) {
    if (p && typeof p.path === "string") out.parts.push({ path: line(p.path, 160), styles: flat(p.styles) });
    if (JSON.stringify(out).length > 7000) { out.parts.pop(); break; }
  }
  return out;
}

// A taken feature, checked and cut to size. Hosts store only what this returns.
export function cleanTaken(item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[\w-]{4,40}$/.test(item.id)) throw new Error("Not a taken feature");
  const now = new Date().toISOString();
  const when = v => (typeof v === "string" && !isNaN(Date.parse(v)) ? v : now);
  const steps = (Array.isArray(item.steps) ? item.steps : []).slice(0, MAX_STEPS).map(cleanStep).filter(Boolean).map((s, i) => ({ ...s, n: i + 1 }));
  const out = {
    morse: "taken",
    id: item.id,
    name: line(item.name, 60) || line(item.label, 60) || "Feature",
    label: line(item.label, 80),
    about: str(item.about, 900).trim(),
    from: { app: line(item.from?.app, 60), host: line(item.from?.host, 120) },
    html: str(item.html, 4000),
    styles: cleanStyles(item.styles),
    hover: (Array.isArray(item.hover) ? item.hover : []).filter(s => typeof s === "string").slice(0, 6).map(s => s.slice(0, 300)),
    steps,
    created: when(item.created),
    updated: when(item.updated || item.created),
  };
  if (item.synced === true) out.synced = true; // core/take-host.js: the other side has it too
  if (typeof item.thumb === "string" && item.thumb.length <= MAX_THUMB && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item.thumb)) out.thumb = item.thumb;
  if (JSON.stringify(out).length > MAX_ITEM_BYTES) throw new Error("This is too large to take. Point at a smaller part.");
  return out;
}

const newestFirst = (a, b) => String(b.created).localeCompare(String(a.created));

// The list with `item` added, or put in place of the one with its id.
export function takenAdd(list, item, max = TAKEN_MAX) {
  const it = cleanTaken(item);
  const rest = (Array.isArray(list) ? list : []).filter(i => i && i.id !== it.id);
  return [it, ...rest].sort(newestFirst).slice(0, max);
}
export function takenRemove(list, id) {
  return (Array.isArray(list) ? list : []).filter(i => i && i.id !== id);
}
// Two lists of the same things (Chrome's and the computer's): each id once,
// the copy changed last wins.
export function mergeTaken(a, b, max = TAKEN_MAX) {
  const by = new Map();
  for (const it of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!it || typeof it.id !== "string") continue;
    const had = by.get(it.id);
    if (!had || String(it.updated || "") > String(had.updated || "")) by.set(it.id, it);
  }
  return [...by.values()].sort(newestFirst).slice(0, max);
}

// ---- typed requests: "add VS Code's command palette here"
const STOP = new Set(("a an the this that these here there it its my me to in on into onto of from for with like and or add bring put give make "
  + "show want need please can could would you i we us app apps site website page one feature thing same just also too new").split(" "));
const wordsOf = s => String(s || "").toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !STOP.has(w));

// The taken feature a request names: most of its name's words, or some of
// them and the app it came from. null when none fits.
export function matchTaken(request, list) {
  const want = new Set(wordsOf(request));
  if (!want.size) return null;
  const cue = /\b(bring|brought|took|taken|from|like (in|on|the one))\b/i.test(request);
  let best = null, top = 0;
  for (const it of Array.isArray(list) ? list : []) {
    const name = [...new Set(wordsOf(it?.name))];
    if (!name.length) continue;
    const hits = name.filter(w => want.has(w)).length / name.length;
    const app = wordsOf(it.from?.app).some(w => want.has(w));
    // Without the app's name or a word like "bring", every word of its name.
    if (!hits || (hits < 1 && !(hits >= 0.5 && (app || cue)))) continue;
    const score = hits + (app ? 0.5 : 0);
    if (score > top) { best = it; top = score; }
  }
  return best;
}

// A request for a well-known feature of another app, when nothing taken
// fits: "add VS Code's command palette here", "a file finder like GitHub's",
// "bring Gmail's undo send here". { app, what } or null. The app is a name
// as written (capitalized, or a site like pkg.go.dev).
const APP = String.raw`((?:[A-Z][\w.+-]*|[a-z][\w-]*\.[a-z]{2,}[\w./-]*)(?:\s+[A-Z][\w.+-]*){0,2})`;
const ASK = String.raw`\b(?:add|bring|put|give\s+(?:me|us)|i\s+want|i'd\s+like|make|build|copy|steal|borrow|get)\b`;
const PLACE = String.raw`(?:\s+(?:here|to\s+(?:this|the)\b.*|in(?:to)?\s+(?:this|the)\b.*|on\s+(?:this|the)\b.*))?\s*[.!]?\s*$`;
const POSSESSIVE = new RegExp(`${ASK}.*?\\b${APP}['’]s?\\s+([^.,;!?]+?)${PLACE}`);
const FROM_APP = new RegExp(`${ASK}\\s+(?:(?:a|an|the|some)\\s+)?([^.,;!?]+?)\\s+(?:from|like\\s+(?:the\\s+one\\s+)?(?:in|on)|as\\s+(?:in|on)|like)\\s+${APP}(?:['’]s?)?${PLACE}`);
export function bringAsk(request) {
  const text = String(request || "").trim().replace(/^\w/, c => c.toLowerCase()); // "Add …" as "add …"; the app keeps its capital
  if (!text || text.length > 300) return null;
  const tidy = s => s.replace(/^(?:the|a|an)\s+/i, "").trim();
  let m = text.match(POSSESSIVE);
  if (m && /^[A-Z]|\./.test(m[1])) return { app: m[1].trim(), what: tidy(m[2]) };
  m = text.match(FROM_APP);
  if (m && /^[A-Z]|\./.test(m[2])) return { app: m[2].trim(), what: tidy(m[1]) };
  return null;
}

// ---- what the model reads

// What a taken feature tells the model (no picture: it stays on this computer).
export function takenForModel(it) {
  const o = { name: it.name, about: it.about, from: it.from, label: it.label, html: it.html, styles: it.styles, hover: it.hover, steps: it.steps };
  for (const k of Object.keys(o)) if (o[k] == null || o[k] === "" || (Array.isArray(o[k]) && !o[k].length)) delete o[k];
  return o;
}

const fence = (lang, s) => "```" + lang + "\n" + String(s).trim() + "\n```";
const stepLine = s => {
  const it = s.label || s.text || "";
  const what = s.do === "key" ? `Press ${s.key}${it && s.role && /field/.test(s.role) ? ` in “${it}”` : ""}`
    : s.do === "type" ? (s.hidden ? `Type (hidden) in “${it}”` : `Type “${s.value || ""}” in “${it}”`)
    : `${s.do[0].toUpperCase()}${s.do.slice(1)} “${it || s.selector}”`;
  return `${s.n}. ${what}`;
};
function featureLines(f) {
  const out = [];
  if (f.html) out.push("Its markup there (trimmed; personal text left out):\n" + fence("html", f.html.slice(0, 3500)));
  if (f.styles) out.push("Its computed styles there (JSON):\n" + JSON.stringify(f.styles).slice(0, 3500));
  if (f.hover?.length) out.push("Its hover and focus rules there:\n" + f.hover.join("\n").slice(0, 1200));
  if (f.steps?.length) out.push("How the person opened and used it there, in order:\n" + f.steps.map(stepLine).join("\n"));
  return out;
}

// Take: the model names the feature and says what it does, in a few plain
// lines. It answers in the Ask format (core/answer.js), so every host's
// "generate" carries it unchanged and nothing runs on the page.
export const DESCRIBE_SYSTEM = `You look at a feature a person took from an app, so it can be rebuilt in another app later. Reply in exactly this format and nothing else:
ANSWER: <its usual name, 2 to 5 words, like "Command palette", "Undo send notice", "File finder", "Dark mode switch">
<3 to 5 short lines in plain words: what it is for, how it opens (the keys or the click), what you can do in it, and how it closes>
No code, no headings, no lists of the page's own content (names, messages, file names). Write for someone who doesn't build software.`;

// language: the person's language by its English name ("German"), for the
// name and the lines they read; "" for English.
export function describeMessages(f, language = "") {
  const where = [f.from?.app, f.from?.host].filter(Boolean).join(", ");
  const parts = [
    `Taken from: ${where || "another app"}`,
    `What the person pointed at: ${f.label || f.name || "a part of the page"}${f.styles?.size ? ` (${f.styles.size} px)` : ""}`,
    ...featureLines(f),
    `Name this feature and say what it does${language ? `, in ${language}` : ""}.`,
  ];
  return [{ role: "system", content: DESCRIBE_SYSTEM }, { role: "user", content: parts.join("\n\n") }];
}

// The model's answer: the first line is the name, the rest is what it does.
export function parseDescription(text) {
  const lines = String(text || "").replace(/^\s*ANSWER\s*:\s*/i, "").split("\n").map(s => s.trim()).filter(Boolean);
  const first = (lines[0] || "").replace(/^[#*_>"“”'\s-]+|[*_"“”'.:\s]+$/g, "").trim();
  const name = first && first.length <= 60 && first.split(/\s+/).length <= 8 ? first : "";
  const about = (name ? lines.slice(1) : lines).map(l => l.replace(/^[-*•]\s*/, "")).join("\n").trim().slice(0, 900);
  return { name, about };
}

// Bring: the part of the request that says what to build and how it must fit.
export function bringPrompt(b) {
  if (!b || typeof b !== "object") return "";
  const from = b.from?.app || b.app || "another app";
  const name = b.name || b.what || "a feature";
  const lines = b.known
    ? [`The user wants a feature of another app brought here: “${name}” from ${from}. Nothing was taken from it, so build it from what you know of that feature in ${from}: how it opens, what it shows and how it responds.`]
    : [`The user wants a feature they took from another app brought here: “${name}”, taken from ${from}${b.from?.host && b.from.host !== from ? ` (${b.from.host})` : ""}.`];
  if (b.about) lines.push(`What it does there (written when it was taken):\n${b.about}`);
  lines.push(...featureLines(b));
  lines.push(`Build it here so it works the way it did there and looks like it shipped with this app:
- Make it work for real: it opens or turns on the way it did there (the same keys, unless this app already uses them for something; then pick free keys and say them once with morse.toast), and it responds to typing, clicks and keys the way it did. Something that opens over the page closes with Esc or a click outside.
- Fill it with this app's own things (the links, buttons, headings and items on this page, from the HTML and the page outline), never with the other app's data. Things it can do here must really work when chosen.
- Use this app's design, not the other app's: this app's font family and sizes, its text, background, border and accent colors, its spacing, corner radius and shadows, and its own components (reuse their classes when they are listed). Read them from the theme, the design notes, the CSS rules and the HTML you were given. The styles it had there are only for its layout and proportions.
- A look it switches to (a dark mode, a compact view) is this app's own colors and sizes, changed with care, not a filter over the whole page.
- Put it where the user pointed, or where such a thing belongs in this app (over the page for a palette or a finder, in the toolbar for a button, in a corner for a notice).
- If it only opens with keys, also add a small button for it where this app keeps such controls, with the keys in its title.
- Things it lists or acts on are found when it opens, with selectors that match the HTML and page outline you were given (links to places on this page may be written with its own address, like page.html#part).
- Build everything with morse.el and morse.on, so turning it off removes all of it.`);
  return lines.join("\n\n");
}

// After a brought feature's code runs (core/engine.js): selectors its JS uses
// to find this page's own things that match nothing. A palette that lists
// nothing still adds its button, so the page changed and the usual effect
// check passes; this catches it. Selectors for what the code makes itself
// (ids and classes it gives its own parts) are left out. A repair message, or null.
export function bringMisses(js, jsSelectors = [], unmatched = []) {
  const made = new Set([...String(js || "").matchAll(/\b(?:id|class|className)\s*[:=]\s*(["'`])([^"'`]+)\1/g)].flatMap(m => m[2].split(/\s+/)).filter(Boolean));
  const dead = new Set(unmatched || []);
  const ours = s => [...s.matchAll(/[#.](-?[_a-zA-Z][\w-]*)/g)].some(m => made.has(m[1]) || /^morse/.test(m[1]));
  // One call's list ("button, a[href], .row") is missing only when none of its parts match.
  const calls = [...String(js || "").matchAll(/(?:\b(?:watch|querySelectorAll|querySelector|byText)|\.\$\$?)\(\s*(["'`])((?:\\.|(?!\1)[^\\])+)\1/g)]
    .map(m => m[2].replace(/\\(.)/g, "$1").split(",").map(s => s.trim()).filter(Boolean));
  const miss = calls.filter(parts => parts.every(s => dead.has(s) && jsSelectors.includes(s)) && !parts.some(ours)).map(p => p.join(", ")).slice(0, 4);
  if (!miss.length) return null;
  return `It ran, but your JS looks for this page's things with selectors that match nothing here: ${miss.map(s => `\`${s}\``).join(", ")}, so what it lists or acts on would be empty. `
    + "Use selectors that match the HTML and page outline you were given (links to places on this page may be written with its own address, like page.html#part).";
}
