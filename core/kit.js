// The `morse` helper object that generated mod code runs against. It is
// injected as source text into whichever world executes mods (the page's main
// world over CDP, the USER_SCRIPT world in the extension, or a userscript).
// Every resource a mod creates is tracked so turning the mod off fully undoes it.
//
// Guards: a mod can't freeze, slow down or break the page it runs in. Every
// callback a mod hands the kit (watch, on, every, after, el's `on`, and the
// setTimeout / setInterval / requestAnimationFrame / MutationObserver it uses
// directly, which wrapModCode shadows for it) is timed with performance.now.
// A mod is paused, says why in __stats, and the page hears "morse:paused"
// (runtime/src/64-guard.js turns it off and tells the person) when it:
//   - keeps the page busy: callbacks over BUSY_MS of a second for BUSY_SECS
//     seconds in a row, or over STALL_MS in any one second
//   - keeps reacting to the page: over FLOOD new watch matches a second for
//     FLOOD_SECS seconds, or one observer called over MO_FLOOD times a second
//   - adds too much: over MANY_NOW elements in one second, or over MANY a
//     second for MANY_SECS seconds (morse.el, and what its callbacks insert
//     while the kit watches the page for any morse.watch)
// Changes a mod makes inside its callbacks never trigger a watch or any mod's
// observer, so it can't feed back into itself: they are the mod's new state.
//
// Re-renders: when the page wipes what a watch callback did to an element
// (the elements it added, the classes, inline styles, attributes or text it
// set), the watch puts it back or runs the callback again. { live: true } also
// runs it again whenever the element or its content changes (rows a
// virtualized list reuses). "host >>> inside" selectors reach into open shadow
// roots and same-origin frames (watch, $, $$, byText, css(text, where)). every() and setInterval run at
// most every MIN_EVERY ms. Only the first LOG errors of a mod reach the console.
// A loop that never returns can't be stopped from inside the page: the desktop
// host stops it over CDP (daemon/guard.js) and asks __hung() whose it was.

