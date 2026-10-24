// Terminal screenshots for the desktop commands, rendered like demo/terminal.js.
//
//   80-apps.png    `morse apps`, run against the macOS fixture tree from
//                  demo/fake-installs.js (the container has no Mac apps)
//   81-status.png  `morse status` from real sessions: the fake multi-window
//                  app (demo/fake-app.js) attached, plus a second app started
//                  with --watch and then closed, so it is waiting
//
//   MORSE_HOME=/tmp/mh node demo/shoot-apps.js

import { spawn, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(root, "docs", "screenshots");
const HOME = process.env.MORSE_HOME || await fs.mkdtemp(path.join(os.tmpdir(), "morse-apps-"));
process.env.MORSE_HOME = HOME;
await fs.mkdir(HOME, { recursive: true });
const CHROME = process.env.CHROME || chromium.executablePath();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cliPath = path.join(root, "daemon/cli.js");
const run = args => new Promise(r => execFile(process.execPath, [cliPath, ...args], { env: { ...process.env, FORCE_COLOR: "1" } }, (e, so, se) => r(so + se)));
const render = async (text, name, title) => {
  const src = path.join(HOME, name + ".txt");
  await fs.writeFile(src, text);
  await new Promise((res, rej) => execFile(process.execPath, [path.join(root, "demo/terminal.js"), src, path.join(OUT, name), title], e => (e ? rej(e) : res())));
  console.log("  📸", name);
};
const prompt = cmd => `\x1b[2m~ $\x1b[0m ${cmd}\n`;

// ---- 80: morse apps (macOS fixture tree)
{
  const { buildMac } = await import("./fake-installs.js");
  const { hostContext, discoverApps, formatApps } = await import("../daemon/apps.js");
  const fx = await fs.mkdtemp(path.join(os.tmpdir(), "morse-mac-"));
  const ctx = hostContext(await buildMac(fx));
  const text = formatApps(discoverApps(ctx), {
    platform: "darwin",
    running: new Map([["slack", { port: null }]]),
    sessions: [{ id: "spotify", port: 9333 }],
  });
  await render(prompt("morse apps") + text + "\n", "80-apps.png", "morse apps");
}

// ---- 81: morse status (real sessions)
const { serveFakeApp, fakeAppArgs } = await import("./fake-app.js");
const { saveMod } = await import("../daemon/store.js");
const { createMod } = await import("../core/mod.js");
const { listTargets, CDPSession } = await import("../daemon/cdp.js");
const server = await serveFakeApp();
const mailArgs = fakeAppArgs({ server, profile: path.join(HOME, "mail-profile") }).filter(a => !a.startsWith("http"));
const procs = [];
const launch = (name, extra, flags = []) => {
  const p = spawn(process.execPath, [cliPath, "launch", CHROME, "--name", name, ...flags, "--", ...extra], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
  p.out = "";
  p.stdout.on("data", d => { p.out += d; });
  procs.push(p);
  return p;
};
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(150); } throw new Error("timeout"); };
const portOf = p => Number(p.out.match(/port +(\d+)/)?.[1]);

try {
  await saveMod(createMod({ prompt: "make the inbox denser", title: "Compact inbox", css: "main{gap:4px}", js: "", url: server.url(), app: null }));
  await saveMod(createMod({ prompt: "hide the promo banner", title: "No promo banner", css: ".promo{display:none}", js: "", url: server.url(), app: null }));
  const mail = launch("Fake Mail", [...mailArgs, `--app=${server.url()}`]);
  await until(() => /connected to/.test(mail.out));
  const port = portOf(mail);
  // open the compose window the way a person would
  const main = (await listTargets(port)).find(t => t.type === "page");
  const s = await CDPSession.connect(main.webSocketDebuggerUrl);
  await s.send("Runtime.evaluate", { expression: "document.getElementById('compose').click()", userGesture: true });
  s.close();

  // a second app, started with --watch and then closed: Morse waits for it
  const notesArgs = fakeAppArgs({ server, profile: path.join(HOME, "notes-profile"), page: "/settings" }).filter(a => !a.startsWith("http"));
  const notes = launch("Fake Notes", [...notesArgs, `--app=${server.url("/settings")}`], ["--watch"]);
  await until(() => /connected to/.test(notes.out));
  const v = await (await fetch(`http://127.0.0.1:${portOf(notes)}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  await until(() => /Waiting for it to open again/.test(notes.out));

  let text = "";
  await until(async () => { text = await run(["status"]); return /Compose/.test(text) && /Attachment preview/.test(text) && /waiting/.test(text); });
  await render(prompt("morse status") + text, "81-status.png", "morse status");
  const stop = await run(["stop", "notes"]);
  console.log(stop.trim());
  await run(["stop", "mail"]);
  // quit Fake Mail the way a person would
  const v2 = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws2 = new WebSocket(v2.webSocketDebuggerUrl);
  await new Promise(r => ws2.addEventListener("open", r));
  ws2.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  await sleep(500);
} finally {
  for (const p of procs) p.kill("SIGINT");
  server.close();
}
process.exit(0);
