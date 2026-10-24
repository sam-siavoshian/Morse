// Generating a change, and iterating on it.
//   - a result stays editable: type a follow-up and Enter refines the same
//     mod (the model gets the original ask, the current code and the
//     follow-up, and rewrites it whole); Enter on an empty input keeps it
//   - ⌘Z / Ctrl+Z after a result steps back one version
//   - refineMod(m) opens the bar on a saved mod (the panel's Refine), and
//     fixMod(m) re-runs it with what went wrong (the panel's Fix it)
// Versions are plain data (core/versions.js, inlined by runtime/bundle.js).
//
// S.draft = { id, request, prompt, ctx, title, css, js, history, refined,
//             updated, mod (the saved mod it edits), saved (set once kept) }

async function capture() {
  const vis = hostEl.style.visibility;
  hostEl.style.visibility = "hidden";
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let shot = null;
  try { shot = await call("capture"); } catch {}
  hostEl.style.visibility = vis;
  return shot;
}

const PLACEHOLDER = input.placeholder;
const REFINE_PLACEHOLDER = "Refine…";
const FIX_NOTE = "Fixed it so it works again";

// Puts a version's code on the page under the mod's id (the old JS is undone first).
async function showVersion(id, v) {
  if (guardHeld(v)) { await removeMod(id).catch(() => {}); return { ok: true }; } // guard hook: a paused mod's code stays off (64-guard.js)
  setCss(id, v.css);
  if (v.js.trim()) return call("exec", { modId: id, js: v.js }).catch(e => ({ ok: false, error: e.message }));
  await call("off", { modId: id }).catch(() => {});
  return { ok: true };
}

