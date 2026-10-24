// Ask and find: numbered markers on the page. Each thing an answer points at
// gets a ring and a numbered badge; clicking the badge scrolls to it. Things
// off screen get a badge pinned to the nearest edge with an arrow; things
// that aren't showing yet (inside a closed menu) get none until they appear.
// Markers never block the page: only the badges take pointer events.

const Markers = (() => {
  const layer = document.createElement("div");
  layer.className = "mk-layer";
  root.insertBefore(layer, bar); // under the bar, the guide and toasts
  let items = [], raf = 0, lastFind = 0;

  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 &&
    (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  const nameOf = el => (el.getAttribute("aria-label") || el.innerText || el.textContent || el.getAttribute("title") || el.value || "").trim().replace(/\s+/g, " ").toLowerCase();

  // A selector from the model, made forgiving: jQuery-style :contains("x") /
  // :has-text("x") filter by text; a selector that matches nothing falls back
  // to a control whose name matches the label.
  function find(selector, label) {
    const ours = el => el.closest?.("[data-morse-ui]");
    let sel = String(selector || "").trim(), text = "";
    const m = sel.match(/:(?:contains|has-text)\(\s*(["']?)(.*?)\1\s*\)/i);
    if (m) { text = m[2].toLowerCase(); sel = sel.replace(m[0], "").trim(); }
    let list = [];
    try { if (sel || text) list = [...document.querySelectorAll(sel || "a,button,summary,[role],label,h1,h2,h3,li,span")]; } catch {}
    list = list.filter(e => !ours(e));
    if (text) {
      list = list.filter(e => nameOf(e).includes(text));
      list = list.filter(e => !list.some(o => o !== e && e.contains(o))); // the innermost match
    }
    const hit = list.find(visible) || list[0];
    if (hit) return hit;
    const L = String(label || "").trim().toLowerCase();
    if (L.length < 2) return null;
    let loose = null;
    for (const e of document.querySelectorAll("a,button,summary,[role=button],[role=tab],[role=menuitem],[role=link],input,select,textarea,h1,h2,h3")) {
      if (ours(e)) continue;
      const n = nameOf(e);
      if (n === L) return e;
      if (!loose && n && (n.includes(L) || L.includes(n)) && n.length > 2) loose = e;
    }
    return loose;
  }

  // list: [{ n, selector, label }]; focus: one emphasized marker (Show me).
  function show(list, { focus = false } = {}) {
    clear();
    layer.classList.toggle("focus", focus);
    items = list.map(p => {
      const ring = document.createElement("div");
      ring.className = "mk-ring";
      ring.hidden = true;
      const badge = document.createElement("button");
      badge.className = "mk-badge";
      badge.type = "button";
      badge.hidden = true;
      badge.dataset.n = p.n;
      badge.textContent = p.n;
      badge.title = p.label || "";
      badge.setAttribute("aria-label", `${p.n}: ${p.label || "marked on the page"}. Scroll to it`);
      badge.addEventListener("click", e => { e.stopPropagation(); scrollTo(p.n); });
      layer.append(ring, badge);
      return { ...p, el: find(p.selector, p.label), ring, badge };
    });
    if (items.length && !raf) raf = requestAnimationFrame(loop);
    return items;
  }
  function clear() {
    cancelAnimationFrame(raf);
    raf = 0;
    items = [];
    layer.textContent = "";
  }

  function loop() {
    raf = 0;
    if (!items.length) return;
    const now = performance.now();
    // Menus open, apps re-render: look again for what's missing or gone.
    if (now - lastFind > 300) {
      lastFind = now;
      for (const it of items) if (!visible(it.el)) { const el = find(it.selector, it.label); if (el) it.el = el; }
    }
    const vw = innerWidth, vh = innerHeight, B = 24;
    const barR = bar.hidden ? null : bar.getBoundingClientRect();
    const fits = ([x, y]) => x >= 4 && y >= 4 && x <= vw - B - 4 && y <= vh - B - 4 &&
      !(barR && x + B > barR.left && x < barR.right && y + B > barR.top && y < barR.bottom);
    for (const it of items) {
      if (!visible(it.el)) { it.ring.hidden = it.badge.hidden = true; continue; }
      const r = it.el.getBoundingClientRect();
      const above = r.bottom < 4, below = r.top > vh - 4, off = above || below || r.right < 0 || r.left > vw;
      it.ring.hidden = off;
      if (!off) Object.assign(it.ring.style, { left: r.left - 4 + "px", top: r.top - 4 + "px", width: r.width + 8 + "px", height: r.height + 8 + "px" });
      // The badge sits on a corner: top-left unless that's off screen or
      // under the bar, then the next corner that's free, then inside the top
      // corners (full-width bars). Off screen it waits at the edge, pointing.
      const spots = [[r.left - 11, r.top - 11], [r.right - 13, r.top - 11], [r.left - 11, r.bottom - 13], [r.right - 13, r.bottom - 13],
        [r.right - B - 6, r.top + 6], [r.left + 6, r.top + 6]];
      let [x, y] = spots.find(fits) || spots[0];
      x = Math.max(6, Math.min(vw - 30, x));
      y = above ? 8 : below ? vh - 32 : Math.max(6, Math.min(vh - 30, y));
      it.badge.hidden = false;
      it.badge.dataset.dir = above ? "up" : below ? "down" : "";
      it.badge.style.transform = `translate(${x}px, ${y}px)`;
    }
    raf = requestAnimationFrame(loop);
  }

  function scrollTo(n) {
    const it = items.find(i => String(i.n) === String(n));
    if (!it) return false;
    if (!visible(it.el)) { const el = find(it.selector, it.label); if (el) it.el = el; }
    if (!visible(it.el)) { toast(`${it.label ? `“${it.label}”` : "That"} isn't showing right now. It may be inside a menu that's closed.`); return false; }
    it.el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    it.ring.classList.remove("ping");
    void it.ring.offsetWidth;
    it.ring.classList.add("ping");
    return true;
  }

  return { show, clear, find, scrollTo, visible, get items() { return items; } };
})();
