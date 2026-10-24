// The UI catalog: drives the real runtime (dist/extension/runtime.js) through
// every state of every element and saves one tight, element-cropped
// screenshot per state to docs/ui/<area>/<state>-<theme>.png, in a dark and a
// light host app, at desktop and phone width, and on hostile host pages.
// Each shot is also audited in the page (clipped text, off-screen boxes,
// control heights, host-style leakage, rendered text contrast), and
// docs/ui/index.html is written as a contact sheet with the verdicts.
//
//   npm run ui                      build + shoot everything + write index
//   node demo/ui-catalog.js --only=panel,modal
//   node demo/ui-catalog.js --index  rewrite index.html from catalog.json
//
// Needs Playwright (resolved from the global install).
import { createRequire } from "node:module";
import http from "node:http";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import path from "node:path";
// The default Open Morse hotkey: ⌥Space on macOS, Ctrl+Shift+Space elsewhere (core/hotkeys.js).
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "docs", "ui");
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const ONLY = args.only ? new Set(String(args.only).split(",")) : null;
const want = area => !ONLY || ONLY.has(area);

if (args.index) { await writeIndex(); process.exit(0); }

const { chromium } = createRequire(import.meta.url)("playwright");

// ---- a static server for this checkout (not whatever is on 8787)
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
    if (p.startsWith("/demo/sites/parley/")) headers["Content-Security-Policy"] = "script-src 'self'";
    res.writeHead(200, headers).end(await fs.readFile(file));
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
// a fake microphone (a tone) for the voice states; Web Speech is stubbed per page
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const LONG_ERROR = "TypeError: Cannot read properties of null (reading 'addEventListener') at morse.watch callback (mod.js:14:22) — the selector #toolbar > div.controls:nth-of-type(2) matched nothing after the app re-rendered the player";
const LONG_PROMPT = "make every playlist row show the total duration, the date I last played it, and a small button that shuffles only the songs I have never skipped";
const LONG_TITLE = "Sleep timer in the player bar that fades the volume out over the last thirty seconds";
const CODE_TOKENS = "TITLE: Airier toolbar\n```css\n#toolbar { gap: 20px; letter-spacing: .02em; padding: 12px 20px; }\n#toolbar button { opacity: .9; }\n```\n```js\nmorse.watch('#toolbar', t => t.append(morse.el('span', { text: 'hello' })));\n```\n".match(/.{1,4}/gs);

// ---------------------------------------------------------------- helpers
// Web Speech needs Google's servers: make it fail at once ("network"), as it
// does inside Electron apps, so voice falls back to the host's transcription.
const SPEECH_FAILS = () => {
  globalThis.SpeechRecognition = globalThis.webkitSpeechRecognition = class extends EventTarget {
    start() { setTimeout(() => { this.onerror?.(Object.assign(new Event("error"), { error: "network" })); const end = new Event("end"); this.onend?.(end); this.dispatchEvent(end); }, 30); }
    stop() {} abort() {}
  };
};
async function open({ theme = "dark", width = 1100, height = 720, mods = 0, url, reduced = false, extra = "", init = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: theme });
  ctx.setDefaultTimeout(10000);
  for (const fn of [SPEECH_FAILS, ...[].concat(init)]) await ctx.addInitScript(fn);
  const page = await ctx.newPage();
  page.on("pageerror", e => console.warn("  [pageerror]", e.message));
  await page.exposeFunction("__catCapture", async () => "data:image/png;base64," + (await page.screenshot()).toString("base64"));
  if (url) {
    await page.goto(`${BASE}${url}${url.includes("?") ? "&" : "?"}mods=${mods}${extra}`);
    await page.addScriptTag({ url: "/demo/catalog-host.js" });
    await page.addScriptTag({ url: "/dist/extension/runtime.js" });
  } else {
    await page.goto(`${BASE}/demo/catalog.html?theme=${theme}&mods=${mods}${extra}`);
  }
  await page.waitForFunction(() => globalThis.__cat?.calls.includes("mods.list"));
  await sleep(150);
  page.vp = width < 600 ? "narrow" : "";
  return page;
}
const ui = (page, sel) => page.locator(":root > [data-morse-ui]").locator(sel).first();
const close = page => page.context().close();

