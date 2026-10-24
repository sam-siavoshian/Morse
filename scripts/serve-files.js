// Serves one folder on 127.0.0.1, the way a GitHub release serves its files,
// so the one-line installers can be tried against files built a minute ago:
//
//   node scripts/serve-files.js <folder> <port>
//   MORSE_INSTALL_BASE=http://127.0.0.1:<port> sh install.sh
//
// The preview workflow (.github/workflows/preview.yml) uses it for its smoke
// test on macOS, Windows and Linux. A missing file is a 404, like a release
// without it.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";

const [dir = ".", port = "8765"] = process.argv.slice(2);
const root = path.resolve(dir);

createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  const file = path.resolve(root, name);
  let ok = false;
  try { ok = path.dirname(file) === root && statSync(file).isFile(); } catch {}
  if (!ok) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not Found"); }
  res.writeHead(200, { "Content-Type": "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(Number(port), "127.0.0.1", () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));
