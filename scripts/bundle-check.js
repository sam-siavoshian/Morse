// The runtime bundle check, shared by `npm run check` and `npm test`
// (tests/bundle.test.js). runtime/bundle.js joins core/hotkeys.js and
// core/prefs.js (export dropped), the exports of the inlined core modules and
// runtime/src/*.js into one function scope, so:
//   - no top-level name may be declared twice: a second const/let is a
//     SyntaxError that kills the whole runtime, a second function silently
//     replaces the first (this has broken the bundle before)
//   - the bundle must parse
// Returns { problems: [string], names: count }, each problem naming both places.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { bundleRuntime } from "../runtime/bundle.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Top-level declarations in this codebase start at column 0.
export function topLevelNames(src) {
  const names = [];
  const add = (n, line) => n && names.push({ name: n, line });
  src.split("\n").forEach((l, i) => {
    let m;
    if ((m = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], i + 1);
    else if ((m = /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], i + 1);
    else if ((m = /^(?:export\s+)?(?:const|let|var)\s+\{([^}]*)\}\s*=/.exec(l))) {
      for (const part of m[1].split(",")) { const n = part.split(":").pop().split("=")[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) add(n, i + 1); }
    } else if ((m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(l))) {
      add(m[1], i + 1);
      // let a = 1, b = 2; on one line
      for (const extra of l.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) if (!/[([{]/.test(l.slice(0, extra.index).replace(/^[^=]*=/, ""))) add(extra[1], i + 1);
    }
  });
  return names;
}

export function runtimeBundleProblems() {
  const problems = [];
  const seen = new Map(); // name -> "file:line"
  const declare = (where, src) => {
    for (const { name, line } of topLevelNames(src)) {
      const at = `${where}:${line}`;
      if (seen.has(name)) problems.push(`"${name}" is declared at top level in both ${seen.get(name)} and ${at}`);
      else seen.set(name, at);
    }
  };
  // The UI half's scope (runtime/bundle.js bundleUI); the boot half is its own
  // scope and is checked in tests/bundle.test.js.
  const whole = readFileSync(path.join(root, "runtime", "bundle.js"), "utf8");
  const ui = whole.indexOf("export function bundleUI(");
  const end = ui < 0 ? -1 : whole.indexOf("\nexport function", ui + 1);
  const bundleSrc = ui < 0 ? whole : whole.slice(ui, end < 0 ? undefined : end);
  seen.set("TOKENS_CSS", "runtime/bundle.js");
  // core modules inlined with `export` dropped (const shared = ["hotkeys.js", …])
  const shared = /const shared = \[([^\]]*)\]/.exec(bundleSrc)?.[1].match(/[\w.-]+\.js/g) || [];
  for (const f of shared) declare(`core/${f}`, readFileSync(path.join(root, "core", f), "utf8"));
  // core modules inlined in their own block: only their exports join the scope
  for (const [, mod] of bundleSrc.matchAll(/inlineModule\("\.\.\/core\/([\w.-]+)"\)/g)) {
    const src = readFileSync(path.join(root, "core", mod), "utf8");
    for (const [, name] of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(name)) problems.push(`"${name}" (exported by core/${mod}, inlined) is also declared in ${seen.get(name)}`);
      else seen.set(name, `core/${mod} (inlined)`);
    }
  }
  const SRC = path.join(root, "runtime", "src");
  for (const f of readdirSync(SRC).filter(f => f.endsWith(".js")).sort()) declare(`runtime/src/${f}`, readFileSync(path.join(SRC, f), "utf8"));
  try { new vm.Script(bundleRuntime(), { filename: "runtime.js" }); }
  catch (e) { problems.push(`the bundle doesn't parse: ${e.message}`); }
  return { problems, names: seen.size };
}
