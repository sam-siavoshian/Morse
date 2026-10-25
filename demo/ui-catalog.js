// The UI catalog: drives the real runtime (dist/runtime/runtime.js) through
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
//   node demo/ui-catalog.js --out=/tmp/ui --only=panel   audit run, docs/ui untouched
//   node demo/ui-catalog.js --theme=dark --width=1100          one theme, one width
//   node demo/ui-catalog.js --no-axe                     skip axe-core (demo/axe.js) on each state
//   DISPLAY=:99 node demo/ui-catalog.js --only=extension   the extension's own pages
//                                   (welcome, practice, popup) need the real extension, headful
//   DISPLAY=:99 node demo/ui-catalog.js --only=desktop,welcome,site,new-bar   round 6: Morse Desktop
//                                   (the real Electron app), onboarding v2, the website and Try it here, newer bar states
//
// Needs Playwright (resolved from the global install).
import { createRequire } from "node:module";
import http from "node:http";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { axeCheck, axeLines, AXE_VERSION } from "./axe.js";
import { fakeSpeech } from "./a11y-page.js";
// The default Open Morse hotkey: ⌥Space on macOS, Ctrl+Shift+Space elsewhere (core/hotkeys.js).
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
// --out=dir writes the shots and verdicts somewhere else (a scratch audit run that leaves docs/ui alone)
const OUT = args.out ? path.resolve(String(args.out)) : path.join(ROOT, "docs", "ui");
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
    // round 4: a page that enforces Trusted Types, as VS Code's window does
    if (/[?&]tt=1/.test(req.url)) headers["Content-Security-Policy"] = "require-trusted-types-for 'script'";
    const body = await fs.readFile(file); // read first: a missing file is a 404, not a second writeHead
    res.writeHead(200, headers).end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
const axeTally = new Map(); // axe rule -> states where it broke
const TIMED = new Set(["effect", "pulse", "motion", "radar"]);
// a fake microphone (a tone) for the voice states; Web Speech is stubbed per page
const launchBrowser = () => chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
let browser = await launchBrowser();
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
  ctx.setDefaultTimeout(Number(process.env.UI_TIMEOUT) || 10000); ctx.setDefaultNavigationTimeout(Number(process.env.UI_TIMEOUT) || 10000); // UI_TIMEOUT=30000 on a busy machine
  for (const fn of [SPEECH_FAILS, ...[].concat(init)]) await ctx.addInitScript(fn);
  const page = await ctx.newPage();
  page.on("pageerror", e => console.warn("  [pageerror]", e.message));
  await page.exposeFunction("__catCapture", async () => "data:image/png;base64," + (await page.screenshot()).toString("base64"));
  if (url) {
    await page.goto(`${BASE}${url}${url.includes("?") ? "&" : "?"}mods=${mods}${extra}`);
    await page.addScriptTag({ url: "/demo/catalog-host.js" });
    await page.addScriptTag({ url: "/dist/runtime/runtime.js" });
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
  // axe-core on the overlay as it is in this state (demo/axe.js); each broken rule is counted once per state
  // (not on the animation states: they are timed to the frame, and the overlay is the bar's, audited in its own states)
  if (!args["no-axe"] && !TIMED.has(area)) {
    const found = await axeCheck(page).catch(e => [{ id: "axe-failed", impact: "critical", help: e.message.split("\n")[0], targets: [] }]);
    for (const v of found) axeTally.set(v.id, (axeTally.get(v.id) || 0) + 1);
    issues = issues.concat(axeLines(found));
  }
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
      const box = el.parentElement && el.closest(".bar, .panel, .card, .toast, .gm-tb, .gm-pop, .gm-note, .gm-menu, .bmenu, .a11y-group, .ra, .ds, .ctl-toast, .gl-trial, .so-strip, .ob-win, .ys-row");
      if (box && box !== el && !el.closest(".list, .card textarea, .tip, .gm-chips, .pane")) {
        const b = box.getBoundingClientRect();
        if (r.right > b.right + 0.5 || r.left < b.left - 0.5) out.push(`${name(el)} sticks out of ${name(box)}`);
      }
      const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (text && !el.matches(".ticker, textarea, input, .code") && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis")
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
      // (and 1.5 for the 6px status dot, one of the radar mark's squares)
      const dot = rad === 1.5 && Math.round(br.width) === 6 && Math.round(br.height) === 6;
      if (rad && !dot && ![2, 4, 6, 10, 14].includes(rad) && !(rad >= br.height / 2 - 0.5) && !/%/.test(cs.borderTopLeftRadius)) out.push(`${name(el)} radius ${rad}px is not 4/6/10/14`);
      // 1px lines (the picker outline is 1.5 on purpose and is an outline, not a border)
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        const w = parseFloat(cs[`border${side}Width`]);
        if (cs[`border${side}Style`] !== "none" && w && w !== 1) { out.push(`${name(el)} border-${side.toLowerCase()} is ${w}px, not 1px`); break; }
      }
    }
    // icons: one set, 16px, 1.5px strokes, round caps (the radar mark has its own sizes)
    for (const svg of root.querySelectorAll("svg:not(.radar):not(.ob-win-check)")) { // (the first-save check is drawn over the 30px mark)
      if (!visible(svg) || opacityOf(svg.parentElement) < 0.02) continue;
      const b = svg.getBoundingClientRect();
      if (clip && !(b.right > clip.x && b.left < clip.x + clip.width && b.bottom > clip.y && b.top < clip.y + clip.height)) continue;
      if (Math.round(b.width) !== 16 || Math.round(b.height) !== 16) out.push(`icon in ${name(svg.parentElement)} is ${Math.round(b.width)}×${Math.round(b.height)}, not 16×16`);
      const cs = getComputedStyle(svg);
      if (cs.stroke !== "none" && parseFloat(cs.strokeWidth) !== 1.5) out.push(`icon in ${name(svg.parentElement)} has a ${cs.strokeWidth} stroke, not 1.5px`);
    }
    // host-style leakage: the overlay must look the same on any page
    for (const sel of [".bar", ".panel", ".card", ".toast", ".hl span", ".gm-tb", ".gm-pop", ".gm-menu", ".bmenu", ".pane", ".ra", ".ds", ".ctl-toast", ".gl-trial", ".so-strip", ".ob-win"]) {
      const el = root.querySelector(sel);
      if (!el || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.direction !== (host.dir === "rtl" ? "rtl" : "ltr")) out.push(`${sel} inherits direction:${cs.direction}`); // right to left only in Persian and Arabic (04-i18n.js)
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
  const x = b.x + Math.min(12, b.width / 2), y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: 2 });
  await sleep(150);
  // a target under the bar: the bar steps aside once the pointer rests on it (350ms), then point again
  const bar = await ui(page, ".bar").boundingBox().catch(() => null);
  // (resting on a control never moves it, so rest on the input, as a person would)
  if (bar && x >= bar.x && x <= bar.x + bar.width && y >= bar.y && y <= bar.y + bar.height) {
    const inp = await ui(page, ".in").boundingBox();
    await page.mouse.move(inp.x + inp.width / 2, inp.y + inp.height / 2, { steps: 2 }); await sleep(550);
    await page.mouse.move(x, y, { steps: 2 }); await sleep(150);
  }
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
  // past the 120ms transition (on a busy machine a frame can come late: look again, up to a second)
  let verdict = "";
  for (let i = 0; i < 5; i++) {
    await sleep(200);
    verdict = await check(loc);
    if (!verdict) break;
  }
  return verdict;
}
function check(loc) {
  return loc.evaluate(el => {
    if (!el.matches(":focus-visible")) return "focus does not match :focus-visible";
    // the indicator itself: a 2px ring (on the control, its track, or its field), or a highlighted menu row
    const ring = n => { const c = getComputedStyle(n); return (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) >= 2) || /0px 0px 0px [12]px/.test(c.boxShadow); };
    const host = el.closest(".gm-hex, .gm-step, .seg, .field") || el.nextElementSibling;
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
  await shot(p, "bar", "thinking", ui(p, ".bar"), { note: "stage 1: “Asking the model” as soon as Enter is pressed" });
  if (!n) await shot(p, "radar", "mark-live", ui(p, ".row .mark"), { pad: 8 });
  // round 5, the speed work: every stage says what is really happening
  await p.evaluate(() => __cat.stage("reading")); await sleep(80);
  await shot(p, "bar", "stage-reading", ui(p, ".bar"), { note: "stage 2: “The model is reading the page”" });
  await p.evaluate(() => __cat.stage("thinking")); await sleep(80);
  await shot(p, "bar", "stage-thinking", ui(p, ".bar"), { note: "stage 2b: “Thinking”, for a model that thinks first" });
  await stream(p, 30, 25);
  await shot(p, "bar", "writing", ui(p, ".bar"), { note: "stage 3: “Writing the change”, the ticker shows the words as they come" });
  await p.evaluate(() => __cat.css("#small { outline: 2px solid currentColor }")); await sleep(150);
  await shot(p, "bar", "writing-visible", ui(p, ".bar"), { note: "stage 3b: “Writing the change · you can see it now”, once the new look shows while the rest is written" });
  await p.evaluate(e => __cat.phase("fixing", e), LONG_ERROR); await sleep(80);
  await shot(p, "bar", "fixing", ui(p, ".bar"));
  await p.evaluate(() => __cat.phase("applying")); await sleep(80);
  await shot(p, "bar", "applying", ui(p, ".bar"), { note: "stage 4: “Trying the change”" });
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
  // Settings → Effects defaults to Less under reduced motion: no radar field
  // (Less draws no canvas at all), a still outline on the target instead.
  const canvas = await ui(p, ".fx").isVisible();
  const fx = ui(p, ".sel.busy");
  const still = await fx.isVisible();
  const a = still ? await fx.screenshot() : null; await sleep(450);
  const b = still ? await fx.screenshot() : null;
  const mark1 = await ui(p, ".row .mark").screenshot(); await sleep(450);
  const mark2 = await ui(p, ".row .mark").screenshot();
  await shot(p, "motion", "reduced-effect", still ? [fx, p.locator("#card")] : ui(p, ".bar"), { pad: 16, note: "Effects default to Less here: a still outline on the target, no field", checks: [
    canvas ? "the radar field is drawn under prefers-reduced-motion (Less draws no canvas)" : "",
    still ? "" : "no still outline on the target while working",
    still && !a.equals(b) ? "the outline animates under prefers-reduced-motion" : ""] });
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
      await ui(p, ".btns [data-a=share]").hover(); await sleep(150);
      await shot(p, "panel", "row-button-hover", art, { pad: 8 });
      await shot(p, "panel", "row-button-focus", art, { pad: 8, checks: [await focusVisible(p, ui(p, ".btns [data-a=share]"))] });
      await ui(p, ".rmore summary").click(); await sleep(150); // simplify: the row's More
      await shot(p, "panel", "row-more", art, { pad: 8 });
      await ui(p, ".rmore summary").click(); await sleep(100);
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
  await ui(p, "article[data-id=mod2] .rmore summary").click(); // simplify: Show code, then Edit code
  await ui(p, "article[data-id=mod2] [data-c=show]").click();
  await ui(p, ".card [data-c=edit]").click();
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
  // let go of the header first: its toolbar sits over the logo
  await ui(p, ".chip .x").click(); await sleep(150);
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
    await ui(p, ".bmenu [data-m=settings]").hover(); await sleep(150);
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
    await ui(p, ".seg[data-k=effects] [data-v=subtle]").click(); await ui(p, ".pane").evaluate(e => { e.scrollTop = 0; }); await sleep(200);
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

// ================================================================ round 3
// Mods for this site, Easier to use, user control, keep iterating (refine,
// versions, a broken mod and Fix it), and the round 2 leftovers.
const shadowEval = (p, fn, arg) => p.evaluate(([src, a]) => (0, eval)(src)(document.querySelector(":root > [data-morse-ui]").shadowRoot, a), [fn.toString(), arg]);
const blur = p => shadowEval(p, r => r.activeElement?.blur());
const toastGone = p => ui(p, ".toast").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

// ---- Mods for this site (68-gallery.js)
async function galleryStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H, mods: 1, extra: "&gallery=1" });
  await openBar(p);
  await ui(p, ".sugs .gl-sug").waitFor({ timeout: 4000 }).catch(() => {});
  await sleep(150);
  await shot(p, "gallery", "chip", ui(p, ".bar"), { checks: [await ui(p, ".sugs .gl-sug").isVisible() ? "" : "no “mods for this site” chip in the empty bar"] });
  if (!n) {
    // reach it with the mouse: the bar must not dodge on the way
    const before = await ui(p, ".bar").boundingBox();
    const c = await ui(p, ".gl-sug").boundingBox();
    await p.mouse.move(c.x + c.width / 2, c.y - 140); await sleep(60);
    await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 12 }); await sleep(250);
    const after = await ui(p, ".bar").boundingBox();
    await shot(p, "gallery", "chip-hover", ui(p, ".sugs"), { pad: 8, checks: [Math.abs(after.y - before.y) > 2 ? "the bar jumped away from a pointer heading for the chip" : ""] });
    await shot(p, "gallery", "chip-focus", ui(p, ".sugs"), { pad: 8, checks: [await focusVisible(p, ui(p, ".gl-sug"))] });
  }
  await ui(p, ".gl-sug").evaluate(el => el.click()); await sleep(400);
  await ui(p, ".panel .gl-site.open").waitFor({ timeout: 4000 }).catch(() => {});
  await blur(p); await p.mouse.move(2, 2); await sleep(100);
  await shot(p, "gallery", "section-open", ui(p, ".panel"));
  await shot(p, "gallery", "section-items", ui(p, ".gl-site"), { pad: 8 });
  if (!n) {
    await ui(p, ".gl-head").hover(); await sleep(150);
    await shot(p, "gallery", "head-hover", ui(p, ".gl-head"), { pad: 8 });
    await shot(p, "gallery", "head-focus", ui(p, ".gl-head"), { pad: 8, checks: [await focusVisible(p, ui(p, ".gl-show"))] });
    const tryB = ui(p, ".gl-item [data-gl=try]");
    await tryB.hover(); await sleep(150);
    await shot(p, "gallery", "item-hover", ui(p, ".gl-item").first(), { pad: 8 });
    await shot(p, "gallery", "item-focus", ui(p, ".gl-item").first(), { pad: 8, checks: [await focusVisible(p, tryB)] });
    await ui(p, ".gl-link").hover(); await sleep(150);
    await shot(p, "gallery", "stop-showing-hover", ui(p, ".gl-foot"), { pad: 8 });
  }
  // collapsed
  await ui(p, ".gl-head").click(); await sleep(150); await p.mouse.move(2, 2); await ui(p, ".gl-site").scrollIntoViewIfNeeded(); await sleep(100);
  await shot(p, "gallery", "section-collapsed", ui(p, ".gl-site"), { pad: 8 });
  await ui(p, ".gl-head").click(); await sleep(150);
  // the update row on an installed v1
  const upd = ui(p, "article[data-id=mod20]");
  await upd.scrollIntoViewIfNeeded(); await sleep(100);
  await shot(p, "gallery", "update-row", upd, { pad: 8 });
  if (!n) await shot(p, "gallery", "update-row-focus", upd, { pad: 8, checks: [await focusVisible(p, ui(p, "[data-gl=update]"))] });
  // Try it: the strip and the item
  await ui(p, ".gl-item[data-glid=cat-no-promos] [data-gl=try]").click(); await sleep(400);
  // (round 5) Try it reviews first: what it does, then Try it (63-control.js reviewImport)
  if (await ui(p, ".card [data-a=install]").isVisible().catch(() => false)) {
    await sleep(500); await blur(p); await p.mouse.move(2, H / 2);
    await shot(p, "gallery", "try-review", ui(p, ".card"), { note: "Try it shows what the mod does first; nothing runs until Try it, nothing is saved; Cancel has focus" });
    await ui(p, ".card [data-a=install]").click(); await sleep(500);
  }
  await p.mouse.move(2, H / 2); await toastGone(p);
  await shot(p, "gallery", "trying-strip", ui(p, ".gl-trial"), { pad: 12 });
  await ui(p, ".gl-item.trying").scrollIntoViewIfNeeded().catch(() => {}); await sleep(100);
  await shot(p, "gallery", "trying-item", ui(p, ".gl-item.trying"), { pad: 8 });
  if (!n) {
    await ui(p, ".gl-trial [data-gl=remove]").hover(); await sleep(150);
    await shot(p, "gallery", "strip-hover", ui(p, ".gl-trial"), { pad: 12 });
    await shot(p, "gallery", "strip-focus", ui(p, ".gl-trial"), { pad: 12, checks: [await focusVisible(p, ui(p, ".gl-trial [data-gl=keep]"))] });
  }
  await ui(p, ".gl-trial [data-gl=remove]").click(); await sleep(300);
  // Install…: a careful one goes to the review (no Try it)
  await ui(p, ".gl-item[data-glid=cat-draft-keeper] [data-gl=install]").click();
  await ui(p, ".card .ctl-review").waitFor({ timeout: 4000 }).catch(() => {});
  await sleep(300);
  await shot(p, "gallery", "install-review", ui(p, ".card"));
  await p.keyboard.press("Escape"); await sleep(150);
  // Update…: what changed, with the diff
  await ui(p, "[data-gl=update]").click();
  await ui(p, ".card .gl-what").waitFor({ timeout: 4000 }).catch(() => {});
  await sleep(300); await blur(p);
  await shot(p, "gallery", "update-review", ui(p, ".card"));
  if (!n) {
    await shot(p, "gallery", "update-diff-focus", ui(p, ".gl-diff").first(), { pad: 8, checks: [await focusVisible(p, ui(p, ".gl-diff"))] });
    await shot(p, "gallery", "update-footer-focus", ui(p, ".card footer"), { pad: 8, checks: [await focusVisible(p, ui(p, ".card footer [data-gl=apply]"))] });
  }
  await close(p);

  // Submit to the gallery… in the Share dialog, and the setting
  p = await open({ theme, width, height: H, extra: "&gallery=1" });
  await openBar(p); await pick(p, "#toolbar");
  await submit(p, "make the toolbar airier");
  await finish(p, OK());
  await ui(p, "[data-a=share]").click();
  await ui(p, ".card [data-gl=submit]").waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(300);
  await shot(p, "gallery", "share-submit", ui(p, ".card .exports"), { pad: 8 });
  if (!n) {
    await ui(p, ".card [data-gl=submit]").hover(); await sleep(150);
    await shot(p, "gallery", "share-submit-hover", ui(p, ".card .exports"), { pad: 8 });
  }
  await ui(p, ".card [data-gl=submit]").click(); await sleep(400);
  await shot(p, "gallery", "submit-toast", ui(p, ".toast"), { pad: 16 });
  await p.keyboard.press("Escape"); await sleep(100);
  await close(p);
  p = await open({ theme, width, height: H, extra: "&gallery=1" });
  await openBar(p);
  await p.keyboard.press("Control+Comma"); await sleep(300);
  const row = ui(p, ".pane .srow:has([data-k=gallery])");
  await row.scrollIntoViewIfNeeded(); await sleep(100); await p.mouse.move(2, 2);
  await shot(p, "gallery", "setting", row, { pad: 4 });
  if (!n) await shot(p, "gallery", "setting-focus", row, { pad: 4, checks: [await focusVisible(p, ui(p, "[data-k=gallery] input, input[data-k=gallery]"))] });
  await close(p);
}

