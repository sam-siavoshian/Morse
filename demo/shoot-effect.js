// Frames of the working effect from the playground, for design iteration
// (not used in the docs). The demo sites run on a free port.
//   node demo/shoot-effect.js [outDir] [light]
import { createRequire } from "node:module";
import { demoSites, pressOpen } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] || "docs/screenshots";
const light = process.argv[3] === "light";
const sites = await demoSites();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 });
await p.goto(sites.real("parley", `/demo/playground.html?ms=60${light ? "&light" : ""}`));
await p.waitForTimeout(500);
await pressOpen(p);
const tb = await p.locator("#toolbar").boundingBox();
await p.mouse.move(tb.x + 30, tb.y + tb.height / 2);
await p.mouse.click(tb.x + tb.width / 2, tb.y + 4);
// After pointing, typing goes straight to the bar (the Edit tools are behind Ctrl+E / ⌘E).
await p.keyboard.type("make the toolbar airier");
await p.keyboard.press("Enter");
for (const ms of [700, 1400, 2100]) {
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/effect-${light ? "light-" : ""}${ms}.png` });
}
await b.close();
await sites.close();
