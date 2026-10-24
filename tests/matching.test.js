// Where a mod applies: per file for local pages, per app for desktop apps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMod, hostOf, modMatches, toUserscript } from "../core/mod.js";

test("a mod made on a local file applies to that file only", () => {
  assert.equal(hostOf("file:///home/me/notes/todo.html?x=1#top"), "file:///home/me/notes/todo.html");
  const mod = createMod({ prompt: "p", url: "file:///home/me/notes/todo.html" });
  assert.deepEqual(mod.match.hosts, ["file:///home/me/notes/todo.html"]);
  assert.ok(modMatches(mod, { url: "file:///home/me/notes/todo.html#later", app: null }));
  assert.ok(!modMatches(mod, { url: "file:///home/me/notes/other.html", app: null }));
  assert.ok(!modMatches(mod, { url: "file:///home/me/todo.html", app: null }), "same name, other directory");
  assert.ok(!modMatches(mod, { url: "https://example.com/home/me/notes/todo.html", app: null }));
  // The userscript export matches the same single file.
  assert.match(toUserscript(mod), /@match\s+file:\/\/\/home\/me\/notes\/todo\.html\n/);
});

test("mods saved before per-file matching keep working on local files", () => {
  const old = { ...createMod({ prompt: "p", url: "file:///a.html" }), match: { hosts: ["file"], app: null } };
  assert.ok(modMatches(old, { url: "file:///b.html", app: null }));
  assert.ok(!modMatches(old, { url: "https://example.com/", app: null }));
});

test("wildcard hosts never match a local file", () => {
  const mod = { ...createMod({ prompt: "p", url: "https://a.com/" }), match: { hosts: ["*.com"], app: null } };
  assert.ok(modMatches(mod, { url: "https://www.a.com/", app: null }));
  assert.ok(!modMatches(mod, { url: "file:///x/www.a.com", app: null }));
});

test("a desktop app's mod follows the app, whatever localhost port it loads from", () => {
  const mod = createMod({ prompt: "p", url: "http://127.0.0.1:53121/index.html", app: "notes" });
  assert.ok(modMatches(mod, { url: "http://127.0.0.1:61877/index.html", app: "notes" }));
  assert.ok(modMatches(mod, { url: "http://localhost:40001/index.html", app: "notes" }));
  assert.ok(!modMatches(mod, { url: "https://files.example.com/", app: "notes" }), "other hosts in the app (webviews, frames) keep their own mods");
  assert.ok(!modMatches(mod, { url: "http://127.0.0.1:53121/index.html", app: "other" }));
  assert.ok(!modMatches(mod, { url: "http://127.0.0.1:53121/index.html", app: null }), "not in a browser on the same host");
});