// ---- Easier to use (65-a11y.js, 66-read-aloud.js, 67-audit.js, 68-describe.js)
// Problems planted on the catalog page for Check this page and Describe.
const PLANT = theme => {
  const s = document.createElement("section");
  s.id = "probs";
  s.style.cssText = "display:flex;gap:16px;align-items:center;flex-wrap:wrap";
  const faint = document.body.classList.contains("light") ? "#c2c2c6" : "#3c3c42";
  s.innerHTML = `<img id="pic" width="120" height="72" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="72"><rect width="120" height="72" fill="#2f6f6a"/><circle cx="34" cy="30" r="12" fill="#f6d58e"/><path d="M0 72 44 38l26 20 18-12 32 26z" fill="#213a3f"/></svg>')}">
    <button id="bare" style="width:18px;height:18px;padding:0;border:0;background:none;color:inherit;display:grid;place-items:center"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v12M2 8h12"/></svg></button>
    <input id="mail" placeholder="Email" style="height:28px;font:inherit;padding:0 8px;background:transparent;color:inherit;border:1px solid currentColor;border-radius:6px">
    <p id="faint" style="margin:0;color:${faint}">Small print that is hard to read</p>`;
  document.querySelector("main").prepend(s);
};
async function a11yStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H, init: fakeSpeech });
  await openBar(p);
  const q = ui(p, ".gm-qbtn");
  // the menu group, then with two tools on
  await q.click(); await sleep(250);
  await ui(p, ".gm-menu [data-a11y=more]").click(); await sleep(150); // simplify: the group opens from its item
  await ui(p, ".gm-menu .a11y-group").waitFor({ timeout: 3000 }).catch(() => {});
  await shot(p, "a11y", "menu", [ui(p, ".gm-menu"), ui(p, ".gm-menu .a11y-group"), q], { pad: 12 });
  for (const k of ["underline", "readable"]) {
    if (!(await ui(p, ".gm-menu").isVisible())) { await q.click(); await sleep(250); }
    await ui(p, `.gm-menu [data-a11y=${k}]`).click(); await sleep(350);
  }
  await toastGone(p);
  await q.click(); await sleep(250);
  if (!n) {
    await ui(p, ".gm-menu [data-a11y=contrast]").hover(); await sleep(150);
    await shot(p, "a11y", "menu-on-hover", [ui(p, ".gm-menu .a11y-group")], { pad: 12, note: "Underline links and Easier to read font are on (check); Dyslexia-friendly letters is their sub-option" });
    await shot(p, "a11y", "menu-item-focus", [ui(p, ".gm-menu .a11y-group")], { pad: 12, checks: [await focusVisible(p, ui(p, ".gm-menu [data-a11y=dyslexia]"))] });
  } else await shot(p, "a11y", "menu-on", [ui(p, ".gm-menu")], { pad: 12 });
  // Read aloud, from the page tools
  await ui(p, ".gm-menu [data-a11y=read]").click();
  await ui(p, ".ra").waitFor({ timeout: 3000 }).catch(() => {});
  await p.evaluate(() => window.__speech.finish()); await sleep(200);
  await p.mouse.move(2, 2); await toastGone(p);
  await shot(p, "a11y", "read-aloud", ui(p, ".ra"), { pad: 12 });
  await shot(p, "a11y", "read-aloud-mark", [ui(p, ".ra-layer i"), p.locator("main #card")], { pad: 12, note: "the sentence being read: an 18% wash with a 2px underline in --m-signal-4" });
  if (!n) {
    await ui(p, ".ra [data-ra=next]").hover(); await sleep(150);
    await shot(p, "a11y", "read-aloud-hover", ui(p, ".ra"), { pad: 12 });
    await shot(p, "a11y", "read-aloud-focus", ui(p, ".ra"), { pad: 12, checks: [await focusVisible(p, ui(p, ".ra [data-ra=rate]"))] });
  }
  await ui(p, ".ra [data-ra=play]").click(); await sleep(150); await p.mouse.move(2, 2);
  await shot(p, "a11y", "read-aloud-paused", ui(p, ".ra"), { pad: 12 });
  await ui(p, ".ra [data-ra=stop]").click(); await sleep(200);
  await close(p);

  // Check this page: list, markers, Fix it
  p = await open({ theme, width, height: H, init: fakeSpeech });
  await p.evaluate(PLANT); await sleep(100);
  await openBar(p);
  await q.click().catch(() => {}); await ui(p, ".gm-qbtn").click().catch(() => {});
  if (!(await ui(p, ".gm-menu").isVisible())) { await ui(p, ".gm-qbtn").click(); await sleep(250); }
  await ui(p, ".gm-menu [data-a11y=check]").click();
  await ui(p, ".au-list").waitFor({ timeout: 4000 }).catch(() => {});
  await sleep(400); await p.mouse.move(2, 2);
  await shot(p, "a11y", "audit", ui(p, ".bar"));
  await shot(p, "a11y", "audit-markers", null, { note: "numbered markers on each place; the bar goes to the end that covers fewer of them" });
  if (!n) {
    await ui(p, ".au-fix").first().hover(); await sleep(150);
    await shot(p, "a11y", "audit-fix-hover", ui(p, ".au-item").first(), { pad: 8 });
    await shot(p, "a11y", "audit-fix-focus", ui(p, ".au-item").first(), { pad: 8, checks: [await focusVisible(p, ui(p, ".au-fix").first())] });
    await shot(p, "a11y", "audit-marker-focus", ui(p, ".au-item").first(), { pad: 8, checks: [await focusVisible(p, ui(p, ".au-marks button").first())] });
    await shot(p, "a11y", "audit-again-focus", ui(p, ".au-head"), { pad: 8, checks: [await focusVisible(p, ui(p, "[data-au=again]"))] });
  }
  // Fix it on the faint text (fixed at once, saved in Accessibility fixes)
  const contrastFix = ui(p, ".au-item:has(.au-main b:text-matches('hard to read')) .au-fix");
  if (await contrastFix.count()) { await contrastFix.click(); await sleep(400); }
  await shot(p, "a11y", "fix-it-done", [ui(p, ".bar"), ui(p, ".toast")], { note: "Fix it: the toast says what was saved; the list is checked again" });
  await close(p);

  // Describe this picture: busy, the description, an error
  for (const kind of ["busy", "done", "error"]) {
    if (n && kind === "busy") continue;
    p = await open({ theme, width, height: H, init: fakeSpeech });
    await p.evaluate(PLANT); await sleep(100);
    await openBar(p);
    await select(p, "#pic");
    await ui(p, ".gm-tb [data-a11y-tb=describe]").click();
    await ui(p, ".ds").waitFor({ timeout: 4000 }).catch(() => {});
    await p.waitForFunction(() => globalThis.__cat.gen, null, { timeout: 4000 }).catch(() => {});
    await sleep(200);
    if (kind === "done") {
      await p.evaluate(() => { __cat.push({ type: "answer", genId: __cat.gen.genId, text: "A teal landscape with a yellow sun over dark hills." }); __cat.done({ ok: true }); });
      await sleep(300);
    }
    if (kind === "error") { await p.evaluate(() => __cat.done({ ok: false, error: "This model can't look at pictures. Choose Claude in Settings" })); await sleep(300); }
    await p.mouse.move(2, 2);
    await shot(p, "a11y", `describe-${kind}`, [ui(p, ".ds"), ui(p, ".ds-ring")], { pad: 12 });
    if (!n && kind === "done") {
      await ui(p, ".ds [data-ds=copy]").hover(); await sleep(150);
      await shot(p, "a11y", "describe-hover", ui(p, ".ds"), { pad: 12 });
      await shot(p, "a11y", "describe-focus", ui(p, ".ds"), { pad: 12, checks: [await focusVisible(p, ui(p, ".ds [data-ds=save]"))] });
      await shot(p, "a11y", "describe-close-focus", ui(p, ".ds"), { pad: 12, checks: [await focusVisible(p, ui(p, ".ds [data-ds=close]"))] });
    }
    await close(p);
  }
  // the toolbar: Read aloud and Describe show for what they can act on
  if (!n) {
    p = await open({ theme, width, height: H, init: fakeSpeech });
    await p.evaluate(PLANT); await sleep(100);
    await openBar(p);
    await select(p, "#pic");
    const d = ui(p, ".gm-tb [data-a11y-tb=describe]");
    await d.hover(); await sleep(520);
    await shot(p, "a11y", "toolbar-describe-hover", [tb(p), ui(p, ".gm-tb [data-a11y-tb=describe] .tip")], { pad: 8 });
    await select(p, "#card", 0.3, 0.6);
    await ui(p, ".gm-tb [data-a11y-tb=read]").hover(); await sleep(520);
    await shot(p, "a11y", "toolbar-read-hover", [tb(p), ui(p, ".gm-tb [data-a11y-tb=read] .tip")], { pad: 8 });
    await close(p);
  }
}

// Each page tool on the Riverside Library demo site (demo/sites/a11y), with
// the stand-in host that runs mod code for real. Light site, so light theme.
async function a11ySiteStates(width) {
  const n = width < 600;
  const { openLibrary } = await import("./a11y-page.js");
  const one = async (kinds, state, note) => {
    const { page, ctx } = await openLibrary(browser, { viewport: { width, height: n ? 844 : 760 } });
    page.vp = n ? "narrow" : "";
    for (const k of kinds) {
      if (await page.locator(".bar").isHidden()) { await page.keyboard.press(OPEN_KEY); await sleep(250); }
      await page.locator(".gm-qbtn").click(); await sleep(200);
      await page.locator(`.gm-menu [data-a11y="${k}"]`).click(); await sleep(350);
    }
    if (await page.locator(".bar").isVisible()) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.locator(".toast").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.mouse.move(width / 2, 300); await sleep(300);
    await shot(page, "a11y-site", state, null, { theme: "light", note });
    await ctx.close();
  };
  await one([], "before", "the Riverside Library as it ships: faint text, tiny targets, no underlines, a ticker, a cookie bar and a chat bubble");
  const KINDS = { contrast: "Higher contrast", targets: "Bigger click targets", readable: "Easier to read font", underline: "Underline links", still: "Stop animations", outline: "Focus outline everywhere", ruler: "Reading ruler", calm: "Hide distractions" };
  for (const [k, title] of Object.entries(KINDS)) {
    if (n && !["contrast", "readable", "calm"].includes(k)) continue;
    await one([k], k, title);
  }
  if (!n) await one(["readable", "dyslexia"], "dyslexia", "Easier to read font with Dyslexia-friendly letters");
}

// ---- user control (63-control.js)
const SHARE = mod => `https://morse.sh/install#m=${Buffer.from(JSON.stringify(mod)).toString("base64url")}`;
async function controlStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H, mods: 1 });
  // install review from a link (one mod), Show code open
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(300);
  await shot(p, "control", "panel-strip", [ui(p, ".panel header"), ui(p, ".ctl-strip")], { pad: 4 });
  await shot(p, "control", "panel-backup", [ui(p, ".ctl-backup"), ui(p, ".panel footer")], { pad: 4 });
  if (!n) {
    await ui(p, ".ctl-row").hover(); await sleep(150);
    await shot(p, "control", "pause-row-hover", ui(p, ".ctl-strip"), { pad: 4 });
    await shot(p, "control", "pause-row-focus", ui(p, ".ctl-strip"), { pad: 4, checks: [await focusVisible(p, ui(p, "[data-c=pause-site]"))] });
    await ui(p, ".pmore summary").click(); await sleep(150); // simplify: backup is under the panel's More
    await ui(p, "[data-c=export]").hover(); await sleep(150);
    await shot(p, "control", "backup-hover", ui(p, ".ctl-backup:not(.pk-bar)"), { pad: 4 });
    await shot(p, "control", "backup-focus", ui(p, ".ctl-backup:not(.pk-bar)"), { pad: 4, checks: [await focusVisible(p, ui(p, "[data-c=export]"))] });
    await ui(p, ".pmore summary").click(); await sleep(100);
    await ui(p, ".list article .rmore summary").first().click(); await sleep(150);
    await shot(p, "control", "origin-show-code", ui(p, ".list article").first(), { pad: 8, checks: [await focusVisible(p, ui(p, "[data-c=show]").first())] });
  }
  // pause this site: the row turns on, every mod shows "not running", a toast
  await ui(p, ".ctl-row .sw").click(); await sleep(400); await p.mouse.move(2, 2);
  await shot(p, "control", "paused-site", [ui(p, ".ctl-strip"), ui(p, ".list article").first()], { pad: 4 });
  await shot(p, "control", "paused-toast", ui(p, ".ctl-toast"), { pad: 16 });
  if (!n) await shot(p, "control", "toast-action-focus", ui(p, ".ctl-toast"), { pad: 16, checks: [await focusVisible(p, ui(p, ".ctl-toast [data-i='0']"))] });
  await ui(p, ".ctl-row .sw").click(); await sleep(300);
  // Show code (what it does, then the code)
  if (await ui(p, "[data-c=show]").first().isHidden()) await ui(p, ".list article .rmore summary").first().click();
  await ui(p, "[data-c=show]").first().click(); await ui(p, ".card").waitFor({ state: "visible" }); await sleep(300); await blur(p);
  await shot(p, "control", "show-code", ui(p, ".card"));
  await p.keyboard.press("Escape"); await sleep(150);
  // install review: one mod from a link, then a backup with three
  await ui(p, "footer [data-a=import]").click(); await ui(p, ".card").waitFor(); await sleep(200);
  await ui(p, ".card textarea").fill(SHARE({ title: "Reading time", prompt: "show how long the article takes to read", author: "Ana", match: { hosts: ["*"] },
    css: ".rt { opacity: .7 }", js: "morse.watch('article .by', by => by.append(morse.el('b', { text: ' · 4 min left' })));" }));
  await ui(p, ".card [data-a=go]").click();
  await ui(p, ".card .ctl-review").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300);
  await shot(p, "control", "install-review", ui(p, ".card"), { note: "one mod from a link that runs on every website: the note says so; Cancel has focus, never Install" });
  if (!n) {
    await shot(p, "control", "install-cancel-focus", ui(p, ".card footer"), { pad: 8, checks: [await focusVisible(p, ui(p, ".card footer [data-a=close]"))] });
    await shot(p, "control", "install-showcode-focus", ui(p, ".ctl-code"), { pad: 8, checks: [await focusVisible(p, ui(p, ".ctl-code summary"))] });
  }
  await ui(p, ".ctl-code summary").click(); await sleep(150); await blur(p);
  await shot(p, "control", "install-review-code", ui(p, ".card"));
  await p.keyboard.press("Escape"); await sleep(150);
  await p.evaluate(() => (__cat.preview = { kind: "backup", errors: ["Item 4: it has no code"], mods: [
    { title: "Airier toolbar", prompt: "make the toolbar airier", css: "#toolbar { gap: 20px }", js: "", match: { hosts: [location.host] } },
    { title: "Word count", prompt: "show a live word count under the composer", css: "", js: "morse.watch('textarea', t => t.after(morse.el('small')))", match: { hosts: ["parley.app"] } },
    { title: "Supercalifragilisticexpialidocious_unbroken_identifier_title_without_spaces", prompt: "averyveryverylongpromptwithoutanyspacesatallthatshouldnotblowupthelayout_ever_ever", css: ".x{}", js: "", match: { hosts: [location.host] } },
  ] }));
  await ui(p, "footer [data-a=import]").click(); await ui(p, ".card").waitFor(); await sleep(200);
  await ui(p, ".card textarea").fill("{}");
  await ui(p, ".card [data-a=go]").click();
  await ui(p, ".card .ctl-review").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300); await blur(p);
  await shot(p, "control", "install-review-backup", ui(p, ".card"), { note: "a backup: one section per mod, a mod for another site says “not this page”, skipped items at the end" });
  await p.keyboard.press("Escape"); await sleep(150);
  await close(p);

  // the off switch: every mod off at once, with Turn back on
  p = await open({ theme, width, height: H, mods: 12 });
  await p.mouse.move(width / 2, 200);
  await p.keyboard.press("Alt+Shift+Digit0");
  await ui(p, ".ctl-toast").waitFor({ timeout: 3000 }).catch(() => {}); await sleep(300);
  await shot(p, "control", "off-switch-toast", ui(p, ".ctl-toast"), { pad: 16 });
  if (!n) {
    await ui(p, ".ctl-toast [data-i='0']").hover(); await sleep(150);
    await shot(p, "control", "off-switch-hover", ui(p, ".ctl-toast"), { pad: 16 });
    await shot(p, "control", "off-switch-close-focus", ui(p, ".ctl-toast"), { pad: 16, checks: [await focusVisible(p, ui(p, ".ctl-toast .ctl-x"))] });
  }
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(300); await p.mouse.move(2, 2);
  await shot(p, "control", "off-panel-note", [ui(p, ".ctl-strip"), ui(p, ".list article").first()], { pad: 4 });
  await close(p);

  // paused everywhere, and safe start
  p = await open({ theme, width, height: H, mods: 1, extra: "&paused=1" });
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(300); await p.mouse.move(2, 2);
  await shot(p, "control", "paused-everywhere", [ui(p, ".ctl-strip"), ui(p, ".list article").first()], { pad: 4 });
  await close(p);
  p = await open({ theme, width, height: H, mods: 12, extra: "&suspect=1" });
  await ui(p, ".ctl-toast").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300);
  await shot(p, "control", "safe-start", ui(p, ".ctl-toast"), { pad: 16 });
  if (!n) await shot(p, "control", "safe-start-focus", ui(p, ".ctl-toast"), { pad: 16, checks: [await focusVisible(p, ui(p, ".ctl-toast .primary"))] });
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(300); await p.mouse.move(2, 2);
  await shot(p, "control", "safe-start-note", [ui(p, ".ctl-strip"), ui(p, ".list article").first()], { pad: 4 });
  await close(p);
}

