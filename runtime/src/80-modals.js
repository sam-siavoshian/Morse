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
    g.fillStyle = accent; g.font = "700 13px ui-monospace, Menlo, monospace";
    g.fillText(label, P.x + 2, P.y - 10);
  };
  draw(b, panels[0], "BEFORE", "#8e8e96");
  draw(a, panels[1], "AFTER", "#f4f4f5", S.after.focus);
  g.fillStyle = "#f4f4f5"; g.font = "600 34px ui-sans-serif, system-ui, sans-serif";
  g.font = "600 34px ui-sans-serif, system-ui, sans-serif";
  const oneLine = g.measureText(`“${m.prompt}”`).width <= W - 80;
  wrap(g, `“${m.prompt}”`, 40, oneLine ? 92 : 70, W - 80, 42, 2);
  g.fillStyle = "#8e8e96"; g.font = "500 17px ui-sans-serif, system-ui, sans-serif";
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
  g.fillStyle = "#8e8e96"; g.font = "500 15px ui-sans-serif, system-ui, sans-serif"; g.fillText("customize any app in one sentence", 40, ly + 20);
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
  toastEl.innerHTML = `${radar(12)}<span>${esc(msg)}</span>`;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastEl.hidden = true), 2800);
}
