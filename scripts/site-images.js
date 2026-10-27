// The site's share picture and icons, drawn from HTML in the site's own look
// (site/site.css: near black, the grey ramp, Inter Display, the radar mark):
//
//   site/og-image.png            1200x630, the picture link previews show
//                                (Open Graph and Twitter cards): the
//                                headline on the day sky, and Visual Studio
//                                Code after the real Windows 95 run with the
//                                Morse bar in it (site/shots/211-…).
//   site/mark/apple-touch-icon.png  180x180, iOS home screen
//   site/mark/icon-192.png, icon-512.png  the web app manifest's icons
//
// (The favicon is site/favicon.png; site/icons/ holds the apps' own icons.)
//
//   node scripts/site-images.js     (needs Playwright; commit the PNGs)

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(root, "site");
const file = p => pathToFileURL(path.join(SITE, p)).href;

// The radar (site/radar.js): a 4x4 grid of rounded squares without its
// corners, the inner four bright and the rest dim.
export const radar = size => `<span style="display:inline-grid;grid-template-columns:repeat(4,1fr);gap:${size / 15}px;width:${size}px;height:${size}px;padding:${size / 17}px;flex:none">${
  Array.from({ length: 16 }, (_, i) => `<i style="border-radius:25%;background:#f4f4f5;opacity:${[0, 3, 12, 15].includes(i) ? 0 : [5, 6, 9, 10].includes(i) ? 1 : 0.35}"></i>`).join("")
}</span>`;

const FONTS = `
  @font-face { font-family: "Inter"; src: url("${file("fonts/inter-regular.woff2")}"); font-weight: 400; }
  @font-face { font-family: "Inter"; src: url("${file("fonts/inter-medium.woff2")}"); font-weight: 500 600; }
  @font-face { font-family: "Inter Display"; src: url("${file("fonts/interdisplay-semibold.woff2")}"); font-weight: 600; }
  @font-face { font-family: "JetBrains Mono"; src: url("${file("fonts/jetbrainsmono-regular.woff2")}"); font-weight: 400; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body { background: #0a0a0b; color: #ededef; font-family: Inter, sans-serif; -webkit-font-smoothing: antialiased; }
`;

export const OG = {
  file: "og-image.png",
  width: 1200,
  height: 630,
  alt: "Morse: change any app. Add anything. Delete anything. Closed source doesn’t stop you anymore. Visual Studio Code after one sentence made it look like Windows 95, with the Morse bar offering Save and Undo.",
};

// at: how the page reaches site/ (a file: address here; a served page can
// pass its own).
export const ogHtml = (at = file) => `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS.replace(/url\("[^"]*\/site\/([^"]+)"\)/g, (_, f) => `url("${at(f)}")`)}
  body { position: relative; background: linear-gradient(90deg, rgba(18, 52, 150, 0.55), rgba(18, 52, 150, 0.15) 55%, transparent), #3d72d6 url("${at("sky/day.webp")}") 50% 0% / 130% auto; }
  .text { position: absolute; left: 64px; top: 62px; width: 560px; color: #fff; text-shadow: 0 2px 20px rgba(10, 30, 100, 0.45); }
  .brand { display: flex; align-items: center; gap: 12px; font: 600 26px/1 "Inter Display"; letter-spacing: -0.03em; }
  h1 { margin-top: 64px; font: 600 74px/1.02 "Inter Display"; letter-spacing: -0.05em; }
  h1 span { display: block; color: rgba(255,255,255,.8); }
  p { max-width: 400px; margin-top: 26px; font-size: 23px; line-height: 1.4; color: rgba(255,255,255,.92); }
  .keys { position: absolute; left: 64px; bottom: 60px; text-shadow: 0 1px 12px rgba(10, 30, 100, 0.5); display: flex; align-items: center; gap: 8px; font-size: 17px; color: rgba(255,255,255,.88); }
  kbd { display: inline-grid; place-items: center; min-width: 40px; height: 36px; padding: 0 12px; border-radius: 9px; background: linear-gradient(#fdfdfe,#eceef3);
        color: #1b1d24; font: 500 15px/1 Inter; box-shadow: 0 3px 0 #b7bdcc, 0 6px 12px -6px rgba(10,30,90,.45); }
  .keys span { margin-left: 6px; }
  .win { position: absolute; left: 640px; top: 96px; width: 720px; height: 450px; border-radius: 14px; overflow: hidden;
         box-shadow: 0 0 0 8px rgba(255,255,255,.12), 0 0 0 8.5px rgba(255,255,255,.3), 0 40px 90px -20px rgba(6,20,64,.7); }
  .win img { width: 720px; height: 450px; display: block; }
  .bar { position: absolute; left: 56px; bottom: 20px; width: 440px; padding: 12px 14px; border-radius: 13px; background: rgba(255,255,255,.95);
         box-shadow: 0 0 0 .5px rgba(20,22,30,.14), 0 18px 40px -12px rgba(10,14,30,.5); color: #1b1d24; font: 400 14px/1.35 Inter; }
  .bar .ask { color: #5c606c; }
  .bar .row { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: .5px solid rgba(20,22,30,.12); }
  .bar b { flex: 1; font-weight: 500; }
  .bar .btn { padding: 6px 10px; border-radius: 7px; box-shadow: inset 0 0 0 .5px rgba(20,22,30,.22); font-weight: 500; }
  .bar .save { background: #111216; color: #fff; box-shadow: none; }
</style></head><body>
  <div class="text">
    <div class="brand">${radar(28)}Morse</div>
    <h1>Change any app.<span>Add anything. Delete anything.</span></h1>
    <p>Closed source doesn’t stop you anymore.</p>
  </div>
  <div class="keys"><kbd>⌥</kbd><kbd>Space</kbd><span>opens Morse in any app</span></div>
  <div class="win">
    <img src="${at("shots/211-vscode-windows-95-after.webp")}">
    <div class="bar">
      <div class="ask">make VS Code look like a classic Windows 95 app…</div>
      <div class="row"><b>Classic Windows 95 Look</b><span class="btn save">Save</span><span class="btn">Undo</span></div>
    </div>
  </div>
</body></html>`;

// A dark tile with the radar, light on dark so it reads on any tab bar.
const iconHtml = (size, { round = true } = {}) => `<!doctype html><html><head><style>${FONTS}
  body { display: grid; place-items: center; background: transparent; }
  .tile { width: ${size}px; height: ${size}px; display: grid; place-items: center; background: #0a0a0b;
          border-radius: ${round ? Math.round(size * 0.22) : 0}px; }
</style></head><body><div class="tile">${radar(Math.round(size * 0.68))}</div></body></html>`;

export const ICONS = [
  { file: "mark/apple-touch-icon.png", size: 180, round: false },
  { file: "mark/icon-192.png", size: 192 },
  { file: "mark/icon-512.png", size: 512 },
];

async function shoot(browser, html, width, height, out, omitBackground = false) {
  const page = await browser.newPage({ viewport: { width, height } });
  // From a file, so the page may load the fonts and screenshots in site/.
  const tmp = path.join(os.tmpdir(), `morse-site-image-${process.pid}.html`);
  await fs.writeFile(tmp, html);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
  await fs.rm(tmp, { force: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(SITE, out), omitBackground });
  await page.close();
  console.log(`site/${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
  try {
    await fs.mkdir(path.join(SITE, "mark"), { recursive: true });
    await shoot(browser, ogHtml(), OG.width, OG.height, OG.file);
    for (const i of ICONS) await shoot(browser, iconHtml(i.size, i), i.size, i.size, i.file, i.round !== false);
  } finally {
    await browser.close();
  }
}
