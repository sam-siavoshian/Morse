// macOS App Management (the blue hand: "morse-desktop" was prevented from
// modifying apps). The allow has to survive the restart that picks it up.
// This runs on Linux: the preflight result is injected, the real TCC call is not.
import { home } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  statusFromPreflight, decideMacAccess, createMacAccess, memoryStore, fileStore, macAccessFile,
  relaunchPlan, relaunchDesktop, GRANTED, DENIED, NOT_DETERMINED,
} from "../daemon/mac-access.js";

void home;

const program = {
  bundle: "/Applications/Morse.app",
  exe: "/Applications/Morse.app/Contents/MacOS/morse-desktop",
  dev: "1:2:300",
};

test("preflight 0 is granted; not determined and denied are different", () => {
  assert.equal(statusFromPreflight(0), GRANTED);
  assert.equal(statusFromPreflight(1), DENIED);
  assert.equal(statusFromPreflight(2), NOT_DETERMINED);
  assert.equal(statusFromPreflight(""), null, "unreadable is not a grant");
  const fresh = { program, saved: {} };
  assert.equal(decideMacAccess({ ...fresh, status: 2 }).action, "request");
  assert.equal(decideMacAccess({ ...fresh, status: 1 }).action, "tell");
  assert.notEqual(decideMacAccess({ ...fresh, status: 2 }).action, decideMacAccess({ ...fresh, status: 1 }).action);
  // A grant the process can already see is an open, not another prompt.
  assert.equal(decideMacAccess({ status: 0, program, saved: { asked: true, pickedUp: true, recorded: program } }).action, "proceed");
});

test("approval followed by restart must not request again", async () => {
  let status = 2; // not determined: the notification has not been answered
  const seen = [];
  const store = memoryStore();
  const open = async () => {
    const d = await createMacAccess({ program: () => program, readStatus: async () => status, store }).beforeOpen();
    seen.push(d.action);
    return d;
  };

  const first = await open();
  assert.equal(first.action, "request", "the first open asks macOS, once");

  const early = await open();
  assert.equal(early.action, "wait");
  assert.notEqual(early.action, "restart", "don't restart before the allow is committed");

  status = 0; // the person allowed it, and the allow is committed
  const approved = await open();
  assert.equal(approved.action, "restart");
  assert.deepEqual(approved.plan, { bundle: program.bundle, exe: program.exe }, "restart is the same program");
  assert.equal(relaunchPlan(program).exe, program.exe);

  // The process that comes back is that same program, and the allow still holds.
  const after = await open();
  assert.equal(after.action, "proceed");
  assert.deepEqual(seen, ["request", "wait", "restart", "proceed"]);
  assert.equal(seen.filter(a => a === "request").length, 1, "approval followed by restart must not request again");
  assert.equal(seen.filter(a => a === "restart").length, 1, "no second restart");
});

test("a different unsigned binary is not what gets restarted, and it does not ask again", async () => {
  const copy = { bundle: "/tmp/Morse-copy.app", exe: "/tmp/Morse-copy.app/Contents/MacOS/morse-desktop", dev: "9:9:9", copy: true };
  assert.equal(relaunchPlan(copy), null);
  assert.equal(relaunchPlan({ ...program, bundle: "/private/var/folders/x/AppTranslocation/Morse.app", exe: "/private/var/folders/x/AppTranslocation/Morse.app/Contents/MacOS/morse-desktop", dev: "4:5:6" }), null);
  const store = memoryStore({ asked: true, pickedUp: true, recorded: program });
  const open = () => createMacAccess({ program: () => copy, readStatus: async () => 2, store }).beforeOpen();
  const first = await open();
  const second = await open();
  assert.equal(first.action, "tell");
  assert.equal(second.action, "tell");
  assert.equal(second.markTold, false, "the refusal is recorded once");
  assert.notEqual(first.action, "request");
  assert.notEqual(second.action, "restart");
});

test("denied does not restart and does not ask", async () => {
  const store = memoryStore();
  const open = () => createMacAccess({ program: () => program, readStatus: async () => 1, store }).beforeOpen();
  assert.equal((await open()).action, "tell");
  const again = await open();
  assert.equal(again.action, "tell");
  assert.equal(again.markTold, false);
});

test("the allow is still granted for the same program after a restart on disk", async () => {
  const file = macAccessFile(path.join(home, "restart-home"));
  const store = fileStore(file);
  let status = 2;
  const gate = () => createMacAccess({ program: () => program, readStatus: async () => status, store });
  assert.equal((await gate().beforeOpen()).action, "request");
  status = 0;
  assert.equal((await gate().beforeOpen()).action, "restart");
  assert.equal((await gate().beforeOpen()).action, "proceed");
  const saved = await store.load();
  assert.equal(saved.pickedUp, true);
  assert.equal(saved.recorded.exe, program.exe);
  assert.equal(saved.asked, true);
});

test("the restart opens the same bundle, not a copy", async () => {
  const spawned = [];
  const ok = await relaunchDesktop(
    { bundle: program.bundle, exe: program.exe },
    { pid: 42, spawnImpl: (cmd, args) => { spawned.push([cmd, args]); return { unref() {} }; }, quit: async () => {} },
  );
  assert.equal(ok, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], "/bin/sh");
  const script = spawned[0][1][1];
  assert.match(script, /while kill -0 42 /);
  assert.match(script, /open '\/Applications\/Morse\.app'/);
  assert.doesNotMatch(script, /\/tmp|AppTranslocation|cp |mv /);
});
