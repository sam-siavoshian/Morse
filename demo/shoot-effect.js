// Frames of the working effect from the playground, for design iteration.
//   node demo/shoot-effect.js [outDir] [light]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] || "docs/screenshots";
const light = process.argv[3] === "light";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 });
await p.goto(`http://127.0.0.1:8787/demo/playground.html?ms=60${light ? "&light" : ""}`);
await p.waitForTimeout(500);
await p.keyboard.press("Alt+Space");
const tb = await p.locator("#toolbar").boundingBox();
await p.mouse.move(tb.x + 30, tb.y + tb.height / 2);
await p.mouse.click(tb.x + tb.width / 2, tb.y + 4);
await p.keyboard.press("a"); // Ask: after pointing the edit toolbar has focus, and "m" would be Move
await p.keyboard.type("make the toolbar airier");
await p.keyboard.press("Enter");
for (const ms of [700, 1400, 2100]) {
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/effect-${light ? "light-" : ""}${ms}.png` });
}
await b.close();
