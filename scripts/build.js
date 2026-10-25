// Builds the runtime into dist/runtime/runtime.js: Morse's bar in one file,
// for the pages that load it directly (the site's Try it here, the demo
// playgrounds). The desktop app bundles its own copy at run time
// (daemon/connector.js); nothing else needs a build.
//
//   node scripts/build.js

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleRuntime } from "../runtime/bundle.js";

// fileURLToPath, not URL.pathname: that gives /C:/… on Windows and %20 for spaces.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "runtime");
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, "runtime.js"), bundleRuntime());
console.log(`Built ${path.relative(root, out)}/runtime.js`);
