// Ports for tests: always picked by the OS, never fixed, so concurrent runs
// (several checkouts, CI shards) can't collide.
import net from "node:net";
import path from "node:path";
import { promises as fs } from "node:fs";
import { waitFor } from "./wait.js";

// A port nothing is listening on right now (the OS picks it from the
// ephemeral range). Prefer listening on port 0 yourself when you can.
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// A small run of ports for code that picks from a range (MORSE_PORT_RANGE),
// starting at an OS-picked free port.
export async function freeRange(size = 8) {
  const p = await freePort();
  return [p, Math.min(65535, p + size - 1)];
}

// Chromium started with --remote-debugging-port=0 writes the port it bound to
// <user-data-dir>/DevToolsActivePort. Delete the file before launching.
export async function devToolsPort(profile, { timeout = 60000 } = {}) {
  const file = path.join(profile, "DevToolsActivePort");
  return waitFor(async () => {
    const port = Number((await fs.readFile(file, "utf8")).split("\n")[0]);
    return port > 0 && port;
  }, { timeout, what: `DevToolsActivePort in ${profile}` });
}

// Listen on port 0 and resolve the port.
export function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}