// opts.from: the draft being refined (its id is reused, so the new code
// replaces the old one live). opts.base: { prompt, css, js, error? } for the model.
async function submit(request, opts = {}) {
  const prev = opts.from || null;
  S.phase = "working";
  S.picking = false;
  hl.hidden = true;
  selBox.hidden = true;
  input.disabled = true;
  bar.classList.remove("done", "err");
  bar.classList.add("working");
  const id = prev ? prev.id : uid();
  const ctx = context();
  const focus = S.target ? focusFor(S.target) : null;
  const rect = focus ? focus.getBoundingClientRect() : null;
  const tr = S.target ? S.target.getBoundingClientRect() : null;
  const R = r => r && { x: r.x, y: r.y, w: r.width, h: r.height };
  // The draft and its stop handle exist before the first await, so Stop
  // pressed right after Enter cancels this run, not the previous one.
  S.draft = prev ? { ...prev, ctx: prev.ctx || ctx } : { id, request, prompt: request, ctx, title: "", css: "", js: "", history: [] };
  let stopped = false;
  const stopSignal = cancelSignal(id).then(r => { stopped = true; return r; });
  // A refine keeps the first "before" shot, so the share card shows the whole change.
  if (!prev || S.before?.id !== id) S.before = { id, shot: await capture(), rect: R(tr), focus: R(rect), vw: innerWidth, vh: innerHeight };
  const t0 = performance.now();
  hint.innerHTML = `${radar(12)} Thinking`;
  actions.innerHTML = `<span class="ms">0.0s</span>`;
  const clock = setInterval(() => { const m = actions.querySelector(".ms"); if (m) m.textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s"; }, 100);
  Effect.start(focus);

  let wrote = false;
  const off = onEvent(msg => {
    if (msg.genId !== id) return;
    if (msg.type === "token") {
      if (!wrote) { wrote = true; if (/Thinking/.test(hint.textContent)) hint.innerHTML = `${radar(12)} Writing the change`; }
      Effect.token(msg.text); tick(msg.text);
    }
    if (msg.type === "css") setCss(id, msg.css);
    if (msg.type === "phase") {
      if (msg.phase === "fixing") { hint.innerHTML = `${radar(12)} Fixing a problem in the new code`; hint.title = String(msg.error || ""); }
      if (msg.phase === "applying") hint.innerHTML = `${radar(12)} Trying the change`;
      if (msg.phase === "thinking") hint.innerHTML = `${radar(12)} Writing the change`;
    }
  });
  let res;
  const ask = { genId: id, request, context: ctx, ...(opts.base ? { base: opts.base } : {}) };
  try { res = stopped ? await stopSignal : await Promise.race([call("generate", ask), stopSignal]); } // Stop: 50-bar.js
  catch (e) { res = { ok: false, error: e.message }; }
  off();
  clearInterval(clock);
  bar.classList.remove("working");
  const secs = ((performance.now() - t0) / 1000).toFixed(1);

  if (prev) {
    if (!res.ok || res.kind === "answer") {
      // Nothing is lost: the version from before the refine goes back on the
      // page (a failed attempt is turned off first: showVersion re-runs it).
      await Effect.finish(res.ok);
      const answered = res.kind === "answer" && Ask.handle(id, res); // a question about the change: show the answer (61-ask.js)
      await showVersion(id, prev);
      S.draft = prev;
      hintNote = "";
      if (answered) return showResult(prev, { note: "Answered · describe a change to refine it" });
      if (res.cancelled) return showResult(prev, { note: "Stopped. Nothing was changed", keepInput: true });
      return showResult(prev, { error: res.error || "Something went wrong. Try again.", keepInput: true });
    }
    const next = reviseMod(prev, { prompt: opts.note || request, css: res.css || "", js: res.js || "" });
    S.draft = Object.assign(next, { saved: null, saving: null, secs, attempts: res.attempts, model: S.label });
    setCss(id, next.css);
    await Effect.finish(true);
  } else {
    Object.assign(S.draft, { title: res.title || request.slice(0, 40), css: res.css || "", js: res.js || "", secs, attempts: res.attempts, model: S.label, updated: new Date().toISOString() });
    setCss(id, S.draft.css);
    await Effect.finish(res.ok);
    if (Ask.handle(id, res)) return; // Ask and find: an answer, not a mod (61-ask.js)
    if (!res.ok) {
      setCss(id, "");
      call("off", { modId: id }).catch(() => {}); // a failed attempt's JS may have left nodes, observers or timers
      if (res.cancelled) return onCancelled(id); // Stop: 50-bar.js
      S.phase = "error";
      bar.classList.add("err");
      hint.innerHTML = `That didn't work: <i>${esc(plainError(res.error).slice(0, 120))}</i>`;
      hint.title = res.error || "";
      actions.innerHTML = `<button data-a="again">Try again</button>`;
      return;
    }
  }
  if (S.target) boxTo(S.target, selBox);
  selBox.hidden = true;
  S.after = { shot: await capture(), rect: S.target?.isConnected ? R(S.target.getBoundingClientRect()) : null, focus: focus?.isConnected ? R(focus.getBoundingClientRect()) : null };
  if (!prev) call("clip.stop", { modId: id }).then(c => { if (c) S.draft.clip = c; }).catch(() => {});
  showResult(S.draft);
}

// The result: the title, how it went, and what you can do next. The input
// stays open for a follow-up.
function showResult(d, { note = "", error = "", keepInput = false } = {}) {
  S.phase = "result";
  bar.classList.remove("err", "working");
  bar.classList.add("done");
  input.disabled = false;
  input.placeholder = REFINE_PLACEHOLDER;
  if (!keepInput) setInput("");
  const n = versionsOf(d).length + 1;
  const meta = note || [d.secs && !d.saved ? `${d.secs}s` : "", d.attempts > 1 && !d.saved ? "needed a second try" : "", n > 1 ? `version ${n}` : ""].filter(Boolean).join(" · ");
  hint.title = error;
  hint.innerHTML = error
    ? `<b class="ok">${esc(d.title)}</b> <span class="note">That didn't work: ${esc(error).slice(0, 120)}</span>`
    : `<b class="ok">${esc(d.title)}</b> <span class="dim">${esc(meta || (d.saved ? "describe what to change" : ""))}</span>`;
  ticker.textContent = "";
  actions.innerHTML = d.saved
    ? `<button data-a="code">Edit code</button><button data-a="keep">Done</button>`
    : `<button data-a="keep" class="primary">Save <kbd>↵</kbd></button><button data-a="undo">Undo</button><button data-a="code">Edit code</button><button data-a="share">Share</button>`;
  updateChips();
  input.focus({ preventScroll: true });
}

// Leaving the result (opening the bar fresh, an error) puts the usual words back.
new MutationObserver(() => {
  if (!bar.classList.contains("done") && S.phase !== "working" && input.placeholder === REFINE_PLACEHOLDER) input.placeholder = PLACEHOLDER;
}).observe(bar, { attributes: true, attributeFilter: ["class", "hidden"] });

const onEvent = fn => { listeners.add(fn); return () => listeners.delete(fn); };
let tickBuf = "";
function tick(t) {
  tickBuf = (tickBuf + t).replace(/\s+/g, " ").slice(-64);
  ticker.textContent = tickBuf;
}

// ---- refine
function refine(text) {
  const d = S.draft;
  if (!d || S.phase !== "result" || !text) return;
  hintNote = "";
  Voice.cancel();
  hideMenu();
  showPane("");
  sugEl.hidden = true;
  PromptHistory.add(text);
  submit(text, { from: d, base: { prompt: d.prompt || d.request, css: d.css, js: d.js } });
}
// While a follow-up is typed, Enter refines (and Save drops its ↵).
const markRefining = () => bar.classList.toggle("refining", S.phase === "result" && !!input.value.trim());
input.addEventListener("input", markRefining);
new MutationObserver(markRefining).observe(bar, { attributes: true, attributeFilter: ["class"] });
input.addEventListener("keydown", e => {
  if (S.phase !== "result" || e.isComposing || e.keyCode === 229) return;
  if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const v = input.value.trim();
    v ? refine(v) : keep();
  }
});
goBtn.addEventListener("click", () => {
  if (S.phase !== "result") return;
  const v = input.value.trim();
  v ? refine(v) : keep();
});

// ⌘Z / Ctrl+Z after a result: one version back. Typing in the input keeps the
// usual text undo; God mode's own ⌘Z only runs while nothing is showing a result.
listen("keydown", e => {
  if (!e.isTrusted || !S.open || S.phase !== "result" || !modal.hidden) return;
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z") return;
  if (root.activeElement === input && input.value) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  stepBackDraft();
}, true);

async function stepBackDraft() {
  const d = S.draft;
  if (!d) return;
  const back = stepBack(d);
  if (!back) {
    if (!d.mod) return undo(); // the first version of a new change: same as Undo
    return showResult(d, { note: "This is the first version" });
  }
  S.draft = Object.assign(back, { saved: null, saving: null });
  await showVersion(d.id, back);
  showResult(back, { note: `Back to version ${versionsOf(back).length + 1}` });
}

// ---- refine or fix a saved mod (from the Mods panel)
function draftFromMod(m) {
  return { id: m.id, request: m.prompt, prompt: m.prompt, ctx: null, title: m.title, css: m.css, js: m.js,
    history: versionsOf(m), refined: m.refined, updated: m.updated, mod: m, saved: m };
}
function openOnMod(m) {
  panel.hidden = true;
  if (S.open && S.phase === "working") return false;
  if (S.open) closeBar();
  openBar();
  call("clip.cancel").catch(() => {});
  S.picking = false;
  hl.hidden = true;
  let el = null;
  try { el = m.target?.selector ? document.querySelector(m.target.selector) : null; } catch {}
  S.target = el && !el.closest("[data-morse-ui]") ? el : null;
  chip.hidden = !S.target;
  if (S.target) { chip.querySelector("span").textContent = describe(S.target); placeBar(S.target.getBoundingClientRect()); }
  S.draft = draftFromMod(m);
  return true;
}
function refineMod(m) {
  if (!openOnMod(m)) return;
  showResult(S.draft);
}
function fixMod(m, problem) {
  if (!openOnMod(m)) return;
  const d = S.draft;
  S.phase = "result";
  submit(m.prompt, { from: d, note: FIX_NOTE, base: { prompt: m.prompt, css: m.css, js: m.js, error: problem } });
}

// ---- keep, undo
async function keep() {
  const d = S.draft;
  if (!d) return null;
  if (d.saved) {
    if (S.phase === "result" && S.draft === d) { S.phase = "idle"; closeBar(); } // "Done" on a saved mod
    return d.saved;
  }
  if (d.saving) return d.saving; // Save then Share (or a double click) saves once
  d.saving = (async () => {
    if (d.mod) {
      // Refined a saved mod: same mod, new version.
      const m = { ...d.mod, title: d.title || d.mod.title, css: d.css, js: d.js, history: versionsOf(d), updated: d.updated || new Date().toISOString() };
      if (d.refined) m.refined = d.refined; else delete m.refined;
      if (m.paused) { delete m.paused; m.enabled = true; } // guard hook: a fixed paused mod runs again (64-guard.js)
      const saved = (await call("mods.save", { mod: m })) || m;
      S.mods = S.mods.map(x => (x.id === saved.id ? saved : x));
      return saved;
    }
    const saved = await call("mods.save", { draft: { id: d.id, title: d.title, prompt: d.request, css: d.css, js: d.js, url: location.href, app: S.app, target: d.ctx?.target, model: d.model,
      ...(d.history?.length ? { history: d.history } : {}), ...(d.refined ? { refined: d.refined } : {}) } });
    S.mods.push(saved);
    return saved;
  })();
  let mod;
  try { mod = await d.saving; } finally { d.saving = null; }
  d.saved = mod;
  d.mod = mod;
  Health.ran(mod, { ok: true }); // it ran fine just now; check it keeps finding its elements
  Heal.kept(mod); // self-heal hook: remember what it changes (71-heal.js)
  S.phase = "idle";
  closeBar();
  const n = versionsOf(mod).length + 1;
  toast(n > 1 ? `Saved “${mod.title}”. This is version ${n}.` : `Saved “${mod.title}”. It will be here next time.`);
  return mod;
}
async function undo() {
  const d = S.draft;
  if (!d) return;
  if (d.mod) {
    // Editing a saved mod: Undo goes back to the saved version.
    await showVersion(d.id, d.mod);
    S.draft = null;
    S.phase = "idle";
    closeBar();
    toast("Back to the saved version");
    return;
  }
  await removeMod(d.id);
  S.draft = null;
  closeBar();
  toast("Change undone");
}
