(async () => {
  try {
    const hello = await call("hello", { url: location.href });
    S.label = hello.label; S.mode = hello.mode; S.app = hello.app || null; S.appName = hello.appName || hello.app || null;
    await syncMods();
    if (!hello.quiet) toast(`Morse is ready · press ${HOTKEY}`);
  } catch (e) { console.warn("[morse] host unavailable", e); }
  // single-page apps change URL without reloading
  setInterval(() => { if (location.href !== S.url) { S.url = location.href; syncMods().catch(() => {}); } }, 1000);
})();

// Read-only status for automated screenshots/tests; off unless opted in.
// Mirrored into a DOM attribute so it is readable from any JS world.
if (DEBUG) setInterval(() => {
  hostEl.dataset.status = JSON.stringify({ phase: S.phase, hint: hint.textContent, ticker: ticker.textContent, mods: S.mods.length });
}, 40);
