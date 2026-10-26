// Try it here: the landing page's live demo, all of it in this folder.
//
// The page holds only an empty <section id="try" class="try"> and this
// script (between <!-- try-it --> markers). This fills the section, adds its
// stylesheet, and loads the demo itself (try.js: the real Morse runtime in a
// sandboxed demo app) only when the section is about to scroll into view, or
// when something in it is clicked, so it costs nothing on the first load.
//
// data-install on the section: where "Get Morse" points (default #install).

const section = document.getElementById("try");
if (section && !section.dataset.ready) {
  section.dataset.ready = "1";
  section.dataset.app = "tunes";
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL("try.css", import.meta.url).href;
  document.head.append(css);
  section.innerHTML = markup();

  let started = null;
  const start = () => (started ||= import("./try.js").then(m => m.startTry(section)));
  section.addEventListener("click", e => {
    const btn = e.target.closest("[data-try]");
    if (!btn) return;
    e.preventDefault();
    start().then(t => t.click(btn)).catch(() => {});
  });
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      // After the page has settled: the demo never gets in the way of anything above it.
      (window.requestIdleCallback || (fn => setTimeout(fn, 200)))(() => start().catch(() => {}), { timeout: 1500 });
    }, { rootMargin: "300px 0px" });
    io.observe(section);
  }
}

function markup() {
  const reload = '<svg class="try-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/></svg>';
  const ask = (text, at) => `<button type="button" class="try-ask" data-try="ask" data-text="${text}"${at ? ` data-at='${at}'` : ""}>${text}</button>`;
  return `
  <div class="try-wrap">
    <header class="try-head">
      <p class="try-eyebrow">Try it here</p>
      <h2>This music app has no sleep timer. Give it one.</h2>
      <p class="try-lede">This is Morse, in a small music app and a news site. Nothing to install. Open it, point at something, and take the feature they left out.</p>
    </header>
    <div class="try-stage">
      <div class="try-window">
        <div class="try-chrome">
          <div class="try-tabs" role="tablist" aria-label="Demo app">
            <button type="button" role="tab" id="try-tab-tunes" aria-selected="true" aria-controls="try-view" data-try="app" data-app="tunes">Music app</button>
            <button type="button" role="tab" id="try-tab-byte" aria-selected="false" aria-controls="try-view" tabindex="-1" data-try="app" data-app="byte">News site</button>
          </div>
          <span class="try-count"></span>
          <button type="button" class="try-tool try-reset" data-try="reset" hidden>Start over</button>
          <button type="button" class="try-tool try-reload" data-try="reload">${reload}Reload app</button>
        </div>
        <div class="try-view" id="try-view" role="tabpanel" aria-label="Demo app">
          <div class="try-poster" aria-hidden="true"><span class="try-dots"><i></i><i></i><i></i></span><span>Loading the demo</span></div>
        </div>
      </div>
      <div class="try-guide">
        <ol class="try-steps">
          <li>
            <h3><span class="try-n" aria-hidden="true">1</span>Open Morse</h3>
            <div class="try-open-row">
              <button type="button" class="try-open" data-try="open">Open Morse</button>
              <span class="try-or">or press <span class="try-keys"><kbd>⌥</kbd> <kbd>Space</kbd></span></span>
            </div>
          </li>
          <li>
            <h3><span class="try-n" aria-hidden="true">2</span>Pick a change</h3>
            <div class="try-asks" data-asks="tunes">${ask("Add a sleep timer", '[data-testid="player-controls"]')}${ask("Make the covers bigger", '[data-testid="album-grid"]')}${ask("Light mode")}</div>
            <div class="try-asks" data-asks="byte" hidden>${ask("Hide the ads")}${ask("Make this easier to read", "article")}${ask("Dark mode")}</div>
            <p>Or point at something in the app and say what you want. The Edit tools and Page tools work here too.</p>
          </li>
          <li>
            <h3><span class="try-n" aria-hidden="true">3</span>Save it, then reload</h3>
            <p>Press Save in the bar, then <b>Reload app</b>. Your change comes back.</p>
          </li>
        </ol>
        <p class="try-status" role="status" aria-live="polite"></p>
      </div>
    </div>
    <p class="try-note">This demo uses sample answers. Install Morse, and your own model writes any change you ask for.</p>
  </div>`;
}
