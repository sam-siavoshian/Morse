// Assembles the GitHub Pages site in dist/pages, laid out like the repo so the
// addresses the code uses keep working:
//
//   /RRAA/                         -> redirects to site/
//   /RRAA/site/                    landing page, gallery, privacy policy
//   /RRAA/site/mods/index.json     the gallery list (core/gallery.js GALLERY_INDEX_URL)
//   /RRAA/share/install.html       share links (core/mod.js SHARE_BASE)
//   /RRAA/core/, /RRAA/design/     modules and tokens the pages import
//   /RRAA/docs/launch/             the demo video and posters
//
// It also writes site/privacy.html from docs/privacy.md, copies the nav bar and
// footer of site/index.html into site/privacy.html and site/gallery.html (all
// committed, so the pages work from a checkout too), and fails if any page
// links to a file that isn't published.
//
//   npm run pages            (the Pages workflow runs the same)
//   node scripts/build-pages.js --check    only check that site/privacy.html is current

import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(root, "dist", "pages");
const PUBLISH = ["site", "share", "core", "design/tokens.css", "docs/launch"];

// ---- docs/privacy.md -> site/privacy.html

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${href}">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// The Markdown that docs/privacy.md uses: headings, paragraphs, "- " lists
// (continued by indented lines), tables, `code`, **bold** and [links](url).
export function mdToHtml(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = r => r.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const [head, , ...body] = rows;
      out.push(`<div class="table"><table>\n<thead><tr>${cells(head).map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead>\n<tbody>\n${body.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("\n")}\n</tbody>\n</table></div>`);
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && (/^- /.test(lines[i]) || (/^ {2,}\S/.test(lines[i]) && items.length))) {
        if (/^- /.test(lines[i])) items.push(lines[i].slice(2)); else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push(`<ul>\n${items.map(t => `<li>${inline(t)}</li>`).join("\n")}\n</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- )/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

// ---- the nav bar and footer, shared by every page
//
// site/index.html holds the one copy. The gallery and the privacy policy take
// theirs from it, with the landing page's own links (#how) pointed back at it
// (./#how). The privacy policy is written whole; site/gallery.html keeps its
// copy between <!-- chrome:NAME --> and <!-- /chrome:NAME --> markers, and
// npm run pages refreshes it (--check fails when it is out of date).

export function siteChrome(index, page = "") {
  const pick = (name, re) => {
    const m = re.exec(index);
    if (!m) throw new Error(`site/index.html has no ${name}`);
    return m[0];
  };
  // Links into the landing page go back to it; the icon sprite's #i-* stay.
  const away = html => html
    .replace(/href="#top"/g, 'href="./"')
    .replace(/href="#(?!i-)([\w-]+)"/g, 'href="./#$1"')
    .replace(`<a class="nav-trigger" href="${page}">`, `<a class="nav-trigger" href="${page}" aria-current="page">`);
  return {
    sprite: pick("icon sprite", /<svg width="0"[\s\S]*?<\/svg>/),
    header: away(pick("nav bar", /<header class="nav">[\s\S]*?<\/header>/)),
    footer: away(pick("footer", /<footer class="foot">[\s\S]*?<\/footer>/)),
  };
}

// Puts each part of the chrome between that part's markers in a page.
export function withChrome(html, chrome) {
  let out = html;
  for (const [name, part] of Object.entries(chrome)) {
    const re = new RegExp(`(<!-- chrome:${name} -->)[\\s\\S]*?(<!-- /chrome:${name} -->)`);
    if (!re.test(out)) throw new Error(`no <!-- chrome:${name} --> markers`);
    out = out.replace(re, (_, a, b) => `${a}\n${part}\n${b}`);
  }
  return out;
}

const readSite = f => fs.readFile(path.join(root, "site", f), "utf8");

export async function galleryHtml() {
  return withChrome(await readSite("gallery.html"), siteChrome(await readSite("index.html"), "gallery.html"));
}

export function privacyPage(md, chrome) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Made from docs/privacy.md and the nav of site/index.html by scripts/build-pages.js. Edit those, then run npm run pages. -->
<title>Morse privacy policy</title>
<meta name="description" content="What data leaves your computer when you use Morse, when, and to whom.">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preload" as="font" type="font/woff2" href="fonts/nunito-sans.woff2" crossorigin>
<link rel="stylesheet" href="site.css">
</head>
<body>
<a class="skip-link" href="#top">Skip to content</a>
${chrome.sprite}
${chrome.header}
<main id="top">
<section class="page-head">
  <div class="wrap">
    <div class="page-mark"><span data-radar="48" data-still></span></div>
    <p class="eyebrow">Privacy</p>
    <h1>Morse privacy policy</h1>
    <p class="lede">What leaves your computer when you use Morse, when, and to whom.</p>
  </div>
</section>
<article class="prose">
<div class="wrap">
${mdToHtml(md)}
</div>
</article>
</main>
${chrome.footer}
<script type="module">import { initPage } from "./common.js"; initPage();</script>
</body>
</html>
`;
}

export async function privacyHtml() {
  const md = await fs.readFile(path.join(root, "docs", "privacy.md"), "utf8");
  return privacyPage(md, siteChrome(await readSite("index.html"), "privacy.html"));
}

// ---- dist/pages

async function copy(from, to) {
  const st = await fs.stat(from);
  if (st.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    for (const f of await fs.readdir(from)) if (!f.startsWith(".")) await copy(path.join(from, f), path.join(to, f));
  } else {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
}

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

// Every relative href/src in the HTML and every relative import in the JS has
// to point at a published file.
export async function brokenLinks(dir) {
  const broken = [];
  const exists = async p => fs.stat(p).then(() => true, () => false);
  for (const file of await walk(dir)) {
    const ext = path.extname(file);
    if (ext !== ".html" && ext !== ".js") continue;
    const text = await fs.readFile(file, "utf8");
    const refs = ext === ".html"
      ? [...text.matchAll(/\s(?:href|src|poster)="([^"]+)"/g), ...text.matchAll(/\bfrom\s+"(\.{1,2}\/[^"]+)"/g)].map(m => m[1])
      : [...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"/g), ...text.matchAll(/\bimport\("(\.{1,2}\/[^"]+)"\)/g)].map(m => m[1]);
    for (const ref of refs) {
      if (/^([a-z]+:|\/\/|#|\$\{)/i.test(ref) || ref.includes("${")) continue;
      let target = path.resolve(path.dirname(file), decodeURIComponent(ref.split(/[?#]/)[0]));
      if (ref.split(/[?#]/)[0].endsWith("/") || ref === "./" || ref === "../") target = path.join(target, "index.html");
      if (!target.startsWith(dir) || !(await exists(target))) broken.push(`${path.relative(dir, file)} -> ${ref}`);
    }
  }
  return broken;
}

export async function buildPages({ out = OUT } = {}) {
  await fs.writeFile(path.join(root, "site", "privacy.html"), await privacyHtml());
  await fs.writeFile(path.join(root, "site", "gallery.html"), await galleryHtml());
  await fs.rm(out, { recursive: true, force: true });
  for (const p of PUBLISH) await copy(path.join(root, p), path.join(out, p));
  await fs.copyFile(path.join(root, "docs", "privacy.md"), path.join(out, "docs", "privacy.md"));
  await fs.writeFile(path.join(out, ".nojekyll"), "");
  await fs.writeFile(path.join(out, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Morse</title>
<meta http-equiv="refresh" content="0; url=site/">
<link rel="canonical" href="site/"></head>
<body><a href="site/">Morse</a></body></html>
`);
  const broken = await brokenLinks(out);
  if (broken.length) throw new Error(`Links to files that aren't published:\n  ${broken.join("\n  ")}`);
  return { out, files: (await walk(out)).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    if (process.argv.includes("--check")) {
      const now = await fs.readFile(path.join(root, "site", "privacy.html"), "utf8").catch(() => "");
      if (now !== await privacyHtml()) throw new Error("site/privacy.html is out of date with docs/privacy.md or site/index.html. Run npm run pages.");
      if (await readSite("gallery.html") !== await galleryHtml()) throw new Error("site/gallery.html's nav or footer is out of date with site/index.html. Run npm run pages.");
      console.log("site/privacy.html and site/gallery.html are current.");
    } else {
      const r = await buildPages();
      console.log(`Built ${path.relative(root, r.out)}: ${r.files} files.`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
