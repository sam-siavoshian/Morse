#!/usr/bin/env node
// Morse design eval: does a new feature or a restyle look like it shipped with
// the app, and does it work? Real desktop apps (VSCodium, Microsoft VS Code,
// Obsidian, Joplin) started fresh for every run, and real sites (recorded once
// and replayed, so every arm sees the same page). See evals/design/README.md.
//
//   node evals/design/run.js --baseline <checkout of the code before>   all cases, three arms, Opus judge
//   node evals/design/run.js --only vsc-pomodoro --arms context,polish --judge none
//   node evals/design/run.js --judge-only evals/design/results/<file>.json   score saved runs again
//   node evals/design/run.js --record-sites                            record the site pages again
//
// Arms:
//   baseline  the code given with --baseline (its context builder, prompt, engine and kit)
//   context   this code: the design context and prompt rules, no polish round
//   polish    this code with "Polish changes" on (core/polish.js)
// Each case runs the real pipeline as the hosts do: the context is built by
// runtime/src/20-context.js in the page, core/engine.js runMorse calls Claude
// Code, CSS goes in a style tag and JS through the helper kit. Then the eval
// takes pictures (before, after, after in the app's other theme), runs the
// case's functional check, and finally the judge scores the pictures.

import { promises as fs, readFileSync, existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { stubs, helpers } from "../page-helpers.js";
import { designChecks } from "./checks.js";
import { JUDGE_PROMPT, RUBRIC, shuffled, parseVerdict, mean } from "./judge.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const { values: opt } = parseArgs({ options: {
  arms: { type: "string", default: "baseline,context,polish" },
  model: { type: "string", default: "sonnet" },
  judge: { type: "string", default: "opus" }, // "none": no judge
  only: { type: "string", default: "" },
  apps: { type: "string", default: "" }, // e.g. vscodium,obsidian or site
  concurrency: { type: "string", default: "2" },
  baseline: { type: "string", default: "" },
  cache: { type: "string", default: path.join(os.homedir(), ".cache", "morse-design-eval") },
  out: { type: "string", default: "" },
  label: { type: "string", default: "" },
  "judge-only": { type: "string", default: "" },
  "record-sites": { type: "boolean", default: false },
  display: { type: "string", default: process.env.DISPLAY || ":99" },
} });

const CASES = JSON.parse(readFileSync(path.join(HERE, "cases.json"), "utf8")).cases;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.resolve(opt.out || path.join(opt.cache, "runs", stamp));
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- code per arm
const codeCache = new Map();
async function codeFor(dir) {
  if (codeCache.has(dir)) return codeCache.get(dir);
  const url = f => pathToFileURL(path.join(dir, f)).href;
  const harness = await import(url("daemon/harness.js")); // registers claude-code in that tree's providers
  harness.setWarmPoolSize?.(0); // a fresh process per call: no waiting processes left behind
  const { runMorse } = await import(url("core/engine.js"));
  const { wrapModCode, settleMs } = await import(url("core/kit.js"));
  const { buildMessages } = await import(url("core/prompt.js"));
  const src = readFileSync(path.join(dir, "runtime", "src", "20-context.js"), "utf8");
  const code = { runMorse, wrapModCode, settleMs, buildMessages, src };
  codeCache.set(dir, code);
  return code;
}
const ARMS = {
  baseline: () => ({ dir: opt.baseline, polish: false }),
  context: () => ({ dir: ROOT, polish: false }),
  polish: () => ({ dir: ROOT, polish: true }),
};
// The context is read in a world of its own, as the runtime does (Morse's
// isolated world, with its Trusted Types shim: VS Code refuses HTML strings
// in the page's world). Mods still run in the page's world.
const TRUSTED_SRC = readFileSync(path.join(ROOT, "runtime", "src", "00-trusted-html.js"), "utf8");
const installContext = src => `globalThis.__morseHost ||= {}; ${TRUSTED_SRC}
globalThis.__morseEval = (() => {
  const S = { app: null, target: null };
  const live = () => true, getLanguage = () => "en";
  ${src}
  return {
    context(sel) { S.target = sel ? (deepAll(sel)[0] || null) : null; if (sel && !S.target) throw new Error("target not found: " + sel); const t = performance.now(); const c = context(); return { c, ms: performance.now() - t }; },
    probe: typeof effectProbe === "function" ? effectProbe : null,
  };
})();`;
// The eval's own picture area (this code's shotArea), for every arm alike.
const AREA_SRC = readFileSync(path.join(ROOT, "runtime", "src", "20-context.js"), "utf8");
const installArea = `globalThis.__designArea = (() => { const S = { app: null, target: null }; const live = () => true, getLanguage = () => "en"; ${AREA_SRC}\n return shotArea; })();`;
// An isolated world in the page's main frame: evaluate(expression) -> value.
async function isolatedWorld(page) {
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { executionContextId } = await cdp.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "morse-eval", grantUniveralAccess: true });
  return async expression => {
    const r = await cdp.send("Runtime.evaluate", { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text);
    return r.result?.value;
  };
}