// The extension popup's pause switches (extension/popup-control.js), served
// from dist/extension with a stand-in chrome API.
async function popupStates(theme) {
  const ctx = await browser.newContext({ viewport: { width: 368, height: 760 }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript(([paused]) => {
    const state = { all: false, here: !!paused };
    const reply = msg => {
      if (msg.type === "popup.state") return { label: "Claude Code · sonnet", userScripts: true, kind: "helper", reason: "", backend: "helper", helper: { paired: true, label: "Claude Code", provider: "claude-code" }, providers: {}, helperModel: "", anthropicModels: ["claude-sonnet"], anthropicModel: "claude-sonnet",
        mods: [{ id: "a", title: "Calm reading", prompt: "hide the ads and make the article easier to read", css: ".ad { display: none }", js: "", enabled: true, created: "2026-10-18T10:00:00Z" },
          { id: "b", title: "No newsletter popup", prompt: "get rid of the newsletter popup", css: ".pop { display: none }", js: "", enabled: !state.here, imported: true, importedFrom: "link", author: "Ana" }] };
      if (msg.type === "control.get") return { info: state };
      if (msg.type === "control.pause") { state[msg.scope === "all" ? "all" : "here"] = msg.on; return { info: state }; }
      return null;
    };
    globalThis.chrome = { runtime: { id: "catalog", sendMessage: async m => ({ result: reply(m), ...reply(m) }) }, tabs: { query: async () => [{ id: 1, url: "https://thedailybyte.news/" }], sendMessage: async () => {} },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } } };
  }, [false]);
  let page = await ctx.newPage();
  page.on("pageerror", e => console.warn("  [pageerror]", e.message));
  await page.goto(`${BASE}/dist/extension/popup.html?url=${encodeURIComponent("https://thedailybyte.news/")}`);
  await page.waitForSelector("#ctl .ctl-row", { timeout: 5000 }).catch(() => {});
  await sleep(300);
  page.vp = "";
  const popShot = async (state, target, opts = {}) => {
    const b = await target.boundingBox();
    const file = path.join(OUT, "popup", `${state}-${theme}.png`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 } });
    const issues = (opts.checks || []).filter(Boolean);
    results.push({ area: "popup", state: `${state}-${theme}`, theme, file: path.relative(OUT, file), issues, note: opts.note || "" });
    console.log(`  ${issues.length ? "!" : "✓"} popup/${state}-${theme}${issues.length ? "  " + issues.join(" | ") : ""}`);
  };
  const box = page.locator("#ctl");
  await popShot("pause-off", box);
  await page.locator("#ctl .ctl-row").first().hover(); await sleep(150);
  await popShot("pause-hover", box);
  await page.keyboard.press("Tab"); // focus the first switch from the keyboard
  await page.locator("#ctl input[data-scope=site]").focus(); await sleep(150);
  const ring = await page.locator("#ctl input[data-scope=site]").evaluate(el => { const c = getComputedStyle(el.nextElementSibling); return el.matches(":focus-visible") && c.outlineStyle !== "none" && parseFloat(c.outlineWidth) >= 2 ? "" : "no 2px focus ring on the switch"; });
  await popShot("pause-focus", box, { checks: [ring] });
  await page.locator("#ctl .ctl-row").first().click(); await sleep(250);
  await page.mouse.move(2, 2);
  await popShot("pause-site-on", box);
  await popShot("whole", page.locator("body"), { note: "the whole popup with this site paused" });
  await page.locator("#go").focus(); await page.keyboard.press("Shift"); await page.locator("#go").focus(); await sleep(150);
  const goRing = await page.locator("#go").evaluate(el => { const c = getComputedStyle(el); return c.outlineStyle !== "none" && parseFloat(c.outlineWidth) >= 2 ? "" : "no 2px focus ring"; });
  await popShot("go-focus", page.locator("#go"), { checks: [goRing] });
  await ctx.close();

  // round 5: “Allow User Scripts” off, with mods here whose code waits for it
  const wctx = await browser.newContext({ viewport: { width: 368, height: 760 }, deviceScaleFactor: 2, colorScheme: theme });
  await wctx.addInitScript(() => {
    const reply = msg => {
      if (msg.type === "popup.state") return { label: "Claude Code · sonnet", userScripts: false, kind: "helper", reason: "", backend: "helper", helper: { paired: true, label: "Claude Code", provider: "claude-code" }, providers: {}, helperModel: "", anthropicModels: ["claude-sonnet"], anthropicModel: "claude-sonnet",
        mods: [{ id: "a", title: "Calm reading", prompt: "hide the ads and make the article easier to read", css: ".ad { display: none }", js: "", enabled: true, created: "2026-10-18T10:00:00Z" },
          { id: "b", title: "Reading time", prompt: "show how long the article takes to read", css: ".rt { opacity: .7 }", js: "morse.watch('article', a => a.prepend(morse.el('small')))", enabled: true, created: "2026-10-19T10:00:00Z" },
          { id: "c", title: "Copy quotes with the link", prompt: "add a button to copy a quote with a link to the article", css: "", js: "morse.el('button')", enabled: true, created: "2026-10-20T10:00:00Z" }] };
      if (msg.type === "control.get") return { info: { all: false, here: false } };
      if (msg.type === "onboarding.status") return { state: {}, status: { model: { connected: true }, userScripts: false } };
      return null;
    };
    const tab = { id: 1, url: "https://thedailybyte.news/" };
    globalThis.chrome = { runtime: { id: "catalog", sendMessage: async m => ({ result: reply(m), ...reply(m) }) }, tabs: { query: async () => [tab], get: async () => tab, sendMessage: async () => {} },
      extension: { isAllowedFileSchemeAccess: cb => cb(true) }, scripting: { executeScript: async () => [{ result: { morse: true, type: "text/html" } }] },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}), remove: async () => {} } } };
  });
  const wp = await wctx.newPage();
  wp.on("pageerror", e => console.warn("  [pageerror]", e.message));
  await wp.goto(`${BASE}/dist/extension/popup.html?url=${encodeURIComponent("https://thedailybyte.news/")}`);
  await wp.waitForSelector("#mods li", { timeout: 5000 }).catch(() => {}); await sleep(300);
  const keep = page;
  page = wp; // popShot shoots `page`
  await popShot("waiting-warn", wp.locator("#warn"), { note: "which mods here wait for “Allow User Scripts”, and that their new look already shows" });
  await popShot("waiting-mods", wp.locator("#mods"), { note: "“Waits for “Allow User Scripts”” under each mod whose code waits; a mod that only changes the look has none" });
  await popShot("waiting-whole", wp.locator("body"), { note: "the whole popup with “Allow User Scripts” off" });
  page = keep;
  await wctx.close();
}

// ---- keep iterating: refine, version history, a broken mod and Fix it
async function iterateStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H });
  await openBar(p); await pick(p, "#toolbar");
  await submit(p, "make the toolbar airier");
  await finish(p, OK());
  await ui(p, ".in").fill("and make the icons a little larger");
  await sleep(100);
  await shot(p, "iterate", "refining", ui(p, ".bar"), { note: "a follow-up is typed: Enter refines, so Save drops its ↵" });
  await ui(p, ".in").press("Enter");
  await p.waitForFunction(() => globalThis.__cat.gen); await sleep(100);
  await stream(p, 12, 25);
  await shot(p, "iterate", "refine-working", ui(p, ".bar"));
  await finish(p, OK({ title: "Airier toolbar", css: "#toolbar { gap: 20px } #toolbar button { font-size: 18px }" }));
  await shot(p, "iterate", "refined-result", ui(p, ".bar"), { note: "the result says which version this is; ⌘Z steps back one" });
  await p.keyboard.press("Control+KeyZ"); await sleep(400);
  await shot(p, "iterate", "stepped-back", ui(p, ".bar"));
  await close(p);

  // version history rows in the panel
  p = await open({ theme, width, height: H, mods: 1, extra: "&versions=1" });
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(300);
  await ui(p, "[data-a=history]").click(); await sleep(200); await p.mouse.move(2, 2);
  const art = ui(p, ".list article").first();
  await shot(p, "iterate", "history-rows", art, { pad: 8 });
  if (!n) {
    await ui(p, ".versions button").first().hover(); await sleep(150);
    await shot(p, "iterate", "history-row-hover", ui(p, ".versions"), { pad: 8 });
    await shot(p, "iterate", "history-row-focus", ui(p, ".versions"), { pad: 8, checks: [await focusVisible(p, ui(p, ".versions button").first())] });
  }
  await ui(p, ".versions button").last().click(); await sleep(400);
  await shot(p, "iterate", "history-restored", [art, ui(p, ".toast")], { pad: 8 });
  await close(p);

  // a broken mod: its code throws when it runs, the row says so, Fix it
  p = await open({ theme, width, height: H, mods: 12 });
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(300);
  const broken = ui(p, "article.broken");
  await broken.waitFor({ timeout: 3000 }).catch(() => {});
  await broken.scrollIntoViewIfNeeded().catch(() => {}); await sleep(150); await p.mouse.move(2, 2);
  await shot(p, "iterate", "broken-row", broken, { pad: 8, checks: [await broken.count() ? "" : "no row is marked broken"] });
  if (!n) {
    await ui(p, ".health").waitFor({ timeout: 3000 }).catch(() => {});
    await ui(p, ".health [data-a=fix]").hover(); await sleep(150);
    await shot(p, "iterate", "fix-hover", ui(p, ".health"), { pad: 8 });
    await shot(p, "iterate", "fix-focus", ui(p, ".health"), { pad: 8, checks: [await focusVisible(p, ui(p, ".health [data-a=fix]"))] });
  }
  await ui(p, ".health [data-a=fix]").click();
  await p.waitForFunction(() => globalThis.__cat.gen, null, { timeout: 4000 }).catch(() => {});
  await sleep(200);
  await stream(p, 10, 25);
  await shot(p, "iterate", "fixing-broken", ui(p, ".bar"));
  await finish(p, OK({ title: "Broken: keyboard shortcuts", js: "morse.watch('main', m => {})" }));
  await shot(p, "iterate", "fixed-result", ui(p, ".bar"));
  await close(p);
}

// ---- self-heal (71-heal.js): a mod that stopped working after the site changed
async function healStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  const { modCodeHash, pagePathShape } = await import("../core/heal.js");
  const mod = { title: "Album grid spacing", prompt: "more space between the albums", css: ".album-grid { gap: 24px }", js: "", target: { label: "Album grid" },
    gallery: { id: "cat-album-grid", version: 1 }, imported: true, importedFrom: "gallery", author: "Ana" };
  const fp = { v: 1, code: modCodeHash(mod), path: pagePathShape(`${BASE}/demo/catalog.html?theme=${theme}`) /* the page as opened (a word in the address, like ?theme=dark, is part of the page) */, size: 1, at: "2026-10-20T09:00:00Z", sels: [[".album-grid", 6]] };
  const seed = new Function(`globalThis.__catHealMod = ${JSON.stringify(mod)}; globalThis.__catHealFp = ${JSON.stringify(fp)};`);
  const openHeal = extra => open({ theme, width, height: H, extra: `&heal=1${extra}`, init: [seed] });
  const broken = p => p.waitForFunction(() => document.querySelector(":root > [data-morse-ui]").shadowRoot.querySelector(".bar").hasAttribute("data-heal"), null, { timeout: 15000 }).then(() => "", () => "the dot never showed (no mod marked as stopped working)");
  let p = await openHeal("");
  const marked = await broken(p);
  await openBar(p);
  await shot(p, "heal", "bar-dot", ui(p, ".row"), { pad: 4, checks: [marked], note: "a mod here stopped working after the site changed: a small --m-danger dot on the mark, nothing pops up" });
  if (!n) await shot(p, "heal", "mark-dot", ui(p, ".row .mark"), { pad: 8 });
  await p.keyboard.press("Escape"); await sleep(150);
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(400); await p.mouse.move(2, 2);
  await shot(p, "heal", "panel-header", ui(p, ".panel header"), { pad: 4 });
  const row = ui(p, "article[data-id=mod30]");
  await row.scrollIntoViewIfNeeded().catch(() => {}); await sleep(100);
  await shot(p, "heal", "stopped-row", row, { pad: 8 });
  if (!n) await shot(p, "heal", "stopped-fix-focus", ui(p, "article[data-id=mod30] .health"), { pad: 8, checks: [await focusVisible(p, ui(p, "article[data-id=mod30] [data-a=fix]"))] });
  await ui(p, "article[data-id=mod30] [data-a=fix]").click();
  await p.waitForFunction(() => globalThis.__cat.gen, null, { timeout: 4000 }).catch(() => {});
  await sleep(200); await stream(p, 10, 25);
  await shot(p, "heal", "fixing", ui(p, ".bar"));
  await finish(p, OK({ title: mod.title, css: "#toolbar { gap: 24px }" }));
  await shot(p, "heal", "fixed-result", ui(p, ".bar"));
  await ui(p, "[data-a=keep]").click(); await sleep(600);
  await ui(p, ".ctl-toast").waitFor({ timeout: 3000 }).catch(() => {});
  await shot(p, "heal", "share-fix-toast", ui(p, ".ctl-toast"), { pad: 16, note: "a fixed gallery mod: Share the fix…" });
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(400); await p.mouse.move(2, 2);
  await row.scrollIntoViewIfNeeded().catch(() => {}); await sleep(100);
  await shot(p, "heal", "fixed-row", row, { pad: 8 });
  await close(p);
  // Settings: fix automatically, and the toast it leaves
  p = await openHeal("&autofix=1");
  await p.waitForFunction(() => globalThis.__cat.gen, null, { timeout: 20000 }).catch(() => {});
  await sleep(200);
  await p.evaluate(() => __cat.done({ ok: true, title: "Album grid spacing", css: "#toolbar { gap: 24px }", js: "" }));
  await ui(p, ".ctl-toast").waitFor({ timeout: 6000 }).catch(() => {}); await sleep(300);
  await shot(p, "heal", "auto-fixed-toast", ui(p, ".ctl-toast"), { pad: 16, note: "fixed in the background: Undo and Share the fix…" });
  await openBar(p);
  await p.keyboard.press("Control+Comma"); await sleep(300);
  const srow = ui(p, ".pane .srow:has([data-k=autoFix])");
  await srow.scrollIntoViewIfNeeded(); await sleep(100); await p.mouse.move(2, 2);
  await shot(p, "heal", "setting", srow, { pad: 4 });
  await close(p);
}

// ---- round 2 leftovers
async function leftoverStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  // Tab walks the edit toolbar
  let p = await open({ theme, width, height: H });
  await openBar(p);
  await select(p, "#card", 0.3, 0.6);
  await editFocus(p);
  for (let i = 0; i < 3; i++) { await p.keyboard.press("Tab"); await sleep(60); }
  const onTool = await shadowEval(p, r => r.activeElement?.dataset?.t || r.activeElement?.className || "");
  await sleep(550); // the tooltip's 300ms delay and its fade
  await shot(p, "edit-toolbar", "tab-walk", [tb(p), ui(p, ".gm-tb button:focus .tip")], { pad: 8, checks: [onTool === "resize" ? "" : `Tab ×3 from the toolbar lands on “${onTool}”, not Resize`] });
  await p.keyboard.press("Shift+Tab"); await sleep(550);
  const back = await shadowEval(p, r => r.activeElement?.dataset?.t || "");
  await shot(p, "edit-toolbar", "shift-tab", [tb(p), ui(p, ".gm-tb button:focus .tip")], { pad: 8, checks: [back === "move" ? "" : `Shift+Tab lands on “${back}”, not Move`] });
  await close(p);

  // popovers never cover the selection: a target near the top, no room above
  p = await open({ theme, width, height: H });
  await openBar(p);
  await select(p, "#toolbar", 0.5, 0.5);
  for (const [k, area] of [["f", "edit-type"], ["c", "edit-color"]]) {
    await editFocus(p);
    await p.keyboard.press(k); await sleep(250);
    const sel = await p.locator("#toolbar").boundingBox(), pb = await ui(p, ".gm-pop").boundingBox(), tbb = await tb(p).boundingBox();
    const hit = (a, b) => a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    await shot(p, area, "no-room-above", [ui(p, ".gm-pop"), tb(p), p.locator("#toolbar")], { pad: 8, checks: [hit(sel, pb) ? "the popover covers the selection" : "", hit(sel, tbb) ? "the toolbar covers the selection" : ""] });
    await p.keyboard.press("Escape"); await sleep(100);
  }
  await close(p);

  // the bar stays put when the pointer heads for its controls (page tools)
  if (!n) {
    p = await open({ theme, width, height: H, extra: "&hist=1" });
    await openBar(p);
    await p.mouse.move(width / 2, 200); await sleep(100);
    const b0 = await ui(p, ".bar").boundingBox(), qb = await ui(p, ".gm-qbtn").boundingBox();
    // a diagonal approach from up and to the left, the way a hand moves
    await p.mouse.move(qb.x - 160, qb.y - 120); await sleep(50);
    await p.mouse.move(qb.x + qb.width / 2, qb.y + qb.height / 2, { steps: 14 }); await sleep(250);
    const b1 = await ui(p, ".bar").boundingBox();
    await shot(p, "bar", "reach-page-tools", ui(p, ".bar"), { checks: [Math.abs(b1.y - b0.y) > 2 ? "the bar jumped away from a pointer heading for Page tools" : ""] });
    // and for a suggestion chip, straight down through the input row
    const sg = await p.locator(":root > [data-morse-ui]").locator(".sug").nth(1).boundingBox();
    await p.mouse.move(sg.x + sg.width / 2 + 30, sg.y - 150); await sleep(50);
    await p.mouse.move(sg.x + sg.width / 2, sg.y + sg.height / 2, { steps: 12 }); await sleep(250);
    const bs = await ui(p, ".bar").boundingBox();
    await shot(p, "bar", "reach-suggestion", ui(p, ".bar"), { checks: [Math.abs(bs.y - b1.y) > 2 ? "the bar jumped away from a pointer heading for a suggestion" : ""] });
    // pointing at something under the bar still works: a pointer that wanders in over the input
    await p.mouse.move(b1.x + 120, b1.y - 160); await sleep(400);
    await p.mouse.move(b1.x + 140, b1.y + 20, { steps: 3 }); await sleep(700);
    const b2 = await ui(p, ".bar").boundingBox();
    await shot(p, "bar", "dodge-to-point", ui(p, ".bar"), { note: "a quick pass over the input, away from any control: the bar still steps aside so what is under it can be pointed at", checks: [Math.abs(b2.y - b1.y) < 2 ? "the bar no longer steps aside for a pointer passing over it" : ""] });
    await close(p);
  }
}

// ================================================================ round 4
// Show me once, Your style, guards, first run (in the bar and on the
// extension's own pages), and the UI on a page that enforces Trusted Types.

