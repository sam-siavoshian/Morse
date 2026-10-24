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
import { LANGUAGES, CATALOGS } from "../core/i18n.js";
import { readWords } from "../core/languages.js";

// Every language's words, for the few the boot compares against. The UI
// carries English only (core/i18n.js): another language comes from the host
// when it is chosen (runtime/src/04-i18n.js).
const ALL_WORDS = await Promise.all(LANGUAGES.map(l => (l.code === "en" ? CATALOGS.en : readWords(l.code))));

const SRC = new URL("./src/", import.meta.url);
const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");

// Never throw into the page: a failure stays a console warning.
const guarded = (name, body) => `/* Morse ${name} (built from runtime/) */\n(() => {\nconst run = () => {\n${body}\n};\ntry { run(); } catch (e) { try { console.warn("[morse] ${name} failed", e); } catch {} }\n})();\n`;

// Every page parses the boot, so its whole-line comments are dropped (the
// sources keep them). Safe because none of its sources has a multi-line
// template literal; tests/perf.test.js checks the result still runs.
const lean = src => src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\n{2,}/g, "\n");

// Self-heal detection runs in the boot; it needs only the pure first half of
// core/heal.js (selectors, fingerprints, the verdict), not the wording,
// candidate ranking or sharing, which stay with the UI.
const HEAL_DETECT = "// ---- what the person reads";
// The boot needs only what spots harm in core/guard.js (the words for the
// model are added by the UI, 97-boot.js guardStop): from the page selectors
// to endlessLoop, and cssKey.
// Settings checks a new shortcut (checkCombo); the boot only reads them.
const HOTKEYS_BOOT = { parts: [[null, "// ---- vetting"], ["export function resolveHotkeys", null]] };
const GUARD_DETECT = { parts: [["// Selectors that mean", "// Requests where reloading"], ["// A short fingerprint of CSS", null]], also: ["endlessLoop", "codeOnly"] };

// The boot shows no words of its own (core/i18n.js and its catalogs are the
// UI's): t() here only satisfies the hotkey labels, which the boot never
// reads. What the boot compares against is in every language.
const BOOT_WORDS = `const t = id => id;\nconst AUTO_FIX_NOTES = ${JSON.stringify([...new Set(ALL_WORDS.map(c => c["heal.autoNote"]))])};\n`;

export function bundleBoot() {
  return lean(guarded("boot",`${BOOT_WORDS}${inlineModule("../core/hotkeys.js", null, HOTKEYS_BOOT)}\n${inlineModule("../core/prefs.js")}\n${inlineModule("../core/control.js")}\n${inlineModule("../core/heal.js", HEAL_DETECT)}\n${inlineModule("../core/guard.js", null, GUARD_DETECT)}\n// ---- runtime/boot.js\n${read("./boot.js")}`));
}

export function bundleUI() {
  const parts = readdirSync(SRC).filter(f => f.endsWith(".js")).sort()
    .map(f => `// ---- ${f}\n${readFileSync(new URL(f, SRC), "utf8")}`);
  const tokens = read("../design/tokens.css");
  // Pure core modules shared with the hosts: hotkeys/prefs inlined with `export`
  // dropped; the edit compiler inlined in its own scope (God mode).
  const shared = ["hotkeys.js", "prefs.js"]
    .map(f => `// ---- core/${f}\n${dropImports(read(`../core/${f}`), new URL(`../core/${f}`, import.meta.url)).replace(/^export /gm, "")}`);
  // i18n first: the modules after it use t() (their `import … from "./i18n.js"` is dropped).
  shared.unshift(inlineModule("../core/i18n.js"));
  shared.push(inlineModule("../core/edits.js"));
  shared.push(inlineModule("../core/versions.js")); // keep iterating: mod version history (60/70)
  shared.push(inlineModule("../core/onboarding.js")); // first run and help (runtime/src/59-onboarding.js)
  shared.push(inlineModule("../core/answer.js")); // Ask and find: reply parser + markdown subset
  shared.push(inlineModule("../core/summary.js"), inlineModule("../core/control.js")); // user control
  shared.push(inlineModule("../core/gallery.js")); // gallery hook: Mods for this site (68-gallery.js)
  shared.push(inlineModule("../core/a11y.js")); // Easier to use: page tools, Check this page, fixes
  shared.push(inlineModule("../core/showonce.js")); // show-once hook: steps, selectors, words (64-show-once.js)
  shared.push(inlineModule("../core/heal.js")); // self-heal hook: mods that keep working (71-heal.js)
  shared.push(inlineModule("../core/style.js")); // your-style hook: one style on every site (72-style.js)
  shared.push(inlineModule("../core/guard.js")); // guard hook: CSS that would hide the whole page (64-guard.js)
  return guarded("ui", `const TOKENS_CSS = ${JSON.stringify(tokens)};\n${shared.join("\n")}\n${parts.join("\n")}`);
}

export function bundleRuntime() {
  if (!existsSync(SRC)) return read("./runtime.js");
  return bundleBoot() + bundleUI();
}

// Inlines a dependency-free ES module as a block whose exports become locals,
// so its private helpers can't collide with runtime names.
// A default import of a data module (a language catalog) becomes a local
// const; a named import from another inlined module is dropped, since its
// names are already in scope.
// until: inline only the part of the file before this line.
// parts: only these [from, to] slices of it (null: its start or end), and
// also: private names to hand out as well.
function inlineModule(rel, until = null, { parts = null, also = [] } = {}) {
  let src = dropImports(read(rel), new URL(rel, import.meta.url));
  const at = (marker, dflt) => {
    if (marker == null) return dflt;
    const i = src.indexOf(marker);
    if (i < 0) throw new Error(`${rel}: no "${marker}" to cut at (runtime/bundle.js)`);
    return i;
  };
  if (until) src = src.slice(0, at(until));
  if (parts) src = parts.map(([a, b]) => src.slice(at(a, 0), at(b, src.length))).join("\n");
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]).concat(also);
  return `// ---- ${rel.replace("../", "")} (inlined)\nconst { ${names.join(", ")} } = (() => {\n${src.replace(/^export\s+/gm, "")}\nreturn { ${names.join(", ")} };\n})();`;
}

function dropImports(src, base) {
  return src
    .replace(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+"(\.[^"]+)";?[^\n]*$/gm, (_, name, spec) =>
      `const ${name} = ${readFileSync(new URL(spec, base), "utf8").replace(/^\s*export\s+default\s+/m, "").replace(/^\s*\/\/.*$/gm, "").trim().replace(/;$/, "")};`)
    .replace(/^import\s*\{[^}]*\}\s*from\s*"\.\/[^"]+";?[^\n]*$/gm, "");
}