// ---------------------------------------------------------------- apps
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const APP_DIR = path.join(opt.cache, "apps");
function appImage(name, candidates) {
  const dir = path.join(APP_DIR, name), bin = path.join(dir, "squashfs-root", name);
  if (existsSync(bin)) return bin;
  const src = candidates.find(existsSync);
  if (!src) throw new Error(`${name}: no AppImage found (looked in ${candidates.join(", ")})`);
  mkdirSync(dir, { recursive: true });
  log(`unpacking ${src}`);
  execFileSync(src, ["--appimage-extract"], { cwd: dir, stdio: "ignore" });
  return bin;
}
const home = os.homedir();
const APPS = {
  vscodium: { kind: "vscode", bin: () => "/usr/share/codium/codium", name: "VSCodium" },
  vscode: { kind: "vscode", bin: () => "/usr/share/code/code", name: "Visual Studio Code" },
  obsidian: { kind: "obsidian", bin: () => appImage("obsidian", [`${home}/Applications/Obsidian-1.14.5.AppImage`, ...(process.env.OBSIDIAN_APPIMAGE ? [process.env.OBSIDIAN_APPIMAGE] : [])]), name: "Obsidian" },
  joplin: { kind: "joplin", bin: () => appImage("joplin", [`${home}/.joplin/Joplin.AppImage`, ...(process.env.JOPLIN_APPIMAGE ? [process.env.JOPLIN_APPIMAGE] : [])]), name: "Joplin" },
};

// What each app opens: a small workspace / vault, written fresh for every run.
const WORKSPACE = {
  "notes.md": "# Release notes\n\nThe quick brown fox jumps over the lazy dog. This file has some words so a word count has something to count.\n\n- first item\n- second item\n",
  "messy.json": '{"name":"demo","version":"1.0.0","scripts":{"start":"node index.js"},"tags":["a","b","c"]}\n',
  "math.js": "export function add(a, b) {\n  return a + b;\n}\n",
};
const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
const VAULT = {
  "Welcome.md": `# Welcome\n\nThis is a small vault for trying out changes. It has a few notes in it, some longer than others, so word counts and reading time have something to measure.\n\n## Ideas\n\n- Write more often\n- Read before bed\n- Walk after lunch\n\n${[1, 2, 3, 4, 5, 6, 7, 8].map(i => `Paragraph ${i}. ${LOREM}`).join("\n\n")}\n`,
  "Groceries.md": "# Groceries\n\n- eggs\n- milk\n- bread\n",
  "Meeting notes.md": "# Meeting notes\n\nDiscussed the roadmap.\n",
  "Reading list.md": "# Reading list\n\n1. Dune\n2. Emma\n",
  "Projects/Launch plan.md": "# Launch plan\n\nShip it.\n",
};
const write = (dir, files) => { for (const [f, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), body); } };
const VSCODE_SETTINGS = { "workbench.startupEditor": "none", "telemetry.telemetryLevel": "off", "update.mode": "none", "workbench.tips.enabled": false, "extensions.ignoreRecommendations": true, "chat.disableAIFeatures": true, "workbench.secondarySideBar.defaultVisibility": "hidden", "security.workspace.trust.enabled": false, "workbench.colorTheme": "Dark 2026" };

