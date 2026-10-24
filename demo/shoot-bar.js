// Screenshots of voice, settings, the hotkey recorder, suggestions, the
// cheat sheet and Stop, from demo/bar-playground.html (real runtime, fake
// host). Chromium's fake microphone feeds the voice path; the page reports
// macOS so key caps render as ⌘⌥⇧.
//   node demo/shoot-bar.js [outDir]
import path from "node:path";
import { createRequire } from "node:module";
import { serveBar } from "./bar-server.js";
import { pressOpen } from "./helper.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(root, process.argv[2] || process.env.SHOTS || path.join("docs", "screenshots"));
const { url, close } = await serveBar();
const browser = await chromium.launch({ channel: "chromium", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

async function scene(name, query, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
    // Web Speech needs Google's servers, which this machine can't reach: make
    // that failure immediate, as it is inside Electron apps.
    globalThis.webkitSpeechRecognition = class extends EventTarget {
      start() { setTimeout(() => { this.onerror?.(Object.assign(new Event("error"), { error: "network" })); const end = new Event("end"); this.onend?.(end); this.dispatchEvent(end); }, 30); }
      stop() {} abort() {}
    };
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.error("pageerror", e.message));
  await page.goto(url + query);
  await page.waitForTimeout(400);
  await fn(page);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("  📸", name);
  await ctx.close();
}
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));
async function waitFor(page, pred, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = await status(page); if (pred(s)) return s; await page.waitForTimeout(30); }
  throw new Error("timeout; last " + JSON.stringify(await status(page)));
}
// Points at the element itself (its padding), not a child.
async function pointAt(page, sel) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 4, { steps: 4 });
  await page.mouse.click(b.x + b.width / 2, b.y + 4);
}

// 60 · voice: hold ⌥Space to talk; partial transcript streams in
await scene("60-voice.png", "", async p => {
  await pressOpen(p, "Alt+Space"); // a tap: the page reports macOS, so Open Morse is ⌥Space
  await pointAt(p, "#toolbar");
  await p.keyboard.down("Alt");
  await p.keyboard.down("Space");
  await waitFor(p, s => s.voice === "listening");
  await waitFor(p, s => /make the/.test(s.input), 9000);
  await waitFor(p, s => s.level > 0.7); // catch the meter on a peak

});

// 61 · settings (⌘,)
await scene("61-settings.png", "", async p => {
  await pressOpen(p, "Alt+Space"); // a tap: the page reports macOS, so Open Morse is ⌥Space
  await p.keyboard.press("Meta+Comma");
  await p.mouse.move(640, 500);
  await p.waitForTimeout(250);
});

// 62 · the hotkey recorder refusing ⌘Q
await scene("62-hotkey-recorder.png", "", async p => {
  await pressOpen(p, "Alt+Space"); // a tap: the page reports macOS, so Open Morse is ⌥Space
  await p.keyboard.press("Meta+Comma");
  await p.mouse.move(640, 500);
  await p.waitForTimeout(200);
  await p.keyboard.press("Tab"); // Open Morse -> Hold to talk
  await p.keyboard.press("Enter");
  await p.waitForTimeout(150);
  await p.keyboard.press("Meta+KeyQ");
  await p.waitForTimeout(120);
  await p.keyboard.down("Alt");
  await p.keyboard.down("Shift");
  await p.waitForTimeout(150);
});

// 63 · suggestions for a media control, keyboard on the first chip
await scene("63-suggestions.png", "", async p => {
  await pressOpen(p, "Alt+Space"); // a tap: the page reports macOS, so Open Morse is ⌥Space
  await pointAt(p, "#toolbar");
  await p.waitForTimeout(150);
  await p.keyboard.press("Tab");
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(150);
});

// 64 · the cheat sheet (?)
await scene("64-shortcuts.png", "", async p => {
  await pressOpen(p, "Alt+Space"); // a tap: the page reports macOS, so Open Morse is ⌥Space
  await p.keyboard.type("?");
  await p.waitForTimeout(250);
});

// 65 · stopped mid-generation (Esc): partial CSS gone, prompt kept
await scene("65-cancelled.png", "?ms=45", async p => {
  await pressOpen(p, "Alt+Space"); // a tap: the page reports macOS, so Open Morse is ⌥Space
  await pointAt(p, "#toolbar");
  await p.keyboard.type("make the toolbar airier and add a sleep timer");
  await p.keyboard.press("Enter");
  await waitFor(p, s => /Writing/.test(s.hint));
  await p.waitForTimeout(900);
  await p.keyboard.press("Escape");
  await waitFor(p, s => s.phase === "idle" && /Stopped/.test(s.hint));
  await p.waitForTimeout(200);
});

await browser.close();
await close();
