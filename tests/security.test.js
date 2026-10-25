// Security regressions that need no browser: what a mod's id and title may hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMod, validateMod, toUserscript } from "../core/mod.js";

test("mods with unsafe ids are rejected", () => {
  const bad = { ...createMod({ title: "t", prompt: "p", url: "https://a.com/" }), id: 'x"><img src=x onerror=alert(1)>' };
  assert.throws(() => validateMod(bad), /invalid id/);
});

test("a title cannot add lines to the userscript header", () => {
  const m = createMod({ title: "Nice\n// @match *://*/*\n// @grant GM_xmlhttpRequest", prompt: "p\r\nq", url: "https://a.com/" });
  const header = toUserscript(m).split("// ==/UserScript==")[0];
  // Userscript managers read one key per line that starts with "// @".
  const keys = header.split("\n").filter(l => /^\/\/ @/.test(l)).map(l => l.split(/\s+/)[1]);
  assert.equal(keys.filter(k => k === "@match").length, 1);
  assert.deepEqual(keys.filter(k => k === "@grant"), ["@grant"]);
  assert.match(header, /@grant\s+none/);
});
