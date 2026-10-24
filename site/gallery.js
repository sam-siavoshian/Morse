import { initPage, modCard, highlight, slugOf, esc, appIcon, copyText, flash, toast } from "./common.js";
import { encodeShare, toUserscript } from "../core/mod.js";
import { summarizeMod } from "../core/summary.js";

initPage();

const $ = id => document.getElementById(id);
const grid = $("grid"), q = $("q"), filters = $("filters"), count = $("count"), empty = $("empty");
const drawer = $("drawer"), scrim = $("scrim");

let entries = [];
let cat = "All", noScripts = false;
// The filters, in this order; a mod's "category" in mods/index.json.
const CATS = ["Reading", "Dark mode", "Declutter", "Layout", "Keyboard", "New features"];
const DEMO = "Demo apps";
const inCat = (e, c) => c === "All" || (c === DEMO ? !!e.demo : e.category === c);
const cards = new Map();   // slug -> card element
const mods = new Map();    // slug -> full mod (fetched on open)

// ---------- load + render ----------
try {
  entries = await (await fetch("mods/index.json")).json();
  // The ones with pictures first, then checked mods, the rest, and demo-app mods last.
  const rank = e => (e.shots ? (e.demo ? 1 : 0) : e.demo ? 4 : e.checked ? 2 : 3);
  entries.sort((x, y) => rank(x) - rank(y));
} catch (e) {
  grid.innerHTML = `<p class="muted">Couldn’t load the gallery. Check your connection and reload the page.</p>`;
}

// What a card says besides the request: whether it needs Chrome's “Allow
// User Scripts” (mods with code do; style-only mods don't), and demo-app mods.
// Chrome's switch only matters on websites, not in desktop apps.
const inChrome = e => /web/.test(e.surface || "web");
const noScriptsOk = e => inChrome(e) && e.userScripts === false;
const notesHtml = e => [
  !inChrome(e) ? "" : e.userScripts === false ? `<span class="g-badge ok">Works without “Allow User Scripts”</span>` : e.userScripts ? `<span class="g-badge">Needs “Allow User Scripts”</span>` : "",
  e.demo ? `<span class="g-badge demo">Demo app</span>` : "",
].join("");

for (const entry of entries) {
  const card = modCard(entry, { onOpen: e => open(slugOf(e)) });
  card.setAttribute("aria-haspopup", "dialog");
  if (entry.shots?.after) card.insertAdjacentHTML("afterbegin", `<img class="card-shot" src="mods/${esc(entry.shots.after)}" alt="" loading="lazy" width="640" height="400">`);
  const notes = notesHtml(entry);
  if (notes) card.querySelector(".tags").insertAdjacentHTML("beforebegin", `<p class="g-badges">${notes}</p>`);
  cards.set(slugOf(entry), card);
  grid.append(card);
}

const filterButton = (label, n, pressed, onClick) => {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "g-filter" });
  b.innerHTML = `${esc(label)}${n == null ? "" : `<b>${n}</b>`}`;
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", () => onClick(b));
  filters.append(b);
  return b;
};
const catButtons = [];
for (const name of ["All", ...CATS.filter(c => entries.some(e => e.category === c)), ...(entries.some(e => e.demo) ? [DEMO] : [])]) {
  catButtons.push(filterButton(name, entries.filter(e => inCat(e, name)).length, name === cat, b => {
    cat = name;
    for (const x of catButtons) x.setAttribute("aria-pressed", String(x === b));
    apply();
  }));
}
filterButton("Works without “Allow User Scripts”", entries.filter(noScriptsOk).length, noScripts, b => {
  noScripts = !noScripts;
  b.setAttribute("aria-pressed", String(noScripts));
  apply();
}).classList.add("g-switch");

function apply() {
  const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const entry of entries) {
    const hay = [entry.title, entry.prompt, entry.app, entry.category, entry.surface, ...(entry.tags || []), ...(entry.match?.hosts || []), entry.demo ? "demo" : ""].join(" ").toLowerCase();
    const ok = inCat(entry, cat) && (!noScripts || noScriptsOk(entry)) && words.every(w => hay.includes(w));
    cards.get(slugOf(entry)).hidden = !ok;
    if (ok) shown++;
  }
  count.textContent = shown === entries.length ? `${shown} mods` : `${shown} of ${entries.length} mods`;
  empty.hidden = shown > 0;
}
q.addEventListener("input", apply);
addEventListener("keydown", e => {
  if (e.key === "/" && !drawer.classList.contains("open") && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    q.focus();
  }
});
apply();

// ---------- drawer ----------
let lastFocus = null, current = null, links = {};

async function getMod(slug) {
  if (!mods.has(slug)) {
    const res = await fetch(`mods/${slug}.morse.json`);
    if (!res.ok) throw new Error(`mods/${slug}.morse.json: ${res.status}`);
    mods.set(slug, await res.json());
  }
  return mods.get(slug);
}

// The share link is exactly what Morse itself produces (core/mod.js encodeShare):
// the mod, deflate-raw compressed, base64url, in the #m= fragment. "Install"
// opens it on this site's own copy of the install page so it works anywhere
// the site is hosted; "Copy link" gives the canonical public link.
async function shareLinks(mod) {
  const canonical = await encodeShare(mod);
  const frag = canonical.slice(canonical.indexOf("#m="));
  const here = new URL("../share/install.html", location.href).href;
  return { canonical, local: here + frag };
}

