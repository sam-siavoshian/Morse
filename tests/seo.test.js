// Search engines and link previews, on the built site (npm run pages):
//
//   - every page people should find has a short, unique title and
//     description, one <h1>, a canonical address, Open Graph and Twitter tags
//     with absolute addresses that are files in the build, and icons
//   - the structured data (JSON-LD) parses and has what Google asks for; the
//     FAQ's is the landing page's FAQ, word for word
//   - sitemap.xml lists exactly those pages and robots.txt points at it
//   - everything else (the share page, the demo apps in Try it here, the
//     redirects) says noindex
import { tempDir } from "./helpers/home.js"; // first: temp folders removed at exit
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildPages, SEO_PAGES, SITE_URL, faqOf } from "../scripts/build-pages.js";
import { OG } from "../scripts/site-images.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let out;
before(async () => { out = tempDir("morse-seo-"); await buildPages({ out, refresh: false }); });
after(() => fs.rm(out, { recursive: true, force: true }));

const built = file => readFileSync(path.join(out, file), "utf8");
const head = html => /<head>([\s\S]*?)<\/head>/.exec(html)[1];
const meta = (html, key) => {
  const m = new RegExp(`<meta (?:name|property)="${key.replace(/[.:]/g, "\\$&")}" content="([^"]*)">`).exec(head(html));
  return m && m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
};
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const title = html => unesc(/<title>([^<]*)<\/title>/.exec(html)[1]);
const canonical = html => /<link rel="canonical" href="([^"]+)">/.exec(head(html))?.[1];
const jsonLd = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const noindex = html => /<meta name="robots" content="noindex">/.test(html);

// An absolute address on the site, as the file in the build it names.
function fileFor(url) {
  assert.ok(url.startsWith(SITE_URL), `${url} is on ${SITE_URL}`);
  const rel = new URL(url).pathname.slice(new URL(SITE_URL).pathname.length);
  return path.join(out, rel.endsWith("/") || rel === "" ? rel + "index.html" : rel);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

test("the site's address is package.json's homepage", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(SITE_URL, "https://getmorse.vercel.app/");
  assert.equal(pkg.homepage, `${SITE_URL}site/`);
});

