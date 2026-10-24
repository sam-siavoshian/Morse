// Choose with keys: pointing without a mouse. While the bar is open, Alt+↓
// (⌥↓ on a Mac), or "Choose with keys" in the ⋯ menu, walks the parts of the
// page people act on (landmarks, headings, links, buttons, fields, pictures)
// in page order. Each one gets the same frame and label as the mouse picker,
// and screen readers hear its name.
//   ↓ ↑        next / previous part        ← →   a bigger / smaller part around it
//   Home End   first / last                Enter or Space   choose it
//   Esc        stop (nothing chosen)       typing goes back to the bar
// Only real key presses count (isTrusted), like every key Morse takes.

const KEYPICK_COMBO = "Alt+ArrowDown";

const KeyPick = (() => {
  const PARTS = [
    "header, nav, main, aside, footer, form, search, section[aria-label], section[aria-labelledby], [role=banner], [role=navigation], [role=main], [role=complementary], [role=contentinfo], [role=search], [role=region], [role=form], [role=toolbar], [role=dialog]",
    "h1, h2, h3, h4, h5, h6, [role=heading]",
    "a[href], button, input:not([type=hidden]), select, textarea, summary, label, [contenteditable=''], [contenteditable=true], [tabindex]:not([tabindex='-1']), [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=option]",
    "img, picture, video, audio, canvas, svg, iframe, table, [role=img]",
  ].join(", ");
  const K = { on: false, list: [], i: 0, el: null, wider: [] };

  const shown = el => {
    if (el.closest("[data-morse-ui]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    return !el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  };
  // Page order, open shadow roots included (right after their host), at most 3000.
  function collect() {
    const out = [];
    const visit = scope => {
      for (const el of scope.querySelectorAll("*")) {
        if (out.length >= 3000) return;
        if (el === hostEl) continue;
        if (el.matches(PARTS) && !(el.localName === "svg" && el.parentElement?.closest("button, a, [role=button]")) && shown(el)) out.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(document);
    return out;
  }

  function show(el, { first = false } = {}) {
    K.el = el;
    hoverEl = el;
    try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch {}
    boxTo(el, hl, describe(el));
    placeBar(el.getBoundingClientRect());
    const where = K.wider.length ? "bigger part" : `${K.i + 1} of ${K.list.length}`;
    announce(first
      ? `Choose with keys. ${describe(el)}, ${where}. Up and down arrows move, left arrow picks a bigger part, Enter chooses it, Escape stops.`
      : `${describe(el)}, ${where}`);
  }

  function start() {
    if (!S.open || S.phase !== "idle") return;
    K.list = collect();
    if (!K.list.length) { note(`Nothing on this page to choose with keys · just describe the change`); return; }
    hideMenu();
    if (paneKind) showPane("");
    // From what's chosen now, or the top of the page.
    const from = S.target ? K.list.findIndex(x => x === S.target || S.target.contains(x) || (S.target.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)) : 0;
    if (S.target) setTarget(null);
    S.picking = true;
    K.on = true;
    K.wider = [];
    K.i = Math.max(0, from);
    input.focus({ preventScroll: true });
    note(`<b>Choose with keys</b> · <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>←</kbd> bigger · <kbd>Enter</kbd> choose · <kbd>Esc</kbd> stop`, 0);
    show(K.list[K.i], { first: true });
  }
  function stop({ quiet = false } = {}) {
    if (!K.on) return;
    K.on = false;
    K.el = null;
    K.wider = [];
    hl.hidden = true;
    hintNote = "";
    setHint();
    if (!quiet) announce("Stopped choosing");
  }
  function choose() {
    const el = K.el;
    stop({ quiet: true });
    if (el?.isConnected) setTarget(el); // says what was chosen (50-bar.js)
  }
  function move(d) {
    const n = K.list.length;
    K.wider = [];
    K.i = d === "first" ? 0 : d === "last" ? n - 1 : (K.i + d + n) % n;
    if (!K.list[K.i].isConnected || !shown(K.list[K.i])) { K.list = collect(); K.i = Math.min(K.i, K.list.length - 1); }
    if (K.list[K.i]) show(K.list[K.i]);
  }
  function wider() {
    const r = K.el.getBoundingClientRect();
    for (let p = K.el.parentElement || K.el.getRootNode()?.host; p && p !== document.body && p !== document.documentElement; p = p.parentElement || p.getRootNode()?.host) {
      const q = p.getBoundingClientRect();
      if (q.width * q.height > r.width * r.height + 4 && shown(p)) { K.wider.push(K.el); return show(p); }
    }
    announce("This is the biggest part");
  }
  function smaller() {
    if (K.wider.length) return show(K.wider.pop());
    const inside = K.list.find(x => x !== K.el && K.el.contains(x));
    if (!inside) return announce("There's nothing smaller inside");
    K.i = K.list.indexOf(inside);
    show(inside);
  }

  // Before 45-godmode.js and 95-keys.js, so these keys are ours while choosing.
  listen("keydown", e => {
    if (!e.isTrusted || e.isComposing || e.keyCode === 229) return;
    if (!K.on) {
      if (S.open && S.phase === "idle" && modal.hidden && !paneKind && matchCombo(e, KEYPICK_COMBO) && !recording) {
        e.preventDefault();
        e.stopImmediatePropagation();
        start();
      }
      return;
    }
    if (!S.open || S.phase !== "idle" || !modal.hidden) return stop({ quiet: true });
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const use = fn => { e.preventDefault(); e.stopImmediatePropagation(); fn(); };
    if (matchCombo(e, KEYPICK_COMBO) || (plain && (e.key === "ArrowDown"))) return use(() => move(1));
    if (plain && e.key === "ArrowUp") return use(() => move(-1));
    if (plain && e.key === "Home") return use(() => move("first"));
    if (plain && e.key === "End") return use(() => move("last"));
    if (plain && e.key === "ArrowLeft") return use(wider);
    if (plain && e.key === "ArrowRight") return use(smaller);
    if (plain && !e.shiftKey && (e.key === "Enter" || e.key === " ")) return use(choose);
    if (e.key === "Escape") return use(() => { stop(); input.focus(); });
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    stop({ quiet: true }); // anything else (typing, Tab): back to the bar as usual
  }, true);
  // The mouse picks, or the bar closes: choosing with keys is over.
  listen("mousedown", () => { if (K.on) stop({ quiet: true }); }, true);
  new MutationObserver(() => { if (bar.hidden) stop({ quiet: true }); }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });

  return { start, stop, get on() { return K.on; }, get current() { return K.el; } };
})();
