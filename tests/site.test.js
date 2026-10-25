// The website (site/): every link and asset on its pages resolves.
//
//   - every relative href, src, poster and srcset in the HTML points at a file
//   - every #fragment points at an id on the page it names
//   - gallery.html#<slug> links name a mod that is in site/mods/
//   - every url() in the stylesheets and every import in the scripts resolves
//   - the link targets, the demo video and the real pictures in site/config.js
//     resolve too, and every picture is labelled
//   - the nav bar and footer of the gallery and the privacy policy are the
//     landing page's (npm run pages copies them)
//   - no drawn pictures: no SVG at all (the favicon is a PNG, the functional
//     icons are text), and every app icon is the app's own, as a small PNG
//   - no analytics, and nothing of the Lanes site the first design came from
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
  assert.ok(checked > 100, `the scan reads the pages' links (saw ${checked})`);
  assert.deepEqual(broken, [], `broken:\n${broken.join("\n")}`);
});

test("the landing page has what it promises: buttons, video slot, sections and real screenshots", () => {
  const html = read("index.html");
  // A hero, see it change, how it works, try it here, real apps, install,
  // privacy, FAQ: one page that sells in a minute.
  for (const id of ["change", "how", "try", "apps", "install", "install-chrome", "install-desktop", "chrome-steps", "desktop-steps", "privacy", "faq"]) {
    assert.ok(ids(html).has(id), `a section with id="${id}"`);
  }
  // What was cut stays cut: feature rows, the logo wall, the idea list.
  for (const id of ["show-me-once", "self-heal", "your-style", "packs", "more", "features", "get"]) {
    assert.ok(!ids(html).has(id), `no section id="${id}" any more`);
  }
  assert.doesNotMatch(html, /logos\//, "no wall of logos");
  assert.match(html, /data-link="chrome"[^>]*>[\s\S]*?Add to Chrome/);
  assert.match(html, /data-link="desktop"[^>]*>[\s\S]*?Download Morse/);
  assert.match(html, /npm i -g morse-cli/, "one line for developers");
  assert.match(html, /data-film/, "the video slot");
  assert.match(html, /<section id="try" class="try" data-install="#install">/, "Try it here, pointing at the install section");
  const shots = [...html.matchAll(/src="(shots\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(shots.length >= 6, `screenshots on the page (saw ${shots.length})`);
  for (const s of shots) assert.ok(existsSync(path.join(SITE, s)), s);
  // The first run, in three pictures at most.
  const firstRun = /<ol class="first-run-list"[^>]*>([\s\S]*?)<\/ol>/.exec(html)?.[1] || "";
  const firstRunShots = (firstRun.match(/<img\b/g) || []).length;
  assert.ok(firstRunShots >= 1 && firstRunShots <= 3, `the first run in three pictures at most (saw ${firstRunShots})`);
  // Every <img> has alt text and a size, so nothing shifts as it loads; all
  // but the first screen's poster wait until they are near.
  for (const page of PAGES) {
    for (const img of read(page).match(/<img\b[^>]*>/g) || []) {
      assert.match(img, /\salt="[^"]*"/, `${page}: ${img}`);
      assert.match(img, /\swidth="\d+"[^>]*\sheight="\d+"/, `${page}: ${img}`);
      if (page === "index.html" && !/film-poster/.test(img)) assert.match(img, /\sloading="lazy"/, `${page}: ${img}`);
    }
  }
});

test("site/config.js: every real picture resolves and says what it shows", async () => {
  const { SHOWCASE, REAL_APPS } = await import("../site/config.js");
  assert.ok(SHOWCASE.length >= 3 && SHOWCASE.length <= 4, `three or four before and after pairs (saw ${SHOWCASE.length})`);
  for (const p of SHOWCASE) {
    for (const key of ["app", "kind", "ask", "by"]) assert.ok(p[key], `${p.app}: ${key}`);
    assert.ok(p.width > 0 && p.height > 0, `${p.app}: a size`);
    for (const side of ["before", "after"]) {
      assert.equal(check("index.html", p[side], new Set()), null, `${p.app} ${side}: ${p[side]}`);
      assert.ok(p.alt?.[side]?.length > 20, `${p.app}: says what the ${side} picture shows`);
    }
  }
  assert.ok(REAL_APPS.length >= 3, "a strip of real apps");
  for (const a of REAL_APPS) {
    assert.ok(a.app && a.kind && a.alt && a.width > 0 && a.height > 0, a.app);
    assert.ok(a.ask || a.by, `${a.app}: what was asked, or how it was changed`);
    assert.equal(check("index.html", a.src, new Set()), null, `${a.app}: ${a.src}`);
  }
  // VSCodium is labelled VSCodium; VS Code only where that is what ran.
  for (const p of [...SHOWCASE, ...REAL_APPS]) {
    if (/vscodium/i.test(p.before || p.src || "")) assert.equal(p.app, "VSCodium");
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
  // The autoplay loop is a small copy (the page's speed): each file resolves and stays under 2 MB.
  for (const [key, ref] of Object.entries(DEMO_VIDEO.loop || {})) {
    const problem = check("index.html", ref, index);
    assert.equal(problem, null, `DEMO_VIDEO.loop.${key} = ${ref}: ${problem}`);
    assert.ok(statSync(path.resolve(SITE, ref)).size < 2e6, `DEMO_VIDEO.loop.${key} is under 2 MB`);
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

test("no drawn pictures: real screenshots, real app icons, no SVG", async () => {
  // No SVG files, and no inline <svg> in the pages, their scripts or styles:
  // the favicon is the Morse mark as a PNG, the few functional icons are text
  // (→ ▶ ❚❚ ⟷ ×). Try it here (site/try/) is a live demo and keeps its own.
  const svgFiles = [], inline = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name), rel = path.relative(SITE, p);
      if (e.isDirectory()) { if (rel !== "try" && rel !== "mods") walk(p); }
      else if (e.name.endsWith(".svg")) svgFiles.push(rel);
      else if (/\.(html|js|css)$/.test(e.name) && /<svg\b/.test(readFileSync(p, "utf8"))) inline.push(rel);
    }
  };
  walk(SITE);
  assert.deepEqual(svgFiles, []);
  assert.deepEqual(inline, []);
  // Every app icon is a real PNG at most 64 pixels square, and small.
  const { APP_ICONS } = await import("../site/config.js");
  for (const [app, src] of Object.entries(APP_ICONS)) {
    const buf = readFileSync(path.join(SITE, src));
    assert.equal(buf.readUInt32BE(0), 0x89504e47, `${app}: ${src} is a PNG`);
    assert.ok(buf.readUInt32BE(16) <= 64 && buf.readUInt32BE(20) <= 64, `${app}: ${src} is at most 64 pixels`);
    assert.ok(buf.length < 20000, `${app}: ${src} is under 20 KB`);
  }
  // Every file in site/icons/ is named in APP_ICONS.
  const used = new Set(Object.values(APP_ICONS));
  for (const f of readdirSync(path.join(SITE, "icons"))) assert.ok(used.has(`icons/${f}`), `icons/${f} is in APP_ICONS`);
});

test("no analytics, and nothing of the Lanes site", () => {
  for (const f of readdirSync(SITE).filter(f => /\.(html|js|css)$/.test(f))) {
    const src = read(f);
    assert.doesNotMatch(src, /posthog|google-analytics|googletagmanager|gtag\(|plausible|segment\.com|mixpanel/i, `site/${f} loads no analytics`);
    const visible = src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(visible, /trylanes|\blanes\b/i, `site/${f} shows nothing of Lanes`);
  }
  // Morse's own look: dark, Inter and JetBrains Mono, not Lanes' Nunito Sans.
  const css = read("site.css");
  assert.match(css, /color-scheme: dark/);
  assert.doesNotMatch(css, /Nunito/i);
  for (const f of readdirSync(path.join(SITE, "shots"))) assert.match(f, /^\d+-[\w-]+\.webp$/, `site/shots/${f} is one of Morse's own screenshots`);
  for (const f of ["Inter-LICENSE.txt", "JetBrainsMono-LICENSE.txt"]) assert.ok(existsSync(path.join(SITE, "fonts", f)), `the fonts' licenses ship with them: ${f}`);
});
