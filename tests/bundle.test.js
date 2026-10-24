// The runtime is one shared scope (runtime/bundle.js joins runtime/src in
// order). A second top-level function or const with the same name silently
// replaces the first, so the build must have none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleRuntime } from "../runtime/bundle.js";

test("no two top-level names in the runtime bundle are the same", () => {
  // Inlined core modules are wrapped in their own block, so their private
  // helpers may reuse a name; only the runtime's top level must be unique.
  const src = bundleRuntime().replace(/^const \{[^}]*\} = \(\(\) => \{\n[\s\S]*?\n\}\)\(\);$/gm, "");
  const count = new Map();
  for (const m of src.matchAll(/^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) count.set(m[1], (count.get(m[1]) || 0) + 1);
  assert.ok(count.size > 50, "found the runtime's top-level names");
  assert.deepEqual([...count].filter(([, n]) => n > 1).map(([k]) => k), []);
});
