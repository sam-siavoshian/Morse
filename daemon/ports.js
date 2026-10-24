// Debugging-port safety: pick a port nothing else uses, make sure only this
// machine can reach it, and make sure the thing answering is the app we
// started (not some other program that happens to own the port).

import net from "node:net";
import os from "node:os";
import { readFileSync } from "node:fs";
import { appTimeout } from "./cdp.js";

// MORSE_PORT_RANGE=<from>-<to> moves the range (tests and parallel runs use it
// so concurrent copies don't pick the same port); the default is unchanged.
const envRange = /^(\d+)-(\d+)$/.exec(process.env.MORSE_PORT_RANGE || "");
export const PORT_RANGE = envRange ? [Number(envRange[1]), Number(envRange[2])] : [9333, 9399];

// Does anything accept a TCP connection on host:port?
export function portAnswers(port, host = "127.0.0.1", timeoutMs = 400) {
  return new Promise(resolve => {
    const sock = net.connect({ port, host });
    const done = v => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

// Can we bind 127.0.0.1:port ourselves? (Then a freshly launched app can too.)
export function canBind(port, host = "127.0.0.1") {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

export async function portFree(port) {
  if (await portAnswers(port)) return false;
  if (await portAnswers(port, "::1").catch(() => false)) return false;
  return canBind(port);
}

// First free port: the preferred one, then the Morse range.
export async function pickPort({ preferred = [], range = PORT_RANGE, isFree = portFree } = {}) {
  const tried = new Set();
  for (const p of [...preferred, ...Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i)]) {
    if (!Number.isInteger(p) || p < 1024 || p > 65535 || tried.has(p)) continue;
    tried.add(p);
    if (await isFree(p)) return p;
  }
  throw new Error(`No free port between ${range[0]} and ${range[1]}. Pass one with --port.`);
}

// Addresses other machines could use to reach this one.
export function externalAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces)) for (const a of list || []) {
    if (a.internal) continue;
    if (a.family === "IPv6" || a.family === 6) { if (!/^fe80:/i.test(a.address)) out.push(a.address); }
    else out.push(a.address);
  }
  return out;
}

// The port must answer on 127.0.0.1 and on no other address of this machine.
export async function reachableFrom(port, addresses = externalAddresses(), answers = portAnswers) {
  const open = [];
  for (const a of addresses) if (await answers(port, a, 300)) open.push(a);
  return open;
}

// Who holds a listening TCP port: the user ids of its listeners, from
// /proc/net/tcp and tcp6 (Linux lists every account's there). [] when
// nothing listens on it; null where Morse can't tell this way (macOS, Windows).
export function listenerUids(port, { platform = process.platform, read = f => readFileSync(f, "utf8") } = {}) {
  if (platform !== "linux") return null;
  const uids = new Set();
  let readAny = false;
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try { text = read(file); readAny = true; } catch { continue; }
    for (const line of text.split("\n").slice(1)) {
      const c = line.trim().split(/\s+/); // sl local_address rem_address st … uid
      if (c.length < 8 || c[3] !== "0A") continue; // 0A: listening
      if (parseInt(c[1].split(":").pop(), 16) === port) uids.add(Number(c[7]));
    }
  }
  return readAny ? [...uids] : null;
}

// Is what listens on `port` a program of this account? false: another
// account on this computer holds it (it got there first, so it can pose as
// the app, user agent, process id and all). null: Morse can't tell.
export function portIsMine(port, { uid = process.getuid?.(), ...o } = {}) {
  if (uid == null) return null;
  const uids = listenerUids(port, o);
  if (!uids?.length) return null;
  return uids.every(u => u === uid);
}

// Strip switches that would widen who can reach the port (an allowed origin
// lets web pages with that origin drive the app). Chromium also reads a
// switch with one dash, and on Windows with a slash or in capitals.
export function safeExtraArgs(args = []) {
  return args.filter(a => !/^(--?|\/)remote-(debugging-(address|port|pipe)|allow-origins)\b/i.test(a));
}

async function json(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) }).catch(e => { throw appTimeout(e, port); });
  return res.json();
}

// The browser process id behind the port, via SystemInfo.getProcessInfo.
async function browserPid(wsUrl) {
  if (!wsUrl) return null;
  return new Promise(resolve => {
    let ws;
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 1500);
    try { ws = new WebSocket(wsUrl); } catch { clearTimeout(t); return resolve(null); }
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" })));
    ws.addEventListener("message", e => {
      clearTimeout(t);
      let pid = null;
      try { pid = JSON.parse(e.data).result?.processInfo?.find(p => p.type === "browser")?.id ?? null; } catch {}
      try { ws.close(); } catch {}
      resolve(pid);
    });
    ws.addEventListener("error", () => { clearTimeout(t); resolve(null); });
  });
}

// What is answering on the port: { browser, userAgent, electron, pid }.
export async function identify(port) {
  const v = await json(port, "/json/version");
  return {
    browser: v.Browser || "",
    userAgent: v["User-Agent"] || "",
    electron: (v["User-Agent"] || "").match(/Electron\/([\d.]+)/)?.[1] || null,
    pid: await browserPid(v.webSocketDebuggerUrl),
  };
}

const fold = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Is `who` (from identify) the app we launched? Pure, so it is easy to test.
//   app: { name, id, aliases, exe, engine, browser }   pids: processes we started
export function checkIdentity(who, app, pids = []) {
  const label = who.browser.replace("/", " ") || "something";
  if (who.pid && pids.includes(who.pid)) return { ok: true, why: "started by Morse" };
  const ua = fold(who.userAgent);
  const tokens = [app.name, app.id, app.exe && app.exe.replace(/\.(exe|app)$/i, ""), ...(app.aliases || [])]
    .map(fold).filter(t => t.length >= 3 && !["chrome", "chromium", "electron", "app"].includes(t));
  if (tokens.some(t => ua.includes(t))) return { ok: true, why: "user agent names the app" };
  if (app.engine === "electron" && !app.browser && who.electron && !pids.length) return { ok: true, why: "Electron app" };
  return { ok: false, why: `the debugging port answers, but it's ${label}, not ${app.name}` };
}
