// The `morse` helper object that generated mod code runs against. It is
// injected as source text into whichever world executes mods (the page's main
// world over CDP, the USER_SCRIPT world in the extension, or a userscript).
// Every resource a mod creates is tracked so turning the mod off fully undoes it.

function installMorseKit() {
  if (globalThis.morse && globalThis.morse.__kit) return;
  const mods = new Map();

  function ctxFor(id) {
    if (mods.has(id)) return mods.get(id);
    const c = { id, cleanups: [], errors: [], observers: [], watches: [], syncs: [], made: new Set() };
    mods.set(id, c);
    return c;
  }

  function guard(c, fn) {
    return function (...args) {
      if (c.dead) return; // the mod was turned off; a queued callback must not run
      try { return fn.apply(this, args); }
      catch (e) { c.errors.push(String(e && e.stack || e)); console.warn("[morse]", c.id, e); }
      // What the mod's own callbacks change is the mod's doing: watches take
      // it as the new state instead of "putting it back".
      finally { if (!c.inScan) for (const sync of c.syncs || []) sync(); }
    };
  }

  // "host >>> inside": into an open shadow root or a same-origin frame.
  function inner(el) {
    if (el.shadowRoot) return el.shadowRoot;
    if (el.localName === "iframe" || el.localName === "frame") {
      try { const d = el.contentDocument; return d && d.documentElement ? d : null; } catch { return null; }
    }
    return null;
  }
  // Every match of a selector that may contain ">>>". onRoot(root, via) is
  // told about each shadow root / frame document crossed.
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

  function api(c) {
    const tag = el => { if (el && el.setAttribute) el.setAttribute("data-morse", c.id); return el; };
    c.syncs ||= [];
    const m = {
      // fn(el) runs once for every current and future match. Apps re-render:
      // when the app wipes what fn added (its elements, the classes, inline
      // styles, attributes or text it set on el), the watch puts it back or
      // runs fn again. With { live: true } fn also runs again whenever el or
      // its content changes (rows a virtualized list reuses for other items);
      // what fn did last time is undone first.
      watch(selector, fn, opts) {
        const live = !!(opts && opts.live);
        const sel = String(selector);
        const seen = new WeakMap(); // element -> what fn did to it
        const run = guard(c, fn);
        // Match counts for __stats: a watch that never matches means the page
        // changed under the mod (the panel offers to fix it).
        const w = { selector: sel, now: 0, total: 0 };
        c.watches.push(w);
        const dirty = new Set(), madeBy = new WeakMap();
        let queued = false;
        const queue = () => {
          if (queued || c.dead) return;
          queued = true;
          requestAnimationFrame(() => { queued = false; scan(); });
        };
        const owner = n => { for (let x = n; x; x = x.parentNode || x.host) if (seen.has(x)) return x; return null; };
        const mo = new MutationObserver(recs => {
          if (live) for (const r of recs) { const o = owner(r.target); if (o) dirty.add(o); }
          queue();
        });
        c.observers.push(mo);
        const observed = new WeakSet(), frames = new WeakSet();
        const observe = (root, via) => {
          if (!root || observed.has(root)) return;
          observed.add(root);
          mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
          if (via && root.nodeType === 9 && !frames.has(via)) { // a frame that loads a new page
            frames.add(via);
            via.addEventListener("load", queue);
            c.cleanups.push(() => via.removeEventListener("load", queue));
          }
        };
        observe(document);
        const styles = el => { const o = {}; for (let i = 0; i < el.style.length; i++) { const p = el.style[i]; o[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]; } return o; };
        const attrs = el => { const o = {}; for (const a of el.attributes) if (a.name !== "class" && a.name !== "style") o[a.name] = a.value; return o; };
        const apply = (el, prev) => {
          const cl0 = new Set(el.classList), st0 = styles(el), at0 = attrs(el), tx0 = el.textContent;
          const kids0 = new Set(el.childNodes), sibs0 = el.parentNode ? new Set(el.parentNode.childNodes) : null;
          // A burst of re-runs means fn and the app are fighting over el: then leave it alone.
          const t = Date.now(), burst = prev && t - prev.at < 100 ? prev.burst + 1 : 0;
          const r = { created: [], at: t, burst, root: inner(el) };
          const outer = c.current;
          c.current = r;
          try { run(el); } finally { c.current = outer; }
          // What fn made: elements through morse.el, and nodes it put in or next to el.
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
        // Put back what the app undid: the classes, inline styles and attributes fn set.
        const reassert = (el, r) => {
          for (const x of r.addCls) if (!el.classList.contains(x)) el.classList.add(x);
          for (const x of r.rmCls) if (el.classList.contains(x)) el.classList.remove(x);
          for (const p in r.style) { const [v, pr] = r.style[p]; if (el.style.getPropertyValue(p) !== v || el.style.getPropertyPriority(p) !== pr) el.style.setProperty(p, v, pr); }
          for (const k in r.attrs) { const v = r.attrs[k][1]; if (el.getAttribute(k) !== v) v == null ? el.removeAttribute(k) : el.setAttribute(k, v); }
        };
        // Undo what fn did, before running it again.
        const undo = (el, r) => {
          for (const n of r.created) { n.remove(); c.made.delete(n); }
          for (const x of r.addCls) el.classList.remove(x);
          for (const x of r.rmCls) el.classList.add(x);
          for (const p in r.style) { if (el.style.getPropertyValue(p) !== r.style[p][0]) continue; const o = r.styleWas[p]; o ? el.style.setProperty(p, o[0], o[1]) : el.style.removeProperty(p); }
          for (const k in r.attrs) { if (el.getAttribute(k) !== r.attrs[k][1]) continue; const o = r.attrs[k][0]; o == null ? el.removeAttribute(k) : el.setAttribute(k, o); }
        };
        const scan = () => {
          if (c.dead) return;
          let list;
          try { list = query(sel, observe); } catch (e) { c.errors.push(String(e)); return; }
          // Never match Morse's own elements: a mod that inserts a button next to
          // "header button" must not then match the button it inserted.
          let now = 0;
          const was = c.inScan;
          c.inScan = true;
          try {
            for (const el of list) {
              if (el.closest("[data-morse-ui],[data-morse]")) continue;
              now++;
              observe(inner(el), el); // what renders inside a matched component or frame
              const r = seen.get(el);
              if (!r) { w.total++; apply(el, null); continue; }
              if (r.burst > 20) continue; // fighting the app: leave this one alone
              const wiped = r.created.some(n => !n.isConnected) || r.root !== inner(el) || (r.text != null && el.textContent !== r.text);
              if (wiped || (live && dirty.has(el))) { undo(el, r); apply(el, r); }
              else reassert(el, r);
            }
          } finally { c.inScan = was; }
          dirty.clear();
          w.now = now;
          mo.takeRecords(); // our own changes: nothing to react to
        };
        // The mod's own callbacks (guard) changed things: that's the new state.
        c.syncs.push(() => {
          for (const rec of mo.takeRecords()) {
            const el = rec.target, r = el.nodeType === 1 ? seen.get(el) : null;
            if (rec.type === "childList") { // the mod removed something it made: fine
              for (const n of rec.removedNodes) { const o = madeBy.get(n); if (o) o.created = o.created.filter(k => k !== n); }
              continue;
            }
            if (!r || rec.type !== "attributes") continue;
            if (rec.attributeName === "class") { r.addCls = r.addCls.filter(x => el.classList.contains(x)); r.rmCls = r.rmCls.filter(x => !el.classList.contains(x)); }
            else if (rec.attributeName === "style") { const st = styles(el); for (const p in r.style) st[p] ? r.style[p] = st[p] : delete r.style[p]; }
            else if (r.attrs[rec.attributeName]) r.attrs[rec.attributeName][1] = el.getAttribute(rec.attributeName);
          }
          if (live) dirty.clear();
          queue();
        });
        scan();
      },
      // Elements matching a selector right now (">>>" crosses into shadow roots and frames).
      $$(selector) { return query(selector).filter(e => !e.closest("[data-morse-ui]")); },
      $(selector) { return m.$$(selector)[0] || null; },
      el(tagName, props, ...kids) {
        const el = tag(document.createElement(tagName));
        if (c.current) c.current.created.push(el);
        c.made.add(el); // removed when the mod is turned off
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
        return el;
      },
      // css(text, where): with `where` (a selector of components or frames,
      // ">>>" allowed), the CSS goes inside each one's shadow root or frame
      // document, now and for every one that appears later.
      css(text, where) {
        // Rules written "host >>> inside { … }" go inside each host.
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
          m.watch(where, host => {
            const root = inner(host);
            if (!root) return;
            const doc = root.nodeType === 9 ? root : host.ownerDocument;
            const s = tag(doc.createElement("style"));
            s.textContent = text;
            (root.nodeType === 9 ? root.head || root.documentElement : root).append(s);
            c.made.add(s);
            if (c.current) c.current.created.push(s);
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
        return query(selector).find(e => (e.textContent || "").toLowerCase().includes(needle)) || null;
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
        c.made.forEach(e => e.remove());
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

// Wraps mod code so it can run without eval (page CSP friendly).
export function wrapModCode(id, js) {
  return `${KIT_SOURCE}\nmorse.__run(${JSON.stringify(id)}, function (morse) {\n${js}\n});`;
}
