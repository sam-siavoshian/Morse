// The site's share picture and icons, drawn from HTML in the site's own look
// (site/site.css: near black, the grey ramp, Inter Display, the radar mark):
//
//   site/og-image.png            1200x630, the picture link previews show
//                                (Open Graph and Twitter cards). Real
//                                screenshots: VSCodium before and after
//                                "make it look like a retro green terminal"
//                                (site/shots/200-… and 201-…).
//   site/icons/icon-32.png       favicon for browsers without SVG favicons
//   site/icons/apple-touch-icon.png  180x180, iOS home screen
//   site/icons/icon-192.png, icon-512.png  the web app manifest's icons
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
export const radarSvg = (size, color = "#f4f4f5") => `<svg width="${size}" height="${size}" viewBox="-1 -1 17 17" fill="${color}">${
  Array.from({ length: 16 }, (_, i) => [0, 3, 12, 15].includes(i) ? "" : `<rect x="${(i % 4) * 4}" y="${Math.floor(i / 4) * 4}" width="3" height="3" rx=".75" opacity="${[5, 6, 9, 10].includes(i) ? 1 : 0.35}"/>`).join("")
}</svg>`;

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
  alt: "Morse: change any app in your own words. VSCodium before and after asking Morse to make it look like a retro green terminal.",
};

const ogHtml = () => `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
  body { position: relative; }
  .grid { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255,255,255,.07) 3px, transparent 3px) 0 0 / 22px 22px;
          -webkit-mask: linear-gradient(#000 3px, transparent 3px) 0 0 / 22px 22px; }
  .fade { position: absolute; inset: 0; background: radial-gradient(70% 90% at 15% 40%, rgba(10,10,11,.2), #0a0a0b 80%); }
  .text { position: absolute; left: 64px; top: 64px; width: 430px; }
  .brand { display: flex; align-items: center; gap: 12px; font: 600 26px/1 "Inter Display"; letter-spacing: -0.03em; }
  h1 { margin-top: 64px; font: 600 58px/1.02 "Inter Display"; letter-spacing: -0.05em; }
  h1 span { display: block; color: #8b8b94; }
  p { margin-top: 28px; font-size: 21px; line-height: 1.45; color: #a8a8b0; }
  .foot { position: absolute; left: 64px; bottom: 56px; font: 400 16px/1.4 "JetBrains Mono"; color: #8b8b94; }
  .shot { position: absolute; left: 536px; top: 96px; width: 600px; height: 375px; border-radius: 14px; overflow: hidden;
          box-shadow: 0 0 0 1px #2e2e33, 0 24px 60px rgba(0,0,0,.6); }
  .shot img { position: absolute; inset: 0; width: 600px; height: 375px; }
  .before { position: absolute; inset: 0; clip-path: inset(0 50% 0 0); }
  .line { position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; margin-left: -1px; background: #f4f4f5; }
  .tag { position: absolute; top: 14px; padding: 7px 10px; border-radius: 7px; background: rgba(10,10,11,.85); font: 400 14px/1 "JetBrains Mono"; color: #ededef; }
  .ask { position: absolute; left: 536px; top: 495px; width: 600px; font: 400 17px/1.45 "JetBrains Mono"; color: #ededef; }
  .ask small { display: block; margin-top: 4px; font-size: 14px; color: #8b8b94; }
</style></head><body>
  <div class="grid"></div><div class="fade"></div>
  <div class="text">
    <div class="brand">${radarSvg(28)}Morse</div>
    <h1>Change any app <span>in your own words.</span></h1>
    <p>Websites in Chrome and desktop apps like VSCodium and Obsidian. Say the change, and your AI makes it.</p>
  </div>
  <div class="foot">Free and open source</div>
  <div class="shot">
    <img src="${file("shots/201-vscodium-terminal-after.webp")}">
    <div class="before"><img src="${file("shots/200-vscodium-terminal-before.webp")}"></div>
    <span class="line"></span>
    <span class="tag" style="left:14px">Before</span>
    <span class="tag" style="right:14px">After</span>
  </div>
  <div class="ask">“make it look like a retro green terminal”<small>VSCodium on Linux · a real run</small></div>
</body></html>`;

// A dark tile with the radar, light on dark so it reads on any tab bar.
const iconHtml = (size, { round = true } = {}) => `<!doctype html><html><head><style>${FONTS}
  body { display: grid; place-items: center; background: transparent; }
  .tile { width: ${size}px; height: ${size}px; display: grid; place-items: center; background: #0a0a0b;
          border-radius: ${round ? Math.round(size * 0.22) : 0}px; }
</style></head><body><div class="tile">${radarSvg(Math.round(size * 0.68))}</div></body></html>`;

export const ICONS = [
  { file: "icons/icon-32.png", size: 32 },
  { file: "icons/apple-touch-icon.png", size: 180, round: false },
  { file: "icons/icon-192.png", size: 192 },
  { file: "icons/icon-512.png", size: 512 },
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
    await fs.mkdir(path.join(SITE, "icons"), { recursive: true });
    await shoot(browser, ogHtml(), OG.width, OG.height, OG.file);
    for (const i of ICONS) await shoot(browser, iconHtml(i.size, i), i.size, i.size, i.file, i.round !== false);
  } finally {
    await browser.close();
  }
}
