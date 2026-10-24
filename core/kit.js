// The `morse` helper object that generated mod code runs against. It is
// injected as source text into whichever world executes mods (the page's main
// world over CDP, the USER_SCRIPT world in the extension, or a userscript).
// Every resource a mod creates is tracked so turning the mod off fully undoes it.

function installMorseKit() {
  if (globalThis.morse && globalThis.morse.__kit) return;
  const mods = new Map();
  // speed: a mod's late errors come from its callbacks. Watch callbacks for new
  // matches run a frame after a change, so a short wait covers them; timers
  // (every, after) need until they first fire; listeners for events that can
  // happen on their own (timeupdate, scroll, resize…) keep the full window.
  // Input a person has to make (a click, a key) can't happen during the wait.
  const SETTLE_MS = 150, SETTLE_MAX = 600;
  const BY_PERSON = /^(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|keydown|keyup|keypress|input|change|submit|reset|focus|blur|focusin|focusout|copy|cut|paste|dragstart|drop)$/;
  const settleFor = (c, ms) => { c.settle = Math.min(SETTLE_MAX, Math.max(c.settle, ms)); };
  const settleOn = (c, event) => { if (!BY_PERSON.test(String(event))) settleFor(c, SETTLE_MAX); };

  function ctxFor(id) {
    if (mods.has(id)) return mods.get(id);
    // settle: how long a host should wait after running the mod before
    // reading its errors (speed: see __run).
    const c = { id, cleanups: [], errors: [], observers: [], watches: [], settle: SETTLE_MS };
    mods.set(id, c);
    return c;
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
        // changed under the mod (the panel offers to fix it).
        const w = { selector: String(selector), now: 0, total: 0 };
        c.watches.push(w);
        const scan = () => {
          if (c.dead) return;
          let list;
          try { list = document.querySelectorAll(selector); } catch (e) { c.errors.push(String(e)); return; }
          // Never match Morse's own elements: a mod that inserts a button next to
          // "header button" must not then match the button it inserted.
          let now = 0;
          for (const el of list) {
            if (el.closest("[data-morse-ui],[data-morse]")) continue;
            now++;
            if (!seen.has(el)) { seen.add(el); w.total++; run(el); }
          }
          w.now = now;
        };
        scan();
        let queued = false;
        const mo = new MutationObserver(() => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => { queued = false; scan(); });
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
        c.observers.push(mo);
      },
      el(tagName, props, ...kids) {
        const el = tag(document.createElement(tagName));
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
        settleOn(c, event);
        target.addEventListener(event, h, opts);
        c.cleanups.push(() => target.removeEventListener(event, h, opts));
      },
      every(ms, fn) {
        settleFor(c, (+ms || 0) + 60);
        const t = setInterval(guard(c, fn), ms);
        c.cleanups.push(() => clearInterval(t));
        return t;
      },
      after(ms, fn) {
        settleFor(c, (+ms || 0) + 60);
        const t = setTimeout(guard(c, fn), ms);
        c.cleanups.push(() => clearTimeout(t));
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
        setTimeout(() => t.remove(), 2600);
      },
      get id() { return c.id; },
    };
    return m;
  }

  globalThis.morse = {
    __kit: 1,
    // Runs mod code; returns { ok, error } synchronously. On success, settle
    // is how many ms to wait before __errors has seen its callbacks run.
    __run(id, fn) {
      this.__off(id);
      const c = ctxFor(id);
      try {
        const cleanup = fn(api(c));
        if (typeof cleanup === "function") c.cleanups.push(cleanup);
        return { ok: true, settle: c.settle };
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
      return { watches: c.watches.map(w => ({ ...w })), errors: c.errors.length, error: c.errors[0] ? String(c.errors[0]).split("\n")[0] : null };
    },
  };
}

export const KIT_SOURCE = `(${installMorseKit.toString()})();`;

// How long a host waits after running a mod before reading morse.__errors:
// what the kit asked for, or 600 ms from a kit that predates settle.
export const settleMs = res => (Number.isFinite(res?.settle) ? Math.max(0, Math.min(600, res.settle)) : 600);

// Wraps mod code so it can run without eval (page CSP friendly).
export function wrapModCode(id, js) {
  return `${KIT_SOURCE}\nmorse.__run(${JSON.stringify(id)}, function (morse) {\n${js}\n});`;
}
