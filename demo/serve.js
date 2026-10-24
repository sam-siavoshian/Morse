// Serves the repo root so the demo sites and share/install.html work locally.
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" };
    // Parley ships a strict CSP, like most real web apps: no inline or eval'd
    // script. Morse's mods still run there (userScripts world / CDP).
    if (p.startsWith("/demo/sites/parley/")) headers["Content-Security-Policy"] = "script-src 'self'";
    res.writeHead(200, headers).end(body);
  } catch { res.writeHead(404).end("not found"); }
};

// Each demo app gets its own origin, like real apps do (mods are scoped per host).
// MORSE_DEMO_PORT moves all three (e.g. 9787 → 9787/9788/9789) so parallel runs don't collide.
const BASE = Number(process.env.MORSE_DEMO_PORT || 8787);
const SITES = { [BASE]: "parley", [BASE + 1]: "byte", [BASE + 2]: "tunes" };
for (const [port, site] of Object.entries(SITES)) {
  http.createServer(server).listen(Number(port), "127.0.0.1", () => console.log(`${site.padEnd(7)} http://127.0.0.1:${port}/demo/sites/${site}/`));
}
