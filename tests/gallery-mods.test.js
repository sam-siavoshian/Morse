// The gallery's demo-app mods, checked the way evals/gallery.js checked them
// when they were made: headless Chromium on the demo app, the checker fails
// without the mod, passes with it (real clicks and keys), and passes again
// after a reload. Real-site mods can't run here (no network in CI); their
// checks are recorded in site/mods/VERIFIED.md.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { noBrowser, launchBrowser } from "./helpers/browser.js";
import { loadCases, verifyMod, hostFor } from "../evals/gallery-check.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(path.join(ROOT, "site/mods/index.json"), "utf8"));
const cases = loadCases();
const listed = new Set(index.map(e => e.file.replace(/\.morse\.json$/, "")));

test("every mod the gallery calls checked has a checker, and matches exactly the page it was checked on", () => {
  const ids = new Set(cases.map(c => c.id));
  // The mods written by hand for apps the checks can't open say so (no "checked").
  for (const e of index) assert.equal(!!e.checked, ids.has(e.file.replace(/\.morse\.json$/, "")), `${e.file}: "checked" only with a case in evals/gallery-cases.json`);
  for (const e of index.filter(e => e.demo)) assert.ok(e.checked, `${e.file}: demo mods are checked by this file`);
  for (const c of cases.filter(c => listed.has(c.id))) {
    const mod = JSON.parse(readFileSync(path.join(ROOT, "site/mods", `${c.id}.morse.json`), "utf8"));
    assert.deepEqual(mod.match.hosts, [hostFor(c)], `${c.id}: matches exactly the page it was checked on`);
    assert.equal(mod.prompt, c.request, `${c.id}: the request as written`);
  }
});

let browser, server, base;
before(async () => {
  if (noBrowser) return;
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".gif": "image/gif", ".webm": "video/webm" };
  server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html");
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(path.join(ROOT, "demo", "sites"))) { res.writeHead(403).end(); return; }
    try {
      const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" };
      if (p.startsWith("/demo/sites/parley/")) headers["Content-Security-Policy"] = "script-src 'self'";
      res.writeHead(200, headers).end(await fs.readFile(file));
    } catch { res.writeHead(404).end("not found"); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  server?.close();
});

// Four at a time: each one loads its page three times.
test("every demo-app mod works, and again after a reload", { skip: noBrowser, concurrency: 4 }, async t => {
  const demo = cases.filter(c => c.site && listed.has(c.id));
  assert.ok(demo.length >= 15);
  await Promise.all(demo.map(c => t.test(c.id, async () => {
    const mod = JSON.parse(await fs.readFile(path.join(ROOT, "site/mods", `${c.id}.morse.json`), "utf8"));
    let r = await verifyMod(browser, c, mod, base);
    if (!r.pass && /timed out|error:/.test(r.why || "")) r = await verifyMod(browser, c, mod, base); // a busy machine
    assert.ok(r.pass, `${c.id}: ${r.why} ${JSON.stringify({ before: r.before, first: r.first, reload: r.reload, errors: r.errors })}`);
  })));
});
