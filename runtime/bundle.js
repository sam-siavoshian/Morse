// Assembles the in-app runtime from runtime/src/*.js (sorted by filename) into
// one IIFE string. Both the extension build and the desktop connector inject
// exactly this string.
import { readFileSync, readdirSync, existsSync } from "node:fs";

const SRC = new URL("./src/", import.meta.url);

export function bundleRuntime() {
  if (!existsSync(SRC)) return readFileSync(new URL("./runtime.js", import.meta.url), "utf8");
  const parts = readdirSync(SRC).filter(f => f.endsWith(".js")).sort()
    .map(f => `// ---- ${f}\n${readFileSync(new URL(f, SRC), "utf8")}`);
  return `/* Morse runtime (built from runtime/src) */\n(() => {\n${parts.join("\n")}\n})();\n`;
}
