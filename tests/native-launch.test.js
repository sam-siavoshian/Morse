// The daemon-side bridge to the native-DBI prototype (daemon/native-dbi.js):
// the frida-optional guard and the connect refusal path. Frida isn't installed
// in CI, so these assert the graceful "install frida" behaviour — the honest
// outcome the launch UI shows — rather than a real attach.
import { test } from "node:test";
import assert from "node:assert/strict";

import { nativeAvailable, nativePid, connectNative } from "../daemon/native-dbi.js";
import { attachVerdict } from "../daemon/apps.js";

test("attachVerdict: native apps are not CDP-attachable but are DBI-reachable", () => {
  const v = attachVerdict({ engine: "native" });
  assert.equal(v.canAttach, false, "not CDP — the desktop app's CDP paths stay unchanged");
  assert.equal(v.dbi, true, "but reachable by the experimental DBI route");
  assert.equal(v.native, true);

  // Electron/CEF/chromium verdicts are untouched.
  assert.equal(attachVerdict({ engine: "electron", electron: "33.0.0" }).canAttach, true);
  assert.equal(attachVerdict({ engine: "cef" }).dbi, undefined);
});

test("bridge: without frida installed, availability and connect refuse gracefully", async () => {
  const avail = await nativeAvailable();
  // In an environment with frida this would be { ok: true }; here it must be a
  // clean, actionable refusal — never a throw.
  if (!avail.ok) {
    assert.equal(avail.reason, "frida-missing");
    assert.match(avail.message, /npm install frida/);

    const res = await connectNative({ id: "x", name: "X", path: "/x", engine: "native" }, { pid: 999999 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "frida-missing");
    assert.match(res.diagnostics, /frida/i);
  } else {
    // Frida is present: the bridge should still refuse a bogus PID safely.
    const res = await connectNative({ id: "x", name: "X", path: "/x", engine: "native" }, { pid: 999999 });
    assert.equal(res.ok, false);
  }
});

test("bridge: nativePid finds a running app's process via the shared matcher", () => {
  const procs = [
    { pid: 10, ppid: 1, exe: "/opt/Acme/acme", cmd: "/opt/Acme/acme --flag" },
    { pid: 11, ppid: 1, exe: "/usr/bin/other", cmd: "/usr/bin/other" },
  ];
  const app = { id: "acme", name: "Acme", processName: "acme", resolved: "/opt/Acme/acme", path: "/opt/Acme/acme" };
  assert.equal(nativePid(app, { platform: "linux", procs }), 10);

  const notRunning = { id: "ghost", name: "Ghost", processName: "ghost", resolved: "/opt/Ghost/ghost", path: "/opt/Ghost/ghost" };
  assert.equal(nativePid(notRunning, { platform: "linux", procs }), null);
});
