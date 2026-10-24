// MORSE_TRACE=1 (or a file path): one line per step of a change, for seeing
// how Morse works and for debugging. Off unless set. Never prints keys,
// tokens or the page's content, only what happened, where and how long.
//
//   12:04:01.120  bar      "make the status bar purple" · pointed at .statusbar
//   12:04:01.124  model    claude-code · haiku (warm process)
//   12:04:01.130  harness  claude -p --output-format stream-json … --model haiku
//   12:04:02.310  stream   first token after 1180ms
//   12:04:02.420  page     CSS applied live (1 rule) via CDP Runtime.evaluate
//   ...
import { appendFileSync } from "node:fs";

const where = process.env.MORSE_TRACE;
const on = !!where && where !== "0";
const toFile = on && where !== "1" && where !== "stderr";

const time = () => new Date().toISOString().slice(11, 23);

export const tracing = on;

export function trace(kind, text) {
  if (!on) return;
  const line = `${time()}  ${String(kind).padEnd(8)} ${text}\n`;
  if (toFile) { try { appendFileSync(where, line); } catch {} }
  else process.stderr.write(line);
}
