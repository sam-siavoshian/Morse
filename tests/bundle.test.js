// The runtime ships in two halves (runtime/bundle.js): the boot, and the UI
// that joins it on first use. Each half is one shared scope (the UI joins
// runtime/src in order). A second top-level function or const with the same
// name silently replaces the first, so neither half may have any.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleBoot, bundleUI, bundleRuntime } from "../runtime/bundle.js";

function duplicates(bundle) {
  // Inlined core modules are wrapped in their own block, so their private
  // helpers may reuse a name; only the runtime's top level must be unique.
  const src = bundle.replace(/^const \{[^}]*\} = \(\(\) => \{\n[\s\S]*?\n\}\)\(\);$/gm, "");
  const count = new Map();
  for (const m of src.matchAll(/^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) count.set(m[1], (count.get(m[1]) || 0) + 1);
  return { size: count.size, dups: [...count].filter(([, n]) => n > 1).map(([k]) => k) };
}

test("no two top-level names in the runtime bundle are the same", () => {
  const ui = duplicates(bundleUI()), boot = duplicates(bundleBoot());
  assert.ok(ui.size > 50, "found the UI's top-level names");
  assert.ok(boot.size > 20, "found the boot's top-level names");
  assert.deepEqual(ui.dups, [], "UI");
  assert.deepEqual(boot.dups, [], "boot");
  // The one-file runtime is exactly the two halves, each in its own scope.
  assert.equal(bundleRuntime(), bundleBoot() + bundleUI());
});
