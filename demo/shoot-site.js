// Screenshots of the website (site/) and the share page (share/install.html)
// for docs/site/: the landing page, the gallery and a mod's drawer, the share
// page for a mod and for a broken link, at 1440×900 and 390×844, dark and light.
// Full pages are whole; the drawer and the broken link are one screen.
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
  model: "Claude Code · haiku",
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

for (const size of ["desktop", "mobile"]) {
  for (const scheme of ["dark", "light"]) {
    // The landing page, top to bottom.
    let p = await page(size, scheme);
    await p.goto(at("/site/"));
    await p.waitForLoadState("networkidle");
    await sleep(600);
    await shot(p, `landing-${size}-${scheme}.png`, true);
    await p.context().close();

    // The gallery, and one mod opened in its drawer.
    p = await page(size, scheme);
    await p.goto(at("/site/gallery.html"));
    await p.waitForSelector("#grid article, #grid .card, #grid > *");
    await sleep(500);
    await shot(p, `gallery-${size}-${scheme}.png`, true);
    await p.locator("#grid > *").first().click();
    await p.waitForSelector("#drawer.open");
    await sleep(500);
    await shot(p, `gallery-drawer-${size}-${scheme}.png`, false);
    await p.context().close();

    // The share page for a mod.
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
