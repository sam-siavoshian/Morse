// Assembles the GitHub Pages site in dist/pages, laid out like the repo so the
// addresses the code uses keep working:
//
//   /RRAA/                         -> redirects to site/
//   /RRAA/site/                    landing page, gallery, privacy policy
//   /RRAA/privacy.html             redirects to site/privacy.html
//   /RRAA/site/mods/index.json     the gallery list (core/gallery.js GALLERY_INDEX_URL)
//   /RRAA/share/install.html       share links (core/mod.js SHARE_BASE)
//   /RRAA/core/, /RRAA/design/     modules and tokens the pages import
//   /RRAA/docs/launch/             the demo video and posters
//
// It also writes site/privacy.html from docs/privacy.md (committed, so the page
// works from a checkout too), and fails if any page links to a file that isn't
// published.
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

export function privacyPage(md) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Made from docs/privacy.md by scripts/build-pages.js. Edit that file, then run npm run pages. -->
<title>Morse privacy policy</title>
<meta name="description" content="What data leaves your computer when you use Morse, when, and to whom.">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../design/tokens.css">
<link rel="stylesheet" href="site.css">
<style>
  .doc { max-width: 720px; padding: 56px 0 96px; }
  .doc h1 { font-size: clamp(32px, 6vw, 44px); letter-spacing: -0.03em; line-height: 1.1; margin: 0 0 16px; }
  .doc h2 { font-size: 22px; letter-spacing: -0.02em; margin: 48px 0 12px; }
  .doc p, .doc li { color: var(--m-text-2); font-size: 16px; line-height: 1.65; }
  .doc p { margin: 12px 0; }
  .doc strong { color: var(--m-text); font-weight: 600; }
  .doc ul { padding-left: 20px; }
  .doc li { margin: 6px 0; }
  .doc a { color: var(--m-text); }
  .doc code { font-family: var(--m-mono); font-size: 0.88em; background: var(--m-raised); border: 1px solid var(--m-line); border-radius: 4px; padding: 1px 5px; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
  .doc .table { overflow-x: auto; margin: 16px 0; }
  .doc table { border-collapse: collapse; width: 100%; font-size: 14px; }
  .doc th, .doc td { text-align: left; vertical-align: top; padding: 10px 12px 10px 0; border-bottom: 1px solid var(--m-line); color: var(--m-text-2); }
  .doc th { color: var(--m-text); font-weight: 500; }
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="./" aria-label="Morse home"><span data-radar="20"></span>Morse</a>
    <nav class="nav" aria-label="Main">
      <a href="./#install">Install</a>
      <a href="gallery.html">Gallery</a>
      <a href="https://github.com/sam-siavoshian/RRAA">GitHub</a>
    </nav>
  </div>
</header>
<main class="wrap">
<article class="doc">
${mdToHtml(md)}
</article>
</main>
<footer class="foot">
  <div class="wrap">
    <a class="brand" href="./"><span data-radar="16" data-still></span>Morse</a>
    <nav aria-label="Footer">
      <a href="gallery.html">Gallery</a>
      <a href="privacy.html" aria-current="page">Privacy</a>
      <a href="https://github.com/sam-siavoshian/RRAA">GitHub</a>
      <a href="https://github.com/sam-siavoshian/RRAA/blob/HEAD/LICENSE">MIT license</a>
    </nav>
  </div>
</footer>
<script type="module">import { initPage } from "./common.js"; initPage();</script>
</body>
</html>
`;
}

export async function privacyHtml() {
  return privacyPage(await fs.readFile(path.join(root, "docs", "privacy.md"), "utf8"));
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
  // The policy's address is site/privacy.html (the Chrome Web Store listing
  // gives that one); /RRAA/privacy.html sends people there too.
  await fs.writeFile(path.join(out, "privacy.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Morse privacy policy</title>
<meta http-equiv="refresh" content="0; url=site/privacy.html">
<link rel="canonical" href="site/privacy.html"></head>
<body><a href="site/privacy.html">Morse privacy policy</a></body></html>
`);
  const broken = await brokenLinks(out);
  if (broken.length) throw new Error(`Links to files that aren't published:\n  ${broken.join("\n  ")}`);
  return { out, files: (await walk(out)).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    if (process.argv.includes("--check")) {
      const now = await fs.readFile(path.join(root, "site", "privacy.html"), "utf8").catch(() => "");
      if (now !== await privacyHtml()) throw new Error("site/privacy.html is out of date with docs/privacy.md. Run npm run pages.");
      console.log("site/privacy.html is current.");
    } else {
      const r = await buildPages();
      console.log(`Built ${path.relative(root, r.out)}: ${r.files} files.`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
