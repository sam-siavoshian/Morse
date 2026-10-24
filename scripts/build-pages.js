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
//   /RRAA/demo/sites/tunes/, byte/ the demo apps in the landing page's Try it here
//   /RRAA/dist/extension/runtime.js  the Morse runtime that runs inside them
//
// Every published page gets its canonical address, link previews (Open Graph
// and Twitter, with site/og-image.png) and structured data (JSON-LD) where its
// <!-- seo: … --> comment is, from its own <title> and description and the
// SEO_PAGES list below. Pages not in that list must say noindex. The build
// also writes sitemap.xml (the indexable pages) and robots.txt.
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
import { readFileSync } from "node:fs";
import { bundleRuntime } from "../runtime/bundle.js";
import { OG } from "./site-images.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(root, "dist", "pages");
// docs/showcase holds before and after pictures site/config.js may name; it is
// published when it exists.
const PUBLISH = ["site", "share", "core", "design/tokens.css", "docs/launch", "docs/showcase", "demo/sites/tunes", "demo/sites/byte"];
// Try it here (site/try.js) loads the runtime from where scripts/build.js puts
// it; this writes the same file, so the build needs no other step first.
const RUNTIME = "dist/extension/runtime.js";

// ---- search engines and link previews

// Where the site lives: package.json's homepage is .../RRAA/site/.
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
export const SITE_URL = new URL("../", pkg.homepage).href;
const REPO_URL = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

// The pages people should find in a search, in the sitemap's order. url is
// the address relative to SITE_URL; crumbs names the page in a BreadcrumbList.
// share/install.html has link previews (people paste share links into chat)
// but stays out of search: what it shows depends on the link.
export const SEO_PAGES = [
  { file: "site/index.html", url: "site/", index: true, ld: ["site", "app", "faq"] },
  { file: "site/gallery.html", url: "site/gallery.html", index: true, crumbs: "Gallery" },
  { file: "site/privacy.html", url: "site/privacy.html", index: true, crumbs: "Privacy policy" },
  { file: "share/install.html", url: "share/install.html", index: false },
];

const unesc = s => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const tag = (html, re, what, file) => {
  const m = re.exec(html);
  if (!m) throw new Error(`${file} has no ${what}`);
  return unesc(m[1]);
};
export const pageTitle = (html, file = "a page") => tag(html, /<title>([^<]*)<\/title>/, "<title>", file);
export const pageDescription = (html, file = "a page") => tag(html, /<meta name="description" content="([^"]*)">/, "meta description", file);

// The landing page's FAQ, exactly as the page shows it.
export function faqOf(html) {
  return [...html.matchAll(/<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)]
    .map(m => ({ q: unesc(m[1]), a: unesc(m[2]) }));
}