function installMorseKit() {
  if (globalThis.morse && globalThis.morse.__kit) return;
  const mods = new Map();
  // On the desktop the kit shares the page's world; Morse's boot captured the
  // built-ins before the page could replace them. Elsewhere use our own.
  const P = globalThis[Symbol.for("morse.pristine")] || {};
  const MO = P.MutationObserver || MutationObserver;
  const raf = P.requestAnimationFrame || (fn => requestAnimationFrame(fn));
  const caf = P.cancelAnimationFrame || (id => cancelAnimationFrame(id));
  const setT = P.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = P.clearTimeout || (id => clearTimeout(id));
  const setI = P.setInterval || ((fn, ms) => setInterval(fn, ms));
  const clearI = P.clearInterval || (id => clearInterval(id));
  const now = P.now || (() => performance.now());

  // ---- guard budgets (see the top of this file); tests may lower them
  const L = { BUSY_MS: 200, BUSY_SECS: 3, STALL_MS: 1000, FLOOD: 1000, FLOOD_SECS: 3, MO_FLOOD: 250,
    MANY: 2000, MANY_SECS: 5, MANY_NOW: 20000, MIN_EVERY: 100, LOG: 3, KEEP_ERRORS: 20 };
  const paused = new Map(); // mod id -> why it was paused, until it runs again
  const own = new Set();    // every mod's own MutationObservers
  let cur = null;           // the mod whose code is running (for __hung)
  let depth = 0;            // > 0 while any mod's code is running

  // speed: a mod's late errors come from its callbacks. Watch and observer
  // callbacks for new matches run a frame after a change, so a short wait
  // covers them; timers need until they first fire; listeners for events that
  // can happen on their own (timeupdate, scroll, resize…) keep the full window.
  // Input a person has to make (a click, a key) can't happen during the wait.
  const SETTLE_MS = 150, SETTLE_MAX = 600;
  const BY_PERSON = /^(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|keydown|keyup|keypress|input|change|submit|reset|focus|blur|focusin|focusout|copy|cut|paste|dragstart|drop)$/;
  const settleFor = (c, ms) => { c.settle = Math.min(SETTLE_MAX, Math.max(c.settle, ms)); };
  const settleOn = (c, event) => { if (!BY_PERSON.test(String(event))) settleFor(c, SETTLE_MAX); };

  function ctxFor(id) {
    if (mods.has(id)) return mods.get(id);
    const c = { id, cleanups: [], errors: [], nerr: 0, observers: new Set(), watches: [], timers: new Set(), frames: new Set(),
      els: [], elsMax: 256, ms: 0, hits: 0, in: 0, t1: 0, k: 0, g: { w: now(), t: 0, n: 0, h: 0, hot: 0, bulk: 0, flood: 0 },
      settle: SETTLE_MS }; // speed: how long a host waits before reading its errors (see __run)
    mods.set(id, c);
    return c;
  }

  function fail(c, e, log = true) {
    c.nerr++;
    if (c.errors.length < L.KEEP_ERRORS) c.errors.push(String(e && e.stack || e));
    // A callback that fails on every change would fill the console.
    if (!log) return;
    if (c.nerr <= L.LOG) console.warn("[morse]", c.id, e);
    else if (c.nerr === L.LOG + 1) console.warn("[morse]", c.id, "keeps failing; later errors are counted in morse.__stats, not logged");
  }

  // ---- "host >>> inside": into an open shadow root or a same-origin frame.
  function inner(el) {
    if (!el) return null;
    if (el.shadowRoot && !el.hasAttribute("data-morse-ui")) return el.shadowRoot;
    if (el.localName === "iframe" || el.localName === "frame") {
      try { const d = el.contentDocument; return d && d.documentElement ? d : null; } catch { return null; }
    }
    return null;
  }
  // Every match of a selector that may contain ">>>"; onRoot(root, host) hears
  // about each shadow root or frame document crossed.
  function query(selector, onRoot) {
    const parts = String(selector).split(/\s*>>>\s*/);
    let scopes = [document];
    for (let i = 0; i < parts.length; i++) {
      const found = [];
      for (const sc of scopes) found.push(...sc.querySelectorAll(parts[i]));
      if (i === parts.length - 1) return found;
      scopes = [];
      for (const el of found) { const r = inner(el); if (r) { scopes.push(r); if (onRoot) onRoot(r, el); } }
    }
    return [];
  }
  // Elements watch callbacks ran on: element -> Set of watches. Changes inside
  // them mark them dirty, and the next frame checks what a re-render wiped.
  const tracked = new WeakMap(), madeBy = new WeakMap();
  let trackedAny = false;

  // ---- morse.watch: one MutationObserver for every watch of every mod.
  // Mutations are batched per animation frame and each watch only checks the
  // subtrees that were added. Matches that appear without an insertion
  // (attribute changes, :has(), sibling selectors) are caught by a full rescan
  // at most once a second, and only while the page keeps changing: an idle
  // page costs nothing. Morse's own nodes (overlay, mod elements, mod styles)
  // never trigger anything, and neither does anything a mod's code changes.
  const watches = new Set();
  const MAX_ROOTS = 64, FULL_EVERY = 1000;
  let observer = null, queued = false, roots = [], needFull = false, lastFull = 0, fullTimer = 0;
  const OURS = "[data-morse],[data-morse-ui],[data-morse-css]";
  const ours = n => !!(n && n.nodeType === 1 && n.closest(OURS));

  function scanAll(w) {
    let list;
    try { list = w.deep ? query(w.selector, observeRoot) : document.querySelectorAll(w.selector); } catch (e) { fail(w.c, e, false); watches.delete(w); return; }
    let now = 0;
    for (const el of list) if (w.hit(el)) now++;
    w.st.now = now;
  }
  function scanIn(w, root) {
    if (w.deep) return scanAll(w); // through shadow roots and frames: look again everywhere
    try {
      if (root.matches(w.selector)) w.hit(root);
      if (root.firstElementChild) for (const el of root.querySelectorAll(w.selector)) w.hit(el);
    } catch (e) { fail(w.c, e, false); watches.delete(w); }
  }
  function flush() {
    queued = false;
    const full = needFull, list = roots;
    needFull = false; roots = [];
    if (full) lastFull = now();
    for (const w of watches) {
      const c = w.c;
      if (c.dead) { watches.delete(w); continue; }
      // guard: what its callbacks do is the mod's, timed from the first one
      // (a frame where nothing new matched costs no clock reads)
      const h0 = c.hits, prev = cur;
      cur = c; depth++; c.in++; c.t1 = 0;
      if (full) scanAll(w);
      else if (w.deep && (list.length || w.dirty.size)) scanAll(w);
      else for (const r of list) if (r.isConnected) scanIn(w, r);
      // What a re-render wiped (or, live, what changed) on elements it handled.
      if (w.dirty.size) { const d = [...w.dirty]; w.dirty.clear(); for (const el of d) if (el.isConnected) w.recheck(el); }
      c.in--; depth--; cur = prev;
      if (c.hits !== h0) { const t = now(); tally(c, c.t1 ? t - c.t1 : 0, dropOwn(), c.hits - h0, t); }
      else dropOwn();
      c.t1 = 0;
    }
    if (!watches.size) stopWatching();
  }
  const schedule = () => { if (!queued) { queued = true; raf(flush); } };
  function onMutations(recs) {
    let changed = false, dirty = false;
    for (const r of recs) {
      const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (t && ours(t)) continue;
      // A change in or on an element a watch handled: check it next frame.
      if (trackedAny) for (let x = r.target; x; x = r.type === "attributes" ? null : x.parentNode || x.host) {
        const ws = tracked.get(x);
        if (ws) for (const w of ws) { w.dirty.add(x); dirty = true; }
      }
      if (r.type !== "childList") continue;
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || ours(n)) continue;
        changed = true;
        if (needFull) continue;
        // Many separate insertions in one frame: one full scan is cheaper.
        if (roots.length < MAX_ROOTS) roots.push(n); else { needFull = true; roots = []; }
      }
      if (!changed) for (const n of r.removedNodes) if (n.nodeType === 1 && !(n.hasAttribute("data-morse") || n.hasAttribute("data-morse-ui") || n.hasAttribute("data-morse-css"))) { changed = true; break; }
    }
    if (dirty) schedule();
    if (!changed) return;
    if (roots.length || needFull) schedule();
    if (!fullTimer) fullTimer = setT(() => { fullTimer = 0; needFull = true; roots = []; schedule(); }, Math.max(0, lastFull + FULL_EVERY - now()));
  }
  // Classes, inline styles and text too: that's how re-renders undo a mod.
  const OBSERVE = { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"], characterData: true };
  let observedRoots = new WeakSet();
  function startWatching() {
    if (observer) return;
    observer = new MO(onMutations);
    // `document`, not <html>: watches survive document.open() and <html> swaps.
    observer.observe(document, OBSERVE);
  }
  // A shadow root or frame document a watch looks into is watched too; a
  // frame that loads another page is looked at again.
  function observeRoot(root, host) {
    if (!root || observedRoots.has(root)) return;
    startWatching();
    observedRoots.add(root);
    observer.observe(root, OBSERVE);
    if (root.nodeType === 9 && host && !observedRoots.has(host)) {
      observedRoots.add(host);
      host.addEventListener("load", () => { needFull = true; schedule(); });
    }
  }
  function stopWatching() {
    if (observer) observer.disconnect();
    observer = null; observedRoots = new WeakSet();
    if (fullTimer) clearT(fullTimer);
    fullTimer = 0; roots = []; needFull = false;
  }

  // The mod changed an element a watch handled, or removed something a
  // callback made: that is what it wants now, not something to put back.
  function accept(r) {
    if (r.type === "childList") {
      for (const n of r.removedNodes) { const rec = madeBy.get(n); if (rec) rec.created = rec.created.filter(k => k !== n); }
      return;
    }
    const ws = r.type === "attributes" && tracked.get(r.target);
    if (ws) for (const w of ws) w.accept(r.target, r.attributeName);
  }

  // ---- guards: time, size and loops, per mod
  // Before a mod's callback: changes still pending are the page's, so they
  // are handled as usual (a mod's own observers get theirs first).
  function takePage() {
    if (observer) { const r = observer.takeRecords(); if (r.length) onMutations(r); }
    for (const o of own) { const r = o.takeRecords(); if (r.length) o.deliver(r); }
  }
  // After it: what changed meanwhile is the mod's own doing. No watch and no
  // observer sees it; inserted elements count toward its size budget.
  function dropOwn() {
    let made = 0;
    if (observer) for (const r of observer.takeRecords()) {
      if (trackedAny) accept(r);
      for (const n of r.addedNodes) if (n.nodeType === 1 && !n.hasAttribute("data-morse")) made += 1 + n.getElementsByTagName("*").length;
    }
    for (const o of own) o.takeRecords();
    return made;
  }
  function enter(c) {
    const prev = cur;
    if (!depth) takePage();
    cur = c; depth++;
    if (!c.in++) c.t1 = 0;
    return prev;
  }
  function leave(c, prev, t0) {
    const t = now();
    if (!--c.in) c.t1 = 0;
    depth--; cur = prev;
    tally(c, t - t0, depth ? 0 : dropOwn(), 0, t);
  }
  // Adds to a mod's per-second budget and pauses it when it goes over.
  function tally(c, dt, made, hits, t = now()) {
    const g = c.g;
    if (t - g.w >= 1000) {
      const next = t - g.w < 2000; // the second right after, not after a quiet gap
      g.hot = next && g.t > L.BUSY_MS ? g.hot + 1 : 0;
      g.bulk = next && g.n > L.MANY ? g.bulk + 1 : 0;
      g.flood = next && g.h > L.FLOOD ? g.flood + 1 : 0;
      g.w = t; g.t = 0; g.n = 0; g.h = 0;
    }
    c.ms += dt; g.t += dt; g.n += made; g.h += hits;
    if (c.dead) return;
    const ms = Math.round(g.t);
    if (g.t > L.STALL_MS) pause(c, "slow", `one burst of its code kept the page busy for ${ms} ms. Do far less work per call.`);
    else if (g.t > L.BUSY_MS && g.hot >= L.BUSY_SECS - 1) pause(c, "slow", `its callbacks kept the page busy over ${L.BUSY_MS} ms of every second for ${L.BUSY_SECS} seconds (${ms} ms in the last one). Do far less work per change: no loops over the whole page inside morse.watch callbacks, nothing heavy in morse.every.`);
    else if (g.n > L.MANY_NOW || (g.n > L.MANY && g.bulk >= L.MANY_SECS - 1)) pause(c, "big", `it added ${g.n} elements to the page in one second. Add far fewer elements.`);
    else if (g.h > L.FLOOD && g.flood >= L.FLOOD_SECS - 1) pause(c, "loop", `its morse.watch callbacks ran on over ${L.FLOOD} new elements a second for ${L.FLOOD_SECS} seconds: the page keeps rebuilding what the code changes, which runs the code again. Change those elements with CSS, or change something the page doesn't rebuild.`);
  }
  function pause(c, why, detail) {
    if (c.dead) return;
    paused.set(c.id, { why, error: `Morse paused it because ${detail}`, ms: Math.round(c.ms), at: Date.now() });
    stop(c);
    try { document.dispatchEvent(new CustomEvent("morse:paused", { detail: JSON.stringify({ id: c.id, why }) })); } catch {}
  }
  function stop(c) {
    c.dead = true;
    c.observers.forEach(o => { own.delete(o); o.disconnect(); });
    for (const w of watches) if (w.c === c) watches.delete(w);
    if (!watches.size) stopWatching();
    c.timers.forEach(id => { clearT(id); clearI(id); });
    c.frames.forEach(id => caf(id));
    c.cleanups.reverse().forEach(f => { try { f(); } catch {} });
    for (const r of c.els) r.deref()?.remove();
    mods.delete(c.id);
    // Always sweep: elements can outlive their context (e.g. a late callback).
    document.querySelectorAll(`[data-morse="${CSS.escape(c.id)}"]`).forEach(e => e.remove());
  }

  // Runs a mod's callback: never after the mod is off, errors kept for the
  // repair loop, time and changes counted against the mod.
  function guard(c, fn) {
    return function (...args) {
      if (c.dead) return; // the mod was turned off; a queued callback must not run
      const prev = enter(c), t0 = now();
      try {
        const r = fn.apply(this, args);
        if (r && typeof r.then === "function") r.then(null, e => fail(c, e)); // async handlers (show-once hook)
        return r;
      } catch (e) { fail(c, e); }
      finally { leave(c, prev, t0); }
    };
  }

  // What mod code sees as setTimeout, setInterval, requestAnimationFrame,
  // MutationObserver (and their clear/cancel): the page's own, guarded and
  // tracked so turning the mod off stops them. Order matches SCOPE below.
  function scope(c) {
    const later = (set, clear, min) => function (fn, ms, ...args) {
      if (typeof fn !== "function") return set(fn, ms);
      settleFor(c, (min ? Math.max(min, +ms || 0) : +ms || 0) + 60);
      const id = set(guard(c, function () { if (!min) c.timers.delete(id); fn.apply(this, args); }), min ? Math.max(min, +ms || 0) : ms);
      c.timers.add(id);
      return id;
    };
    const cancel = (clear, set) => id => { set.delete(id); clear(id); };
    class Observer extends MO {
      constructor(fn) {
        let win = 0, n = 0;
        const run = guard(c, fn);
        super(function (recs, obs) {
          const t = now();
          if (t - win >= 1000) { win = t; n = 0; }
          // Called back again and again within a second: a feedback loop.
          if (++n > L.MO_FLOOD) return pause(c, "loop", `its MutationObserver was called ${n} times within a second: the code changes what it observes, so it runs again and again. Observe only what the page changes, or use morse.watch.`);
          return run.call(this, recs, obs);
        });
        this.deliver = recs => run.call(this, recs, this);
        c.observers.add(this);
      }
      observe(...a) { if (c.dead) return; own.add(this); return super.observe(...a); }
      disconnect() { own.delete(this); return super.disconnect(); }
    }
    return [
      later(setT, clearT, 0),
      later(setI, clearI, L.MIN_EVERY),
      cancel(clearT, c.timers),
      cancel(clearI, c.timers),
      fn => { const id = raf(guard(c, t => { c.frames.delete(id); fn(t); })); c.frames.add(id); return id; },
      cancel(caf, c.frames),
      Observer,
    ];
  }

  // Elements a mod makes count toward its size budget; past it the mod is
  // paused and making more throws, which ends a runaway loop.
  function made(c) {
    if (c.dead) throw new Error("Morse paused this mod");
    c.g.n++;
    if (c.g.n > L.MANY_NOW) { tally(c, 0, 0, 0); throw new Error("Morse paused this mod: it added too many elements"); }
  }

  function api(c) {
    const tag = el => { if (el && el.setAttribute) el.setAttribute("data-morse", c.id); return el; };
    const m = {
      watch(selector, fn, opts) {
        const live = !!(opts && opts.live);
        const seen = new WeakMap(); // element -> what fn did to it
        const run = el => {
          if (c.dead) return;
          if (!c.t1) c.t1 = now();
          try { fn(el); } catch (e) { fail(c, e); }
          // Many matches at once with a slow callback: stop now, not after all of them.
          if (!(++c.k & 15) && now() - c.t1 > L.STALL_MS) pause(c, "slow", `one run of its morse.watch callback over the elements it found kept the page busy for over ${L.STALL_MS} ms. Do far less work per element.`);
        };
        const styles = el => { const o = {}; for (let i = 0; i < el.style.length; i++) { const p = el.style[i]; o[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]; } return o; };
        const attrs = el => { const o = {}; for (const a of el.attributes) if (a.name !== "class" && a.name !== "style") o[a.name] = a.value; return o; };
        // Runs fn on el and remembers what it did: the elements it made or put
        // in or next to el, and the classes, inline styles, attributes and text it set.
        const apply = (el, prev) => {
          const cl0 = new Set(el.classList), st0 = styles(el), at0 = attrs(el), tx0 = el.textContent;
          const kids0 = new Set(el.childNodes), sibs0 = el.parentNode ? new Set(el.parentNode.childNodes) : null;
          // A burst of re-runs means fn and the page are fighting over el: then leave it alone.
          const t = now(), burst = prev && t - prev.at < 100 ? prev.burst + 1 : 0;
          const r = { created: [], at: t, burst, root: inner(el) };
          const outer = c.current;
          c.current = r;
          try { run(el); } finally { c.current = outer; }
          for (const k of el.childNodes) if (!kids0.has(k) && k.nodeType === 1) r.created.push(k);
          if (sibs0 && el.parentNode) for (const k of el.parentNode.childNodes) if (!sibs0.has(k) && k.nodeType === 1) r.created.push(k);
          r.created = [...new Set(r.created)].filter(n => n.isConnected && n.parentNode !== n.ownerDocument.head);
          for (const n of r.created) madeBy.set(n, r);
          const cl1 = new Set(el.classList), st1 = styles(el), at1 = attrs(el);
          r.addCls = [...cl1].filter(x => !cl0.has(x));
          r.rmCls = [...cl0].filter(x => !cl1.has(x));
          r.style = {}; r.styleWas = {};
          for (const p in st1) if (!st0[p] || st0[p][0] !== st1[p][0] || st0[p][1] !== st1[p][1]) { r.style[p] = st1[p]; r.styleWas[p] = st0[p] || null; }
          r.attrs = {};
          for (const k of new Set([...Object.keys(at0), ...Object.keys(at1)])) if (at0[k] !== at1[k]) r.attrs[k] = [at0[k] ?? null, at1[k] ?? null];
          r.text = !r.created.some(n => el.contains(n)) && el.textContent !== tx0 ? el.textContent : null;
          seen.set(el, r);
        };
        // Puts back what the page undid: the classes, inline styles and attributes fn set.
        const reassert = (el, r) => {
          for (const x of r.addCls) if (!el.classList.contains(x)) el.classList.add(x);
          for (const x of r.rmCls) if (el.classList.contains(x)) el.classList.remove(x);
          for (const p in r.style) { const [v, pr] = r.style[p]; if (el.style.getPropertyValue(p) !== v || el.style.getPropertyPriority(p) !== pr) el.style.setProperty(p, v, pr); }
          for (const k in r.attrs) { const v = r.attrs[k][1]; if (el.getAttribute(k) !== v) v == null ? el.removeAttribute(k) : el.setAttribute(k, v); }
        };
        // Undoes what fn did, before running it again.
        const undo = (el, r) => {
          for (const n of r.created) n.remove();
          for (const x of r.addCls) el.classList.remove(x);
          for (const x of r.rmCls) el.classList.add(x);
          for (const p in r.style) { if (el.style.getPropertyValue(p) !== r.style[p][0]) continue; const o = r.styleWas[p]; o ? el.style.setProperty(p, o[0], o[1]) : el.style.removeProperty(p); }
          for (const k in r.attrs) { if (el.getAttribute(k) !== r.attrs[k][1]) continue; const o = r.attrs[k][0]; o == null ? el.removeAttribute(k) : el.setAttribute(k, o); }
        };
        // Match counts for __stats: a watch that never matches means the page
        // changed under the mod (the panel offers to fix it). `now` is exact
        // after each full scan and counts new matches in between.
        const st = { selector: String(selector), now: 0, total: 0 };
        c.watches.push(st);
        const w = {
          selector, c, st, deep: String(selector).includes(">>>"), dirty: new Set(),
          // Never match Morse's own elements: a mod that inserts a button next to
          // "header button" must not then match the button it inserted.
          hit(el) {
            if (el.closest("[data-morse-ui],[data-morse]")) return false;
            observeRoot(inner(el), el); // what renders inside a matched component or frame
            if (!seen.has(el)) {
              st.total++; st.now++; c.hits++;
              apply(el, null);
              let ws = tracked.get(el);
              if (!ws) tracked.set(el, ws = new Set());
              ws.add(w); trackedAny = true;
            }
            return true;
          },
          // After a change in or on el: put back what was wiped, or (live) run fn again.
          recheck(el) {
            const r = seen.get(el);
            if (!r || r.burst > 20 || c.dead) return;
            const wiped = r.created.some(n => !n.isConnected) || r.root !== inner(el) || (r.text != null && el.textContent !== r.text);
            if (wiped || live) {
              const ok = (() => { try { return el.matches(String(selector).split(/\s*>>>\s*/).pop()); } catch { return true; } })();
              undo(el, r);
              if (ok) apply(el, r); else seen.delete(el);
            } else reassert(el, r);
          },
          // The mod's own code changed el: its new state.
          accept(el, name) {
            const r = seen.get(el);
            if (!r) return;
            if (name === "class") { r.addCls = r.addCls.filter(x => el.classList.contains(x)); r.rmCls = r.rmCls.filter(x => !el.classList.contains(x)); }
            else if (name === "style") { const cur = styles(el); for (const p in r.style) cur[p] ? r.style[p] = cur[p] : delete r.style[p]; }
            else if (r.attrs[name]) r.attrs[name][1] = el.getAttribute(name);
          },
        };
        watches.add(w);
        scanAll(w);
        if (watches.has(w)) startWatching();
      },
      // Elements matching a selector right now (">>>" crosses into shadow roots and frames).
      $$(selector) { return query(selector).filter(e => !e.closest("[data-morse-ui]")); },
      $(selector) { return m.$$(selector)[0] || null; },
      el(tagName, props, ...kids) {
        made(c);
        const el = tag(document.createElement(tagName));
        if (c.current) c.current.created.push(el);
        for (const [k, v] of Object.entries(props || {})) {
          if (v == null) continue;
          if (k === "text") el.textContent = v;
          else if (k === "html") el.innerHTML = v;
          else if (k === "class" || k === "className") el.className = v;
          else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
          else if (k === "on") for (const [ev, fn] of Object.entries(v)) { settleOn(c, ev); el.addEventListener(ev, guard(c, fn)); }
          else el.setAttribute(k, v);
        }
        for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : String(kid));
        // Weakly held, so elements the page threw away can be freed: __off
        // removes the rest (and sweeps [data-morse] in the document).
        c.els.push(new WeakRef(el));
        if (c.els.length > c.elsMax) { c.els = c.els.filter(r => r.deref()); c.elsMax = Math.max(256, c.els.length * 2); }
        return el;
      },
      // css(text, where): with `where` (a selector of components or frames,
      // ">>>" allowed), the CSS goes inside each one's shadow root or frame
      // page, now and for every one that appears later. Rules written
      // "host >>> inside { … }" go inside their hosts the same way.
      css(text, where) {
        if (!where && String(text).includes(">>>")) {
          const byHost = new Map();
          const plain = String(text).replace(/([^{}]*>>>[^{}]*)\{([^{}]*)\}/g, (all, sels, body) => {
            for (const sel of sels.split(",")) {
              const at = sel.lastIndexOf(">>>");
              if (at < 0) continue;
              const host = sel.slice(0, at).trim(), inside = sel.slice(at + 3).trim();
              byHost.set(host, (byHost.get(host) || "") + `${inside} {${body}}\n`);
            }
            return "";
          });
          for (const [host, rules] of byHost) m.css(rules, host);
          return plain.trim() ? m.css(plain) : null;
        }
        if (where) {
          const styled = new WeakMap();
          m.watch(where, host => {
            const root = inner(host);
            const at = root || host.getRootNode(); // not a component or frame: plain CSS where it is
            if (!root && styled.get(at)?.isConnected) return;
            const doc = at.nodeType === 9 ? at : host.ownerDocument;
            const s = tag(doc.createElement("style"));
            s.textContent = text;
            (at.nodeType === 9 ? at.head || at.documentElement : at).append(s);
            styled.set(at, s);
            if (root && c.current) c.current.created.push(s);
            c.cleanups.push(() => s.remove());
          });
          return null;
        }
        const s = tag(document.createElement("style"));
        s.textContent = text;
        document.head.append(s);
        c.cleanups.push(() => s.remove());
        return s;
      },
      on(target, event, fn, opts) {
        const h = guard(c, fn);
        settleOn(c, event);
        // app profiles: an app's own event emitter (app.vault.on("modify", …),
        // an EventEmitter) is listened to the same way, and let go when the
        // mod is turned off: dispose(), offref(), off() or removeListener().
        if (typeof target?.addEventListener !== "function" && typeof target?.on === "function") {
          const ref = target.on(event, h);
          c.cleanups.push(() => {
            if (ref && typeof ref.dispose === "function") ref.dispose();
            else if (typeof target.offref === "function" && ref) target.offref(ref);
            else if (typeof target.off === "function") target.off(event, h);
            else if (typeof target.removeListener === "function") target.removeListener(event, h);
          });
          return ref;
        }
        target.addEventListener(event, h, opts);
        c.cleanups.push(() => target.removeEventListener(event, h, opts));
      },
      // app profiles (daemon/profile.js): the app's own commands, through the
      // runner Morse found in this app (a frozen handle on the page's window).
      // command() resolves to what the app's command returns; a failure is
      // the mod's error (the repair round sees it) and rejects.
      app: {
        get ready() { return !!globalThis[Symbol.for("morse.app")]; },
        command(id, ...args) {
          const h = globalThis[Symbol.for("morse.app")];
          if (!h) { const e = new Error("morse.app.command: Morse found no way to run this app's commands here. Use the app's own objects or its buttons instead."); fail(c, e); return Promise.reject(e); }
          return (async () => {
            const r = await h.run(String(id), ...args);
            // Some apps answer false for a command they don't have or can't run now (Obsidian).
            if (r === false) fail(c, new Error(`morse.app.command("${id}"): the app didn't run it (no such command, or it can't run right now)`));
            return r;
          })().catch(e => { fail(c, e); throw e; });
        },
        commands() { const h = globalThis[Symbol.for("morse.app")]; try { return h && h.list ? h.list() : []; } catch { return []; } },
      },
      every(ms, fn) {
        settleFor(c, Math.max(L.MIN_EVERY, +ms || 0) + 60);
        const t = setI(guard(c, fn), Math.max(L.MIN_EVERY, +ms || 0)); // guard: a minimum interval
        c.timers.add(t);
        return t;
      },
      after(ms, fn) {
        settleFor(c, (+ms || 0) + 60);
        const t = setT(guard(c, () => { c.timers.delete(t); fn(); }), ms);
        c.timers.add(t);
        return t;
      },
      byText(selector, text) {
        const needle = String(text).toLowerCase();
        return query(selector).find(e => (e.textContent || "").toLowerCase().includes(needle)) || null;
      },
      // ---- show-once hook: doing steps for the user (core/showonce.js)
      // waitFor: the first shown match (with `text`: whose text contains it),
      // once it appears; throws after `timeout` ms.
      waitFor(selector, opts = {}) {
        const { text = null, within = document, timeout = 5000 } = typeof opts === "number" ? { timeout: opts } : opts;
        const needle = text == null ? null : String(text).toLowerCase().replace(/\s+/g, " ").trim();
        const words = e => (e.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
        const find = () => [...within.querySelectorAll(selector)].filter(e => !e.closest("[data-morse-ui],[data-morse]")
          && (needle == null || words(e).includes(needle)));
        return new Promise((resolve, reject) => {
          const t0 = Date.now();
          const tick = guard(c, () => {
            let all = find();
            // "Archive" is the button that says Archive, before one that says Unarchive.
            if (needle != null) all = [...all.filter(e => words(e) === needle), ...all.filter(e => words(e) !== needle)];
            const el = all.find(e => e.getClientRects().length) || (Date.now() - t0 >= timeout ? all[0] : null);
            if (el) return resolve(el);
            if (Date.now() - t0 >= timeout) return reject(new Error(`Couldn't find ${text != null ? `“${text}”` : selector} on the page`));
            m.after(100, tick);
          });
          tick();
        });
      },
      sleep(ms) { return new Promise(r => m.after(ms, r)); },
      // type: puts text in a field the way typing does (frameworks see input and change)
      type(el, text) {
        el.focus?.();
        if (el.isContentEditable) {
          el.textContent = String(text);
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text) }));
          return el;
        }
        const proto = Object.getPrototypeOf(el);
        const set = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        set ? set.call(el, String(text)) : (el.value = String(text));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el;
      },
      // choose: an option of a <select> by its text or value; a checkbox or radio on (true) or off.
      // Anything else (a button, a link) is not a choice: clicking it could submit or buy.
      choose(el, want) {
        const checkable = (el.localName === "input" && /^(checkbox|radio)$/i.test(el.type)) || /^(checkbox|radio|switch|menuitemcheckbox|menuitemradio)$/.test(el.getAttribute?.("role") || "");
        if (el.localName !== "select" && !checkable) throw new Error("morse.choose works on a menu, a checkbox or an option; use el.click() for anything else");
        if (el.localName !== "select" && el.checked === undefined) { // role=checkbox and friends
          if ((el.getAttribute("aria-checked") === "true") !== (want !== false)) el.click();
          return el;
        }
        if (el.localName === "select") {
          const w = String(want).toLowerCase();
          const opt = [...el.options].find(o => o.value === String(want)) || [...el.options].find(o => o.text.trim().toLowerCase() === w)
            || [...el.options].find(o => o.text.toLowerCase().includes(w));
          if (!opt) throw new Error(`No option “${want}”`);
          el.value = opt.value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (el.checked !== (want !== false)) el.click();
        return el;
      },
      // key: a key press on el; Enter in a form field submits its form only
      // when a real one would: through its submit button (not when that is
      // turned off), or, with none, when the field is the form's only one.
      key(el, key, mods = {}) {
        el = el || document.activeElement || document.body;
        const init = { key, code: key.length === 1 ? (/[a-z]/i.test(key) ? "Key" + key.toUpperCase() : /\d/.test(key) ? "Digit" + key : "") : key,
          bubbles: true, cancelable: true, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: !!mods.meta };
        const go = el.dispatchEvent(new KeyboardEvent("keydown", init));
        el.dispatchEvent(new KeyboardEvent("keyup", init));
        const f = el.form;
        if (go && key === "Enter" && f && el.localName === "input" && !mods.ctrl && !mods.alt && !mods.meta) {
          const all = [...f.elements];
          const btn = all.find(b => b.matches("button:not([type]),button[type=submit],input[type=submit],input[type=image]"));
          const fields = all.filter(x => x.localName === "input" && /^(text|search|url|tel|email|password|date|datetime-local|month|week|time|number)$/i.test(x.type));
          if (btn) { if (!btn.disabled) btn.click(); }
          else if (fields.length === 1) f.requestSubmit ? f.requestSubmit() : f.submit();
        }
        return el;
      },
      // confirm: asks the person on the page, in Morse's own words, before a
      // step that can't be taken back. Resolves true only for their own click
      // (or Enter) on the yes button; No, Esc or turning the mod off is false.
      confirm(message, { yes = "Yes", no = "Cancel" } = {}) {
        return new Promise(resolve => {
          const box = document.createElement("div");
          box.setAttribute("data-morse-ui", "");
          box.setAttribute("role", "alertdialog");
          box.setAttribute("aria-modal", "true");
          const shadow = box.attachShadow({ mode: "open" }); // the page's styles stay out; its scripts can't say yes (isTrusted below)
          // Built node by node: apps with Trusted Types (VS Code) refuse HTML strings.
          const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
          const style = make("style", "", `.c { position: fixed; left: 50%; top: 18%; transform: translateX(-50%); z-index: 2147483647; max-width: min(420px, calc(100vw - 32px));
              background: #0d1117; color: #e6edf3; font: 500 14px/1.45 ui-sans-serif, system-ui, sans-serif; padding: 16px 18px;
              border: 1px solid #30363d; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
            p { margin: 0 0 14px; } .b { display: flex; gap: 8px; justify-content: flex-end; }
            button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid #30363d; background: #161b22; color: inherit; cursor: pointer; }
            button.y { background: #da3633; border-color: #da3633; color: #fff; }`);
          const n = make("button", "n", no), y = make("button", "y", yes);
          const row = make("div", "b"), card = make("div", "c");
          row.append(n, y);
          card.append(make("p", "", String(message)), row);
          shadow.append(style, card);
          let done = false;
          const finish = ok => {
            if (done) return;
            done = true;
            box.remove();
            document.removeEventListener("keydown", onKey, true);
            resolve(ok);
          };
          // A page script can click a button too: only a real click counts.
          y.addEventListener("click", e => { if (e.isTrusted) finish(true); });
          n.addEventListener("click", () => finish(false));
          const onKey = e => { if (e.isTrusted && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
          document.addEventListener("keydown", onKey, true);
          c.cleanups.push(() => finish(false));
          document.body.append(box);
          n.focus();
        });
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
    // Runs mod code; returns { ok, error } synchronously (and `paused`: why,
    // when the guards stopped it while it started). On success, `settle` is
    // how many ms a host waits before __errors has seen its callbacks run.
    __run(id, fn) {
      this.__off(id);
      const c = ctxFor(id);
      const prev = enter(c), t0 = now();
      let res = { ok: true };
      try {
        const cleanup = fn(api(c), ...scope(c));
        if (typeof cleanup === "function") c.cleanups.push(cleanup);
      } catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
      leave(c, prev, t0); // its start counts too: a start that takes over a second pauses it
      const p = paused.get(id);
      if (p) return { ok: false, error: p.error, paused: p.why };
      if (!res.ok) this.__off(id);
      else res.settle = c.settle;
      return res;
    },
    __off(id) {
      paused.delete(id);
      const c = mods.get(id);
      if (c) stop(c);
      else document.querySelectorAll(`[data-morse="${CSS.escape(id)}"]`).forEach(e => e.remove());
      return true;
    },
    // A paused mod's reason comes first: the repair loop gives it to the model.
    __errors(id) { return [...(paused.has(id) ? [paused.get(id).error] : []), ...(mods.get(id)?.errors || [])].slice(0, 3); },
    // How a running mod is doing: each watch's selector with the elements it
    // matches now and has ever matched, errors so far, and the time its code
    // took (ms). A paused mod: { paused: { why, error, ms, at } }. null if
    // it isn't running.
    __stats(id) {
      const c = mods.get(id);
      if (!c) return paused.has(id) ? { watches: [], errors: 0, error: null, ms: paused.get(id).ms, paused: { ...paused.get(id) } } : null;
      // Exact counts on demand, rather than a rescan on every removal.
      for (const w of watches) if (w.c === c) {
        try { w.st.now = query(w.selector).filter(el => !el.closest("[data-morse-ui],[data-morse]")).length; } catch {}
      }
      return { watches: c.watches.map(w => ({ ...w })), errors: c.nerr, error: c.errors[0] ? String(c.errors[0]).split("\n")[0] : null, ms: Math.round(c.ms) };
    },
    // After the host stopped a script that never returned (daemon/guard.js):
    // which mod's code was running, if any. That mod is stopped, and the kit
    // is ready for the next one.
    __hung() {
      const c = cur;
      cur = null; depth = 0; queued = false;
      if (!c) return null;
      if (!c.dead) pause(c, "froze", "it froze the page: its code ran for seconds without finishing (an endless loop?). Never loop without an exit: react to the page with morse.watch, or repeat with morse.every.");
      return c.id;
    },
    __limits: L,
  };
}

export const KIT_SOURCE = `(${installMorseKit.toString()})();`;

// How long a host waits after running a mod before reading morse.__errors:
// what the kit asked for, or 600 ms from a kit that predates settle.
export const settleMs = res => (Number.isFinite(res?.settle) ? Math.max(0, Math.min(600, res.settle)) : 600);

// The globals mod code gets the guarded versions of (core/kit.js scope()).
const SCOPE = ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver"];

// Wraps mod code so it can run without eval (page CSP friendly). The inner
// function lets mod code declare its own names, even ones SCOPE shadows.
export function wrapModCode(id, js) {
  return `${KIT_SOURCE}\nmorse.__run(${JSON.stringify(id)}, function (morse, ${SCOPE.join(", ")}) {\nreturn (function () {\n${js}\n}).call(this);\n});\n//# sourceURL=morse-mod-${String(id).replace(/[^\w-]/g, "")}.js`;
}
