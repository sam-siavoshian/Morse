// Screenshots of the website (site/) and the share page (share/install.html)
// for docs/site/: the landing page, its nav menu (wide) and nav sheet (phone),
// the gallery and a mod's drawer, at 1440×900 and 390×844 (the site is light
// only), and the share page for a mod and for a broken link, dark and light.
// Full pages are whole; the menu, the drawer and the broken link are one
// screen. The pictures of Lanes beside Morse (compare-*) are made separately,
// from a local build of the Lanes site.
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
  const ctx = await browser.newContext({ viewport: SIZES[size], colorScheme: scheme, deviceScaleFactor: 1, reducedMotion: "reduce" });
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

for (const size of ["desktop", "mobile"]) {
  // The landing page, top to bottom, every picture loaded.
  let p = await page(size, "light");
  await p.goto(at("/site/"));
  await p.waitForLoadState("networkidle");
  await loadEveryPicture(p);
  await sleep(300);
  await shot(p, `landing-${size}.png`, true);
  // The nav: a menu panel on a wide screen, the sheet on a phone.
  if (size === "desktop") {
    await p.hover(".nav-item[data-menu] .nav-trigger");
    await p.waitForSelector("#nav-panel-product:not([hidden])");
  } else {
    await p.click(".nav-toggle");
    await p.waitForSelector(".nav.is-open");
  }
  await sleep(400);
  await shot(p, `landing-nav-${size}.png`, false);
  await p.context().close();

  // The gallery, and one mod opened in its drawer.
  p = await page(size, "light");
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
