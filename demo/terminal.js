// Renders a captured terminal log (with ANSI colors) to a PNG.
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const [src, out, title = "morse"] = process.argv.slice(2);
const text = await fs.readFile(src, "utf8");
const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const COLORS = { 1: "font-weight:700;color:#f0f6fc", 2: "color:#6e7681", 31: "color:#f85149", 32: "color:#3fb950" };
let html = "", open = 0;
for (const part of esc(text).split(/(\x1b\[\d+m)/)) {
  const m = part.match(/\x1b\[(\d+)m/);
  if (!m) { html += part; continue; }
  if (m[1] === "0") { html += "</span>".repeat(open); open = 0; }
  else { html += `<span style="${COLORS[m[1]] || ""}">`; open++; }
}
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1060, height: 200 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#010409;padding:24px;font:14px/1.6 ui-monospace,Menlo,Consolas,monospace">
<div style="background:#0d1117;border:1px solid #30363d;border-radius:12px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.5)">
<div style="display:flex;gap:8px;padding:12px 14px;border-bottom:1px solid #21262d;align-items:center"><i style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></i><i style="width:12px;height:12px;border-radius:50%;background:#febc2e"></i><i style="width:12px;height:12px;border-radius:50%;background:#28c840"></i><span style="margin-left:10px;color:#6e7681;font-size:12px">${esc(title)}</span></div>
<pre style="margin:0;padding:16px 20px;color:#c9d1d9;white-space:pre-wrap">${html}</pre></div></body>`);
await p.locator("body > div").screenshot({ path: out });
await b.close();
