// Terminal colors for the `morse` command, the same on macOS, Windows and Linux.
//
// Colors only go to a terminal: piped or redirected output (`morse apps >
// apps.txt`, Git Bash's mintty, CI logs) gets plain text. NO_COLOR turns them
// off and FORCE_COLOR turns them on (https://no-color.org). Node 22 needs
// Windows 10 or later, where cmd, PowerShell and Windows Terminal all show
// these codes (Node turns that on for the console), so Windows needs no
// special case beyond being a terminal.

export function colorOn({ stream = process.stdout, env = process.env } = {}) {
  if (env.NO_COLOR != null && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR != null) return !/^(0|false)$/i.test(env.FORCE_COLOR);
  if (!stream?.isTTY) return false;
  return env.TERM !== "dumb";
}

// { g green, d dim, b bold, w white, y yellow, r red }: each wraps text in
// its color, or returns it as is when colors are off.
export function painter(on = colorOn()) {
  const wrap = code => on ? s => `\x1b[${code}m${s}\x1b[0m` : s => String(s);
  return { on, g: wrap(32), d: wrap(2), b: wrap(1), w: wrap(97), y: wrap(33), r: wrap(31) };
}

export const paint = painter();

// Words from mods, pages and apps (a mod's title, a window's title) go to the
// terminal as one line of text: escape sequences in them could move the
// cursor and rewrite what was printed above, hide text or set the clipboard,
// and direction overrides could make a line read in another order.
export const shown = s => String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]+/g, " ");
