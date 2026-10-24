// A stand-in for Morse Desktop's Morse helper, for tests and screenshots
// (onboarding v2): the real daemon/bridge.js, as Morse Desktop runs it
// (app "desktop", with the Allow question). The question goes to stdout as
// "ASK <words as JSON>"; a line on stdin answers it: "allow" or "deny".
//
//   MORSE_HOME=… MORSE_PROVIDER=demo MORSE_HELPER_PORT=… node tests/helpers/fake-desktop.js
import { createBridge } from "../../daemon/bridge.js";

let waiting = null;
const bridge = createBridge({
  port: Number(process.env.MORSE_HELPER_PORT) || 7457, app: "desktop", denyPauseMs: 300,
  log: line => console.log(line.trim()),
  ask: ({ words, signal }) => new Promise(resolve => {
    waiting = resolve;
    console.log("ASK " + JSON.stringify(words));
    signal.addEventListener("abort", () => { if (waiting === resolve) waiting = null; console.log("ASK-GONE"); });
  }),
});
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", d => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (waiting && line) { const w = waiting; waiting = null; w(line === "allow"); }
  }
});
await bridge.listen();
console.log("READY");
const stop = async () => { await bridge.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
