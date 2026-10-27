// Assembles the public site in dist/pages. The site is https://getmorse.vercel.app/
//
//   /                              landing page
//   /privacy.html                  privacy policy
//   /site/, /site/index.html       redirect to /
//   /site/privacy.html             redirects to /privacy.html
//   /site/mods/index.json          the gallery list (core/gallery.js GALLERY_INDEX_URL)
//   /share/install.html            share links (core/mod.js SHARE_BASE)
//   /core/, /design/               modules and tokens the pages import
//   /docs/launch/                  the launch videos and posters
//
// The pages' own files stay under site/. A <base href="site/"> on the root
// copies makes their relative paths (shots/, sky/, ../core/) resolve
// there, on this host and on a GitHub project site. Links to other pages step
// back out (../privacy.html). /site/mods/ stays put: installed copies of Morse
// already request that address.
//
// Every published page gets its canonical address, link previews (Open Graph
// and Twitter, with site/og-image.png) and structured data (JSON-LD) where its
// <!-- seo: … --> comment is, from its own <title> and description and the
// SEO_PAGES list below. Pages not in that list must say noindex. The build
// also writes sitemap.xml (the indexable pages) and robots.txt, and the
// repository's star count into the nav's [data-stars] (the page refreshes it;
// with no network the capsule says Star).
//
// It also writes site/privacy.html from docs/privacy.md, copies the nav bar and
// footer of site/index.html into site/privacy.html (all
// committed, so the pages work from a checkout too), and fails if any page
// links to a file that isn't published.
//
//   npm run pages            (the Pages workflow runs the same)
//   node scripts/build-pages.js --check    only check that site/privacy.html is current

import { promises as fs } from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { OG } from "./site-images.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(root, "dist", "pages");
// docs/showcase holds before and after pictures site/config.js may name; it is
// published when it exists.
const PUBLISH = ["site", "share", "core", "design/tokens.css", "docs/launch", "docs/showcase"];

// ---- search engines and link previews

// Where the site lives: package.json's homepage, with a trailing slash.
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
export const SITE_URL = new URL(pkg.homepage).href;
const REPO_URL = pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

