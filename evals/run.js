#!/usr/bin/env node
// Morse eval: does the model's change actually do what was asked?
//
// For each case in evals/cases.json: open the demo site in Chromium, build the
// exact context the runtime sends (runtime/src/20-context.js, evaluated in the
// page), run the real engine (core/engine.js runMorse) against a real model,
// apply the CSS/JS the way the hosts do (style tag + wrapModCode through the
// helper kit), then run the case's checker in the page.
//
//   node evals/run.js                        train split, Claude Code, Automatic (what people get)
//   node evals/run.js --split test           held-out cases (final report only)
//   node evals/run.js --split all --model opus --label "opus spot check"
//   node evals/run.js --only t-covers-bigger,b-hide-ads --repeat 3
//   node evals/run.js --no-probe             engine without the visible-effect check
//   node evals/run.js --model sonnet,opus,auto --concurrency 2
//                                            models side by side, interleaved case by case so
//                                            each sees the same load; "auto" is Automatic (core/route.js:
//                                            sonnet for small tweaks, opus for new UI, features,
//                                            restyles and failed drafts), "fast"/"best" the two
//                                            tiers; any other name is that one model
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
import { registerProvider, prewarm, settingsLabel } from "../core/providers.js";
import { resolveTiers, MODEL_MODES } from "../core/route.js"; // models: Automatic
import { stubs, helpers } from "./page-helpers.js";
import EN from "../core/locales/en.js"; // the words the context uses (core/i18n.js t())

// "noop": an empty change, to check that every checker fails on the untouched page.
registerProvider("noop", async () => "TITLE: Nothing\n```css\n/* nothing */\n```\n");

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HERE = path.join(ROOT, "evals");

const { values: opt } = parseArgs({ options: {
  split: { type: "string", default: "train" },
  model: { type: "string", default: "auto" },
  provider: { type: "string", default: "claude-code" },
  only: { type: "string", default: "" },
  sites: { type: "string", default: "" }, // e.g. the hard apps: shop,home,builder,logs,tasks,sketch,wiki
  repeat: { type: "string", default: "1" },
  concurrency: { type: "string", default: "4" },
  label: { type: "string", default: "" },
  "no-probe": { type: "boolean", default: false },
  "no-write": { type: "boolean", default: false },
  "dump-context": { type: "boolean", default: false },
  "context-only": { type: "boolean", default: false },
  // speed: like a person, the bar opens (and the model gets ready) this long
  // before Enter. --typing-ms 0 measures a request with no head start.
  "typing-ms": { type: "string", default: "2500" },
  effort: { type: "string", default: "" },
  polish: { type: "boolean", default: false }, // "Polish changes" on: one look at a change that adds or restyles something (core/polish.js)
} });

// Named groups for --sites.
const HARD = { hard: "shop,home,builder,logs,tasks,sketch,wiki", easy: "tunes,parley,byte,mail,notes,dash" };
const all = JSON.parse(readFileSync(path.join(HERE, "cases.json"), "utf8")).cases;
let cases = all.filter(c => opt.split === "all" || (c.split || "train") === opt.split);
if (opt.sites) { const sites = (HARD[opt.sites] || opt.sites).split(","); cases = cases.filter(c => sites.includes(c.site)); }
if (opt.only) { const ids = opt.only.split(","); cases = all.filter(c => ids.includes(c.id)); }
const repeat = Math.max(1, +opt.repeat);
// One settings object per arm. A mode ("auto", "fast", "best") routes between
// the provider's two models; a model name is that model for every request.
const arms = opt.model.split(",").map(s => s.trim()).filter(Boolean);
const armSettings = Object.fromEntries(arms.map(a => [a, {
  provider: opt.provider, ...(opt.effort && { effort: opt.effort }), pool: a,
  ...(MODEL_MODES.includes(a) ? { model: "", mode: a, tiers: resolveTiers(opt.provider), pinned: false } : { model: a, pinned: true }),
}]));
// Each case is its own person with its own bar: one case's warm-as-you-type
// for the strong model doesn't stop the first model waiting for another case.
setWarmPoolSize(Math.min(+opt.concurrency, 4), { keepOthers: arms.length > 1 || arms.includes("auto") });