// Joplin's profile: made once (its first start writes the welcome notes), then copied.
async function joplinTemplate(bin) {
  const dir = path.join(opt.cache, "joplin-profile");
  if (existsSync(path.join(dir, "database.sqlite")) && existsSync(path.join(dir, ".ready"))) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  log("making Joplin's profile (first start)");
  const app = await launchApp({ kind: "joplin", bin: () => bin }, { profile: dir, keep: true });
  await app.page.evaluate(() => { const a = [...document.querySelectorAll(".warning-banner a, .warning-banner span, .warning-banner button")].find(e => /Keep it enabled/.test(e.textContent)); a?.click(); }).catch(() => {});
  await sleep(1500);
  await app.close();
  writeFileSync(path.join(dir, ".ready"), "");
  return dir;
}

async function launchApp(def, { file, profile, keep } = {}) {
  const port = await freePort();
  // A short path: VS Code puts a socket in its profile folder, and those are limited to 107 characters.
  const tmp = path.join(os.tmpdir().length > 40 ? "/tmp" : os.tmpdir(), "morse-design", `${def.kind}-${port}`);
  mkdirSync(tmp, { recursive: true });
  const env = { ...process.env, DISPLAY: opt.display };
  let args, cwd = tmp;
  if (def.kind === "vscode") {
    write(path.join(tmp, "ws"), WORKSPACE);
    write(path.join(tmp, "ud", "User"), { "settings.json": JSON.stringify(VSCODE_SETTINGS, null, 1) });
    args = ["--no-sandbox", `--user-data-dir=${tmp}/ud`, `--extensions-dir=${tmp}/ext`, "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", `--remote-debugging-port=${port}`, `${tmp}/ws`, `${tmp}/ws/${file || "notes.md"}`];
  } else if (def.kind === "obsidian") {
    write(path.join(tmp, "vault"), VAULT);
    write(path.join(tmp, "vault", ".obsidian"), { "workspace.json": '{"lastOpenFiles":["Welcome.md"]}', "appearance.json": '{"theme":"obsidian"}' });
    write(path.join(tmp, "cfg", "obsidian"), { "obsidian.json": JSON.stringify({ vaults: { a1b2c3d4e5f6a7b8: { path: `${tmp}/vault`, ts: 1761300000000, open: true } }, updateDisabled: true }) });
    env.XDG_CONFIG_HOME = path.join(tmp, "cfg");
    args = ["--no-sandbox", `--remote-debugging-port=${port}`];
  } else {
    const prof = profile || path.join(tmp, "profile");
    if (!profile) cpSync(await joplinTemplate(def.bin()), prof, { recursive: true });
    args = ["--no-sandbox", `--remote-debugging-port=${port}`, "--profile", prof];
  }
  const child = spawn(def.bin(), args, { cwd, env, stdio: "ignore", detached: true });
  const close = async () => {
    try { await browser?.close(); } catch {}
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    await sleep(500);
    if (!keep && !process.env.DESIGN_DEBUG) rmSync(tmp, { recursive: true, force: true });
  };
  let browser;
  let why = "";
  for (let i = 0; i < 90 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 }); } catch (e) { why = e.message.split("\n")[0]; await sleep(1000); } }
  if (process.env.DESIGN_DEBUG) log(`${def.kind} on ${port}: ${browser ? "connected" : why}`);
  if (!browser) { await close(); throw new Error(`${def.kind}: couldn't connect`); }
  const READY = { vscode: ".part.statusbar .statusbar-item", obsidian: ".workspace-leaf.mod-active .cm-content", joplin: "[role=option]" };
  let page = null;
  for (let i = 0; i < 90 && !page; i++) {
    for (const p of browser.contexts().flatMap(c => c.pages())) {
      if (/devtools|plugin_index/.test(p.url())) continue;
      if (await p.evaluate(s => !!document.querySelector(s), READY[def.kind]).catch(() => false)) { page = p; break; }
    }
    if (!page) await sleep(1000);
  }
  if (!page) { await close(); throw new Error(`${def.kind}: the window never got ready`); }
  await sleep(2500); // first renders, notifications
  if (def.kind === "vscode") {
    // Close the notifications (running as root, extensions) so they don't sit on the status bar.
    for (let i = 0; i < 3; i++) {
      const n = await page.evaluate(() => { const b = [...document.querySelectorAll(".notifications-toasts .codicon-notifications-clear")]; b.forEach(x => x.click()); return b.length; }).catch(() => 0);
      if (!n) break;
      await sleep(600);
    }
  }
  return { page, browser, close, tmp, port, kind: def.kind };
}

