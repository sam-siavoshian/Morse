// Assembles the in-app runtime. Morse ships it in two parts:
//
//   boot  runtime/boot.js (+ core/hotkeys, prefs, control): every page, as
//         early as possible. Applies mods, follows navigations, owns the
//         hotkeys. A few KB, nothing built until it's needed.
//   ui    runtime/src/*.js (sorted by filename): the bar, panel, effect, God
//         mode. Injected by the host on first use ("ui.load") and adopts the
//         boot's state through a handoff object.
//
// bundleRuntime() is both, back to back, for pages that load Morse in one go
// (the playgrounds, the UI catalog, tests).
import { readFileSync, readdirSync, existsSync } from "node:fs";

const SRC = new URL("./src/", import.meta.url);
const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");

// Never throw into the page: a failure stays a console warning.
const guarded = (name, body) => `/* Morse ${name} (built from runtime/) */\n(() => {\nconst run = () => {\n${body}\n};\ntry { run(); } catch (e) { try { console.warn("[morse] ${name} failed", e); } catch {} }\n})();\n`;

// Every page parses the boot, so its whole-line comments are dropped (the
// sources keep them). Safe because none of its sources has a multi-line
// template literal; tests/perf.test.js checks the result still runs.
const lean = src => src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\n{2,}/g, "\n");

export function bundleBoot() {
  return lean(guarded("boot",`${inlineModule("../core/hotkeys.js")}\n${inlineModule("../core/prefs.js")}\n${inlineModule("../core/control.js")}\n// ---- runtime/boot.js\n${read("./boot.js")}`));
}

export function bundleUI() {
  const parts = readdirSync(SRC).filter(f => f.endsWith(".js")).sort()
    .map(f => `// ---- ${f}\n${readFileSync(new URL(f, SRC), "utf8")}`);
  const tokens = read("../design/tokens.css");
  // Pure core modules shared with the hosts: hotkeys/prefs inlined with `export`
  // dropped; the edit compiler inlined in its own scope (God mode).
  const shared = ["hotkeys.js", "prefs.js"]
    .map(f => `// ---- core/${f}\n${read(`../core/${f}`).replace(/^export /gm, "")}`);
  shared.push(inlineModule("../core/edits.js"));
  shared.push(inlineModule("../core/versions.js")); // keep iterating: mod version history (60/70)
  shared.push(inlineModule("../core/onboarding.js")); // first run and help (runtime/src/59-onboarding.js)
  shared.push(inlineModule("../core/answer.js")); // Ask and find: reply parser + markdown subset
  shared.push(inlineModule("../core/summary.js"), inlineModule("../core/control.js")); // user control
  shared.push(inlineModule("../core/gallery.js")); // gallery hook: Mods for this site (68-gallery.js)
  shared.push(inlineModule("../core/a11y.js")); // Easier to use: page tools, Check this page, fixes
  return guarded("ui", `const TOKENS_CSS = ${JSON.stringify(tokens)};\n${shared.join("\n")}\n${parts.join("\n")}`);
}

export function bundleRuntime() {
  if (!existsSync(SRC)) return read("./runtime.js");
  return bundleBoot() + bundleUI();
}

// Inlines a dependency-free ES module as a block whose exports become locals,
// so its private helpers can't collide with runtime names.
function inlineModule(rel) {
  const src = read(rel);
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  return `// ---- ${rel.replace("../", "")} (inlined)\nconst { ${names.join(", ")} } = (() => {\n${src.replace(/^export\s+/gm, "")}\nreturn { ${names.join(", ")} };\n})();`;
}