// ---- static server for the demo sites (CSP like demo/serve.js) -------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
// Apps settle (timers, first re-renders) and the user points and types
// before the context is read.
const SETTLE_MS = 3500;
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
// The runtime defines these before 20-context.js (01-rpc.js, 04-i18n.js).
const INSTALL_CONTEXT = `(() => {
  const S = { app: null, target: null };
  const __en = ${JSON.stringify(EN)};
  const t = (id, v = {}) => String(__en[id] ?? id).replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m); // core/i18n.js t(), in English
  const live = () => true, getLanguage = () => "en"; // the runtime's language (core/i18n.js), which context() sends along
  ${CONTEXT_SRC}
  window.__morseEval = {
    context(sel) {
      // "host >>> inner": inside an open shadow root or a same-origin iframe
      // (what the picker can point at: it reaches into open shadow roots).
      S.target = sel ? window.__deep(sel)[0] || null : null;
      if (sel && !S.target) throw new Error("target not found: " + sel);
      return context();
    },
    timedContext(sel) { const t = performance.now(); const c = this.context(sel); return { c, ms: performance.now() - t }; }, // speed
    probe: typeof effectProbe === "function" ? effectProbe : null,
    area: typeof shotArea === "function" ? shotArea : null, // polish: the part of the page to show the model
  };
})()`;

const browser = await chromium.launch();