// A search field and a sign-in on the catalog page, for recording typing.
async function addForm(p) {
  await p.evaluate(() => {
    const f = document.createElement("form");
    f.id = "soform";
    f.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    f.onsubmit = e => e.preventDefault();
    f.innerHTML = `<input id="q" aria-label="Search mail" placeholder="Search mail" style="height:32px;padding:0 10px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px">
      <input id="pw" type="password" aria-label="Password" placeholder="Password" style="height:32px;padding:0 10px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px">`;
    document.querySelector("main").prepend(f);
  });
}
const strip = p => ui(p, ".so-strip");
async function clickPage(p, sel) {
  const b = await p.locator(sel).first().boundingBox();
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(120);
}

// ---- Show me once (64-show-once.js)
async function showOnceStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H });
  await addForm(p);
  await openBar(p);
  await p.mouse.move(5, H / 2); await sleep(150);
  await shot(p, "show-once", "entry-chip", ui(p, ".bar"), { note: "the way in: a chip after the suggestions, past a hairline" });
  if (!n) {
    await ui(p, ".so-sug").hover(); await sleep(450);
    await shot(p, "show-once", "entry-chip-hover", ui(p, ".sugs"), { pad: 8 });
    await shot(p, "show-once", "entry-chip-focus", ui(p, ".sugs"), { pad: 8, checks: [await focusVisible(p, ui(p, ".so-sug"))] });
  }
  await ui(p, ".more").click(); await ui(p, ".bmenu").waitFor(); await sleep(200);
  await ui(p, ".bmenu [data-m=showonce]").hover(); await sleep(150);
  await shot(p, "show-once", "menu-item", [ui(p, ".bmenu"), ui(p, ".more")], { pad: 8, note: "Show me once is the first item of the ⋯ menu" });
  await ui(p, ".bmenu [data-m=showonce]").click(); await strip(p).waitFor(); await sleep(400);
  await p.mouse.move(5, 5);
  await shot(p, "show-once", "strip-empty", strip(p), { pad: 16, note: "watching, before the first step; the dot pulses on purpose (recording), still with reduced motion" });
  await clickPage(p, "#toolbar [aria-label=Play]");
  await clickPage(p, "#q"); await p.keyboard.type("invoice", { delay: 10 }); await sleep(100);
  await p.mouse.move(5, 5); await sleep(350);
  await shot(p, "show-once", "strip-steps", strip(p), { pad: 16 });
  await clickPage(p, "#pw"); await p.keyboard.type("correct horse", { delay: 10 }); await sleep(100);
  await p.mouse.move(5, 5); await sleep(350);
  await shot(p, "show-once", "strip-hidden", strip(p), { pad: 16, note: "a password: the step is kept, the value never is" });
  for (const s of ["#toolbar [aria-label=Next]", "#toolbar [aria-label=Previous]", "#long"]) await clickPage(p, s);
  await p.mouse.move(5, 5); await sleep(350);
  await shot(p, "show-once", "strip-many", strip(p), { pad: 16, note: "the four newest steps, and how many came before" });
  if (!n) {
    await strip(p).locator("li.so-last").hover(); await sleep(200);
    await shot(p, "show-once", "strip-remove-hover", strip(p), { pad: 16 });
    await shot(p, "show-once", "strip-remove-focus", strip(p), { pad: 16, checks: [await focusVisible(p, strip(p).locator("li.so-last .so-rm"))] });
    await shot(p, "show-once", "strip-stop-focus", strip(p), { pad: 16, checks: [await focusVisible(p, strip(p).locator("[data-so=stop]"))] });
    await blur(p);
  }
  await shadowEval(p, r => r.querySelector(".so-strip").classList.add("top")); await p.mouse.move(5, H - 5); await sleep(200);
  await shot(p, "show-once", "strip-top", strip(p), { pad: 16, note: "moved to the top when what you're about to click is under it" });
  await strip(p).locator("[data-so=stop]").click();
  await ui(p, ".so-card").waitFor(); await sleep(400);
  await ui(p, ".so-card .eyebrow, .so-card header").first().hover(); await sleep(150);
  await shot(p, "show-once", "steps-in-bar", ui(p, ".bar"), { note: "after Stop: the steps above the input, and chips for what people usually want" });
  if (!n) {
    await shot(p, "show-once", "steps-forget-focus", ui(p, ".so-card header"), { pad: 8, checks: [await focusVisible(p, ui(p, ".so-card [data-so=forget]"))] });
    await shot(p, "show-once", "steps-again-focus", ui(p, ".so-card header"), { pad: 8, checks: [await focusVisible(p, ui(p, ".so-card [data-so=again]"))] });
  }
  await submit(p, "add a button to the toolbar that does these steps");
  await stream(p, 12, 25);
  await shot(p, "show-once", "working", ui(p, ".bar"), { note: "working: the steps fold away (they still go along)" });
  await finish(p, OK({ title: "Archive button", css: "", js: "morse.el('button')" }));
  await shot(p, "show-once", "result", ui(p, ".bar"));
  await close(p);

  // errors: the model failed; Stop with nothing recorded; cancelled
  p = await open({ theme, width, height: H });
  await openBar(p);
  await ui(p, ".so-sug").click(); await strip(p).waitFor(); await sleep(300);
  await clickPage(p, "#toolbar [aria-label=Play]");
  await strip(p).locator("[data-so=stop]").click(); await ui(p, ".so-card").waitFor(); await sleep(300);
  await shot(p, "show-once", "steps-one", ui(p, ".bar"), { note: "one step: no remove button (Forget is the way out)" });
  await submit(p, "do these steps when I press Ctrl+Shift+P");
  await finish(p, { ok: false, error: LONG_ERROR });
  await shot(p, "show-once", "error", ui(p, ".bar"));
  await p.keyboard.press("Escape"); await sleep(200);
  if (await ui(p, ".bar").isVisible()) { await p.keyboard.press("Escape"); await sleep(200); }
  await toastGone(p);
  await openBar(p);
  await ui(p, ".so-sug").click(); await strip(p).waitFor(); await sleep(300);
  await strip(p).locator("[data-so=stop]").click(); await sleep(400);
  await shot(p, "show-once", "stopped-empty-toast", ui(p, ".toast"), { pad: 16 });
  await toastGone(p);
  await openBar(p);
  await ui(p, ".so-sug").click(); await strip(p).waitFor(); await sleep(300);
  await clickPage(p, "#toolbar [aria-label=Next]");
  await p.keyboard.press("Escape"); await sleep(400);
  await shot(p, "show-once", "cancelled-toast", ui(p, ".toast"), { pad: 16 });
  await close(p);
}

// ---- Your style (72-style.js)
async function styleStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  // the live review in the bar
  let p = await open({ theme, width, height: H, extra: "&style=plain" });
  await openBar(p);
  await ui(p, ".in").fill("Georgia font, bigger text and underline links everywhere except figma");
  await ui(p, ".in").press("Enter");
  await ui(p, ".ys-sheet").waitFor({ timeout: 6000 }); await sleep(300);
  await shot(p, "style", "review", ui(p, ".bar"), { note: "“…everywhere”: shown live, with Save and Undo; except figma is a note" });
  if (!n) await shot(p, "style", "review-save-focus", ui(p, ".actions"), { pad: 8, checks: [await focusVisible(p, ui(p, "[data-a=ys-save]"))] });
  await ui(p, "[data-a=ys-undo]").click(); await sleep(400);
  await shot(p, "style", "review-undone-toast", ui(p, ".toast"), { pad: 16 });
  await toastGone(p);
  await openBar(p);
  await ui(p, ".in").fill("bigger text everywhere and make headings less shouty");
  await ui(p, ".in").press("Enter");
  await ui(p, ".ys-sheet").waitFor({ timeout: 6000 }); await sleep(300);
  await shot(p, "style", "review-fit-switch", ui(p, ".bar"), { note: "something only the model can do: fit it per site, switch on" });
  await ui(p, "[data-a=ys-undo]").click(); await sleep(300); await toastGone(p);
  await openBar(p);
  await ui(p, ".in").fill("a nicer font everywhere");
  await ui(p, ".in").press("Enter");
  await ui(p, ".ys-sheet").waitFor({ timeout: 6000 }); await sleep(300);
  await shot(p, "style", "review-which-font", ui(p, ".bar"), { note: "a font without a name: says how to name it" });
  await close(p);

  // the Mods panel row: on, off everywhere, off here, fitted
  for (const kind of ["1", "off", "except", "fitted"]) {
    p = await open({ theme, width, height: H, mods: 1, extra: `&style=${kind}` });
    await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel .ys-row").waitFor(); await sleep(300); await p.mouse.move(2, 2);
    const name = { 1: "row-on", off: "row-off", except: "row-not-here", fitted: "row-fitted" }[kind];
    await shot(p, "style", name, ui(p, ".ys-row"), { pad: 8 });
    if (kind === "1") {
      await shot(p, "style", "panel", ui(p, ".panel"), { note: "Your style sits above this site's own mods" });
      if (!n) {
        await ui(p, ".ys-row [data-y=not-here]").hover(); await sleep(150);
        await shot(p, "style", "row-button-hover", ui(p, ".ys-row"), { pad: 8 });
        await shot(p, "style", "row-fit-focus", ui(p, ".ys-row"), { pad: 8, checks: [await focusVisible(p, ui(p, ".ys-row [data-y=fit]"))] });
        await shot(p, "style", "row-switch-focus", ui(p, ".ys-row"), { pad: 8, checks: [await focusVisible(p, ui(p, ".ys-row .sw input"))] });
        await blur(p);
      }
      // Not on this site, with Undo
      await ui(p, ".ys-row [data-y=not-here]").click(); await ui(p, ".ctl-toast").waitFor({ timeout: 4000 }); await sleep(300);
      await shot(p, "style", "not-here-toast", ui(p, ".ctl-toast"), { pad: 16, note: "off on this site, with Undo" });
      await shot(p, "style", "row-after-not-here", ui(p, ".ys-row"), { pad: 8 });
      await ui(p, ".ctl-toast button").first().click(); await sleep(500);
      await ui(p, ".ctl-toast").waitFor({ timeout: 3000 }).catch(() => {});
      await shot(p, "style", "back-on-toast", ui(p, ".ctl-toast"), { pad: 16 });
      // the switch: off everywhere, with Undo
      await ui(p, ".ys-row .sw").click(); await sleep(500);
      await shot(p, "style", "off-everywhere-toast", ui(p, ".ctl-toast"), { pad: 16 });
    }
    await close(p);
  }

  // Settings: Your style, block by block, and the sites list
  p = await open({ theme, width, height: H, mods: 1, extra: "&style=1" });
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel .ys-row").waitFor(); await sleep(200);
  await ui(p, ".ys-row [data-y=change]").click();
  await ui(p, ".pane [data-ys-sec]").waitFor(); await sleep(500); await blur(p); await p.mouse.move(2, 2);
  const sec = ui(p, ".pane [data-ys-sec]");
  const rowAt = async (sel, state, note) => {
    const r = ui(p, `.pane [data-ys-sec] ${sel}`);
    await r.evaluate(el => el.scrollIntoView({ block: "start" })); await sleep(150);
    await shot(p, "style", state, ui(p, ".pane"), { pad: 0, note });
  };
  await rowAt("h4", "settings-top", "Your style, its words, font, text size, space between lines");
  await rowAt(".srow:has([data-ys=soft])", "settings-switches", "the switches, each with one line of help");
  await rowAt(".srow:has([data-ys=adapt])", "settings-sites", "fit per site, the sites and apps it skips, start over");
  if (!n) {
    await shot(p, "style", "settings-font-focus", ui(p, ".pane .srow:has([data-ys=font])"), { pad: 4, checks: [await focusVisible(p, ui(p, ".pane [data-ys=font]"))] });
    await shot(p, "style", "settings-size-focus", ui(p, ".pane .srow:has([data-ys^='size:'])"), { pad: 4, checks: [await focusVisible(p, ui(p, ".pane [data-ys='size:2']"))] });
    await shot(p, "style", "settings-chip-focus", ui(p, ".pane .ys-except"), { pad: 4, checks: [await focusVisible(p, ui(p, ".pane .ys-chip .x"))] });
    await blur(p);
  }
  await ui(p, ".pane [data-ys=add-except]").fill("notion.so");
  await ui(p, ".pane [data-ys=add-except]").press("Enter"); await sleep(600);
  await ui(p, ".pane .ys-except").evaluate(el => el.scrollIntoView({ block: "center" })); await sleep(150);
  await shot(p, "style", "settings-site-added", ui(p, ".pane .ys-except"), { pad: 4 });
  for (let i = 0; i < 4; i++) {
    const x = ui(p, ".pane .ys-chip .x");
    if (!(await x.count())) break;
    await x.click(); await sleep(450);
  }
  await ui(p, ".pane .ys-except").evaluate(el => el.scrollIntoView({ block: "center" })); await sleep(150); await blur(p);
  await shot(p, "style", "settings-no-sites", ui(p, ".pane .ys-except"), { pad: 4, note: "none: it runs everywhere" });
  await close(p);
  // Settings before there is a style
  p = await open({ theme, width, height: H, extra: "&style=plain" });
  await openBar(p);
  await p.keyboard.press("Control+Comma"); await sleep(400);
  await ui(p, ".pane [data-ys-sec]").evaluate(el => el.scrollIntoView({ block: "start" })); await sleep(150); await blur(p);
  await shot(p, "style", "settings-none", ui(p, ".pane"), { pad: 0, note: "no style yet: Set up…" });
  await close(p);

  // fit to this site: the model's fix, for review
  p = await open({ theme, width, height: H, mods: 1, extra: "&style=1" });
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel .ys-row").waitFor(); await sleep(200);
  await ui(p, ".ys-row [data-y=fit]").click();
  await p.waitForFunction(() => globalThis.__cat.gen, null, { timeout: 6000 });
  await stream(p, 10, 25);
  await shot(p, "style", "fit-working", ui(p, ".bar"));
  await finish(p, OK({ title: `Your style for ${new URL(BASE).host}`, css: ".app { max-width: 100vw }" }));
  await shot(p, "style", "fit-review", ui(p, ".bar"), { note: "the fix is a mod for this site that belongs to Your style; the meta says so" });
  await close(p);
}

// ---- guards (64-guard.js)
async function guardStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H, extra: "&guard=1" });
  await ui(p, ".ctl-toast").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300);
  await shot(p, "guard", "froze-toast", ui(p, ".ctl-toast"), { pad: 16, note: "on the next load after a mod froze the page" });
  await ui(p, ".ctl-toast").evaluate(el => (el.hidden = true));
  await p.evaluate(() => document.dispatchEvent(new CustomEvent("morse:paused", { detail: JSON.stringify({ id: "mod43" }) })));
  await ui(p, ".ctl-toast").waitFor({ timeout: 4000 }); await sleep(300);
  await shot(p, "guard", "paused-toast", ui(p, ".ctl-toast"), { pad: 16, note: "the kit paused a mod: why, Turn back on, Fix it" });
  if (!n) await shot(p, "guard", "paused-toast-focus", ui(p, ".ctl-toast"), { pad: 16, checks: [await focusVisible(p, ui(p, ".ctl-toast button"))] });
  await ui(p, ".ctl-toast").evaluate(el => (el.hidden = true));
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(400); await p.mouse.move(2, 2);
  for (const [id, state] of [["mod40", "row-slowing"], ["mod41", "row-froze"], ["mod42", "row-hid"], ["mod43", "row-slowing-now"]]) {
    const row = ui(p, `article[data-id=${id}]`);
    await row.scrollIntoViewIfNeeded().catch(() => {}); await sleep(100);
    await shot(p, "guard", state, row, { pad: 8 });
  }
  if (!n) {
    const row = ui(p, "article[data-id=mod40]");
    await row.scrollIntoViewIfNeeded(); await ui(p, "article[data-id=mod40] [data-a=guard-on]").hover(); await sleep(150);
    await shot(p, "guard", "row-turn-on-hover", row, { pad: 8 });
    await shot(p, "guard", "row-fix-focus", row, { pad: 8, checks: [await focusVisible(p, ui(p, "article[data-id=mod40] [data-a=guard-fix]"))] });
  }
  await ui(p, "article[data-id=mod42] [data-a=guard-on]").click(); await sleep(600);
  await ui(p, ".ctl-toast").waitFor({ timeout: 3000 }).catch(() => {});
  await shot(p, "guard", "back-on-toast", ui(p, ".ctl-toast"), { pad: 16 });
  await close(p);

  // refusals in the bar: code that would obviously break the page never runs (core/guard.js)
  const REFUSE = [
    ["hide", "The change would have hidden this whole page, so Morse didn't run it. Try other words."],
    ["loop", "The change would have frozen this page, so Morse didn't run it. Try other words."],
    ["wipe", "The change would have replaced this whole page, so Morse didn't run it. Try other words."],
    ["nav", "The change would have reloaded or left this page, so Morse didn't run it. Try other words."],
  ];
  p = await open({ theme, width, height: H });
  for (const [k, error] of n ? REFUSE.slice(0, 2) : REFUSE) {
    await openBar(p); await pick(p, "#card");
    await submit(p, "hide everything except the article");
    await finish(p, { ok: false, error });
    await shot(p, "guard", `refused-${k}`, ui(p, ".bar"));
    await p.keyboard.press("Escape"); await sleep(150);
    if (await ui(p, ".bar").isVisible()) { await p.keyboard.press("Escape"); await sleep(250); }
    await toastGone(p);
  }
  // the change in the bar slowed the page down after it showed
  await openBar(p); await pick(p, "#card");
  await submit(p, "highlight new messages");
  await finish(p, OK({ js: "morse.watch('.msg', m => {})" }));
  await p.evaluate(() => { __cat.slow = { draft: { why: "loop", at: new Date().toISOString() } }; document.dispatchEvent(new CustomEvent("morse:paused", { detail: JSON.stringify({ id: "draft" }) })); });
  await ui(p, ".ctl-toast").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300);
  await shot(p, "guard", "draft-paused-toast", [ui(p, ".ctl-toast"), ui(p, ".bar")], { pad: 12, note: "a change still in the bar: nothing to turn off, so it says to describe it another way" });
  await close(p);
}