async function open(slug, { push = true } = {}) {
  const entry = entries.find(e => slugOf(e) === slug);
  if (!entry) return;
  let mod;
  try { mod = await getMod(slug); }
  catch (e) { toast("Couldn’t open that mod. Reload the page and try again."); console.warn(e); return; }
  current = slug;
  lastFocus = document.activeElement;

  $("d-app").innerHTML = `${appIcon(entry.app)}${esc(entry.app)}`;
  $("d-title").textContent = mod.title;
  $("d-prompt").textContent = `“${mod.prompt}”`;
  const where = mod.match?.app
    ? `<code>morse launch ${esc(mod.match.app)}</code>`
    : (mod.match?.hosts || []).map(h => `<code>${esc(h)}</code>`).join("");
  // What it does: the same plain lines the install review shows (core/summary.js).
  const does = summarizeMod(mod).items.filter(i => i.id !== "code").map(i => esc(i.text));
  const needs = !inChrome(entry)
    ? "Nothing else. Open the app with Morse, and it runs there."
    : mod.js.trim()
    ? "“Allow User Scripts” in Chrome. Without it, only its look shows."
    : "Nothing else. It only changes how the page looks, so it works without “Allow User Scripts”.";
  $("d-shots").innerHTML = entry.shots?.before && entry.shots?.after
    ? `<figure><img src="mods/${esc(entry.shots.before)}" alt="${esc(entry.app)} before the mod" loading="lazy"><figcaption>Before</figcaption></figure>
       <figure><img src="mods/${esc(entry.shots.after)}" alt="${esc(entry.app)} with “${esc(mod.title)}”" loading="lazy"><figcaption>After</figcaption></figure>`
    : "";
  $("d-shots").hidden = !$("d-shots").innerHTML;
  $("d-meta").innerHTML = `
    <dt>What it does</dt><dd class="d-does">${does.map(t => `<span>${t}</span>`).join("")}</dd>
    <dt>Needs</dt><dd>${needs}</dd>
    <dt>Runs in</dt><dd>${where}</dd>
    ${entry.demo ? `<dt>Demo app</dt><dd><span>This mod is for one of the Morse demo apps, not a real website. Start them with <code>node demo/serve.js</code>.</span></dd>` : ""}
    <dt>Checked</dt><dd>${entry.checked ? esc(entry.checked) : "Not checked by Morse. Written by hand for this app."}</dd>
    ${mod.target?.label ? `<dt>Pointed at</dt><dd>${esc(mod.target.label)}</dd>` : ""}
    ${mod.note ? `<dt>Note</dt><dd>${esc(mod.note)}</dd>` : ""}
    <dt>By</dt><dd>${esc(mod.author || entry.author || "")}</dd>
    <dt>Tags</dt><dd>${(entry.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</dd>
    <dt>File</dt><dd><a href="mods/${esc(entry.file)}" download>${esc(entry.file)}</a></dd>`;

  links = await shareLinks(mod);
  $("d-install").href = links.local;
  const us = $("d-userscript");
  URL.revokeObjectURL(us.href);
  us.href = URL.createObjectURL(new Blob([toUserscript(mod)], { type: "text/javascript" }));
  us.download = `${slug}.user.js`;

  const blocks = [];
  if (mod.css.trim()) blocks.push(`<h3>Style (CSS) <span>${mod.css.split("\n").length} lines</span></h3><pre class="code">${highlight(mod.css.trimEnd(), "css")}</pre>`);
  if (mod.js.trim()) blocks.push(`<h3>Script (JavaScript) <span>${mod.js.split("\n").length} lines</span></h3><pre class="code">${highlight(mod.js.trimEnd(), "js")}</pre>`);
  $("d-code").innerHTML = blocks.join("");

  if (push && location.hash !== "#" + slug) history.pushState(null, "", "#" + slug);
  drawer.hidden = scrim.hidden = false;
  document.body.classList.add("locked");
  drawer.querySelector(".d-scroll").scrollTop = 0;
  requestAnimationFrame(() => {
    drawer.classList.add("open");
    scrim.classList.add("open");
    drawer.focus();
  });
}

function close({ push = true } = {}) {
  if (!current) return;
  current = null;
  drawer.classList.remove("open");
  scrim.classList.remove("open");
  document.body.classList.remove("locked");
  const done = () => { if (!current) drawer.hidden = scrim.hidden = true; };
  matchMedia("(prefers-reduced-motion: reduce)").matches ? done() : setTimeout(done, 220);
  if (push && location.hash) history.pushState(null, "", location.pathname + location.search);
  lastFocus?.focus?.();
}

$("d-close").addEventListener("click", () => close());
scrim.addEventListener("click", () => close());
$("d-copy").addEventListener("click", async e => {
  await copyText(links.canonical);
  flash(e.currentTarget, "Copied");
});
drawer.addEventListener("keydown", e => {
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  if (e.key !== "Tab") return;
  // Keep focus inside the dialog.
  const f = [...drawer.querySelectorAll("a[href], button, [tabindex]:not([tabindex='-1'])")].filter(x => x.offsetParent);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

const fromHash = () => {
  // A broken link (#%E0) can't be read: then it is no mod at all.
  let slug = "";
  try { slug = decodeURIComponent(location.hash.slice(1)); } catch {}
  if (slug && cards.has(slug)) open(slug, { push: false });
  else close({ push: false });
};
addEventListener("popstate", fromHash);
fromHash();