// ---------------------------------------------------------------- sites (recorded once, replayed)
let siteBrowser = null;
async function openSite(c) {
  siteBrowser ||= await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const har = path.join(opt.cache, "sites", `${c.url.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_")}.har`);
  const record = !c._recorded && (opt["record-sites"] || !existsSync(har));
  mkdirSync(path.dirname(har), { recursive: true });
  const ctx = await siteBrowser.newContext({ viewport: { width: 1280, height: 800 }, ...(record ? { recordHar: { path: har, content: "embed" } } : {}) });
  if (!record) await ctx.routeFromHAR(har, { notFound: "abort" });
  const page = await ctx.newPage();
  await page.addInitScript(stubs);
  await page.goto(c.url, { waitUntil: "load", timeout: 60000 });
  await sleep(2500);
  if (record) { await ctx.close(); log(`recorded ${c.url}`); return openSite({ ...c, _recorded: true }); }
  return { page, close: () => ctx.close(), kind: "site" };
}

// ---------------------------------------------------------------- theme switch (where the eval can)
async function flipTheme(t, c) {
  if (t.kind === "vscode") {
    const f = path.join(t.tmp, "ud", "User", "settings.json");
    const s = JSON.parse(readFileSync(f, "utf8"));
    s["workbench.colorTheme"] = s["workbench.colorTheme"] === "Dark 2026" ? "Light 2026" : "Dark 2026";
    writeFileSync(f, JSON.stringify(s, null, 1));
    for (let i = 0; i < 20; i++) { await sleep(500); if (await t.page.evaluate(want => document.querySelector(".monaco-workbench")?.classList.contains(want), s["workbench.colorTheme"] === "Light 2026" ? "vs" : "vs-dark")) break; }
    await sleep(800);
    return true;
  }
  if (t.kind === "obsidian") {
    await t.page.evaluate(() => { const b = document.body; const dark = b.classList.contains("theme-dark"); b.classList.toggle("theme-dark", !dark); b.classList.toggle("theme-light", dark); });
    await sleep(600);
    return true;
  }
  if (t.kind === "site" && c.flip) { await t.page.evaluate(c.flip); await sleep(800); return true; }
  return false;
}

