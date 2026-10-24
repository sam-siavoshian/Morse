// The website (site/): every link and asset on its pages resolves.
//
//   - every relative href, src, poster and srcset in the HTML points at a file
//   - every #fragment points at an id on the page it names, and every
//     <use href="#i-…"> at an icon in the page's sprite
//   - gallery.html#<slug> links name a mod that is in site/mods/
//   - every url() in the stylesheets and every import in the scripts resolves
//   - the link targets and the demo video in site/config.js resolve too
//   - the nav bar and footer of the gallery and the privacy policy are the
//     landing page's (npm run pages copies them)
//   - no analytics, and nothing of the Lanes site it was designed after
//
// Links to other websites are checked for shape only; nothing is fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE = path.join(root, "site");
const PAGES = ["index.html", "gallery.html", "privacy.html"];
const read = f => readFileSync(path.join(SITE, f), "utf8");

const external = ref => /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//");
const ids = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

// Every place an HTML page names another file or a fragment.
export function refs(html) {
  const out = [];
  const noScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => (/\ssrc=/.test(m) ? m.replace(/>[\s\S]*<\/script>$/i, "></script>") : ""));
  for (const m of noScripts.matchAll(/\s(href|src|poster)="([^"]*)"/g)) out.push({ attr: m[1], ref: m[2] });
  for (const m of noScripts.matchAll(/\ssrcset="([^"]*)"/g)) for (const part of m[1].split(",")) out.push({ attr: "srcset", ref: part.trim().split(/\s+/)[0] });
  return out;
}

// Resolves one reference made from a file in site/; returns a problem or null.
function check(from, ref, pageIds) {
  if (!ref) return "an empty link";
  if (/^(mailto|javascript|data):/i.test(ref)) return /^javascript:/i.test(ref) ? "a javascript: link" : null;
  if (external(ref)) {
    try { const u = new URL(ref); return u.protocol === "https:" ? null : `not https: ${ref}`; }
    catch { return `not a valid address: ${ref}`; }
  }
  const [pathPart, hash] = ref.split("#");
  const target = pathPart ? path.resolve(path.dirname(path.join(SITE, from)), decodeURIComponent(pathPart.split("?")[0])) : path.join(SITE, from);
  let file = target;
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(root + path.sep)) return `outside the repository: ${ref}`;
  if (!existsSync(file)) return `no such file: ${ref}`;
  if (hash === undefined || hash === "") return null;
  if (!file.endsWith(".html")) return null;
  // gallery.html#<slug> opens that mod's drawer (gallery.js).
  if (path.basename(file) === "gallery.html" && pathPart) {
    return existsSync(path.join(SITE, "mods", `${hash}.morse.json`)) ? null : `no mod “${hash}” in site/mods/`;
  }
  const targetIds = pathPart ? ids(readFileSync(file, "utf8")) : pageIds;
  return targetIds.has(hash) ? null : `no id="${hash}" in ${path.relative(root, file)}`;
}

test("every link, image, video and icon on the site's pages resolves", () => {
  const broken = [];
  let checked = 0;
  for (const page of PAGES) {
    const html = read(page);
    const pageIds = ids(html);
    for (const { attr, ref } of refs(html)) {
      checked++;
      const problem = check(page, ref, pageIds);
      if (problem) broken.push(`site/${page} ${attr}="${ref}": ${problem}`);
    }
  }
  assert.ok(checked > 150, `the scan reads the pages' links (saw ${checked})`);
  assert.deepEqual(broken, [], `broken:\n${broken.join("\n")}`);
});

