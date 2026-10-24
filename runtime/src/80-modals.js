// Modals (Edit code, Share, Install a mod, the install and update reviews,
// Show code) are real modal dialogs: the <dialog> is named by the card's
// title, focus goes in, Tab stays in, and Esc or Close puts focus back where
// it was (12-focus.js has the helpers).
// { review: true }: an install or update review (63-control.js, 68-gallery.js).
let modalBack = null;
function openModal(html, { review = false } = {}) {
  if (modal.hidden) modalBack = nowFocused(); // a modal replacing another (Install a mod → review) keeps the first one's
  modal.innerHTML = `<div class="card">${html}<div class="sr" role="status" aria-live="polite"></div></div>`;
  const card = modal.querySelector(".card"), title = card.querySelector("header b"), sub = card.querySelector("header small");
  modal.setAttribute("aria-modal", "true");
  for (const [attr, el, id] of [["aria-labelledby", title, "m-modal-title"], ["aria-describedby", sub, "m-modal-sub"]]) {
    if (el) { el.id = id; modal.setAttribute(attr, id); } else modal.removeAttribute(attr);
  }
  for (const b of card.querySelectorAll("header > button[data-a=close]")) if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", "Close");
  modal.hidden = false;
  bar.setAttribute("aria-modal", "false"); // one modal at a time for screen readers: this one
  modal.onclick = e => { if (e.target === modal || e.target.closest("[data-a=close]")) modal.hidden = true; };
  // The first field, else the first button that isn't Close; callers may move it (the review starts on Cancel).
  const all = tabbables(card);
  (all.find(n => n.matches("textarea:not([readonly]), input:not([readonly])")) || all.find(n => !n.closest("header") && !n.matches("[readonly], pre")) || all[0])?.focus({ preventScroll: true });
  if (review) showReview();
}
// One listener for the life of the page (it used to be added on every open).
modal.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Escape") modal.hidden = true;
  if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) tabWithin(e, modal.querySelector(".card"));
});
// However it closes (Esc, Close, Cancel, a click outside, Install), focus goes
// back to where it was, or to the bar or the panel if that is gone.
new MutationObserver(() => {
  if (!modal.hidden) return;
  bar.setAttribute("aria-modal", "true");
  const back = modalBack;
  modalBack = null;
  // After the <dialog> has closed (a review's close() moves focus on its own).
  setTimeout(() => {
    if (!modal.hidden || !(modal.contains(root.activeElement) || !root.activeElement)) return;
    const visible = n => n?.isConnected && n.getClientRects().length && !n.closest("[hidden]");
    const to = visible(back) ? back : !bar.hidden ? input : !panel.hidden ? panel.querySelector(".list article[tabindex='0'], [data-a=close]") : back?.isConnected ? back : null;
    try { to?.focus({ preventScroll: true }); } catch {}
  }, 0);
}).observe(modal, { attributes: true, attributeFilter: ["hidden"] });

