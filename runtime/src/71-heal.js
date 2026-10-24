// Self-heal: mods that keep working when the site changes.
//   - when a mod is saved, Heal.kept() records a small fingerprint of what it
//     changed (core/heal.js makeFingerprint: its selectors and how many
//     elements each found). Older and installed mods get one the first time
//     they work on a visit.
//   - on later visits, once the page has loaded and gone quiet, the same
//     selectors are counted again (never on every frame: one pass after idle,
//     and a second one a few seconds later to confirm). When nothing the mod
//     used to change is on the page any more, it "stopped working after this
//     site changed": a small dot on the Morse mark (the bar, the Mods panel,
//     the extension's toolbar button) and a note with Fix it on its panel row.
//     Nothing pops up over the page.
//   - Fix it is the panel's usual fixMod (60-generate.js): the model gets the
//     original request, the code, what used to match and the page as it is
//     now, and the result shows for review with Save and Undo. The old
//     version stays in History.
//   - Settings → "Fix my mods automatically when a site changes" (off by
//     default) fixes in the background and says so, with Undo.
//   - a fixed gallery mod offers to share the fix (core/heal.js fixIssue).
//
// Hooks (one marked line each): 97-boot.js (Heal.soon after boot and on a new
// URL), 60-generate.js keep (Heal.kept), 70-panel.js (the note's lead, and
// healRowHtml), 56-settings.js (the switch), 10-dom.js (HEAL_CSS).