// The pages people should find in a search, in the sitemap's order. url is
// the address relative to SITE_URL; crumbs names the page in a BreadcrumbList.
// share/install.html has link previews (people paste share links into chat)
// but stays out of search: what it shows depends on the link.
export const SEO_PAGES = [
  { file: "index.html", url: "", index: true, ld: ["site", "app", "faq"] },
  { file: "privacy.html", url: "privacy.html", index: true, crumbs: "Privacy policy" },
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
  const home = SITE_URL;
  // Pictures stay next to the page files, under /site/.
  const assets = `${SITE_URL}site/`;
  const graph = [];
  if (page.ld?.includes("site")) {
    graph.push({ "@type": "WebSite", "@id": `${home}#website`, name: "Morse", url: home, inLanguage: "en", publisher: { "@id": `${home}#org` } });
    graph.push({ "@type": "Organization", "@id": `${home}#org`, name: "Morse", url: home, logo: `${assets}mark/icon-512.png`, sameAs: [REPO_URL] });
  }
  if (page.ld?.includes("app")) {
    const { LINKS } = await import("../site/config.js");
    const app = {
      "@type": "SoftwareApplication",
      "@id": `${home}#app`,
      name: "Morse",
      alternateName: ["cheats for apps", "app cheats", "app mods"],
      keywords: "cheats for apps, app cheats, app mods, mod any app, mod any website, closed source, delete a paywall, bring a feature, desktop mods",
      description: pageDescription(html, page.file),
      url: home,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Windows, macOS, Linux",
      softwareVersion: pkg.version,
      softwareRequirements: "Google Chrome for websites; Node.js 22 or newer for the morse command",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      isAccessibleForFree: true,
      license: "https://opensource.org/licenses/MIT",
      image: assets + OG.file,
      screenshot: assets + OG.file,
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

// robots.txt lives at the host root (getmorse.vercel.app/robots.txt). The
// noindex tags are what keep pages out of search. Nothing is disallowed, so
// crawlers can read those tags.
export function robotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`;
}

// ---- the repository's stars

// The count GitHub shows, or null when it can't be had (no network, the rate
// limit). Never fails the build.
export async function fetchStars(repo = REPO_URL, { timeout = 4000 } = {}) {
  try {
    const res = await fetch(repo.replace("https://github.com/", "https://api.github.com/repos/"), {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "morse-pages" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const n = (await res.json()).stargazers_count;
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch { return null; }
}

export const withStars = (html, stars) => (stars == null ? html : html.replace(/(<span class="nav-stars-count" data-stars>)(<\/span>)/g, (_, a, b) => a + formatStars(stars) + b));
const formatStars = n => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

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
// site/index.html holds the one copy. The privacy policy takes
// its nav and footer from it, with the landing page's own links (#how) pointed back at it
// (./#how). The privacy policy is written whole; it keeps its
// copy between <!-- chrome:NAME --> and <!-- /chrome:NAME --> markers, and
// npm run pages refreshes it (--check fails when it is out of date).

export function siteChrome(index, page = "") {
  const pick = (name, re) => {
    const m = re.exec(index);
    if (!m) throw new Error(`site/index.html has no ${name}`);
    return m[0];
  };
  // Links into the landing page go back to it.
  const away = html => html
    .replace(/href="#top"/g, 'href="./"')
    .replace(/href="#([\w-]+)"/g, 'href="./#$1"')
    .replace(`<a class="nav-link" href="${page}">`, `<a class="nav-link" href="${page}" aria-current="page">`);
  return {
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
<link rel="icon" href="favicon.png" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="mark/apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<link rel="preload" as="font" type="font/woff2" href="fonts/interdisplay-semibold.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="fonts/inter-regular.woff2" crossorigin>
<link rel="stylesheet" href="site.css">
</head>
<body>
<a class="skip-link" href="#top">Skip to content</a>
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

// A root page keeps the files under site/. <base href="site/"> resolves
// favicon.png, shots/ and ../docs/ to that folder. Links to the other pages
// step back out, so they land on / and /privacy.html rather than /site/.
export function publishAtRoot(html) {
  if (!html.includes("<head>")) throw new Error("page has no <head>");
  return html.replace("<head>", "<head>\n<base href=\"site/\">").replace(/\shref="([^"]*)"/g, (full, href) => {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || href === "site/") return full;
    if (href === "./" || href === "index.html" || href === "./index.html") return ' href="../"';
    if (href === "privacy.html" || href === "./privacy.html") return ' href="../privacy.html"';
    if (href.startsWith("#")) return ` href="../${href}"`;
    if (href.startsWith("./#")) return ` href="..${href.slice(1)}"`;
    return full;
  });
}

function redirectHtml(to, title, canonical) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${to}">
<link rel="canonical" href="${canonical}"></head>
<body><a href="${to}">${title}</a></body></html>
`;
}

// Where a link lands inside the published folder. A <base href> (the root
// pages) is applied first. A path that is a directory names its index.html.
function resolvePublished(dir, file, ref, base) {
  const raw = decodeURIComponent(ref.split(/[?#]/)[0]);
  if (base) {
    const basePath = new URL(base, "https://example.com/").pathname;
    const rel = decodeURIComponent(new URL(raw || ".", `https://example.com${basePath}`).pathname).replace(/^\/+/, "");
    return rel === "" || rel.endsWith("/") ? path.join(dir, rel, "index.html") : path.join(dir, rel);
  }
  if (raw.startsWith("/")) {
    const rel = raw.replace(/^\/+/, "");
    return rel === "" || rel.endsWith("/") ? path.join(dir, rel, "index.html") : path.join(dir, rel);
  }
  let target = path.resolve(path.dirname(file), raw);
  if (raw.endsWith("/") || raw === "./" || raw === "../" || raw === "") target = path.join(target, "index.html");
  return target;
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
    const base = ext === ".html" ? (/<base href="([^"]+)">/.exec(text)?.[1] || "") : "";
    const refs = ext === ".html"
      ? [...text.matchAll(/\s(?:href|src|poster)="([^"]+)"/g), ...text.matchAll(/\bfrom\s+"(\.{1,2}\/[^"]+)"/g)].map(m => m[1])
      : [...text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+"(\.{1,2}\/[^"]+)"/g), ...text.matchAll(/\bimport\("(\.{1,2}\/[^"]+)"\)/g)].map(m => m[1]);
    for (const ref of refs) {
      if (base && ref === base) continue; // the <base> itself, not a file
      if (/^([a-z]+:|\/\/|#|\$\{)/i.test(ref) || ref.includes("${")) continue;
      const target = resolvePublished(dir, file, ref, base);
      const inside = target === dir || target.startsWith(dir + path.sep);
      if (!inside || !(await exists(target))) broken.push(`${path.relative(dir, file)} -> ${ref}`);
    }
  }
  return broken;
}

// refresh: false leaves site/privacy.html as they are
// (tests build into a folder of their own while other tests read those).
// stars: the count to write into the nav (fetchStars); left out, the
// published pages carry none and the browser asks GitHub.
export async function buildPages({ out = OUT, refresh = true, stars = null } = {}) {
  if (refresh) {
    await fs.writeFile(path.join(root, "site", "privacy.html"), await privacyHtml());
  }
  await fs.rm(out, { recursive: true, force: true });
  for (const p of PUBLISH) {
    if (p === "docs/showcase" && !(await fs.stat(path.join(root, p)).catch(() => null))) continue;
    await copy(path.join(root, p), path.join(out, p));
  }
  await fs.copyFile(path.join(root, "docs", "privacy.md"), path.join(out, "docs", "privacy.md"));
  await fs.writeFile(path.join(out, ".nojekyll"), "");
  // Read the copies under site/ before replacing them with redirects.
  for (const page of SEO_PAGES) {
    const fromSite = !page.file.startsWith("share/");
    const src = path.join(out, fromSite ? path.join("site", path.basename(page.file)) : page.file);
    let html = await withSeo(page, await fs.readFile(src, "utf8"));
    if (fromSite) html = withStars(publishAtRoot(html), stars);
    await fs.writeFile(path.join(out, page.file), html);
  }
  // Old addresses. vercel.json redirects these on Vercel; the refresh covers
  // GitHub Pages, which has no redirects file. Relative targets work both at
  // the domain root and under a project path.
  await fs.writeFile(path.join(out, "site", "index.html"), redirectHtml("../", "Morse", SITE_URL));
  await fs.writeFile(path.join(out, "site", "privacy.html"), redirectHtml("../privacy.html", "Morse privacy policy", `${SITE_URL}privacy.html`));
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
      console.log("site/privacy.html is current.");
    } else {
      const r = await buildPages({ stars: await fetchStars() });
      console.log(`Built ${path.relative(root, r.out)}: ${r.files} files.`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