// ---------------------------------------------------------------- one run
async function runOne(c, armName) {
  const arm = ARMS[armName]();
  const code = await codeFor(arm.dir);
  const rec = { id: c.id, arm: armName, app: c.app, request: c.request, target: c.target };
  const shot = name => path.join(OUT, `${c.id}--${armName}--${name}.jpg`);
  let t;
  try { t = c.app === "site" ? await openSite(c) : await launchApp(APPS[c.app], { file: c.file }); }
  catch (e) { return { ...rec, pass: false, why: "error: " + String(e.message || e).split("\n")[0] }; }
  const { page } = t;
  const modId = `design-${c.id}-${armName}`;
  try {
    if (t.kind !== "site") await page.evaluate(stubs);
    const iso = await isolatedWorld(page);
    await iso(installContext(code.src));
    await iso(installArea);
    const J = JSON.stringify, area = () => iso(`__designArea(${J(c.target || null)}, ${J(modId)})`);
    for (const [name, fn] of [["__evalClick", (x, y) => page.mouse.click(x, y)], ["__evalType", s => page.keyboard.type(s, { delay: 5 })], ["__evalPress", k => page.keyboard.press(k)], ["__evalMove", (x, y) => page.mouse.move(x, y)], ["__evalRerun", () => page.evaluate(code.wrapModCode(modId, rec.js || "")).then(() => true)]]) {
      await page.exposeFunction(name, fn).catch(() => {});
    }
    const wholeShot = async name => { await page.screenshot({ path: shot(name), type: "jpeg", quality: 85 }); return shot(name); };
    rec.shots = { before: await wholeShot("before") };
    const { c: context, ms: ctxMs } = await iso(`__morseEval.context(${J(c.target || null)})`);
    rec.ctxMs = Math.round(ctxMs);
    rec.promptChars = code.buildMessages({ request: c.request, context }).map(m => typeof m.content === "string" ? m.content : "").join("").length;
    await page.evaluate(() => { window.__orig = new WeakSet(window.__roots().flatMap(r => [...r.querySelectorAll("*")])); });
    await page.evaluate(helpers);
    await page.evaluate(designChecks);
    await page.evaluate(() => { window.__pseudo0 = T.pseudoTexts(); });
    const B = c.before ? await page.evaluate(`(async () => { ${[].concat(c.before).join("\n")} })()`) : null;

    let cssApplied = Promise.resolve();
    const exec = async js => {
      let r;
      try { r = await page.evaluate(code.wrapModCode(modId, js)); }
      catch (e) { return { ok: false, error: String(e.message || e).split("\n")[0].replace(/^page\.evaluate: /, "") }; }
      if (!r?.ok) return r || { ok: false, error: "no result" };
      await sleep(code.settleMs(r));
      const errs = await page.evaluate(id => morse.__errors(id), modId);
      return errs.length ? { ok: false, error: errs[0].split("\n")[0] } : { ok: true };
    };
    const review = async () => {
      await cssApplied;
      await sleep(300);
      const a = await area();
      if (!a) return null;
      const buf = await page.screenshot({ type: "jpeg", quality: 85, clip: { x: a.x, y: a.y, width: a.width, height: a.height } });
      writeFileSync(shot("review"), buf);
      return { mediaType: "image/jpeg", data: buf.toString("base64") };
    };
    const t0 = Date.now();
    const res = await code.runMorse({
      settings: { provider: "claude-code", model: opt.model, pinned: true, timeoutMs: 180_000 },
      request: c.request, context, exec, polish: arm.polish, review,
      emit: ev => {
        if (ev.type !== "css") return;
        cssApplied = page.evaluate(([id, css]) => {
          let s = document.head.querySelector(`style[data-morse-css="${id}"]`);
          if (!s) { s = document.createElement("style"); s.setAttribute("data-morse-css", id); document.head.append(s); }
          s.textContent = css;
        }, [modId, ev.css]).catch(() => {});
      },
      probe: async sels => { await cssApplied; await sleep(80); return iso(`__morseEval.probe ? __morseEval.probe(${J(c.target || null)}, ${J(sels)}) : null`); },
    });
    await cssApplied;
    Object.assign(rec, { ms: Date.now() - t0, ok: res.ok, error: res.error || null, title: res.title, css: res.css, js: res.js, attempts: res.attempts, repairs: res.repairs || [], polish: res.polish || null, model: res.model });
    await sleep(800);
    rec.shots.after = await wholeShot("after");
    rec.area = await area();
    if (await flipTheme(t, c)) {
      rec.shots.flip = await wholeShot("flip");
      await flipTheme(t, c);
      await sleep(400);
    }
    const verdict = await Promise.race([
      page.evaluate(`(async () => { const B = ${JSON.stringify(B)}; ${[].concat(c.check).join("\n")} })()`),
      sleep(30000).then(() => "checker timed out"),
    ]).catch(e => "checker error: " + String(e.message || e).split("\n")[0]);
    rec.pass = verdict === true;
    if (!rec.pass) rec.why = String(verdict);
    rec.pageErrors = await page.evaluate(id => (window.morse?.__errors?.(id) || []).slice(0, 3), modId).catch(() => []);
  } catch (e) {
    rec.pass = false;
    rec.why = "error: " + String(e.message || e).split("\n")[0];
  } finally {
    await t.close().catch(() => {});
  }
  return rec;
}

