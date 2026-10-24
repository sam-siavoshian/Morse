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
  // The draft and its stop handle exist before the first await, so Stop
  // pressed right after Enter cancels this run, not the previous one.
  S.draft = { id, request, ctx, title: "", css: "", js: "" };
  let stopped = false;
  const stopSignal = cancelSignal(id).then(r => { stopped = true; return r; });
  S.before = { shot: await capture(), rect: R(tr), focus: R(rect), vw: innerWidth, vh: innerHeight };
  const t0 = performance.now();
  hint.innerHTML = `${radar(12)} Thinking`;
  actions.innerHTML = `<span class="ms">0.0s</span>`;
  const clock = setInterval(() => { const m = actions.querySelector(".ms"); if (m) m.textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s"; }, 100);
  Effect.start(focus);

  let wrote = false;
  const off = onEvent(msg => {
    if (msg.genId !== id) return;
    if (msg.type === "token") {
      if (!wrote) { wrote = true; if (/Thinking/.test(hint.textContent)) hint.innerHTML = `${radar(12)} Writing`; }
      Effect.token(msg.text); tick(msg.text);
    }
    if (msg.type === "css") setCss(id, msg.css);
    if (msg.type === "phase") {
      if (msg.phase === "fixing") hint.innerHTML = `${radar(12)} Fixing <i>${esc(String(msg.error).slice(0, 80))}</i>`;
      if (msg.phase === "applying") hint.innerHTML = `${radar(12)} Applying`;
      if (msg.phase === "thinking") hint.innerHTML = `${radar(12)} Writing`;
    }
  });
  let res;
  try { res = stopped ? await stopSignal : await Promise.race([call("generate", { genId: id, request, context: ctx }), stopSignal]); } // Stop: 50-bar.js
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
    call("off", { modId: id }).catch(() => {}); // a failed attempt's JS may have left nodes, observers or timers
    if (res.cancelled) return onCancelled(id); // Stop: 50-bar.js
    S.phase = "error";
    bar.classList.add("err");
    hint.innerHTML = `Couldn't do that: <i>${esc(String(res.error || "unknown error").slice(0, 120))}</i>`;
    hint.title = res.error || "";
    actions.innerHTML = `<button data-a="again">Try again</button>`;
    return;
  }
  if (S.target) boxTo(S.target, selBox);
  selBox.hidden = true;
  S.after = { shot: await capture(), rect: S.target?.isConnected ? R(S.target.getBoundingClientRect()) : null, focus: focus?.isConnected ? R(focus.getBoundingClientRect()) : null };
  call("clip.stop", { modId: id }).then(c => { if (c) S.draft.clip = c; }).catch(() => {});
  S.phase = "result";
  bar.classList.add("done");
  hint.innerHTML = `<b class="ok">${esc(S.draft.title)}</b> <span class="dim">${secs}s${res.attempts > 1 ? " · repaired once" : ""}</span>`;
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
  if (d.saving) return d.saving; // Keep then Share (or a double click) saves once
  d.saving = call("mods.save", { draft: { id: d.id, title: d.title, prompt: d.request, css: d.css, js: d.js, url: location.href, app: S.app, target: d.ctx.target, model: d.model } });
  const mod = await d.saving;
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