// One screenshot, cropped to the union of the given elements plus padding.
async function shot(page, area, state, targets, { pad = 12, theme, note, checks = [] } = {}) {
  const boxes = [];
  for (const t of [].concat(targets)) {
    const b = t && typeof t.boundingBox === "function" ? await t.boundingBox().catch(() => null) : t;
    if (b && b.width > 0 && b.height > 0) boxes.push(b);
  }
  const vw = page.viewportSize().width, vh = page.viewportSize().height;
  let clip = { x: 0, y: 0, width: vw, height: vh };
  if (boxes.length) {
    const x1 = Math.min(...boxes.map(b => b.x)), y1 = Math.min(...boxes.map(b => b.y));
    const x2 = Math.max(...boxes.map(b => b.x + b.width)), y2 = Math.max(...boxes.map(b => b.y + b.height));
    const x = Math.max(0, Math.floor(x1 - pad)), y = Math.max(0, Math.floor(y1 - pad));
    clip = { x, y, width: Math.min(vw, Math.ceil(x2 + pad)) - x, height: Math.min(vh, Math.ceil(y2 + pad)) - y };
  }
  theme ??= await page.evaluate(() => document.querySelector(":root > [data-morse-ui]")?.dataset.theme || "dark");
  const name = `${state}${page.vp ? "-" + page.vp : ""}-${theme}`;
  const file = path.join(OUT, area, `${name}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  let issues = [];
  if (clip.width > 0 && clip.height > 0) await page.screenshot({ path: file, clip });
  else issues.push("nothing to photograph (element missing or zero-size)");
  issues = issues.concat(await audit(page, clip), checks.filter(Boolean));
  results.push({ area, state: name, theme, file: path.relative(OUT, file), issues: [...new Set(issues)], note: note || "" });
  console.log(`  ${issues.length ? "!" : "✓"} ${area}/${name}${issues.length ? "  " + issues.join(" | ") : ""}`);
}

// Checks run inside the page against the live overlay.
async function audit(page, clip) {
  return page.evaluate(clip => {
    const out = [];
    const host = document.querySelector(":root > [data-morse-ui]");
    if (!host) return ["overlay host element missing"];
    const hs = getComputedStyle(host);
    if (hs.display === "none" || hs.visibility === "hidden" || +hs.opacity < 1) out.push(`host page hides the overlay (display:${hs.display}, opacity:${hs.opacity})`);
    if (hs.position !== "fixed" || hs.transform !== "none") out.push(`host page moves the overlay (position:${hs.position}, transform:${hs.transform})`);
    const root = host.shadowRoot;
    if (!root) return out.concat("shadow root closed (debug off)");
    const W = innerWidth, H = innerHeight;
    const visible = el => el.getClientRects().length && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden";
    // --- parse colors (rgb(), color(srgb …), with alpha)
    const parse = c => {
      let m = c.match(/rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/);
      if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
      m = c.match(/color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+))?/);
      if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
      return null;
    };
    const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
    const lum = c => { const f = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const pageBg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    const pageBase = pageBg[3] < 1 ? over(pageBg, [255, 255, 255, 1]) : pageBg;
    const bgOf = el => {
      const layers = [];
      for (let n = el; n && n !== root; n = n.parentNode instanceof ShadowRoot ? null : n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
      }
      return layers.reverse().reduce((acc, c) => over(c, acc), pageBase);
    };
    const opacityOf = el => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
    const name = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
    for (const el of root.querySelectorAll("*")) {
      if (!visible(el) || el.closest("svg, .sr") || el.tagName === "STYLE") continue;
      if (opacityOf(el) < 0.02) continue; // faded out (a tooltip that isn't showing)
      // the rect as painted: cut by ancestors that hide their overflow
      const cs = getComputedStyle(el), br = el.getBoundingClientRect();
      const r = { left: br.left, top: br.top, right: br.right, bottom: br.bottom };
      for (let n = el.parentElement; n; n = n.parentElement) {
        if (getComputedStyle(n).overflowX === "visible") continue;
        const p = n.getBoundingClientRect();
        r.left = Math.max(r.left, p.left); r.right = Math.min(r.right, p.right); r.top = Math.max(r.top, p.top); r.bottom = Math.min(r.bottom, p.bottom);
      }
      r.width = Math.max(0, r.right - r.left); r.height = Math.max(0, r.bottom - r.top);
      if (!r.width || !r.height) continue;
      if (el.matches(".fx, .pulse, .hl, .sel, .modal")) continue;
      const list = el.closest(".list");
      if (list && list !== el) {
        // inside the scrolling list only horizontal overflow is a bug
        const b = list.getBoundingClientRect();
        if (br.right > b.right + 0.5 || br.left < b.left - 0.5) out.push(`${name(el)} sticks out of the mods list horizontally`);
      } else if (r.right > W + 0.5 || r.left < -0.5 || r.top < -0.5 || r.bottom > H + 0.5) out.push(`${name(el)} is outside the viewport (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)})`);
      if (clip && !(r.right > clip.x && r.left < clip.x + clip.width && r.bottom > clip.y && r.top < clip.y + clip.height)) continue;
      // anything that sticks out of the bar / panel / card / toast it belongs to
      const box = el.parentElement && el.closest(".bar, .panel, .card, .toast, .gm-tb, .gm-pop, .gm-note, .gm-menu, .bmenu");
      if (box && box !== el && !el.closest(".list, .card textarea, .tip, .gm-chips, .pane")) {
        const b = box.getBoundingClientRect();
        if (r.right > b.right + 0.5 || r.left < b.left - 0.5) out.push(`${name(el)} sticks out of ${name(box)}`);
      }
      const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (text && !el.matches(".ticker, textarea, input") && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis")
        out.push(`${name(el)} clips its text without an ellipsis`);
      if (text && el.closest(".hint, .chip") && cs.overflowX === "visible" && el.parentElement.scrollWidth > el.parentElement.clientWidth + 1 && getComputedStyle(el.parentElement).textOverflow !== "ellipsis")
        out.push(`${name(el)} overflows ${name(el.parentElement)}`);
      if (text && !el.closest(".dim-ok")) {
        const fg = parse(cs.color);
        if (fg) {
          const bg = bgOf(el);
          const o = opacityOf(el);
          const c = ratio(over([fg[0], fg[1], fg[2], fg[3] * o], bg), bg);
          const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
          if (c < (big ? 3 : 4.5)) out.push(`contrast ${c.toFixed(2)} < ${big ? 3 : 4.5} on ${name(el)} “${el.textContent.trim().slice(0, 24)}”`);
        }
      }
      // every control is 20/24/28/32 tall (swatches 20, inline 24, buttons 28, the bar row and tool buttons 32)
      if (el.matches("button, .hk, .gm-hex, .gm-step, .link input, .gm-cap-note, .seg")) {
        const h = Math.round(br.height * 100) / 100;
        if (![20, 24, 28, 32].includes(h)) out.push(`${name(el)} height ${h}px is not 20/24/28/32`);
      }
      // radii: 6/10/14 from the tokens; 4 for kbd, tags and controls nested in a 6px control; 2 for the selection frame; round for switch, swatches, dots
      const rad = parseFloat(cs.borderTopLeftRadius);
      if (rad && ![2, 4, 6, 10, 14].includes(rad) && !(rad >= br.height / 2 - 0.5) && !/%/.test(cs.borderTopLeftRadius)) out.push(`${name(el)} radius ${rad}px is not 4/6/10/14`);
      // 1px lines (the picker outline is 1.5 on purpose and is an outline, not a border)
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        const w = parseFloat(cs[`border${side}Width`]);
        if (cs[`border${side}Style`] !== "none" && w && w !== 1) { out.push(`${name(el)} border-${side.toLowerCase()} is ${w}px, not 1px`); break; }
      }
    }
    // icons: one set, 16px, 1.5px strokes, round caps (the radar mark has its own sizes)
    for (const svg of root.querySelectorAll("svg:not(.radar)")) {
      if (!visible(svg) || opacityOf(svg.parentElement) < 0.02) continue;
      const b = svg.getBoundingClientRect();
      if (clip && !(b.right > clip.x && b.left < clip.x + clip.width && b.bottom > clip.y && b.top < clip.y + clip.height)) continue;
      if (Math.round(b.width) !== 16 || Math.round(b.height) !== 16) out.push(`icon in ${name(svg.parentElement)} is ${Math.round(b.width)}×${Math.round(b.height)}, not 16×16`);
      const cs = getComputedStyle(svg);
      if (cs.stroke !== "none" && parseFloat(cs.strokeWidth) !== 1.5) out.push(`icon in ${name(svg.parentElement)} has a ${cs.strokeWidth} stroke, not 1.5px`);
    }
    // host-style leakage: the overlay must look the same on any page
    for (const sel of [".bar", ".panel", ".card", ".toast", ".hl span", ".gm-tb", ".gm-pop", ".gm-menu", ".bmenu", ".pane"]) {
      const el = root.querySelector(sel);
      if (!el || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.direction !== "ltr") out.push(`${sel} inherits direction:${cs.direction}`);
      if (cs.textTransform !== "none") out.push(`${sel} inherits text-transform:${cs.textTransform}`);
      if (!/Inter|Geist Mono/.test(cs.fontFamily)) out.push(`${sel} font is ${cs.fontFamily.slice(0, 30)}`);
      if (cs.fontStyle !== "normal") out.push(`${sel} inherits font-style:${cs.fontStyle}`);
    }
    const bar = root.querySelector(".bar");
    if (bar && visible(bar)) {
      const w = bar.getBoundingClientRect().width, want = Math.min(680, W - 32);
      if (Math.abs(w - want) > 1) out.push(`bar is ${Math.round(w)}px wide, expected ${want} (page zoom/transform leaks in)`);
    }
    return out;
  }, clip);
}

// The highlight box must sit exactly on the element it describes.
async function alignCheck(page, target) {
  const t = await target.boundingBox(), h = await ui(page, ".hl").boundingBox();
  if (!t || !h) return "highlight missing";
  const d = Math.max(Math.abs(h.x + 3 - t.x), Math.abs(h.y + 3 - t.y), Math.abs(h.width - 6 - t.width), Math.abs(h.height - 6 - t.height));
  return d > 2 ? `highlight is ${Math.round(d)}px off its target` : "";
}

async function openBar(page) {
  await ui(page, ".bar").waitFor({ state: "hidden" });
  await page.keyboard.press(OPEN_KEY);
  await ui(page, ".bar").waitFor({ state: "visible" });
  await sleep(300);
}
async function hover(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  await page.mouse.move(b.x + Math.min(12, b.width / 2), b.y + b.height / 2, { steps: 2 });
  await sleep(150);
}
async function pick(page, sel) {
  await hover(page, sel);
  const b = await page.locator(sel).first().boundingBox();
  await page.mouse.click(b.x + Math.min(12, b.width / 2), b.y + b.height / 2);
  await sleep(150);
}
async function submit(page, text) {
  await ui(page, ".in").fill(text);
  await ui(page, ".in").press("Enter");
  await page.waitForFunction(() => globalThis.__cat.gen);
  await sleep(100);
}
async function stream(page, n = 24, gap = 35) {
  for (const t of CODE_TOKENS.slice(0, n)) { await page.evaluate(t => __cat.token(t), t); await sleep(gap); }
}
async function finish(page, res) {
  await page.evaluate(r => __cat.done(r), res);
  if (res.ok) await ui(page, "[data-a=keep]").waitFor({ timeout: 8000 });
  else await ui(page, "[data-a=again]").waitFor({ timeout: 8000 });
  await sleep(150);
}
const OK = (over = {}) => ({ ok: true, title: "Airier toolbar", css: "#toolbar { gap: 20px }", js: "", attempts: 1, ...over });
async function focusVisible(page, loc) {
  await page.keyboard.press("Shift");
  await loc.focus();
  await sleep(200); // past the 120ms transition
  return loc.evaluate(el => {
    if (!el.matches(":focus-visible")) return "focus does not match :focus-visible";
    // the indicator itself: a 2px ring (on the control, its track, or its field), or a highlighted menu row
    const ring = n => { const c = getComputedStyle(n); return (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) >= 2) || /0px 0px 0px [12]px/.test(c.boxShadow); };
    const host = el.closest(".gm-hex, .gm-step, .seg") || el.nextElementSibling;
    if (ring(el) || (el.matches(".sw input") && ring(el.nextElementSibling)) || (el.matches("input") && host && ring(host))) return "";
    if (el.matches("[role=menuitem], [role=menuitem] *") && getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)") return "";
    return "no visible focus indicator (no 2px ring)";
  });
}

// ---------------------------------------------------------------- areas
async function barStates(theme, width) {
  const n = width < 600;
  let p = await open({ theme, width, height: n ? 844 : 720 });
  await openBar(p);
  await p.mouse.move(5, (n ? 844 : 720) / 2);
  await shot(p, "bar", "picking", ui(p, ".bar"));
  if (!n) await shot(p, "radar", "mark-static", ui(p, ".row .mark"), { pad: 8 });

  // picker: hover labels
  if (!n) {
    await hover(p, "#small");
    await shot(p, "picker", "hover-small", [ui(p, ".hl"), ui(p, ".hl span")], { pad: 16, checks: [await alignCheck(p, p.locator("#small"))] });
    await hover(p, "#big");
    await shot(p, "picker", "hover-large", [ui(p, ".hl"), ui(p, ".hl span")], { pad: 16 });
    await hover(p, "#topEdge");
    await shot(p, "picker", "hover-top-edge", [ui(p, ".hl"), ui(p, ".hl span")], { pad: 8 });
    await hover(p, "#rightEdge");
    await shot(p, "picker", "hover-right-edge", [ui(p, ".hl"), ui(p, ".hl span")], { pad: 8 });
  } else {
    await hover(p, "#card");
    await shot(p, "picker", "hover-large", [ui(p, ".hl"), ui(p, ".hl span")], { pad: 16 });
  }

  // chips
  await pick(p, "#small");
  await shot(p, "bar", "chip-short", ui(p, ".bar"));
  if (!n) {
    await shot(p, "picker", "selected", [p.locator("#small"), ui(p, ".sel")], { pad: 16 });
    // with a target picked the bar stops dodging the cursor, so its controls can be hovered
    await ui(p, ".go").hover(); await sleep(150);
    await shot(p, "bar", "go-hover", ui(p, ".go"), { pad: 8 });
    await shot(p, "bar", "go-focus", ui(p, ".go"), { pad: 8, checks: [await focusVisible(p, ui(p, ".go"))] });
    await ui(p, "[data-a=mods]").hover(); await sleep(150);
    await shot(p, "bar", "mods-button-hover", ui(p, ".actions"), { pad: 8 });
    await shot(p, "bar", "mods-button-focus", ui(p, ".actions"), { pad: 8, checks: [await focusVisible(p, ui(p, "[data-a=mods]"))] });
    await ui(p, ".in").focus();
    await shot(p, "bar", "input-focus", ui(p, ".row"), { pad: 4, note: "the input has no ring by design; the caret and the bar are the focus" });
    await ui(p, ".chip .x").hover(); await sleep(150);
    await shot(p, "bar", "chip-x-hover", ui(p, ".chip"), { pad: 8 });
    await shot(p, "bar", "chip-x-focus", ui(p, ".chip"), { pad: 8, checks: [await focusVisible(p, ui(p, ".chip .x"))] });
    await ui(p, ".chip .x").click(); await sleep(100);
  } else { await ui(p, ".chip .x").click(); await sleep(100); }
  await pick(p, "#long");
  await shot(p, "bar", "chip-long", ui(p, ".bar"));

  // typing
  await ui(p, ".in").fill("make it airier");
  await shot(p, "bar", "typing-short", ui(p, ".bar"));
  await ui(p, ".in").fill(LONG_PROMPT);
  await ui(p, ".in").press("End");
  await shot(p, "bar", "typing-long", ui(p, ".bar"));
  await ui(p, ".in").fill("");
  await p.evaluate(() => navigator.clipboard?.writeText).catch(() => {});
  await ui(p, ".in").evaluate(el => { el.focus(); document.execCommand("insertText", false, "first line\nsecond line\nthird line"); });
  await shot(p, "bar", "typing-multiline", ui(p, ".bar"), { note: "single-line input: pasted newlines collapse to spaces (by design; Enter submits)" });

  // working
  await submit(p, "make the shuffle button bigger");
  await shot(p, "bar", "thinking", ui(p, ".bar"));
  if (!n) await shot(p, "radar", "mark-live", ui(p, ".row .mark"), { pad: 8 });
  await stream(p, 30, 25);
  await shot(p, "bar", "writing", ui(p, ".bar"));
  await p.evaluate(e => __cat.phase("fixing", e), LONG_ERROR); await sleep(80);
  await shot(p, "bar", "fixing", ui(p, ".bar"));
  await p.evaluate(() => __cat.phase("applying")); await sleep(80);
  await shot(p, "bar", "applying", ui(p, ".bar"));
  await finish(p, OK());
  await shot(p, "bar", "result", ui(p, ".bar"));
  if (!n) {
    for (const a of ["keep", "undo", "code", "share"]) {
      await ui(p, `[data-a=${a}]`).hover(); await sleep(150);
      await shot(p, "bar", `result-${a}-hover`, ui(p, ".actions"), { pad: 8 });
      await shot(p, "bar", `result-${a}-focus`, ui(p, ".actions"), { pad: 8, checks: [await focusVisible(p, ui(p, `[data-a=${a}]`))] });
    }
  }
  await close(p);

  // result variants + error
  p = await open({ theme, width, height: n ? 844 : 720 });
  await openBar(p); await pick(p, "#card");
  await submit(p, LONG_PROMPT);
  await finish(p, OK({ title: LONG_TITLE, attempts: 2 }));
  await shot(p, "bar", "result-long-repaired", ui(p, ".bar"));
  await ui(p, "[data-a=undo]").click();
  await ui(p, ".bar").waitFor({ state: "hidden" });
  await openBar(p); await pick(p, "#card");
  await submit(p, "make the shuffle button bigger");
  await finish(p, { ok: false, error: LONG_ERROR });
  await shot(p, "bar", "error", ui(p, ".bar"));
  if (!n) {
    await ui(p, "[data-a=again]").hover(); await sleep(150);
    await shot(p, "bar", "error-again-hover", ui(p, ".actions"), { pad: 8 });
    await shot(p, "bar", "error-again-focus", ui(p, ".actions"), { pad: 8, checks: [await focusVisible(p, ui(p, "[data-a=again]"))] });
  }
  await close(p);

  // with mods: the Mods count badge
  p = await open({ theme, width, height: n ? 844 : 720, mods: 12 });
  await openBar(p);
  await shot(p, "bar", "picking-with-mods", ui(p, ".bar"));
  await close(p);
}

async function effectStates(theme) {
  for (const [state, sel] of [["toolbar-wide", "#toolbar"], ["sidebar-tall", "#sidebar"], ["card-square", "#card"], ["small-target", "#small"], ["page", null]]) {
    const p = await open({ theme });
    await openBar(p);
    if (sel) await pick(p, sel); else await p.mouse.move(5, 360);
    await submit(p, "make it airier");
    await sleep(800);
    const fx = ui(p, ".fx");
    await shot(p, "effect", `${state}-thinking`, sel ? fx : null, { pad: 16 });
    await stream(p, 18, 30);
    await shot(p, "effect", `${state}-writing`, sel ? fx : null, { pad: 16 });
    if (state === "card-square") {
      await p.evaluate(r => __cat.done(r), OK());
      await sleep(330);
      await shot(p, "effect", "card-square-landing", fx, { pad: 16 });
      await ui(p, ".pulse").waitFor({ state: "attached", timeout: 3000 });
      await sleep(120);
      await shot(p, "pulse", "success", ui(p, ".pulse"), { pad: 20 });
    }
    await close(p);
  }
}

async function reducedMotion(theme) {
  const p = await open({ theme, reduced: true });
  await openBar(p);
  await pick(p, "#card");
  await submit(p, "make it airier");
  await stream(p, 12, 30);
  await sleep(300);
  // Settings → Effects defaults to Subtle under reduced motion: a still outline instead of the radar field
  const fx = (await ui(p, ".fx").isVisible()) ? ui(p, ".fx") : ui(p, ".sel");
  const a = await fx.screenshot(); await sleep(450);
  const b = await fx.screenshot();
  const mark1 = await ui(p, ".row .mark").screenshot(); await sleep(450);
  const mark2 = await ui(p, ".row .mark").screenshot();
  await shot(p, "motion", "reduced-effect", fx, { pad: 16, note: "Effects default to Subtle here: a still outline on the target, no field", checks: [a.equals(b) ? "" : "effect still animates under prefers-reduced-motion"] });
  await shot(p, "motion", "reduced-mark-live", ui(p, ".row .mark"), { pad: 8, checks: [mark1.equals(mark2) ? "" : "radar mark still pulses under prefers-reduced-motion"] });
  await p.evaluate(r => __cat.done(r), OK());
  await sleep(300);
  await shot(p, "motion", "reduced-landing", ui(p, ".bar"), { note: "no sweep: the field fades out, the bar shows the result" });
  await close(p);
}

async function toastStates(theme, width) {
  const n = width < 600;
  let p = await open({ theme, width, height: n ? 844 : 720 });
  await openBar(p); await pick(p, "#card");
  await submit(p, "make it airier");
  await finish(p, OK());
  await ui(p, "[data-a=undo]").click();
  await ui(p, ".toast").waitFor({ state: "visible" }); await sleep(300);
  await shot(p, "toast", "short", ui(p, ".toast"), { pad: 16 });
  await openBar(p); await pick(p, "#card");
  await submit(p, LONG_PROMPT);
  await finish(p, OK({ title: LONG_TITLE }));
  await ui(p, "[data-a=keep]").click();
  await sleep(350);
  await shot(p, "toast", "long", ui(p, ".toast"), { pad: 16 });
  await close(p);
}

async function panelStates(theme, width) {
  const n = width < 600;
  for (const mods of [0, 1, 12]) {
    const p = await open({ theme, width, height: n ? 844 : 720, mods });
    await p.keyboard.press("Alt+Shift+KeyM");
    await ui(p, ".panel").waitFor({ state: "visible" }); await sleep(300);
    await shot(p, "panel", `mods-${mods}`, ui(p, ".panel"));
    if (mods === 12) {
      // an unbroken 80-character title and prompt, on a disabled mod
      const long = ui(p, "article[data-id=mod6]");
      await long.scrollIntoViewIfNeeded(); await sleep(100);
      await shot(p, "panel", "row-unbroken-title", long, { pad: 8 });
      await ui(p, ".list").evaluate(el => (el.scrollTop = el.scrollHeight)); await sleep(100);
      await shot(p, "panel", "mods-12-scrolled", ui(p, ".panel"));
    }
    if (mods === 1 && !n) {
      const art = ui(p, ".list article");
      await art.hover(); await sleep(150);
      await shot(p, "panel", "row-hover", art, { pad: 8 });
      await ui(p, ".btns [data-a=code]").hover(); await sleep(150);
      await shot(p, "panel", "row-button-hover", art, { pad: 8 });
      await shot(p, "panel", "row-button-focus", art, { pad: 8, checks: [await focusVisible(p, ui(p, ".btns [data-a=code]"))] });
      await ui(p, "header [data-a=close]").hover(); await sleep(150);
      await shot(p, "panel", "close-hover", ui(p, ".panel header"), { pad: 4 });
      await shot(p, "panel", "close-focus", ui(p, ".panel header"), { pad: 4, checks: [await focusVisible(p, ui(p, "header [data-a=close]"))] });
      await ui(p, "footer [data-a=import]").hover(); await sleep(150);
      await shot(p, "panel", "import-hover", ui(p, ".panel footer"), { pad: 4 });
      // the switch
      const sw = ui(p, ".sw");
      await p.mouse.move(0, 0); await sleep(150);
      await shot(p, "switch", "on", sw, { pad: 6 });
      await sw.hover(); await sleep(150);
      await shot(p, "switch", "on-hover", sw, { pad: 6 });
      await shot(p, "switch", "on-focus", sw, { pad: 6, checks: [await focusVisible(p, ui(p, ".sw input"))] });
      await sw.click(); await sleep(300); await p.mouse.move(0, 0); await sleep(150);
      await shot(p, "switch", "off", ui(p, ".sw"), { pad: 6 });
      await shot(p, "panel", "row-off", ui(p, ".list article"), { pad: 8 });
      await shot(p, "switch", "off-focus", ui(p, ".sw"), { pad: 6, checks: [await focusVisible(p, ui(p, ".sw input"))] });
    }
    await close(p);
  }
}

async function modalStates(theme, width) {
  const n = width < 600;
  // code modal from a fresh result, then share (with a real before/after card)
  let p = await open({ theme, width, height: n ? 844 : 720 });
  await openBar(p); await pick(p, "#toolbar");
  await submit(p, "make the toolbar airier");
  await stream(p, 40, 5);
  await finish(p, OK({ css: "#toolbar { gap: 20px; letter-spacing: .02em; padding: 12px 20px; }\n#toolbar button { opacity: .9; }", js: "morse.watch('#toolbar', t => t.append(morse.el('span', { text: 'hello' })));" }));
  await ui(p, "[data-a=code]").click();
  await ui(p, ".card").waitFor({ state: "visible" }); await sleep(300);
  await shot(p, "modal", "code", ui(p, ".card"));
  if (!n) {
    await ui(p, ".card textarea").first().focus();
    await shot(p, "modal", "code-textarea-focus", ui(p, ".card textarea"), { pad: 8 });
    await ui(p, ".card footer [data-a=save]").hover(); await sleep(150);
    await shot(p, "modal", "code-footer-hover", ui(p, ".card footer"), { pad: 8 });
    await shot(p, "modal", "code-footer-focus", ui(p, ".card footer"), { pad: 8, checks: [await focusVisible(p, ui(p, ".card footer [data-a=close]"))] });
    await ui(p, ".card header [data-a=close]").hover(); await sleep(150);
    await shot(p, "modal", "close-hover", ui(p, ".card header"), { pad: 8 });
    await shot(p, "modal", "close-focus", ui(p, ".card header"), { pad: 8, checks: [await focusVisible(p, ui(p, ".card header [data-a=close]"))] });
  }
  await p.keyboard.press("Escape"); await sleep(100);
  await ui(p, "[data-a=share]").click();
  await ui(p, ".card .cardimg").waitFor({ state: "visible", timeout: 8000 }); await sleep(400);
  await shot(p, "modal", "share", ui(p, ".card"));
  if (!n) {
    await ui(p, ".exports [data-a=json]").click(); await sleep(150);
    await ui(p, "[data-a=copy]").hover(); await sleep(150);
    await shot(p, "modal", "share-actions-hover", [ui(p, ".link"), ui(p, ".saved")], { pad: 8 });
    await shot(p, "modal", "share-export-focus", [ui(p, ".exports")], { pad: 8, checks: [await focusVisible(p, ui(p, ".exports [data-a=user]"))] });
  }
  await close(p);

  // code modal with long content, from the panel
  p = await open({ theme, width, height: n ? 844 : 720, mods: 12 });
  await p.evaluate(() => { const m = __cat.mods[1]; m.css = Array.from({ length: 30 }, (_, i) => `.player-bar .controls > button:nth-child(${i + 1}) { transition: opacity 120ms ease, transform 120ms ease; transform: translateY(0); } /* a long line that should scroll, not wrap the layout */`).join("\n"); });
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(300);
  await ui(p, "article[data-id=mod2] [data-a=code]").click();
  await ui(p, ".card").waitFor({ state: "visible" }); await sleep(300);
  await shot(p, "modal", "code-long", ui(p, ".card"));
  await p.keyboard.press("Escape"); await sleep(100);
  await ui(p, "footer [data-a=import]").click();
  await ui(p, ".card").waitFor({ state: "visible" }); await sleep(300);
  await shot(p, "modal", "import-empty", ui(p, ".card"));
  await ui(p, ".card textarea").fill("https://morse.sh/install#m=eyJ0aXRsZSI6IkFpcmllciB0b29sYmFyIiwicHJvbXB0IjoibWFrZSB0aGUgdG9vbGJhciBhaXJpZXIifQ");
  await shot(p, "modal", "import-filled", ui(p, ".card"));
  await p.evaluate(() => (__cat.importFail = "That doesn't look like a Morse mod: expected a share link or .morse.json"));
  await ui(p, ".card [data-a=go]").click(); await sleep(350);
  await shot(p, "modal", "import-error", [ui(p, ".card"), ui(p, ".toast")]);
  await close(p);
}

// ---------------------------------------------------------------- God mode
const EYEDROPPER = () => { globalThis.EyeDropper = class { open() { return new Promise(() => {}); } }; };
const TOOLS = ["hide", "move", "resize", "text", "color", "type", "dup", "capture", "ask", "undo", "redo"];
const tb = p => ui(p, ".gm-tb");
async function select(p, sel, fx = 0.5, fy = 0.5) {
  const b = await p.locator(sel).first().boundingBox();
  const x = b.x + Math.min(b.width * fx, b.width - 2), y = b.y + b.height * fy;
  await p.mouse.move(x - 8, y - 4); await p.mouse.move(x, y, { steps: 2 }); await sleep(120);
  await p.mouse.click(x, y); await sleep(200);
  await tb(p).waitFor({ state: "visible" }); await sleep(150);
}
async function editFocus(p) { await p.keyboard.press("Control+KeyE"); await sleep(80); }
// a mouse that rests on the selection, so the picker draws nothing else
const restOn = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); await p.mouse.move(b.x + 10, b.y + 10); await sleep(120); };

async function godStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H, init: EYEDROPPER });
  await openBar(p);
  await select(p, "#card", 0.3, 0.6);
  await shot(p, "edit-toolbar", "selected", [tb(p), ui(p, ".gm-frame")], { pad: 12 });
  await shot(p, "edit-toolbar", "bar-hint", ui(p, ".bar"), { note: "after pointing, typing goes to the bar; Ctrl+E (⌘E) moves focus to the toolbar" });
  if (!n) {
    for (const t of TOOLS) {
      const b = ui(p, `.gm-tb button[data-t=${t}]`);
      await b.hover(); await sleep(520);
      const disabled = await b.isDisabled();
      await shot(p, "edit-toolbar", `tool-${t}-${disabled ? "disabled" : "hover"}`, [tb(p), ui(p, `.gm-tb button[data-t=${t}] .tip`)], { pad: 8 });
      if (!disabled) await shot(p, "edit-toolbar", `tool-${t}-focus`, [tb(p), ui(p, `.gm-tb button[data-t=${t}] .tip`)], { pad: 8, checks: [await focusVisible(p, b)] });
    }
    await restOn(p, "#card");
    await ui(p, ".in").focus();
    await editFocus(p);
    await shot(p, "edit-toolbar", "ctrl-e", tb(p), { pad: 8, note: "the toolbar holds focus: its border lights; H M R T C F D A act on the selection" });
  } else { await editFocus(p); }
  // move: the tool, then a drag with the readout
  await p.keyboard.press("m"); await sleep(150);
  await shot(p, "edit-toolbar", "move-active", [tb(p), ui(p, ".gm-frame")], { pad: 12 });
  const fr = await ui(p, ".gm-frame").boundingBox();
  await p.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2); await p.mouse.down();
  await p.mouse.move(fr.x + fr.width / 2 + 40, fr.y + fr.height / 2 + 12, { steps: 6 }); await sleep(150);
  await shot(p, "edit-frame", "move-dragging", [ui(p, ".gm-frame"), ui(p, ".gm-read")], { pad: 12 });
  await p.mouse.up(); await sleep(150);
  await p.keyboard.press("Escape"); await sleep(100);
  // resize: eight handles, then a drag with the size readout
  await editFocus(p);
  await p.keyboard.press("r"); await sleep(150);
  await shot(p, "edit-frame", "resize-handles", ui(p, ".gm-frame"), { pad: 16 });
  const se = await ui(p, ".gm-frame i[data-h=se]").boundingBox();
  await p.mouse.move(se.x + se.width / 2, se.y + se.height / 2); await p.mouse.down();
  await p.mouse.move(se.x + 34, se.y + 24, { steps: 6 }); await sleep(150);
  await shot(p, "edit-frame", "resize-dragging", [ui(p, ".gm-frame"), ui(p, ".gm-read")], { pad: 16 });
  await p.mouse.up(); await sleep(150);
  await p.keyboard.press("Escape"); await sleep(100);
  if (!n) {
    const u = ui(p, ".gm-tb button[data-t=undo]");
    await u.hover(); await sleep(520);
    await shot(p, "edit-toolbar", "tool-undo-hover", [tb(p), ui(p, ".gm-tb button[data-t=undo] .tip")], { pad: 8 });
    await shot(p, "edit-toolbar", "tool-undo-focus", [tb(p), ui(p, ".gm-tb button[data-t=undo] .tip")], { pad: 8, checks: [await focusVisible(p, u)] });
    await restOn(p, "#card");
  }
  // text: edit in place
  await editFocus(p);
  await p.keyboard.press("t"); await sleep(200);
  await shot(p, "edit-frame", "text-editing", [ui(p, ".gm-frame"), tb(p)], { pad: 12 });
  await p.keyboard.type("Release notes, v2", { delay: 10 }); await sleep(100);
  await shot(p, "edit-frame", "text-typed", [ui(p, ".gm-frame")], { pad: 12 });
  await shot(p, "edit-frame", "text-hint", ui(p, ".status"), { pad: 4 });
  await p.keyboard.press("Escape"); await sleep(150);
  // color
  await editFocus(p);
  await p.keyboard.press("c"); await sleep(200);
  const pop = ui(p, ".gm-pop");
  await shot(p, "edit-color", "text-tab", [pop, tb(p)], { pad: 12 });
  await ui(p, ".gm-pop [data-ch=background]").click(); await sleep(100);
  await shot(p, "edit-color", "fill-tab", pop, { pad: 12 });
  await ui(p, ".gm-pop [data-ch=border]").click(); await sleep(100);
  await shot(p, "edit-color", "border-tab", pop, { pad: 12 });
  if (!n) {
    await shot(p, "edit-color", "tab-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop [data-ch=color]"))] });
    await ui(p, ".gm-pop [data-c='#3b82f6']").hover(); await sleep(150);
    await shot(p, "edit-color", "swatch-hover", pop, { pad: 12 });
    await shot(p, "edit-color", "swatch-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop [data-c='#3b82f6']"))] });
  }
  await ui(p, ".gm-pop [data-ch=background]").click(); await sleep(100);
  await ui(p, ".gm-pop [data-c='#3b82f6']").click(); await sleep(150);
  await p.mouse.move(2, 2); await sleep(100);
  await shot(p, "edit-color", "swatch-picked", [pop, ui(p, ".gm-frame")], { pad: 12 });
  await ui(p, ".gm-pop .gm-hex input").click(); await sleep(60);
  await shot(p, "edit-color", "hex-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop .gm-hex input"))] });
  await ui(p, ".gm-pop .gm-hex input").fill("#12zz"); await sleep(80);
  await ui(p, ".gm-pop .gm-hex input").press("Enter"); await sleep(80);
  await shot(p, "edit-color", "hex-invalid", pop, { pad: 12 });
  if (!n) {
    await ui(p, ".gm-pop [data-a=pick]").hover(); await sleep(150);
    await shot(p, "edit-color", "eyedropper-hover", pop, { pad: 12 });
    await shot(p, "edit-color", "eyedropper-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop [data-a=pick]"))] });
  }
  await p.keyboard.press("Escape"); await sleep(100);
  // type
  await editFocus(p);
  await p.keyboard.press("f"); await sleep(200);
  await shot(p, "edit-type", "default", [pop, tb(p)], { pad: 12 });
  await ui(p, ".gm-pop [data-d='1']").click(); await sleep(60);
  await ui(p, ".gm-pop [data-d='1']").click(); await sleep(60);
  await ui(p, ".gm-pop [data-w='700']").click(); await sleep(100);
  await shot(p, "edit-type", "bigger-bold", pop, { pad: 12 });
  if (!n) {
    await ui(p, ".gm-pop [data-d='1']").hover(); await sleep(150);
    await shot(p, "edit-type", "step-hover", pop, { pad: 12 });
    await shot(p, "edit-type", "step-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop [data-d='1']"))] });
    await shot(p, "edit-type", "size-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop .gm-step input"))] });
    await shot(p, "edit-type", "range-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop .gm-range"))] });
    await ui(p, ".gm-pop [data-w='300']").hover(); await sleep(150);
    await shot(p, "edit-type", "weight-hover", pop, { pad: 12 });
    await shot(p, "edit-type", "weight-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop [data-w='300']"))] });
  }
  await p.keyboard.press("Escape"); await sleep(100);
  // capture
  await editFocus(p);
  await p.keyboard.press("Shift+KeyC"); await sleep(900);
  await shot(p, "capture", "popover", [pop, tb(p)], { pad: 12 });
  await p.keyboard.type("airy card, soft corners", { delay: 5 }); await sleep(80);
  await shot(p, "capture", "with-note", pop, { pad: 12 });
  if (!n) {
    await ui(p, ".gm-pop [data-a=save]").hover(); await sleep(150);
    await shot(p, "capture", "save-hover", pop, { pad: 12 });
    await shot(p, "capture", "save-focus", pop, { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-pop [data-a=save]"))] });
  }
  await ui(p, ".gm-pop .gm-cap-note").press("Enter"); await sleep(400);
  await shot(p, "capture", "captured-toast", ui(p, ".toast"), { pad: 16 });
  // hide, with the toast that says how to undo
  await select(p, "#toolbar", 0.5, 0.15);
  await editFocus(p);
  await p.keyboard.press("h"); await sleep(350);
  await shot(p, "edit-toolbar", "hidden-toast", ui(p, ".toast"), { pad: 16 });
  await close(p);

  // a selection flush with the top edge: toolbar and tooltips open below
  p = await open({ theme, width, height: H });
  await openBar(p);
  await select(p, "#topEdge", 0.3, 0.5);
  if (!n) {
    await ui(p, ".gm-tb button[data-t=move]").hover(); await sleep(520);
    await shot(p, "edit-toolbar", "below-top-edge", [tb(p), ui(p, ".gm-frame"), ui(p, ".gm-tb button[data-t=move] .tip")], { pad: 8 });
  } else await shot(p, "edit-toolbar", "below-top-edge", [tb(p), ui(p, ".gm-frame")], { pad: 8 });
  // SVG: Fill/Stroke, and a field over SVG text
  await p.evaluate(() => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.id = "logo"; s.setAttribute("width", "200"); s.setAttribute("height", "56");
    s.innerHTML = `<rect width="200" height="56" rx="10" fill="#3b82f6"/><text x="16" y="36" fill="#fff" font-size="20" font-family="system-ui">Morse Radio</text>`;
    document.querySelector("main").prepend(s);
  });
  await sleep(200);
  await select(p, "#logo rect", 0.9, 0.2);
  await editFocus(p);
  await p.keyboard.press("c"); await sleep(200);
  await shot(p, "edit-color", "svg-fill-stroke", [pop, tb(p)], { pad: 12 });
  await p.keyboard.press("Escape"); await sleep(100);
  await select(p, "#logo text", 0.3, 0.5);
  await editFocus(p);
  await p.keyboard.press("t"); await sleep(200);
  await shot(p, "edit-frame", "svg-text-field", [ui(p, ".gm-svgtext"), ui(p, ".gm-frame")], { pad: 12 });
  await p.keyboard.press("Escape"); await sleep(100);
  // an embedded frame: the note, and the tools that can't reach inside
  await p.evaluate(() => {
    const f = document.createElement("iframe");
    f.id = "embed"; f.srcdoc = "<body style='margin:0;font:14px system-ui;background:#2a2a2e;color:#ddd;display:grid;place-items:center;height:100vh'><button>Embedded player</button></body>";
    f.style.cssText = "width:280px;height:120px;border:0;border-radius:10px;display:block";
    document.querySelector("main").prepend(f);
  });
  await sleep(300);
  const eb = await p.locator("#embed").boundingBox();
  await p.mouse.move(eb.x + eb.width - 12, eb.y + eb.height - 12, { steps: 2 }); await sleep(150);
  await p.mouse.click(eb.x + eb.width - 12, eb.y + eb.height - 12); await sleep(400);
  await tb(p).waitFor({ state: "visible" }).catch(() => {});
  await shot(p, "edit-frame", "embedded-note", [tb(p), ui(p, ".gm-note"), ui(p, ".gm-frame")], { pad: 12 });
  if (!n) {
    await ui(p, ".gm-tb button[data-t=text]").hover({ force: true }); await sleep(520);
    await shot(p, "edit-toolbar", "tool-text-disabled", tb(p), { pad: 8, note: "frames: tools that reach inside are disabled; no tooltip, not focusable" });
  }
  await close(p);

  // page tools: the bar button and its menu
  p = await open({ theme, width, height: H });
  await openBar(p);
  const q = ui(p, ".gm-qbtn");
  await q.hover(); await sleep(520);
  await shot(p, "page-tools", "button-hover", [q, ui(p, ".gm-qbtn .tip")], { pad: 8 });
  await shot(p, "page-tools", "button-focus", [q, ui(p, ".gm-qbtn .tip")], { pad: 8, checks: [await focusVisible(p, q)] });
  await q.click(); await sleep(250);
  await shot(p, "page-tools", "menu", [ui(p, ".gm-menu"), q], { pad: 12 });
  await ui(p, ".gm-menu [data-k=bigger]").hover(); await sleep(150);
  await shot(p, "page-tools", "item-hover", ui(p, ".gm-menu"), { pad: 12 });
  await ui(p, ".gm-menu [data-k=bigger]").click(); await sleep(400);
  await q.click(); await sleep(250);
  await ui(p, ".gm-menu [data-k=noads]").click(); await sleep(400);
  await q.click(); await sleep(250);
  await p.keyboard.press("ArrowDown"); await sleep(80);
  await shot(p, "page-tools", "menu-with-state", [ui(p, ".gm-menu"), q], { pad: 12, note: "Bigger text shows its level, Hide ads its check; keyboard focus is the row highlight" });
  await p.keyboard.press("Escape"); await sleep(100);
  await close(p);

  // the Morse clipboard: chips in the bar, picked, then "Rebuilt from" while working
  p = await open({ theme, width, height: H, extra: "&clips=1" });
  await openBar(p);
  await ui(p, ".gm-clips").waitFor({ state: "visible" }); await sleep(150);
  await shot(p, "clipboard", "chips", ui(p, ".bar"));
  if (!n) {
    await ui(p, ".gm-chip[data-id=c2]").hover(); await sleep(150);
    await shot(p, "clipboard", "chip-hover", ui(p, ".gm-clips"), { pad: 8 });
    await shot(p, "clipboard", "chip-focus", ui(p, ".gm-clips"), { pad: 8, checks: [await focusVisible(p, ui(p, ".gm-chip[data-id=c2]"))] });
  }
  await ui(p, ".gm-chip[data-id=c1]").click(); await sleep(150);
  await shot(p, "clipboard", "picked", ui(p, ".bar"));
  await submit(p, "make the header look like it");
  await shot(p, "clipboard", "rebuilt-from", ui(p, ".bar"));
  await close(p);
}

// ---------------------------------------------------------------- voice
const statusOf = p => p.evaluate(() => JSON.parse(document.querySelector(":root > [data-morse-ui]").dataset.status || "{}"));
async function voiceStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H });
  await openBar(p);
  await pick(p, "#card"); // with a target the bar stops dodging the pointer
  const mic = ui(p, ".mic");
  await shot(p, "voice", "mic-idle", ui(p, ".row"), { pad: 4 });
  if (!n) {
    await mic.hover(); await sleep(150);
    await shot(p, "voice", "mic-hover", mic, { pad: 8 });
    await shot(p, "voice", "mic-focus", mic, { pad: 8, checks: [await focusVisible(p, mic)] });
  }
  await mic.click();
  await p.waitForFunction(() => JSON.parse(document.querySelector(":root > [data-morse-ui]").dataset.status || "{}").voice === "listening");
  await p.waitForFunction(() => JSON.parse(document.querySelector(":root > [data-morse-ui]").dataset.status || "{}").level > 0.3, null, { timeout: 5000 }).catch(() => {});
  await shot(p, "voice", "listening", ui(p, ".bar"));
  if (!n) await shot(p, "voice", "level-meter", mic, { pad: 8 });
  await close(p);
  // live words: Web Speech hears an interim phrase
  p = await open({ theme, width, height: H, init: () => {
    globalThis.SpeechRecognition = globalThis.webkitSpeechRecognition = class extends EventTarget {
      start() { setTimeout(() => this.onresult?.({ results: [Object.assign([{ transcript: "make the toolbar a little" }], { isFinal: false })] }), 300); }
      stop() {} abort() {}
    };
  } });
  await openBar(p);
  await pick(p, "#card");
  await ui(p, ".mic").click();
  await p.waitForFunction(() => /make the/.test(document.querySelector(":root > [data-morse-ui]").shadowRoot.querySelector(".in").value), null, { timeout: 6000 }).catch(() => {});
  await sleep(150);
  await shot(p, "voice", "partial-transcript", ui(p, ".bar"), { note: "interim words in --m-text-2 until the final transcript" });
  await close(p);
  p = await open({ theme, width, height: H });
  await openBar(p);
  await pick(p, "#card");
  await ui(p, ".mic").click();
  await p.waitForFunction(() => JSON.parse(document.querySelector(":root > [data-morse-ui]").dataset.status || "{}").voice === "listening");
  await sleep(2600);
  await p.evaluate(() => (__cat.holdTranscribe = true));
  await ui(p, ".mic").click(); await sleep(250);
  await shot(p, "voice", "transcribing", ui(p, ".bar"));
  await p.evaluate(() => __cat.release?.()); await sleep(300);
  await shot(p, "voice", "transcribed", ui(p, ".bar"));
  await close(p);

  // every line voice can leave in the status row
  const ERR = {
    "insecure-page": [() => Object.defineProperty(globalThis, "isSecureContext", { get: () => false })],
    "policy-blocked": [() => Object.defineProperty(Document.prototype, "permissionsPolicy", { get: () => ({ allowsFeature: () => false }) })],
    "no-microphone-api": [() => { globalThis.SpeechRecognition = globalThis.webkitSpeechRecognition = undefined; Object.defineProperty(Navigator.prototype, "mediaDevices", { get: () => undefined }); }, "&voice=0"],
    "not-set-up": [() => { globalThis.SpeechRecognition = globalThis.webkitSpeechRecognition = undefined; }, "&voice=0"],
    "mic-blocked": [() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })); }],
    "no-mic": [() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("x"), { name: "NotFoundError" })); }],
    "mic-busy": [() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("x"), { name: "NotReadableError" })); }],
    "mic-other": [() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("x"), { name: "TypeError" })); }],
    "speech-unavailable": [() => {}, "&voice=none"],
    "transcription-failed": [() => {}, "", "OpenAI transcription failed: 401 Incorrect API key provided: sk-proj-…a1b2. You can find your API key at platform.openai.com"],
    "didnt-catch": [() => {}, "", ""],
  };
  for (const [state, [init, extra = "", fail]] of Object.entries(ERR)) {
    if (n && !["mic-blocked", "transcription-failed", "not-set-up"].includes(state)) continue;
    p = await open({ theme, width, height: H, init, extra });
    await openBar(p);
    await pick(p, "#card");
    if (fail !== undefined) await p.evaluate(f => { if (f) __cat.transcribeFail = f; else __cat.transcript = ""; }, fail);
    await ui(p, ".mic").click();
    if (fail !== undefined) {
      await p.waitForFunction(() => JSON.parse(document.querySelector(":root > [data-morse-ui]").dataset.status || "{}").voice === "listening", null, { timeout: 4000 }).catch(() => {});
      await sleep(2600); // the recorder needs a chunk of audio
      await ui(p, ".mic").click();
    }
    await p.waitForFunction(() => document.querySelector(":root > [data-morse-ui]").shadowRoot.querySelector(".hint .note"), null, { timeout: 6000 }).catch(() => {});
    await sleep(450);
    await shot(p, "voice", `error-${state}`, ui(p, ".bar"), { checks: [await p.evaluate(() => document.querySelector(":root > [data-morse-ui]").shadowRoot.querySelector(".hint .note") ? "" : "no error line")] });
    if (!n && state === "not-set-up") await shot(p, "voice", "mic-unavailable", ui(p, ".mic"), { pad: 8, note: "no voice here: the mic is dimmed (--m-text-3) and its title says why" });
    await close(p);
  }
}

// ---------------------------------------------------------------- bar sheets
async function sheetStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H });
  await openBar(p);
  await pick(p, "#card"); // with a target the bar stops dodging the pointer
  // the overflow menu
  const more = ui(p, ".more");
  if (!n) {
    await more.hover(); await sleep(150);
    await shot(p, "menu", "more-hover", more, { pad: 8 });
    await shot(p, "menu", "more-focus", more, { pad: 8, checks: [await focusVisible(p, more)] });
  }
  await more.click(); await sleep(200);
  await shot(p, "menu", "open", [ui(p, ".bmenu"), more], { pad: 12, note: "the first item takes focus (row highlight); ↑/↓ move" });
  if (!n) {
    await p.keyboard.press("ArrowDown"); await sleep(80);
    await shot(p, "menu", "item-focus", ui(p, ".bmenu"), { pad: 12 });
    await ui(p, ".bmenu [data-m=mods]").hover(); await sleep(150);
    await shot(p, "menu", "item-hover", ui(p, ".bmenu"), { pad: 12 });
  }
  await p.keyboard.press("Escape"); await sleep(100);

  // settings
  await ui(p, ".in").focus();
  await p.keyboard.press("Control+Comma"); await sleep(300);
  await p.mouse.move(2, 2);
  await shot(p, "settings", "sheet", ui(p, ".bar"));
  const pane = ui(p, ".pane");
  await pane.evaluate(el => (el.scrollTop = el.scrollHeight)); await sleep(100);
  await shot(p, "settings", "sheet-bottom", ui(p, ".bar"));
  await pane.evaluate(el => (el.scrollTop = 0)); await sleep(100);
  if (!n) {
    const hk = ui(p, ".hk[data-hk=open]");
    await shot(p, "hotkeys", "idle", ui(p, ".hkrow[data-id=open]"), { pad: 8 });
    await hk.hover(); await sleep(150);
    await shot(p, "hotkeys", "button-hover", ui(p, ".hkrow[data-id=open]"), { pad: 8 });
    await shot(p, "hotkeys", "button-focus", ui(p, ".hkrow[data-id=open]"), { pad: 8, checks: [await focusVisible(p, hk)] });
    await ui(p, ".sheet header [data-act=done]").hover(); await sleep(150);
    await shot(p, "settings", "done-hover", ui(p, ".sheet header"), { pad: 8 });
    await shot(p, "settings", "done-focus", ui(p, ".sheet header"), { pad: 8, checks: [await focusVisible(p, ui(p, ".sheet header [data-act=done]"))] });
    const seg = ui(p, ".seg[data-k=barPosition]");
    await seg.scrollIntoViewIfNeeded();
    await ui(p, ".seg[data-k=barPosition] [data-v=top]").hover(); await sleep(150);
    await shot(p, "settings", "segment-hover", seg, { pad: 8 });
    await shot(p, "settings", "segment-focus", seg, { pad: 8, checks: [await focusVisible(p, ui(p, ".seg[data-k=barPosition] [aria-checked=true]"))] });
    const sw = ui(p, ".pane .sw");
    await sw.scrollIntoViewIfNeeded();
    await shot(p, "settings", "switch-focus", ui(p, ".pane .srow:has(.sw)"), { pad: 4, checks: [await focusVisible(p, ui(p, ".pane .sw input"))] });
    await shot(p, "settings", "voice-ready", ui(p, ".pane .srow:has(.pill)"), { pad: 4 });
    await ui(p, ".seg[data-k=effects] [data-v=subtle]").click(); await sleep(200);
    await shot(p, "settings", "saved-flash", ui(p, ".sheet header"), { pad: 8, note: "every change saves at once; “Saved” fades" });
    await pane.evaluate(el => (el.scrollTop = el.scrollHeight)); await sleep(100);
    await ui(p, "[data-act=reset-all]").hover(); await sleep(150);
    await shot(p, "settings", "footer-hover", ui(p, ".sheet footer"), { pad: 8 });
    await pane.evaluate(el => (el.scrollTop = 0)); await sleep(100);
  }
  // hotkey recorder: recording, held modifiers, rejected, warning (then a custom key with Reset)
  await ui(p, ".hk[data-hk=mods]").scrollIntoViewIfNeeded();
  await ui(p, ".hk[data-hk=mods]").click(); await sleep(200);
  await shot(p, "hotkeys", "recording", ui(p, ".hkrow[data-id=mods]"), { pad: 8 });
  await p.keyboard.down("Control"); await p.keyboard.down("Shift"); await sleep(200);
  await shot(p, "hotkeys", "recording-held", ui(p, ".hkrow[data-id=mods]"), { pad: 8 });
  await p.keyboard.up("Shift"); await p.keyboard.up("Control"); await sleep(100);
  await p.keyboard.press("KeyK"); await sleep(120);
  await shot(p, "hotkeys", "rejected", ui(p, ".hkrow[data-id=mods]"), { pad: 8 });
  await sleep(300);
  await p.keyboard.press("Control+KeyS"); await sleep(250);
  await shot(p, "hotkeys", "warning", ui(p, ".hkrow[data-id=mods]"), { pad: 8, note: "accepted with a warning: Reset appears for a custom key" });
  await p.keyboard.press("Escape"); await sleep(100);
  await close(p);

  // voice off in settings
  p = await open({ theme, width, height: H, extra: "&voice=0", init: () => { globalThis.SpeechRecognition = globalThis.webkitSpeechRecognition = undefined; } });
  await openBar(p);
  await p.keyboard.press("Control+Comma"); await sleep(300);
  await shot(p, "settings", "voice-off", ui(p, ".pane .srow:has(.pill)"), { pad: 4 });
  await close(p);

  // the cheat sheet
  p = await open({ theme, width, height: H });
  await openBar(p);
  await p.keyboard.type("?"); await sleep(250);
  await p.mouse.move(2, 2);
  await shot(p, "shortcuts", "sheet", ui(p, ".bar"));
  if (!n) {
    await ui(p, ".krow").first().hover(); await sleep(150);
    await shot(p, "shortcuts", "row-hover", ui(p, ".kbsheet section").first(), { pad: 8 });
    await ui(p, ".kbsheet [data-act=settings]").hover(); await sleep(150);
    await shot(p, "shortcuts", "change-hover", ui(p, ".kbsheet header"), { pad: 8 });
    await shot(p, "shortcuts", "change-focus", ui(p, ".kbsheet header"), { pad: 8, checks: [await focusVisible(p, ui(p, ".kbsheet [data-act=settings]"))] });
  }
  await close(p);
}

// ---------------------------------------------------------------- suggestions, history, stop
async function flowStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H, extra: "&hist=1" });
  await openBar(p);
  await shot(p, "suggestions", "page", ui(p, ".bar"));
  await pick(p, "#toolbar");
  await sleep(100);
  await shot(p, "suggestions", "media", ui(p, ".bar"));
  await p.keyboard.press("Tab"); await sleep(80);
  await shot(p, "suggestions", "chip-focus", ui(p, ".sugs"), { pad: 8, checks: [await ui(p, ".sug").first().evaluate(el => el.matches(":focus-visible") ? "" : "focused chip shows no :focus-visible")] });
  await p.keyboard.press("ArrowRight"); await sleep(80);
  await shot(p, "suggestions", "chip-focus-next", ui(p, ".sugs"), { pad: 8 });
  if (!n) {
    await ui(p, ".sug").last().hover(); await sleep(150);
    await shot(p, "suggestions", "chip-hover", ui(p, ".sugs"), { pad: 8 });
  }
  await ui(p, ".chip .x").click(); await sleep(100);
  await pick(p, "#long");
  await shot(p, "suggestions", "button-rename", ui(p, ".sugs"), { pad: 8, note: "Rename… fills the input and leaves the caret between the quotes" });
  await close(p);

  // history: ↑ in an empty input walks earlier prompts
  p = await open({ theme, width, height: H, extra: "&hist=1" });
  await openBar(p);
  await ui(p, ".in").press("ArrowUp"); await sleep(100);
  await shot(p, "history", "previous", ui(p, ".bar"));
  await ui(p, ".in").press("ArrowUp"); await sleep(100);
  await ui(p, ".in").press("ArrowUp"); await sleep(100);
  await shot(p, "history", "oldest", ui(p, ".bar"));
  await close(p);

  // Stop: Run turns into Stop while the model works; Esc or Ctrl+. cancels
  p = await open({ theme, width, height: H });
  await openBar(p); await pick(p, "#card");
  await submit(p, "make the card airier and add a sleep timer");
  await stream(p, 10, 25);
  await shot(p, "stop", "working", ui(p, ".bar"), { note: "focus moves to Stop, so Enter/Space stop too" });
  if (!n) {
    await shot(p, "stop", "button-focus", ui(p, ".go"), { pad: 8, checks: [await focusVisible(p, ui(p, ".go"))] });
    await ui(p, ".go").hover(); await sleep(150);
    await shot(p, "stop", "button-hover", ui(p, ".go"), { pad: 8 });
  }
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => /Stopped/.test(JSON.parse(document.querySelector(":root > [data-morse-ui]").dataset.status || "{}").hint), null, { timeout: 6000 }).catch(() => {});
  await sleep(200);
  await shot(p, "stop", "cancelled", ui(p, ".bar"), { note: "partial CSS removed, prompt kept; any edit clears the note" });
  await close(p);
}

async function hostileStates() {
  const SITES = [["parley", "/demo/sites/parley/", "textarea, [contenteditable], form"], ["byte", "/demo/sites/byte/", ".tb"], ["tunes", "/demo/sites/tunes/", "[data-testid=player-controls]"], ["hostile", "/demo/sites/hostile/", "#tb"], ["hostile-noise", "/demo/sites/hostile/", "#tb"]];
  for (const [site, url, sel] of SITES) {
    const p = await open({ url, mods: 1, width: 1100, height: 720 });
    try {
      if (site === "hostile-noise") {
        // custom properties are the one thing that does cross a shadow boundary
        await p.addStyleTag({ content: "div { --m-text: #f0f !important; --m-surface: #0f0; --m-overlay: #0f0; --m-font: serif; } [data-morse-ui] { --m-bg: #f00 !important }" });
      }
      await openBar(p);
      const target = p.locator(sel).first();
      await hover(p, sel);
      await shot(p, "hostile", `${site}-hover`, [ui(p, ".hl"), ui(p, ".hl span")], { pad: 16, checks: [await alignCheck(p, target)] });
      await pick(p, sel);
      // round 2: God mode, page tools and the settings sheet on the same page
      await ui(p, ".gm-tb").waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
      await shot(p, "hostile", `${site}-toolbar`, [ui(p, ".gm-tb"), ui(p, ".gm-frame")], { pad: 12 });
      await p.keyboard.press("Control+KeyE"); await sleep(80);
      await p.keyboard.press("c"); await sleep(250);
      await shot(p, "hostile", `${site}-color`, [ui(p, ".gm-pop"), ui(p, ".gm-tb")], { pad: 12 });
      await p.keyboard.press("Escape"); await sleep(100);
      await p.keyboard.press("t"); await sleep(250);
      await shot(p, "hostile", `${site}-text-edit`, [ui(p, ".gm-frame"), ui(p, ".gm-tb")], { pad: 12, note: "T edits the text in place (a form field toasts that it keeps its own text)" });
      await p.keyboard.press("Escape"); await sleep(150);
      await ui(p, ".in").focus();
      await p.keyboard.press("Control+Comma"); await sleep(300);
      await shot(p, "hostile", `${site}-settings`, ui(p, ".bar"));
      await p.keyboard.press("Escape"); await sleep(150);
      await ui(p, ".gm-qbtn").click(); await sleep(250);
      await shot(p, "hostile", `${site}-page-tools`, [ui(p, ".gm-menu"), ui(p, ".gm-qbtn")], { pad: 12 });
      await p.keyboard.press("Escape"); await sleep(100);
      await hover(p, sel); // off the page-tools button, so its tooltip isn't in the next shots
      await ui(p, ".in").fill("make it airier");
      await shot(p, "hostile", `${site}-bar`, ui(p, ".bar"));
      await ui(p, ".in").press("Enter");
      await p.waitForFunction(() => globalThis.__cat.gen); await sleep(700);
      await shot(p, "hostile", `${site}-effect`, ui(p, ".fx"), { pad: 16 });
      await finish(p, OK());
      await shot(p, "hostile", `${site}-result`, ui(p, ".bar"));
      await ui(p, "[data-a=code]").click(); await ui(p, ".card").waitFor({ state: "visible" }); await sleep(300);
      await shot(p, "hostile", `${site}-code`, ui(p, ".card"));
      await p.keyboard.press("Escape");
      await ui(p, "[data-a=keep]").click(); await sleep(350);
      await shot(p, "hostile", `${site}-toast`, ui(p, ".toast"), { pad: 16 });
      await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor({ state: "visible" }); await sleep(300);
      await shot(p, "hostile", `${site}-panel`, ui(p, ".panel"));
    } catch (e) {
      await shot(p, "hostile", `${site}-broken`, null, { checks: [`flow failed: ${e.message.split("\n")[0]}`] });
    }
    await close(p);
  }
}

// ---------------------------------------------------------------- run
await fs.mkdir(OUT, { recursive: true });
// a full run starts clean; docs/ui/before (hand-picked "before" shots for the review) is kept
if (!ONLY) for (const d of await fs.readdir(OUT)) if (!d.includes(".") && d !== "before") await fs.rm(path.join(OUT, d), { recursive: true, force: true });
const t0 = Date.now();
for (const theme of ["dark", "light"]) {
  console.log(`— ${theme}`);
  for (const width of [1100, 390]) {
    if (want("bar")) await barStates(theme, width);
    if (want("toast")) await toastStates(theme, width);
    if (want("panel")) await panelStates(theme, width);
    if (want("modal")) await modalStates(theme, width);
  }
  if (want("effect")) await effectStates(theme);
  for (const width of [1100, 390]) {
    if (want("god")) await godStates(theme, width);
    if (want("voice")) await voiceStates(theme, width);
    if (want("sheets")) await sheetStates(theme, width);
    if (want("flow")) await flowStates(theme, width);
  }
  if (want("motion")) await reducedMotion(theme);
}
if (want("hostile")) { console.log("— hostile hosts"); await hostileStates(); }
await browser.close();
server.close();

// merge with an earlier run when --only was used
const prevFile = path.join(OUT, "catalog.json");
let all = results;
if (ONLY && existsSync(prevFile)) {
  // an --only group (god, voice, sheets, flow) reshoots several areas
  const redone = new Set(results.map(r => r.area));
  const prev = JSON.parse(readFileSync(prevFile, "utf8")).shots.filter(s => !ONLY.has(s.area) && !redone.has(s.area));
  all = prev.concat(results);
}
await fs.writeFile(prevFile, JSON.stringify({ generated: new Date().toISOString(), shots: all }, null, 1));
await writeIndex();
const bad = results.filter(r => r.issues.length);
console.log(`\n${results.length} states captured in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${bad.length} with automated findings → docs/ui/index.html`);

// ---------------------------------------------------------------- index.html
async function writeIndex() {
  const { shots } = JSON.parse(readFileSync(path.join(OUT, "catalog.json"), "utf8"));
  const reviewFile = path.join(OUT, "review.json");
  const reviewDoc = existsSync(reviewFile) ? JSON.parse(readFileSync(reviewFile, "utf8")) : {};
  // review.json: { states: { "area/state" (every theme and width) or "area/state-narrow-dark": { note, verdict, accept } },
  //                fixes: [{ title, before, after }] } — the human half of the review
  const review = reviewDoc.states || {}, fixes = reviewDoc.fixes || [];
  const baseOf = s => s.state.replace(/-(narrow-)?(dark|light)$/, "");
  const verdictOf = s => {
    const r = review[`${s.area}/${s.state}`] || review[`${s.area}/${baseOf(s)}`] || review[`${s.area}/*`];
    if (s.issues.length && !(r && r.accept)) return { icon: "⚠️", text: s.issues.join("; ") };
    if (r && r.verdict === "fail") return { icon: "❌", text: r.note };
    if (r && r.verdict === "residual") return { icon: "⚠️", text: `known, not fixed here: ${r.note}` };
    const notes = [s.note, r?.note, s.issues.length ? `accepted: ${s.issues.join("; ")} (${r.accept})` : ""].filter(Boolean);
    return { icon: "✅", text: notes.join(" · ") };
  };
  const areas = [...new Set(shots.map(s => s.area))];
  const { spawnSync } = await import("node:child_process");
  const contrast = JSON.parse(spawnSync(process.execPath, [path.join(ROOT, "demo", "contrast.js"), "--json"], { encoding: "utf8" }).stdout || "{\"rows\":[]}");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const counts = { "✅": 0, "⚠️": 0, "❌": 0 };
  const sections = areas.map(area => {
    const items = shots.filter(s => s.area === area).map(s => {
      const v = verdictOf(s); counts[v.icon]++;
      return `<figure class="${s.theme}"><a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt="${esc(s.state)}"></a>
        <figcaption><span class="v">${v.icon}</span> <b>${esc(s.state)}</b>${v.text ? `<small>${esc(v.text)}</small>` : ""}</figcaption></figure>`;
    }).join("\n");
    return `<section id="${area}"><h2>${area} <span>${shots.filter(s => s.area === area).length}</span></h2><div class="grid">${items}</div></section>`;
  }).join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Morse UI catalog</title>
<style>
  :root { color-scheme: dark; --bg: #0b0b0c; --fg: #ededef; --dim: #a0a0a8; --line: #232327; --tile: #111113; --tile-l: #f5f5f6; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.5 Inter, system-ui, sans-serif; }
  header { padding: 24px 24px 8px; } h1 { margin: 0 0 4px; font-size: 20px; } header p { margin: 0; color: var(--dim); }
  nav { position: sticky; top: 0; background: var(--bg); padding: 8px 24px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 4px 12px; z-index: 1; }
  nav a { color: var(--dim); text-decoration: none; } nav a:hover { color: var(--fg); }
  section { padding: 8px 24px 24px; } h2 { font-size: 15px; margin: 16px 0 12px; } h2 span { color: var(--dim); font-weight: 400; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  figure { margin: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--tile); }
  figure.light { background: var(--tile-l); }
  figure a { display: grid; place-items: center; min-height: 120px; padding: 12px; }
  figure img { max-width: 100%; max-height: 360px; image-rendering: auto; }
  figcaption { background: var(--bg); padding: 8px 12px; border-top: 1px solid var(--line); }
  .pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(560px, 1fr)); gap: 16px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--tile); }
  .pair p { grid-column: 1 / -1; margin: 0 0 4px; } .pair img { width: 100%; border-radius: 6px; }
  table { border-collapse: collapse; } td { padding: 3px 12px 3px 0; border-bottom: 1px solid var(--line); } code { font-size: 12px; color: var(--dim); }
  figcaption b { font-weight: 500; font-family: ui-monospace, monospace; font-size: 12px; } figcaption small { display: block; color: var(--dim); margin-top: 2px; }
</style></head><body>
<header><h1>Morse UI catalog</h1><p>${shots.length} states · ✅ ${counts["✅"]} · ⚠️ ${counts["⚠️"]} · ❌ ${counts["❌"]} · generated by <code>npm run ui</code> (demo/ui-catalog.js) · checklist: <a href="CHECKLIST.md" style="color:inherit">CHECKLIST.md</a></p></header>
<nav><a href="#fixes">fixes</a><a href="#contrast">contrast</a>${areas.map(a => `<a href="#${a}">${a}</a>`).join("")}</nav>
<section id="fixes"><h2>Fixed in review <span>${fixes.length}</span></h2><div class="pairs">${fixes.map(f => `
  <div class="pair"><p>${esc(f.title)}</p><a href="${esc(f.before)}"><img loading="lazy" src="${esc(f.before)}" alt="before"></a><a href="${esc(f.after)}"><img loading="lazy" src="${esc(f.after)}" alt="after"></a></div>`).join("")}</div></section>
<section id="contrast"><h2>Contrast (WCAG AA, worst case over the host page) <span>${contrast.rows.filter(r => r.pass).length}/${contrast.rows.length} pass</span></h2>
<table>${contrast.rows.map(r => `<tr><td>${r.pass ? "✅" : "❌"}</td><td>${r.theme}</td><td>${esc(r.what)}</td><td><code>${r.fg}</code> on <code>${r.bg}</code></td><td>${r.ratio.toFixed(2)} ≥ ${r.min}</td></tr>`).join("")}</table>
${contrast.literals?.length ? `<p>❌ non-token colors: ${contrast.literals.map(l => `line ${l.line} ${esc(l.literal)}`).join(", ")}</p>` : "<p>✅ runtime/src/99-css.js, 98-bar-css.js and 98-godmode-css.js use token colors only</p>"}</section>
${sections}
</body></html>`;
  await fs.writeFile(path.join(OUT, "index.html"), html);
}
