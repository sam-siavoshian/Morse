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
