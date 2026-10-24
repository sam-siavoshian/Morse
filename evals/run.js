#!/usr/bin/env node
// Morse eval: does the model's change actually do what was asked?
//
// For each case in evals/cases.json: open the demo site in Chromium, build the
// exact context the runtime sends (runtime/src/20-context.js, evaluated in the
// page), run the real engine (core/engine.js runMorse) against a real model,
// apply the CSS/JS the way the hosts do (style tag + wrapModCode through the
// helper kit), then run the case's checker in the page.
//
//   node evals/run.js                        train split, Claude Code haiku
//   node evals/run.js --split test           held-out cases (final report only)
//   node evals/run.js --split all --model sonnet --label "sonnet spot check"
//   node evals/run.js --only t-covers-bigger,b-hide-ads --repeat 3
//   node evals/run.js --no-probe             engine without the visible-effect check
//
// Writes evals/results/<timestamp>.json and appends a row to evals/README.md.

import http from "node:http";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { runMorse } from "../core/engine.js";
import { wrapModCode, settleMs } from "../core/kit.js";
import { buildMessages } from "../core/prompt.js";
import { setWarmPoolSize } from "../daemon/harness.js"; // registers the claude-code provider
import { registerProvider, prewarm } from "../core/providers.js";
import { stubs, helpers } from "./page-helpers.js";

// "noop": an empty change, to check that every checker fails on the untouched page.
registerProvider("noop", async () => "TITLE: Nothing\n```css\n/* nothing */\n```\n");

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HERE = path.join(ROOT, "evals");

const { values: opt } = parseArgs({ options: {
  split: { type: "string", default: "train" },
  model: { type: "string", default: "haiku" },
  provider: { type: "string", default: "claude-code" },
  only: { type: "string", default: "" },
  repeat: { type: "string", default: "1" },
  concurrency: { type: "string", default: "4" },
  label: { type: "string", default: "" },
  "no-probe": { type: "boolean", default: false },
  "no-write": { type: "boolean", default: false },
  "dump-context": { type: "boolean", default: false },
  // speed: like a person, the bar opens (and the model gets ready) this long
  // before Enter. --typing-ms 0 measures a request with no head start.
  "typing-ms": { type: "string", default: "2500" },
  effort: { type: "string", default: "" },
} });

const all = JSON.parse(readFileSync(path.join(HERE, "cases.json"), "utf8")).cases;
let cases = all.filter(c => opt.split === "all" || (c.split || "train") === opt.split);
if (opt.only) { const ids = opt.only.split(","); cases = all.filter(c => ids.includes(c.id)); }
const repeat = Math.max(1, +opt.repeat);
const settings = { provider: opt.provider, model: opt.model, ...(opt.effort && { effort: opt.effort }) };
setWarmPoolSize(Math.min(+opt.concurrency, 4)); // each case is its own person with its own bar

// ---- static server for the demo sites (CSP like demo/serve.js) -------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
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

// The runtime's context builder, evaluated in the page with a minimal state
// object: the same functions the extension and desktop runtime call.
const CONTEXT_SRC = readFileSync(path.join(ROOT, "runtime", "src", "20-context.js"), "utf8")
  // Only the pure functions: the file's tail mounts the overlay UI.
  .split(/\nconst hostEl\b/)[0];
const INSTALL_CONTEXT = `(() => {
  const S = { app: null, target: null };
  ${CONTEXT_SRC}
  window.__morseEval = {
    context(sel) {
      S.target = sel ? document.querySelector(sel) : null;
      if (sel && !S.target) throw new Error("target not found: " + sel);
      return context();
    },
    timedContext(sel) { const t = performance.now(); const c = this.context(sel); return { c, ms: performance.now() - t }; }, // speed
    probe: typeof effectProbe === "function" ? effectProbe : null,
  };
})()`;

const browser = await chromium.launch();

