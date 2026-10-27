// Capture and reuse across apps. Shift+C in God mode saves a snapshot of the
// selected element (trimmed HTML, key computed styles for it and a few of its
// parts, hover rules, a thumbnail, a note, where it came from) to the Morse
// clipboard (host: clipboard.put / clipboard.list / clipboard.remove). In any
// other app the bar shows those snapshots under Captured. Use it here rebuilds
// that look on what you pointed at (or the page). Pick one to say where it
// goes, click it again or Backspace to clear that pick, Remove to drop it.

const GodCapture = (() => {
  const st = { list: [], picked: null, used: null };
  const PROPS = ["display", "flex-direction", "align-items", "justify-content", "gap", "grid-template-columns", "padding",
    "background-color", "background-image", "color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
    "text-transform", "text-align", "text-decoration-line", "border", "border-bottom", "border-radius", "box-shadow", "opacity",
    "backdrop-filter", "cursor", "transition"];
  const INHERITED = new Set(["color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "text-align", "cursor"]);
  const BORING = /^(none|normal|auto|0px|0s|0|static|visible|start|stretch|block|inline|rgba\(0, 0, 0, 0\)|0px (none|solid) .*|all 0s ease 0s|none 0s ease 0s|row|nowrap)$/;

  function stylesOf(el, parentCs) {
    const cs = getComputedStyle(el), out = {};
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p).trim();
      if (!v || BORING.test(v)) continue;
      if (parentCs && INHERITED.has(p) && parentCs.getPropertyValue(p).trim() === v) continue;
      if (p === "border-bottom" && out.border) continue;
      out[p] = v.length > 180 ? v.slice(0, 180) + "…" : v;
    }
    return out;
  }
  function relPath(rootEl, el) {
    const parts = [];
    for (let n = el; n && n !== rootEl; n = n.parentElement) {
      const c = [...n.classList].find(c => !looksHashed(c));
      parts.unshift(n.localName + (c ? "." + c : `:nth-child(${[...n.parentElement.children].indexOf(n) + 1})`));
    }
    return parts.join(" > ");
  }
  function hoverRules(el) {
    const out = [];
    const visit = rules => {
      for (const r of rules) {
        if (out.length >= 6) return;
        if (r.cssRules && !r.selectorText) { visit(r.cssRules); continue; }
        if (!r.selectorText || !/:(hover|focus|active)/.test(r.selectorText)) continue;
        const base = r.selectorText.replace(/:(hover|focus-visible|focus-within|focus|active)/g, "");
        try { if (el.matches(base) || el.querySelector(base)) out.push(r.cssText.slice(0, 300)); } catch {}
      }
    };
    for (const s of document.styleSheets) { try { visit(s.cssRules); } catch {} }
    return out;
  }
  const siteName = () => S.appName || (document.title.split(/\s[|:–—-]\s|:\s/)[0] || location.host).trim().slice(0, 40);

  function snapshot(el, note) {
    const parts = [];
    const walk = (n, depth) => {
      for (const c of n.children) {
        if (parts.length >= 12) return;
        if (c.matches("script, style, [data-morse-ui]")) continue;
        const styles = stylesOf(c, getComputedStyle(n));
        if (Object.keys(styles).length) parts.push({ path: relPath(el, c), styles });
        if (depth < 3) walk(c, depth + 1);
      }
    };
    walk(el, 1);
    const r = el.getBoundingClientRect();
    return {
      id: uid(),
      label: describe(el),
      html: snippet(el),
      styles: { root: stylesOf(el), size: `${Math.round(r.width)}×${Math.round(r.height)}`, parts },
      hover: hoverRules(el),
      note: note || "",
      from: { app: siteName(), url: location.href, title: document.title },
      created: new Date().toISOString(),
    };
  }
  async function thumbOf(el) {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    // visible part, trimmed to at most 3:1 (or 1:1.25) from the top left so wide bars stay legible
    let w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
    if (w < 4 || h < 4) return null;
    w = Math.min(w, h * 3);
    h = Math.min(h, w * 1.25);
    hostEl.style.setProperty("visibility", "hidden", "important"); // as capture() in 60-generate.js
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    let shot = null;
    try { shot = await call("capture"); } catch {}
    hostEl.style.removeProperty("visibility");
    if (!shot) return null;
    const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = shot; });
    if (!img) return null;
    const sx = img.width / innerWidth, sy = img.height / innerHeight, k = Math.min(1, 560 / (w * sx), 280 / (h * sy));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * sx * k));
    c.height = Math.max(1, Math.round(h * sy * k));
    c.getContext("2d").drawImage(img, x * sx, y * sy, w * sx, h * sy, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  }
  const forPrompt = item => ({ label: item.label, html: item.html, styles: item.styles, hover: item.hover, note: item.note, from: item.from });
  const fallbackThumb = `<span class="gm-ph">${GodMode.icon("capture", 16)}</span>`;
  const thumbHtml = item => item.thumb ? `<img src="${esc(item.thumb)}" alt="">` : fallbackThumb;

  // The popover God mode opens for Capture (Shift+C).
  function pop(el, target, close) {
    let thumb = null;
    hostEl.toggleAttribute("data-page-inverted", /invert/.test(getComputedStyle(document.documentElement).filter));
    el.innerHTML = `
      <div class="gm-cap-shot">${fallbackThumb}</div>
      <div class="gm-cap-meta"><b>${esc(describe(target))}</b><small>${esc(siteName())} · ${Math.round(target.getBoundingClientRect().width)}×${Math.round(target.getBoundingClientRect().height)}</small></div>
      <input class="gm-cap-note field" placeholder="${esc(t("cap.note"))}" spellcheck="false" aria-label="${esc(t("cap.noteLabel"))}">
      <div class="gm-cap-foot"><span>${t("cap.later")}</span><button class="btn primary" data-a="save">${t("cap.capture")} <kbd>↵</kbd></button></div>`;
    const shot = el.querySelector(".gm-cap-shot"), field = el.querySelector(".gm-cap-note");
    thumbOf(target).then(t => {
      thumb = t;
      if (t && el.contains(shot)) { shot.innerHTML = `<img src="${t}" alt="">`; shot.querySelector("img").onerror = () => (shot.innerHTML = fallbackThumb); }
    }).finally(() => field.isConnected && field.focus({ preventScroll: true }));
    const save = async () => {
      const item = snapshot(target, field.value.trim());
      if (thumb) item.thumb = thumb;
      try {
        st.list = (await call("clipboard.put", { item })) || [item];
      } catch (e) { return toast(t("cap.failed", { error: plainError(e) })); }
      close();
      render();
      toast(t("cap.done", { label: item.label }));
    };
    el.querySelector("[data-a=save]").onclick = save;
    field.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); save(); } };
  }

  // ---- clipboard chips in the bar
  // Removed this session, so a slow list refresh can't put one back under the click that dropped it.
  const gone = new Set();
  const row = document.createElement("div");
  row.className = "gm-clips";
  row.hidden = true;
  row.innerHTML = `<span class="gm-clips-l">${t("cap.captured")}</span><div class="gm-chips" role="group" aria-label="${esc(t("cap.items"))}"></div><button type="button" class="btn gm-use" hidden></button>`;
  bar.insertBefore(row, bar.querySelector(".status"));
  const chips = row.querySelector(".gm-chips"), label = row.querySelector(".gm-clips-l"), useBtn = row.querySelector(".gm-use");

  function render() {
    // Dark/light mode inverts the whole page, our overlay included: flip thumbnails back.
    hostEl.toggleAttribute("data-page-inverted", /invert/.test(getComputedStyle(document.documentElement).filter));
    const phase = S.phase;
    const used = phase !== "idle" && st.used;
    const items = used ? [st.used] : st.list.slice(0, 8);
    row.hidden = bar.hidden || !items.length || (phase !== "idle" && !used);
    useBtn.hidden = row.hidden || phase !== "idle";
    useBtn.textContent = t("cap.useHere");
    const named = st.picked || items[0];
    useBtn.title = st.picked ? t("cap.useHere.title") : (named ? t("cap.useNamed", { label: named.label }) : "");
    if (row.hidden) return;
    label.textContent = used ? t("cap.using") : t("cap.captured");
    chips.innerHTML = items.map(it => {
      const pressed = !!used || st.picked?.id === it.id;
      const note = it.note ? ` · ${it.note}` : "";
      const title = (pressed ? t("cap.selected", { label: it.label }) : t("cap.pick", { label: it.label })) + note;
      // The × is the shared close glyph (.x). While a run is using the capture, it stays put.
      return `<div class="gm-chip${pressed ? " on" : ""}" data-id="${esc(it.id)}">
        <button type="button" class="gm-chip-main" aria-pressed="${pressed}" title="${esc(title)}">
          ${thumbHtml(it)}<span><b>${esc(it.label)}</b><small>${esc(it.from?.app || it.from?.title || "")}</small></span>
        </button>${used ? "" : `<button type="button" class="x" aria-label="${esc(t("cap.remove", { label: it.label }))}" title="${esc(t("cap.remove", { label: it.label }))}">×</button>`}
      </div>`;
    }).join("");
    chips.querySelectorAll("img").forEach(i => (i.onerror = () => i.replaceWith(Object.assign(document.createElement("span"), { className: "gm-ph", innerHTML: GodMode.icon("capture", 16) }))));
  }
  // The hint, the placeholder and Send all follow the pick. Safe only after the bar exists (callers are clicks and observers).
  function applyPick() {
    if (!bar.hidden && S.phase === "idle") input.placeholder = st.picked ? t("cap.placeholder") : PLACEHOLDER();
    render();
    if (!bar.hidden && S.phase === "idle") { setHint(); updateChips(); }
    syncSendLabel();
  }
  function pick(item) {
    if (!item || S.phase !== "idle") return;
    st.picked = st.picked?.id === item.id ? null : item;
    applyPick();
    input.focus();
  }
  function clear() {
    if (!st.picked || S.phase !== "idle") return;
    st.picked = null;
    applyPick();
    input.focus();
  }
  // One click pastes the picked capture, or the newest one when nothing is picked.
  function useHere() {
    if (S.phase !== "idle") return;
    const item = st.picked || st.list[0];
    if (!item) return;
    st.picked = item;
    const typed = input.value.trim();
    send(typed || t("cap.useHere.p"));
  }
  async function remove(id) {
    if (!id || S.phase !== "idle") return;
    gone.add(id);
    st.list = st.list.filter(i => i.id !== id);
    if (st.picked?.id === id) st.picked = null;
    applyPick();
    input.focus();
    try {
      const l = await call("clipboard.remove", { id });
      if (bar.hidden || !Array.isArray(l)) return;
      st.list = l.filter(i => i && typeof i.id === "string" && !gone.has(i.id));
      if (st.picked && !st.list.some(i => i.id === st.picked.id)) st.picked = null;
      applyPick();
    } catch {}
  }
  function request() {
    return S.phase === "idle" && st.picked ? t("cap.useHere.p") : "";
  }
  chips.addEventListener("click", e => {
    if (S.phase !== "idle") return;
    const x = e.target.closest(".x");
    if (x) { remove(x.closest(".gm-chip")?.dataset.id); return; }
    const b = e.target.closest(".gm-chip-main");
    if (!b) return;
    pick(st.list.find(i => i.id === b.closest(".gm-chip").dataset.id));
  });
  useBtn.addEventListener("click", useHere);
  new MutationObserver(() => {
    if (bar.hidden) {
      gone.clear();
      st.picked = null;
      if (!S.draft || S.draft.saved) st.used = null;
      input.placeholder = PLACEHOLDER();
      row.hidden = true;
      useBtn.hidden = true;
      syncSendLabel();
      return;
    }
    render();
  }).observe(bar, { attributes: true, attributeFilter: ["hidden", "class"] });
  // Refresh the list whenever the bar opens (it may have been captured in another app).
  new MutationObserver(() => {
    if (bar.hidden) return;
    call("clipboard.list").then(l => {
      if (bar.hidden) return;
      st.list = Array.isArray(l) ? l.filter(i => i && typeof i.id === "string" && !gone.has(i.id)) : [];
      if (st.picked && !st.list.some(i => i.id === st.picked.id)) st.picked = null;
      applyPick();
    }).catch(() => {});
  }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });
  langSubs.add(() => { if (!row.hidden) render(); });

  // Hook (01-rpc.js): attach the picked snapshot to the next request, and its
  // origin to the mod that request produces.
  outgoing.push(msg => {
    if (msg.type === "generate" && st.picked && msg.context) {
      msg.context.snapshot = forPrompt(st.picked);
      st.used = st.picked;
      st.picked = null;
      input.placeholder = PLACEHOLDER();
      queueMicrotask(render); // the bar turned "working" before this request went out
    } else if (msg.type === "mods.save" && msg.draft && st.used && S.draft?.id === msg.draft.id && S.draft.ctx?.snapshot) {
      msg.draft.from = st.used.from;
      st.used = null;
    }
    return msg;
  });

  return {
    pop, snapshot, thumbOf /* take-and-bring hook: 73-take.js */, refresh: render, clear, request,
    get list() { return st.list; },
    get picked() { return st.picked; },
  };
})();
