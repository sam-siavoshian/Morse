// God mode: instant direct editing, no model call.
// Select something (⌥Space, click) and an edit toolbar anchors to it: hide,
// move, resize, rename, recolor, type, duplicate, capture, ask. Each edit is a
// small object; core/edits.js (inlined by runtime/bundle.js) compiles the list
// into ordinary mod CSS/JS, saved as one "Direct edits" mod per session with
// undo/redo. Everything lives in this IIFE so names can't collide; other files
// reach it through GodMode (hooks in 40-picker.js; 46-quick.js, 47-capture.js).

const GodMode = (() => {
  const MOD = isMac ? "⌘" : "Ctrl+";
  const SHIFT = isMac ? "⇧" : "Shift+";

  // 16px icons, 1.5px strokes.
  const P = {
    hide: '<path d="M2 8s2.2-4.25 6-4.25S14 8 14 8s-2.2 4.25-6 4.25S2 8 2 8z"/><circle cx="8" cy="8" r="1.75"/><path d="M2.75 2.75l10.5 10.5"/>',
    move: '<path d="M8 1.75v12.5M1.75 8h12.5M6.25 3.5 8 1.75 9.75 3.5M6.25 12.5 8 14.25l1.75-1.75M3.5 6.25 1.75 8 3.5 9.75M12.5 6.25 14.25 8l-1.75 1.75"/>',
    resize: '<path d="M9.75 2.25h4v4M6.25 13.75h-4v-4M13.75 2.25l-4.5 4.5M2.25 13.75l4.5-4.5"/>',
    text: '<path d="M3 4.25V2.75h10v1.5M8 2.75v10.5M6 13.25h4"/>',
    color: '<path d="M8 1.75s4.5 4.65 4.5 8a4.5 4.5 0 0 1-9 0c0-3.35 4.5-8 4.5-8z"/><path d="M5.75 10.25a2.25 2.25 0 0 0 2.25 2.25"/>',
    type: '<path d="M1.75 12.75 5.25 3.25l3.5 9.5M3 9.5h4.5M12.25 3.25v9.5M10.5 5l1.75-1.75L14 5M10.5 11l1.75 1.75L14 11"/>',
    dup: '<rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5"/><path d="M10.75 5.25V3.75a1.5 1.5 0 0 0-1.5-1.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h1.5"/>',
    capture: '<rect x="3.25" y="2.75" width="9.5" height="11.5" rx="1.5"/><path d="M6 2.75V2h4v.75M8 6.5v4.5M5.75 8.75h4.5"/>',
    ask: '<path d="M7 2.25c.55 2.85 1.9 4.2 4.75 4.75-2.85.55-4.2 1.9-4.75 4.75-.55-2.85-1.9-4.2-4.75-4.75C5.1 6.45 6.45 5.1 7 2.25z"/><path d="M12.5 1.75v2.5M11.25 3h2.5M12.25 11.25v3M10.75 12.75h3"/>',
    undo: '<path d="M5.5 3.25 2.25 6.5l3.25 3.25"/><path d="M2.25 6.5h7.5a4 4 0 0 1 0 8h-2"/>',
    redo: '<path d="M10.5 3.25l3.25 3.25-3.25 3.25"/><path d="M13.75 6.5h-7.5a4 4 0 0 0 0 8h2"/>',
    drop: '<path d="M10.25 5.75 4.5 11.5l-.75 2.25L6 13l5.75-5.75"/><path d="M9.25 4.75l2 2M10.5 3.5l.75-.75a1.77 1.77 0 0 1 2.5 2.5l-.75.75-2.5-2.5z"/>',
    minus: '<path d="M4 8h8"/>',
    plus: '<path d="M8 4v8M4 8h8"/>',
    check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>',
    frame: '<rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5"/><path d="M2.25 6h11.5"/>',
  };
  const icon = (n, s = 16) => `<svg viewBox="0 0 16 16" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
  const tip = (label, key) => `<span class="tip" role="tooltip">${esc(label)}${key ? `<kbd>${esc(key)}</kbd>` : ""}</span>`;

  const TOOLS = [
    { t: "hide", tip: "Hide", key: "H" },
    { t: "move", tip: "Move", key: "M" },
    { t: "resize", tip: "Resize", key: "R" },
    { t: "text", tip: "Edit text", key: "T" },
    { t: "color", tip: "Color", key: "C" },
    { t: "type", tip: "Text size", key: "F" },
    { t: "dup", tip: "Duplicate", key: "D" },
    null,
    { t: "capture", tip: "Capture to use in another app", key: SHIFT + "C" },
    { t: "ask", tip: "Describe a change", key: "A" },
    null,
    { t: "undo", tip: "Undo", key: MOD + "Z" },
    { t: "redo", tip: "Redo", key: SHIFT + MOD + "Z" },
  ];
  // Tools that need to reach inside the element (not possible for frames).
  const INSIDE = new Set(["text", "color", "type", "dup", "capture"]);
  const KEYS = { h: "hide", delete: "hide", backspace: "hide", m: "move", r: "resize", t: "text", c: "color", f: "type", d: "dup", a: "ask" };
  const PALETTE = ["#000000", "#262626", "#525252", "#a3a3a3", "#e5e5e5", "#ffffff", "#ef4444", "#f97316",
    "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "transparent"];
  const WEIGHTS = [[300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semi"], [700, "Bold"]];

  const wrap = document.createElement("div");
  wrap.className = "gm";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="gm-frame">${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(h => `<i data-h="${h}"></i>`).join("")}<span class="gm-read" hidden></span></div>
    <div class="gm-tb" role="toolbar" aria-label="Edit tools" tabindex="-1">
      <span class="gm-tag"></span><span class="gm-sep"></span>
      ${TOOLS.map(x => x ? `<button class="ibtn" data-t="${x.t}" aria-label="${esc(x.tip)}">${icon(x.t)}${tip(x.tip, x.key)}</button>` : `<span class="gm-sep"></span>`).join("")}
    </div>
    <div class="gm-note" hidden></div>
    <div class="gm-pop" hidden></div>`;
  root.append(wrap);
  const frame = wrap.querySelector(".gm-frame"), tb = wrap.querySelector(".gm-tb"), tag = wrap.querySelector(".gm-tag");
  const note = wrap.querySelector(".gm-note"), pop = wrap.querySelector(".gm-pop"), read = wrap.querySelector(".gm-read");

  const G = { el: null, t: null, kind: "html", tool: null, pop: null, popSeq: 0, editing: null, raf: 0, pointer: { x: 0, y: 0 }, nudgeSeq: 0, lastNudge: 0 };
  const newSession = () => ({ id: null, mod: null, history: [], future: [], preview: [], lastJs: "", chain: Promise.resolve(), saveTimer: 0 });
  let GS = newSession();

  // ---- picking into open shadow roots
  function deepAt(x, y) {
    let el = document.elementFromPoint(x, y);
    for (let i = 0; el && el !== hostEl && el.shadowRoot && i < 8; i++) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  // ---- stable targets: { sel, shadow? } that find the element again after reloads
  const unique = (scope, s, el) => { try { const l = scope.querySelectorAll(s); return l.length === 1 && l[0] === el; } catch { return false; } };
  function pathIn(el, scope) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      parts.unshift(segment(n).s);
      const s = parts.join(" > ");
      if (unique(scope, s, el)) return s;
    }
    const exact = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const sibs = n.parentElement ? [...n.parentElement.children] : [...(n.parentNode?.children || [n])];
      exact.unshift(`${n.localName}:nth-child(${sibs.indexOf(n) + 1})`);
      if (n.parentElement === document.body || !n.parentElement) break;
    }
    return (scope === document && el !== document.body ? "body > " : "") + exact.join(" > ");
  }
  function localSel(el, scope) {
    const dup = el.closest?.("[data-morse-dup]");
    if (dup) {
      const key = `[data-morse-dup="${dup.getAttribute("data-morse-dup")}"]`;
      if (dup === el) return key;
      const rel = [];
      for (let n = el; n && n !== dup; n = n.parentElement) rel.unshift(`${n.localName}:nth-child(${[...n.parentElement.children].indexOf(n) + 1})`);
      return `${key} > ${rel.join(" > ")}`;
    }
    if (scope === document) {
      const s = selectorFor(el);
      if (unique(document, s, el)) return s;
    }
    return pathIn(el, scope);
  }
  function targetOf(el) {
    let scope = el.getRootNode();
    const sel = localSel(el, scope), shadow = [];
    while (scope instanceof ShadowRoot) {
      const host = scope.host;
      scope = host.getRootNode();
      shadow.unshift(localSel(host, scope));
    }
    return shadow.length ? { sel, shadow } : { sel };
  }
  function find(t) {
    let scope = document;
    for (const h of t.shadow || []) { scope = scope.querySelector(h)?.shadowRoot; if (!scope) return null; }
    try { return scope.querySelector(t.sel); } catch { return null; }
  }
  const tgt = () => ({ sel: G.t.sel, ...(G.t.shadow ? { shadow: G.t.shadow } : {}) });
  const sameTarget = (e, t) => e.sel === t.sel && JSON.stringify(e.shadow || null) === JSON.stringify(t.shadow || null);
  // The toolbar's short name for the selection: what kind of thing it is.
  function shortName(el) {
    const r = roleWord(el) || (el.children.length ? "section" : "text");
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  function kindOf(el) {
    if (el.matches("iframe, frame, embed, object")) return "frame";
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) return "svg";
    return "html";
  }
  // CSS px -> screen px for the element's parent space (transformed ancestors, zoom, SVG).
  function scaleOf(el) {
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
      const m = el.parentNode?.getScreenCTM?.();
      if (m) return { x: Math.hypot(m.a, m.b) || 1, y: Math.hypot(m.c, m.d) || 1 };
    }
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (!p.offsetWidth || !p.offsetHeight) continue;
      const r = p.getBoundingClientRect();
      return { x: r.width / p.offsetWidth || 1, y: r.height / p.offsetHeight || 1 };
    }
    return { x: 1, y: 1 };
  }

  // ---- session: history of committed edit groups, compiled and saved as one mod
  const allEdits = (s = GS) => s.history.flatMap(h => h.edits);
  function commit(edits, key) {
    const last = GS.history[GS.history.length - 1];
    if (key && last && last.key === key) last.edits = edits;
    else GS.history.push({ edits, key });
    GS.future = [];
    GS.preview = [];
    return apply();
  }
  function preview(edits) { GS.preview = edits; apply(); }
  function apply() {
    if (!GS.id) GS.id = uid();
    const s = GS;
    const { css, js } = compileEdits(allEdits(s).concat(s.preview));
    setCss(s.id, css);
    syncButtons();
    if (s.preview.length) return s.chain;
    s.chain = s.chain.then(async () => {
      if (js === s.lastJs) return;
      s.lastJs = js;
      const r = js ? await call("exec", { modId: s.id, js }) : await call("off", { modId: s.id });
      if (js && r && !r.ok) toast(`Couldn't make that edit (${plainError(r.error)}). Press ${MOD}Z to undo it.`);
      relink();
    }).catch(e => console.warn("[morse] god mode", e));
    clearTimeout(s.saveTimer);
    s.saveTimer = setTimeout(() => { s.chain = s.chain.then(() => persist(s)).catch(e => toast(`Couldn't save your edits. ${plainError(e)}`)); }, 250);
    return s.chain;
  }
  async function persist(s) {
    const edits = allEdits(s);
    if (!edits.length) {
      if (s.mod) {
        await call("mods.delete", { modId: s.id });
        S.mods = S.mods.filter(m => m.id !== s.id);
        s.mod = null;
      }
      return;
    }
    const { css, js } = compileEdits(edits);
    const prompt = summarizeEdits(edits);
    s.mod = s.mod
      ? await call("mods.save", { mod: { ...s.mod, prompt, css, js, edits, enabled: true, updated: new Date().toISOString() } })
      : await call("mods.save", { draft: { id: s.id, title: EDIT_TITLE, prompt, css, js, url: location.href, app: S.app, kind: "manual", edits } });
    const i = S.mods.findIndex(m => m.id === s.id);
    if (i >= 0) S.mods[i] = s.mod; else S.mods.push(s.mod);
  }
  function undo() {
    finishTool();
    const h = GS.history.pop();
    if (!h) return toast("Nothing to undo");
    GS.future.push(h);
    apply();
    toast(`Undone: ${describeEdit(h.edits[0])}`);
  }
  function redo() {
    finishTool();
    const h = GS.future.pop();
    if (!h) return toast("Nothing to redo");
    GS.history.push(h);
    apply();
    toast(`Redone: ${describeEdit(h.edits[0])}`);
  }
  // Re-running mod JS recreates duplicates and apps re-render: find the selection again.
  function relink() {
    if (!G.el || G.el.isConnected) return;
    const el = find(G.t);
    if (el) { G.el = el; if (S.target && !S.target.isConnected) S.target = el; }
    else deselect();
  }
  function currentMove() {
    const prev = allEdits().filter(e => e.op === "move" && sameTarget(e, G.t)).pop();
    if (prev) return { x: prev.x || 0, y: prev.y || 0, base: prev.base, inline: prev.inline };
    const cs = getComputedStyle(G.el), base = cs.transform;
    // transforms don't apply to inline boxes (links, spans): those move as inline-block
    const inline = G.kind === "html" && cs.display === "inline" ? true : undefined;
    return { x: 0, y: 0, base: base && base !== "none" ? base : undefined, inline };
  }

  // ---- selection and placement
  function select(el) {
    finishTool();
    closePop();
    G.el = el || null;
    if (!el) { hideUi(); return; }
    G.t = targetOf(el);
    G.t.label = describe(el);
    G.kind = kindOf(el);
    hostEl.setAttribute("data-gm", "");
    tag.textContent = shortName(el);
    tag.title = G.t.label;
    tag.dataset.sel = `${G.t.shadow ? G.t.shadow.join(" ⟩ ") + " ⟩ " : ""}${G.t.sel}`; // for tests and debugging
    for (const b of tb.querySelectorAll("button[data-t]")) b.disabled = G.kind === "frame" && INSIDE.has(b.dataset.t);
    note.hidden = G.kind !== "frame";
    if (G.kind === "frame") {
      let from = "";
      const src = el.getAttribute("src") || el.getAttribute("data");
      try { if (src) from = new URL(src, location.href).host; } catch {}
      note.innerHTML = `${icon("frame")}<span><b>This part is another page${from ? ` from ${esc(from)}` : ""}.</b> Morse can hide, move or resize it, but can't edit what's inside.</span>`;
    }
    syncButtons();
    wrap.hidden = false;
    // Keep pointing: clicking anything else selects it instead.
    S.picking = true;
    // Typing describes a change (the main interaction); the tools are one
    // shortcut away so a sentence starting with "m" never triggers Move.
    hint.innerHTML = `Describe a change · <kbd>${PLATFORM === "mac" ? "⌘" : "Ctrl+"}E</kbd> for edit tools · <kbd>Esc</kbd> to close`;
    // A toolbar action that changes the selection (duplicate, Alt+↑/↓) keeps the toolbar focused.
    if (G.keepTb) { G.keepTb = false; tb.focus({ preventScroll: true }); }
    if (!G.raf) G.raf = requestAnimationFrame(loop);
  }
  function deselect() {
    setTarget(null);
    S.picking = true;
    setHint();
  }
  function hideUi() {
    wrap.hidden = true;
    hostEl.removeAttribute("data-gm");
    cancelAnimationFrame(G.raf);
    G.raf = 0;
  }
  function loop() {
    G.raf = 0;
    if (!G.el) return;
    relink();
    if (!G.el) return;
    const show = S.open && S.phase === "idle" && modal.hidden && !bar.hidden;
    wrap.hidden = !show;
    if (show) {
      place();
      if (hoverEl && (hoverEl === G.el || G.tool)) hl.hidden = true;
    }
    G.raf = requestAnimationFrame(loop);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  function place() {
    const r = G.el.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, M = 8;
    const gone = !r.width && !r.height;
    frame.hidden = gone;
    // 1px frame just outside the element, clamped so whole-page elements keep a visible edge
    const fl = Math.round(clamp(r.left - 1, 0, vw - 2)), ft = Math.round(clamp(r.top - 1, 0, vh - 2));
    const fr = Math.round(clamp(r.right + 1, fl + 2, vw)), fb = Math.round(clamp(r.bottom + 1, ft + 2, vh));
    Object.assign(frame.style, { transform: `translate(${fl}px, ${ft}px)`, width: fr - fl + "px", height: fb - ft + "px" });
    read.classList.toggle("in", fb + 32 > vh);

    const tw = tb.offsetWidth, th = tb.offsetHeight;
    const barR = bar.hidden ? null : bar.getBoundingClientRect();
    const left = Math.round(clamp(r.left, M, vw - tw - M));
    const fits = top => top >= M && top + th <= vh - M && !(barR && overlaps({ left, right: left + tw, top, bottom: top + th }, barR));
    let side = "above", top = r.top - th - M;
    if (!fits(top)) { side = "below"; top = r.bottom + M; }
    if (!fits(top)) {
      // tall or whole-page element: pin inside its top edge, clear of the bar
      side = "inside";
      top = clamp(r.top + M, M, vh - th - M);
      if (!fits(top) && barR) top = barR.top > vh / 2 ? clamp(barR.top - th - M, M, vh - th - M) : clamp(barR.bottom + M, M, vh - th - M);
    }
    top = Math.round(top);
    tb.style.transform = `translate(${left}px, ${top}px)`;
    // tooltips open away from the element, unless that runs off screen
    tb.dataset.side = side === "below" || top < 40 ? "below" : "above";

    // note and popover stack on the toolbar's far side from the element when there's room
    let up = top, down = top + th;
    for (const x of [note, pop]) {
      if (x.hidden) continue;
      const h = x.offsetHeight, w = x.offsetWidth;
      let py;
      if (side !== "below" && up - 6 - h >= M) up = py = up - 6 - h;
      else { py = down + 6; down = py + h; }
      x.style.transform = `translate(${Math.round(clamp(left, M, vw - w - M))}px, ${Math.round(clamp(py, M, vh - h - M))}px)`;
    }
  }

  // ---- tools
  function run(t) {
    if (!G.el || (G.kind === "frame" && INSIDE.has(t))) return;
    if (t === "hide") return hide();
    if (t === "move" || t === "resize") return toggleTool(t);
    if (t === "text") return startText();
    if (t === "color" || t === "type") return openPop(t);
    if (t === "dup") return duplicate();
    if (t === "capture") return openPop("capture");
    if (t === "ask") { finishTool(); closePop(); input.focus(); return; }
    if (t === "undo") return undo();
    if (t === "redo") return redo();
  }
  function syncButtons() {
    for (const b of tb.querySelectorAll("button[data-t]")) {
      const t = b.dataset.t;
      if (t === "undo") b.disabled = !GS.history.length;
      else if (t === "redo") b.disabled = !GS.future.length;
      b.setAttribute("aria-pressed", String(t === G.tool || t === G.pop || (t === "text" && !!G.editing)));
    }
  }
  function toggleTool(t) {
    if (G.tool === t) return finishTool();
    finishTool();
    closePop();
    G.tool = t;
    frame.dataset.tool = t;
    S.picking = false;
    hl.hidden = true;
    syncButtons();
  }
  function finishTool() {
    if (G.editing) endText(true);
    if (GS.preview.length) preview([]);
    G.tool = null;
    delete frame.dataset.tool;
    read.hidden = true;
    if (G.el && S.open) S.picking = true;
    syncButtons();
  }

  function hide() {
    const label = G.t.label;
    commit([{ op: "hide", ...tgt(), label }]);
    deselect();
    toast(`Hid ${label}. Press ${MOD}Z to undo.`);
  }

  function readout(text) { read.textContent = text; read.hidden = false; }
  const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
  function drag(e, onMove, onUp) {
    const id = e.pointerId;
    frame.setPointerCapture?.(id);
    const mv = ev => { if (ev.pointerId === id) onMove(ev); };
    const up = ev => {
      if (ev.pointerId !== id) return;
      frame.removeEventListener("pointermove", mv);
      frame.removeEventListener("pointerup", up);
      frame.removeEventListener("pointercancel", up);
      onUp(ev);
    };
    frame.addEventListener("pointermove", mv);
    frame.addEventListener("pointerup", up);
    frame.addEventListener("pointercancel", up);
  }
  function startMove(e) {
    const t = tgt(), label = G.t.label, cur = currentMove(), s = scaleOf(G.el), x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    drag(e, ev => {
      let dx = (ev.clientX - x0) / s.x, dy = (ev.clientY - y0) / s.y;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 2) moved = true;
      const x = Math.round(cur.x + dx), y = Math.round(cur.y + dy);
      preview([{ op: "move", ...t, x, y, base: cur.base, inline: cur.inline, label }]);
      readout(`x ${signed(x)}  y ${signed(y)}`);
    }, () => {
      const p = GS.preview;
      if (moved && p.length) commit(p); else preview([]);
    });
  }
  function nudge(dx, dy) {
    const cur = currentMove(), now = Date.now();
    if (now - G.lastNudge > 1000) G.nudgeSeq++;
    G.lastNudge = now;
    const x = cur.x + dx, y = cur.y + dy;
    commit([{ op: "move", ...tgt(), x, y, base: cur.base, inline: cur.inline, label: G.t.label }], `nudge:${G.nudgeSeq}:${G.t.sel}`);
    readout(`x ${signed(x)}  y ${signed(y)}`);
  }
  function startResize(e, h) {
    const el = G.el, t = tgt(), label = G.t.label, s = scaleOf(el), r0 = el.getBoundingClientRect(), cur = currentMove();
    const cs = getComputedStyle(el), pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
    const inline = cs.display === "inline", flex = !!pcs && /flex/.test(pcs.display);
    const w0 = r0.width / s.x, h0 = r0.height / s.y, x0 = e.clientX, y0 = e.clientY;
    const ex = h.includes("e") ? 1 : h.includes("w") ? -1 : 0, ey = h.includes("s") ? 1 : h.includes("n") ? -1 : 0;
    let moved = false;
    drag(e, ev => {
      const dx = (ev.clientX - x0) / s.x, dy = (ev.clientY - y0) / s.y;
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 2) moved = true;
      let w = w0 + ex * dx, hh = h0 + ey * dy;
      if (ev.shiftKey && ex && ey) { const k = Math.max(w / w0, hh / h0); w = w0 * k; hh = h0 * k; }
      w = Math.max(4, Math.round(w)); hh = Math.max(4, Math.round(hh));
      const size = { op: "resize", ...t, ...(ex ? { w } : {}), ...(ey ? { h: hh } : {}), inline, flex, label };
      preview([size]);
      // keep the opposite edge put, whatever the layout does with the new size
      const r1 = el.getBoundingClientRect();
      let mx = cur.x, my = cur.y;
      if (ex > 0) mx += (r0.left - r1.left) / s.x; else if (ex < 0) mx += (r0.right - r1.right) / s.x;
      if (ey > 0) my += (r0.top - r1.top) / s.y; else if (ey < 0) my += (r0.bottom - r1.bottom) / s.y;
      mx = Math.round(mx); my = Math.round(my);
      if (mx !== cur.x || my !== cur.y) preview([size, { op: "move", ...t, x: mx, y: my, base: cur.base, inline: cur.inline, label }]);
      readout(`${Math.round(r1.width / s.x)} × ${Math.round(r1.height / s.y)}`);
    }, () => {
      const p = GS.preview;
      if (moved && p.length) commit(p); else preview([]);
    });
  }
  frame.addEventListener("pointerdown", e => {
    if (!G.el || e.button !== 0) return;
    const h = e.target.closest?.("i[data-h]")?.dataset.h;
    if (G.tool === "resize" && h) startResize(e, h);
    else if (G.tool === "move") startMove(e);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // Text: edit one run of text in place. The run is wrapped in a temporary
  // plaintext-only span (the app's own node object is put back afterwards);
  // SVG text gets a small field over it instead.
  const runs = el => [...el.childNodes].filter(n => n.nodeType === 3 && n.nodeValue.trim());
  function textNodeIn(el) {
    const all = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeValue.trim() && !n.parentElement?.closest("script, style, noscript, [data-morse-ui]") ? 1 : 3,
    });
    while (w.nextNode()) all.push(w.currentNode);
    if (all.length < 2) return all[0] || null;
    const { x, y } = G.pointer;
    const hit = document.caretRangeFromPoint?.(x, y)?.startContainer;
    if (hit && all.includes(hit)) return hit;
    for (const n of all) {
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return n;
    }
    return all[0];
  }
  function startText() {
    finishTool();
    closePop();
    if (G.el.matches("input, textarea, select")) return toast("Text in a form field can't be edited here. Press A to describe the change instead.");
    const node = textNodeIn(G.el);
    if (!node) return toast("There's no text here to edit");
    const parent = node.parentElement;
    if (parent.closest("[data-morse]") && !parent.closest("[data-morse-dup]")) return toast("That text comes from a mod. Change it in Mods → Edit code.");
    const ed = { node, i: runs(parent).indexOf(node), was: node.nodeValue, target: targetOf(parent), label: describe(parent) };
    const [, before, , after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(ed.was);
    ed.onBlur = () => setTimeout(() => { if (G.editing === ed) endText(true); }, 0);
    if (parent instanceof SVGElement) {
      // SVG text can't host an HTML editor: type in a field over it, previewing live.
      const rg = document.createRange();
      rg.selectNodeContents(node);
      const r = rg.getBoundingClientRect();
      const field = ed.field = document.createElement("input");
      field.className = "gm-svgtext field";
      field.spellcheck = false;
      field.value = ed.was.trim();
      field.style.transform = `translate(${Math.round(r.left - 8)}px, ${Math.round(r.top + r.height / 2 - 16)}px)`;
      field.style.width = `${Math.round(Math.max(120, r.width + 48))}px`;
      field.oninput = () => { node.nodeValue = before + field.value + after; };
      field.addEventListener("focusout", ed.onBlur);
      wrap.append(field);
      ed.read = () => field.value;
    } else {
      const span = ed.span = document.createElement("span");
      span.setAttribute("data-morse-ui", "");
      // !important: page rules aimed at [data-morse-ui] (or at every span) must not hide the text being edited
      span.style.cssText = "display: inline !important; visibility: visible !important; opacity: 1 !important; transform: none !important; outline: none !important; caret-color: currentColor; cursor: text;";
      span.spellcheck = false;
      node.before(span);
      span.append(node);
      span.contentEditable = "plaintext-only";
      span.addEventListener("focusout", ed.onBlur);
      ed.read = () => span.textContent;
    }
    G.editing = ed;
    S.picking = false;
    hl.hidden = true;
    frame.dataset.tool = "text";
    syncButtons();
    if (ed.field) { ed.field.focus({ preventScroll: true }); ed.field.select(); }
    else {
      ed.span.focus({ preventScroll: true });
      const sel = getSelection(), rg = document.createRange();
      rg.selectNodeContents(ed.span);
      sel.removeAllRanges();
      sel.addRange(rg);
    }
    hint.innerHTML = `Type the new text · <kbd>↵</kbd> to save · <kbd>Esc</kbd> to cancel`;
  }
  function endText(ok) {
    const ed = G.editing;
    if (!ed) return;
    G.editing = null;
    const text = ed.read().replace(/\s+/g, " ").trim();
    if (ed.span) { ed.span.removeEventListener("focusout", ed.onBlur); ed.span.replaceWith(ed.node); }
    if (ed.field) { ed.field.removeEventListener("focusout", ed.onBlur); ed.field.remove(); }
    const [, before, , after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(ed.was);
    delete frame.dataset.tool;
    if (ok && text && text !== ed.was.trim()) {
      ed.node.nodeValue = before + text + after; // the mod code keeps it there from now on
      commit([{ op: "text", ...ed.target, i: ed.i, text, was: ed.was.trim(), label: ed.label }]);
    } else {
      ed.node.nodeValue = ed.was;
      syncButtons();
    }
    if (G.el && S.open) {
      S.picking = true;
      tb.focus({ preventScroll: true });
      hint.innerHTML = `Use the edit tools, or describe a change · <kbd>Esc</kbd> to close`;
    }
  }

  async function duplicate() {
    finishTool();
    closePop();
    const key = "d" + uid().slice(0, 7), shadow = G.t.shadow;
    await commit([{ op: "duplicate", ...tgt(), key, label: G.t.label }]);
    const copy = find({ sel: `[data-morse-dup="${key}"]`, shadow });
    if (copy) { G.keepTb = true; setTarget(copy); }
    toast(`Duplicated. Press M to move the copy.`);
  }

  // ---- popovers: color, type (here) and capture (47-capture.js)
  function openPop(kind) {
    if (G.pop === kind) return closePop();
    finishTool();
    closePop();
    G.pop = kind;
    G.popSeq++;
    pop.className = `gm-pop gm-pop-${kind}`;
    pop.hidden = false;
    if (kind === "color") colorPop();
    if (kind === "type") typePop();
    if (kind === "capture") GodCapture.pop(pop, G.el, closePop);
    syncButtons();
    place();
  }
  function closePop() {
    if (!G.pop) return;
    if (GS.preview.length) preview([]);
    const hadFocus = root.activeElement && pop.contains(root.activeElement);
    G.pop = null;
    pop.hidden = true;
    pop.innerHTML = "";
    syncButtons();
    if (hadFocus && G.el && S.open) tb.focus({ preventScroll: true });
  }
  pop.addEventListener("keydown", e => {
    e.stopPropagation(); // typing in our fields is ours, not the page's
    if (e.key === "Escape") { closePop(); tb.focus({ preventScroll: true }); }
  });
  for (const t of ["keyup", "keypress", "input"]) pop.addEventListener(t, e => e.stopPropagation());

  const hex2 = n => Math.round(+n).toString(16).padStart(2, "0");
  function toHex(c) {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || "");
    if (!m) return "";
    if (m[4] !== undefined && +m[4] === 0) return "transparent";
    return `#${hex2(m[1])}${hex2(m[2])}${hex2(m[3])}`;
  }
  const validColor = v => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || v === "transparent";
  function colorPop() {
    const el = G.el, cs = getComputedStyle(el), svg = G.kind === "svg";
    const chans = svg ? [["fill", "Fill"], ["stroke", "Outline"]] : [["color", "Text"], ["background", "Fill"], ["border", "Border"]];
    const noBorder = !svg && !(parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none");
    const gradient = !svg && /gradient/.test(cs.backgroundImage);
    let ch = chans[0][0];
    const current = () => toHex(ch === "color" ? cs.color : ch === "background" ? cs.backgroundColor : ch === "border" ? cs.borderTopColor : cs.getPropertyValue(ch)) || "#000000";
    const propsFor = (c, v) => c === "color" ? { color: v }
      : c === "background" ? { "background-color": v, ...(gradient ? { "background-image": "none" } : {}) }
      : c === "border" ? { "border-color": v, ...(noBorder ? { "border-style": "solid", "border-width": "1px" } : {}) }
      : { [c]: v };
    const edit = v => [{ op: "style", ...tgt(), props: propsFor(ch, v), label: G.t.label }];
    const set = v => { commit(edit(v), `color:${G.popSeq}:${ch}`); paint(v); };
    pop.innerHTML = `
      <div class="seg" role="tablist">${chans.map(([k, l]) => `<button data-ch="${k}" role="tab">${l}</button>`).join("")}</div>
      <div class="gm-sw">${PALETTE.map(c => `<button data-c="${c}" title="${c}" aria-label="${c}"${c === "transparent" ? ' class="none"' : ` style="--c:${c}"`}></button>`).join("")}</div>
      <div class="gm-hex field"><i></i><input spellcheck="false" maxlength="11" pattern="#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|transparent" aria-label="Color code">${globalThis.EyeDropper ? `<button class="ibtn xs" data-a="pick" title="Pick a color from the screen" aria-label="Pick a color from the screen">${icon("drop")}</button>` : ""}</div>`;
    const field = pop.querySelector("input"), dot = pop.querySelector(".gm-hex i");
    const paint = v => {
      field.value = v;
      dot.style.setProperty("--c", v);
      dot.classList.toggle("none", v === "transparent");
      for (const b of pop.querySelectorAll("[data-c]")) b.setAttribute("aria-pressed", String(b.dataset.c === v));
      for (const b of pop.querySelectorAll("[data-ch]")) b.setAttribute("aria-pressed", String(b.dataset.ch === ch));
    };
    paint(current());
    pop.onclick = e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.ch) { ch = b.dataset.ch; G.popSeq++; paint(current()); }
      else if (b.dataset.c) set(b.dataset.c);
      else if (b.dataset.a === "pick") new EyeDropper().open().then(r => set(r.sRGBHex)).catch(() => {});
    };
    field.oninput = () => {
      const v = field.value.trim().toLowerCase().replace(/^([0-9a-f]{3}|[0-9a-f]{6})$/, "#$1");
      if (validColor(v)) { preview(edit(v)); dot.style.setProperty("--c", v); }
    };
    field.onkeydown = e => {
      if (e.key !== "Enter") return;
      const v = field.value.trim().toLowerCase().replace(/^([0-9a-f]{3}|[0-9a-f]{6})$/, "#$1");
      if (validColor(v)) set(v); else field.select();
    };
  }
  function typePop() {
    const cs = getComputedStyle(G.el);
    let size = Math.round(parseFloat(cs.fontSize) || 16), weight = Math.round(+cs.fontWeight / 100) * 100 || 400;
    pop.innerHTML = `
      <div class="gm-field"><label>Size</label>
        <div class="gm-step field"><button class="ibtn xs" data-d="-1" aria-label="Smaller">${icon("minus")}</button><input inputmode="numeric" aria-label="Text size in pixels"><span>px</span><button class="ibtn xs" data-d="1" aria-label="Bigger">${icon("plus")}</button></div></div>
      <input class="gm-range" type="range" min="8" max="72" step="1" aria-label="Text size">
      <div class="gm-field"><label>Weight</label></div>
      <div class="seg gm-weights">${WEIGHTS.map(([w, l]) => `<button data-w="${w}" style="font-weight:${w}" title="${w}">${l}</button>`).join("")}</div>`;
    const field = pop.querySelector(".gm-step input"), range = pop.querySelector(".gm-range");
    const paint = () => {
      field.value = size;
      range.value = clamp(size, 8, 72);
      range.style.setProperty("--p", `${((clamp(size, 8, 72) - 8) / 64) * 100}%`);
      for (const b of pop.querySelectorAll("[data-w]")) b.setAttribute("aria-pressed", String(+b.dataset.w === weight));
    };
    const setSize = v => { size = clamp(Math.round(v), 4, 400); commit([{ op: "style", ...tgt(), props: { "font-size": size + "px" }, label: G.t.label }], `type:${G.popSeq}:size`); paint(); };
    paint();
    pop.onclick = e => {
      const b = e.target.closest("button");
      if (b?.dataset.d) setSize(size + (+b.dataset.d) * (e.shiftKey ? 4 : 1));
      if (b?.dataset.w) { weight = +b.dataset.w; commit([{ op: "style", ...tgt(), props: { "font-weight": String(weight) }, label: G.t.label }], `type:${G.popSeq}:weight`); paint(); }
    };
    range.oninput = () => setSize(+range.value);
    field.onkeydown = e => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); setSize(size + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 4 : 1)); }
      if (e.key === "Enter" && !e.isComposing && +field.value > 0) setSize(+field.value);
    };
  }

  tb.addEventListener("click", e => {
    const b = e.target.closest("button[data-t]");
    if (b && !b.disabled) run(b.dataset.t);
  });

  // ---- keys. Registered before 95-keys.js, so an open tool or popover gets
  // Escape first; with nothing open, Escape closes the bar as usual.
  addEventListener("keydown", e => {
    if (!S.open) return;
    if (e.isComposing || e.keyCode === 229) return; // IME: Enter/Esc belong to the candidate window
    const active = root.activeElement;
    if (G.editing) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); endText(true); }
      else if (e.key === "Escape") { e.preventDefault(); endText(false); }
      else { e.stopPropagation(); return; } // plain typing: keep the app's shortcuts out of it
      e.stopImmediatePropagation();
      return;
    }
    const k = e.key.toLowerCase();
    const primaryKey = PLATFORM === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (primaryKey && !e.altKey && !e.shiftKey && e.code === "KeyE" && G.el && !wrap.hidden) {
      e.preventDefault();
      e.stopImmediatePropagation();
      tb.focus({ preventScroll: true });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === "z" || k === "y")) {
      if (active === input && input.value) return;
      if (S.phase === "result") return; // keep iterating: ⌘Z after a result steps back a version (60-generate.js)
      if (active && active !== input && active.matches?.("input, textarea")) return;
      if (!GS.history.length && !GS.future.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.shiftKey || k === "y") redo(); else undo();
      return;
    }
    if (e.key === "Escape" && (G.pop || G.tool)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      G.pop ? closePop() : finishTool();
      tb.focus({ preventScroll: true });
      return;
    }
    if (!G.el || S.phase !== "idle" || wrap.hidden) return;
    const onTb = active && (active === tb || tb.contains(active) || (pop.contains(active) && !active.matches("input, textarea")));
    if (!onTb) return;
    if (e.key.startsWith("Arrow") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.altKey) {
        const next = e.key === "ArrowUp" ? G.el.parentElement : e.key === "ArrowDown" ? G.el.firstElementChild : null;
        if (next && next !== document.documentElement && !next.closest("[data-morse-ui]")) { G.keepTb = true; setTarget(next); }
        return;
      }
      if (G.tool !== "move") toggleTool("move");
      const step = e.shiftKey ? 10 : 1;
      nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = k === "c" && e.shiftKey ? "capture" : KEYS[k];
    if (t) {
      e.preventDefault();
      e.stopImmediatePropagation();
      run(t);
      return;
    }
    // Anything else typed goes to the bar: "just start typing" asks Morse.
    if (e.key.length === 1) { e.stopPropagation(); input.focus(); }
  }, true);

  addEventListener("pointermove", e => { G.pointer = { x: e.clientX, y: e.clientY }; }, true);
  // Frames swallow pointer events, so the picker never sees them: highlight a
  // frame when the pointer enters it, and select it when a click inside it
  // takes focus away from this page.
  const FRAMES = "iframe, frame, embed, object";
  addEventListener("pointerover", e => {
    if (!S.picking || ours(e) || !e.target.matches?.(FRAMES)) return;
    hoverEl = e.target;
    boxTo(e.target, hl, describe(e.target));
  }, true);
  addEventListener("blur", () => setTimeout(() => {
    const a = document.activeElement;
    if (S.open && S.picking && a && a !== G.el && a.matches?.(FRAMES)) setTarget(a);
  }, 0));
  // Double-click the selection to edit its text.
  addEventListener("dblclick", e => {
    if (!G.el || !S.open || ours(e) || G.editing || !G.el.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (G.kind !== "frame") startText();
  }, true);
  // The bar dodges the pointer while picking; not once something is selected,
  // or when heading for its own controls (page tools, clipboard chips).
  root.addEventListener("mouseenter", e => {
    if (e.target !== bar || !S.picking) return;
    const near = [...bar.querySelectorAll(".gm-qbtn, .gm-clips:not([hidden])")].some(c => {
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left - 24 && e.clientX <= r.right + 24 && e.clientY >= r.top - 24 && e.clientY <= r.bottom + 24;
    });
    const menu = bar.querySelector(".gm-menu");
    if (G.el || near || (menu && !menu.hidden)) e.stopPropagation();
  }, true);

  // Closing the bar ends the session: flush its save and start fresh next time.
  function exit() {
    if (G.editing) endText(true);
    finishTool();
    closePop();
    G.el = null;
    hideUi();
    const s = GS;
    if (s.history.length || s.mod) {
      clearTimeout(s.saveTimer);
      s.chain = s.chain.then(() => persist(s)).catch(e => toast(`Couldn't save your edits. ${plainError(e)}`));
    }
    GS = newSession();
  }
  new MutationObserver(() => { if (bar.hidden) exit(); }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });

  return {
    deepAt, targetOf, find, icon, tip, esc,
    onTarget: select,
    exit,
    // "Reset this page" turns every mod here off, this session's included.
    resetSession() { const s = GS; clearTimeout(s.saveTimer); GS = newSession(); syncButtons(); return s; },
    get session() { return GS; },
    get selected() { return G.el; },
    // The edit-tools shortcut: open the bar if needed, then focus the toolbar
    // when something is selected, or ask the user to point at something.
    focusTools() {
      if (!S.open) openBar();
      if (G.el && !wrap.hidden) tb.focus({ preventScroll: true });
      else hint.innerHTML = `Point at something to edit it directly`;
    },
  };
})();
listeners.add(m => { if (m.type === "godmode.toggle") GodMode.focusTools(); }); // onEvent is defined later in the bundle