async function runCase(c, rep) {
  const [w, h] = c.viewport || [1280, 800];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("dialog", d => d.type() === "prompt" ? d.accept("15").catch(() => {}) : d.accept().catch(() => {}));
  page.on("download", async d => {
    try {
      const p = await d.path();
      const text = p ? readFileSync(p, "utf8") : "";
      await page.evaluate(t => window.__downloads.push({ text: t }), text);
    } catch {}
  });
  await page.addInitScript(stubs);
  await page.exposeFunction("__evalClick", (x, y) => page.mouse.click(x, y));
  await page.exposeFunction("__evalType", t => page.keyboard.type(t, { delay: 5 }));
  await page.exposeFunction("__evalPress", k => page.keyboard.press(k));

  const rec = { id: c.id, rep, site: c.site, category: c.category, split: c.split || "train", request: c.request, target: c.target };
  const t0 = Date.now();
  try {
    await page.goto(`${BASE}/demo/sites/${c.site}/`, { waitUntil: "load" });
    await page.evaluate(INSTALL_CONTEXT);
    // speed: the bar opens, the person points and types, then presses Enter.
    if (+opt["typing-ms"] > 0) { prewarm(settings); await page.waitForTimeout(+opt["typing-ms"]); }
    const tEnter = Date.now();
    const { c: context, ms: ctxMs } = await page.evaluate(sel => window.__morseEval.timedContext(sel), c.target);
    const tCtx = Date.now();
    rec.contextChars = buildMessages({ request: c.request, context }).map(m => m.content).join("").length;
    if (opt["dump-context"]) console.log(`---- ${c.id}\n` + buildMessages({ request: c.request, context })[1].content);
    // Everything that exists now is "original"; checkers can tell new elements apart.
    await page.evaluate(() => { window.__orig = new WeakSet(document.querySelectorAll("*")); });
    await page.evaluate(helpers);
    await page.evaluate(() => { window.__pseudo0 = T.pseudoTexts(); });
    const B = c.before ? await page.evaluate(`(async () => { ${c.before} })()`) : null;

    const modId = `eval-${c.id}`;
    let cssApplied = Promise.resolve(), firstCssAt = null;
    const hasProbe = !opt["no-probe"] && await page.evaluate(() => !!window.__morseEval.probe);
    const res = await runMorse({
      settings, request: c.request, context,
      emit: ev => {
        if (ev.type !== "css") return;
        cssApplied = page.evaluate(([id, css]) => {
          let s = document.head.querySelector(`style[data-morse-css="${id}"]`);
          if (!s) { s = document.createElement("style"); s.setAttribute("data-morse-css", id); document.head.append(s); }
          s.textContent = css;
        }, [modId, ev.css]).then(() => { if (firstCssAt == null && ev.css.trim()) firstCssAt = Date.now(); }, () => {});
      },
      // Same as daemon/connector.js exec: run, then collect late callback errors.
      exec: async js => {
        let r;
        try { r = await page.evaluate(wrapModCode(modId, js)); }
        catch (e) { return { ok: false, error: String(e.message || e).split("\n")[0].replace(/^page\.evaluate: /, "") }; }
        if (!r?.ok) return r || { ok: false, error: "no result" };
        await page.waitForTimeout(settleMs(r)); // speed: core/kit.js settle
        const errs = await page.evaluate(id => morse.__errors(id), modId);
        return errs.length ? { ok: false, error: errs[0].split("\n")[0] } : { ok: true };
      },
      probe: hasProbe ? async sels => { await cssApplied; await page.waitForTimeout(80); return page.evaluate(([t, s]) => window.__morseEval.probe(t, s), [c.target, sels]); } : undefined,
    });
    await cssApplied;
    rec.ms = Date.now() - t0 - Math.max(0, +opt["typing-ms"]); // the typing time is not latency
    // speed: per-stage latency, ms from Enter (context, model, first style on the page, done)
    const tm = res.timing || {}, off = tCtx - tEnter, at = v => (v == null ? null : Math.round(v + off));
    rec.stages = { context: Math.round(ctxMs), contextRoundTrip: off, promptChars: rec.contextChars, spawn: tm.spawn ?? null, warm: tm.warm ?? null,
      modelReady: at(tm.modelReady), firstToken: at(tm.firstToken), firstCss: firstCssAt == null ? null : firstCssAt - tEnter,
      lastToken: at(tm.lastToken), modelDone: at(tm.modelDone), total: Date.now() - tEnter };
    Object.assign(rec, { attempts: res.attempts, title: res.title, css: res.css, js: res.js, engineOk: res.ok, engineError: res.error || null, repairs: res.repairs || [] });
    await page.waitForTimeout(300);
    const verdict = await Promise.race([
      page.evaluate(`(async () => { const B = ${JSON.stringify(B)}; ${[].concat(c.check).join("\n")} })()`),
      new Promise(r => setTimeout(() => r("checker timed out"), 15000)),
    ]);
    rec.pass = verdict === true;
    if (!rec.pass) rec.why = String(verdict);
  } catch (e) {
    rec.ms ??= Date.now() - t0;
    rec.pass = false;
    rec.why = "error: " + String(e.message || e).split("\n")[0];
    rec.infra = /Claude Code:|took longer|ECONN|rate|overloaded|target not found/i.test(rec.why);
  }
  if (pageErrors.length) rec.pageErrors = pageErrors.slice(0, 3);
  await ctx.close();
  return rec;
}

