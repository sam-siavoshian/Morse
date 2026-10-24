// Guards: a mod that slows down, freezes or hides the page is paused, and
// Morse says why in plain words, with Turn back on and Fix it.
//   - core/kit.js pauses a running mod that goes over its budget (too slow,
//     a feedback loop, too many elements) and fires "morse:paused" on the
//     document. Guard confirms it with the host (the kit's __stats), turns the
//     mod off and saves why (mod.paused), so it stays off on the next load
//   - CSS that would hide the whole page (core/guard.js cssHidesPage) is never
//     applied, and a mod whose code hides <html> or <body> is undone
//     (guardBefore / guardAfter, around applyMod)
//   - the desktop host stops a mod that froze the page, turns it off and
//     reloads (daemon/guard.js); the extension turns it off. guardReady()
//     says so once on the next load
//   - the Mods panel row says why, with Turn back on and Fix it (fixMod, with
//     the kit's reason as what went wrong)
// "Turn back on" (or the row's switch) runs it again under the same budgets;
// for CSS that hides the page, it means the person wants that CSS.
//
// Hooks (one marked line each): 30-mods.js applyMod (guardBefore,
// guardAfter, guardPaused), 60-generate.js (showVersion, keep), 70-panel.js
// (rowHtml, toggleMod, Health), 97-boot.js (guardReady).

