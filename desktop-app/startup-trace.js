// Start-up timing marks for Morse Desktop (docs/perf/startup.md). Off unless
// MORSE_STARTUP_TRACE names a file: then main.js marks each step, the window's
// own marks are read back from the page (performance.mark in ui/app.js), and
// the whole timeline is written there as JSON once the app list has rendered.
// MORSE_STARTUP_QUIT=1 quits after writing (demo/perf.js --only startup).
//
// Times are wall-clock milliseconds (Date.now()), so the harness that started
// the process can line them up with the moment it spawned it.

const FILE = process.env.MORSE_STARTUP_TRACE || "";
export const tracing = !!FILE;
const marks = {};
// Node's timeOrigin is when this process started.
if (tracing) marks.process = Math.round(performance.timeOrigin);
mark("main:start"); // the first of main.js's imports to run

export function mark(name) {
  if (tracing && !(name in marks)) marks[name] = Math.round(performance.timeOrigin + performance.now());
}

// The page's marks: navigation timing, first paint, and Morse's own
// performance.mark("morse:…") calls, as wall-clock times.
const PAGE_MARKS = `(() => {
  const o = performance.timeOrigin, out = {};
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav) { out.domContentLoaded = o + nav.domContentLoadedEventEnd; if (nav.loadEventEnd) out.load = o + nav.loadEventEnd; }
  for (const p of performance.getEntriesByType("paint")) out[p.name] = o + p.startTime;
  for (const m of performance.getEntriesByType("mark")) if (m.name.startsWith("morse:")) out[m.name.slice(6)] = o + m.startTime;
  return out;
})()`;

// Waits for the page's "apps-listed" mark (the app list showing apps, or
// saying there are none), then writes the file. Gives up after 60 s.
export function collect(win, { quit } = {}) {
  if (!tracing) return;
  const started = Date.now();
  const tick = async () => {
    if (!win || win.isDestroyed()) return;
    let page = {};
    try { page = await win.webContents.executeJavaScript(PAGE_MARKS, true); } catch {}
    if (!page["apps-listed"] && Date.now() - started < 60000) { setTimeout(tick, 20); return; }
    const all = { ...marks };
    for (const [k, v] of Object.entries(page)) all[`page:${k}`] = Math.round(v);
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(FILE, JSON.stringify(all, null, 2));
    } catch {}
    if (process.env.MORSE_STARTUP_QUIT === "1") quit?.();
  };
  tick();
}
