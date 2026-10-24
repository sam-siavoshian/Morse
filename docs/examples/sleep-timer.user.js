// ==UserScript==
// @name         Sleep timer
// @namespace    morph
// @version      1
// @description  add a sleep timer that pauses the music after a while
// @match        *://127.0.0.1:8789/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Made with Morph: customize any app in one sentence.

(function installMorphKit() {
  if (globalThis.morph && globalThis.morph.__kit) return;
  const mods = new Map();

  function ctxFor(id) {
    if (mods.has(id)) return mods.get(id);
    const c = { id, cleanups: [], errors: [], observers: [] };
    mods.set(id, c);
    return c;
  }

  function guard(c, fn) {
    return function (...args) {
      try { return fn.apply(this, args); }
      catch (e) { c.errors.push(String(e && e.stack || e)); console.warn("[morph]", c.id, e); }
    };
  }

  function api(c) {
    const tag = el => { if (el && el.setAttribute) el.setAttribute("data-morph", c.id); return el; };
    const m = {
      watch(selector, fn) {
        const seen = new WeakSet();
        const run = guard(c, fn);
        const scan = () => {
          let list;
          try { list = document.querySelectorAll(selector); } catch (e) { c.errors.push(String(e)); return; }
          // Never match Morph's own elements: a mod that inserts a button next to
          // "header button" must not then match the button it inserted.
          for (const el of list) if (!seen.has(el) && !el.closest("[data-morph-ui],[data-morph]")) { seen.add(el); run(el); }
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
        const t = setInterval(guard(c, fn), ms);
        c.cleanups.push(() => clearInterval(t));
        return t;
      },
      after(ms, fn) {
        const t = setTimeout(guard(c, fn), ms);
        c.cleanups.push(() => clearTimeout(t));
        return t;
      },
      byText(selector, text) {
        const needle = String(text).toLowerCase();
        return [...document.querySelectorAll(selector)].find(e => (e.textContent || "").toLowerCase().includes(needle)) || null;
      },
      store: {
        get(k, d = null) { try { const v = localStorage.getItem(`morph:${c.id}:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
        set(k, v) { try { localStorage.setItem(`morph:${c.id}:${k}`, JSON.stringify(v)); } catch {} },
      },
      toast(message) {
        const t = document.createElement("div");
        t.setAttribute("data-morph-ui", "");
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

  globalThis.morph = {
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
      if (!c) return true;
      c.observers.forEach(o => o.disconnect());
      c.cleanups.reverse().forEach(f => { try { f(); } catch {} });
      document.querySelectorAll(`[data-morph="${id}"]`).forEach(e => e.remove());
      mods.delete(id);
      return true;
    },
    __errors(id) { return (mods.get(id)?.errors || []).slice(0, 3); },
  };
})();
morph.__run("rka3nrafex", function (morph) {
morph.css(".morph-sleep { background: none; border: 0; color: #b3b3b3; font-size: 16px; cursor: pointer; position: relative; padding: 0 2px; }\n.morph-sleep:hover { color: #fff; }\n.morph-sleep.on { color: #1ed760; }\n.morph-sleep span { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); font: 700 10px/1 ui-sans-serif, system-ui; background: #1ed760; color: #000; padding: 3px 6px; border-radius: 9px; white-space: nowrap; }\n");
morph.watch('[data-testid="player-controls"] .btns', btns => {
  const steps = [15, 30, 60, 0];
  let left = 0, i = -1;
  const label = morph.el("span");
  const btn = morph.el("button", { class: "morph-sleep", title: "Sleep timer", text: "☾", on: { click() {
    i = (i + 1) % steps.length;
    left = steps[i] * 60;
    render();
    morph.toast(left ? "Pausing in " + steps[i] + " minutes" : "Sleep timer off");
  } } });
  const render = () => {
    btn.classList.toggle("on", left > 0);
    label.textContent = left ? Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") : "";
    if (left) btn.append(label); else label.remove();
  };
  morph.every(1000, () => {
    if (!left) return;
    if (--left === 0) {
      const pp = document.querySelector('[data-testid="play-pause"]');
      if (pp && pp.getAttribute("aria-label") === "Pause") pp.click();
      morph.toast("Sleep timer: paused");
    }
    render();
  });
  btns.append(btn);
});

});
