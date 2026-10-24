// Ask and find: understand the app, not just change it. The same bar takes
// questions ("what does this do?", "where do I change my password?"); the
// model decides (core/prompt.js) and core/engine.js streams "answer" events
// instead of CSS. This module:
//   - shows the answer in a card in the bar, with numbered markers on the
//     page for what it points at (62-markers.js),
//   - keeps this page's questions and answers in memory (never saved) and
//     sends them along, so follow-ups work,
//   - adds "Explain this page" to the page tools,
//   - runs "Show me": a walk through the steps where the user does every
//     click. Morse never clicks or types for them.
// Hooks: 10-dom.js (ASK_CSS), 60-generate.js (Ask.handle), outgoing (01-rpc.js).

const Ask = (() => {
  const MAX_TURNS = 6;
  const A = { turns: [], page: "", gen: null, live: null, mode: "", q: "", answer: null, marks: [] };
  const pageKey = () => location.origin + location.pathname + location.search; // a #hash is the same page
  const svg = d => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I_EXPLAIN = '<circle cx="8" cy="8" r="6.25"/><path d="M6.4 6.2a1.7 1.7 0 1 1 2.3 1.6c-.45.18-.7.55-.7 1.05v.4"/><circle cx="8" cy="11.4" r=".35" fill="currentColor"/>';

  const card = document.createElement("section");
  card.className = "ask";
  card.hidden = true;
  tBind(card, "aria-label", "ask.answer");
  bar.insertBefore(card, bar.querySelector(".status"));

  function forgetIfMoved() {
    if (A.page !== pageKey()) { A.page = pageKey(); A.turns = []; }
  }

  // Every request carries this page's earlier Q&A (mods too: "ok, do that").
  outgoing.push(m => {
    if (m.type !== "generate") return;
    forgetIfMoved();
    const ask = {};
    if (A.turns.length) ask.turns = A.turns.slice(-4).map(t => ({ q: t.q, a: t.a, points: t.points }));
    if (A.mode) ask.mode = A.mode;
    if (Object.keys(ask).length) m.context = { ...m.context, ask };
    A.gen = { id: m.genId, q: A.mode === "explain" ? t("ask.explain") : m.request, mode: A.mode };
    A.mode = "";
    A.live = null;
    hide();
  });

  onEvent(msg => {
    if (msg.type !== "answer" || !A.gen || msg.genId !== A.gen.id) return;
    A.live = msg;
    if (S.phase !== "working") return;
    if (!hint.textContent.includes(t("ask.answering"))) hint.innerHTML = `${radar(12)} ${t("ask.answering")}`;
    render(msg, A.gen.q, true);
  });

  // 60-generate.js: called once the model is done. True if it answered.
  function handle(id, res) {
    if (!A.gen || A.gen.id !== id) return false;
    // Stopped or failed: drop any half-written answer; 60-generate.js says why.
    if (!res?.ok || !A.live) { A.gen = A.live = null; hide(); return false; }
    const a = A.live, q = A.gen.q;
    A.live = null;
    A.gen = null;
    setCss(id, "");
    call("clip.cancel").catch(() => {});
    S.draft = null;
    S.phase = "idle";
    bar.classList.remove("done", "err", "working");
    input.disabled = false;
    ticker.textContent = "";
    // The question was about what they pointed at; now the answer points.
    if (S.target) setTarget(null);
    S.picking = false;
    setInput("");
    input.placeholder = t("ask.followUp");
    forgetIfMoved();
    A.turns.push({ q, a: a.text, points: marksOf(a).slice(0, 6).map(({ selector, label }) => ({ selector, label })) });
    A.turns = A.turns.slice(-MAX_TURNS);
    render(a, q, false);
    dodge();
    note(t("ask.answered"), 0);
    // Screen readers hear the answer itself, after the status line.
    setTimeout(() => announce(t("ask.answerSay", { text: card.querySelector(".ask-body")?.innerText || "" })), 400);
    input.focus();
    return true;
  }

  // Points first, then any step not already pointed at, numbered in order,
  // so the model's [1], [2] match the badges.
  function marksOf(a) {
    const out = [];
    for (const p of [...a.points, ...a.steps]) if (!out.some(o => o.selector === p.selector)) out.push({ ...p, n: out.length + 1 });
    return out.slice(0, 9);
  }
  // Why a marked thing has no badge: where it's hiding.
  function whereIs(el) {
    if (!el) return t("ask.notOnPage");
    if (Markers.visible(el)) return "";
    const w = hiddenWhere(el); // 20-context.js
    if (w?.menu) return /menu$/i.test(w.menu) ? t("ask.insideMenuNamed", { menu: w.menu }) : t("ask.insideMenu", { menu: w.menu });
    if (w?.panel) return t("ask.inside", { panel: w.panel });
    return t("ask.notShowing");
  }
  // The bar goes to the top or bottom, whichever covers fewer marked things.
  function dodge() {
    const b = bar.getBoundingClientRect(), h = b.height, M = 28, pad = 14;
    const rects = Markers.items.filter(i => Markers.visible(i.el)).map(i => i.el.getBoundingClientRect());
    const covered = (top, bottom) => rects.filter(r => r.right + pad > b.left && r.left - pad < b.right && r.bottom + pad > top && r.top - pad < bottom).length;
    const atTop = covered(M, M + h), atBottom = covered(innerHeight - M - h, innerHeight - M);
    if (atTop !== atBottom) bar.classList.toggle("top", atTop < atBottom);
  }

  function render(a, q, streaming) {
    A.answer = a;
    A.q = q;
    const marks = marksOf(a);
    const changed = marks.length !== A.marks.length || marks.some((m, i) => m.selector !== A.marks[i]?.selector);
    if (changed) { A.marks = marks; Markers.show(marks); }
    const items = Markers.items;
    const earlier = A.turns.length - (streaming ? 0 : 1);
    card.hidden = false;
    bar.classList.add("has-answer");
    card.classList.toggle("streaming", streaming);
    card.innerHTML = `
      <header class="ask-head">
        <span class="ask-q" title="${esc(q)}">${esc(q)}</span>
        ${earlier > 0 ? `<span class="ask-ctx">${t("ask.follows", { n: earlier })}</span>` : ""}
        ${!streaming ? `<button type="button" class="ask-new" data-ask="forget" title="${esc(t("ask.forget"))}">${t("ask.newTopic")}</button>` : ""}
        <button type="button" class="ask-x" data-ask="close" aria-label="${esc(t("ask.close"))}" title="${esc(t("btn.close"))}">×</button>
      </header>
      <div class="ask-body">${streaming ? withCaret(renderMarkdown(a.text, { refs: marks.length })) : renderMarkdown(a.text, { refs: marks.length })}</div>
      ${marks.length ? `<ol class="ask-marks">${marks.map((m, i) => {
        const where = whereIs(items[i]?.el);
        return `<li><button type="button" data-n="${m.n}" title="${esc(where ? t("ask.notShowingTitle") : t("ask.scrollTo"))}" ${where ? `class="away"` : ""}><span class="ask-n">${m.n}</span><span class="ask-l">${esc(m.label || t("ask.marked"))}</span>${where ? `<small>${esc(where)}</small>` : ""}</button></li>`;
      }).join("")}</ol>` : ""}
      ${!streaming && a.steps.length ? `<footer class="ask-foot">
        <button type="button" class="primary" data-ask="show">${t("ask.showMe")}<small>${t("ask.steps", { n: a.steps.length })}</small></button>
        <span class="ask-tip">${t("ask.tip")}</span>
      </footer>` : ""}`;
  }
  // The caret sits at the end of the last line being written, not under it.
  const CARET = `<span class="ask-caret" aria-hidden="true"></span>`;
  const withCaret = html => (/<\/(p|li)>(<\/[uo]l>)?$/.test(html) ? html.replace(/(<\/(?:p|li)>(?:<\/[uo]l>)?)$/, CARET + "$1") : html + CARET);
  function hide() {
    card.hidden = true;
    card.innerHTML = "";
    bar.classList.remove("has-answer");
    A.marks = [];
    A.answer = null;
    if (!Guide.active) Markers.clear();
  }

  card.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.n) return void Markers.scrollTo(b.dataset.n);
    const act = b.dataset.ask;
    if (act === "close" || act === "forget") { hide(); hintNote = ""; setHint(); input.focus(); }
    if (act === "forget") { A.turns = []; toast(t("ask.forgot")); }
    if (act === "show" && A.answer) Guide.start(A.answer.steps, A.q);
  });
  // Typing a new question replaces the answer's "Answered" note.
  input.addEventListener("input", () => { if (!card.hidden && hintNote === t("ask.answered")) { hintNote = ""; setHint(); } });

  new MutationObserver(() => {
    if (bar.hidden) { hide(); if (input.placeholder === t("ask.followUp")) input.placeholder = PLACEHOLDER(); }
    else if (Guide.active) Guide.stop(); // opening the bar again means moving on
  }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });

  // ---- "Explain this page" in the page tools menu (46-quick.js rebuilds the
  // menu on every open; put the item back each time).
  const toolsMenu = bar.querySelector(".gm-menu");
  if (toolsMenu) {
    const addItem = () => {
      if (toolsMenu.querySelector("[data-ask=explain]")) return;
      const head = toolsMenu.querySelector("header");
      const item = document.createElement("button");
      item.setAttribute("role", "menuitem");
      item.tabIndex = -1;
      item.dataset.ask = "explain";
      item.innerHTML = `${svg(I_EXPLAIN)}<span>${t("ask.explain")}</span><span class="gm-state"></span>`;
      const hr = document.createElement("hr");
      if (head) head.after(item, hr); else toolsMenu.prepend(item, hr);
    };
    new MutationObserver(addItem).observe(toolsMenu, { childList: true });
    toolsMenu.addEventListener("click", e => {
      if (!e.target.closest("[data-ask=explain]")) return;
      GodQuick.close();
      explain();
    });
  }
  // "Why is this greyed out?" needs pointing at a disabled control, but
  // browsers send disabled controls no mouse or click events, only pointer
  // events. Feed those to the picker (40-picker.js).
  const disabledAt = e => (S.picking && !ours(e) && e.target?.closest?.(":disabled")) || null;
  listen("pointermove", e => { if (disabledAt(e)) onMove(e); }, true);
  listen("pointerup", e => {
    const el = disabledAt(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    setTarget(hoverEl && el.contains(hoverEl) ? hoverEl : el);
  }, true);

  function explain() {
    if (!S.open) openBar();
    if (S.phase !== "idle") return;
    if (S.target) setTarget(null);
    A.mode = "explain";
    send(t("ask.explain"));
  }

  return {
    handle, explain,
    get turns() { return A.turns; },
    get open() { return !card.hidden; },
  };
})();

