// Describe this picture: point at a picture and the model says, in a sentence
// or two, what it shows. It needs a model that can look at pictures (Claude
// Code or the Anthropic API; core/providers.js says so plainly otherwise).
// The description can be saved as the picture's alt text, in the
// "Accessibility fixes" mod (65-a11y.js), so screen readers read it from then on.
// The picture's pixels come straight from the image when the page allows it,
// else from a screenshot cropped to it (the host's "capture").

const DescribeImage = (() => {
  const IMG = "img, picture, svg, canvas, video, input[type=image], [role=img]";
  const card = document.createElement("div");
  card.className = "ds";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Describe this picture");
  const ring = document.createElement("div");
  ring.className = "ds-ring";
  ring.hidden = true;
  root.append(ring, card);
  let D = null, raf = 0;

  function imageOf(el) {
    if (!el || el.nodeType !== 1 || el.closest("[data-morse-ui]")) return null;
    if (el.matches("picture")) return el.querySelector("img") || null;
    if (el.matches(IMG)) {
      const r = el.getBoundingClientRect();
      return r.width >= 16 && r.height >= 16 ? el : null;
    }
    // A link, button or figure that is mostly one picture.
    const pics = [...el.querySelectorAll("img, canvas, svg[role=img]")].filter(p => { const r = p.getBoundingClientRect(); return r.width >= 16 && r.height >= 16; });
    return pics.length === 1 && (el.innerText || "").trim().length < 120 ? pics[0] : null;
  }

  // Words near the picture that help say what it is for.
  function near(img) {
    const bits = [];
    const fig = img.closest("figure");
    const cap = fig?.querySelector("figcaption")?.innerText;
    if (cap) bits.push(cap);
    for (const a of ["title", "aria-label"]) if (img.getAttribute(a)) bits.push(img.getAttribute(a));
    const host = img.closest("a, button");
    if (host && host.innerText.trim()) bits.push(host.innerText);
    if (!bits.length) {
      const h = img.closest("section, article, main, aside, div")?.querySelector("h1, h2, h3");
      if (h) bits.push(h.innerText);
    }
    return bits.join(" · ").replace(/\s+/g, " ").trim().slice(0, 400);
  }

  async function pixels(el) {
    const MAX = 1024;
    const encode = (src, sx, sy, sw, sh) => {
      const k = Math.min(1, MAX / Math.max(sw, sh));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(sw * k));
      c.height = Math.max(1, Math.round(sh * k));
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", 0.86); // throws if the page won't let Morse read it
      return { mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
    };
    if (el.localName === "img" && el.complete && el.naturalWidth) { try { return encode(el, 0, 0, el.naturalWidth, el.naturalHeight); } catch {} }
    if (el.localName === "canvas") { try { return encode(el, 0, 0, el.width, el.height); } catch {} }
    // Another site's picture, an SVG or a video frame: a screenshot of it.
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shot = await capture(); // 60-generate.js: hides Morse's own overlay for the shot
    if (!shot) throw new Error("Morse can't take a picture of this page here");
    const im = new Image();
    im.src = shot;
    await im.decode();
    const k = im.naturalWidth / innerWidth, r = el.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top), w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
    if (w < 8 || h < 8) throw new Error("The picture isn't on screen. Scroll to it and try again");
    return encode(im, x * k, y * k, w * k, h * k);
  }

  async function start(el, { fromAudit = false } = {}) {
    const img = imageOf(el);
    if (!img) return toast("Point at a picture to describe it.");
    cancel();
    if (S.open && S.phase === "idle") closeBar();
    const d = D = { img, text: "", done: false, error: "", genId: uid(), fromAudit, alt: img.getAttribute("alt") };
    render();
    if (!raf) raf = requestAnimationFrame(loop);
    let image;
    try { image = await pixels(img); } catch (e) { return finish(d, { ok: false, error: e.message }); }
    if (D !== d) return;
    const off = onEvent(msg => { if (D === d && msg.genId === d.genId && msg.type === "answer") { d.text = msg.text; render(); } });
    let res;
    try {
      res = await call("generate", { genId: d.genId, request: "Describe this picture", context: { url: location.href, title: document.title, app: S.app, a11y: { image: { ...image, alt: d.alt || "", near: near(img) } } } });
    } catch (e) { res = { ok: false, error: e.message }; }
    off();
    finish(d, res);
  }
  function finish(d, res) {
    if (D !== d) return;
    d.done = true;
    if (!res?.ok || !d.text) d.error = res?.cancelled ? "" : (res?.error || "The model's answer had no description in it. Try again");
    if (res?.cancelled) return close();
    render();
    if (!d.error) announce(`Description: ${d.text}`);
    card.querySelector(d.error ? "[data-ds=again]" : "[data-ds=save]")?.focus({ preventScroll: true });
  }
  function cancel() {
    if (D && !D.done) call("generate.cancel", { genId: D.genId }).catch(() => {});
  }
  function close() {
    cancel();
    D = null;
    card.hidden = ring.hidden = true;
    cancelAnimationFrame(raf);
    raf = 0;
  }
  const decoration = t => /^decoration\b/i.test(t || "");

  async function save() {
    if (!D?.text) return;
    const { img, text, fromAudit } = D;
    const alt = decoration(text) ? "" : text.replace(/\s+/g, " ").trim();
    const fix = img.matches("img, input[type=image]") ? { kind: "alt", sel: GodMode.targetOf(img).sel, text: alt } : { kind: "name", sel: GodMode.targetOf(img).sel, text: alt || "Decoration" };
    await A11y.addFixes([fix]);
    close();
    toast(alt ? "Saved. Screen readers will read this description." : "Saved as decoration. Screen readers will skip it.");
    if (fromAudit) setTimeout(() => Audit.run(), 60);
  }

  function render() {
    const d = D;
    if (!d) return;
    card.hidden = false;
    const busy = !d.done;
    card.innerHTML = `
      <div class="ds-head"><span class="ds-k">${busy ? radar(12) : A11y.icon("describe")}<span>Describe this picture</span></span>
        <button type="button" class="ds-x" data-ds="close" aria-label="Close" title="Close">×</button></div>
      ${d.error ? `<p class="ds-err">That didn't work: <i>${esc(d.error)}.</i></p>`
        : `<p class="ds-text${busy ? " busy" : ""}" aria-live="polite">${d.text ? esc(d.text) : "Looking at the picture…"}</p>`}
      ${d.done ? `<div class="ds-foot">${d.error ? `<button type="button" class="primary" data-ds="again">Try again</button>`
        : `<button type="button" class="primary" data-ds="save" title="Screen readers will read this description">${decoration(d.text) ? "Save as decoration" : "Save as alt text"}</button><button type="button" data-ds="copy">Copy</button>`}
        <small>${d.alt ? `Now: “${esc(d.alt.slice(0, 60))}”` : d.alt === "" ? "Now marked as decoration" : "It has no alt text now"}</small></div>` : ""}`;
  }
  // Beside the picture: below it if there's room, else above, else inside.
  function loop() {
    raf = 0;
    if (!D) return;
    const r = D.img.isConnected ? D.img.getBoundingClientRect() : null;
    const vw = innerWidth, vh = innerHeight, M = 12, w = card.offsetWidth || 340, h = card.offsetHeight || 120;
    let x = (vw - w) / 2, y = vh - h - 28;
    if (r && r.bottom > 0 && r.top < vh) {
      x = r.left + Math.min(r.width, 560) / 2 - w / 2;
      y = r.bottom + M + h < vh - 8 ? r.bottom + M : r.top - M - h > 8 ? r.top - M - h : Math.min(r.bottom, vh) - h - M;
      ring.hidden = false;
      Object.assign(ring.style, { transform: `translate(${r.left - 3}px, ${r.top - 3}px)`, width: r.width + 6 + "px", height: r.height + 6 + "px" });
    } else ring.hidden = true;
    x = Math.max(8, Math.min(vw - w - 8, x));
    y = Math.max(8, Math.min(vh - h - 8, y));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    raf = requestAnimationFrame(loop);
  }

  card.addEventListener("click", e => {
    const a = e.target.closest("button")?.dataset.ds;
    if (a === "close") close();
    if (a === "save") save().catch(err => toast(`Couldn't save that: ${err.message}`));
    if (a === "copy" && D?.text) { navigator.clipboard?.writeText(D.text).then(() => toast("Copied"), () => toast("Couldn't copy here. Select the text instead.")); }
    if (a === "again" && D) start(D.img, { fromAudit: D.fromAudit });
  });
  listen("keydown", e => {
    if (!e.isTrusted || !D || S.open || e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }, true);

  return { start, close, imageOf, get state() { return D && { text: D.text, done: D.done, error: D.error }; } };
})();