// A store or download address in site/config.js LINKS, once there is one
// (until then they point at the install steps on the page).
const realLink = href => (/^https:\/\//.test(href || "") && !href.startsWith("https://github.com/") ? href : null);

export async function structuredData(page, html) {
  const url = SITE_URL + page.url;
  const home = SITE_URL + "site/";
  const graph = [];
  if (page.ld?.includes("site")) {
    graph.push({ "@type": "WebSite", "@id": `${home}#website`, name: "Morse", url: home, inLanguage: "en", publisher: { "@id": `${home}#org` } });
    graph.push({ "@type": "Organization", "@id": `${home}#org`, name: "Morse", url: home, logo: `${home}icons/icon-512.png`, sameAs: [REPO_URL] });
  }
  if (page.ld?.includes("app")) {
    const { LINKS } = await import("../site/config.js");
    const app = {
      "@type": "SoftwareApplication",
      "@id": `${home}#app`,
      name: "Morse",
      description: pageDescription(html, page.file),
      url: home,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Windows, macOS, Linux",
      softwareVersion: pkg.version,
      softwareRequirements: "Google Chrome for websites; Node.js 22 or newer for the morse command",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      isAccessibleForFree: true,
      license: "https://opensource.org/licenses/MIT",
      image: home + OG.file,
      screenshot: home + OG.file,
      publisher: { "@id": `${home}#org` },
    };
    if (realLink(LINKS.chrome)) app.installUrl = LINKS.chrome;
    if (realLink(LINKS.desktop)) app.downloadUrl = LINKS.desktop;
    graph.push(app);
  }
  if (page.ld?.includes("faq")) {
    const faq = faqOf(html);
    if (!faq.length) throw new Error(`${page.file} has no FAQ for its FAQPage data`);
    graph.push({ "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  }
  if (page.crumbs) {
    graph.push({ "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Morse", item: home },
      { "@type": "ListItem", position: 2, name: page.crumbs, item: url },
    ] });
  }
  return graph.length ? { "@context": "https://schema.org", "@graph": graph } : null;
}

const SEO_MARK = /<!-- seo:[^>]*-->/;

// The tags that take the place of a page's <!-- seo: … --> comment.
export async function seoTags(page, html) {
  const url = SITE_URL + page.url;
  const title = esc(pageTitle(html, page.file)), description = esc(pageDescription(html, page.file));
  const image = SITE_URL + "site/" + OG.file, alt = esc(OG.alt);
  const ld = await structuredData(page, html);
  return [
    `<link rel="canonical" href="${url}">`,
    page.index ? "" : `<meta name="robots" content="noindex">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Morse">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="${OG.width}">`,
    `<meta property="og:image:height" content="${OG.height}">`,
    `<meta property="og:image:alt" content="${alt}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<meta name="twitter:image:alt" content="${alt}">`,
    ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : "",
  ].filter(Boolean).join("\n");
}

export async function withSeo(page, html) {
  if (!SEO_MARK.test(html)) throw new Error(`${page.file} has no <!-- seo: … --> comment in its <head>`);
  const tags = await seoTags(page, html);
  return html.replace(SEO_MARK, () => tags);
}

export function sitemapXml() {
  const urls = SEO_PAGES.filter(p => p.index).map(p => `  <url><loc>${SITE_URL}${p.url}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

// Search engines read robots.txt only at the root of a host, and this site is
// a project site under /RRAA/, so this one is for completeness: the noindex
// tags are what keep pages out, and the sitemap is given to search consoles
// by its address. Nothing is disallowed, so crawlers can read those tags.
export function robotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`;
}

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
    .replace(`<a class="nav-link" href="${page}">`, `<a class="nav-link" href="${page}" aria-current="page">`);
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

// The page's own head holds the <h1>, so the policy's "# " title is left out
// (one <h1> per page).
export function privacyPage(md, chrome) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Made from docs/privacy.md and the nav of site/index.html by scripts/build-pages.js. Edit those, then run npm run pages. -->
<title>Morse privacy policy: what leaves your computer</title>
<meta name="description" content="What data leaves your computer when you use Morse, when, and to whom. No Morse account, no Morse server, no analytics.">
<meta name="theme-color" content="#0a0a0b">
<meta name="color-scheme" content="dark">
<!-- seo: npm run pages puts the canonical address, link previews and structured data here (scripts/build-pages.js) -->
<link rel="icon" href="icons/icon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<link rel="preload" as="font" type="font/woff2" href="fonts/interdisplay-semibold.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="fonts/inter-regular.woff2" crossorigin>
<link rel="stylesheet" href="site.css">
</head>
<body>
<a class="skip-link" href="#top">Skip to content</a>
${chrome.sprite}
${chrome.header}
<main id="top">
<section class="page-head">
  <div class="pixels" aria-hidden="true"></div>
  <div class="wrap">
    <p class="eyebrow">Privacy</p>
    <h1>Morse privacy policy</h1>
    <p class="lede">What leaves your computer when you use Morse, when, and to whom.</p>
  </div>
</section>
<article class="prose">
<div class="wrap">
${mdToHtml(md.replace(/^# .*\n+/, ""))}
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

// refresh: false leaves site/privacy.html and site/gallery.html as they are
// (tests build into a folder of their own while other tests read those).
export async function buildPages({ out = OUT, refresh = true } = {}) {
  if (refresh) {
    await fs.writeFile(path.join(root, "site", "privacy.html"), await privacyHtml());
    await fs.writeFile(path.join(root, "site", "gallery.html"), await galleryHtml());
  }
  await fs.rm(out, { recursive: true, force: true });
  for (const p of PUBLISH) {
    if (p === "docs/showcase" && !(await fs.stat(path.join(root, p)).catch(() => null))) continue;
    await copy(path.join(root, p), path.join(out, p));
  }
  await fs.mkdir(path.dirname(path.join(out, RUNTIME)), { recursive: true });
  await fs.writeFile(path.join(out, RUNTIME), bundleRuntime());
  await fs.copyFile(path.join(root, "docs", "privacy.md"), path.join(out, "docs", "privacy.md"));
  await fs.writeFile(path.join(out, ".nojekyll"), "");
  await fs.writeFile(path.join(out, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Morse</title>
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=site/">
<link rel="canonical" href="${SITE_URL}site/"></head>
<body><a href="site/">Morse</a></body></html>
`);
  // The policy's address is site/privacy.html (the Chrome Web Store listing
  // gives that one); /RRAA/privacy.html sends people there too.
  await fs.writeFile(path.join(out, "privacy.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Morse privacy policy</title>
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=site/privacy.html">
<link rel="canonical" href="${SITE_URL}site/privacy.html"></head>
<body><a href="site/privacy.html">Morse privacy policy</a></body></html>
`);
  for (const page of SEO_PAGES) {
    const f = path.join(out, page.file);
    await fs.writeFile(f, await withSeo(page, await fs.readFile(f, "utf8")));
  }
  await fs.writeFile(path.join(out, "sitemap.xml"), sitemapXml());
  await fs.writeFile(path.join(out, "robots.txt"), robotsTxt());
  // A page that isn't in SEO_PAGES stays out of search (the demo apps, the
  // redirects), so a new page can't slip in without a title and a preview.
  const listed = new Set(SEO_PAGES.map(p => path.join(out, p.file)));
  for (const f of (await walk(out)).filter(f => f.endsWith(".html") && !listed.has(f))) {
    if (!/<meta name="robots" content="noindex">/.test(await fs.readFile(f, "utf8"))) throw new Error(`${path.relative(out, f)} isn't in SEO_PAGES (scripts/build-pages.js) and doesn't say noindex`);
  }
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
