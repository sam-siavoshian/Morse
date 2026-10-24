// Screenshots of the website (site/) and the share page (share/install.html)
// for docs/site/: the landing page whole at 390, 768, 1280 and 1440 pixels
// wide (and a check that none of them scrolls sideways), each of its sections
// at 1440 and 390, its first screen, its nav sheet on a phone, the gallery and
// a mod's drawer, the privacy policy, and the share page for a mod and for a
// broken link, dark and light. The site is dark only.
//
//   node demo/shoot-site.js            (SHOTS=dir to write elsewhere)
//
// The pages are served from this checkout on a free port and shown at
// 127.0.0.1:8787, where the share page expects to be.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createMod, encodeShare } from "../core/mod.js";
import { demoSites } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.env.SHOTS || path.join("docs", "site"));
await fs.mkdir(OUT, { recursive: true });
const sites = await demoSites();
const at = p => sites.url("parley", p);
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const WIDTHS = [390, 768, 1280, 1440];
// The landing page's sections, top to bottom.
const SECTIONS = { hero: ".hero", change: "#change", how: "#how", try: "#try", apps: "#apps", install: "#install", privacy: "#privacy", faq: "#faq", footer: "footer.foot" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A shared mod for the share page, like one a friend sends.
const mod = createMod({
  title: "Sleep timer", prompt: "add a sleep timer that pauses the music after a while", url: "https://open.spotify.com/",
  css: ".morse-sleep { background: none; border: 0; color: inherit; font-size: 16px; }",
  js: "morse.watch('[data-testid=\"player-controls\"]', bar => {\n  const btn = morse.el('button', { class: 'morse-sleep', text: '☾', title: 'Sleep timer' });\n  bar.append(btn);\n});",
  model: "Claude Code · sonnet",
});
const link = await encodeShare({ ...mod, author: "Sam" });
const SHARE = at(`/share/install.html#m=${link.split("#m=")[1]}`);

const browser = await chromium.launch();
async function page(size, scheme) {
  const viewport = typeof size === "number" ? { width: size, height: 900 } : SIZES[size];
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await sites.route(ctx);
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("  ! pageerror", e.message));
  return p;
}
const shot = async (p, name, full) => {
  await p.screenshot({ path: path.join(OUT, name), fullPage: full, animations: "disabled" });
  console.log("  📸", name);
};

// Lazy pictures load only near the screen, and a full-page screenshot doesn't
// scroll. So scroll down the page a screen at a time, then wait until every
// picture has decoded, and fail if one didn't, rather than shoot blank boxes.
async function loadEveryPicture(p) {
  const height = await p.evaluate(() => document.documentElement.scrollHeight);
  const step = p.viewportSize().height / 2;
  for (let y = 0; y < height; y += step) {
    await p.evaluate(top => window.scrollTo(0, top), y);
    await sleep(120);
  }
  const missing = await p.evaluate(async () => {
    await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
    await document.fonts.ready;
    return [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute("src"));
  });
  if (missing.length) throw new Error(`pictures that didn't load: ${missing.join(", ")}`);
  await p.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
}

// The landing page, whole, at each width: every picture loaded, and nothing
// wider than the screen.
const wide = [];
for (const width of WIDTHS) {
  const p = await page(width, "dark");
  await p.goto(at("/site/"));
  await p.waitForLoadState("networkidle");
  await loadEveryPicture(p);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 0) wide.push(`${width}px: ${over}px too wide`);
  await shot(p, `landing-${width}.png`, true);
  await p.context().close();
}
if (wide.length) throw new Error(`the landing page scrolls sideways: ${wide.join("; ")}`);

for (const size of ["desktop", "mobile"]) {
  // Each section of the landing page on its own.
  let p = await page(size, "dark");
  await p.goto(at("/site/"));
  await p.waitForLoadState("networkidle");
  await loadEveryPicture(p);
  // A tall section is shot in one piece, so the sticky nav would land on it.
  const hideNav = await p.addStyleTag({ content: "header.nav, .skip-link { visibility: hidden !important; }" });
  for (const [name, sel] of Object.entries(SECTIONS)) {
    await p.locator(sel).first().screenshot({ path: path.join(OUT, `section-${name}-${size}.png`), animations: "disabled" });
    console.log("  📸", `section-${name}-${size}.png`);
  }
  await hideNav.evaluate(el => el.remove());
  // The first screen, as someone arriving sees it.
  await p.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await shot(p, `landing-first-screen-${size}.png`, false);
  // The nav sheet on a phone.
  if (size === "mobile") {
    await p.click(".nav-toggle");
    await p.waitForSelector(".nav.is-open");
    await sleep(400);
    await shot(p, `landing-nav-${size}.png`, false);
  }
  await p.context().close();

  // The privacy policy.
  p = await page(size, "dark");
  await p.goto(at("/site/privacy.html"));
  await p.waitForLoadState("networkidle");
  await shot(p, `privacy-${size}.png`, false);
  await p.context().close();

  // The gallery, and one mod opened in its drawer.
  p = await page(size, "dark");
  await p.goto(at("/site/gallery.html"));
  await p.waitForSelector("#grid .card");
  await loadEveryPicture(p);
  await shot(p, `gallery-${size}.png`, true);
  await p.locator("#grid > *").first().click();
  await p.waitForSelector("#drawer.open");
  await sleep(500);
  await shot(p, `gallery-drawer-${size}.png`, false);
  await p.context().close();

  // The share page for a mod (it keeps the dark and light looks).
  for (const scheme of ["dark", "light"]) {
    p = await page(size, scheme);
    await p.goto(SHARE);
    await p.waitForSelector("ul.i-items li");
    await sleep(400);
    await shot(p, `install-${size}-${scheme}.png`, true);
    await p.context().close();
  }
}

// A link that was cut short.
{
  const p = await page("desktop", "dark");
  await p.goto(at("/share/install.html#m=jVOxctswDP0VFFklhVTsWGWuU4depw7"));
  await sleep(800);
  await shot(p, "install-bad-link-desktop-dark.png", false);
  await p.context().close();
}

await browser.close();
await sites.close();