test("the landing page has what it promises: buttons, video slot, sections and real screenshots", () => {
  const html = read("index.html");
  for (const id of ["how", "show-me-once", "self-heal", "your-style", "packs", "desktop", "more", "privacy", "install", "install-chrome", "install-desktop", "faq", "get"]) {
    assert.ok(ids(html).has(id), `a section with id="${id}"`);
  }
  assert.match(html, /data-link="chrome"[^>]*>[\s\S]*?Get it for Chrome/);
  assert.match(html, /data-link="desktop"[^>]*>[\s\S]*?Get the desktop app/);
  assert.match(html, /data-film/, "the video slot");
  const shots = [...html.matchAll(/src="(shots\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(shots.length >= 12, `screenshots on the page (saw ${shots.length})`);
  for (const s of shots) assert.ok(existsSync(path.join(SITE, s)), s);
  // Every <img> has alt text and a size, so nothing shifts as it loads.
  for (const page of PAGES) {
    for (const img of read(page).match(/<img\b[^>]*>/g) || []) {
      assert.match(img, /\salt="[^"]*"/, `${page}: ${img}`);
      assert.match(img, /\swidth="\d+"[^>]*\sheight="\d+"/, `${page}: ${img}`);
    }
  }
});

test("site/config.js: the button targets and the demo video resolve", async () => {
  const { LINKS, DEMO_VIDEO } = await import("../site/config.js");
  const index = ids(read("index.html"));
  for (const [key, ref] of Object.entries(LINKS)) {
    const problem = check("index.html", ref, index);
    assert.equal(problem, null, `LINKS.${key} = ${ref}: ${problem}`);
    if (key !== "github" && key !== "docs") assert.match(read("index.html"), new RegExp(`data-link="${key}"`), `a button uses LINKS.${key}`);
  }
  for (const key of ["mp4", "poster"]) {
    const problem = check("index.html", DEMO_VIDEO[key], index);
    assert.equal(problem, null, `DEMO_VIDEO.${key} = ${DEMO_VIDEO[key]}: ${problem}`);
  }
  assert.ok(DEMO_VIDEO.width > 0 && DEMO_VIDEO.height > 0 && DEMO_VIDEO.label && DEMO_VIDEO.caption);
  // The Pages build publishes what the video slot points at.
  assert.match(readFileSync(path.join(root, "scripts", "build-pages.js"), "utf8"), /"docs\/launch"/, "docs/launch is published");
});

test("every url() in the stylesheets and every import in the scripts resolves", () => {
  const broken = [];
  for (const f of readdirSync(SITE).filter(f => f.endsWith(".css"))) {
    for (const m of read(f).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      if (m[1].startsWith("data:")) continue;
      if (!existsSync(path.resolve(SITE, m[1]))) broken.push(`site/${f} url(${m[1]})`);
    }
  }
  for (const f of readdirSync(SITE).filter(f => f.endsWith(".js"))) {
    for (const m of read(f).matchAll(/\bfrom\s+"(\.{1,2}\/[^"]+)"|\bimport\("(\.{1,2}\/[^"]+)"\)/g)) {
      const ref = m[1] || m[2];
      if (!existsSync(path.resolve(SITE, ref))) broken.push(`site/${f} import ${ref}`);
    }
  }
  for (const page of PAGES) {
    for (const m of read(page).matchAll(/\bfrom\s+"(\.{1,2}\/[^"]+)"/g)) if (!existsSync(path.resolve(SITE, m[1]))) broken.push(`site/${page} import ${m[1]}`);
  }
  assert.deepEqual(broken, []);
});

test("the gallery and the privacy policy carry the landing page's nav bar and footer", async () => {
  const { galleryHtml, privacyHtml } = await import("../scripts/build-pages.js");
  assert.equal(read("gallery.html"), await galleryHtml(), "run npm run pages");
  assert.equal(read("privacy.html"), await privacyHtml(), "run npm run pages");
  for (const page of ["gallery.html", "privacy.html"]) {
    const html = read(page);
    assert.match(html, /<header class="nav">/);
    assert.match(html, /<footer class="foot">/);
    assert.doesNotMatch(html.replace(/<use href="#i-[\w-]+"/g, "").replace(/href="#top"/g, ""), /href="#(?!top")[\w-]+"/, `${page}: the landing page's own #links point back at it`);
  }
});

test("no analytics, and nothing of the Lanes site but its design", () => {
  for (const f of readdirSync(SITE).filter(f => /\.(html|js|css)$/.test(f))) {
    const src = read(f);
    assert.doesNotMatch(src, /posthog|google-analytics|googletagmanager|gtag\(|plausible|segment\.com|mixpanel/i, `site/${f} loads no analytics`);
    // Lanes appears only in comments that credit the design: no link, asset or visible word.
    const visible = src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(visible, /trylanes|\blanes\b/i, `site/${f} shows nothing of Lanes`);
  }
  for (const f of readdirSync(path.join(SITE, "shots"))) assert.match(f, /^\d+-[\w-]+\.webp$/, `site/shots/${f} is one of Morse's own screenshots`);
  assert.ok(existsSync(path.join(SITE, "fonts", "NunitoSans-LICENSE.txt")), "the font's license ships with it");
});