// ---- first run, in the bar (59-onboarding.js): the coach, notes, progressive reveal, the first-save card
async function firstRunStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H, extra: "&onboard=new" });
  await openBar(p);
  await p.mouse.move(5, H / 2); await sleep(200);
  await shot(p, "first-run", "coach-point", ui(p, ".bar"), { note: "a new user's bar: the three steps, and only the basics (no Page tools, no Show me once yet)" });
  await pick(p, "#card");
  await shot(p, "first-run", "coach-describe", ui(p, ".bar"), { note: "pointed: suggestions for what was picked; no Edit tools pop up yet" });
  if (!n) await shot(p, "first-run", "coach-hide-focus", ui(p, ".ob-coach"), { pad: 8, checks: [await focusVisible(p, ui(p, ".ob-hide"))] });
  await submit(p, "make this easier to read");
  await stream(p, 8, 25);
  await shot(p, "first-run", "coach-working", ui(p, ".bar"));
  await finish(p, OK({ title: "Easier to read" }));
  await shot(p, "first-run", "coach-keep", ui(p, ".bar"));
  await ui(p, "[data-a=keep]").click();
  await ui(p, ".ob-win").waitFor({ timeout: 6000 }); await sleep(1600); // past the mark settling into a check
  await shot(p, "first-run", "first-save-card", ui(p, ".ob-win"), { pad: 16, note: "the first saved change: a card instead of the toast; it names what is new in the bar" });
  if (!n) await shot(p, "first-run", "first-save-share-focus", ui(p, ".ob-win"), { pad: 16, checks: [await focusVisible(p, ui(p, ".ob-win [data-win=share]"))] });
  await ui(p, ".ob-win [data-win=done]").click(); await sleep(200);
  await openBar(p);
  await p.mouse.move(5, H / 2); await sleep(200);
  await shot(p, "first-run", "revealed", ui(p, ".bar"), { note: "after the first save: Page tools and Show me once are in the bar now" });
  await close(p);

  for (const [kind, state] of [["nomodel", "note-no-model"], ["noscripts", "note-user-scripts"]]) {
    p = await open({ theme, width, height: H, extra: `&onboard=${kind}` });
    await openBar(p); await p.mouse.move(5, H / 2); await sleep(200);
    await shot(p, "first-run", state, ui(p, ".bar"));
    if (!n && kind === "nomodel") await shot(p, "first-run", `${state}-close-focus`, ui(p, ".ob-note"), { pad: 8, checks: [await focusVisible(p, ui(p, ".ob-note .ob-close"))] });
    await close(p);
  }
  p = await open({ theme, width, height: H, extra: "&onboard=done" });
  await openBar(p); await pick(p, "#card");
  await submit(p, "make this easier to read");
  await finish(p, { ok: false, error: "Can't reach the Morse helper at 127.0.0.1:7457" });
  await shot(p, "first-run", "error-with-action", ui(p, ".bar"), { note: "an error in plain words, with a button that does something about it" });
  await close(p);
}

// ---- first run on the extension's own pages: the real built extension,
// headful under Xvfb (DISPLAY), with the replies about the model stubbed so
// each state comes out the same every time (no helper on 7457 needed).
const PARTS = new Set(String(args.ext || "popup").split(",")); // the welcome page is welcomeStates (onboarding v2)
const extCtxs = []; // the extension's own browsers: closed (and their profiles removed) if a flow fails
async function extensionStates() {
  if (!process.env.DISPLAY) { console.warn("  ! extension pages need DISPLAY (Xvfb :99)"); return; }
  const os = await import("node:os");
  const EXT = path.join(ROOT, "dist", "extension");
  const STATES = {
    waiting: { kind: "none", helper: null, label: "", reason: "" },
    found: { kind: "none", helper: { paired: false, pairing: false, label: "Claude Code", provider: "claude-code" }, label: "", reason: "" },
    wrong: { kind: "none", helper: { paired: false, pairing: true, label: "Claude Code", provider: "claude-code" }, label: "", reason: "", pairFails: true },
    nomodel: { kind: "none", helper: { paired: true, pairing: false, label: "No model", provider: "none" }, label: "", reason: "" },
    connected: { kind: "helper", helper: { paired: true, label: "Claude Code", provider: "claude-code" }, label: "Claude Code · sonnet", reason: "" },
  };
  const stub = ([st, scripts]) => {
    if (location.protocol !== "chrome-extension:" || !globalThis.chrome?.runtime?.sendMessage) return;
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    const base = { userScripts: scripts, backend: "", providers: {}, helperModel: "", anthropicModels: ["claude-sonnet-4-5"], anthropicModel: "claude-sonnet-4-5", mods: [] };
    const connected = st.kind !== "none";
    chrome.runtime.sendMessage = async m => {
      if (m?.type === "popup.state") return { ...base, ...st };
      if (m?.type === "popup.pair") return st.pairFails || m.code === "ZZZZZZ" ? { error: "That code doesn't match the one the Morse helper shows. Check it and try again." } : { ...base, ...st };
      if (m?.type === "popup.save") return { error: "The key was refused: invalid x-api-key" };
      if (m?.type === "onboarding.status") return { state: {}, status: { model: { connected }, userScripts: scripts, mods: 0 } };
      return real(m);
    };
  };
  const launch = async (theme, width, height, st, scripts = true) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "morse-ui-ext-"));
    const ctx = await chromium.launchPersistentContext(dir, {
      headless: false, viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
    });
    const shut = ctx.close.bind(ctx);
    ctx.close = async () => { await shut().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }; // a profile is ~8MB: never leave one behind
    extCtxs.push(ctx);
    await ctx.addInitScript(stub, [st, scripts]);
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
    const id = sw.url().split("/")[2];
    // the welcome page the install opened: closed, it is opened again with the stub in place
    await sleep(800);
    for (const pg of ctx.pages()) if (pg.url().includes("welcome.html")) await pg.close();
    return { ctx, id };
  };
  const extShot = async (page, area, state, theme, target, opts = {}) => {
    const vp = page.viewportSize();
    let clip = { x: 0, y: 0, width: vp.width, height: vp.height };
    if (target) {
      // in page coordinates, so a part below the fold (the checklist under the practice page at 390px) is shot whole
      await target.scrollIntoViewIfNeeded().catch(() => {});
      const b = await target.boundingBox(), sy = await page.evaluate(() => scrollY);
      const pad = opts.pad ?? 12;
      const x = Math.max(0, b.x - pad), y = Math.max(0, b.y + sy - pad);
      clip = { x, y, width: Math.min(vp.width - x, b.width + 2 * pad), height: b.height + 2 * pad };
    }
    const name = `${state}${vp.width < 600 && area !== "popup" ? "-narrow" : ""}-${theme}`;
    const file = path.join(OUT, area, `${name}.png`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await page.screenshot(opts.full && !target ? { path: file, fullPage: true } : { path: file, clip, fullPage: !!target });
    const issues = (await page.evaluate(() => {
      const out = [], W = innerWidth;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
        if (r.right > W + 0.5 && cs.position !== "fixed") out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} sticks out of the page (${Math.round(r.right)} > ${W})`);
        const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (text && el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(cs.overflowX) && cs.textOverflow !== "ellipsis") out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} clips its text`);
      }
      if (document.documentElement.scrollWidth > W + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
      return out.slice(0, 6);
    })).concat((opts.checks || []).filter(Boolean));
    // axe-core on the whole extension page (demo/axe.js), every rule
    if (!args["no-axe"]) {
      const found = await axeCheck(page, { page: true }).catch(e => [{ id: "axe-failed", impact: "critical", help: e.message.split("\n")[0], targets: [] }]);
      for (const v of found) axeTally.set(v.id, (axeTally.get(v.id) || 0) + 1);
      issues.push(...axeLines(found));
    }
    results.push({ area, state: name, theme, file: path.relative(OUT, file), issues, note: opts.note || "" });
    console.log(`  ${issues.length ? "!" : "✓"} ${area}/${name}${issues.length ? "  " + issues.join(" | ") : ""}`);
  };
  for (const theme of ["dark", "light"]) {
    // the popup: no model; a page Morse can't run on; user scripts off
    for (const [state, st, url, scripts] of [["no-model", STATES.waiting, "https://thedailybyte.news/", true], ["chrome-page", STATES.connected, "chrome://settings/", true],
      ["store-page", STATES.connected, "https://chromewebstore.google.com/detail/x", true], ["user-scripts-off", STATES.connected, "https://thedailybyte.news/", false], ["ready", STATES.connected, "https://thedailybyte.news/", true]].filter(() => PARTS.has("popup"))) {
      const { ctx, id } = await launch(theme, 380, 640, st, scripts);
      const pg = await ctx.newPage();
      await pg.goto(`chrome-extension://${id}/popup.html?url=${encodeURIComponent(url)}`); await sleep(900);
      await extShot(pg, "popup", `first-run-${state}`, theme, pg.locator("body"), { pad: 0 });
      if (state === "no-model") await extShot(pg, "popup", "first-run-model", theme, pg.locator("#model"), { pad: 8 });
      await ctx.close();
    }
  }
}

// ---- Trusted Types: the same UI, built without innerHTML (00-trusted-html.js)
// Two PNGs, pixel by pixel: { bad, total } or { size } when they differ in size.
async function pixelDiff(a, b) {
  const pg = await browser.newPage();
  const r = await pg.evaluate(async ([a, b]) => {
    const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return { size: `${x.width}×${x.height} vs ${y.width}×${y.height}` };
    const px = img => { const c = new OffscreenCanvas(img.width, img.height), g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    const p = px(x), q = px(y);
    let bad = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2] || p[i + 3] !== q[i + 3]) bad++;
    return { bad, total: p.length / 4 };
  }, [a, b].map(f => "data:image/png;base64," + readFileSync(f).toString("base64")));
  await pg.close();
  return r;
}

async function trustedTypesStates() {
  const diff = pixelDiff;
  for (const theme of ["dark", "light"]) {
    for (const width of [1100, 390]) {
      const n = width < 600, H = n ? 844 : 720;
      const files = {};
      for (const tt of [false, true]) {
        const p = await open({ theme, width, height: H, mods: 12, extra: tt ? "&tt=1" : "" });
        // (innerHTML is the runtime's own builder on such a page; a script's text is a sink it leaves alone)
        const enforced = await p.evaluate(() => { try { document.createElement("script").text = "0"; return false; } catch { return !!globalThis.__morseTrustedHtml; } });
        const tag = tt ? "tt" : "plain";
        // only how the UI is built may differ: no transition or caret blink caught halfway (a style element's text is no sink)
        await shadowEval(p, r => { const st = document.createElement("style"); st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }"; r.append(st); });
        await openBar(p); await p.mouse.move(5, H / 2); await sleep(200); await blur(p);
        await shot(p, "trusted-types", `bar-${tag}`, ui(p, ".bar"), { checks: [tt && !enforced ? "the page does not enforce Trusted Types" : ""] });
        await select(p, "#card", 0.3, 0.6); await p.mouse.move(5, H / 2); await sleep(300); await blur(p);
        await shot(p, "trusted-types", `toolbar-${tag}`, [ui(p, ".gm-tb"), ui(p, ".gm-frame")], { pad: 12 });
        await p.keyboard.press("Escape"); await sleep(150);
        if (await ui(p, ".bar").isVisible()) { await p.keyboard.press("Escape"); await sleep(200); }
        await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(400); await p.mouse.move(2, 2); await blur(p);
        await shot(p, "trusted-types", `panel-${tag}`, ui(p, ".panel"));
        await p.keyboard.press("Escape"); await sleep(200);
        await openBar(p); await p.keyboard.press("Control+Comma"); await sleep(400); await blur(p); await p.mouse.move(5, H / 2); await sleep(150);
        await shot(p, "trusted-types", `settings-${tag}`, ui(p, ".bar"));
        for (const k of ["bar", "toolbar", "panel", "settings"]) (files[k] ||= []).push(path.join(OUT, "trusted-types", `${k}-${tag}${n ? "-narrow" : ""}-${theme}.png`));
        await close(p);
      }
      for (const [k, [a, b]] of Object.entries(files)) {
        const d = await diff(a, b);
        const same = d.bad === 0;
        const r = results.find(x => x.file === path.relative(OUT, b));
        if (r) {
          r.note = same ? `pixel-identical to ${k}-plain (${d.total} pixels compared)` : "";
          if (!same) r.issues.push(d.size ? `size differs from the normal page: ${d.size}` : `${d.bad} of ${d.total} pixels differ from the normal page`);
        }
        console.log(`  ${same ? "✓" : "!"} trusted-types/${k}${n ? "-narrow" : ""}-${theme}: ${same ? "identical" : JSON.stringify(d)}`);
      }
    }
  }
}

// ---- the round 4 features on the hostile hosts
async function hostileR4States() {
  for (const [site, url] of [["hostile", "/demo/sites/hostile/"], ["parley", "/demo/sites/parley/"]]) {
    let p = await open({ url, mods: 1, width: 1100, height: 720, extra: "&style=1&guard=1" });
    try {
      await ui(p, ".ctl-toast").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300);
      await shot(p, "hostile", `${site}-guard-toast`, ui(p, ".ctl-toast"), { pad: 16 });
      await ui(p, ".ctl-toast").evaluate(el => (el.hidden = true));
      await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(400); await p.mouse.move(2, 2);
      await shot(p, "hostile", `${site}-style-row`, ui(p, ".ys-row"), { pad: 8 });
      const row = ui(p, "article[data-id=mod41]");
      await row.scrollIntoViewIfNeeded(); await sleep(100);
      await shot(p, "hostile", `${site}-guard-row`, row, { pad: 8 });
      // round 5: Your style's softer colors must not reach the overlay. The same row
      // on the same page without the style, pixel by pixel (the --m-danger dot included)
      {
        const q = await open({ url, mods: 1, width: 1100, height: 720, extra: "&guard=1" });
        await ui(q, ".ctl-toast").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300);
        await ui(q, ".ctl-toast").evaluate(el => (el.hidden = true)).catch(() => {});
        await q.keyboard.press("Alt+Shift+KeyM"); await ui(q, ".panel").waitFor(); await sleep(400); await q.mouse.move(2, 2);
        const qrow = ui(q, "article[data-id=mod41]");
        await qrow.scrollIntoViewIfNeeded(); await sleep(100);
        await shot(q, "hostile", `${site}-guard-row-plain`, qrow, { pad: 8, note: "the same row without Your style" });
        await close(q);
        const theme = results.at(-1).theme;
        const a = path.join(OUT, "hostile", `${site}-guard-row-plain-${theme}.png`), b = path.join(OUT, "hostile", `${site}-guard-row-${theme}.png`);
        const d = await pixelDiff(a, b);
        const r = results.find(x => x.file === path.relative(OUT, b));
        if (r && !d.bad && !d.size) r.note = `Your style (softer colors) is on: pixel-identical to ${site}-guard-row-plain (${d.total} pixels compared)`;
        else if (r) r.issues.push(d.size ? `size differs from the row without Your style: ${d.size}` : `${d.bad} of ${d.total} pixels differ from the row without Your style`);
        console.log(`  ${d.bad || d.size ? "!" : "✓"} hostile/${site}-guard-row vs plain: ${JSON.stringify(d)}`);
      }
      await p.keyboard.press("Escape"); await sleep(200);
      await openBar(p);
      await ui(p, ".so-sug").click(); await strip(p).waitFor(); await sleep(300);
      await p.mouse.click(300, 300); await sleep(150); await p.mouse.move(2, 2); await sleep(300);
      await shot(p, "hostile", `${site}-show-once-strip`, strip(p), { pad: 16 });
      await strip(p).locator("[data-so=stop]").click(); await sleep(400);
      if (await ui(p, ".so-card").isVisible()) await shot(p, "hostile", `${site}-show-once-steps`, ui(p, ".bar"));
    } catch (e) {
      await shot(p, "hostile", `${site}-r4-broken`, null, { checks: [`flow failed: ${e.message.split("\n")[0]}`] });
    }
    await close(p);
  }
}

// ---- round 5: mods waiting for “Allow User Scripts” (64-waiting.js)
async function waitingStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  let p = await open({ theme, width, height: H, mods: 1, extra: "&waiting=1&onboard=done" });
  await p.evaluate(() => sessionStorage.removeItem("morse:waiting-told"));
  // the notice, once per site in this tab
  await ui(p, ".ctl-toast").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300);
  await shot(p, "waiting", "notice", ui(p, ".ctl-toast"), { pad: 16, note: "once per site in a tab: which mod waits, what already shows, and Open Morse's details" });
  if (!n) await shot(p, "waiting", "notice-focus", ui(p, ".ctl-toast"), { pad: 16, checks: [await focusVisible(p, ui(p, ".ctl-toast [data-i='1']"))] });
  await ui(p, ".ctl-toast").evaluate(el => (el.hidden = true));
  // the bar's note under the input
  await openBar(p); await p.mouse.move(5, H / 2); await sleep(200);
  await shot(p, "waiting", "bar-note", ui(p, ".bar"), { note: "the bar's note: the same words, Turn it on, and × (for this page)" });
  if (!n) await shot(p, "waiting", "bar-note-focus", ui(p, ".ob-note"), { pad: 8, checks: [await focusVisible(p, ui(p, ".ob-note .btn"))] });
  await p.keyboard.press("Escape"); await sleep(200);
  // the Mods panel: a tag on the mod
  await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(400); await p.mouse.move(2, 2);
  await blur(p);
  await shot(p, "waiting", "panel-row", ui(p, ".list article").first(), { pad: 8, note: "the tag on the mod: waits for “Allow User Scripts” (the full sentence is its title)" });
  await p.keyboard.press("Escape"); await sleep(200);
  // a new change whose code waits: the result says so and offers the one click
  await openBar(p); await pick(p, "#card");
  await submit(p, "add a button that copies the title");
  await finish(p, OK({ title: "Copy the title", js: "morse.el('button')", waiting: "userScripts" }));
  await p.mouse.move(5, H / 2); await sleep(150);
  await shot(p, "waiting", "result", ui(p, ".bar"), { note: "the result never just looks done: the note, and Turn on “Allow User Scripts” first" });
  await close(p);
  // the practice page: what it adds works only on real websites
  p = await open({ theme, width, height: H, mods: 0 });
  await openBar(p); await pick(p, "#card");
  await submit(p, "add a button that copies the title");
  await finish(p, OK({ title: "Copy the title", js: "morse.el('button')", waiting: "practice" }));
  await p.mouse.move(5, H / 2); await sleep(150);
  await shot(p, "waiting", "result-practice", ui(p, ".bar"), { note: "on the practice page: this is how it looks, and what it adds works on real websites" });
  await close(p);
}