// ---- reviews: on top of everything, and no click until they have been seen
// A review is shown as a modal <dialog>: the browser draws it above the whole
// page (top layer) and the page can't be clicked under it. Its main button
// ([data-settle]: Install, Update) turns on only after the review has been on
// top, uncovered, for REVIEW_SETTLE ms, so a page can't uncover it just as
// someone clicks. If the page draws something of its own over it (a popover,
// a modal dialog, full screen), the review comes back on top and waits again;
// a page that keeps doing it gets the review closed.
const REVIEW_SETTLE = 500;
// IntersectionObserver v2 (Chrome) reports whether anything at all is drawn
// over the button, a popover hidden in the page's own shadow root included.
const SEES_COVERS = "isVisible" in (globalThis.IntersectionObserverEntry?.prototype || {});
const Review = { clearSince: null, covers: [], io: null, timer: 0 };
function showReview() {
  if (typeof modal.showModal !== "function") return;
  const focused = root.activeElement;
  TopLayer.raise();
  try { if (modal.open) modal.close(); modal.showModal(); } catch { return; }
  if (focused && modal.contains(focused)) focused.focus({ preventScroll: true });
  Review.clearSince = SEES_COVERS ? null : performance.now(); // with v2: from when it reports the button uncovered
  Review.io?.disconnect();
  if (SEES_COVERS) {
    Review.io = new IntersectionObserver(seen, { trackVisibility: true, delay: 100 });
    for (const b of modal.querySelectorAll("[data-settle]")) Review.io.observe(b);
  }
  settleReview();
}
function seen(entries) {
  if (!modal.open) return;
  if (entries[entries.length - 1].isVisible) Review.clearSince ??= performance.now();
  else if (Review.clearSince != null) { Review.clearSince = null; return coveredUI(); }
  settleReview();
}
function settleReview() {
  clearTimeout(Review.timer);
  const t = Review.clearSince == null ? -1 : performance.now() - Review.clearSince;
  const ok = modal.open && t >= REVIEW_SETTLE;
  for (const b of modal.querySelectorAll("[data-settle]")) if (b.dataset.settle !== "busy") b.disabled = !ok;
  if (modal.open && t >= 0 && !ok) Review.timer = setTimeout(settleReview, REVIEW_SETTLE - t + 10);
}
// Something of the page's is drawn over Morse: back on top.
function coveredUI() {
  const now = performance.now();
  Review.covers = Review.covers.filter(t => now - t < 3000).concat(now);
  if (modal.open && Review.covers.length > 5) {
    modal.hidden = true;
    return toast("This page kept covering Morse's review, so Morse closed it. Nothing was installed.");
  }
  if (Review.covers.length > 10) return; // stop taking turns with a page that won't stop
  if (modal.open) showReview(); else TopLayer.raise();
}
new MutationObserver(() => {
  if (!modal.hidden) return;
  Review.io?.disconnect();
  if (modal.open) modal.close();
}).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
modal.addEventListener("cancel", e => { e.preventDefault(); modal.hidden = true; }); // Escape: closed the usual way
function pageTopLayer(e) {
  if (e.type === "toggle" && (e.newState !== "open" || e.target === hostEl)) return;
  if (bar.hidden && panel.hidden && modal.hidden) return;
  coveredUI();
}
listen("toggle", pageTopLayer, true);
listen("fullscreenchange", pageTopLayer, true);
// Editing the code by hand makes a new version, like a refine (⌘Z or the
// panel's History bring the old one back).
const HAND_EDIT = "Edited the code by hand";
function showCode(m) {
  if (!m) return;
  const isDraft = m === S.draft && S.phase === "result";
  const saved = !isDraft && S.mods.find(x => x.id === m.id);
  openModal(`
    <header><b>${esc(m.title)}</b><small>“${esc(m.refined || m.prompt || m.request)}”</small><button data-a="close">×</button></header>
    <label for="m-code-css">Style <span class="dim">CSS</span></label><textarea class="code" id="m-code-css" data-k="css" spellcheck="false">${esc(m.css)}</textarea>
    <label for="m-code-js">Script <span class="dim">JavaScript, can use the <code>morse</code> helpers</span></label><textarea class="code" id="m-code-js" data-k="js" spellcheck="false">${esc(m.js)}</textarea>
    <footer><button data-a="close">Cancel</button><button class="primary" data-a="save">${saved ? "Save and run" : "Run"}</button></footer>`);
  modal.querySelector("[data-a=save]").onclick = async () => {
    const css = modal.querySelector("[data-k=css]").value, js = modal.querySelector("[data-k=js]").value;
    modal.hidden = true;
    if (css === m.css && js === m.js) return;
    if (isDraft) {
      S.draft = Object.assign(reviseMod(m, { prompt: HAND_EDIT, css, js }), { saved: null, saving: null });
      await showVersion(m.id, S.draft);
      showResult(S.draft, { note: `Your edit · version ${versionsOf(S.draft).length + 1}` });
      return;
    }
    const next = saved ? reviseMod(m, { prompt: HAND_EDIT, css, js }) : { ...m, css, js };
    Object.assign(m, next);
    if (saved) await call("mods.save", { mod: m });
    await removeMod(m.id);
    await applyMod({ ...m, title: m.title || "draft" });
    if (!panel.hidden) renderPanel();
    toast(saved ? `Code updated. This is version ${versionsOf(m).length + 1}.` : "Code updated");
  };
}
async function showShare(m) {
  const card = await renderCard(m);
  const link = await call("share", { mod: m, kind: "link" }).catch(() => null);
  openModal(`
    <header><b>Share “${esc(m.title)}”</b><small>Anyone with Morse, or with Tampermonkey, can install it.</small><button data-a="close">×</button></header>
    ${card ? `<img class="cardimg" src="${card}" alt="Before and after">` : ""}
    ${link ? `<div class="link"><input readonly value="${esc(link.link)}" aria-label="Share link"><button data-a="copy" class="primary">Copy link</button></div>` : ""}
    <div class="exports" role="group" aria-label="Download or post">
      ${card ? `<button data-a="png">Download image</button>` : ""}
      ${S.draft?.id === m.id && S.draft.clip ? `<button data-a="clip">Download clip (${esc(S.draft.clip.kind)})</button>` : ""}
      <button data-a="json">Download mod file</button>
      <button data-a="user">Download for Tampermonkey</button>
      <button data-a="tweet">Post on X…</button>
      ${galleryShareHtml(m) /* gallery hook: Submit to the gallery (68-gallery.js) */}
    </div>
    <p class="saved dim"></p>`);
  const done = r => { const t = r?.path ? `Saved to ${r.path}` : "Downloaded"; modal.querySelector(".saved").textContent = t; announce(t, { again: true }); };
  const slug = m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mod";
  modal.querySelector(".exports").onclick = async e => {
    const a = e.target.closest("button")?.dataset.a;
    if (a === "png") done(await call("export", { filename: `${slug}.png`, dataUrl: card }));
    if (a === "json") done(await call("share", { mod: m, kind: "json" }));
    if (a === "user") done(await call("share", { mod: m, kind: "userscript" }));
    if (a === "clip") done(S.draft.clip);
    if (a === "tweet") {
      const text = `I changed ${S.appName || location.host} by describing it: “${m.prompt}”\n\nMade with Morse`;
      call("open", { url: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link?.link || "")}` });
    }
  };
  const copy = modal.querySelector("[data-a=copy]");
  if (copy) copy.onclick = async () => {
    const f = modal.querySelector(".link input");
    try { await navigator.clipboard.writeText(f.value); } catch { f.select(); document.execCommand?.("copy"); }
    copy.textContent = "Copied";
    announce("Link copied", { again: true });
  };
}
function showImport() {
  openModal(`
    <header><b>Install a shared mod</b><small>Paste a share link, the address of a pack, or the text of a mod file.</small><button data-a="close">×</button></header>
    <textarea class="code" data-k="src" spellcheck="false" placeholder="https://…/install.html#m=…" aria-label="Share link, pack address or mod file"></textarea>
    <footer><button data-a="close">Cancel</button><button class="primary" data-a="go">Next</button></footer>`);
  // user control: say what it does before anything is installed (63-control.js)
  modal.querySelector("[data-a=go]").onclick = () => reviewImport(modal.querySelector("[data-k=src]").value);
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
  g.fillStyle = "#0b0b0c"; g.fillRect(0, 0, W, H);
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
    g.fillStyle = "#18181b"; g.fillRect(P.x, P.y, P.w, P.h);
    const s = Math.min(P.w / crop.w, P.h / crop.h);
    const dw = crop.w * s, dh = crop.h * s;
    const ox = P.x + (P.w - dw) / 2, oy = P.y + (P.h - dh) / 2;
    g.drawImage(img, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, ox, oy, dw, dh);
    if (mark) {
      // outline what changed
      g.strokeStyle = "rgba(244,244,245,.85)"; g.lineWidth = 2; g.setLineDash([6, 4]);
      roundRect(g, ox + (mark.x - crop.x) * s - 4, oy + (mark.y - crop.y) * s - 4, mark.w * s + 8, mark.h * s + 8, 8); g.stroke();
      g.setLineDash([]);
    }
    g.restore();
    g.strokeStyle = accent; g.lineWidth = 2; roundRect(g, P.x, P.y, P.w, P.h, 14); g.stroke();
    // the caption: 15px, at least 7:1 on the card (it shrinks to ~9px in the dialog and in feeds)
    g.fillStyle = accent; g.font = "700 15px ui-monospace, Menlo, monospace";
    g.fillText(label, P.x + 2, P.y - 12);
  };
  draw(b, panels[0], "BEFORE", "#a0a0a8");
  draw(a, panels[1], "AFTER", "#f4f4f5", S.after.focus);
  g.fillStyle = "#f4f4f5"; g.font = "600 34px ui-sans-serif, system-ui, sans-serif";
  g.font = "600 34px ui-sans-serif, system-ui, sans-serif";
  const oneLine = g.measureText(`“${m.prompt}”`).width <= W - 80;
  wrap(g, `“${m.prompt}”`, 40, oneLine ? 92 : 70, W - 80, 42, 2);
  g.fillStyle = "#a0a0a8"; g.font = "500 17px ui-sans-serif, system-ui, sans-serif";
  g.fillText(`${S.appName || location.host} · ${d.secs}s · ${S.label.split(" · ")[0]}`, 40, oneLine ? 136 : 154);
  // wordmark
  const lx = W - 168, ly = 632;
  // wordmark: the radar mark (static frame) + "morse"
  for (let i = 0; i < 16; i++) {
    if (RADAR_CORNER.has(i)) continue;
    g.fillStyle = RADAR_OUTER.has(i) ? "rgba(244,244,245,.3)" : "#f4f4f5";
    roundRect(g, lx + (i % 4) * 7, ly + Math.floor(i / 4) * 7, 5.5, 5.5, 1.5); g.fill();
  }
  g.fillStyle = "#f4f4f5"; g.font = "600 22px ui-sans-serif, system-ui, sans-serif"; g.fillText("morse", lx + 34, ly + 21);
  g.fillStyle = "#a0a0a8"; g.font = "500 17px ui-sans-serif, system-ui, sans-serif"; g.fillText("change any app in your own words", 40, ly + 20);
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

// People read plain words (core/onboarding.js plainError); developers find
// the error it stood for in the console.
onHiddenError(raw => console.warn("[morse] details:", raw));

function toast(msg) {
  announce(msg, { again: true }); // screen readers hear every toast (12-focus.js)
  toastEl.innerHTML = `${radar(12)}<span>${esc(msg)}</span>`;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastEl.hidden = true), 2800);
}
