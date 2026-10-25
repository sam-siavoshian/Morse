// A tiny static server for demo/bar-playground.html that bundles the runtime
// fresh on every request, so tests and screenshots never run a stale build.
//   import { serveBar } from "./bar-server.js"; const { url, close } = await serveBar();
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { bundleRuntime } from "../runtime/bundle.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

export function serveBar(port = 0) {
  const server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/dist/runtime/runtime.js") {
      res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }).end(bundleRuntime());
      return;
    }
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    let body;
    try { body = await fs.readFile(file); } catch { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
  });
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}/demo/bar-playground.html`,
    close: () => new Promise(r => server.close(r)),
  })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await serveBar(Number(process.argv[2] || 8790));
  console.log(url);
}
