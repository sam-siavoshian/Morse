#!/usr/bin/env node
// The gallery mods (site/mods/): make them with a real model on the real page
// (or demo app), and check them the way evals/run.js checks a change.
//
//   node evals/gallery.js --generate [--only a,b]   ask Claude Code (sonnet) for each case's
//                                                   request on its page, check the result, write
//                                                   evals/results/gallery-drafts/<id>.morse.json
//   node evals/gallery.js --verify [--only a,b]     check the mods in site/mods/ as saved:
//                                                   fails without the mod, passes with it, passes
//                                                   again after a reload
//   --verify --dir evals/results/gallery-drafts      check drafts instead
//   --demo-only / --real-only                       only the demo apps, or only real websites
//   SHOTS=dir                                       before/after pictures (JPEG) while verifying
//
// Cases: evals/gallery-cases.json (see evals/gallery-check.js). Real websites
// go through $HTTPS_PROXY. Writes evals/results/gallery-<timestamp>.json.

import http from "node:http";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { runMorse } from "../core/engine.js";
import { wrapModCode, settleMs } from "../core/kit.js";
import { setWarmPoolSize } from "../daemon/harness.js"; // registers the claude-code provider
import { prewarm } from "../core/providers.js";
import { openPage, prepare, runCheck, verifyMod, hostFor, pageUrl, loadCases } from "./gallery-check.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HERE = path.join(ROOT, "evals");

const { values: opt } = parseArgs({ options: {
  generate: { type: "boolean", default: false },
  verify: { type: "boolean", default: false },
  only: { type: "string", default: "" },
  model: { type: "string", default: "sonnet" },
  provider: { type: "string", default: "claude-code" },
  concurrency: { type: "string", default: "3" },
  "demo-only": { type: "boolean", default: false },
  "real-only": { type: "boolean", default: false },
  out: { type: "string", default: path.join(HERE, "results", "gallery-drafts") },
  dir: { type: "string", default: path.join(ROOT, "site", "mods") }, // --verify: where the mods are
} });

let cases = loadCases();
if (opt.only) { const ids = opt.only.split(","); cases = cases.filter(c => ids.includes(c.id)); }
if (opt["demo-only"]) cases = cases.filter(c => c.site);
if (opt["real-only"]) cases = cases.filter(c => !c.site);
if (opt.generate) cases = cases.filter(c => !c.existing); // made before this list: verify only
const settings = { provider: opt.provider, model: opt.model };
setWarmPoolSize(Math.min(+opt.concurrency, 4));

