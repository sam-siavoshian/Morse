// Morse's version: package.json's, one for everything (`morse --version`, the app).
import { readFileSync } from "node:fs";
export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
