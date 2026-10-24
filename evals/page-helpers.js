// In-page code for the eval runner.
//   STUBS    installed before the page loads: records clipboard writes and
//            downloads instead of performing them.
//   helpers  the `T` object checkers use (DOM queries, visibility, colors,
//            real input through Playwright via exposed functions).

export function stubs() {
  // Every root a checker (or a mod) may need: the document, open shadow roots
  // (nested too) and same-origin iframes. "a >>> b" selects b inside a's
  // shadow root or frame document.
  window.__roots = (doc = document) => {
    const out = [];
    const visit = root => {
      out.push(root);
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) visit(el.shadowRoot);
        if (el.localName === "iframe" || el.localName === "frame") { try { const d = el.contentDocument; if (d?.documentElement) visit(d); } catch {} }
      }
    };
    visit(doc);
    return out;
  };
  window.__deep = sel => {
    let scopes = [document];
    const parts = String(sel).split(/\s*>>>\s*/);
    for (let i = 0; i < parts.length; i++) {
      const found = scopes.flatMap(sc => [...sc.querySelectorAll(parts[i])]);
      if (i === parts.length - 1) return found;
      scopes = found.map(el => { try { return el.shadowRoot || el.contentDocument || null; } catch { return null; } }).filter(Boolean);
    }
    return [];
  };
  // confirm() answers what the checker says (default: OK) and is recorded.
  window.__confirms = [];
  window.__confirmAnswer = true;
  window.confirm = msg => { window.__confirms.push(String(msg ?? "")); return window.__confirmAnswer; };
  window.__clip = "";
  window.__blobs = new Map();
  window.__downloads = [];
  const clip = navigator.clipboard;
  const writeText = async t => { window.__clip = String(t); };
  try {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText,
      async write(items) {
        for (const it of items || []) for (const type of it.types || []) {
          if (/text/.test(type)) { const b = await it.getType(type); window.__clip = await b.text(); return; }
        }
      },
      readText: async () => window.__clip,
      read: clip?.read?.bind(clip),
    } });
  } catch {}
  const exec = document.execCommand.bind(document);
  document.execCommand = function (cmd, ...rest) {
    if (/^(copy|cut)$/i.test(cmd)) {
      const a = document.activeElement;
      const sel = a && "value" in a && typeof a.selectionStart === "number" ? a.value.slice(a.selectionStart, a.selectionEnd) : String(getSelection());
      window.__clip = sel || (a && a.value) || "";
      return true;
    }
    return exec(cmd, ...rest);
  };
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = obj => { const u = create(obj); window.__blobs.set(u, obj); return u; };
  const record = a => window.__downloads.push({ href: a.href, name: a.download || "" });
  const isDownload = a => a && (a.hasAttribute("download") || /^(blob|data):/.test(a.getAttribute("href") || ""));
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (isDownload(this)) return record(this); return click.call(this); };
  addEventListener("click", e => {
    const a = e.target?.closest?.("a");
    if (isDownload(a)) { e.preventDefault(); record(a); }
  }, true);
  const open = window.open;
  window.open = (u, ...r) => { if (/^(blob|data):/.test(String(u))) { window.__downloads.push({ href: String(u) }); return null; } return open(u, ...r); };
}

