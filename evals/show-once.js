#!/usr/bin/env node
// Show me once against a real model: record the flow through the real bar on
// the Postbox demo site (demo/sites/mail), take the exact request the runtime
// sends (with the recorded steps), give it to a real model through the real
// engine, run the mod it writes on a fresh copy of the page, and check that
// it does the job.
//
//   node evals/show-once.js                       Claude Code haiku, all flows
//   node evals/show-once.js --model sonnet --only every
//
// Flows:
//   every     open an unread email, Archive · "do this to every unread email"
//             → a button that archives all unread emails, and only those
//   shortcut  Archive · "do this when I press Ctrl+Shift+A"
//             → the shortcut archives whichever email is open
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { runMorse } from "../core/engine.js";
import { wrapModCode } from "../core/kit.js";
import "../daemon/harness.js"; // registers the claude-code provider
import { openSite } from "../demo/show-once-page.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const { values: opt } = parseArgs({ options: {
  model: { type: "string", default: "haiku" },
  provider: { type: "string", default: "claude-code" },
  only: { type: "string", default: "" },
} });
const OPEN_KEY = process.platform === "darwin" ? "Alt+Space" : "Control+Shift+Space";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch {} await sleep(60); }
  throw new Error("timed out: " + fn);
}
const status = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]").dataset.status));

const FLOWS = {
  every: {
    request: "do this to every unread email",
    async record(page) {
      await page.locator(".r9", { hasText: "Leo Martins" }).click();
      await page.locator(".rd .acts button", { hasText: "Archive" }).click();
    },
    async check(page) {
      const before = await page.locator(".r9").count();
      // The new button: one that wasn't on the page before the mod ran.
      const label = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button,[role=button]")].find(e => !window.__orig.has(e) && e.getClientRects().length && !e.closest("[data-morse-ui]"));
        if (!b) return null;
        b.setAttribute("data-new-button", "");
        return b.textContent.trim();
      });
      if (label == null) return "no new button";
      await page.locator("[data-new-button]").click();
      await sleep(5000);
      const unread = await page.locator('.r9[data-unread="true"]').count();
      const rows = await page.locator(".r9").count();
      if (unread) return `${unread} unread emails left after clicking “${label}”`;
      if (rows !== before - 4) return `${before - rows} emails archived, expected 4`;
      console.log(`  clicked “${label}”: 4 unread emails archived, ${rows} read ones kept`);
      return true;
    },
  },
  shortcut: {
    request: "do this when I press Ctrl+Shift+A",
    async record(page) { await page.locator(".rd .acts button", { hasText: "Archive" }).click(); },
    async check(page) {
      await page.locator(".r9", { hasText: "Northwind Billing" }).click();
      await page.keyboard.press("Control+Shift+A");
      await sleep(2500);
      if (await page.locator(".r9", { hasText: "Northwind Billing" }).count()) return "Ctrl+Shift+A did not archive the open email";
      await page.locator(".r9", { hasText: "Figma" }).click();
      await page.keyboard.press("Control+Shift+A");
      await sleep(2500);
      if (await page.locator(".r9", { hasText: "Figma" }).count()) return "a second Ctrl+Shift+A did not archive the next email";
      return (await page.locator(".r9").count()) === 8 || "other emails changed";
    },
  },
};

const browser = await chromium.launch();
const settings = { provider: opt.provider, model: opt.model };
let failed = 0;
for (const [name, flow] of Object.entries(FLOWS)) {
  if (opt.only && !opt.only.split(",").includes(name)) continue;
  // 1. Record through the real bar; the demo host answers, but what we want is the request it was sent.
  const rec = await openSite(browser, "mail");
  await rec.page.keyboard.press(OPEN_KEY);
  await rec.page.locator(".sugs .so-sug").click();
  await flow.record(rec.page);
  await rec.page.locator(".so-strip [data-so=stop]").click();
  await until(async () => (await status(rec.page)).open);
  await rec.page.keyboard.type(flow.request);
  await rec.page.keyboard.press("Enter");
  await until(() => rec.page.evaluate(() => window.__sent.some(m => m.type === "generate")));
  const gen = await rec.page.evaluate(() => window.__sent.find(m => m.type === "generate"));
  await rec.ctx.close();
  console.log(`\n---- ${name}: “${gen.request}”`);
  console.log(gen.context.recording.steps.map(s => `  ${s.n}. ${s.do} ${s.selector}${s.text ? ` “${s.text}”` : ""}`).join("\n"));

  // 2. A fresh page; the real model writes the mod; it runs the way the hosts run it.
  const { page, ctx, errors } = await openSite(browser, "mail");
  const modId = `so-${name}`;
  await page.evaluate(() => { window.__orig = new WeakSet(document.querySelectorAll("*")); });
  const t0 = Date.now();
  const res = await runMorse({
    settings, request: gen.request, context: gen.context,
    emit: ev => { if (ev.type === "phase" && ev.phase === "fixing") console.log("  repairing:", String(ev.error).slice(0, 160)); },
    exec: async js => {
      let r;
      try { r = await page.evaluate(wrapModCode(modId, js)); } catch (e) { return { ok: false, error: String(e.message || e).split("\n")[0] }; }
      if (!r?.ok) return r || { ok: false, error: "no result" };
      await sleep(600);
      const errs = await page.evaluate(id => morse.__errors(id), modId);
      return errs.length ? { ok: false, error: errs[0].split("\n")[0] } : { ok: true };
    },
  }).catch(e => ({ ok: false, error: e.message }));
  if (res.css) await page.evaluate(css => { const s = document.createElement("style"); s.textContent = css; document.head.append(s); }, res.css);
  console.log(`  ${opt.provider}:${opt.model} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${res.attempts || 0} attempt(s) · “${res.title || ""}”${res.ok ? "" : ` · engine error: ${res.error}`}`);
  console.log(res.js ? res.js.split("\n").map(l => "  | " + l).join("\n") : "  (no js)");
  const verdict = res.ok ? await flow.check(page).catch(e => "check failed: " + e.message) : "no working mod";
  console.log(verdict === true ? "  PASS" : `  FAIL: ${verdict}`);
  if (errors.length) console.log("  page errors:", errors.slice(0, 3));
  if (verdict !== true) failed++;
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