// ---------------------------------------------------------------- the judge
let cropPage = null;
async function crop(file, clip) {
  cropPage ||= await (siteBrowser ||= await chromium.launch()).newPage();
  const data = readFileSync(file).toString("base64");
  return cropPage.evaluate(async ([src, c]) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const k = Math.min(1, 1280 / c.width, 900 / c.height);
    const cv = document.createElement("canvas");
    cv.width = Math.round(c.width * k); cv.height = Math.round(c.height * k);
    cv.getContext("2d").drawImage(img, c.x, c.y, c.width, c.height, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.85).split(",")[1];
  }, [`data:image/jpeg;base64,${data}`, clip]);
}
// One area for all versions of a case: what each version changed, together.
function unionArea(recs) {
  const as = recs.map(r => r.area).filter(Boolean);
  if (!as.length) return null;
  const x0 = Math.min(...as.map(a => a.x)), y0 = Math.min(...as.map(a => a.y));
  const x1 = Math.max(...as.map(a => a.x + a.width)), y1 = Math.max(...as.map(a => a.y + a.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
const trim = (s, n) => { s = String(s || "").trim(); return s.length > n ? s.slice(0, n) + "\n…" : s || "(none)"; };
async function judgeCase(c, recs) {
  const { streamChat } = await import(pathToFileURL(path.join(ROOT, "core", "providers.js")).href);
  await import(pathToFileURL(path.join(ROOT, "daemon", "harness.js")).href);
  const area = unionArea(recs);
  const labels = "ABCDEFG".split("");
  const order = shuffled(recs, c.id);
  const images = [], lines = [];
  const add = async (file, what) => { if (!file || !existsSync(file)) return; images.push(area ? await crop(file, area) : readFileSync(file).toString("base64")); lines.push(`Picture ${images.length}: ${what}`); };
  await add(order[0].shots?.before, "the app before the change");
  for (const [i, r] of order.entries()) {
    await add(r.shots?.after, `version ${labels[i]}, after the change`);
    await add(r.shots?.flip, `version ${labels[i]}, the same after switching the app to its other theme (light/dark)`);
  }
  const text = [
    `App: ${c.app === "site" ? c.url : APPS[c.app].name}`,
    `Request: "${c.request}"${c.target ? " (the person pointed at a part of the app)" : ""}`,
    lines.join("\n"),
    ...order.map((r, i) => `Version ${labels[i]} code${r.ok ? "" : " (the tool reported it failed)"}:\n\`\`\`css\n${trim(r.css, 1800)}\n\`\`\`\n\`\`\`js\n${trim(r.js, 2600)}\n\`\`\``),
    `Score versions ${labels.slice(0, order.length).join(", ")}.`,
  ].join("\n\n");
  const messages = [{ role: "system", content: JUDGE_PROMPT }, { role: "user", content: [...images.map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })), { type: "text", text }] }];
  let lastErr;
  for (let k = 0; k < 2; k++) {
    try {
      const reply = await streamChat({ provider: "claude-code", model: opt.judge, pinned: true, timeoutMs: 300_000 }, messages, {});
      const v = parseVerdict(reply, labels.slice(0, order.length));
      order.forEach((r, i) => { r.judge = v[labels[i]]; r.judge.mean = +mean(v[labels[i]]).toFixed(2); r.judgeLabel = labels[i]; });
      return;
    } catch (e) { lastErr = e; }
  }
  for (const r of recs) r.judgeError = String(lastErr?.message || lastErr);
}