async function runCase(c, rep, arm = arms[0]) {
  const settings = armSettings[arm];
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
  await page.exposeFunction("__evalMove", (x, y) => page.mouse.move(x, y));
  await page.exposeFunction("__evalDrag", async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8);
    await page.mouse.up();
  });

  const rec = { arm, id: c.id, rep, site: c.site, category: c.category, split: c.split || "train", request: c.request, target: c.target };
  const t0 = Date.now();
  try {
    await page.goto(`${BASE}/demo/sites/${c.site}/${c.page || ""}`, { waitUntil: "load" });
    await page.evaluate(INSTALL_CONTEXT);
    // speed: the bar opens, the person points and types, then presses Enter.
    // Apps settle meanwhile (timers, first re-renders): at least SETTLE_MS.
    const typing = Math.max(+opt["typing-ms"], SETTLE_MS);
    if (+opt["typing-ms"] > 0) prewarm(settings);
    // models: the bar's warm as you type (runtime/src/50-bar.js warmAsYouType):
    // the words are there a second before Enter (the pause before pressing it),
    // and Automatic gets the model they start on ready.
    const typed = +opt["typing-ms"] > 0 ? setTimeout(() => prewarm(settings, c.request), Math.max(0, +opt["typing-ms"] - 1000)) : null;
    await page.waitForTimeout(typing);
    clearTimeout(typed);
    const tEnter = Date.now();
    const { c: context, ms: ctxMs } = await page.evaluate(sel => window.__morseEval.timedContext(sel), c.target);
    const tCtx = Date.now();
    rec.ctxMs = Math.round(ctxMs);
    rec.contextChars = buildMessages({ request: c.request, context }).map(m => m.content).join("").length;
    if (opt["dump-context"]) console.log(`---- ${c.id}\n` + buildMessages({ request: c.request, context })[1].content);
    if (opt["dump-context"] && opt["context-only"]) { await ctx.close(); return { ...rec, pass: true, ms: 0 }; }
    // Everything that exists now is "original" (in every open shadow root and
    // same-origin frame too); checkers can tell new elements apart.
    await page.evaluate(() => { window.__orig = new WeakSet(window.__roots().flatMap(r => [...r.querySelectorAll("*")])); });
    await page.evaluate(helpers);
    await page.evaluate(() => { window.__pseudo0 = T.pseudoTexts(); });
    const B = c.before ? await page.evaluate(`(async () => { ${c.before} })()`) : null;

    const modId = `eval-${c.id}`;
    const tg = Date.now();
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
      polish: opt.polish,
      review: async () => {
        await cssApplied;
        const a = await page.evaluate(([t, id]) => window.__morseEval.area?.(t, id) ?? null, [c.target, modId]);
        if (!a) return null;
        const buf = await page.screenshot({ type: "jpeg", quality: 85, clip: { x: a.x, y: a.y, width: a.width, height: a.height } });
        return { mediaType: "image/jpeg", data: buf.toString("base64") };
      },
      probe: hasProbe ? async sels => { await cssApplied; await page.waitForTimeout(80); return page.evaluate(([t, s]) => window.__morseEval.probe(t, s), [c.target, sels]); } : undefined,
    });
    await cssApplied;
    rec.genMs = Date.now() - tg;
    rec.ms = Date.now() - t0 - typing; // the typing time is not latency
    // speed: per-stage latency, ms from Enter (context, model, first style on the page, done)
    const tm = res.timing || {}, off = tCtx - tEnter, at = v => (v == null ? null : Math.round(v + off));
    rec.stages = { context: Math.round(ctxMs), contextRoundTrip: off, promptChars: rec.contextChars, spawn: tm.spawn ?? null, warm: tm.warm ?? null,
      modelReady: at(tm.modelReady), firstToken: at(tm.firstToken), firstCss: firstCssAt == null ? null : firstCssAt - tEnter,
      lastToken: at(tm.lastToken), modelDone: at(tm.modelDone), total: Date.now() - tEnter };
    Object.assign(rec, { model: res.model || settingsLabel(settings), escalated: !!res.escalated, startedStrong: !!res.hard, routeWhy: res.routeWhy || [], attempts: res.attempts, polish: res.polish || null, title: res.title, css: res.css, js: res.js, engineOk: res.ok, engineError: res.error || null, repairs: res.repairs || [] });
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
for (let r = 0; r < repeat; r++) for (const c of cases) for (const a of arms) jobs.push([c, r, a]);
const results = [];
let next = 0, done = 0;
const started = new Date();
async function worker() {
  while (next < jobs.length) {
    const [c, r, a] = jobs[next++];
    let rec = await runCase(c, r, a);
    if (rec.infra) rec = await runCase(c, r, a); // one retry for model/CLI hiccups
    results.push(rec);
    done++;
    const mark = rec.pass ? "PASS" : "FAIL";
    console.log(`[${String(done).padStart(3)}/${jobs.length}] ${mark} ${arms.length > 1 ? a.padEnd(7) : ""}${c.id.padEnd(18)} ${String(rec.attempts ?? "-")}x${rec.escalated ? "↑" : rec.startedStrong ? "*" : ""} ${((rec.ms || 0) / 1000).toFixed(1)}s ${rec.pass ? "" : rec.why?.slice(0, 100)}`);
  }
}
await Promise.all(Array.from({ length: Math.min(+opt.concurrency, 4) }, worker));
await browser.close();
server.close();

