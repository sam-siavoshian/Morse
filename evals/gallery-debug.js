#!/usr/bin/env node
// Runs one gallery mod on its page and evaluates an expression there, for
// working out why a checker fails.
//   node evals/gallery-debug.js <id> "<expression using T>" [--dir evals/results/gallery-drafts] [--shot file.png]
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { loadCases, openPage, prepare, applyMod } from "./gallery-check.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { values: opt, positionals: [id, expr] } = parseArgs({ allowPositionals: true, options: {
  dir: { type: "string", default: path.join(ROOT, "site", "mods") },
  shot: { type: "string", default: "" },
} });
const c = loadCases().find(x => x.id === id);
if (!c) { console.error("no case " + id); process.exit(1); }
if (c.site) { console.error("demo apps: use evals/gallery.js --verify"); process.exit(1); }
const proxy = process.env.HTTPS_PROXY;
const browser = await chromium.launch({ ...(proxy ? { proxy: { server: proxy, bypass: "127.0.0.1,localhost" } } : {}) });
const { page } = await openPage(browser, c, "");
await prepare(page, c);
const mod = JSON.parse(readFileSync(path.join(path.resolve(opt.dir), `${id}.morse.json`), "utf8"));
console.log("errors:", await applyMod(page, mod));
await page.waitForTimeout(500);
if (opt.shot) await page.screenshot({ path: opt.shot });
console.log(JSON.stringify(await page.evaluate(`(async () => (${expr}))()`), null, 1));
await browser.close();