// ---- the demo apps (CSP like demo/serve.js) ---------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".gif": "image/gif", ".webm": "video/webm", ".svg": "image/svg+xml" };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html");
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(path.join(ROOT, "demo", "sites"))) { res.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" };
    if (p.startsWith("/demo/sites/parley/")) headers["Content-Security-Policy"] = "script-src 'self'";
    res.writeHead(200, headers).end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const CONTEXT_SRC = readFileSync(path.join(ROOT, "runtime", "src", "20-context.js"), "utf8").split(/\nconst hostEl\b/)[0];
const INSTALL_CONTEXT = `(() => {
  const S = { app: null, target: null };
  ${CONTEXT_SRC}
  window.__morseEval = {
    context(sel) {
      S.target = sel ? window.__deep(sel)[0] || null : null;
      if (sel && !S.target) throw new Error("target not found: " + sel);
      return context();
    },
    probe: typeof effectProbe === "function" ? effectProbe : null,
  };
})()`;

const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({ ...(proxy ? { proxy: { server: proxy, bypass: "127.0.0.1,localhost" } } : {}) });

export function modFor(c, { css, js, title }, model) {
  const now = new Date().toISOString();
  return {
    morse: 1,
    id: c.id,
    title: c.title || title,
    prompt: c.request,
    match: { hosts: [hostFor(c)], app: null },
    target: c.target && c.label ? { selector: c.target, label: c.label } : null,
    css: css || "",
    js: js || "",
    enabled: true,
    model,
    version: 1,
    author: "Morse team",
    created: now,
    updated: now,
  };
}

async function generate(c) {
  const rec = { id: c.id, request: c.request, url: pageUrl(c, BASE) };
  const { ctx, page } = await openPage(browser, c, BASE);
  try {
    await page.evaluate(INSTALL_CONTEXT);
    prewarm(settings);
    const context = await page.evaluate(sel => window.__morseEval.context(sel), c.target || null);
    const B = await prepare(page, c);
    const id = `gallery-${c.id}`;
    let cssApplied = Promise.resolve();
    const t0 = Date.now();
    const res = await runMorse({
      settings, request: c.request, context,
      emit: ev => {
        if (ev.type !== "css") return;
        cssApplied = page.evaluate(([id, css]) => {
          let s = document.head.querySelector(`style[data-morse-css="${id}"]`);
          if (!s) { s = document.createElement("style"); s.setAttribute("data-morse-css", id); document.head.append(s); }
          s.textContent = css;
        }, [id, ev.css]).catch(() => {});
      },
      exec: async js => {
        let r;
        try { r = await page.evaluate(wrapModCode(id, js)); }
        catch (e) { return { ok: false, error: String(e.message || e).split("\n")[0].replace(/^page\.evaluate: /, "") }; }
        if (!r?.ok) return r || { ok: false, error: "no result" };
        await page.waitForTimeout(settleMs(r));
        const errs = await page.evaluate(id => morse.__errors(id), id);
        return errs.length ? { ok: false, error: errs[0].split("\n")[0] } : { ok: true };
      },
      probe: async sels => { await cssApplied; await page.waitForTimeout(80); return page.evaluate(([t, s]) => window.__morseEval.probe?.(t, s), [c.target || null, sels]); },
    });
    await cssApplied;
    rec.ms = Date.now() - t0;
    Object.assign(rec, { title: res.title, attempts: res.attempts, engineOk: res.ok, engineError: res.error || null });
    await page.waitForTimeout(300);
    rec.live = await runCheck(page, c, B);
    rec.mod = modFor(c, res, `${opt.provider}:${opt.model}`);
  } catch (e) {
    rec.live = "error: " + String(e.message || e).split("\n")[0];
  } finally {
    await ctx.close();
  }
  if (rec.mod && (rec.mod.css.trim() || rec.mod.js.trim())) {
    rec.verify = await verifyMod(browser, c, rec.mod, BASE);
    rec.pass = rec.live === true && rec.verify.pass;
    await fs.mkdir(opt.out, { recursive: true });
    await fs.writeFile(path.join(opt.out, `${c.id}.morse.json`), JSON.stringify({ ...rec.mod, checked: { live: rec.live, verify: rec.verify } }, null, 2) + "\n");
  } else rec.pass = false;
  return rec;
}

async function verify(c) {
  const file = path.join(path.resolve(opt.dir), `${c.id}.morse.json`);
  let mod;
  try { mod = JSON.parse(await fs.readFile(file, "utf8")); } catch { return { id: c.id, pass: false, why: "no mod file" }; }
  let shots;
  if (process.env.SHOTS) {
    const dir = path.resolve(process.env.SHOTS);
    await fs.mkdir(dir, { recursive: true });
    const snap = name => async page => { await page.evaluate(() => scrollTo(0, 0)); if (c.shot) await page.evaluate(`(async () => { ${[].concat(c.shot).join("\n")} })()`); await page.waitForTimeout(500); await page.screenshot({ path: path.join(dir, `${c.id}-${name}.jpg`), type: "jpeg", quality: 82 }); };
    shots = { before: snap("before"), after: snap("after") };
  }
  return verifyMod(browser, c, mod, BASE, { shots });
}

const results = [];
let next = 0;
const started = new Date();
async function worker() {
  while (next < cases.length) {
    const c = cases[next++];
    let rec = opt.generate ? await generate(c) : await verify(c);
    // A real website can be slow or briefly unreachable: one more try.
    if (!rec.pass && /error: .*(Timeout|net::|Claude Code:|took longer)/.test(JSON.stringify(rec))) rec = opt.generate ? await generate(c) : await verify(c);
    results.push(rec);
    const why = rec.pass ? "" : (rec.why || (rec.live !== true ? "live: " + rec.live : "verify: " + rec.verify?.why) || "");
    console.log(`${rec.pass ? "PASS" : "FAIL"} ${c.id.padEnd(28)} ${rec.ms ? (rec.ms / 1000).toFixed(1) + "s" : ""} ${String(why).slice(0, 160)}`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, +opt.concurrency) }, worker));
await browser.close();
server.close();
const pass = results.filter(r => r.pass).length;
console.log(`\n${pass}/${results.length} passed`);
const stamp = started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
await fs.mkdir(path.join(HERE, "results"), { recursive: true });
const file = path.join(HERE, "results", `gallery-${opt.generate ? "generate" : "verify"}-${stamp}.json`);
await fs.writeFile(file, JSON.stringify({ startedAt: started.toISOString(), mode: opt.generate ? "generate" : "verify", model: `${opt.provider}:${opt.model}`, pass, total: results.length, results }, null, 2));
console.log("wrote", path.relative(ROOT, file));
process.exit(0);
