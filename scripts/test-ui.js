// `npm run test:ui`: the tests that need a display (Chromium extensions only
// load headed). They're the test files that skip on `noDisplay`
// (tests/helpers/browser.js); `npm test` skips them when there's no $DISPLAY.
// Runs them on the current display, or under a virtual one with xvfb-run.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const files = readdirSync(path.join(root, "tests"))
  .filter(f => f.endsWith(".test.js") && /\bnoDisplay\b/.test(readFileSync(path.join(root, "tests", f), "utf8")))
  .map(f => path.join("tests", f));
if (!files.length) { console.log("No display tests."); process.exit(0); }

const args = ["--test", ...process.argv.slice(2), ...files];
const hasXvfb = spawnSync("xvfb-run", ["--help"], { stdio: "ignore" }).error == null;
let r;
if (process.env.DISPLAY) r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
else if (hasXvfb) r = spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1280x900x24", process.execPath, ...args], { cwd: root, stdio: "inherit" });
else { console.error("These tests need a display: set $DISPLAY or install xvfb (xvfb-run)."); process.exit(1); }
process.exit(r.status ?? 1);
