// The Chrome Web Store promo images, drawn from HTML in Morse's design
// (design/tokens.css: dark surfaces, the gray signal ramp, Inter):
//
//   docs/store/promo/small-tile-440x280.png   the small promo tile
//   docs/store/promo/marquee-1400x560.png     the marquee
//
//   node scripts/store-promo.js      (after npm run store:screenshots: the
//                                     marquee shows docs/store/screenshots/2-…)

import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pngSize } from "./store-screenshots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "docs", "store", "promo");
const SHOT = path.join(root, "docs", "store", "screenshots", "2-save-what-you-like.png");

// The logo, as in scripts/build.js: a 3x3 grid in the signal ramp on a dark tile.
const GRID = ["#4a4a50", "#f4f4f5", "#7a7a82", "#b4b4bb", "#f4f4f5", "#7a7a82", "#f4f4f5", "#7a7a82", "#4a4a50"];
const logo = size => `<div class="logo" style="--s:${size}px">${GRID.map(c => `<i style="background:${c}"></i>`).join("")}</div>`;

const BASE = `
  @font-face { font-family: Inter; src: local("Inter"); }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; }
  body { background: #0b0b0c; color: #ededef; font-family: Inter, system-ui, sans-serif; letter-spacing: -0.01em; overflow: hidden; position: relative; -webkit-font-smoothing: antialiased; }
  .glow { position: absolute; inset: 0; background: radial-gradient(120% 90% at 0% 0%, #1c1c20 0%, rgba(11,11,12,0) 60%), radial-gradient(80% 80% at 100% 100%, #151518 0%, rgba(11,11,12,0) 60%); }
  .dots { position: absolute; inset: 0; background-image: radial-gradient(#ffffff0d 1px, transparent 1.2px); background-size: 16px 16px; mask-image: linear-gradient(90deg, transparent, #000 70%); }
  .logo { width: var(--s); height: var(--s); border-radius: calc(var(--s) * 0.22); background: #111113; box-shadow: inset 0 0 0 calc(var(--s) / 48) #2e2e33;
          display: grid; grid-template-columns: repeat(3, 1fr); gap: calc(var(--s) * 0.042); padding: calc(var(--s) * 0.208); flex: none; }
  .logo i { border-radius: calc(var(--s) * 0.03); }
  .name { font-family: "Inter Display", Inter, sans-serif; font-weight: 600; letter-spacing: -0.035em; }
  .bar { display: flex; align-items: center; gap: 12px; background: #fff; color: #111113; border-radius: 14px; box-shadow: 0 0 0 1px #d9d9de, 0 18px 50px rgba(0,0,0,.5); }
  .bar .dots9 { display: grid; grid-template-columns: repeat(4, 3px); gap: 1.5px; opacity: .8; }
  .bar .dots9 b { width: 3px; height: 3px; border-radius: 1px; background: #111113; }
  .bar .send { margin-left: auto; width: 32px; height: 32px; border-radius: 8px; background: #111113; color: #fff; display: grid; place-items: center; font-size: 16px; }
`;
// The radar from the bar (site/radar.js): a 4x4 grid without its corners.
const radar = () => `<span class="dots9">${Array.from({ length: 16 }, (_, i) => [0, 3, 12, 15].includes(i) ? "<b style=\"opacity:0\"></b>" : `<b style="opacity:${[5, 6, 9, 10].includes(i) ? 1 : 0.3}"></b>`).join("")}</span>`;

const small = () => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
  .wrap { position: absolute; inset: 0; padding: 40px 40px; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
  .row { display: flex; align-items: center; gap: 18px; }
  .name { font-size: 56px; line-height: 1; }
  .tag { font-size: 25px; line-height: 1.22; font-weight: 500; color: #ededef; letter-spacing: -0.02em; }
  .tag span { color: #a0a0a8; }
</style></head><body><div class="glow"></div><div class="dots"></div>
<div class="wrap">
  <div class="row">${logo(64)}<div class="name">Morse</div></div>
  <p class="tag">Change any website<br><span>in your own words.</span></p>
</div></body></html>`;

const marquee = shot => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
  .left { position: absolute; left: 88px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
  .row { display: flex; align-items: center; gap: 16px; margin-bottom: 40px; }
  .name { font-size: 40px; line-height: 1; }
  h1 { font-family: "Inter Display", Inter, sans-serif; font-size: 60px; line-height: 1.04; font-weight: 600; letter-spacing: -0.04em; }
  h1 span { color: #86868e; }
  p { margin-top: 24px; font-size: 22px; line-height: 1.45; color: #a0a0a8; max-width: 500px; }
  .shot { position: absolute; left: 690px; top: 113px; width: 650px; border-radius: 14px; overflow: hidden;
          box-shadow: 0 0 0 1px #2e2e33, 0 30px 80px rgba(0,0,0,.6), 0 8px 24px rgba(0,0,0,.4); background: #18181b; }
  .chrome { height: 34px; display: flex; align-items: center; gap: 7px; padding: 0 14px; background: #18181b; border-bottom: 1px solid #232327; }
  .chrome i { width: 10px; height: 10px; border-radius: 50%; background: #2e2e33; }
  .chrome .url { margin-left: 14px; height: 20px; flex: 0 0 300px; border-radius: 6px; background: #111113; color: #86868e; font-size: 11px; line-height: 20px; padding: 0 10px; }
  /* the part of the screenshot with the new Copy button and the bar, at 70% */
  .shot .pic { width: 650px; height: 300px; background: var(--img) -42px -268px / 896px 560px no-repeat; }
</style></head><body><div class="glow"></div><div class="dots"></div>
<div class="left">
  <div class="row">${logo(52)}<div class="name">Morse</div></div>
  <h1>Change any website<br><span>in your own words.</span></h1>
  <p>Point at something, say what you want, and watch the page change. Save what you like, and it is there next time.</p>
</div>
<div class="shot"><div class="chrome"><i></i><i></i><i></i><div class="url">pypi.org/project/requests</div></div><div class="pic" style="--img: url('${shot}')"></div></div>
</body></html>`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const render = async (html, width, height, file) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const tmp = path.join(OUT, `.${path.basename(file, ".png")}.html`);
    await fs.writeFile(tmp, html);
    await page.goto(pathToFileURL(tmp).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const buf = await page.screenshot({ omitBackground: false });
    await fs.rm(tmp);
    const size = pngSize(buf);
    if (size.width !== width || size.height !== height) throw new Error(`${file} came out ${size.width}x${size.height}`);
    await fs.writeFile(path.join(OUT, file), buf);
    console.log(`  docs/store/promo/${file}  ${width}x${height}`);
    await page.close();
  };
  await render(small(), 440, 280, "small-tile-440x280.png");
  await render(marquee(pathToFileURL(SHOT).href), 1400, 560, "marquee-1400x560.png");
  await browser.close();
}