// ---- run with limited parallelism ------------------------------------------
const jobs = [];
for (let r = 0; r < repeat; r++) for (const c of cases) jobs.push([c, r]);
const results = [];
let next = 0, done = 0;
const started = new Date();
async function worker() {
  while (next < jobs.length) {
    const [c, r] = jobs[next++];
    let rec = await runCase(c, r);
    if (rec.infra) rec = await runCase(c, r); // one retry for model/CLI hiccups
    results.push(rec);
    done++;
    const mark = rec.pass ? "PASS" : "FAIL";
    console.log(`[${String(done).padStart(3)}/${jobs.length}] ${mark} ${c.id.padEnd(18)} ${String(rec.attempts ?? "-")}x ${((rec.ms || 0) / 1000).toFixed(1)}s ${rec.pass ? "" : rec.why?.slice(0, 100)}`);
  }
}
await Promise.all(Array.from({ length: Math.min(+opt.concurrency, 4) }, worker));
await browser.close();
server.close();

results.sort((a, b) => a.id.localeCompare(b.id) || a.rep - b.rep);
const pass = results.filter(r => r.pass).length;
const lat = results.map(r => r.ms || 0).sort((a, b) => a - b);
const median = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
const summary = {
  label: opt.label, model: `${opt.provider}:${opt.model}`, split: opt.only ? "only" : opt.split, probe: !opt["no-probe"],
  cases: results.length, pass, rate: +(pass / Math.max(1, results.length)).toFixed(3), medianMs: median,
  byCategory: Object.fromEntries([...new Set(results.map(r => r.category))].sort().map(k => {
    const rs = results.filter(r => r.category === k);
    return [k, `${rs.filter(r => r.pass).length}/${rs.length}`];
  })),
};
// speed: median and p90 per stage
const pct = (xs, p) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] : null;
summary.stages = {};
for (const k of ["context", "promptChars", "spawn", "modelReady", "firstToken", "firstCss", "lastToken", "modelDone", "total"]) {
  const xs = results.map(r => r.stages?.[k]).filter(v => v != null).sort((a, b) => a - b);
  summary.stages[k] = { n: xs.length, median: pct(xs, 0.5), p90: pct(xs, 0.9) };
}
console.log("stage            n   median     p90");
for (const [k, v] of Object.entries(summary.stages)) console.log(`${k.padEnd(14)} ${String(v.n).padStart(3)} ${String(v.median ?? "-").padStart(8)} ${String(v.p90 ?? "-").padStart(7)}`);
console.log(`\n${pass}/${results.length} passed (${(summary.rate * 100).toFixed(0)}%), median ${(median / 1000).toFixed(1)}s`);
console.log(summary.byCategory);

if (!opt["no-write"]) {
  const stamp = started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await fs.mkdir(path.join(HERE, "results"), { recursive: true });
  const file = path.join(HERE, "results", `${stamp}.json`);
  await fs.writeFile(file, JSON.stringify({ startedAt: started.toISOString(), summary, results }, null, 2));
  console.log("wrote", path.relative(ROOT, file));
  // One line per run in the README's run log.
  const readme = path.join(HERE, "README.md");
  let md = "";
  try { md = await fs.readFile(readme, "utf8"); } catch {}
  const MARK = "<!-- run-log -->";
  if (md.includes(MARK)) {
    const row = `| ${started.toISOString().slice(0, 16).replace("T", " ")} | ${opt.label || "-"} | ${summary.model} | ${summary.split} | ${pass}/${results.length} (${(summary.rate * 100).toFixed(0)}%) | ${(median / 1000).toFixed(1)}s |`;
    await fs.writeFile(readme, md.replace(MARK, `${row}\n${MARK}`));
  }
}