// ---- round 5: the overlay in German (long words) and Persian (right to left), core/i18n.js
async function i18nStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  for (const lang of ["de", "fa"]) {
    let p = await open({ theme, width, height: H, mods: 1, extra: `&lang=${lang}` });
    await openBar(p); await p.mouse.move(5, H / 2); await sleep(200);
    const dir = await p.evaluate(() => document.querySelector(":root > [data-morse-ui]").dir);
    const rtl = lang === "fa" ? (dir === "rtl" ? "" : "Persian is not laid out right to left") : (dir === "ltr" ? "" : "German is laid out right to left");
    await shot(p, "i18n", `${lang}-bar`, ui(p, ".bar"), { checks: [rtl], note: `${lang}: the empty bar, suggestions and hint` });
    await pick(p, "#long");
    await ui(p, ".in").fill(lang === "de" ? "Mach die Wiedergabeliste übersichtlicher und zeig die Gesamtdauer" : "فهرست پخش را مرتب‌تر کن و مدت کل را نشان بده");
    await shot(p, "i18n", `${lang}-typing`, ui(p, ".bar"));
    await ui(p, ".in").press("Enter"); await p.waitForFunction(() => globalThis.__cat.gen); await sleep(100);
    await p.evaluate(() => __cat.stage("reading")); await sleep(100);
    await shot(p, "i18n", `${lang}-working`, ui(p, ".bar"), { note: "a status stage in this language" });
    await finish(p, OK({ title: lang === "de" ? "Übersichtlichere Wiedergabeliste" : "فهرست پخش مرتب‌تر" }));
    await p.mouse.move(5, H / 2); await sleep(150);
    await shot(p, "i18n", `${lang}-result`, ui(p, ".bar"), { note: "the result: title, timing, Save Undo Edit code Share" });
    await ui(p, "[data-a=undo]").click(); await ui(p, ".bar").waitFor({ state: "hidden" });
    await openBar(p); await pick(p, "#card");
    await submit(p, "x");
    await finish(p, { ok: false, error: LONG_ERROR });
    await p.mouse.move(5, H / 2); await sleep(150);
    await shot(p, "i18n", `${lang}-error`, ui(p, ".bar"));
    await p.keyboard.press("Escape"); await sleep(150);
    if (await ui(p, ".bar").isVisible()) { await p.keyboard.press("Escape"); await sleep(200); }
    // settings: the top (Language, Your style, shortcuts) and the bottom
    await openBar(p); await p.keyboard.press("Control+Comma"); await sleep(400); await blur(p); await p.mouse.move(5, H / 2); await sleep(150);
    await shot(p, "i18n", `${lang}-settings`, ui(p, ".bar"), { note: "Settings: the Language row says “Language” in English too, so a mistake can be undone" });
    await ui(p, ".pane").evaluate(e => { e.scrollTop = e.scrollHeight; }); await sleep(200);
    await shot(p, "i18n", `${lang}-settings-bottom`, ui(p, ".bar"));
    await p.keyboard.press("Escape"); await sleep(150);
    if (await ui(p, ".bar").isVisible()) { await p.keyboard.press("Escape"); await sleep(200); }
    await openBar(p); await ui(p, ".more").click(); await sleep(200);
    await shot(p, "i18n", `${lang}-menu`, [ui(p, ".bmenu"), ui(p, ".more")], { pad: 8 });
    await close(p);
    // the Mods panel, with twelve mods (long titles, a broken one, off ones)
    p = await open({ theme, width, height: H, mods: 12, extra: `&lang=${lang}` });
    await ui(p, ".ctl-toast").waitFor({ timeout: 3000 }).catch(() => {}); await ui(p, ".ctl-toast").evaluate(el => (el.hidden = true)).catch(() => {});
    await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(400); await p.mouse.move(2, 2); await blur(p);
    await shot(p, "i18n", `${lang}-panel`, ui(p, ".panel"));
    await shot(p, "i18n", `${lang}-panel-row`, p.locator(":root > [data-morse-ui]").locator(".list article").nth(1), { pad: 8 });
    await ui(p, ".list").evaluate(l => { l.scrollTop = l.scrollHeight; }); await sleep(150);
    await shot(p, "i18n", `${lang}-panel-foot`, [ui(p, ".ctl-backup"), ui(p, ".panel footer")], { pad: 4 });
    await close(p);
  }
}

// ---- round 5: mod packs (69-packs.js), with the real core/pack-host.js in the fake host
async function packStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  const p = await open({ theme, width, height: H, mods: 12, extra: "&packs=1" });
  // (the fixture's broken mod says so in a toast: out of the way of the panel)
  await ui(p, ".ctl-toast").waitFor({ timeout: 3000 }).catch(() => {}); await ui(p, ".ctl-toast").evaluate(el => (el.hidden = true)).catch(() => {});
  const card = ui(p, ".modal .card");
  const openPanel = async () => {
    if (await ui(p, ".panel").isVisible()) { await p.keyboard.press("Escape"); await sleep(200); }
    await p.keyboard.press("Alt+Shift+KeyM"); await ui(p, ".panel").waitFor(); await sleep(400); await p.mouse.move(2, 2);
  };
  await openPanel();
  await ui(p, ".pmore summary").click(); await sleep(150); // simplify: under the panel's More
  await shot(p, "packs", "panel-make", [ui(p, ".pk-bar"), ui(p, ".panel footer")], { pad: 4, note: "Packs · Make a pack… sits with the backup buttons under More, at the foot of the panel" });
  if (!n) await shot(p, "packs", "panel-make-focus", ui(p, ".pk-bar"), { pad: 8, checks: [await focusVisible(p, ui(p, "[data-pk=make]"))] });
  // choosing mods
  await ui(p, "[data-pk=make]").click(); await sleep(300); await blur(p);
  await shot(p, "packs", "choose-none", ui(p, ".panel"), { note: "a tick on every row; Next stays off until one is chosen" });
  for (const id of ["mod1", "mod5", "mod8"]) await ui(p, `article[data-id=${id}] [data-pk=sel]`).check();
  await ui(p, ".list").evaluate(l => l.scrollTo({ top: 0 })); await p.mouse.move(2, 2); await sleep(150); await blur(p);
  await shot(p, "packs", "choose", ui(p, ".panel"), { note: "three chosen: the strip counts them, Next turns on" });
  if (!n) await shot(p, "packs", "choose-tick-focus", ui(p, "article[data-id=mod1]"), { pad: 8, checks: [await focusVisible(p, ui(p, "article[data-id=mod1] [data-pk=sel]"))] });
  // name, note, then the link
  await ui(p, ".pk-pickbar [data-pk=next]").click(); await card.waitFor(); await sleep(300);
  await card.locator("[data-pk=link]").click(); await sleep(200); await blur(p);
  await shot(p, "packs", "make-no-name", card, { note: "Copy link without a name: “Give the pack a name.” and the name field has focus" });
  await card.locator("[data-pk=name]").fill("Orders team");
  await card.locator("[data-pk=note]").fill("What the orders team uses every day. Untick what you don't need.");
  await blur(p);
  await shot(p, "packs", "make", card, { note: "name, an optional note, the mods in it; Copy link is the main button" });
  if (!n) await shot(p, "packs", "make-name-focus", card.locator(".pk-field"), { pad: 8, checks: [await focusVisible(p, card.locator("[data-pk=name]"))] });
  await card.locator("[data-pk=link]").click();
  await card.locator(".pk-link:not([hidden])").waitFor({ timeout: 4000 }).catch(() => {}); await sleep(300); await blur(p);
  await shot(p, "packs", "make-link", card, { note: "the link, Copy again, and Cancel becomes Done" });
  await card.locator("footer [data-a=close]").click(); await sleep(300);
  await toastGone(p);
  // the install review: a team's pack from its address
  await openPanel();
  await ui(p, "footer [data-a=import]").click(); await card.waitFor(); await sleep(200);
  await card.locator("textarea").fill("https://packs.example.com/orders-team.morse-pack.json");
  await card.locator("[data-a=go]").click();
  await ui(p, ".modal .card.pk-card").waitFor({ timeout: 6000 }); await sleep(900); await blur(p);
  await shot(p, "packs", "review", card, { note: "every mod with a tick, what it does and where; the one for every website and the clash need a choice; Cancel has focus" });
  await card.locator(".pk-item[data-pkid=mod7] .pk-clash").scrollIntoViewIfNeeded(); await sleep(150);
  await shot(p, "packs", "review-clash", card.locator(".pk-item[data-pkid=mod7]"), { pad: 8, note: "a mod with the same id as one of yours: Keep both (the default) or Replace yours" });
  await card.locator(".pk-item[data-pkid=mod7] [data-pk-as=replace]").click(); await sleep(100);
  if (!n) await shot(p, "packs", "review-clash-focus", card.locator(".pk-item[data-pkid=mod7] .seg"), { pad: 8, checks: [await focusVisible(p, card.locator(".pk-item[data-pkid=mod7] [data-pk-as=replace]"))] });
  await card.locator(".pk-item[data-pkid=quiet-links]").scrollIntoViewIfNeeded(); await sleep(150); await blur(p);
  await shot(p, "packs", "review-wide", card.locator(".pk-item[data-pkid=quiet-links]"), { pad: 8, note: "every website: not ticked, with the note in full" });
  await card.locator(".pk-item[data-pkid=order-notes]").scrollIntoViewIfNeeded(); await sleep(150);
  await shot(p, "packs", "review-sends", card.locator(".pk-item[data-pkid=order-notes]"), { pad: 8, note: "a mod that sends what's on the page somewhere: the note says so" });
  await card.locator(".pk-item[data-pkid=copy-order] [data-pk=pick]").uncheck(); await sleep(150);
  await card.locator(".pk-item[data-pkid=copy-order]").scrollIntoViewIfNeeded(); await sleep(100); await blur(p);
  await shot(p, "packs", "review-unticked", card.locator(".pk-item[data-pkid=copy-order]"), { pad: 8, note: "unticked: the mod folds to its name, muted by color, not opacity" });
  await card.evaluate(c => { c.scrollTop = c.scrollHeight; }); await sleep(150);
  await card.locator("[data-pk=sub]").check(); await sleep(150); await blur(p);
  await shot(p, "packs", "review-end", card, { note: "the end: Check this address for updates (the person's choice), Install with the count" });
  if (!n) await shot(p, "packs", "review-install-focus", card.locator("footer"), { pad: 8, checks: [await focusVisible(p, card.locator("[data-pk=install]"))] });
  await card.locator("[data-pk=install]").click();
  await ui(p, ".modal").waitFor({ state: "hidden", timeout: 6000 }).catch(() => {}); await sleep(400);
  await shot(p, "packs", "installed-toast", ui(p, ".toast"), { pad: 16 });
  await toastGone(p);
  // the panel: the pack's mods under its name, one switch for the pack
  await openPanel();
  const group = ui(p, ".pk-group");
  const top = () => group.evaluate(g => g.scrollIntoView({ block: "start" }));
  const head = async () => [group.locator(".pk-head"), group.locator("article").first(), ...(await group.locator(".pk-upd").count() ? [group.locator(".pk-upd")] : [])];
  await top(); await sleep(200);
  await shot(p, "packs", "panel-group", await head(), { pad: 8, note: "the pack's name, how many mods, “gets updates”, Copy link and Stop updates; its mods under it" });
  if (!n) await shot(p, "packs", "panel-group-switch-focus", group.locator(".pk-head"), { pad: 8, checks: [await focusVisible(p, group.locator("[data-pk=toggle]"))] });
  await group.locator(".pk-head .sw").click(); await sleep(500); await p.mouse.move(2, 2); await blur(p);
  await top(); await sleep(150);
  await shot(p, "packs", "panel-group-off", await head(), { pad: 8, note: "the whole pack off with one switch" });
  await group.locator(".pk-head .sw").click(); await sleep(500);
  await toastGone(p);
  // a week later the team changed the pack: Update available, then the update review
  await p.evaluate(() => {
    const s = __cat.packServed;
    s.mods[0] = { ...s.mods[0], css: "thead th { position: sticky; top: 0; background: #f9fafb; }\n.table { max-height: 420px; }" };
    s.mods.splice(1, 1); // "Failed orders stand out" is gone
    s.mods.push({ morse: 1, id: "pending-amber", title: "Pending orders in amber", prompt: "show pending orders in amber", css: "tr.pending td { background: #fffbeb; }", js: "", match: { hosts: [location.host], app: null } });
    s.note = "Sticky header keeps its background now. Pending orders are amber.";
    __cat.later(2);
  });
  await openPanel();
  await ui(p, ".pk-upd").waitFor({ timeout: 6000 }).catch(() => {});
  await top(); await sleep(200);
  await shot(p, "packs", "panel-update", await head(), { pad: 8, note: "Update available, what changed in a few words, Review…" });
  await group.locator("[data-pk=update]").click(); await card.waitFor(); await sleep(900); await blur(p);
  await shot(p, "packs", "update", card, { note: "what changed, the team's note, then changed (with the lines), new and removed; nothing changes until Update" });
  await card.locator(".pk-item[data-kind=change]").first().scrollIntoViewIfNeeded(); await sleep(150);
  await shot(p, "packs", "update-changed", card.locator(".pk-item[data-kind=change]").first(), { pad: 8, note: "a changed mod: the line counts and the diff, open when short" });
  await card.evaluate(c => { c.scrollTop = c.scrollHeight; }); await sleep(150);
  await shot(p, "packs", "update-end", card, { note: "no longer in the pack (untick to keep it), the mods left out before, and History keeps your versions" });
  await p.keyboard.press("Escape"); await sleep(200);
  await close(p);
}

