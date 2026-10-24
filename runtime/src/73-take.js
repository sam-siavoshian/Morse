// Take this, Bring here: take a feature from one app or site and bring it
// into another (core/take.js has the words for the model and the matching).
//
// Take   A chip in the bar (and the ⋯ menu). Pointed at something: it is taken
//        at once. Nothing pointed at: Morse watches like Show me once while
//        the person opens the feature (a palette, a menu, a notice) and uses
//        it; Stop takes what opened, with the steps that opened it. What is
//        kept: the markup and styles God mode's Capture reads (47-capture.js,
//        trimmed and redacted like everything the model reads, 20-context.js),
//        the steps, a small picture and where it came from. The model then
//        names it and writes a few plain lines about it (a "generate" with
//        context.take, answered in the Ask format). The host keeps the list
//        (taken.*: core/take-host.js).
// Bring  "Bring here…" in the bar lists what was taken; picking one puts the
//        request in the input. A typed request that names a taken feature
//        ("add the command palette from VS Code") brings it too, and one that
//        names a well-known feature of another app asks the model to build it
//        from what it knows. The change is an ordinary one: Save, Undo, Share,
//        and the mod remembers where it came from ("Taken from VS Code").
// Hooks: 50-bar.js (⋯ menu), 64-show-once.js (watching), 47-capture.js
// (thumbOf), 70-panel.js (takenSectionHtml).

