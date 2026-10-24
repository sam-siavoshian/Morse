/* Morse runtime: the part that lives inside the app being customized.
 *
 * It is host-agnostic. Before it loads, the host defines
 * globalThis.__morseHost = { send(msg), onMessage(fn) }:
 *   - the browser extension (content script <-> service worker)
 *   - the desktop connector (CDP binding <-> Node daemon), for Electron apps
 *
 * UI lives in a closed shadow root so the app's CSS can't touch it and ours
 * can't leak out. */
(() => {
  if (globalThis.__morseRuntime) return;
  const host = globalThis.__morseHost;
  if (!host) return;
  globalThis.__morseRuntime = true;

  // ---------------------------------------------------------------- rpc
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  host.onMessage(msg => {
    if (msg.reply != null && pending.has(msg.reply)) {
      const { resolve, reject } = pending.get(msg.reply);
      pending.delete(msg.reply);
      msg.error ? reject(new Error(msg.error)) : resolve(msg.result);
    } else listeners.forEach(fn => fn(msg));
  });
  const call = (type, payload = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    host.send({ id, type, ...payload });
  });

  // ---------------------------------------------------------------- state
  const S = {
    open: false, picking: false, target: null, phase: "idle",
    draft: null, before: null, after: null, label: "", mode: "", app: null,
    mods: [], url: location.href,
  };
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const HOTKEY = isMac ? "⌥ Space" : "Alt+Space";

  // ---------------------------------------------------------------- dom
  const hostEl = document.createElement("div");
  hostEl.setAttribute("data-morse-ui", "");
  hostEl.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  let DEBUG = false;
  try { DEBUG = !!localStorage.getItem("morse:debug"); } catch {}
  const root = hostEl.attachShadow({ mode: DEBUG ? "open" : "closed" });
  root.innerHTML = `<style>${CSS()}</style>
    <canvas class="fx"></canvas>
    <div class="hl" hidden><span></span></div>
    <div class="sel" hidden></div>
    <div class="bar" hidden>
      <div class="row">
        <div class="logo">${"<i></i>".repeat(9)}</div>
        <div class="chip target" hidden><span></span><button class="x" title="Clear target">×</button></div>
        <input class="in" placeholder="Describe a change…" spellcheck="false" autocomplete="off">
        <button class="go" title="Morse (Enter)">↵</button>
      </div>
      <div class="status">
        <span class="hint"></span>
        <span class="ticker"></span>
        <span class="actions"></span>
      </div>
    </div>
    <aside class="panel" hidden></aside>
    <div class="modal" hidden></div>
    <div class="toast" hidden></div>`;
  const $ = s => root.querySelector(s);
  const fx = $(".fx"), hl = $(".hl"), selBox = $(".sel"), bar = $(".bar"), input = $(".in");
  const chip = $(".chip.target"), hint = $(".hint"), ticker = $(".ticker"), actions = $(".actions");
  const panel = $(".panel"), modal = $(".modal"), toastEl = $(".toast"), logo = $(".logo");

  function mount() { if (!hostEl.isConnected) document.documentElement.append(hostEl); }
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true });

  // ---------------------------------------------------------------- context
  const HASHED = /^(css|sc|jsx|emotion|styled|svelte|chakra|mui)-|^_?[a-z0-9]{5,}$|[A-Z][a-z]+_[a-z]+__[a-zA-Z0-9]{5}/;
  const looksHashed = s => /\d/.test(s) && /[a-z]/i.test(s) && HASHED.test(s) || /^[a-z]{1,3}[0-9][a-z0-9]{3,}$/i.test(s);
  const cssEsc = s => (globalThis.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"));

  function stableAttr(el) {
    for (const a of ["data-testid", "data-test", "data-qa", "data-id", "aria-label", "name", "role", "placeholder", "title"]) {
      const v = el.getAttribute?.(a);
      if (v && v.length < 60 && !looksHashed(v)) return `[${a}="${cssEsc(v)}"]`;
    }
    return "";
  }
  function segment(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !looksHashed(el.id)) return { s: `#${cssEsc(el.id)}`, anchor: true };
    const attr = stableAttr(el);
    if (attr && !/^\[role=/.test(attr)) return { s: tag + attr, anchor: true };
    const classes = [...el.classList].filter(c => !looksHashed(c)).slice(0, 2).map(c => "." + cssEsc(c)).join("");
    let s = tag + (attr || classes);
    const p = el.parentElement;
    if (p) {
      const same = [...p.children].filter(c => c.tagName === el.tagName);
      if (same.length > 1 && !classes && !attr) s += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return { s, anchor: false };
  }
  function selectorFor(el) {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && n !== document.documentElement && i < 5; n = n.parentElement, i++) {
      const seg = segment(n);
      parts.unshift(seg.s);
      if (seg.anchor) break;
      if (n === document.body) break;
    }
    let sel = parts.join(" > ");
    try { if (document.querySelector(sel) !== el) sel = parts.slice(-3).join(" > "); } catch {}
    return sel;
  }
  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el.innerText || "").trim().split("\n")[0];
    return name ? `${tag} · “${name.slice(0, 28)}${name.length > 28 ? "…" : ""}”` : tag;
  }
  function snippet(el) {
    const clone = el.cloneNode(true);
    const walk = (n, depth) => {
      for (const c of [...n.childNodes]) {
        if (c.nodeType === 3) { if (c.textContent.length > 120) c.textContent = c.textContent.slice(0, 120) + "…"; continue; }
        if (c.nodeType !== 1) { c.remove(); continue; }
        if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(c.tagName) || c.hasAttribute("data-morse-ui")) { c.remove(); continue; }
        if (c.tagName === "svg") { c.innerHTML = ""; }
        for (const a of [...c.attributes]) {
          if (a.name === "style" || a.name.startsWith("on")) c.removeAttribute(a.name);
          else if (a.value.length > 80) c.setAttribute(a.name, a.value.slice(0, 80) + "…");
        }
        if (depth > 4) { c.innerHTML = "…"; continue; }
        walk(c, depth + 1);
      }
      const kids = [...n.children];
      if (kids.length > 12) kids.slice(12).forEach(k => k.remove());
    };
    walk(clone, 0);
    clone.removeAttribute?.("style");
    const html = clone.outerHTML;
    return html.length > 3000 ? html.slice(0, 3000) + "…" : html;
  }
  function outline() {
    const lines = [];
    const q = "header,nav,main,aside,footer,[role=main],[role=navigation],h1,h2,h3,button,[role=button],input,textarea,form";
    for (const el of document.querySelectorAll(q)) {
      if (el.closest("[data-morse-ui]") || !el.getClientRects().length) continue;
      const t = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().split("\n")[0].slice(0, 40);
      lines.push(`${selectorFor(el)}${t ? `  "${t}"` : ""}`);
      if (lines.length >= 40) break;
    }
    return lines.join("\n").slice(0, 1800);
  }
  function context() {
    const cs = getComputedStyle(document.body);
    const ctx = {
      url: location.href, title: document.title, app: S.app,
      theme: { bg: cs.backgroundColor, fg: cs.color, font: cs.fontFamily.split(",")[0] },
      outline: outline(),
    };
    if (S.target && S.target.isConnected) {
      const path = [];
      for (let n = S.target.parentElement, i = 0; n && n !== document.body && i < 5; n = n.parentElement, i++) path.unshift(segment(n).s);
      ctx.target = { selector: selectorFor(S.target), label: describe(S.target), html: snippet(S.target), path: path.join(" > ") };
    }
    return ctx;
  }

  // Small targets (one button) are framed by their component, so the effect
  // and the share-card crop are big enough to see.
  function focusFor(el) {
    let n = el;
    const area = innerWidth * innerHeight;
    while (n.parentElement && n.parentElement !== document.body) {
      const r = n.getBoundingClientRect();
      if (r.width >= 220 || r.height >= 90) break;
      const pr = n.parentElement.getBoundingClientRect();
      if (pr.width * pr.height > area * 0.35) break;
      n = n.parentElement;
    }
    return n;
  }

  // ---------------------------------------------------------------- mods
  function setCss(id, css) {
    let s = document.head.querySelector(`style[data-morse-css="${id}"]`);
    if (!css) { s?.remove(); return; }
    if (!s) { s = document.createElement("style"); s.setAttribute("data-morse-css", id); document.head.append(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  async function applyMod(m) {
    setCss(m.id, m.css);
    if (m.js.trim()) {
      const r = await call("exec", { modId: m.id, js: m.js });
      if (!r.ok) toast(`“${m.title}” failed: ${r.error}`);
    }
  }
  async function removeMod(id) { setCss(id, ""); await call("off", { modId: id }); }
  async function syncMods() {
    const list = await call("mods.list", { url: location.href, app: S.app });
    const prev = new Map(S.mods.map(m => [m.id, m]));
    S.mods = list;
    for (const m of list) {
      const was = prev.get(m.id);
      if (m.enabled && (!was || !was.enabled || was.updated !== m.updated)) await applyMod(m);
      if (!m.enabled && was?.enabled) await removeMod(m.id);
    }
    for (const id of prev.keys()) if (!list.find(m => m.id === id)) await removeMod(id);
    if (!panel.hidden) renderPanel();
  }

  // ---------------------------------------------------------------- picker
  let hoverEl = null;
  function boxTo(el, box, label) {
    if (!el) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    box.hidden = false;
    Object.assign(box.style, { left: r.left - 3 + "px", top: r.top - 3 + "px", width: r.width + 6 + "px", height: r.height + 6 + "px" });
    if (label != null) box.querySelector("span").textContent = label;
  }
  const ours = e => e.composedPath().includes(hostEl);
  function onMove(e) {
    if (!S.picking) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === hostEl || el === document.documentElement) { hoverEl = null; hl.hidden = true; return; }
    hoverEl = el;
    boxTo(el, hl, describe(el));
    placeBar(el.getBoundingClientRect());
  }
  // The bar sits on the opposite half of the screen from what you point at.
  function placeBar(r) {
    const c = (r.top + r.height / 2) / innerHeight;
    if (c > 0.55) bar.classList.add("top");
    else if (c < 0.45) bar.classList.remove("top");
  }
  function swallow(e) { if (S.picking && !ours(e)) { e.preventDefault(); e.stopPropagation(); } }
  function onClick(e) {
    if (!S.picking || ours(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (hoverEl) setTarget(hoverEl);
  }
  let pointerY = innerHeight / 2;
  addEventListener("mousemove", e => { pointerY = e.clientY; }, true);
  addEventListener("mousemove", onMove, true);
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) addEventListener(t, swallow, true);
  addEventListener("click", onClick, true);
  addEventListener("scroll", () => { if (S.target) boxTo(S.target, selBox); }, true);

  function setTarget(el) {
    S.target = el;
    S.picking = false;
    hl.hidden = true;
    root.host.style.cursor = "";
    if (el) {
      boxTo(el, selBox);
      placeBar(el.getBoundingClientRect());
      chip.hidden = false;
      chip.querySelector("span").textContent = describe(el);
    } else { selBox.hidden = true; chip.hidden = true; }
    setHint();
    input.focus();
  }
  chip.querySelector(".x").onclick = () => { setTarget(null); startPicking(); };

  // ---------------------------------------------------------------- bar
  function setHint() {
    if (S.phase !== "idle") return;
    hint.innerHTML = S.picking
      ? `<b>Point</b> at anything to change it · or just describe it · <kbd>Esc</kbd> to close`
      : S.target ? `Describe what to change about this · <kbd>Enter</kbd>` : `Describe a change to this page · <kbd>Enter</kbd>`;
    ticker.textContent = "";
    actions.innerHTML = `<button data-a="mods">Mods${S.mods.length ? ` <em>${S.mods.length}</em>` : ""}</button><span class="model">${esc(S.label)}</span>`;
  }
  function startPicking() { S.picking = true; setHint(); }
  function openBar() {
    if (S.phase === "working") return;
    S.open = true;
    S.phase = "idle";
    bar.hidden = false;
    bar.classList.remove("done", "err");
    bar.classList.toggle("top", pointerY > innerHeight * 0.55);
    input.value = "";
    input.disabled = false;
    setTarget(null);
    startPicking();
    requestAnimationFrame(() => input.focus());
    call("clip.start").catch(() => {});
  }
  function closeBar() {
    if (S.phase === "working") return;
    // Dismissing a result keeps it; Undo is always one click away in Mods.
    if (S.phase === "result" && S.draft && !S.draft.saved) { keep(); return; }
    if (S.phase === "idle") call("clip.cancel").catch(() => {});
    S.open = false; S.picking = false;
    bar.hidden = true; hl.hidden = true; selBox.hidden = true;
    S.phase = "idle";
  }
  // While pointing, the bar dodges the cursor so nothing is unreachable.
  bar.addEventListener("mouseenter", () => { if (S.picking && !input.value) bar.classList.toggle("top"); });
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter" && input.value.trim()) submit(input.value.trim());
    if (e.key === "Escape") closeBar();
  });
  for (const t of ["keyup", "keypress", "input"]) input.addEventListener(t, e => e.stopPropagation());
  $(".go").onclick = () => input.value.trim() && submit(input.value.trim());

  actions.addEventListener("click", e => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "mods") openPanel();
    if (a === "keep") keep();
    if (a === "undo") undo();
    if (a === "code") showCode(S.draft);
    if (a === "share") keep().then(m => m && showShare(m));
    if (a === "again") { S.phase = "idle"; bar.classList.remove("err"); input.disabled = false; input.focus(); setHint(); }
  });

  // ---------------------------------------------------------------- morse
  async function capture() {
    const vis = hostEl.style.visibility;
    hostEl.style.visibility = "hidden";
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    let shot = null;
    try { shot = await call("capture"); } catch {}
    hostEl.style.visibility = vis;
    return shot;
  }
  async function submit(request) {
    S.phase = "working";
    S.picking = false;
    hl.hidden = true;
    selBox.hidden = true;
    input.disabled = true;
    bar.classList.add("working");
    const id = uid();
    const ctx = context();
    const focus = S.target ? focusFor(S.target) : null;
    const rect = focus ? focus.getBoundingClientRect() : null;
    const tr = S.target ? S.target.getBoundingClientRect() : null;
    const R = r => r && { x: r.x, y: r.y, w: r.width, h: r.height };
    S.before = { shot: await capture(), rect: R(tr), focus: R(rect), vw: innerWidth, vh: innerHeight };
    S.draft = { id, request, ctx, title: "", css: "", js: "" };
    const t0 = performance.now();
    hint.innerHTML = `<span class="spin"></span> thinking`;
    actions.innerHTML = `<span class="ms">0.0s</span>`;
    const clock = setInterval(() => { const m = actions.querySelector(".ms"); if (m) m.textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s"; }, 100);
    Effect.start(focus);

    const off = onEvent(msg => {
      if (msg.genId !== id) return;
      if (msg.type === "token") { Effect.token(msg.text); tick(msg.text); }
      if (msg.type === "css") setCss(id, msg.css);
      if (msg.type === "phase") {
        if (msg.phase === "fixing") hint.innerHTML = `<span class="spin"></span> fixing: <i>${esc(msg.error).slice(0, 80)}</i>`;
        if (msg.phase === "applying") hint.innerHTML = `<span class="spin"></span> applying`;
        if (msg.phase === "thinking") hint.innerHTML = `<span class="spin"></span> writing code`;
      }
    });
    let res;
    try { res = await call("generate", { genId: id, request, context: ctx }); }
    catch (e) { res = { ok: false, error: e.message }; }
    off();
    clearInterval(clock);
    bar.classList.remove("working");
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    Object.assign(S.draft, { title: res.title || request.slice(0, 40), css: res.css || "", js: res.js || "", secs, attempts: res.attempts, model: S.label });
    setCss(id, S.draft.css);
    await Effect.finish(res.ok);
    if (!res.ok) {
      setCss(id, "");
      S.phase = "error";
      bar.classList.add("err");
      hint.innerHTML = `Couldn't do that: <i>${esc(res.error || "unknown error").slice(0, 120)}</i>`;
      actions.innerHTML = `<button data-a="again">Try again</button>`;
      return;
    }
    if (S.target) boxTo(S.target, selBox);
    selBox.hidden = true;
    S.after = { shot: await capture(), rect: S.target?.isConnected ? R(S.target.getBoundingClientRect()) : null, focus: focus?.isConnected ? R(focus.getBoundingClientRect()) : null };
    call("clip.stop", { modId: id }).then(c => { if (c) S.draft.clip = c; }).catch(() => {});
    S.phase = "result";
    bar.classList.add("done");
    hint.innerHTML = `<b class="ok">✓ ${esc(S.draft.title)}</b> <span class="dim">· ${secs}s${res.attempts > 1 ? " · fixed itself once" : ""}</span>`;
    ticker.textContent = "";
    actions.innerHTML = `<button data-a="keep" class="primary">Keep <kbd>↵</kbd></button><button data-a="undo">Undo</button><button data-a="code">Code</button><button data-a="share">Share</button>`;
    actions.querySelector("[data-a=keep]").focus();
  }
  const onEvent = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  let tickBuf = "";
  function tick(t) {
    tickBuf = (tickBuf + t).replace(/\s+/g, " ").slice(-64);
    ticker.textContent = tickBuf;
  }

  async function keep() {
    const d = S.draft;
    if (!d) return null;
    if (d.saved) return d.saved;
    const mod = await call("mods.save", { draft: { id: d.id, title: d.title, prompt: d.request, css: d.css, js: d.js, url: location.href, app: S.app, target: d.ctx.target, model: d.model } });
    d.saved = mod;
    S.mods.push(mod);
    S.phase = "idle";
    closeBar();
    toast(`Saved “${mod.title}” · it'll be here next time`);
    return mod;
  }
  async function undo() {
    if (!S.draft) return;
    await removeMod(S.draft.id);
    S.draft = null;
    closeBar();
    toast("Undone");
  }

  // ---------------------------------------------------------------- panel
  async function openPanel() {
    closeBar();
    panel.hidden = false;
    await syncMods().catch(() => {});
    renderPanel();
  }
  function renderPanel() {
    const where = S.appName || location.host || "this page";
    panel.innerHTML = `
      <header><div class="logo sm">${"<i></i>".repeat(9)}</div><div><b>Mods</b><small>${esc(where)}</small></div><button data-a="close" title="Close">×</button></header>
      <div class="list">${S.mods.length ? S.mods.map(m => `
        <article data-id="${m.id}" class="${m.enabled ? "" : "off"}">
          <label class="sw"><input type="checkbox" data-a="toggle" ${m.enabled ? "checked" : ""}><span></span></label>
          <div class="meta"><b>${esc(m.title)}</b><small>“${esc(m.prompt)}”</small>
            <div class="tags">${m.css.trim() ? "<span>css</span>" : ""}${m.js.trim() ? "<span>js</span>" : ""}${m.target ? `<span>${esc(m.target.label || "")}</span>` : "<span>page</span>"}</div>
          </div>
          <div class="btns"><button data-a="share" title="Share">Share</button><button data-a="code" title="Edit code">Code</button><button data-a="del" title="Delete">Delete</button></div>
        </article>`).join("") : `<p class="empty">No mods here yet.<br>Press <kbd>${HOTKEY}</kbd>, point at something, and say what you want.</p>`}
      </div>
      <footer><button data-a="import">Import mod…</button><span>${esc(S.label)}</span></footer>`;
  }
  panel.addEventListener("click", async e => {
    const btn = e.target.closest("[data-a]");
    if (!btn) return;
    const a = btn.dataset.a;
    const m = S.mods.find(x => x.id === btn.closest("article")?.dataset.id);
    if (a === "close") panel.hidden = true;
    if (a === "toggle" && m) {
      m.enabled = btn.checked;
      await call("mods.save", { mod: m });
      m.enabled ? await applyMod(m) : await removeMod(m.id);
      renderPanel();
    }
    if (a === "del" && m) {
      await removeMod(m.id);
      await call("mods.delete", { modId: m.id });
      S.mods = S.mods.filter(x => x !== m);
      renderPanel();
    }
    if (a === "code" && m) showCode(m);
    if (a === "share" && m) showShare(m);
    if (a === "import") showImport();
  });

  // ---------------------------------------------------------------- modals
  function openModal(html) {
    modal.innerHTML = `<div class="card">${html}</div>`;
    modal.hidden = false;
    modal.onclick = e => { if (e.target === modal || e.target.closest("[data-a=close]")) modal.hidden = true; };
    modal.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") modal.hidden = true; });
  }
  function showCode(m) {
    if (!m) return;
    const saved = S.mods.find(x => x.id === m.id);
    openModal(`
      <header><b>${esc(m.title)}</b><small>“${esc(m.prompt || m.request)}”</small><button data-a="close">×</button></header>
      <label>CSS</label><textarea class="code" data-k="css" spellcheck="false">${esc(m.css)}</textarea>
      <label>JavaScript <span class="dim">runs with the <code>morse</code> helpers</span></label><textarea class="code" data-k="js" spellcheck="false">${esc(m.js)}</textarea>
      <footer><button data-a="close">Cancel</button><button class="primary" data-a="save">${saved ? "Save & re-run" : "Apply"}</button></footer>`);
    modal.querySelector("[data-a=save]").onclick = async () => {
      const css = modal.querySelector("[data-k=css]").value, js = modal.querySelector("[data-k=js]").value;
      Object.assign(m, { css, js });
      if (saved) { m.updated = new Date().toISOString(); await call("mods.save", { mod: m }); }
      await removeMod(m.id);
      await applyMod({ ...m, title: m.title || "draft" });
      modal.hidden = true;
      toast("Re-applied");
    };
  }
  async function showShare(m) {
    const card = await renderCard(m);
    const link = await call("share", { mod: m, kind: "link" }).catch(() => null);
    openModal(`
      <header><b>Share “${esc(m.title)}”</b><small>Anyone with Morse or a userscript manager can install it.</small><button data-a="close">×</button></header>
      ${card ? `<img class="cardimg" src="${card}" alt="Before and after">` : ""}
      ${link ? `<div class="link"><input readonly value="${esc(link.link)}"><button data-a="copy" class="primary">Copy link</button></div>` : ""}
      <div class="exports">
        ${card ? `<button data-a="png">Card image</button>` : ""}
        ${S.draft?.id === m.id && S.draft.clip ? `<button data-a="clip">Clip (${esc(S.draft.clip.kind)})</button>` : ""}
        <button data-a="json">.morse.json</button>
        <button data-a="user">.user.js for Tampermonkey</button>
        <button data-a="tweet">Post…</button>
      </div>
      <p class="saved dim"></p>`);
    const done = r => { modal.querySelector(".saved").textContent = r?.path ? `Saved to ${r.path}` : "Downloaded"; };
    const slug = m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mod";
    modal.querySelector(".exports").onclick = async e => {
      const a = e.target.closest("button")?.dataset.a;
      if (a === "png") done(await call("export", { filename: `${slug}.png`, dataUrl: card }));
      if (a === "json") done(await call("share", { mod: m, kind: "json" }));
      if (a === "user") done(await call("share", { mod: m, kind: "userscript" }));
      if (a === "clip") done(S.draft.clip);
      if (a === "tweet") {
        const text = `I added “${m.title}” to ${S.appName || location.host} in one sentence: “${m.prompt}”\n\nMade with Morse`;
        call("open", { url: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link?.link || "")}` });
      }
    };
    const copy = modal.querySelector("[data-a=copy]");
    if (copy) copy.onclick = async () => {
      const f = modal.querySelector(".link input");
      try { await navigator.clipboard.writeText(f.value); } catch { f.select(); document.execCommand?.("copy"); }
      copy.textContent = "Copied ✓";
    };
  }
  function showImport() {
    openModal(`
      <header><b>Import a mod</b><small>Paste a Morse share link or .morse.json contents.</small><button data-a="close">×</button></header>
      <textarea class="code" data-k="src" spellcheck="false" placeholder="https://…/install.html#m=…"></textarea>
      <footer><button data-a="close">Cancel</button><button class="primary" data-a="go">Import</button></footer>`);
    modal.querySelector("[data-a=go]").onclick = async () => {
      try {
        const mod = await call("mods.import", { source: modal.querySelector("[data-k=src]").value, url: location.href, app: S.app });
        modal.hidden = true;
        toast(`Installed “${mod.title}”`);
        await syncMods();
      } catch (e) { toast(e.message); }
    };
  }

  // Before/after share card, 1200x675 (the size X/Twitter shows inline).
  async function renderCard(m) {
    const d = S.draft && S.draft.id === m.id ? S.draft : null;
    if (!d || !S.before?.shot || !S.after?.shot) return null;
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
    const [b, a] = await Promise.all([load(S.before.shot), load(S.after.shot)]);
    if (!b || !a) return null;
    const W = 1200, H = 675, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#0d1117"; g.fillRect(0, 0, W, H);
    // Crop around the change, same crop for both so it reads as a diff. Wide,
    // short components (toolbars, player bars) stack; everything else sits
    // side by side.
    const sx = b.width / S.before.vw, sy = b.height / S.before.vh;
    const f1 = S.before.focus || S.before.rect, f2 = S.after.focus || S.after.rect;
    const wide = f1 && f1.w / f1.h > 2.4;
    const panels = wide
      ? [{ x: 40, y: 200, w: 1120, h: 186 }, { x: 40, y: 420, w: 1120, h: 186 }]
      : [{ x: 40, y: 206, w: 548, h: 400 }, { x: 612, y: 206, w: 548, h: 400 }];
    const ratio = panels[0].w / panels[0].h;
    let crop = { x: 0, y: 0, w: S.before.vw, h: S.before.vh };
    if (f1) {
      const u = f2 ? { x: Math.min(f1.x, f2.x), y: Math.min(f1.y, f2.y), x2: Math.max(f1.x + f1.w, f2.x + f2.w), y2: Math.max(f1.y + f1.h, f2.y + f2.h) } : { x: f1.x, y: f1.y, x2: f1.x + f1.w, y2: f1.y + f1.h };
      const pad = wide ? 28 : 50;
      let w = Math.max(u.x2 - u.x + pad * 2, wide ? 320 : 360), h = Math.max(u.y2 - u.y + pad * 2, wide ? 60 : 260);
      if (w / h > ratio) h = w / ratio; else w = h * ratio;
      if (w > S.before.vw) { w = S.before.vw; h = w / ratio; }
      if (h > S.before.vh) { h = S.before.vh; w = h * ratio; }
      const cx = (u.x + u.x2) / 2, cy = (u.y + u.y2) / 2;
      crop = { x: Math.max(0, Math.min(S.before.vw - w, cx - w / 2)), y: Math.max(0, Math.min(S.before.vh - h, cy - h / 2)), w, h };
    }
    const draw = (img, P, label, accent, mark) => {
      g.save();
      roundRect(g, P.x, P.y, P.w, P.h, 14); g.clip();
      g.fillStyle = "#161b22"; g.fillRect(P.x, P.y, P.w, P.h);
      const s = Math.min(P.w / crop.w, P.h / crop.h);
      const dw = crop.w * s, dh = crop.h * s;
      const ox = P.x + (P.w - dw) / 2, oy = P.y + (P.h - dh) / 2;
      g.drawImage(img, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, ox, oy, dw, dh);
      if (mark) {
        // outline what changed
        g.strokeStyle = "rgba(57,211,83,.9)"; g.lineWidth = 2; g.setLineDash([6, 4]);
        roundRect(g, ox + (mark.x - crop.x) * s - 4, oy + (mark.y - crop.y) * s - 4, mark.w * s + 8, mark.h * s + 8, 8); g.stroke();
        g.setLineDash([]);
      }
      g.restore();
      g.strokeStyle = accent; g.lineWidth = 2; roundRect(g, P.x, P.y, P.w, P.h, 14); g.stroke();
      g.fillStyle = accent; g.font = "700 13px ui-monospace, Menlo, monospace";
      g.fillText(label, P.x + 2, P.y - 10);
    };
    draw(b, panels[0], "BEFORE", "#484f58");
    draw(a, panels[1], "AFTER", "#39d353", S.after.focus);
    g.fillStyle = "#e6edf3"; g.font = "600 34px ui-sans-serif, system-ui, sans-serif";
    g.font = "600 34px ui-sans-serif, system-ui, sans-serif";
    const oneLine = g.measureText(`“${m.prompt}”`).width <= W - 80;
    wrap(g, `“${m.prompt}”`, 40, oneLine ? 92 : 70, W - 80, 42, 2);
    g.fillStyle = "#8b949e"; g.font = "500 17px ui-sans-serif, system-ui, sans-serif";
    g.fillText(`${S.appName || location.host} · ${d.secs}s · ${S.label.split(" · ")[0]}`, 40, oneLine ? 136 : 154);
    // wordmark
    const lx = W - 168, ly = 632;
    for (let i = 0; i < 9; i++) { g.fillStyle = ["#0e4429", "#26a641", "#39d353", "#006d32", "#39d353", "#26a641", "#39d353", "#006d32", "#0e4429"][i]; g.fillRect(lx + (i % 3) * 9, ly + Math.floor(i / 3) * 9, 7, 7); }
    g.fillStyle = "#e6edf3"; g.font = "700 22px ui-sans-serif, system-ui, sans-serif"; g.fillText("morse", lx + 36, ly + 22);
    g.fillStyle = "#8b949e"; g.font = "500 15px ui-sans-serif, system-ui, sans-serif"; g.fillText("customize any app in one sentence", 40, ly + 20);
    return c.toDataURL("image/png");
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function wrap(g, text, x, y, maxW, lh, maxLines) {
    const words = text.split(" "); let line = "", n = 0;
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (g.measureText(t).width > maxW && line) { g.fillText(n === maxLines - 1 ? line + "…" : line, x, y); y += lh; line = w; if (++n >= maxLines) return; }
      else line = t;
    }
    g.fillText(line, x, y);
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (toastEl.hidden = true), 2800);
  }

  // ---------------------------------------------------------------- effect
  // The "it's working" moment: the target dissolves into a contribution-graph
  // grid that shimmers, the model's tokens rain through it as glyphs, then the
  // grid sweeps away to reveal the changed UI.
  const Effect = (() => {
    const g = fx.getContext("2d");
    const PAL = ["#0e4429", "#006d32", "#26a641", "#39d353", "#7ee787"];
    const CELL = 10, SQ = 8;
    let target = null, running = false, mode = "thinking", rect = null, cols = 0, rows = 0, cells = [], cursor = 0;
    let t0 = 0, sweep0 = 0, sweepResolve = null, ok = true, frame = 0;

    function layout() {
      const r = target && target.isConnected ? target.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      const pad = target ? 6 : 0;
      const nr = { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), w: Math.min(innerWidth, r.width + pad * 2), h: Math.min(innerHeight, r.height + pad * 2) };
      if (rect && Math.abs(nr.w - rect.w) < 1 && Math.abs(nr.h - rect.h) < 1 && Math.abs(nr.x - rect.x) < 1 && Math.abs(nr.y - rect.y) < 1) return;
      rect = nr;
      const dpr = devicePixelRatio || 1;
      fx.width = Math.ceil(rect.w * dpr); fx.height = Math.ceil(rect.h * dpr);
      Object.assign(fx.style, { left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px", display: "block" });
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const nc = Math.ceil(rect.w / CELL), nrw = Math.ceil(rect.h / CELL);
      if (nc !== cols || nrw !== rows) {
        cols = nc; rows = nrw;
        cells = Array.from({ length: cols * rows }, (_, i) => ({ glyph: "", ttl: 0, seed: Math.random(), band: !target && isBand(i) }));
      }
    }
    function isBand(i) {
      const x = i % cols, y = Math.floor(i / cols), b = 3;
      return x < b || y < b || x >= cols - b || y >= rows - b;
    }
    function start(el) {
      target = el; rect = null; cols = rows = 0; mode = "thinking"; running = true; ok = true; cursor = 0;
      t0 = performance.now();
      logo.classList.add("live");
      layout();
      requestAnimationFrame(draw);
    }
    function token(text) {
      if (!running) return;
      mode = "streaming";
      for (const ch of text) {
        if (/\s/.test(ch)) { cursor++; continue; }
        // glyphs "type" across the grid like a cursor, with some scatter
        let idx = cursor % cells.length;
        if (!target) { const band = cells.map((c, i) => c.band ? i : -1).filter(i => i >= 0); idx = band[cursor % band.length]; }
        else if (Math.random() < 0.25) idx = Math.floor(Math.random() * cells.length);
        const c = cells[idx];
        if (c) { c.glyph = ch; c.ttl = 1; }
        cursor += 1;
      }
    }
    function finish(success) {
      ok = success;
      mode = "sweep";
      sweep0 = performance.now();
      return new Promise(r => (sweepResolve = r));
    }
    function draw(now) {
      if (!running) return;
      frame++;
      if (frame % 6 === 0) layout();
      const t = (now - t0) / 1000;
      g.clearRect(0, 0, rect.w, rect.h);
      const sweepP = mode === "sweep" ? Math.min(1, (now - sweep0) / 750) : 0;
      if (target && mode !== "sweep") { g.fillStyle = "rgba(1,4,9,0.62)"; roundRectFill(0, 0, rect.w, rect.h, 8); }
      g.font = `700 ${SQ + 1}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      g.textAlign = "center"; g.textBaseline = "middle";
      const diag = cols + rows;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!target && !c.band) { if (c.glyph) c.ttl -= 0.03; continue; }
        const x = i % cols, y = (i / cols) | 0;
        const px = x * CELL + 1, py = y * CELL + 1;
        let alpha, level;
        if (mode === "sweep") {
          const front = sweepP * (diag + 6) - 3;
          const d = (x + y) - front;
          if (d < -3) continue;                  // already revealed
          if (d < 0) { level = 4; alpha = 1 + d / 3; } // the bright leading edge
          else { level = waveLevel(x, y, t, c); alpha = 0.9; }
          if (!ok) level = Math.min(level, 1);
        } else {
          level = waveLevel(x, y, t, c);
          alpha = 0.35 + level * 0.16;
        }
        if (c.ttl > 0 && mode !== "sweep") {
          g.globalAlpha = Math.min(1, c.ttl + 0.2);
          g.fillStyle = "#0d1117"; g.fillRect(px - 1, py - 1, CELL, CELL);
          g.fillStyle = c.ttl > 0.7 ? "#d2ffd8" : PAL[4];
          g.fillText(c.glyph, px + SQ / 2, py + SQ / 2 + 0.5);
          c.ttl -= 0.018;
          continue;
        }
        g.globalAlpha = Math.max(0, alpha);
        g.fillStyle = PAL[level];
        g.fillRect(px, py, SQ, SQ);
      }
      g.globalAlpha = 1;
      if (mode === "sweep" && sweepP >= 1) {
        running = false;
        fx.style.display = "none";
        logo.classList.remove("live");
        if (target && ok) pulse(target);
        sweepResolve?.();
        return;
      }
      requestAnimationFrame(draw);
    }
    function waveLevel(x, y, t, c) {
      const speed = mode === "streaming" ? 5 : 3;
      const w = Math.sin((x + y) * 0.35 - t * speed) * 0.5 + 0.5;
      const n = Math.sin(t * 2.3 + c.seed * 40) * 0.5 + 0.5;
      const v = w * 0.65 + n * 0.35;
      return Math.max(0, Math.min(4, Math.floor(v * 5)));
    }
    function roundRectFill(x, y, w, h, r) { roundRect(g, x, y, w, h, r); g.fill(); }
    function pulse(el) {
      const r = el.getBoundingClientRect();
      const p = document.createElement("div");
      p.className = "pulse";
      Object.assign(p.style, { left: r.left - 4 + "px", top: r.top - 4 + "px", width: r.width + 8 + "px", height: r.height + 8 + "px" });
      root.append(p);
      setTimeout(() => p.remove(), 900);
    }
    return { start, token, finish };
  })();

  // ---------------------------------------------------------------- keys
  addEventListener("keydown", e => {
    const morseKey = e.code === "Space" && ((e.altKey && !e.ctrlKey && !e.metaKey) || (e.ctrlKey && e.shiftKey));
    if (morseKey) { e.preventDefault(); e.stopPropagation(); S.open ? closeBar() : openBar(); return; }
    if (e.code === "KeyM" && e.altKey && e.shiftKey) { e.preventDefault(); panel.hidden ? openPanel() : (panel.hidden = true); return; }
    if (e.key === "Escape") { if (!modal.hidden) modal.hidden = true; else if (!panel.hidden) panel.hidden = true; else if (S.open) closeBar(); }
  }, true);

  onEvent(msg => {
    if (msg.type === "toggle") S.open ? closeBar() : openBar();
    if (msg.type === "panel") openPanel();
    if (msg.type === "mods.changed") syncMods();
  });

  // ---------------------------------------------------------------- boot
  (async () => {
    try {
      const hello = await call("hello", { url: location.href });
      S.label = hello.label; S.mode = hello.mode; S.app = hello.app || null; S.appName = hello.appName || hello.app || null;
      await syncMods();
      if (!hello.quiet) toast(`Morse is ready · press ${HOTKEY}`);
    } catch (e) { console.warn("[morse] host unavailable", e); }
    // single-page apps change URL without reloading
    setInterval(() => { if (location.href !== S.url) { S.url = location.href; syncMods().catch(() => {}); } }, 1000);
  })();

  // Read-only status for automated screenshots/tests; off unless opted in.
  // Mirrored into a DOM attribute so it is readable from any JS world.
  if (DEBUG) setInterval(() => {
    hostEl.dataset.status = JSON.stringify({ phase: S.phase, hint: hint.textContent, ticker: ticker.textContent, mods: S.mods.length });
  }, 40);

  // ---------------------------------------------------------------- css
  function CSS() { return `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button { font: inherit; cursor: pointer; }
    .fx { position: fixed; display: none; pointer-events: none; border-radius: 8px; }
    .hl, .sel { position: fixed; pointer-events: none; border: 2px solid #39d353; border-radius: 6px; background: rgba(57,211,83,.08); box-shadow: 0 0 0 4px rgba(57,211,83,.12); transition: all .06s ease-out; }
    .sel { border-style: dashed; background: rgba(57,211,83,.05); }
    .hl span { position: absolute; left: -2px; top: -24px; background: #39d353; color: #04260f; font: 600 11px/1 ui-monospace, Menlo, monospace; padding: 5px 7px; border-radius: 5px 5px 5px 0; white-space: nowrap; }
    .pulse { position: fixed; pointer-events: none; border-radius: 8px; border: 2px solid #39d353; animation: pulse .9s ease-out forwards; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(57,211,83,.55); opacity: 1 } 100% { box-shadow: 0 0 0 18px rgba(57,211,83,0); opacity: 0 } }

    .bar { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(720px, calc(100vw - 32px)); pointer-events: auto;
      background: rgba(13,17,23,.94); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); color: #e6edf3; border: 1px solid #30363d; border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.03) inset; font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; animation: rise .18s ease-out; }
    @keyframes rise { from { transform: translate(-50%, 10px); opacity: 0 } }
    .bar.top { bottom: auto; top: 28px; }
    .bar.working { border-color: #26a641; box-shadow: 0 20px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(57,211,83,.25), 0 0 40px rgba(57,211,83,.15); }
    .bar.done { border-color: #2ea043; }
    .bar.err { border-color: #da3633; }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px 10px 8px 14px; }
    .logo { display: grid; grid-template-columns: repeat(3, 6px); gap: 2px; flex: none; }
    .logo i { width: 6px; height: 6px; border-radius: 1.5px; background: #26a641; }
    .logo i:nth-child(odd) { background: #39d353; } .logo i:nth-child(1), .logo i:nth-child(9) { background: #0e4429; } .logo i:nth-child(4) { background: #006d32; }
    .logo.live i { animation: blink 0.9s infinite steps(2); }
    .logo.live i:nth-child(3n+1) { animation-delay: .15s } .logo.live i:nth-child(3n+2) { animation-delay: .3s } .logo.live i:nth-child(2n) { animation-duration: .7s }
    @keyframes blink { 50% { background: #0e4429 } }
    .logo.sm { grid-template-columns: repeat(3, 5px); } .logo.sm i { width: 5px; height: 5px; }
    .in { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #e6edf3; font: 500 16px/1.4 inherit; font-family: inherit; padding: 6px 0; }
    .in::placeholder { color: #6e7681; }
    .in:disabled { color: #8b949e; }
    .go { width: 32px; height: 32px; border-radius: 9px; border: 1px solid #2ea043; background: #238636; color: white; font-size: 15px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; max-width: 46%; background: rgba(57,211,83,.12); color: #7ee787; border: 1px solid rgba(57,211,83,.35);
      border-radius: 8px; padding: 3px 4px 3px 9px; font: 600 12px/1.4 ui-monospace, Menlo, monospace; white-space: nowrap; }
    .chip span { overflow: hidden; text-overflow: ellipsis; }
    .chip .x { border: 0; background: none; color: #7ee787; font-size: 15px; line-height: 1; padding: 0 4px; }
    .status { display: flex; align-items: center; gap: 12px; padding: 7px 12px 9px 14px; border-top: 1px solid #21262d; font-size: 12px; color: #8b949e; min-height: 38px; }
    .hint { flex: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 62%; }
    .hint b { color: #e6edf3; font-weight: 600; } .hint b.ok { color: #7ee787; } .hint i { color: #f0883e; font-style: normal; }
    .ticker { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: clip; font: 12px ui-monospace, Menlo, monospace; color: #3fb950;
      -webkit-mask-image: linear-gradient(90deg, transparent, #000 40%); mask-image: linear-gradient(90deg, transparent, #000 40%); }
    .actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: none; }
    .actions button, .panel button, .card button { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 7px; padding: 4px 10px; font-size: 12px; font-weight: 500; }
    .actions button:hover, .panel button:hover, .card button:hover { background: #30363d; }
    button.primary { background: #238636 !important; border-color: #2ea043 !important; color: #fff !important; }
    .actions em { font-style: normal; background: #238636; border-radius: 9px; padding: 0 6px; margin-left: 3px; }
    .model { font: 11px ui-monospace, Menlo, monospace; color: #6e7681; }
    .ms { font: 600 12px ui-monospace, Menlo, monospace; color: #7ee787; }
    kbd { font: 11px ui-monospace, Menlo, monospace; background: #21262d; border: 1px solid #30363d; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; color: #c9d1d9; }
    .spin { display: inline-block; width: 8px; height: 8px; background: #39d353; border-radius: 2px; margin-right: 4px; animation: spin .8s infinite steps(4); vertical-align: 0; }
    @keyframes spin { 25% { background: #26a641 } 50% { background: #006d32 } 75% { background: #26a641 } }
    .dim { color: #6e7681; }

    .panel { position: fixed; top: 12px; right: 12px; bottom: 12px; width: 380px; max-width: calc(100vw - 24px); pointer-events: auto; display: flex; flex-direction: column;
      background: rgba(13,17,23,.97); color: #e6edf3; border: 1px solid #30363d; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.5); font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; animation: slide .18s ease-out; }
    @keyframes slide { from { transform: translateX(20px); opacity: 0 } }
    .panel header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px; border-bottom: 1px solid #21262d; }
    .panel header div:nth-child(2) { flex: 1; } .panel header b { font-size: 15px; display: block; } .panel header small { color: #8b949e; font: 11px ui-monospace, Menlo, monospace; }
    .panel header button { border: 0; background: none; font-size: 20px; color: #8b949e; }
    .list { flex: 1; overflow: auto; padding: 8px; }
    .list article { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; padding: 12px; border-radius: 10px; border: 1px solid #21262d; margin-bottom: 8px; background: #0d1117; }
    .list article.off { opacity: .55; }
    .meta b { display: block; font-size: 14px; } .meta small { color: #8b949e; display: block; margin-top: 2px; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; } .tags span { font: 10px ui-monospace, Menlo, monospace; color: #7ee787; background: rgba(46,160,67,.12); border-radius: 4px; padding: 1px 6px; }
    .btns { grid-column: 2; display: flex; gap: 6px; margin-top: 6px; }
    .empty { color: #8b949e; text-align: center; padding: 40px 10px; line-height: 1.8; }
    .panel footer { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-top: 1px solid #21262d; font: 11px ui-monospace, Menlo, monospace; color: #6e7681; }
    .sw { position: relative; width: 34px; height: 20px; margin-top: 2px; } .sw input { opacity: 0; width: 0; height: 0; }
    .sw span { position: absolute; inset: 0; background: #30363d; border-radius: 10px; transition: .15s; cursor: pointer; }
    .sw span::after { content: ""; position: absolute; left: 3px; top: 3px; width: 14px; height: 14px; border-radius: 50%; background: #c9d1d9; transition: .15s; }
    .sw input:checked + span { background: #238636; } .sw input:checked + span::after { transform: translateX(14px); background: #fff; }

    .modal { position: fixed; inset: 0; background: rgba(1,4,9,.6); display: flex; align-items: center; justify-content: center; pointer-events: auto; animation: fade .15s; }
    @keyframes fade { from { opacity: 0 } }
    .card { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 40px); overflow: auto; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 14px; padding: 18px;
      font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
    .card header { display: grid; grid-template-columns: 1fr auto; margin-bottom: 12px; } .card header b { font-size: 16px; } .card header small { grid-row: 2; color: #8b949e; }
    .card header button { grid-row: 1 / 3; grid-column: 2; border: 0 !important; background: none !important; font-size: 20px; color: #8b949e; }
    .card label { display: block; font: 600 11px ui-monospace, Menlo, monospace; color: #8b949e; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: .04em; }
    .card label .dim, .card label code { text-transform: none; letter-spacing: 0; font-weight: 400; }
    .code { width: 100%; min-height: 130px; background: #010409; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px; padding: 10px; font: 12px/1.5 ui-monospace, Menlo, monospace; resize: vertical; outline: 0; }
    .code:focus { border-color: #2ea043; }
    .card footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .cardimg { width: 100%; border-radius: 10px; border: 1px solid #30363d; display: block; }
    .link { display: flex; gap: 8px; margin-top: 12px; } .link input { flex: 1; min-width: 0; background: #010409; color: #7ee787; border: 1px solid #30363d; border-radius: 7px; padding: 6px 10px; font: 12px ui-monospace, Menlo, monospace; }
    .exports { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .saved { margin: 8px 0 0; font: 11px ui-monospace, Menlo, monospace; }

    .toast { position: fixed; left: 20px; bottom: 20px; pointer-events: none; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-left: 3px solid #39d353;
      border-radius: 10px; padding: 9px 14px; font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.4); animation: rise2 .2s ease-out; }
    @keyframes rise2 { from { transform: translateY(8px); opacity: 0 } }
  `; }
})();