const Guard = (() => {
  const SLOW = "Paused because it was slowing this page down.";
  const WHY = {
    slow: [SLOW, "It kept this page busy most of the time."],
    loop: [SLOW, "It kept running again every time the page changed."],
    big: [SLOW, "It added too much to the page."],
    froze: ["Paused because it froze this page.", "Morse turned it off so the page works again."],
    endless: ["Paused because it would freeze this page.", "Its code never stops running."],
    hid: ["Paused because it hid this page.", "It would have hidden everything on the page."],
  };
  const lead = p => (WHY[p?.why] || WHY.slow)[0];
  const note = p => (p?.why === "froze" && p.reloaded ? "Morse stopped it and reloaded the page." : (WHY[p?.why] || WHY.slow)[1]);
  const because = p => lead(p).replace(/^Paused /, "").replace(/\.$/, ""); // "because it froze this page"
  const codeKey = m => cssKey(`${m.css}\n${m.js}`);

  // ---- the kit paused a mod
  const heardIds = new Set();
  let heardTimer = 0;
  document.addEventListener("morse:paused", e => {
    if (!live()) return;
    let id = null;
    try { id = JSON.parse(e.detail).id; } catch {}
    // The detail may not cross JS worlds: then every mod with code is asked.
    const ids = id ? [String(id)] : [...S.mods.filter(m => m.enabled && m.js.trim()).map(m => m.id), S.draft?.id].filter(Boolean);
    ids.forEach(x => heardIds.add(x));
    clearTimeout(heardTimer);
    heardTimer = setTimeout(checkHeard, 30);
  });
  async function checkHeard() {
    const ids = [...heardIds];
    heardIds.clear();
    for (const id of ids) {
      const stats = await call("stats", { modId: id }).catch(() => null); // core/kit.js __stats: the page can't fake this
      if (stats?.paused) await heard(id, stats.paused);
    }
  }

  // A mod's code was paused by the kit (from the event, or Health's check).
  let toldDraft = "";
  async function heard(id, p) {
    const m = S.mods.find(x => x.id === id);
    // The change being made or looked at in the bar: not saved, so nothing to turn off.
    if (!m || (S.draft?.id === id && S.phase !== "idle")) {
      // While it's being made, the model hears it and tries again (core/engine.js).
      if (S.phase === "working" || toldDraft === `${id}:${p.at}`) return;
      toldDraft = `${id}:${p.at}`;
      return controlToast(`Paused this change ${because(p)}. Try describing it another way.`);
    }
    if (!m.enabled || !S.mods.find(x => x.id === id)?.enabled || p.why === "froze") return; // a frozen page: the host turns it off and reloads
    await pause(m, p);
  }

  const pausing = new Set(); // heard from the exec result and from the event: once
  async function pause(m, p) {
    if (pausing.has(m.id)) return;
    pausing.add(m.id);
    try { await pauseNow(m, p); } finally { pausing.delete(m.id); }
  }
  async function pauseNow(m, p) {
    const next = { ...m, enabled: false, paused: { why: p.why, at: new Date().toISOString(), error: String(p.error || "") } };
    setCss(m.id, "");
    if (m.js.trim()) call("off", { modId: m.id }).catch(() => {});
    const saved = (await call("mods.save", { mod: next }).catch(() => null)) || next;
    S.mods = S.mods.map(x => (x.id === m.id ? saved : x));
    if (!panel.hidden) renderPanel();
    toastFor(saved);
  }
  function toastFor(m) {
    controlToast(`Paused “${m.title}” ${because(m.paused)}.`, [["Turn back on", () => resume(m.id)], ["Fix it", () => fix(m.id)]]);
  }

  // Turned back on by the person: no longer paused. For CSS that hides the
  // page, the person has seen what it does: don't stop that CSS again.
  function clear(m) {
    if (m.paused?.why === "hid") m.guardOk = codeKey(m);
    delete m.paused;
    return m;
  }
  async function resume(id) {
    const m = S.mods.find(x => x.id === id);
    if (!m) return;
    const next = clear({ ...m, enabled: true });
    const saved = (await call("mods.save", { mod: next }).catch(() => null)) || next;
    S.mods = S.mods.map(x => (x.id === id ? saved : x));
    await applyMod(saved);
    if (!panel.hidden) renderPanel();
    if (saved.enabled && !saved.paused && S.mods.find(x => x.id === id)?.enabled) controlToast(`“${saved.title}” is back on`);
  }
  // Fix it: the model gets the kit's reason as what went wrong (core/prompt.js).
  function fix(id) {
    const m = S.mods.find(x => x.id === id);
    if (m) fixMod(m, m.paused?.error || `Morse paused it. ${lead(m.paused)} ${note(m.paused)}`);
  }

  // ---- CSS or code that hides the whole page (from applyMod)
  const shown = el => { if (!el) return true; const s = getComputedStyle(el); return s.display !== "none" && !(+s.opacity < 0.05); };
  const pageShown = () => shown(document.documentElement) && shown(document.body);
  function before(m) {
    if (m.guardOk && m.guardOk === codeKey(m)) return {};
    if (cssHidesPage(m.css)) { pause(m, { why: "hid", error: `Morse paused it. ${draftHarm({ css: m.css }).model}` }); return null; }
    if (!m.js.trim()) return {};
    // Where a frozen page can't be stopped (the extension), code that could
    // never finish doesn't start. On the desktop the host stops it if it runs.
    const loop = S.mode !== "desktop" && draftHarm({ js: m.js });
    if (loop?.kind === "loop") { pause(m, { why: "endless", error: `Morse paused it. ${loop.model}` }); return null; }
    return { shown: pageShown(), html: document.documentElement.getAttribute("style"), body: document.body?.getAttribute("style") };
  }
  function after(m, look) {
    if (!look?.shown || pageShown()) return;
    // Its own code hid the page: put back what it changed and pause it.
    const put = (el, v) => { if (el && el.getAttribute("style") !== v) v == null ? el.removeAttribute("style") : el.setAttribute("style", v); };
    put(document.documentElement, look.html);
    put(document.body, look.body);
    pause(m, { why: "hid", error: "Morse paused it because after it ran the whole page was hidden (html or body ended up with display: none or opacity: 0). Never hide html, body, :root or *. Hide or change only the parts the user asked about." });
  }

  // ---- after a load: a mod that froze the page was turned off by the host
  function ready() {
    for (const m of S.mods) {
      const p = m.paused;
      if (m.enabled || p?.why !== "froze" || !(Date.now() - Date.parse(p.at) < 5 * 60000)) continue;
      const key = `morse:guard:${m.id}:${p.at}`;
      try { if (sessionStorage.getItem(key)) continue; sessionStorage.setItem(key, "1"); } catch {}
      toastFor(m);
    }
  }

  // ---- the Mods panel row
  function rowHtml(m) {
    const p = !m.enabled && m.paused;
    if (!p) return "";
    return `<div class="health guard" role="status"><p><b>${esc(lead(p))}</b> ${esc(note(p))}</p><button data-a="guard-on">Turn back on</button><button class="primary" data-a="guard-fix">Fix it</button></div>`;
  }
  panel.addEventListener("click", e => {
    const b = e.target.closest("[data-a=guard-on], [data-a=guard-fix]");
    const id = b?.closest("article")?.dataset.id;
    if (!id) return;
    if (b.dataset.a === "guard-on") resume(id); else fix(id);
  });

  return { heard, clear, before, after, ready, rowHtml, lead, note };
})();

// Hooks (see the top of this file).
function guardBefore(m) { return Guard.before(m); }
function guardAfter(m, look) { Guard.after(m, look); }
// An exec result the guards produced: said by the guard, not as an error.
// When the kit paused it while it started, the result says why.
function guardPaused(m, r) {
  if (!/^Morse (paused|stopped) it\b/.test(String(r?.error || ""))) return false;
  if (r.paused) Guard.heard(m.id, { why: r.paused, error: r.error });
  return true;
}
function guardReady() { Guard.ready(); }
function guardRowHtml(m) { return Guard.rowHtml(m); }
// A change Morse refused to run (core/guard.js draftHarm's plain sentence, from
// core/engine.js): said as Morse holding back, short enough for the one-line
// hint ("Try other words" is what the input and Try again are for). 60-generate.js.
function guardRefusalHint(error) {
  const m = /^The change would have (.+?), so Morse didn't (apply|run) it\./.exec(String(error || ""));
  return m ? `Morse didn't ${m[2]} it: <i>it would have ${esc(m[1])}</i>` : "";
}
function guardHeld(v) { return !!(v?.paused || v?.mod?.paused); } // a paused mod's code stays off the page