const TakeBring = (() => {
  const st = { list: [], shared: null, card: null, bring: null, used: null, watch: null, describing: new Set() };
  const css = document.createElement("style");
  css.textContent = TAKE_CSS();
  root.append(css);
  const svg = d => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I_TAKE = svg('<path d="M8 2.5v7.5M4.75 6.75 8 10l3.25-3.25"/><path d="M3 12.5h10"/>');
  const I_BRING = svg('<path d="M8 13.5V6M4.75 9.25 8 6l3.25 3.25"/><path d="M3 3.5h10"/>');
  const I_X = svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>');

  // ---- the list, from the host (it may have been taken in another app)
  let loading = null;
  function load() {
    loading ||= call("taken.list").then(r => {
      if (r && Array.isArray(r.items)) { st.list = r.items; st.shared = !!r.shared; }
    }, () => {}).finally(() => { loading = null; placeEntries(); if (!panel.hidden) renderPanel(); });
    return loading;
  }
  const took = r => { if (r && Array.isArray(r.items)) { st.list = r.items; st.shared = !!r.shared; } };

  // ---- names people read
  // A site's name is usually the last part of its title ("net/http - Go Packages"), sometimes the first ("GitHub - …").
  function appName() {
    const meta = document.querySelector('meta[property="og:site_name"], meta[name="application-name"]')?.content?.trim();
    if (S.appName || meta) return (S.appName || meta).slice(0, 40);
    const parts = document.title.split(/\s+[|·•–—-]\s+/).map(s => s.replace(/\s*\bv?\d+(\.\d+)+\b/g, "").trim()).filter(Boolean); // "Node.js v26.1 Documentation": no version
    const named = s => s && s.length <= 32 && /\p{Lu}/u.test(s);
    if (parts.length > 1) for (const s of [parts.at(-1), parts[0]]) if (named(s)) return s;
    return location.host.replace(/^www\./, "") || document.title.slice(0, 40);
  }
  const fromWords = it => t("take.from", { app: it.from?.app || it.from?.host || t("take.otherApp") });
  const picHtml = it => `<span class="tk-pic">${it?.thumb ? `<img src="${esc(it.thumb)}" alt="">` : I_TAKE}</span>`;
  const sharedNote = () => (st.shared ? t("take.shared.yes") : S.mode === "desktop" ? t("take.shared.desktop") : t("take.shared.chrome"));

  // ---- taking
  // Long runs of text are cut: the feature's shape matters, not what it showed.
  const shortText = html => String(html || "").replace(/>([^<]{48,})</g, (m, s) => `>${s.slice(0, 46).trimEnd()}…<`);
  function build(el, steps) {
    const snap = GodCapture.snapshot(el, "");
    const item = {
      id: uid(), name: "", label: snap.label, about: "", from: { app: appName(), host: location.host || "" },
      html: shortText(snap.html), styles: snap.styles, hover: snap.hover, steps: stepsForModel(steps || []).slice(0, 12),
      created: new Date().toISOString(),
    };
    return redact(item); // redact (20-context.js): nothing secret is kept
  }
  async function keep(item) {
    took(await call("taken.put", { item }));
    return st.list.find(i => i.id === item.id) || item;
  }
  async function takeEl(el, steps = []) {
    let item;
    try {
      item = build(el, steps);
      const pic = await GodCapture.thumbOf(el).catch(() => null);
      if (pic) item.thumb = pic;
      item = await keep(item);
    } catch (e) { toast(t("take.failed", { error: plainError(e) })); return null; }
    announce(t("take.say", { name: item.name, app: item.from?.app || "" }));
    explain(item);
    return item;
  }
  // The model names it and says what it does (core/take.js describeMessages).
  // Without a model it keeps the name of what was pointed at.
  async function explain(item) {
    const genId = "take-" + uid();
    let text = "";
    st.describing.add(item.id);
    renderCard();
    const off = onEvent(m => { if (m.genId === genId && m.type === "answer" && m.text) text = m.text; });
    try { await call("generate", { genId, request: "take: describe", context: { take: takenForModel(item), app: S.app, url: location.href, title: document.title, lang: getLanguage() } }); }
    catch {}
    off();
    st.describing.delete(item.id);
    const { name, about } = parseDescription(text);
    if (name || about) { try { item = await keep({ ...item, name: name || item.name, about }); } catch {} }
    if (st.card?.item.id === item.id) st.card.item = item;
    renderCard();
    if (!panel.hidden) renderPanel();
  }

  // ---- watching: the feature opens while Morse watches (Show me once's strip)
  function watch(onto = null) {
    const W = st.watch = { added: new Set(), changed: new Set(), mo: null };
    W.mo = new MutationObserver(recs => {
      if (W.added.size + W.changed.size > 4000) return;
      for (const r of recs) {
        if (r.type === "childList") { for (const n of r.addedNodes) if (n.nodeType === 1) W.added.add(n); }
        else if (r.target.nodeType === 1) W.changed.add(r.target);
      }
    });
    W.mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open", "aria-hidden", "aria-expanded"] });
    const stop = () => { W.mo.disconnect(); if (st.watch === W) st.watch = null; };
    ShowOnce.start({ take: {
      title: onto ? t("take.how") : t("take.this"),
      empty: onto ? t("take.how.empty") : t("take.watch.empty"),
      foot: t("take.watch.foot", { key: caps(comboParts(hotkey("open"), PLATFORM)) }), // Esc belongs to the page here: it closes what was opened
      stopTitle: t("take.watch.stop"),
      say: onto ? t("take.how.empty") : t("take.watch.empty"),
      cancel: stop,
      async done({ steps, els }) {
        stop();
        if (S.open) closeBar(); // the Morse shortcut stops it too; what is open stays open for the picture
        if (onto) {
          let item = onto;
          try { item = await keep({ ...onto, steps: stepsForModel(steps).slice(0, 12) }); } catch (e) { toast(t("take.failed", { error: plainError(e) })); }
          openBar();
          showCard("taken", item);
          if (steps.length) explain(item);
          return;
        }
        const el = shownThing(W, els);
        if (!el) { toast(t("take.nothing")); return; }
        const item = await takeEl(el, steps);
        if (!item) return;
        openBar();
        showCard("taken", item);
      },
    } });
  }
  // What opened while Morse watched: something new or newly shown, not the
  // whole page, preferring what holds the focus (a palette's box), what
  // floats over the page (a menu, a notice), and what the person used last.
  const OVER = /^(dialog|alertdialog|menu|listbox|tooltip|alert|status|combobox|tree|grid)$/;
  function boxOf(el) {
    if (!el?.isConnected || el.nodeType !== 1 || el === document.body || el === document.documentElement || el.closest("[data-morse-ui]")) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return null;
    const cs = getComputedStyle(el);
    return cs.visibility === "hidden" || +cs.opacity === 0 ? null : r;
  }
  function wholeOf(el) {
    const held = el.closest?.("[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=alert],[role=status],dialog,[popover]");
    if (held && boxOf(held)) el = held;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const a = el.getBoundingClientRect(), b = p.getBoundingClientRect();
      if (Math.abs(a.left - b.left) > 6 || Math.abs(a.top - b.top) > 6 || Math.abs(a.right - b.right) > 6 || Math.abs(a.bottom - b.bottom) > 6) break;
      el = p;
    }
    return el;
  }
  function shownThing(W, els = []) {
    const screen = innerWidth * innerHeight, focus = deepActive(), last = els.filter(Boolean).at(-1);
    const seen = new Set(), found = [];
    const consider = n => {
      let el = n;
      while (el && el.nodeType === 1 && !boxOf(el)) el = el.parentElement;
      if (!el) return;
      el = wholeOf(el);
      if (seen.has(el)) return;
      seen.add(el);
      const r = boxOf(el);
      if (!r || r.width * r.height > screen * 0.8) return;
      const cs = getComputedStyle(el);
      let score = Math.min(1, (r.width * r.height) / (screen * 0.08));
      if (focus && focus !== document.body && el.contains(focus)) score += 4;
      if (cs.position === "fixed" || (cs.position === "absolute" && (parseInt(cs.zIndex, 10) || 0) > 0)) score += 2;
      if (OVER.test(el.getAttribute("role") || "") || el.localName === "dialog") score += 2;
      if (last && el.contains(last)) score += 1;
      found.push({ el, score });
    };
    for (const n of [...(W?.added || []), ...(W?.changed || [])].slice(0, 3000)) consider(n);
    if (focus && focus !== document.body && !focus.closest?.("[data-morse-ui]")) consider(focus);
    found.sort((a, b) => b.score - a.score);
    if (found[0]?.score >= 2) return found[0].el;
    const used = last && actionTarget(last);
    return used && boxOf(used) ? wholeOf(used) : found[0]?.el || null;
  }

  // ---- the card in the bar: what was just taken, or what is being brought
  const card = document.createElement("section");
  card.className = "tk-card";
  card.hidden = true;
  bar.prepend(card);
  function showCard(kind, item) {
    st.card = { kind, item };
    renderCard();
    if (kind === "taken") note(t("take.next"), 0);
  }
  // Shown while the bar waits for words; working on, or showing, a result it folds away.
  function syncCard() {
    const show = !!st.card && S.open && S.phase === "idle" && !bar.classList.contains("has-pane");
    card.hidden = !show;
    bar.classList.toggle("has-tk", show);
    return show;
  }
  function renderCard() {
    const c = st.card, it = c?.item;
    if (!syncCard()) return;
    card.classList.toggle("bring", c.kind === "bring");
    card.setAttribute("aria-label", c.kind === "bring" ? t("take.bringing") : t("take.taken"));
    const writing = st.describing.has(it.id);
    card.innerHTML = `${picHtml(it)}
      <div class="tk-meta">
        <span class="eyebrow">${c.kind === "bring" ? t("take.bringing") : t("take.taken")}</span>
        <b>${esc(it.name)}</b><small>${esc(fromWords(it))}</small>
        ${c.kind === "taken" ? `<p class="tk-about${writing ? " busy" : ""}">${writing ? `${radar(12)} ${t("take.writing")}` : esc(it.about || "")}</p>` : ""}
      </div>
      <div class="tk-btns">${c.kind === "bring"
        ? `<button type="button" class="ibtn xs" data-tk="unbring" aria-label="${esc(t("take.notBring"))}" title="${esc(t("take.notBring"))}">${I_X}</button>`
        : `${it.steps?.length ? "" : `<button type="button" class="tbtn" data-tk="how" title="${esc(t("take.how.title"))}">${t("take.how")}</button>`}<button type="button" class="btn" data-tk="done">${t("btn.done")}</button>`}</div>`;
    card.querySelectorAll("img").forEach(i => (i.onerror = () => i.replaceWith(Object.assign(document.createElement("span"), { innerHTML: I_TAKE }))));
  }
  card.addEventListener("click", e => {
    const a = e.target.closest("[data-tk]")?.dataset.tk;
    if (a === "done") { clearCard(); input.focus(); }
    if (a === "how" && st.card) { const it = st.card.item; clearCard(); closeBar(); watch(it); }
    if (a === "unbring") { st.bring = null; clearCard(); setInput(""); input.focus(); }
  });
  function clearCard() {
    if (st.card?.kind === "taken" && hintNote === t("take.next")) { hintNote = ""; setHint(); }
    st.card = null;
    renderCard();
  }
  new MutationObserver(() => {
    if (bar.hidden) { st.bring = null; if (st.card) clearCard(); }
    else if (card.hidden === syncCard()) renderCard(); // shown again: fresh words (the language may have changed)
  }).observe(bar, { attributes: true, attributeFilter: ["hidden", "class"] });
  new MutationObserver(() => { if (!bar.hidden) load(); }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });

  // ---- Bring here…: what was taken, in a list in the bar
  function pickList() {
    if (!S.open) openBar();
    showPane("bring");
    renderPick();
    load().then(() => { if (paneKind === "bring") renderPick(); });
  }
  function renderPick() {
    const items = st.list;
    pane.innerHTML = `<div class="tk-pick">
      <header><b>${t("take.bring.head")}</b><small>${t("take.bring.sub")}</small></header>
      ${items.length ? `<div class="tk-list" role="list">${items.map(it => `<button type="button" class="tk-it" role="listitem" data-tk="pick" data-id="${esc(it.id)}">${picHtml(it)}<span class="tk-meta"><b>${esc(it.name)}</b><small>${esc(fromWords(it))}${relativeTime(it.created) ? ` · ${esc(relativeTime(it.created))}` : ""}</small></span></button>`).join("")}</div>`
        : `<p class="tk-empty">${t("take.bring.empty")}</p>`}
      <p class="tk-note">${esc(sharedNote())}</p></div>`;
    pane.querySelector(".tk-it")?.focus();
  }
  pane.addEventListener("click", e => {
    const b = e.target.closest("[data-tk=pick]");
    if (!b || paneKind !== "bring") return;
    const it = st.list.find(i => i.id === b.dataset.id);
    if (it) bringIt(it);
  });
  pane.addEventListener("keydown", e => {
    if (paneKind !== "bring" || !/^Arrow(Up|Down)$/.test(e.key)) return;
    const items = [...pane.querySelectorAll(".tk-it")], i = items.indexOf(root.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))].focus();
  });
  function bringIt(it) {
    if (!S.open) openBar();
    showPane("");
    st.bring = it;
    showCard("bring", it);
    setInput(t("take.bringAsk", { name: it.name, app: it.from?.app || it.from?.host || t("take.otherApp") }));
    input.focus();
  }

  // ---- ways in: chips beside the suggestions, and the ⋯ menu
  const makeChip = (cls, icon, label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `sug tk-sug ${cls}`;
    b.tabIndex = -1;
    b.addEventListener("click", ev => { ev.stopPropagation(); fn(); });
    b.paint = () => { b.title = title(); b.innerHTML = `${icon}${esc(label())}`; };
    b.paint();
    return b;
  };
  const takeChip = makeChip("tk-take", I_TAKE, () => t("take.this"), () => (S.target ? t("take.this.title") : t("take.watch.title")), () => start());
  const bringChip = makeChip("tk-bring", I_BRING, () => t("take.bring"), () => t("take.bring.title"), () => pickList());
  langSubs.add(() => { takeChip.paint(); bringChip.paint(); });
  function placeEntries() {
    const off = sugEl.hidden || !!ShowOnce.chips() || !!st.bring;
    for (const [b, want] of [[takeChip, !off], [bringChip, !off && !st.card && st.list.length > 0]]) {
      if (!want) { if (b.isConnected) b.remove(); continue; }
      b.paint();
      if (b.isConnected) continue;
      const gallery = sugEl.querySelector(".gl-sug");
      gallery ? gallery.before(b) : sugEl.append(b);
    }
    if (bringChip.isConnected && takeChip.isConnected && bringChip.previousSibling !== takeChip) takeChip.after(bringChip);
  }
  new MutationObserver(placeEntries).observe(sugEl, { attributes: true, attributeFilter: ["hidden"], childList: true });

  function start() {
    if (S.phase !== "idle") return;
    const el = S.target && S.target.isConnected ? S.target : null;
    if (!el) { if (S.open) closeBar(); watch(); return; }
    const was = { open: S.open };
    takeEl(el).then(item => { if (!item) return; if (!S.open || !was.open) openBar(); showCard("taken", item); });
  }

  // ---- what leaves with a request: the feature to bring
  outgoing.push(msg => {
    if (msg.type === "generate" && msg.context && !msg.context.take && !msg.base) {
      const it = st.bring || matchTaken(msg.request, st.list);
      if (it) { msg.context.bring = takenForModel(it); st.used = it; }
      else {
        st.used = null;
        const known = bringAsk(msg.request);
        if (known) msg.context.bring = { known: true, ...known };
      }
      if (st.bring) { st.bring = null; queueMicrotask(clearCard); }
    } else if (msg.type === "mods.save" && msg.draft && st.used && S.draft?.id === msg.draft.id && S.draft.ctx?.bring) {
      msg.draft.from = { app: st.used.from?.app || st.used.from?.host || null, url: null, title: null, taken: st.used.id };
      st.used = null;
    }
    return msg;
  });

  // ---- the Mods panel: Taken from other apps
  function sectionHtml() {
    if (!st.list.length) return "";
    return `<section class="tk-site" aria-label="${esc(t("take.panel"))}">
      <h4>${t("take.panel")}</h4>
      ${st.list.map(it => `<div class="tk-item" data-tk-id="${esc(it.id)}">${picHtml(it)}
        <div class="tk-meta"><b>${esc(it.name)}</b><small>${esc(fromWords(it))}${relativeTime(it.created) ? ` · ${esc(relativeTime(it.created))}` : ""}</small>${it.about ? `<p>${esc(it.about)}</p>` : ""}
        <div class="tk-btns"><button type="button" data-tk="bring">${t("take.panel.bring")}</button><button type="button" data-tk="del">${t("btn.delete")}</button></div></div></div>`).join("")}
      <p class="tk-note">${esc(sharedNote())}</p>
    </section>`;
  }
  panel.addEventListener("click", async e => {
    const b = e.target.closest("[data-tk]");
    const it = b && st.list.find(i => i.id === b.closest("[data-tk-id]")?.dataset.tkId);
    if (!it) return;
    if (b.dataset.tk === "bring") { panel.hidden = true; bringIt(it); }
    if (b.dataset.tk === "del") {
      try { took(await call("taken.remove", { takenId: it.id })); } catch (err) { return toast(plainError(err)); }
      st.list = st.list.filter(i => i.id !== it.id);
      renderPanel();
      toast(t("take.deleted", { name: it.name }));
    }
  });
  new MutationObserver(() => { if (!panel.hidden) load(); }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  return { start, pickList, sectionHtml, get list() { return st.list; } };
})();
function takeMenuItems() { return [{ id: "take", label: t("take.this"), keys: null }, { id: "bring", label: t("take.bring"), keys: null }]; } // 50-bar.js hook
function takeMenu(id) { if (id === "take") TakeBring.start(); if (id === "bring") TakeBring.pickList(); } // 50-bar.js hook
function takenSectionHtml() { return TakeBring.sectionHtml(); } // 70-panel.js hook