export function helpers() {
  const orig = window.__orig || new WeakSet();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  // Up the flat tree: out of shadow roots and same-origin frames.
  const up = e => e.parentElement || e.getRootNode().host || (e.ownerDocument !== document && e === e.ownerDocument.documentElement ? e.ownerDocument.defaultView.frameElement : null);
  const T = {
    $: s => document.querySelector(s),
    $$: s => [...document.querySelectorAll(s)],
    // Deep: "host >>> inner" through open shadow roots and same-origin frames.
    q: s => window.__deep(s)[0] || null,
    qq: s => window.__deep(s),
    // s matched in every root (document, shadow roots, frames).
    all: s => window.__roots().flatMap(r => [...r.querySelectorAll(s)]),
    async scroll(el, top) { el.scrollTop = top; el.dispatchEvent(new Event("scroll")); await T.sleep(150); },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    rect: el => el.getBoundingClientRect(),
    cs: el => getComputedStyle(el),
    orig: el => orig.has(el),
    // Elements that did not exist before the mod was applied.
    fresh: (sel = "*") => T.all(sel).filter(e => !orig.has(e) && !/^(STYLE|SCRIPT|LINK|META)$/.test(e.tagName)),
    // Text the mod added: new elements, plus ::before/::after content that
    // wasn't there before (CSS-only labels like `content: attr(data-n) " words"`).
    freshText() {
      const top = T.fresh().filter(e => T.visible(e) && !(e.parentElement && !orig.has(e.parentElement) && e.parentElement !== document.body));
      const before = new Set(window.__pseudo0 || []);
      return [...top.map(e => e.innerText || e.value || ""), ...T.pseudoTexts().filter(t => !before.has(t))].join(" | ");
    },
    pseudo(el, which) {
      const s = getComputedStyle(el, which);
      const c = s.content;
      if (!c || c === "none" || c === "normal" || s.display === "none" || parseFloat(s.fontSize) < 2) return "";
      let out = "";
      for (const m of c.matchAll(/"((?:\\.|[^"\\])*)"|attr\(([\w-]+)\)|counter\([^)]*\)/g)) {
        if (m[1] !== undefined) out += m[1].replace(/\\(.)/g, "$1");
        else if (m[2]) out += el.getAttribute(m[2]) || "";
      }
      return out.trim();
    },
    pseudoTexts() {
      const out = [];
      for (const e of [document.documentElement, ...document.body.querySelectorAll("*")]) {
        if (e !== document.documentElement && e !== document.body && !T.visible(e)) continue;
        for (const w of ["::before", "::after"]) { const t = T.pseudo(e, w); if (t) out.push(t); }
      }
      return out;
    },
    // What a person can actually read: visible text nodes at a real size and
    // color, plus pseudo-element content.
    visibleText() {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) {
        const p = n.parentElement;
        if (!n.textContent.trim() || !p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue;
        if (!T.visible(p) || T.fontPx(p) < 2 || T.rgb(getComputedStyle(p).color)[3] < 0.05) continue;
        out.push(n.textContent.trim());
      }
      return [...out, ...T.pseudoTexts()].join(" ");
    },
    // Widest thin bar pinned to the top of the viewport (elements or pseudo-elements).
    topBarWidth() {
      let best = 0;
      // Painted bars only: a transparent full-width track doesn't count, its fill does.
      const ok = (r, s) => r.top < 12 && r.height > 0 && r.height <= 24 && s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0.05
        && (T.rgb(s.backgroundColor)[3] > 0.05 || s.backgroundImage !== "none");
      for (const e of T.fresh()) { const r = T.rect(e), s = T.cs(e); if (ok(r, s) && T.visible(e)) best = Math.max(best, r.width); }
      for (const e of [document.documentElement, document.body, ...T.fresh()]) for (const w of ["::before", "::after"]) {
        const s = getComputedStyle(e, w);
        if (s.content === "none" || s.content === "normal" || !/fixed|sticky/.test(s.position)) continue;
        const top = parseFloat(s.top) || 0, h = parseFloat(s.height) || 0;
        if (ok({ top, height: h }, s)) best = Math.max(best, parseFloat(s.width) || 0);
      }
      return best;
    },
    visible(el) {
      if (!el || !el.isConnected) return false;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const doc = el.ownerDocument, win = doc.defaultView || window;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= Math.max(win.innerWidth, doc.documentElement.scrollWidth)) return false;
      // Clipped away by an ancestor (max-height: 0 / width: 0 + overflow hidden),
      // across shadow roots.
      for (let p = el.parentElement || el.getRootNode().host; p && p !== doc.body; p = p.parentElement || p.getRootNode().host) {
        const s = getComputedStyle(p);
        if (s.overflow !== "visible") { const pr = p.getBoundingClientRect(); if (pr.width < 2 || pr.height < 2) return false; }
      }
      // Inside a frame: the frame must show too.
      if (win !== window && win.frameElement) return T.visible(win.frameElement);
      return true;
    },
    rgb(c) {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = "rgba(0,0,0,0)";
      g.fillStyle = c;
      g.fillRect(0, 0, 1, 1);
      const [r, gg, b, a] = g.getImageData(0, 0, 1, 1).data;
      return [r, gg, b, a / 255];
    },
    lum(c) {
      const [r, gg, b] = (typeof c === "string" ? T.rgb(c) : c).map(v => v / 255);
      const f = v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
    },
    inverted(el) {
      let n = 0;
      for (let p = el; p; p = up(p)) {
        const m = getComputedStyle(p).filter.match(/invert\(([\d.]+)(%?)\)/);
        if (m && (m[2] ? +m[1] / 100 : +m[1]) >= 0.5) n++;
      }
      return n % 2 === 1;
    },
    // The color actually painted behind el's text: composites ancestor
    // backgrounds and accounts for invert() filters (a common dark mode).
    bg(el) {
      const layers = [];
      for (let p = el; p; p = up(p)) {
        const c = T.rgb(getComputedStyle(p).backgroundColor);
        if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
      }
      let out = [255, 255, 255];
      for (const [r, gg, b, a] of layers.reverse()) out = [r * a + out[0] * (1 - a), gg * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
      return T.inverted(el) ? out.map(v => 255 - v) : out;
    },
    fg(el) {
      const [r, gg, b, a] = T.rgb(getComputedStyle(el).color);
      const inv = T.inverted(el);
      const bg = T.bg(el).map(v => inv ? 255 - v : v);
      const out = [r * a + bg[0] * (1 - a), gg * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
      return inv ? out.map(v => 255 - v) : out;
    },
    contrast(el) {
      const a = T.lum(T.fg(el)), b = T.lum(T.bg(el));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    },
    fontPx(el) {
      let z = 1;
      for (let p = up(el); p; p = up(p)) z *= parseFloat(getComputedStyle(p).zoom) || 1;
      return Math.round(parseFloat(getComputedStyle(el).fontSize) * (parseFloat(getComputedStyle(el).zoom) || 1) * z * 10) / 10;
    },
    sig(el) {
      const props = ["backgroundColor", "color", "fontWeight", "fontSize", "borderLeftWidth", "borderLeftColor", "boxShadow", "outlineStyle", "opacity", "backgroundImage"];
      return [el, ...el.querySelectorAll("*")].map(e => { const s = getComputedStyle(e); return props.map(p => s[p]).join("|") + (T.visible(e) ? "" : "!"); }).join(";")
        + "#" + el.querySelectorAll("*").length;
    },
    // Text a person can read in every root (shadow roots and frames included).
    deepText() {
      const out = [];
      for (const root of window.__roots()) {
        const top = root.body || root;
        if (!top) continue;
        const w = (root.ownerDocument || root).createTreeWalker(top, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) {
          const p = n.parentElement;
          if (!n.textContent.trim() || !p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || !T.visible(p)) continue;
          out.push(n.textContent.trim());
        }
      }
      return out.join(" ");
    },
    // Downloads as { href, name, type } (type: a blob's MIME type).
    downloads: () => window.__downloads.map(d => ({ ...d, type: d.href?.startsWith("blob:") ? window.__blobs.get(d.href)?.type || "" : (d.href?.match(/^data:([^;,]*)/) || [])[1] || "" })),
    async hover(el) {
      const r = el.getBoundingClientRect();
      await window.__evalMove(r.left + Math.min(r.width / 2, 200), r.top + r.height / 2);
      await T.sleep(50);
    },
    async click(el) {
      el.scrollIntoView({ block: "center", inline: "center" });
      await T.sleep(50);
      const r = el.getBoundingClientRect();
      // Inside a same-origin frame: add the frames' offsets.
      let x = r.left + r.width / 2, y = r.top + r.height / 2;
      for (let w = el.ownerDocument.defaultView; w && w !== window && w.frameElement; w = w.parent) {
        const f = w.frameElement.getBoundingClientRect(), cs = getComputedStyle(w.frameElement);
        x += f.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft); y += f.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
      }
      await window.__evalClick(x, y);
      await T.sleep(50);
    },
    caretEnd(el) {
      el.focus();
      if (el.isContentEditable) {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      } else if (typeof el.value === "string") {
        try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
      }
    },
    async type(el, text, { append = false } = {}) {
      el.focus();
      if (!append) {
        if (el.isContentEditable) el.textContent = "";
        else el.value = "";
      }
      T.caretEnd(el);
      await window.__evalType(text);
      await T.sleep(50);
    },
    // Real key press; resolves to whether the page called preventDefault().
    async press(key) {
      let prevented = false;
      const spy = e => { prevented = prevented || e.defaultPrevented; };
      addEventListener("keydown", spy);
      await window.__evalPress(key);
      await T.sleep(30);
      removeEventListener("keydown", spy);
      return prevented;
    },
    // After opening a new menu: choose a duration (select, number input, or
    // the first option with a number in it).
    async pickOption() {
      const sel = T.fresh("select").filter(T.visible)[0];
      if (sel) {
        const o = [...sel.options].find(o => /\d/.test(o.textContent) && o.value);
        if (o) { sel.value = o.value; sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); }
        return;
      }
      const num = T.fresh("input").filter(e => T.visible(e) && /number|text/.test(e.type))[0];
      if (num) { await T.type(num, "15"); await T.press("Enter"); return; }
      const opt = T.fresh("button,[role=button],[role=menuitem],[role=option],li,a").filter(e => T.visible(e) && /\d/.test(e.innerText))[0];
      if (opt) await T.click(opt);
    },
    async downloaded() {
      const out = [];
      for (const d of window.__downloads) {
        if (d.text) out.push(d.text);
        else if (d.href?.startsWith("blob:") && window.__blobs.has(d.href)) out.push(await window.__blobs.get(d.href).text());
        else if (d.href?.startsWith("data:")) {
          const [head, body = ""] = d.href.split(",");
          try { out.push(/;base64/.test(head) ? atob(body) : decodeURIComponent(body)); } catch { out.push(body); }
        }
      }
      return out.join("\n");
    },
  };
  window.T = T;
}
