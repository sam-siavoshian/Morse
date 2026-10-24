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
  // Pure core modules the runtime shares with the hosts (no imports; `export` dropped).
  const shared = ["hotkeys.js", "prefs.js"]
    .map(f => `// ---- core/${f}\n${readFileSync(new URL(`../core/${f}`, import.meta.url), "utf8").replace(/^export /gm, "")}`);
  return `/* Morse runtime (built from runtime/src) */\n(() => {\nconst TOKENS_CSS = ${JSON.stringify(tokens)};\n${shared.join("\n")}\n${parts.join("\n")}\n})();\n`;
}
