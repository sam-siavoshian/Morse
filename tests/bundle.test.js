// The runtime is one shared scope (runtime/bundle.js joins runtime/src in
// order, after the core modules it inlines). A second top-level function or
// const with the same name silently replaces the first or breaks the whole
// runtime, so the bundle must have none, and must parse. The same check runs
// in `npm run check` (scripts/bundle-check.js).
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeBundleProblems, topLevelNames } from "../scripts/bundle-check.js";
import { bundleBoot, bundleUI, bundleRuntime } from "../runtime/bundle.js";

test("no two top-level names in the runtime bundle are the same, and it parses", () => {
  const { problems, names } = runtimeBundleProblems();
  assert.ok(names > 50, "found the runtime's top-level names");
  assert.deepEqual(problems, []);
});

test("the duplicate check sees functions, consts, destructuring and one-line lets", () => {
  const src = "function a() {}\nasync function b() {}\nconst c = 1;\nconst { d, e: f } = x;\nlet g = 1, h = 2;\n  const nested = 1;\nclass K {}\n";
  assert.deepEqual(topLevelNames(src).map(n => n.name), ["a", "b", "c", "d", "f", "g", "h", "K"]);
});

test("the boot half has no duplicate top-level names, and the one-file runtime is boot + UI", () => {
  // The boot (runtime/boot.js) is its own scope; the UI half is checked above.
  const names = topLevelNames(bundleBoot().replace(/^const \{[^}]*\} = \(\(\) => \{\n[\s\S]*?\n\}\)\(\);$/gm, "")).map(n => n.name);
  assert.ok(names.length > 20, "found the boot's top-level names");
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  assert.equal(bundleRuntime(), bundleBoot() + bundleUI());
});
