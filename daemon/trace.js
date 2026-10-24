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
//
// A file path is appended to, as given (a symlink is followed): it is the
// person's own choice in their own environment, like a shell redirect. A file
// it creates is readable by its owner only (the lines hold their requests).
import { appendFileSync } from "node:fs";

const where = process.env.MORSE_TRACE;
// Unset, empty, 0, false, off or no: off (never a file named "false").
const on = !!where && !/^(0|false|off|no)$/i.test(where.trim());
const toFile = on && where !== "1" && where !== "stderr";

const time = () => new Date().toISOString().slice(11, 23);
// Lines carry text from pages, mods and the model (a window's title, a mod's
// name, an error): no escape sequences or line breaks reach the terminal.
const plain = s => String(s).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, " ");

export const tracing = on;

export function trace(kind, text) {
  if (!on) return;
  const line = `${time()}  ${plain(kind).padEnd(8)} ${plain(text)}\n`;
  if (toFile) { try { appendFileSync(where, line, { mode: 0o600 }); } catch {} }
  else process.stderr.write(line);
}