results.sort((a, b) => a.id.localeCompare(b.id) || a.rep - b.rep || arms.indexOf(a.arm) - arms.indexOf(b.arm));
const pct = (xs, p) => { const a = xs.filter(x => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0; };
// models: the cases Automatic kept on the fast model at first ("easy"), to
// compare latency where it should be close to the fast model's.
const autoArm = arms.find(a => MODEL_MODES.includes(a) && a === "auto");
const easy = autoArm ? new Set(results.filter(r => r.arm === autoArm && !r.startedStrong).map(r => `${r.id}#${r.rep}`)) : null;
function summarize(rs, model) {
  const pass = rs.filter(r => r.pass).length;
  const lat = rs.map(r => r.ms || 0);
  const out = {
    label: opt.label, model, split: (opt.only ? "only" : opt.split) + (opt.sites ? ` (${opt.sites})` : ""), probe: !opt["no-probe"],
    cases: rs.length, pass, rate: +(pass / Math.max(1, rs.length)).toFixed(3), medianMs: pct(lat, 0.5), p90Ms: pct(lat, 0.9),
    // The model call plus applying (what the user waits for after Enter), the
    // prompt size, and reading the page (context()).
    genMs: { median: pct(rs.map(r => r.genMs), 0.5), p90: pct(rs.map(r => r.genMs), 0.9) },
    promptChars: { median: pct(rs.map(r => r.contextChars), 0.5), p90: pct(rs.map(r => r.contextChars), 0.9) },
    ctxMs: { median: pct(rs.map(r => r.ctxMs), 0.5), p90: pct(rs.map(r => r.ctxMs), 0.9) },
    repairs: rs.filter(r => (r.attempts || 0) > 1).length,
    // models: how often Automatic started on the strong model, or moved to it
    startedStrong: rs.filter(r => r.startedStrong).length, escalated: rs.filter(r => r.escalated).length,
    byCategory: Object.fromEntries([...new Set(rs.map(r => r.category))].sort().map(k => {
      const ks = rs.filter(r => r.category === k);
      return [k, `${ks.filter(r => r.pass).length}/${ks.length}`];
    })),
  };
  if (easy) { const e = rs.filter(r => easy.has(`${r.id}#${r.rep}`)).map(r => r.ms || 0); out.easyMs = { n: e.length, median: pct(e, 0.5), p90: pct(e, 0.9) }; }
  // speed: median and p90 per stage
  out.stages = {};
  for (const k of ["context", "promptChars", "spawn", "modelReady", "firstToken", "firstCss", "lastToken", "modelDone", "total"]) {
    const xs = rs.map(r => r.stages?.[k]).filter(v => v != null).sort((a, b) => a - b);
    out.stages[k] = { n: xs.length, median: pct(xs, 0.5), p90: pct(xs, 0.9) };
  }
  return out;
}
const perArm = Object.fromEntries(arms.map(a => [a, summarize(results.filter(r => r.arm === a), `${opt.provider}:${a}`)]));
const summary = arms.length === 1 ? perArm[arms[0]] : { ...summarize(results, `${opt.provider}:${opt.model}`), arms: perArm };
for (const a of arms) {
  const sm = perArm[a];
  if (arms.length > 1) console.log(`\n---- ${a}`);
  console.log("stage            n   median     p90");
  for (const [k, v] of Object.entries(sm.stages)) console.log(`${k.padEnd(14)} ${String(v.n).padStart(3)} ${String(v.median ?? "-").padStart(8)} ${String(v.p90 ?? "-").padStart(7)}`);
  console.log(`\n${sm.pass}/${sm.cases} passed (${(sm.rate * 100).toFixed(0)}%), median ${(sm.medianMs / 1000).toFixed(1)}s, p90 ${(sm.p90Ms / 1000).toFixed(1)}s`);
  console.log(`model+apply ${(sm.genMs.median / 1000).toFixed(1)}s / p90 ${(sm.genMs.p90 / 1000).toFixed(1)}s · prompt ${sm.promptChars.median} / p90 ${sm.promptChars.p90} chars · context ${sm.ctxMs.median} / p90 ${sm.ctxMs.p90} ms · ${sm.repairs} repair rounds`);
  if (sm.startedStrong || sm.escalated) console.log(`started on the strong model ${sm.startedStrong}/${sm.cases} · moved to it after a failed draft ${sm.escalated}/${sm.cases}`);
  if (sm.easyMs) console.log(`cases Automatic started fast: ${sm.easyMs.n}, median ${(sm.easyMs.median / 1000).toFixed(1)}s, p90 ${(sm.easyMs.p90 / 1000).toFixed(1)}s`);
  console.log(sm.byCategory);
}

if (!opt["no-write"]) {
  const stamp = started.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + process.pid;
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
    const rows = arms.map(a => perArm[a]).map(sm => `| ${started.toISOString().slice(0, 16).replace("T", " ")} | ${opt.label || "-"} | ${sm.model} | ${sm.split} | ${sm.pass}/${sm.cases} (${(sm.rate * 100).toFixed(0)}%) | ${(sm.medianMs / 1000).toFixed(1)}s (p90 ${(sm.p90Ms / 1000).toFixed(1)}s) |`);
    await fs.writeFile(readme, md.replace(MARK, `${rows.join("\n")}\n${MARK}`));
  }
}
