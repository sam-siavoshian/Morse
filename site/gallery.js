import { initPage, modCard, highlight, slugOf, esc, appGlyph, copyText, flash, toast } from "./common.js";
import { encodeShare, toUserscript } from "../core/mod.js";

initPage();

const $ = id => document.getElementById(id);
const grid = $("grid"), q = $("q"), filters = $("filters"), count = $("count"), empty = $("empty");
const drawer = $("drawer"), scrim = $("scrim");

let entries = [];
let app = "All";
const cards = new Map();   // slug -> card element
const mods = new Map();    // slug -> full mod (fetched on open)

// ---------- load + render ----------
try {
  entries = await (await fetch("mods/index.json")).json();
} catch (e) {
  grid.innerHTML = `<p class="muted">Couldn’t load the gallery. Check your connection and reload the page.</p>`;
}

for (const entry of entries) {
  const card = modCard(entry, { onOpen: e => open(slugOf(e)) });
  card.setAttribute("aria-haspopup", "dialog");
  cards.set(slugOf(entry), card);
  grid.append(card);
}

const apps = [...new Set(entries.map(e => e.app))].sort((a, b) => a.localeCompare(b));
for (const name of ["All", ...apps]) {
  const n = name === "All" ? entries.length : entries.filter(e => e.app === name).length;
  const b = Object.assign(document.createElement("button"), { type: "button", className: "g-filter" });
  b.innerHTML = `${esc(name)}<b>${n}</b>`;
  b.setAttribute("aria-pressed", String(name === app));
  b.addEventListener("click", () => {
    app = name;
    for (const x of filters.children) x.setAttribute("aria-pressed", String(x === b));
    apply();
  });
  filters.append(b);
}

function apply() {
  const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const entry of entries) {
    const hay = [entry.title, entry.prompt, entry.app, entry.surface, ...(entry.tags || [])].join(" ").toLowerCase();
    const ok = (app === "All" || entry.app === app) && words.every(w => hay.includes(w));
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

  $("d-app").innerHTML = `<span class="glyph" aria-hidden="true">${esc(appGlyph(entry.app))}</span>${esc(entry.app)}`;
  $("d-title").textContent = mod.title;
  $("d-prompt").textContent = `“${mod.prompt}”`;
  const where = mod.match?.app
    ? `<code>morse launch ${esc(mod.match.app)}</code>`
    : (mod.match?.hosts || []).map(h => `<code>${esc(h)}</code>`).join("");
  $("d-meta").innerHTML = `
    <dt>Runs in</dt><dd>${where}</dd>
    <dt>Works in</dt><dd>${esc(entry.surface || "web")}</dd>
    ${mod.target ? `<dt>Pointed at</dt><dd><code>${esc(mod.target.label || mod.target.selector)}</code></dd>` : ""}
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
  const slug = decodeURIComponent(location.hash.slice(1));
  if (slug && cards.has(slug)) open(slug, { push: false });
  else close({ push: false });
};
addEventListener("popstate", fromHash);
fromHash();