test("every page: a short, unique title and description, one <h1>, lang, viewport and icons", () => {
  const titles = new Set(), descriptions = new Set();
  for (const page of SEO_PAGES) {
    const html = built(page.file);
    const t = title(html), d = meta(html, "description");
    assert.ok(t.length >= 15 && t.length <= 60, `${page.file}: title of 15 to 60 characters (${t.length}): ${t}`);
    assert.ok(d && d.length >= 50 && d.length <= 155, `${page.file}: description of 50 to 155 characters (${d?.length}): ${d}`);
    assert.ok(!titles.has(t) && !descriptions.has(d), `${page.file}: its own title and description`);
    titles.add(t); descriptions.add(d);
    assert.match(html, /^<!doctype html>\n<html lang="en">/i, `${page.file}: lang`);
    assert.match(head(html), /<meta name="viewport" content="width=device-width, initial-scale=1">/, `${page.file}: viewport`);
    assert.match(head(html), /<meta name="theme-color" content="#[0-9a-f]{6}">/, `${page.file}: theme-color`);
    assert.match(head(html), /<link rel="apple-touch-icon" href="[^"]*mark\/apple-touch-icon\.png">/, `${page.file}: an apple-touch-icon`);
    assert.match(head(html), /<link rel="icon" href="[^"]*favicon\.png" type="image\/png" sizes="64x64">/, `${page.file}: the favicon`);
    assert.doesNotMatch(html, /<!-- seo:/, `${page.file}: the seo comment was filled in`);
    // The share page's heading is drawn by its script, after the link is read.
    if (page.file !== "share/install.html") assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${page.file}: one <h1>`);
  }
});

test("every page: canonical, Open Graph and Twitter tags with absolute addresses that are in the build", () => {
  for (const page of SEO_PAGES) {
    const html = built(page.file);
    const url = SITE_URL + page.url;
    assert.equal(canonical(html), url, `${page.file}: canonical`);
    assert.ok(existsSync(fileFor(url)), `${page.file}: its canonical address is the page itself`);
    assert.equal(meta(html, "og:url"), url);
    assert.equal(meta(html, "og:type"), "website");
    assert.equal(meta(html, "og:title"), title(html), `${page.file}: og:title is the title`);
    assert.equal(meta(html, "og:description"), meta(html, "description"));
    assert.equal(meta(html, "twitter:card"), "summary_large_image");
    assert.equal(meta(html, "twitter:title"), title(html));
    assert.equal(meta(html, "twitter:description"), meta(html, "description"));
    for (const key of ["og:image", "twitter:image"]) {
      const img = meta(html, key);
      assert.equal(img, `${SITE_URL}site/${OG.file}`, `${page.file}: ${key}`);
      assert.ok(existsSync(fileFor(img)), `${page.file}: ${key} is published`);
    }
    assert.equal(meta(html, "og:image:width"), String(OG.width));
    assert.equal(meta(html, "og:image:height"), String(OG.height));
    assert.ok(meta(html, "og:image:alt")?.length > 40 && meta(html, "twitter:image:alt") === meta(html, "og:image:alt"), `${page.file}: the picture is described`);
    for (const m of head(html).matchAll(/<meta (?:name|property)="(?:og|twitter):[\w:]+" content="(https?:[^"]+)">/g)) assert.match(m[1], /^https:\/\//, `${page.file}: ${m[1]} is absolute`);
    assert.equal(noindex(html), !page.index, `${page.file}: noindex only when it stays out of search`);
  }
});

test("the share picture is a 1200x630 PNG", () => {
  const png = readFileSync(path.join(root, "site", OG.file));
  assert.equal(png.toString("latin1", 1, 4), "PNG");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [OG.width, OG.height]);
  assert.deepEqual([OG.width, OG.height], [1200, 630]);
  for (const [f, size] of [["favicon.png", 64], ["mark/apple-touch-icon.png", 180], ["mark/icon-192.png", 192], ["mark/icon-512.png", 512]]) {
    const icon = readFileSync(path.join(root, "site", f));
    assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20)], [size, size], f);
  }
  const manifest = JSON.parse(readFileSync(path.join(root, "site", "site.webmanifest"), "utf8"));
  for (const i of manifest.icons) assert.ok(existsSync(path.join(root, "site", i.src)), i.src);
});

test("structured data: it parses, and has what each kind needs", async () => {
  const { LINKS } = await import("../site/config.js");
  const kinds = {};
  for (const page of SEO_PAGES) {
    for (const ld of jsonLd(built(page.file))) {
      assert.equal(ld["@context"], "https://schema.org");
      for (const node of ld["@graph"]) (kinds[node["@type"]] ||= []).push({ page, node });
    }
  }
  const [app] = kinds.SoftwareApplication;
  assert.equal(kinds.SoftwareApplication.length, 1);
  const a = app.node;
  for (const key of ["name", "description", "url", "operatingSystem", "applicationCategory"]) assert.ok(a[key], `SoftwareApplication.${key}`);
  assert.deepEqual(a.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" });
  assert.equal(a.description, meta(built(app.page.file), "description"));
  // Store and download addresses only once they are real (not the steps on the page).
  for (const [key, link] of [["installUrl", LINKS.chrome], ["downloadUrl", LINKS.desktop]]) {
    if (a[key]) assert.equal(a[key], link);
    else assert.ok(!/^https:/.test(link) || link.startsWith("https://github.com/"), `${key}: LINKS has a real address, so the data should name it`);
  }
  for (const url of [a.url, a.image, kinds.Organization[0].node.logo, kinds.WebSite[0].node.url]) assert.ok(existsSync(fileFor(url)), `${url} is published`);
  assert.equal(kinds.WebSite[0].node.name, "Morse");
  assert.equal(kinds.Organization[0].node.sameAs[0], LINKS.github);
  // Breadcrumbs: Morse, then the page.
  for (const { page, node } of kinds.BreadcrumbList) {
    const items = node.itemListElement;
    assert.deepEqual(items.map(i => i.position), [1, 2]);
    assert.equal(items[0].item, `${SITE_URL}site/`);
    assert.equal(items[1].item, SITE_URL + page.url);
    assert.ok(items.every(i => i.name), "every crumb is named");
  }
  assert.deepEqual(kinds.BreadcrumbList.map(b => b.page.file).sort(), ["site/gallery.html", "site/privacy.html"]);
});

test("the FAQ's structured data is the landing page's FAQ, word for word", () => {
  const html = built("site/index.html");
  const faq = jsonLd(html).flatMap(ld => ld["@graph"]).find(n => n["@type"] === "FAQPage");
  const shown = [...html.matchAll(/<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)]
    .map(m => [m[1], m[2]].map(s => unesc(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()));
  assert.ok(shown.length >= 4, `the page has its FAQ (saw ${shown.length})`);
  assert.deepEqual(faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]), shown);
  assert.ok(faq.mainEntity.every(q => q["@type"] === "Question" && q.acceptedAnswer["@type"] === "Answer"));
  // faqOf reads tags inside an answer as text.
  assert.deepEqual(faqOf('<details class="faq-item"><summary>Q &amp; A?</summary><p>See <a href="x">the <b>guide</b></a>.</p></details>'), [{ q: "Q & A?", a: "See the guide." }]);
});

test("sitemap.xml lists exactly the pages people should find; robots.txt points at it", () => {
  const sitemap = built("sitemap.xml");
  assert.match(sitemap, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  // Every published page that doesn't say noindex, and nothing else.
  const indexable = walk(out).filter(f => f.endsWith(".html") && !noindex(readFileSync(f, "utf8")));
  assert.deepEqual(listed.map(fileFor).sort(), indexable.sort());
  assert.deepEqual(listed, SEO_PAGES.filter(p => p.index).map(p => SITE_URL + p.url));
  for (const url of listed) assert.equal(canonical(readFileSync(fileFor(url), "utf8")), url, `${url} is its own canonical`);
  const robots = built("robots.txt");
  assert.match(robots, new RegExp(`^Sitemap: ${SITE_URL}sitemap\\.xml$`, "m"));
  assert.doesNotMatch(robots, /Disallow: \S/, "nothing is disallowed, so crawlers can read the noindex tags");
});

test("the share page and the redirects stay out of search", () => {
  for (const f of ["share/install.html", "index.html", "privacy.html"]) {
    assert.ok(noindex(built(f)), `${f} says noindex`);
  }
  // The redirects name their page by its full address.
  assert.equal(canonical(built("index.html")), `${SITE_URL}site/`);
  assert.equal(canonical(built("privacy.html")), `${SITE_URL}site/privacy.html`);
});

test("pages: every image says what it shows and has a size; no fonts from other servers", () => {
  for (const f of ["site/index.html", "site/gallery.html", "site/privacy.html", "share/install.html"]) {
    const html = built(f);
    for (const img of html.match(/<img\b[^>]*>/g) || []) {
      assert.match(img, /\swidth="\d+"[^>]*\sheight="\d+"/, `${f}: ${img}`);
      assert.match(img, /\salt="[^"]{20,}"/, `${f}: ${img} says what it shows`);
    }
    assert.doesNotMatch(head(html), /fonts\.googleapis|fonts\.gstatic/, `${f}: its fonts come from the site`);
  }
  // The day sky is the first screen's largest picture: preloaded, the half
  // size copy on a phone.
  const home = head(built("index.html"));
  assert.match(home, /<link rel="preload" as="image" href="sky\/day\.avif" type="image\/avif" media="\(min-width: 801px\)" fetchpriority="high">/);
  assert.match(home, /<link rel="preload" as="image" href="sky\/day-1280\.avif" type="image\/avif" media="\(max-width: 800px\)" fetchpriority="high">/);
});
