// morse-scan (native/morse-scan) matches daemon/apps.js on the fake install
// trees, and the desktop service still lists apps. The first state() does
// not wait for that scan.
import { tempDir } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const apps = await import("../daemon/apps.js");
const { discoverAppsNative, listProcessesNative, probeLocalNative, rustBin } = await import("../daemon/native-scan.js");
const { loadDaemon, createService } = await import("../desktop-app/service.js");
const { buildMac, buildWindows, buildLinux } = await import("../demo/fake-installs.js");

const bin = rustBin();
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function run(args, input) {
  assert.ok(bin, `morse-scan is not built (looked under native/morse-scan/target). cwd ${root}`);
  return JSON.parse(execFileSync(bin, args, { input, encoding: "utf8", maxBuffer: 64 << 20 }));
}

function spec(ctx) {
  return JSON.stringify({ platform: ctx.platform, root: ctx.root || "", home: ctx.home || "", env: ctx.env || {}, catalog: apps.CATALOG });
}

// First path where the two values differ, so a fixture miss is one line.
function diverge(a, b, path = "") {
  if (Object.is(a, b)) return "";
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path} length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diverge(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return "";
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) return `${path}.${k} missing on JS`;
      if (!Object.prototype.hasOwnProperty.call(b, k)) return `${path}.${k} missing on Rust (${JSON.stringify(a[k])})`;
      const d = diverge(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return "";
  }
  return `${path} ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

async function fixture(build) {
  const dir = tempDir("morse-rust-");
  return apps.hostContext(await build(dir));
}

const built = bin ? false : "morse-scan is not built; cargo build --manifest-path native/morse-scan/Cargo.toml";

for (const [name, build] of [["macOS", buildMac], ["Windows", buildWindows], ["Linux", buildLinux]]) {
  test(`morse-scan discover matches JS discoverApps on the ${name} fixture`, { skip: built }, async () => {
    const ctx = await fixture(build);
    const js = apps.discoverApps(ctx);
    const t0 = Date.now();
    const rust = run(["discover"], spec(ctx));
    const rustMs = Date.now() - t0;
    const t1 = Date.now();
    apps.discoverApps(ctx);
    const jsMs = Date.now() - t1;
    const where = diverge(js, rust);
    assert.equal(where, "", where);
    console.log(`${name} fixture: rust ${rustMs}ms, js ${jsMs}ms, ${js.length} apps`);
  });
}

test("parse-ps matches daemon/apps.js parsePs", { skip: built }, () => {
  const text = "\n    1 0 /sbin/launchd\n  500 1 /Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9334\n  bad line\n";
  assert.deepEqual(run(["parse-ps"], text), apps.parsePs(text));
});

test("a missing binary falls back to the JS scan", async () => {
  const ctx = await fixture(buildLinux);
  const prev = process.env.MORSE_SCAN_BIN;
  process.env.MORSE_SCAN_BIN = path.join(os.tmpdir(), "morse-scan-missing");
  try {
    assert.equal(rustBin(), null);
    assert.deepEqual(discoverAppsNative(apps, ctx), apps.discoverApps(ctx));
  } finally {
    if (prev === undefined) delete process.env.MORSE_SCAN_BIN;
    else process.env.MORSE_SCAN_BIN = prev;
  }
});

test("the desktop service lists apps, and the first state does not scan", async () => {
  const daemon = await loadDaemon();
  let scans = 0;
  const real = daemon.discoverApps;
  daemon.discoverApps = ctx => { scans++; return real(ctx); };
  const emitted = [];
  const service = createService({ daemon, emit: () => emitted.push(1), scan: true, self: [] });
  const first = await service.state();
  assert.equal(first.appsPending, true);
  assert.deepEqual(first.apps, []);
  assert.equal(scans, 0, "state() returned before discoverApps");
  const t0 = Date.now();
  const rows = await service.apps();
  const appsMs = Date.now() - t0;
  assert.ok(Array.isArray(rows), "apps() returns a list");
  assert.ok(rows.every(r => r && typeof r.id === "string" && typeof r.name === "string" && typeof r.state === "string"));
  assert.equal(scans, 1);
  const again = await service.state();
  assert.equal(again.appsPending, false);
  assert.equal(again.apps.length, rows.length);
  const procs = listProcessesNative(apps);
  assert.ok(Array.isArray(procs) && procs.length > 0 && procs.every(p => Number.isInteger(p.pid) && typeof p.cmd === "string"));
  console.log(`this machine: service.apps ${appsMs}ms, ${rows.length} apps, ${procs.length} processes via ${bin || "js"}`);
  await service.shutdown();
});

test("probe-local reads an OpenAI-style list and a server that is down", { skip: built }, async () => {
  // The probe is synchronous. The server has to run on another thread, or the
  // accept never happens while this thread is blocked in the binary.
  const { Worker } = await import("node:worker_threads");
  const worker = new Worker(`
    const http = require("http");
    const { parentPort } = require("worker_threads");
    const server = http.createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "llama3" }, { id: "llama3" }] }));
        return;
      }
      res.statusCode = 404;
      res.end("no");
    });
    server.listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port));
  `, { eval: true });
  const port = await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  try {
    const row = probeLocalNative({ id: "ollama", name: "Ollama", logo: "ollama", baseUrl: `http://127.0.0.1:${port}` }, 2000);
    assert.equal(row.status, "ready");
    assert.equal(row.found, true);
    assert.deepEqual(row.models, [{ id: "llama3", name: "llama3" }]);
    const down = probeLocalNative({ id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:1" }, 400);
    assert.equal(down.status, "server-down");
    assert.equal(down.found, false);
    const prev = process.env.MORSE_SCAN_BIN;
    process.env.MORSE_SCAN_BIN = path.join(os.tmpdir(), "morse-scan-missing");
    try { assert.equal(probeLocalNative({ id: "ollama", baseUrl: `http://127.0.0.1:${port}` }), null); }
    finally { if (prev === undefined) delete process.env.MORSE_SCAN_BIN; else process.env.MORSE_SCAN_BIN = prev; }
  } finally {
    await worker.terminate();
  }
});

test("real-machine discover: JS and Rust return the same apps", { skip: built }, () => {
  const ctx = apps.hostContext();
  const t0 = Date.now();
  const js = apps.discoverApps(ctx);
  const jsMs = Date.now() - t0;
  const t1 = Date.now();
  const rust = run(["discover"], spec(ctx));
  const rustMs = Date.now() - t1;
  const where = diverge(js, rust);
  assert.equal(where, "", where);
  const tp = Date.now();
  const procs = run(["processes", process.platform], "");
  const procMs = Date.now() - tp;
  const tj = Date.now();
  const jsProcs = apps.listProcesses();
  const jsProcMs = Date.now() - tj;
  console.log(`this machine discover: rust ${rustMs}ms, js ${jsMs}ms, ${js.length} apps; processes rust ${procMs}ms (${procs.length}), js ps ${jsProcMs}ms (${jsProcs.length})`);
  assert.ok(procs.length > 0);
});