// ---------------------------------------------------------------- round 6
// Whole pages (Morse Desktop's window, the welcome page, the website): one
// screenshot of the page or of one part of it, audited like the extension's
// pages: nothing sticks out or scrolls sideways, cut text ends in an
// ellipsis, and axe-core on the whole page.
async function pageShot(page, area, state, theme, target, opts = {}) {
  const vp = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  let clip = null;
  if (target) {
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const b = await target.boundingBox(), sy = opts.full ? await page.evaluate(() => scrollY) : 0;
    if (b) {
      const pad = opts.pad ?? 12;
      const x = Math.max(0, b.x - pad), y = Math.max(0, b.y + sy - pad);
      clip = { x, y, width: Math.min(vp.width - x, b.width + 2 * pad), height: b.height + 2 * pad };
    }
  }
  const name = `${state}${opts.suffix ?? (vp.width < 600 ? "-narrow" : "")}-${theme}`;
  const file = path.join(OUT, area, `${name}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const snap = () => page.screenshot(clip ? { path: file, clip, fullPage: !!opts.full } : { path: file, fullPage: !!opts.full });
  await snap().catch(async e => { console.warn(`  (retrying ${name}: ${String(e.message).split("\n")[0]})`); await opts.wake?.(); await sleep(1000); await snap(); }); // a window that stopped painting
  const issues = (await page.evaluate(() => {
    const out = [], W = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (!r.width || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
      if (r.width <= 1 && /rect\(0px/.test(cs.clip)) continue; // visually hidden, for screen readers (.sr-only)
      if (r.right > W + 0.5 && cs.position !== "fixed" && !el.closest("[data-morse-ui]")) {
        // inside something that scrolls or clips sideways, it's that thing's business
        let a = el.parentElement, held = false;
        while (a && a !== document.body) { if (/auto|scroll|hidden|clip/.test(getComputedStyle(a).overflowX)) { held = true; break; } a = a.parentElement; }
        if (!held) out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""} sticks out of the page (${Math.round(r.right)} > ${W})`);
      }
      const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (text && el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(cs.overflowX) && cs.textOverflow !== "ellipsis") out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} clips its text`);
    }
    if (document.documentElement.scrollWidth > W + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
    return [...new Set(out)].slice(0, 6);
  })).concat((opts.checks || []).filter(Boolean));
  if (!args["no-axe"] && opts.axe !== false) {
    const found = await axeCheck(page, { page: true, disable: opts.axeOff || [] }).catch(e => [{ id: "axe-failed", impact: "critical", help: e.message.split("\n")[0], targets: [] }]);
    for (const v of found) axeTally.set(v.id, (axeTally.get(v.id) || 0) + 1);
    issues.push(...axeLines(found));
  }
  results.push({ area, state: name, theme, file: path.relative(OUT, file), issues, note: opts.note || "" });
  console.log(`  ${issues.length ? "!" : "✓"} ${area}/${name}${issues.length ? "  " + issues.join(" | ") : ""}`);
}
// A keyboard focus ring on a whole page's control: :focus-visible and a 2px outline (or a ring shadow on it or its row).
async function pageFocus(page, loc) {
  await page.keyboard.press("Shift");
  await loc.focus();
  await sleep(250);
  return loc.evaluate(el => {
    if (!el.matches(":focus-visible")) return "focus does not match :focus-visible";
    const ring = n => { const s = getComputedStyle(n); return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2) || /0px 0px 0px [123]px/.test(s.boxShadow); };
    const host = el.closest(".choice, label, .row, .keyrow");
    return ring(el) || (host && ring(host)) ? "" : "no visible focus indicator (no 2px ring)";
  });
}

// ---- Morse Desktop (desktop-app/): the real app under Xvfb, driven the way
// tests/desktop-app-ui.test.js and demo/shoot-desktop-app.js drive it. Tunes
// (demo/electron-app) opens with Morse for real; the apps this machine has are
// listed with their own icons (desktop-app/icons.js finds them, inside AppImages
// too); `claude` is demo/fake-claude (Claude Code · sonnet,
// answering the check at once, late, or not at all, so each shot is the same).
async function desktopStates() {
  if (!process.env.DISPLAY) { console.warn("  ! Morse Desktop needs DISPLAY (Xvfb :99)"); return; }
  const os = await import("node:os");
  const { _electron } = createRequire(import.meta.url)("playwright");
  const { electronExe, tunesApp } = await import("../tests/helpers/tunes.js");
  if (!electronExe) { console.warn("  ! no Electron runtime (npm install --prefix ~/.cache/morse/electron electron)"); return; }
  const { createMod } = await import("../core/mod.js");
  const AS_ROOT = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
  const tmp = await fs.mkdtemp(path.join(existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(), "morse-ui-desktop-")); // in memory: the disk is tight
  const realHome = os.homedir();
  const { exe: tunes } = await tunesApp();
  // The apps on this machine, by their files; their icons from their own packages.
  const found = [["vscodium", "/usr/share/codium/codium"], ["obsidian", path.join(realHome, "Applications/Obsidian-1.14.5.AppImage")], ["joplin", path.join(realHome, ".joplin/Joplin.AppImage")]].filter(([, f]) => existsSync(f));
  const fakeHome = path.join(tmp, "home"); // a home of its own: no menu entries or icons but the apps' own (desktop-app/icons.js reads them, AppImages too)
  await fs.mkdir(fakeHome, { recursive: true });
  const ctl = path.join(tmp, "fake-claude.json");
  const say = o => fs.writeFile(ctl, JSON.stringify(o));
  await say({});
  const mod = (app, url, title, prompt, enabled = true) => ({ ...createMod({ title, prompt, css: "/* … */", url, app }), enabled });
  const MODS = [
    mod("tunes", "app://tunes/index.html", "Sleep timer", "add a sleep timer that pauses the music after a while"),
    mod("tunes", "app://tunes/index.html", "Bigger album art", "make the album art twice as big"),
    mod("tunes", "app://tunes/index.html", "Hide the shop", "hide the shop banner", false),
    mod("vscodium", "vscode-file://vscode-app/index.html", "Status bar back", "put the status bar back at the bottom"),
    mod("obsidian", "app://obsidian.md/index.html", "No ribbon", "hide the ribbon on the left"),
  ];
  const kids = [];
  async function launch(name, { desktop, config, mods = [] }) {
    const home = path.join(tmp, name);
    await fs.mkdir(path.join(home, "mods"), { recursive: true });
    await fs.writeFile(path.join(home, "desktop.json"), JSON.stringify(desktop));
    await fs.writeFile(path.join(home, "config.json"), JSON.stringify(config), { mode: 0o600 });
    for (const m of mods) await fs.writeFile(path.join(home, "mods", `${m.id}.json`), JSON.stringify(m, null, 2));
    const port = 17000 + Math.floor(Math.random() * 2000);
    const env = { ...process.env, HOME: fakeHome, MORSE_HOME: home, MORSE_DESKTOP_SCAN: "0", MORSE_HELPER_PORT: String(port), ELECTRON_RUN_AS_NODE: "", FAKE_CLAUDE_CTL: ctl,
      PATH: `${path.join(ROOT, "demo", "fake-claude")}:${process.env.PATH}`, MORSE_DESKTOP_THEME: "dark" };
    const app = await _electron.launch({ executablePath: electronExe, args: [path.join(ROOT, "desktop-app"), ...AS_ROOT], env, colorScheme: "dark", timeout: 120000 });
    kids.push(app);
    const w = await app.firstWindow();
    await w.waitForSelector("html[data-ready]", { timeout: 60000 });
    await sleep(600);
    return { app, w, port };
  }
  const setTheme = (app, t) => app.evaluate(({ nativeTheme, BrowserWindow }, t) => { nativeTheme.themeSource = t; const b = BrowserWindow.getAllWindows()[0]; b.show(); b.focus(); b.webContents.invalidate(); }, t);
  // One state in both themes (the window follows the system's light or dark; nativeTheme stands in for it).
  async function both(app, w, state, target, opts = {}) {
    for (const t of opts.themes || ["dark", "light"]) {
      await setTheme(app, t); await w.emulateMedia({ colorScheme: t });
      if (!opts.keepPointer) { await w.mouse.move(480, 8); await w.mouse.move(4, 710); } // no row left looking hovered
      await sleep(350);
      await pageShot(w, "desktop", state, t, target ? target() : null, { suffix: "", wake: () => setTheme(app, t), ...opts });
    }
    await setTheme(app, "dark"); await w.emulateMedia({ colorScheme: "dark" }); await sleep(200);
    if (/focus/.test(state)) await w.evaluate(() => document.activeElement?.blur());
  }
  const tab = async (w, name) => { await w.click(`nav button[data-tab="${name}"]`); await sleep(350); await w.mouse.move(4, 710); };
  async function quit(app) {
    const pid = app.process().pid;
    await Promise.race([app.evaluate(({ app }) => app.quit()).catch(() => {}), sleep(8000)]);
    await sleep(1500);
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  try {
    // ---- 1. a computer with Claude Code (sonnet), Tunes, VSCodium, Obsidian and Joplin
    // the check, while the model answers (a launch of its own: the answer comes late)
    await say({ delay: 90000 });
    let { app, w, port } = await launch("check", { desktop: { helper: false, apps: [tunes] }, config: { provider: "claude-code", models: { "claude-code": "sonnet" } } });
    await w.locator("#first").waitFor();
    await w.waitForFunction(() => /Checking/.test(document.querySelector("#first-model")?.textContent || ""), null, { timeout: 60000 });
    await w.mouse.move(4, 710);
    await pageShot(w, "desktop", "first-run-checking", "dark", null, { suffix: "", note: "the model found by itself, checked once: the radar pulses while it answers" });
    await quit(app);
    await say({ delay: 1200 });
    ({ app, w, port } = await launch("full", {
      desktop: { helper: true, apps: [tunes, ...found.map(f => f[1])], appArgs: { tunes: [`--user-data-dir=${path.join(tmp, "tunes-profile")}`, ...AS_ROOT] } },
      config: { provider: "claude-code", models: { "claude-code": "sonnet" } }, mods: MODS,
    }));
    await w.locator("#first").waitFor();
    await w.waitForFunction(() => /answered/i.test(document.querySelector("#first-model")?.textContent || ""), null, { timeout: 60000 });
    await say({});
    await both(app, w, "first-run", null, { note: "the first run: Claude Code · sonnet found and answering, the apps to open, with their own icons" });
    await both(app, w, "first-run-focus", () => w.locator("#first-apps li").first(), { themes: ["dark"], pad: 16, checks: [await pageFocus(w, w.locator("#first-apps button").first())] });
    await w.click("#first-skip");
    await w.locator(".app").waitFor();
    await w.locator('li[data-app="tunes"]').waitFor();
    await w.mouse.move(4, 710); await sleep(500);
    await both(app, w, "apps", null, { note: "Your apps: each app's own icon (an app without one gets the apps glyph, never a letter)" });
    // Tunes, opened with Morse for real
    await w.locator('li[data-app="tunes"]').getByRole("button", { name: "Open with Morse" }).click();
    await w.waitForFunction(() => /Opening|Connecting/.test(document.querySelector('li[data-app="tunes"]')?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
    await pageShot(w, "desktop", "apps-opening", "dark", w.locator("#app-list"), { suffix: "", note: "opening Tunes with Morse: the radar pulses in its row" });
    await w.locator('li[data-app="tunes"].connected').waitFor({ timeout: 120000 });
    await w.mouse.move(4, 710); await sleep(400);
    await both(app, w, "apps-connected", null, { note: "Tunes connected: 1 window, 2 mods on; the nav says 1 on" });
    await w.locator('li[data-app="tunes"] button').hover(); await sleep(200);
    await both(app, w, "apps-row-hover", () => w.locator('li[data-app="tunes"]'), { themes: ["dark"], pad: 8, keepPointer: true });
    await both(app, w, "apps-button-focus", () => w.locator('li[data-app="tunes"]'), { themes: ["dark"], pad: 8, checks: [await pageFocus(w, w.locator('li[data-app="tunes"] button'))] });
    await w.mouse.move(4, 710);
    // a launch that failed says why, in the window (the real words: daemon/apps.js launchFailure)
    await w.evaluate(() => { const e = document.getElementById("apps-error"); e.textContent = "Joplin quit right after it started (exit code 1), before Morse could connect. You're running as root, and Electron and Chromium apps won't start as root with their sandbox on. Run Morse as your own user. If you really must use root: morse launch joplin -- --no-sandbox"; e.hidden = false; });
    await both(app, w, "apps-error", null, { note: "an app that wouldn't start: Morse's own words for why (daemon/apps.js launchFailure)" });
    await w.evaluate(() => { document.getElementById("apps-error").hidden = true; });
    // the question before restarting an app that is open without Morse (app.js askRestart)
    await w.evaluate(() => { document.getElementById("ask-restart-h").textContent = "Obsidian is open. Restart it with Morse?"; document.getElementById("always-label").textContent = "Always restart Obsidian"; document.getElementById("ask-restart").showModal(); document.getElementById("restart-ok").focus(); });
    await sleep(300);
    await both(app, w, "restart", null, { note: "“Obsidian is open. Restart it with Morse?”, with Always restart" });
    await w.evaluate(() => document.getElementById("ask-restart").close());

    // ---- Model
    await tab(w, "model");
    await both(app, w, "model", null, { note: "Claude Code · sonnet, answered; the real Claude mark" });
    await w.click("#change-model");
    await w.waitForSelector("#choice-list .choice");
    await w.mouse.move(4, 710); await sleep(500);
    await both(app, w, "model-choices", null, { note: "three choices with their real marks: Ready, Not installed, and nothing for a key" });
    await w.click('[data-howto="codex"]'); await w.mouse.move(4, 710); await sleep(300);
    await both(app, w, "model-howto", () => w.locator("#choices"), { note: "How to install: the one command, and Look again" });
    await both(app, w, "model-howto-focus", () => w.locator('[data-choice="codex"]'), { themes: ["dark"], pad: 8, checks: [await pageFocus(w, w.locator('[data-howto="codex"]'))] });
    await w.click('[data-choice="api-key"]'); await w.mouse.move(4, 710); await sleep(300);
    await both(app, w, "model-key", () => w.locator("#choices"), { note: "API key: the field, and where it stays" });
    await both(app, w, "model-choice-focus", () => w.locator('[data-choice="api-key"]'), { themes: ["dark"], pad: 8, checks: [await pageFocus(w, w.locator('[data-choice="api-key"] input'))] });
    await w.click("#cancel-choice");
    await say({ delay: 6000 });
    await w.click("#check-model");
    await sleep(500);
    await pageShot(w, "desktop", "model-checking", "dark", w.locator(".card.current"), { suffix: "", note: "checking that the model answers" });
    await w.waitForFunction(() => !document.querySelector("#check-model").disabled, null, { timeout: 60000 });
    await say({ fail: "You've hit your usage limit. It resets at 4pm." });
    await w.click("#check-model");
    await w.waitForFunction(() => /Didn't answer/.test(document.querySelector("#model-live").textContent), null, { timeout: 60000 });
    await w.mouse.move(4, 710);
    await both(app, w, "model-failed", () => w.locator(".card.current"), { note: "a check that failed says why, in the model's own words; the nav shows !" });
    await say({});
    await w.click("#check-model");
    await w.waitForFunction(() => /Answered/.test(document.querySelector("#model-live").textContent), null, { timeout: 60000 });

    // ---- Chrome
    await tab(w, "chrome");
    await both(app, w, "chrome", null, { note: "the Morse helper on, the ways to connect Chrome" });
    await w.click("#new-code");
    await w.waitForSelector("#pair-code:not([hidden])");
    await w.mouse.move(4, 710);
    await both(app, w, "chrome-code", null, { note: "a code to type in Chrome, for a few minutes" });
    await w.click("#helper-on"); await sleep(1500);
    await both(app, w, "chrome-off", () => w.locator("section#chrome .card").first(), { note: "the helper off: Chrome can't use the model" });
    await both(app, w, "chrome-switch-focus", () => w.locator("section#chrome .card").first(), { themes: ["dark"], pad: 8, checks: [await pageFocus(w, w.locator("#helper-on"))] });
    await w.click("#helper-on"); await sleep(2500);
    // the Morse extension asks to connect (daemon/bridge.js /v1/pair/ask), as the welcome page does
    const health = await fetch(`http://127.0.0.1:${port}/v1/health`).then(r => r.json(), () => ({}));
    if (health.ask) {
      const http = await import("node:http");
      await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/pair/ask", headers: { Origin: `chrome-extension://${"lkbmdfnoigeajfhc".repeat(2)}`, "Content-Type": "application/json" } }, res => { res.resume(); res.on("end", resolve); });
        req.on("error", reject); req.end("{}");
      });
      await w.waitForSelector("dialog#ask-pair[open]", { timeout: 30000 });
      await sleep(400);
      await both(app, w, "allow", null, { note: "“Allow Chrome to use your Claude Code · sonnet?”: the real helper asking" });
      await w.click("#pair-no");
    } else console.warn("  ! the helper can't ask: no Allow state");

    // ---- Mods
    await tab(w, "mods");
    await both(app, w, "mods", null, { note: "mods per app, each app's icon, a switch each; one off" });
    await both(app, w, "mods-switch-focus", () => w.locator(".group").first(), { themes: ["dark"], pad: 8, checks: [await pageFocus(w, w.locator(".mods input").first())] });
    await w.click("#mods-on"); await sleep(1200);
    await both(app, w, "mods-paused", null, { note: "every mod off: the notice, and the switch in the sidebar" });
    await w.click("#resume"); await sleep(1000);

    // ---- Checks
    await tab(w, "checks");
    await both(app, w, "checks-idle", null, { note: "checks run only when asked: they ask the model a question" });
    await say({ delay: 5000 });
    await w.click("#run-checks"); await sleep(600);
    await pageShot(w, "desktop", "checks-running", "dark", null, { suffix: "" });
    await w.waitForFunction(() => !document.querySelector("#run-checks").disabled, null, { timeout: 120000 });
    await say({});
    await w.mouse.move(4, 710);
    await both(app, w, "checks", null, { note: "what Morse found; “You're root” is this test machine" });
    await both(app, w, "nav-focus", () => w.locator("nav"), { themes: ["dark"], pad: 8, checks: [await pageFocus(w, w.locator('nav button[data-tab="apps"]'))] });

    // ---- the window at its smallest (760 × 560)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 560));
    await sleep(800);
    await tab(w, "apps");
    await both(app, w, "apps", null, { suffix: "-min", note: "the window at its smallest, 760 × 560" });
    await tab(w, "model");
    await w.click("#change-model"); await w.waitForSelector("#choice-list .choice"); await sleep(500);
    await w.click('[data-howto="codex"]'); await sleep(300);
    await both(app, w, "model-choices", null, { suffix: "-min", themes: ["dark"] });
    await w.click("#cancel-choice");
    await tab(w, "chrome");
    await both(app, w, "chrome", null, { suffix: "-min", themes: ["dark"] });
    await tab(w, "checks");
    await both(app, w, "checks", null, { suffix: "-min", themes: ["dark"] });
    await quit(app);

    // ---- 2. a computer with no model and no app Morse can open
    ({ app, w } = await launch("empty", { desktop: { helper: false, apps: ["/bin/true"] }, config: { provider: "none" } }));
    await w.locator("#first").waitFor();
    await w.mouse.move(4, 710); await sleep(500);
    await both(app, w, "first-run-no-model", null, { note: "nothing found: paste a key, or other ways to connect a model" });
    await both(app, w, "first-run-key-focus", () => w.locator("#first-key"), { themes: ["dark"], pad: 8, checks: [await pageFocus(w, w.locator("#first-key-input"))] });
    await w.click("#first-skip");
    await w.locator(".app").waitFor(); await w.mouse.move(4, 710); await sleep(500);
    await both(app, w, "apps-empty", null, { note: "Choose a model first; an app Morse can't connect to says why" });
    await tab(w, "model");
    await both(app, w, "model-none", null, { note: "no model yet: Choose…" });
    await tab(w, "chrome");
    await both(app, w, "chrome-helper-off", null, { themes: ["dark"] });
    await tab(w, "mods");
    await both(app, w, "mods-empty", null, { note: "No mods yet" });
    await quit(app);
  } finally {
    for (const k of kids) { try { process.kill(k.process().pid, "SIGKILL"); } catch {} }
    try { const { listProcesses } = await import("../daemon/apps.js"); for (const p of listProcesses()) if (p.cmd.includes(tmp)) try { process.kill(p.pid, "SIGKILL"); } catch {} } catch {}
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- the welcome page, onboarding v2 (extension/welcome.*), and the
// “Allow User Scripts” window (extension/allow.html): the real built
// extension, headful under Xvfb, every screen at 1280 and 390, dark and light,
// in English, German (long words) and Persian (right to left). What the page
// hears about the model (popup.state, the Allow question, pairing, a key) is
// stubbed per state, so each shot is the same every time; the practice page
// is the real one, with sample answers.
const HELPER = { app: "desktop", ask: true, paired: false, pairing: false, provider: "claude-code", label: "Claude Code · sonnet", signedIn: { claude: true } };
const WELCOME = {
  none: { st: { kind: "none", label: "", helper: null } },
  looking: { st: { kind: "none", label: "", helper: null }, slow: 60000 },
  ask: { st: { kind: "none", label: "", helper: HELPER } },
  "ask-signed-out": { st: { kind: "none", label: "", helper: { ...HELPER, signedIn: { claude: false } } } },
  "ask-waiting": { st: { kind: "none", label: "", helper: HELPER }, ask: "waiting" },
  "ask-denied": { st: { kind: "none", label: "", helper: HELPER }, ask: "denied" },
  code: { st: { kind: "none", label: "", helper: { ...HELPER, app: "cli", ask: false } } },
  "no-model": { st: { kind: "none", label: "", helper: { ...HELPER, provider: "none", label: "No model" } } },
  connected: { st: { kind: "helper", label: "Claude Code · sonnet", helper: { ...HELPER, paired: true } } },
};
async function welcomeStates() {
  if (!process.env.DISPLAY) { console.warn("  ! the welcome page needs DISPLAY (Xvfb :99)"); return; }
  const os = await import("node:os");
  const EXT = path.join(ROOT, "dist", "extension");
  // The page's messages about the model, answered from localStorage["morse-ui"] (set before each reload).
  const stub = () => {
    if (location.protocol !== "chrome-extension:" || !globalThis.chrome?.runtime?.sendMessage) return;
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    const conf = () => { try { return JSON.parse(localStorage.getItem("morse-ui") || "null"); } catch { return null; } };
    chrome.runtime.sendMessage = async m => {
      const c = conf();
      if (!c) return real(m);
      if (m?.type === "popup.state") { if (c.slow) await new Promise(r => setTimeout(r, c.slow)); return { userScripts: true, mods: [], ...c.st }; }
      if (m?.type === "popup.askStart") return { id: "ask-1", expires: Date.now() + 120000 };
      if (m?.type === "popup.askCheck") return { state: c.ask || "waiting" };
      if (m?.type === "popup.pair") return { error: "That code doesn't match the one the Morse helper shows. Check it and try again." };
      if (m?.type === "popup.save") return { error: "The key was refused: invalid x-api-key" };
      if (m?.type === "onboarding.status") return { state: {}, status: { model: { connected: c.st.kind !== "none" }, userScripts: true, mods: 0 } };
      return real(m);
    };
  };
  for (const theme of ["dark", "light"]) {
    const dir = await fs.mkdtemp(path.join(existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(), "morse-ui-welcome-"));
    const ctx = await chromium.launchPersistentContext(dir, {
      headless: false, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, colorScheme: theme,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
    });
    extCtxs.push(ctx);
    try {
      ctx.setDefaultTimeout(Number(process.env.UI_TIMEOUT) || 15000);
      await ctx.addInitScript(stub);
      const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
      const id = sw.url().split("/")[2];
      await sleep(800);
      for (const pg of ctx.pages()) if (pg.url().includes("welcome.html")) await pg.close().catch(() => {});
      const w = await ctx.newPage();
      await w.goto(`chrome-extension://${id}/welcome.html`);
      await w.addStyleTag({ content: "html { scrollbar-width: none; }" }).catch(() => {});
      // One screen of the welcome page: where you are, the language, what the page hears.
      const at = async ({ screen = "choose", want = "web", lang = "en", state = "none", width = 1280 }) => {
        await w.setViewportSize({ width, height: width < 600 ? 844 : 860 });
        await w.evaluate(async ({ screen, want, lang, conf }) => {
          localStorage.setItem("morse-ui", JSON.stringify(conf));
          await chrome.storage.local.set({ "morse.start": { want, screen }, "morse.settings": { language: lang } });
          await chrome.storage.sync.remove("morse.settings").catch(() => {});
        }, { screen, want, lang, conf: WELCOME[state] });
        await w.reload();
        await w.addStyleTag({ content: "html { scrollbar-width: none; }" }).catch(() => {});
        await w.waitForFunction(s => document.getElementById("app")?.dataset.screen === s, screen);
        await sleep(state === "looking" ? 600 : 1500);
        await w.mouse.move(width - 4, 4);
      };
      const shoot = (state, opts = {}) => pageShot(w, "welcome", state, theme, opts.target || null, { full: !opts.target, ...opts });
      for (const width of [1280, 390]) {
        for (const lang of ["en", "de", "fa"]) {
          const L = lang === "en" ? "" : `${lang}-`;
          await at({ screen: "choose", lang, width });
          await shoot(`${L}choose`, { note: "one question: websites, desktop apps or both" });
          if (lang === "en" && width > 600) {
            await w.locator("[data-want=web]").hover(); await sleep(200);
            await shoot("choose-hover", { target: w.locator(".choices"), note: "a choice under the pointer: one step lighter" });
            await shoot("choose-focus", { target: w.locator(".choices"), checks: [await pageFocus(w, w.locator("[data-want=apps]"))] });
            await w.mouse.move(width - 4, 4);
          }
          await at({ screen: "connect", want: "web", lang, width });
          await shoot(`${L}connect`, { note: "nothing found yet: Get Morse Desktop, or an API key" });
          await at({ screen: "connect", want: "both", lang, state: "ask", width });
          await shoot(`${L}connect-found`, { note: "Morse Desktop is open, with Claude Code · sonnet: one button" });
          await at({ screen: "try", lang, state: "none", width });
          await sleep(1500);
          await shoot(`${L}try`, { note: "the first change: three steps, the practice page, sample answers until a model is connected" });
          await at({ screen: "win", want: "both", lang, state: "connected", width });
          await shoot(`${L}win`, { note: "the first mod is saved: a real site next, and the apps" });
          if (lang !== "en") continue;
          // the rest of connect, in English
          await at({ screen: "connect", want: "both", width });
          await shoot("connect-both", { note: "websites and apps: Morse Desktop first, the key folded away" });
          await w.locator("#term summary").click(); await w.locator("#key-more summary").click(); await sleep(300);
          await shoot("connect-both-open", { note: "the key and the terminal, opened" });
          await at({ screen: "connect", want: "web", width });
          await w.locator("#key").fill("my-key-123"); await w.locator("#save-key").click(); await sleep(400);
          await shoot("connect-key-bad", { target: w.locator("[data-view=key]"), note: "a key that isn't one" });
          await w.locator("#key").fill("sk-ant-api03-xxxx"); await w.locator("#save-key").click(); await sleep(600);
          await shoot("connect-key-refused", { target: w.locator("[data-view=key]"), note: "a key the API refused" });
          if (width > 600) await shoot("connect-key-focus", { target: w.locator("[data-view=key]"), checks: [await pageFocus(w, w.locator("#key"))] });
          await at({ screen: "connect", width, state: "looking" });
          await shoot("connect-looking", { target: w.locator("#connect"), note: "looking for Morse Desktop" });
          for (const s of ["ask-signed-out", "code", "no-model", "connected"]) {
            await at({ screen: "connect", want: "both", state: s, width });
            if (s === "code") { await w.locator("#code").fill("ZZZZZ"); await w.locator("#pair").click(); await sleep(400); }
            await shoot(`connect-${s}`, { target: w.locator("#connect"), note: { "ask-signed-out": "Claude Code found but signed out", code: "a helper started from a terminal: type its code", "no-model": "Morse Desktop without a model", connected: "connected: on to the first change" }[s] });
          }
          for (const s of ["ask-waiting", "ask-denied"]) {
            await at({ screen: "connect", want: "both", state: s, width });
            await w.locator("#use").click(); await sleep(1600);
            await shoot(`connect-${s}`, { target: w.locator("#connect"), note: s === "ask-waiting" ? "waiting for Allow in Morse Desktop" : "Denied in Morse Desktop" });
          }
          if (width > 600) {
            await at({ screen: "connect", want: "both", state: "ask", width });
            await shoot("connect-use-focus", { target: w.locator("#connect"), checks: [await pageFocus(w, w.locator("#use"))] });
          }
          for (const want of ["web", "apps"]) {
            await at({ screen: "win", want, state: want === "web" ? "connected" : "ask", width });
            await shoot(`win-${want}${want === "apps" ? "-no-model" : ""}`, { note: want === "web" ? "websites only" : "apps only, tried with a sample answer: connect a model next" });
          }
          // the practice page's bar, with the sample suggestions
          await at({ screen: "try", state: "none", width });
          await w.locator("#open-bar").click().catch(() => {}); await sleep(1800);
          await pageShot(w, "practice", "sample-bar", theme, w.locator("#frame"), { note: "the practice bar, opened from step 1: the coach, sample suggestions" });
        }
      }
      // the “Allow User Scripts” window, as Chrome shows it beside Morse's details
      const a = await ctx.newPage();
      for (const lang of ["en", "de", "fa"]) {
        await w.evaluate(lang => chrome.storage.local.set({ "morse.settings": { language: lang } }), lang);
        await a.setViewportSize({ width: 360, height: 440 });
        await a.goto(`chrome-extension://${id}/allow.html`); await sleep(900);
        await pageShot(a, "welcome", `${lang === "en" ? "" : lang + "-"}allow-window`, theme, null, { suffix: "", full: true, note: "“Allow User Scripts”: a picture of the switch, and Morse waits for it" });
      }
      await a.close();
    } finally {
      await ctx.close().catch(() => {});
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ---- the website (site/) and its Try it here (site/try/), as demo/shoot-site.js
// and demo/shoot-try.js show them: the landing page whole and its first screen
// at 1440, 768 and 390, the nav sheet on a phone, and Try it here writing the
// sleep timer, its result and a request it has no sample for. The site is
// Morse's own dark design: one scheme.
async function siteStates() {
  const { demoSites } = await import("./helper.js");
  const sites = await demoSites();
  try {
    for (const width of [1440, 768, 390]) {
      const phone = width < 600;
      const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce", hasTouch: phone, isMobile: phone });
      ctx.setDefaultTimeout(Number(process.env.UI_TIMEOUT) || 20000);
      await sites.route(ctx);
      const p = await ctx.newPage();
      p.on("pageerror", e => console.warn("  [pageerror]", e.message));
      await p.goto(sites.url("parley", "/site/"));
      await p.waitForLoadState("networkidle").catch(() => {});
      // lazy pictures load near the screen: scroll down a screen at a time, then wait for each
      const H = await p.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < H; y += 450) { await p.evaluate(y => scrollTo(0, y), y); await sleep(80); }
      const missing = await p.evaluate(async () => { await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); await document.fonts.ready; return [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute("src")); });
      await p.evaluate(() => scrollTo(0, 0)); await sleep(300);
      await pageShot(p, "site", "landing", "dark", null, { suffix: `-${width}`, full: true, checks: [missing.length ? `pictures that didn't load: ${missing.join(", ")}` : ""], note: "the landing page, whole" });
      await pageShot(p, "site", "first-screen", "dark", null, { suffix: `-${width}`, axe: false, note: "what someone arriving sees first" });
      if (phone) {
        await p.click(".nav-toggle"); await p.waitForSelector(".nav.is-open"); await sleep(400);
        await pageShot(p, "site", "nav-open", "dark", null, { suffix: `-${width}`, checks: [await pageFocus(p, p.locator(".nav.is-open a").first())], note: "the nav sheet on a phone" });
        await p.click(".nav-toggle"); await sleep(300);
      } else {
        await pageShot(p, "site", "nav-focus", "dark", p.locator("header.nav"), { suffix: `-${width}`, pad: 4, axe: false, checks: [await pageFocus(p, p.locator("header.nav a[href]:visible").nth(1))] });
      }
      // Try it here
      await p.evaluate(() => document.querySelector("#try .try-window").scrollIntoView({ block: "center" }));
      await p.waitForSelector("#try.is-live");
      await sleep(1200);
      const kind = k => p.waitForFunction(k => document.querySelector("#try .try-status")?.dataset.kind === k, k, { timeout: 60000 });
      const tryBox = p.locator("#try");
      await pageShot(p, "site", "try", "dark", tryBox, { suffix: `-${width}`, axe: false, note: "Try it here, ready: the suggestions to tap" });
      if (!phone) await pageShot(p, "site", "try-focus", "dark", p.locator('#try [data-try="ask"]').first(), { suffix: `-${width}`, pad: 8, axe: false, checks: [await pageFocus(p, p.locator('#try [data-try="ask"]').first())] });
      await p.locator('#try [data-try="ask"][data-text="Add a sleep timer"]').click();
      await kind("working"); await sleep(1300);
      await pageShot(p, "site", "try-working", "dark", tryBox, { suffix: `-${width}`, axe: false, note: "the real runtime writing the sleep timer (a sample answer)" });
      await kind("done"); await sleep(1500);
      await pageShot(p, "site", "try-result", "dark", tryBox, { suffix: `-${width}`, note: "the sleep timer in the player, Save and Undo" });
      if (width !== 768) {
        await p.keyboard.press("Escape"); await sleep(500);
        await p.locator('#try [data-try="open"]').click(); await sleep(600);
        await p.keyboard.type("make the logo purple"); await p.keyboard.press("Enter");
        await kind("unknown"); await sleep(800);
        await pageShot(p, "site", "try-unknown", "dark", tryBox, { suffix: `-${width}`, axe: false, note: "a request with no sample answer: how to get Morse" });
      }
      await ctx.close();
    }
  } finally { await sites.close(); }
}

// ---- round 6 bar states: Esc keeps a change (“Kept it”, with Undo), the
// developer's “rebuilt” note, Your style's header saying where it shows,
// Alt+↑ for a bigger part, and Redo in the edit tools.
async function newBarStates(theme, width) {
  const n = width < 600, H = n ? 844 : 720;
  // Esc after a result keeps it: the toast says so, with Undo
  let p = await open({ theme, width, height: H });
  await openBar(p); await pick(p, "#card");
  await submit(p, "make the shuffle button bigger");
  await stream(p, 12, 20);
  await finish(p, OK({ title: "Bigger shuffle button" }));
  await p.keyboard.press("Escape");
  await ui(p, ".ctl-toast").waitFor({ timeout: 6000 }); await sleep(300); await p.mouse.move(2, H / 2);
  await shot(p, "new-bar", "kept-toast", ui(p, ".ctl-toast"), { pad: 16, note: "Esc keeps the change and says so, with Undo" });
  if (!n) await shot(p, "new-bar", "kept-undo-focus", ui(p, ".ctl-toast"), { pad: 16, checks: [await focusVisible(p, ui(p, ".ctl-toast button").first())] });
  await close(p);
  // the developer's note: npm run build ran under a running extension
  p = await open({ theme, width, height: H, extra: "&rebuilt=1" });
  await ui(p, ".ctl-toast").waitFor({ timeout: 6000 }); await sleep(300);
  await shot(p, "new-bar", "rebuilt", ui(p, ".ctl-toast"), { pad: 16, note: "for people working on Morse: reload the extension, then the page" });
  await close(p);
  // Your style: where it shows, in the sheet's header
  for (const reach of ["web", "all"]) {
    p = await open({ theme, width, height: H, extra: `&style=plain&reach=${reach}` });
    await openBar(p);
    await ui(p, ".in").fill("bigger text and underline links everywhere");
    await ui(p, ".in").press("Enter");
    await ui(p, ".ys-sheet").waitFor({ timeout: 6000 }); await sleep(300);
    await shot(p, "new-bar", `style-${reach}`, ui(p, ".bar"), { note: reach === "web" ? "“Every site in Chrome”: Chrome on its own" : "“Every site and app”: Chrome paired with Morse Desktop" });
    await close(p);
  }
  // Alt+↑: a bigger part than the one pointed at
  p = await open({ theme, width, height: H });
  await openBar(p); await pick(p, "#small");
  await shot(p, "new-bar", "hint-wider", ui(p, ".bar"), { note: "after pointing, the hint names Alt+↑ for a bigger part" });
  await ui(p, ".in").focus();
  await p.keyboard.press("Alt+ArrowUp"); await sleep(300);
  await shot(p, "new-bar", "wider-picked", [ui(p, ".bar"), ui(p, ".sel")], { pad: 12, note: "Alt+↑ picked the part around it" });
  await close(p);
  // Redo in the edit tools
  p = await open({ theme, width, height: H });
  await openBar(p);
  await select(p, "#toolbar", 0.5, 0.15);
  await editFocus(p);
  await p.keyboard.press("h"); await sleep(350); await toastGone(p);
  await p.keyboard.press("Control+KeyZ"); await sleep(350); await toastGone(p);
  await p.keyboard.press("Control+Shift+KeyZ"); await sleep(350);
  await shot(p, "new-bar", "redone-toast", ui(p, ".toast"), { pad: 16, note: "Redo: “Redone: …”" });
  await toastGone(p);
  if (!n) {
    await select(p, "#card", 0.5, 0.5);
    const r = ui(p, ".gm-tb button[data-t=redo]");
    await r.hover(); await sleep(520);
    await shot(p, "new-bar", "redo-tool", [tb(p), ui(p, ".gm-tb button[data-t=redo] .tip")], { pad: 8, note: "the Redo tool, off when there is nothing to redo, with its key" });
  }
  await close(p);
}

// ---------------------------------------------------------------- run
// A flow that throws is a finding, not the end of the run.
async function guard(area, fn) {
  try { await fn(); } catch (e) {
    const msg = `flow failed: ${String(e.message).split("\n")[0]}`;
    console.warn(`  ! ${area}: ${msg}`);
    results.push({ area, state: `flow-failed-${results.length}`, theme: "", file: "", issues: [msg], note: "" });
    for (const c of browser.contexts()) await c.close().catch(() => {});
    for (const c of extCtxs.splice(0)) await c.close().catch(() => {});
    if (!browser.isConnected()) browser = await launchBrowser(); // a crashed renderer took the browser with it: the next area starts fresh
  }
}
await fs.mkdir(OUT, { recursive: true });
// a full run starts clean; docs/ui/before (hand-picked "before" shots for the review) is kept
if (!ONLY) for (const d of await fs.readdir(OUT)) if (!d.includes(".") && d !== "before") await fs.rm(path.join(OUT, d), { recursive: true, force: true });
const t0 = Date.now();
const THEMES = args.theme ? [String(args.theme)] : ["dark", "light"];
const WIDTHS = args.width ? [+args.width] : [1100, 390];
for (const theme of THEMES) {
  console.log(`— ${theme}`);
  for (const width of WIDTHS) {
    if (want("bar")) await guard("bar", () => barStates(theme, width));
    if (want("toast")) await guard("toast", () => toastStates(theme, width));
    if (want("panel")) await guard("panel", () => panelStates(theme, width));
    if (want("modal")) await guard("modal", () => modalStates(theme, width));
  }
  if (want("effect")) await guard("effect", () => effectStates(theme));
  for (const width of WIDTHS) {
    if (want("god")) await guard("god", () => godStates(theme, width));
    if (want("voice")) await guard("voice", () => voiceStates(theme, width));
    if (want("sheets")) await guard("sheets", () => sheetStates(theme, width));
    if (want("flow")) await guard("flow", () => flowStates(theme, width));
    if (want("gallery")) await guard("gallery", () => galleryStates(theme, width));
    if (want("a11y")) await guard("a11y", () => a11yStates(theme, width));
    if (want("control")) await guard("control", () => controlStates(theme, width));
    if (want("iterate")) await guard("iterate", () => iterateStates(theme, width));
    if (want("leftovers")) await guard("leftovers", () => leftoverStates(theme, width));
    if (want("heal")) await guard("heal", () => healStates(theme, width));
    if (want("show-once")) await guard("show-once", () => showOnceStates(theme, width));
    if (want("style")) await guard("style", () => styleStates(theme, width));
    if (want("guard")) await guard("guard", () => guardStates(theme, width));
    if (want("first-run")) await guard("first-run", () => firstRunStates(theme, width));
    if (want("waiting")) await guard("waiting", () => waitingStates(theme, width));
    if (want("packs")) await guard("packs", () => packStates(theme, width));
    if (want("i18n")) await guard("i18n", () => i18nStates(theme, width));
    if (want("new-bar")) await guard("new-bar", () => newBarStates(theme, width));
  }
  if (want("popup")) await guard("popup", () => popupStates(theme));
  if (want("motion")) await guard("motion", () => reducedMotion(theme));
}
if (want("hostile")) { console.log("— hostile hosts"); await hostileStates(); }
if (want("hostile") || want("hostile-r4")) { console.log("— hostile hosts, round 4"); await guard("hostile", hostileR4States); }
if (want("trusted-types")) { console.log("— Trusted Types"); await guard("trusted-types", trustedTypesStates); }
if (want("site")) { console.log("— the website and Try it here"); await guard("site", siteStates); }
if (want("desktop")) { console.log("— Morse Desktop (Xvfb)"); await guard("desktop", desktopStates); }
if (want("welcome") || want("extension")) { console.log("— the welcome page, onboarding v2 (Xvfb)"); await guard("welcome", welcomeStates); }
if (want("extension")) { console.log("— the extension's own pages (Xvfb)"); await guard("extension", extensionStates); }
if (want("a11y-site")) { console.log("— Riverside Library (page tools)"); for (const w of WIDTHS) await a11ySiteStates(w); }
await browser.close();
server.close();

// merge with an earlier run when --only was used
const prevFile = path.join(OUT, "catalog.json");
let all = results;
if (ONLY && existsSync(prevFile)) {
  // an --only group (god, voice, sheets, flow) reshoots several areas
  // (by file, so a group that reshoots a few states of another area keeps the rest)
  const redone = new Set(results.map(r => r.file));
  const prev = JSON.parse(readFileSync(prevFile, "utf8")).shots.filter(s => !ONLY.has(s.area) && !redone.has(s.file));
  all = prev.concat(results);
}
await fs.writeFile(prevFile, JSON.stringify({ generated: new Date().toISOString(), shots: all }, null, 1));
await writeIndex();
const bad = results.filter(r => r.issues.length);
if (!args["no-axe"]) console.log(`axe-core ${AXE_VERSION}: ${axeTally.size ? [...axeTally].map(([id, n]) => `${id} in ${n} states`).join(", ") : "no violations in any state"}`);
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