// ---------------------------------------------------------------- summary
const pct = (xs, p) => { const a = xs.filter(x => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null; };
function summarize(results, arms) {
  const rows = [];
  for (const a of arms) {
    const rs = results.filter(r => r.arm === a), judged = rs.filter(r => r.judge);
    const avg = k => judged.length ? +(judged.reduce((s, r) => s + r.judge[k], 0) / judged.length).toFixed(2) : null;
    const row = { arm: a, n: rs.length, works: rs.filter(r => r.pass).length, judged: judged.length };
    for (const [k] of RUBRIC) row[k] = avg(k);
    row.mean = judged.length ? +(judged.reduce((s, r) => s + r.judge.mean, 0) / judged.length).toFixed(2) : null;
    row.msMedian = pct(rs.map(r => r.ms), 0.5); row.msP90 = pct(rs.map(r => r.ms), 0.9);
    const pol = rs.filter(r => r.polish);
    row.polished = pol.length; row.polishFixed = pol.filter(r => r.polish.verdict === "fixed").length;
    row.polishMsMedian = pct(pol.map(r => r.polish.ms), 0.5);
    rows.push(row);
  }
  return rows;
}
function table(rows) {
  const head = ["arm", "works", ...RUBRIC.map(([k]) => k), "mean", "time median / p90", "polish rounds (fixed), median"];
  const out = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${r.arm} | ${r.works}/${r.n} | ${RUBRIC.map(([k]) => r[k] ?? "-").join(" | ")} | **${r.mean ?? "-"}** | ${(r.msMedian / 1000).toFixed(1)} s / ${(r.msP90 / 1000).toFixed(1)} s | ${r.polished ? `${r.polished} (${r.polishFixed}), ${(r.polishMsMedian / 1000).toFixed(1)} s` : "-"} |`);
  return out.join("\n");
}

// ---------------------------------------------------------------- main
let results, arms;
if (opt["judge-only"]) {
  const saved = JSON.parse(readFileSync(opt["judge-only"], "utf8"));
  results = saved.results; arms = saved.arms;
} else {
  arms = opt.arms.split(",").map(s => s.trim()).filter(Boolean);
  if (arms.includes("baseline") && !opt.baseline) throw new Error("--baseline <dir>: a checkout of the code to compare against (git worktree add <dir> <commit>)");
  let cases = CASES;
  if (opt.only) { const ids = opt.only.split(","); cases = cases.filter(c => ids.includes(c.id)); }
  if (opt.apps) { const apps = opt.apps.split(","); cases = cases.filter(c => apps.includes(c.app)); }
  // Sites are recorded before anything runs, so every arm replays the same page.
  for (const c of cases.filter(c => c.app === "site")) { const s = await openSite(c); await s.close(); }
  const jobs = cases.flatMap(c => arms.map(a => [c, a]));
  results = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [c, a] = jobs[next++];
      log(`start ${c.id} ${a}`);
      let r = await runOne(c, a);
      if (/^error: (Claude Code|.*couldn't connect|.*never got ready)/.test(r.why || "")) { log(`retry ${c.id} ${a}: ${r.why}`); r = await runOne(c, a); }
      results.push(r);
      log(`${r.pass ? "WORKS" : "FAILS"} ${c.id.padEnd(22)} ${a.padEnd(8)} ${((r.ms || 0) / 1000).toFixed(1)}s${r.polish ? ` polish ${r.polish.verdict} ${(r.polish.ms / 1000).toFixed(1)}s` : ""} ${r.pass ? "" : r.why?.slice(0, 120)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, +opt.concurrency) }, worker));
}
if (opt.judge !== "none") {
  const ids = [...new Set(results.map(r => r.id))];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++], c = CASES.find(x => x.id === id), recs = results.filter(r => r.id === id);
      await judgeCase(c, recs);
      log(`judged ${id}: ${recs.map(r => `${r.arm} ${r.judge?.mean ?? r.judgeError?.slice(0, 60)}`).join(", ")}`);
    }
  };
  await Promise.all(Array.from({ length: 2 }, worker));
}
await siteBrowser?.close().catch(() => {});
const rows = summarize(results, arms);
const file = opt["judge-only"] && opt.judge === "none" ? null : path.join(HERE, "results", `${stamp}${opt.label ? "-" + opt.label.replace(/\W+/g, "-") : ""}.json`);
if (file) {
  mkdirSync(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ startedAt: stamp, label: opt.label, model: opt.model, judge: opt.judge, arms, shots: OUT, summary: rows, results }, null, 1));
  console.log("wrote", path.relative(ROOT, file));
}
console.log("\n" + table(rows));
process.exit(0);
