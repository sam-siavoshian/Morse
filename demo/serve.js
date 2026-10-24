// Serves the repo root so the demo sites and share/install.html work locally.
//   node demo/serve.js                       parley/byte/tunes/a11y on 8787-8790, then
//                                            mail/notes/dash/shop/wiki/tasks/logs on 8791-8797
//   import { serveDemo } from "./serve.js"   the same servers on free ports (tests)
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".gif": "image/gif", ".webm": "video/webm", ".jpg": "image/jpeg" };

// Only for this computer's own addresses (and one-word names the demo
// scripts map here, like http://tunes/): a website whose name an attacker
// points at 127.0.0.1 (DNS rebinding) would otherwise read the repo through
// the browser. Dotfiles (.git, with a remote's token in its config, .env)
// are never served, and an address that isn't valid is a 400, not a crash.
const LOCAL_HOST = /^(127\.0\.0\.1|\[::1\]|[a-z0-9-]+)(:\d+)?$/i;
const handler = async (req, res) => {
  if (!LOCAL_HOST.test(req.headers.host || "")) { res.writeHead(403).end(); return; }
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root + path.sep) || path.relative(root, file).split(path.sep).some(part => part.startsWith("."))) { res.writeHead(403).end(); return; }
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
// base 0: every site on its own free port. Resolves { sites: { parley: port, … },
// origin(site), close() }. a11y: Easier to use and Check this page.
// The gallery's demo mods (site/mods/) match these addresses: keep the order.
export const SITE_NAMES = ["parley", "byte", "tunes", "a11y", "mail", "notes", "dash", "shop", "wiki", "tasks", "logs"];
export async function serveDemo({ base = 0, host = "127.0.0.1" } = {}) {
  const servers = await Promise.all(SITE_NAMES.map((site, i) => new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once("error", reject);
    s.listen(base ? base + i : 0, host, () => resolve(s));
  })));
  const sites = Object.fromEntries(SITE_NAMES.map((site, i) => [site, servers[i].address().port]));
  return {
    sites,
    origin: site => `http://${host}:${sites[site]}`,
    close: () => Promise.all(servers.map(s => new Promise(r => { s.closeAllConnections?.(); s.close(r); }))),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // MORSE_DEMO_PORT moves them all (e.g. 9787 → 9787-9797) so parallel runs don't collide.
  const demo = await serveDemo({ base: Number(process.env.MORSE_DEMO_PORT || 8787) });
  for (const site of SITE_NAMES) console.log(`${site.padEnd(7)} ${demo.origin(site)}/demo/sites/${site}/`);
}
