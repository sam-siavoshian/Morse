// `morse doctor` says when a newer morse-cli is on npm (daemon/update-check.js):
// one request to the registry at most once a day, none with
// MORSE_NO_UPDATE_CHECK=1, against a fake registry here.
import { tempDir } from "./helpers/home.js"; // first: a MORSE_HOME of its own
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { checkForUpdate, isNewer, DAY } from "../daemon/update-check.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI = path.join(root, "daemon", "cli.js");

// A registry that answers GET /morse-cli/latest with `reply` and counts requests.
async function fakeRegistry() {
  const reg = { requests: [], reply: { status: 200, body: { name: "morse-cli", version: "9.9.9" } } };
  const server = http.createServer((req, res) => {
    reg.requests.push({ method: req.method, url: req.url, cookie: req.headers.cookie });
    res.writeHead(reg.reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reg.reply.body));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  reg.url = `http://127.0.0.1:${server.address().port}`;
  reg.close = () => new Promise(r => server.close(r));
  return reg;
}

test("isNewer compares versions the way npm does", () => {
  assert.equal(isNewer("0.3.0", "0.2.0"), true);
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("1.0.0", "1.0.0-beta.2"), true);
  assert.equal(isNewer("0.2.0", "0.2.0"), false);
  assert.equal(isNewer("0.1.9", "0.2.0"), false);
  assert.equal(isNewer("1.0.0-beta.1", "1.0.0"), false);
  assert.equal(isNewer("not a version", "0.2.0"), false);
});

test("asks the registry at most once a day, and never when turned off", async () => {
  const reg = await fakeRegistry();
  const home = tempDir("morse-update-");
  const env = { MORSE_UPDATE_REGISTRY: reg.url };
  const now = Date.parse("2026-10-24T12:00:00Z");
  try {
    let r = await checkForUpdate("0.2.0", { env, home, now });
    assert.deepEqual([r.state, r.latest, r.cached], ["newer", "9.9.9", false]);
    assert.deepEqual(reg.requests.map(q => `${q.method} ${q.url}`), ["GET /morse-cli/latest"]);
    assert.equal(reg.requests[0].cookie, undefined, "no cookies");
    const saved = JSON.parse(readFileSync(path.join(home, "update-check.json"), "utf8"));
    assert.deepEqual(saved, { checkedAt: now, registry: reg.url, latest: "9.9.9" }, "only the time, the registry and the version are kept");

    r = await checkForUpdate("0.2.0", { env, home, now: now + DAY - 1000 });
    assert.deepEqual([r.state, r.cached], ["newer", true]);
    r = await checkForUpdate("9.9.9", { env, home, now: now + 60_000 });
    assert.equal(r.state, "current", "after updating, the saved answer says it's the newest");
    assert.equal(reg.requests.length, 1, "the same day: no second request");

    r = await checkForUpdate("0.2.0", { env, home, now: now - 60_000 });
    assert.equal(reg.requests.length, 2, "a clock that went back asks again");
    r = await checkForUpdate("0.2.0", { env, home, now: now + DAY + 1000 });
    assert.equal(reg.requests.length, 3, "a day later: asks again");

    const off = tempDir("morse-update-off-");
    for (const v of ["1", "true"]) {
      r = await checkForUpdate("0.2.0", { env: { ...env, MORSE_NO_UPDATE_CHECK: v }, home: off, now: now + 5 * DAY });
      assert.equal(r.state, "off");
    }
    assert.equal(reg.requests.length, 3, "MORSE_NO_UPDATE_CHECK=1: no request");
    assert.equal(existsSync(path.join(off, "update-check.json")), false, "and no file");
  } finally { await reg.close(); }
});

test("not on npm yet, a registry error, or no answer: nothing newer, and it says so", async () => {
  const reg = await fakeRegistry();
  const env = { MORSE_UPDATE_REGISTRY: reg.url + "/" };
  try {
    reg.reply = { status: 404, body: { error: "Not found" } };
    let home = tempDir("morse-update-404-");
    let r = await checkForUpdate("0.2.0", { env, home });
    assert.equal(r.state, "unpublished");
    await checkForUpdate("0.2.0", { env, home });
    assert.equal(reg.requests.length, 1, "a 404 is an answer too: kept for a day");

    reg.reply = { status: 500, body: {} };
    home = tempDir("morse-update-500-");
    r = await checkForUpdate("0.2.0", { env, home });
    assert.deepEqual([r.state, r.error], ["unknown", "error 500"]);
    assert.equal(existsSync(path.join(home, "update-check.json")), false, "an error isn't kept: try again next time");

    reg.reply = { status: 200, body: { name: "morse-cli" } };
    r = await checkForUpdate("0.2.0", { env, home });
    assert.equal(r.state, "unknown");

    r = await checkForUpdate("0.2.0", { env: { MORSE_UPDATE_REGISTRY: "http://127.0.0.1:1" }, home: tempDir("morse-update-off-") });
    assert.equal(r.state, "unknown", "offline");
  } finally { await reg.close(); }
});

// morse doctor, run for real: no model on this PATH (only node), so it stops
// after the system rows with exit 1. The update row comes first.
function doctor(env) {
  const bin = tempDir("morse-bin-");
  symlinkSync(process.execPath, path.join(bin, "node"));
  const home = env.HOME;
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CLI, "doctor"], { env: { PATH: bin, HOME: home, MORSE_HOME: home, MORSE_HELPER_PORT: "1", NO_COLOR: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", d => out += d);
    p.stderr.on("data", d => out += d);
    p.on("close", code => resolve({ code, out }));
  });
}

test("morse doctor says when a newer version is out", async () => {
  const reg = await fakeRegistry();
  const home = tempDir("morse-doctor-update-");
  try {
    let r = await doctor({ HOME: home, MORSE_UPDATE_REGISTRY: reg.url });
    assert.match(r.out, /morse\s+\d+\.\d+\.\d+\S*\s+Morse 9\.9\.9 is out\. Update with npm install -g morse-cli/, r.out);
    assert.match(r.out, /No model is connected/);
    r = await doctor({ HOME: home, MORSE_UPDATE_REGISTRY: reg.url });
    assert.match(r.out, /Morse 9\.9\.9 is out/);
    assert.equal(reg.requests.length, 1, "the second doctor uses the saved answer");

    reg.reply = { status: 200, body: { version: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version } };
    r = await doctor({ HOME: tempDir("morse-doctor-same-"), MORSE_UPDATE_REGISTRY: reg.url });
    assert.match(r.out, /morse\s+\S+\s+the newest version/);

    r = await doctor({ HOME: tempDir("morse-doctor-off-"), MORSE_UPDATE_REGISTRY: reg.url, MORSE_NO_UPDATE_CHECK: "1" });
    assert.match(r.out, /not checking for a newer version/);
    assert.equal(reg.requests.length, 2, "MORSE_NO_UPDATE_CHECK=1: doctor asks nothing");
  } finally { await reg.close(); }
});