const Heal = (() => {
  const QUIET = 1200;     // the page counts as settled after this long with no new elements
  const MAX_WAIT = 15000; // a page that never goes quiet is checked anyway
  const CONFIRM = 3000;   // a mod has to look broken twice, this far apart
  const LEAD = () => t("heal.lead");
  const AUTO_NOTE = () => t("heal.autoNote");
  // A newest version that is a fix (Fix it, or the automatic one), in any language Morse speaks.
  const FIX_NOTES = () => LANGUAGES.flatMap(l => [t("result.fixNote", {}, l.code), t("heal.autoNote", {}, l.code)]);
  const NOT_OURS = "[data-morse-ui],[data-morse]";
  const TRANSIENT = "dialog,[role=dialog],[role=alertdialog],[aria-modal=true],[popover],[role=menu],[role=listbox],[role=tooltip]";
  const st = new Map(); // id -> { state: "broken", lead, reason, error (lazy), lost, code }
  let pending = null, badged = -1;

  // ---- counting
  function countOf(sel) {
    let list;
    try { list = document.querySelectorAll(sel); } catch { return null; }
    let n = 0, rest = 0;
    for (const el of list) {
      if (el.closest(NOT_OURS)) continue;
      n++;
      if (!el.closest(TRANSIENT)) rest++;
      if (n >= 9999) break;
    }
    return { n, rest };
  }
  function measure(sels) {
    const counts = {}, transient = [];
    for (const s of sels) {
      const c = countOf(s);
      counts[s] = c ? c.n : 0;
      if (c && c.n && !c.rest) transient.push(s);
    }
    return { counts, transient };
  }
  const pageSize = () => document.body?.getElementsByTagName("*").length || 0;
  const here = () => ({ url: location.href, size: pageSize() });

  function fingerprintNow(m) {
    const { counts, transient } = measure(selectorsIn(m));
    return makeFingerprint(m, counts, { ...here(), transient });
  }
  async function saveFp(m, fp) {
    const next = { ...m, fp };
    const saved = (await call("mods.save", { mod: next }).catch(() => null)) || next;
    S.mods = S.mods.map(x => (x.id === saved.id ? saved : x));
    return saved;
  }

  // ---- waiting for the page to settle: loaded, then no new elements for a
  // moment, then an idle callback. A timer checks twice a second; the
  // observer only notes the time.
  const idle = fn => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => fn(), { timeout: 2000 }) : setTimeout(fn, 200));
  function settle() {
    return new Promise(resolve => {
      const begin = () => {
        const start = Date.now();
        let last = start;
        const mo = new MutationObserver(() => { last = Date.now(); });
        mo.observe(document.documentElement, { childList: true, subtree: true });
        const tick = () => {
          const now = Date.now();
          if (now - last >= QUIET || now - start > MAX_WAIT) { mo.disconnect(); idle(resolve); }
          else setTimeout(tick, 500);
        };
        setTimeout(tick, 500);
      };
      if (document.readyState === "complete") begin(); else listen("load", begin, { once: true });
    });
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- the check
  const checkable = m => m.enabled && !modHeld(m) && !!(m.css.trim() || m.js.trim()) && m.kind !== "style"; // your-style hook: never flagged

  // One pass over the mods: learn fingerprints that are missing, and return
  // the ones that look broken now ({ id -> { mod, lost } }) and the ones that
  // look fine (out.fine).
  async function pass(only = null, learn = true) {
    const out = new Map();
    out.fine = new Set();
    const page = { path: pagePathShape(location.href), size: pageSize() };
    for (const m of S.mods.filter(checkable)) {
      if (only && !only.has(m.id)) continue;
      if (!fingerprintCurrent(m)) {
        if (!learn) continue;
        const fp = fingerprintNow(m);
        if (fp) await saveFp(m, fp); // it works here: remember what it changed
        continue;
      }
      const { counts } = measure(m.fp.sels.map(x => x[0]));
      let seen = [], errors = 0;
      if (m.js.trim()) {
        const stats = await call("stats", { modId: m.id }).catch(() => null); // core/kit.js __stats
        seen = (stats?.watches || []).filter(w => w.total > 0).flatMap(w => String(w.selector).split(",").map(s => s.trim()));
        errors = stats?.errors || 0;
      }
      const a = assessFingerprint(m.fp, { ...page, counts, seen, errors });
      if (a.verdict === "broken") out.set(m.id, { mod: m, lost: a.lost });
      else if (a.verdict === "ok") { out.fine.add(m.id); st.delete(m.id); } // (again: a late load)
    }
    return out;
  }

  async function run() {
    await settle();
    if (!live()) return;
    const href = location.href, was = [...st.keys()].join();
    let broken = await pass();
    if (broken.size) {
      await sleep(CONFIRM);
      await settle();
      if (!live() || location.href !== href) return;
      broken = await pass(new Set(broken.keys()), false);
    }
    for (const [id, { mod, lost }] of broken) mark(mod, lost);
    // redraw the panel only when something changed: a redraw drops keyboard focus
    if ([...st.keys()].join() !== was) paint(); else dot();
    if (PREFS.autoFix) for (const [id] of broken) await autoFix(id);
  }
  // Asked again while a check runs (a single-page app moved on): one more after it.
  let again = false;
  function soon() {
    if (!live()) return null;
    if (pending) { again = true; return pending; }
    pending = run().catch(e => console.warn("[morse] self-heal", e)).finally(() => {
      pending = null;
      if (again) { again = false; soon(); }
    });
    return pending;
  }

  function mark(m, lost) {
    const s = { state: "broken", lead: LEAD(), reason: siteChangedReason(m), lost, code: modCodeHash(m), fp: m.fp, note: null };
    // What the model gets (core/prompt.js basePrompt "What went wrong"),
    // worked out only when Fix it is pressed.
    Object.defineProperty(s, "error", { enumerable: true, get() { return s.note || (s.note = siteChangedNote(m.fp, lost, candidates(lost))); } });
    st.set(m.id, s);
  }
  const brokenMods = () => S.mods.filter(m => m.enabled && st.get(m.id)?.state === "broken");

  // ---- what the old selectors probably became: elements whose classes, id
  // or attributes share words with them ("album-grid" -> "release-grid").
  function candidates(lost) {
    const words = [...new Set(lost.flatMap(([s]) => selectorWords(s)))];
    if (!words.length || !document.body) return [];
    const els = document.body.getElementsByTagName("*");
    const groups = new Map();
    for (let i = 0; i < Math.min(els.length, 5000); i++) {
      const el = els[i];
      if (el.closest(NOT_OURS)) continue;
      const names = [el.getAttribute("class"), el.id, ...[...el.attributes].filter(a => /^(data-|aria-label|name|role)/.test(a.name)).map(a => a.value)].filter(Boolean).join(" ");
      const score = candidateScore(words, names);
      if (!score) continue;
      const key = `${el.tagName}|${el.getAttribute("class") || ""}|${el.getAttribute("data-testid") || ""}`;
      const g = groups.get(key);
      if (g) g.count++; else groups.set(key, { el, score, count: 1 });
    }
    return [...groups.values()].sort((a, b) => b.score - a.score || b.count - a.count).slice(0, 4)
      .map(g => ({ selector: selectorFor(g.el), count: g.count, html: snippet(g.el).replace(/\s+/g, " ").slice(0, 400) }));
  }

  // ---- the dot on the Morse mark
  function dot() {
    const n = brokenMods().length;
    if (bar.hasAttribute("data-heal") !== n > 0) bar.toggleAttribute("data-heal", n > 0);
    if (panel.hasAttribute("data-heal") !== n > 0) panel.toggleAttribute("data-heal", n > 0);
    logo.title = n ? t("heal.dot", { n }) : "";
    if (S.mode === "extension" && n !== badged) { badged = n; call("heal.badge", { count: n }).catch(() => {}); } // the toolbar button
  }
  function paint() {
    dot();
    if (!panel.hidden) renderPanel();
  }
  // Turning a mod off or deleting it re-renders the panel: the dot follows.
  new MutationObserver(dot).observe(panel, { childList: true });

  // ---- saved: a new version, a new fingerprint. A fix of a gallery mod
  // offers to share it.
  function kept(mod) {
    const was = st.get(mod.id);
    st.delete(mod.id);
    if (was) paint();
    idle(async () => {
      const m = S.mods.find(x => x.id === mod.id) || mod;
      const fp = fingerprintNow(m);
      if (fp) await saveFp(m, fp);
    });
    if (was && galleryIdOf(mod) && mod.refined) setTimeout(() => offerShare(mod), 0);
  }

  // ---- auto-fix (Settings): in the background, once per version per tab
  async function autoFix(id) {
    const m = S.mods.find(x => x.id === id);
    const s = st.get(id);
    if (!m || !s || !checkable(m) || (S.draft?.id === id && S.open)) return;
    const key = `morse:heal:${id}:${s.code}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch {}
    const ctx = context();
    delete ctx.target; // what the bar points at has nothing to do with this mod
    let res;
    try { res = await call("generate", { genId: id, request: m.prompt, context: ctx, base: { prompt: m.prompt, css: m.css, js: m.js, error: s.error } }); }
    catch (e) { res = { ok: false, error: e.message }; }
    const next = res?.ok && (res.css?.trim() || res.js?.trim()) ? reviseMod(m, { prompt: AUTO_NOTE(), css: res.css || "", js: res.js || "" }) : null;
    if (next) setCss(id, next.css);
    const fp = next && fingerprintNow(next);
    if (!fp) { await showVersion(id, m); return; } // no fix, or one that finds nothing either: leave the note
    const saved = await saveFp(next, fp);
    st.delete(id);
    paint();
    const undo = [t("btn.undo"), () => undoFix(saved, s)];
    controlToast(t("heal.fixed", { title: saved.title }), galleryIdOf(saved) ? [undo, [t("heal.share"), () => shareFix(saved)]] : [undo]);
  }
  async function undoFix(m, s) {
    const back = stepBack(m);
    if (!back) return;
    back.fp = s.fp; // what it changed before the site did
    const saved = (await call("mods.save", { mod: back }).catch(() => null)) || back;
    S.mods = S.mods.map(x => (x.id === saved.id ? saved : x));
    await showVersion(saved.id, saved);
    st.set(saved.id, s);
    paint();
    toast(t("heal.back"));
  }

  // ---- sharing a fix of a gallery mod: the gallery's submit flow (a
  // prefilled GitHub issue, core/gallery.js), titled as a fix.
  function offerShare(m) {
    controlToast(t("heal.savedFix", { title: m.title }), [[t("heal.share"), () => shareFix(m)]]);
  }
  async function shareFix(m) {
    const cur = S.mods.find(x => x.id === m.id) || m;
    const r = fixIssue(cur, { site: S.appName || location.host }, submitIssue);
    let file = null;
    if (r.attached) file = await call("share", { mod: forGallery(cur), kind: "json" }).catch(() => null);
    try {
      await call("open", { url: r.url });
      toast(r.attached ? t("heal.issueFile", { path: file?.path ? ` (${file.path})` : "" }) : t("heal.issue"));
      const saved = { ...cur, fixShared: modCodeHash(cur) };
      await call("mods.save", { mod: saved }).catch(() => null);
      S.mods = S.mods.map(x => (x.id === saved.id ? saved : x));
      if (!panel.hidden) renderPanel();
    } catch (e) { toast(t("gl.githubFailed", { error: plainError(e) })); }
  }
  // A gallery mod whose newest version is a fix, not shared yet.
  function rowHtml(m) {
    if (!galleryIdOf(m) || st.has(m.id) || !FIX_NOTES().includes(m.refined || "") || m.fixShared === modCodeHash(m)) return "";
    return `<div class="health heal-fixed" role="status"><p><b>${t("heal.fixedLead")}</b> ${t("heal.othersMayNeed")}</p><button data-a="heal-share">${t("heal.share")}</button></div>`;
  }
  panel.addEventListener("click", e => {
    const b = e.target.closest("[data-a=heal-share]");
    const m = b && S.mods.find(x => x.id === b.closest("article")?.dataset.id);
    if (m) shareFix(m);
  });

  // The panel's "not working" note (70-panel.js) shows this one first.
  const healthGet = Health.get;
  Health.get = id => (st.get(id)?.state === "broken" ? st.get(id) : healthGet(id));
  // Opening the panel takes another quick look: the page may have caught up.
  new MutationObserver(() => {
    if (panel.hidden || !st.size) return;
    const before = st.size;
    pass(new Set(st.keys()), false).then(() => { if (st.size !== before) paint(); }).catch(() => {});
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  return { soon, kept, paint, rowHtml, state: () => st, AUTO_NOTE };
})();

function healRowHtml(m) { return Heal.rowHtml(m); } // 70-panel.js hook