// ---- Show me: one step at a time. The current step's element is marked and
// the user clicks it themselves; Morse waits, then moves on. It never calls
// click(), never types, never submits anything.
const Guide = (() => {
  const box = document.createElement("div");
  box.className = "guide";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  tBind(box, "aria-label", "ask.showMe");
  root.insertBefore(box, bar);
  let G = null, raf = 0;

  function start(steps, q) {
    if (!steps?.length) return;
    G = { steps, q, i: -1, since: 0, hit: -1 };
    closeBar(); // the page is theirs now; the bar would only be in the way
    go(0);
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (!G) return;
    G = null;
    box.hidden = true;
    cancelAnimationFrame(raf);
    raf = 0;
    Markers.clear();
  }
  function go(i) {
    if (!G) return;
    if (i >= G.steps.length) return done();
    G.i = Math.max(0, i);
    G.since = performance.now();
    G.scrolled = false;
    G.hit = -1;
    const s = G.steps[G.i];
    Markers.show([{ n: G.i + 1, selector: s.selector, label: s.label }], { focus: true });
    render();
    // Screen readers hear each step, and how to get there without a mouse.
    const keys = PLATFORM === "mac" ? "Option" : "Alt";
    announce(`${t("ask.stepOf", { i: G.i + 1, n: G.steps.length })}: ${s.label || t("so.step.marked")}. ${G.i === 0 ? t("ask.goFirst", { key: keys }) : t("ask.goNext", { key: keys })}`);
  }
  // Keyboard users go to the step's part of the page; Morse moves focus there, never clicks.
  function goTo() {
    const el = current()?.el;
    if (!el || !Markers.visible(el)) return announce(t("ask.hidden"));
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const FOCUS = "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=''], [contenteditable=true]";
    const to = el.matches(FOCUS) ? el : el.querySelector(FOCUS);
    if (to && !to.disabled) to.focus();
    else announce(t("ask.markedSay", { what: describe(el) }));
  }
  function done() {
    Markers.clear();
    G.done = true;
    box.innerHTML = `<div class="g-row"><span class="g-n g-ok">✓</span><div class="g-text"><b>${t("ask.thatsIt")}</b><small>${esc(G.q)}</small></div><button type="button" data-g="stop" class="g-x" aria-label="${esc(t("btn.close"))}">×</button></div>`;
    box.dataset.place = "";
    const g = G;
    setTimeout(() => { if (G === g) stop(); }, 4000);
  }
  function current() { return G && !G.done ? Markers.items[0] : null; }

  function render() {
    const s = G.steps[G.i], it = current(), seen = it && Markers.visible(it.el);
    const waiting = !seen && performance.now() - G.since > 2500;
    box.innerHTML = `
      <div class="g-row">
        <span class="g-n">${G.i + 1}</span>
        <div class="g-text"><b>${esc(s.label || t("ask.clickMarked"))}</b>
          <small>${waiting ? t("ask.cantSee") : seen ? t("ask.clickIt") : t("ask.looking")}</small></div>
        <button type="button" data-g="stop" class="g-x" aria-label="${esc(t("ask.stopShowing"))}" title="${esc(t("ask.stopTitle"))}">×</button>
      </div>
      <div class="g-foot">
        <span class="g-dots" aria-label="${esc(t("ask.stepOf", { i: G.i + 1, n: G.steps.length }))}">${G.steps.map((_, k) => `<i class="${k < G.i ? "past" : k === G.i ? "now" : ""}"></i>`).join("")}<span>${t("ask.stepOf", { i: G.i + 1, n: G.steps.length })}</span></span>
        ${seen ? `<button type="button" data-g="go" title="${esc(t("ask.goToTitle", { key: PLATFORM === "mac" ? "⌥↓" : "Alt+↓" }))}">${t("ask.goTo")}</button>` : ""}
        <button type="button" data-g="back" ${G.i === 0 ? "disabled" : ""}>${t("ask.back")}</button>
        <button type="button" data-g="skip">${G.i === G.steps.length - 1 ? t("ask.finish") : t("ask.skip")}</button>
      </div>`;
    G.rendered = `${G.i}:${seen}:${waiting}`;
  }

  // Keep the card next to the step, and the step on screen.
  function loop() {
    raf = 0;
    if (!G) return;
    const it = current();
    if (it) {
      const seen = Markers.visible(it.el);
      if (G.rendered !== `${G.i}:${seen}:${!seen && performance.now() - G.since > 2500}`) render();
      if (seen && !G.scrolled) {
        G.scrolled = true;
        const r = it.el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) it.el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      place(seen ? it.el : null);
    }
    raf = requestAnimationFrame(loop);
  }
  // Beside the step, clear of the menu or list it sits in (so the user can
  // still see the other choices): left/right of a tall menu, else below/above.
  const GROUP = "[role=menu],[role=listbox],[role=tablist],[role=toolbar],menu,ul,ol,nav";
  function place(el) {
    const w = box.offsetWidth || 340, h = box.offsetHeight || 96, M = 12, E = 8, vw = innerWidth, vh = innerHeight;
    const r = el?.getBoundingClientRect();
    let x = (vw - w) / 2, y = vh - h - 28, where = "";
    if (r && r.bottom > 0 && r.top < vh) {
      let g = r, tall = false;
      const grp = el.parentElement?.closest(GROUP);
      if (grp) {
        const gr = grp.getBoundingClientRect();
        if (gr.width * gr.height < vw * vh * 0.3) { g = gr; tall = /menu|listbox/.test(grp.getAttribute("role") || grp.localName) || gr.height > gr.width; }
      }
      const cx = r.left + r.width / 2 - w / 2, cy = r.top + r.height / 2 - h / 2;
      const spots = {
        below: [cx, g.bottom + M, g.bottom + M + h < vh - E],
        above: [cx, g.top - M - h, g.top - M - h > E],
        left: [g.left - M - w, cy, g.left - M - w > E],
        right: [g.right + M, cy, g.right + M + w < vw - E],
      };
      const order = tall ? ["left", "right", "below", "above"] : ["below", "above", "right", "left"];
      where = order.find(k => spots[k][2]) || "below";
      [x, y] = spots[where];
    }
    box.dataset.place = where;
    x = Math.max(E, Math.min(vw - w - E, x));
    y = Math.max(E, Math.min(vh - h - E, y));
    box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    box.hidden = false;
  }

  box.addEventListener("click", e => {
    const a = e.target.closest("button")?.dataset.g;
    if (a === "stop") stop();
    if (a === "back") go(G.i - 1);
    if (a === "skip") go(G.i + 1);
    if (a === "go") goTo();
  });
  // The user's own click on the marked element moves to the next step. Some
  // menus act on pointerup and vanish before the click, so either counts.
  function hit(e) {
    const it = current();
    if (!it || !it.el || G.hit === G.i || !e.composedPath().includes(it.el)) return;
    G.hit = G.i;
    const at = G.i;
    setTimeout(() => { if (G && G.i === at) go(at + 1); }, 220); // let the page react first
  }
  listen("click", hit, true);
  listen("pointerup", hit, true);
  listen("keydown", e => {
    if (!e.isTrusted || !G || S.open || !panel.hidden || !modal.hidden) return;
    if (matchCombo(e, KEYPICK_COMBO) && !G.done) { e.preventDefault(); e.stopImmediatePropagation(); goTo(); return; } // 41-keypick.js's keys
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stop();
    announce(t("ask.stopped"));
  }, true);

  return { start, stop, get active() { return !!G; }, get step() { return G ? G.i : -1; } };
})();
