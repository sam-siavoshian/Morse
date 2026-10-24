// Assembles the in-app runtime from runtime/src/*.js (sorted by filename) into
// one IIFE string. Both the extension build and the desktop connector inject
// exactly this string.
import { readFileSync, readdirSync, existsSync } from "node:fs";

const SRC = new URL("./src/", import.meta.url);

export function bundleRuntime() {
  if (!existsSync(SRC)) return readFileSync(new URL("./runtime.js", import.meta.url), "utf8");
  const parts = readdirSync(SRC).filter(f => f.endsWith(".js")).sort()
    .map(f => `// ---- ${f}\n${readFileSync(new URL(f, SRC), "utf8")}`);
  const tokens = readFileSync(new URL("../design/tokens.css", import.meta.url), "utf8");
  // Pure core modules shared with the hosts: hotkeys/prefs inlined with `export`
  // dropped; the edit compiler inlined in its own scope (God mode).
  const shared = ["hotkeys.js", "prefs.js"]
    .map(f => `// ---- core/${f}\n${readFileSync(new URL(`../core/${f}`, import.meta.url), "utf8").replace(/^export /gm, "")}`);
  shared.push(inlineModule("../core/edits.js"));
  shared.push(inlineModule("../core/versions.js")); // keep iterating: mod version history (60/70)
  shared.push(inlineModule("../core/onboarding.js")); // first run and help (runtime/src/59-onboarding.js)
  shared.push(inlineModule("../core/answer.js")); // Ask and find: reply parser + markdown subset
  shared.push(inlineModule("../core/gallery.js")); // gallery hook: Mods for this site (68-gallery.js)
  return `/* Morse runtime (built from runtime/src) */\n(() => {\nconst TOKENS_CSS = ${JSON.stringify(tokens)};\n${shared.join("\n")}\n${parts.join("\n")}\n})();\n`;
}

// Inlines a dependency-free ES module as a block whose exports become locals,
// so its private helpers can't collide with runtime names.
function inlineModule(rel) {
  const src = readFileSync(new URL(rel, import.meta.url), "utf8");
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  return `// ---- ${rel.replace("../", "")} (inlined)\nconst { ${names.join(", ")} } = (() => {\n${src.replace(/^export\s+/gm, "")}\nreturn { ${names.join(", ")} };\n})();`;
}
