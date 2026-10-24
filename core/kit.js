// The `morse` helper object that generated mod code runs against. It is
// injected as source text into whichever world executes mods (the page's main
// world over CDP, the USER_SCRIPT world in the extension, or a userscript).
// Every resource a mod creates is tracked so turning the mod off fully undoes it.

function installMorseKit() {
  if (globalThis.morse && globalThis.morse.__kit) return;
  const mods = new Map();
  // On the desktop the kit shares the page's world; Morse's boot captured the
  // built-ins before the page could replace them. Elsewhere use our own.
  const P = globalThis[Symbol.for("morse.pristine")] || {};
  const MO = P.MutationObserver || MutationObserver;
  const raf = P.requestAnimationFrame || (fn => requestAnimationFrame(fn));
  const setT = P.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = P.clearTimeout || (id => clearTimeout(id));
  const setI = P.setInterval || ((fn, ms) => setInterval(fn, ms));
  const clearI = P.clearInterval || (id => clearInterval(id));
  const now = () => performance.now();

  function ctxFor(id) {
    if (mods.has(id)) return mods.get(id);
    const c = { id, cleanups: [], errors: [], observers: [], watches: [] };
    mods.set(id, c);
    return c;
  }

  // ---- morse.watch: one MutationObserver for every watch of every mod.
  // Mutations are batched per animation frame and each watch only checks the
  // subtrees that were added. Matches that appear without an insertion
  // (attribute changes, :has(), sibling selectors) are caught by a full rescan
  // at most once a second, and only while the page keeps changing: an idle
  // page costs nothing. Morse's own nodes (overlay, mod elements, mod styles)
  // never trigger anything.
  const watches = new Set();
  const MAX_ROOTS = 64, FULL_EVERY = 1000;
  let observer = null, queued = false, roots = [], needFull = false, lastFull = 0, fullTimer = 0;
  const OURS = "[data-morse],[data-morse-ui],[data-morse-css]";
  const ours = n => !!(n && n.nodeType === 1 && n.closest(OURS));

  function scanAll(w) {
    let list;
    try { list = document.querySelectorAll(w.selector); } catch (e) { w.c.errors.push(String(e)); watches.delete(w); return; }
    let now = 0;
    for (const el of list) if (w.hit(el)) now++;
    w.st.now = now;
  }
  function scanIn(w, root) {
    try {
      if (root.matches(w.selector)) w.hit(root);
      if (root.firstElementChild) for (const el of root.querySelectorAll(w.selector)) w.hit(el);
    } catch (e) { w.c.errors.push(String(e)); watches.delete(w); }
  }
  function flush() {
    queued = false;
    const full = needFull, list = roots;
    needFull = false; roots = [];
    if (full) lastFull = now();
    for (const w of watches) {
      if (w.c.dead) { watches.delete(w); continue; }
      if (full) scanAll(w);
      else for (const r of list) if (r.isConnected) scanIn(w, r);
    }
    if (!watches.size) stopWatching();
  }
  const schedule = () => { if (!queued) { queued = true; raf(flush); } };
  function onMutations(recs) {
    let changed = false;
    for (const r of recs) {
      if (ours(r.target)) continue;
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || ours(n)) continue;
        changed = true;
        if (needFull) continue;
        // Many separate insertions in one frame: one full scan is cheaper.
        if (roots.length < MAX_ROOTS) roots.push(n); else { needFull = true; roots = []; }
      }
      if (!changed) for (const n of r.removedNodes) if (n.nodeType === 1 && !(n.hasAttribute("data-morse") || n.hasAttribute("data-morse-ui") || n.hasAttribute("data-morse-css"))) { changed = true; break; }
    }
    if (!changed) return;
    if (roots.length || needFull) schedule();
    if (!fullTimer) fullTimer = setT(() => { fullTimer = 0; needFull = true; roots = []; schedule(); }, Math.max(0, lastFull + FULL_EVERY - now()));
  }
  function startWatching() {
    if (observer) return;
    observer = new MO(onMutations);
    // `document`, not <html>: watches survive document.open() and <html> swaps.
    observer.observe(document, { childList: true, subtree: true });
  }
  function stopWatching() {
    if (observer) observer.disconnect();
    observer = null;
    if (fullTimer) clearT(fullTimer);
    fullTimer = 0; roots = []; needFull = false;
  }

  function guard(c, fn) {
    return function (...args) {
      if (c.dead) return; // the mod was turned off; a queued callback must not run
      try { return fn.apply(this, args); }
      catch (e) { c.errors.push(String(e && e.stack || e)); console.warn("[morse]", c.id, e); }
    };
  }

  function api(c) {
    const tag = el => { if (el && el.setAttribute) el.setAttribute("data-morse", c.id); return el; };
    const m = {
      watch(selector, fn) {
        const seen = new WeakSet();
        const run = guard(c, fn);
        // Match counts for __stats: a watch that never matches means the page
        // changed under the mod (the panel offers to fix it). `now` is exact
        // after each full scan and counts new matches in between.
        const st = { selector: String(selector), now: 0, total: 0 };
        c.watches.push(st);
        const w = {
          selector, c, st,
          // Never match Morse's own elements: a mod that inserts a button next to
          // "header button" must not then match the button it inserted.
          hit(el) {
            if (el.closest("[data-morse-ui],[data-morse]")) return false;
            if (!seen.has(el)) { seen.add(el); st.total++; st.now++; run(el); }
            return true;
          },
        };
        watches.add(w);
        scanAll(w);
        if (watches.has(w)) startWatching();
      },
      el(tagName, props, ...kids) {
        const el = tag(document.createElement(tagName));
        for (const [k, v] of Object.entries(props || {})) {
          if (v == null) continue;
          if (k === "text") el.textContent = v;
          else if (k === "html") el.innerHTML = v;
          else if (k === "class" || k === "className") el.className = v;
          else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
          else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, guard(c, fn));
          else el.setAttribute(k, v);
        }
        for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : String(kid));
        c.cleanups.push(() => el.remove());
        return el;
      },
      css(text) {
        const s = tag(document.createElement("style"));
        s.textContent = text;
        document.head.append(s);
        c.cleanups.push(() => s.remove());
        return s;
      },
      on(target, event, fn, opts) {
        const h = guard(c, fn);
        target.addEventListener(event, h, opts);
        c.cleanups.push(() => target.removeEventListener(event, h, opts));
      },
      every(ms, fn) {
        const t = setI(guard(c, fn), ms);
        c.cleanups.push(() => clearI(t));
        return t;
      },
      after(ms, fn) {
        const t = setT(guard(c, fn), ms);
        c.cleanups.push(() => clearT(t));
        return t;
      },
      byText(selector, text) {
        const needle = String(text).toLowerCase();
        return [...document.querySelectorAll(selector)].find(e => (e.textContent || "").toLowerCase().includes(needle)) || null;
      },
      store: {
        get(k, d = null) { try { const v = localStorage.getItem(`morse:${c.id}:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
        set(k, v) { try { localStorage.setItem(`morse:${c.id}:${k}`, JSON.stringify(v)); } catch {} },
      },
      toast(message) {
        const t = document.createElement("div");
        t.setAttribute("data-morse-ui", "");
        t.textContent = message;
        Object.assign(t.style, {
          position: "fixed", left: "50%", bottom: "96px", transform: "translateX(-50%)", zIndex: 2147483646,
          background: "#0d1117", color: "#e6edf3", font: "500 13px/1.4 ui-sans-serif, system-ui, sans-serif",
          padding: "8px 14px", borderRadius: "10px", border: "1px solid #30363d", boxShadow: "0 8px 30px rgba(0,0,0,.35)",
        });
        document.body.append(t);
        setT(() => t.remove(), 2600);
      },
      get id() { return c.id; },
    };
    return m;
  }

  globalThis.morse = {
    __kit: 1,
    // Runs mod code; returns { ok, error } synchronously.
    __run(id, fn) {
      this.__off(id);
      const c = ctxFor(id);
      try {
        const cleanup = fn(api(c));
        if (typeof cleanup === "function") c.cleanups.push(cleanup);
        return { ok: true };
      } catch (e) {
        this.__off(id);
        return { ok: false, error: String(e && e.message || e) };
      }
    },
    __off(id) {
      const c = mods.get(id);
      if (c) {
        c.dead = true;
        c.observers.forEach(o => o.disconnect());
        for (const w of watches) if (w.c === c) watches.delete(w);
        if (!watches.size) stopWatching();
        c.cleanups.reverse().forEach(f => { try { f(); } catch {} });
        mods.delete(id);
      }
      // Always sweep: elements can outlive their context (e.g. a late callback).
      document.querySelectorAll(`[data-morse="${CSS.escape(id)}"]`).forEach(e => e.remove());
      return true;
    },
    __errors(id) { return (mods.get(id)?.errors || []).slice(0, 3); },
    // How a running mod is doing: each watch's selector with the elements it
    // matches now and has ever matched, plus errors so far. null if not running.
    __stats(id) {
      const c = mods.get(id);
      if (!c) return null;
      // Exact counts on demand, rather than a rescan on every removal.
      for (const w of watches) if (w.c === c) {
        try { w.st.now = [...document.querySelectorAll(w.selector)].filter(el => !el.closest("[data-morse-ui],[data-morse]")).length; } catch {}
      }
      return { watches: c.watches.map(w => ({ ...w })), errors: c.errors.length, error: c.errors[0] ? String(c.errors[0]).split("\n")[0] : null };
    },
  };
}

export const KIT_SOURCE = `(${installMorseKit.toString()})();`;

// Wraps mod code so it can run without eval (page CSP friendly).
export function wrapModCode(id, js) {
  return `${KIT_SOURCE}\nmorse.__run(${JSON.stringify(id)}, function (morse) {\n${js}\n});`;
}
