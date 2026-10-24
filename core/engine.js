// One request: prompt the model, stream CSS to the page as it arrives, run the JS,
// and if the JS throws, show the model the error and try once more.

import { buildMessages } from "./prompt.js";
import { parseModResponse, liveCss } from "./parse.js";
import { parseReply } from "./answer.js"; // Ask and find
import { streamChat, settingsLabel } from "./providers.js";
import { planRoute, shouldEscalate, tierLabel } from "./route.js"; // models: fast model first, the strong one when needed
import { selectorsIn, selectorLists } from "./heal.js"; // self-heal hook: shared selector parsing
import { cannotUndo } from "./showonce.js"; // show-once hook: ask before steps that can't be undone
import { draftHarm, cssHidesPage, collapseHarm } from "./guard.js"; // guard hook: code that would obviously break the page
import { wantsPolish, polishRound } from "./polish.js"; // polish: a look at the change, and one fix

// `probe(selectors)` (optional, from the host) returns { fp, unmatched }: a
// fingerprint of what the page renders and which of the given selectors match
// nothing (runtime/src/20-context.js effectProbe). With it, a change that ran
// but did nothing visible gets the repair round too.
// `collapse(css)` (optional, from the host) applies the CSS in the page for a
// moment and returns { before, after } (core/guard.js pageCollapse): a change
// that hides most of the page gets the repair round like a guard hit.
//
// models (core/route.js): with a fast and a strong model to choose from, a
// request that looks hard starts on the strong one; otherwise the fast one
// goes first and a draft it gets wrong goes to the strong one (with what was
// wrong) instead of failing. Each model change adds one attempt.
// `vet(draft)` (optional, from the host) returns a repair message for a draft
// that can't work in this app, or null: app profiles (daemon/profile.js)
// check that the commands it runs with morse.app.command exist.
//
// polish (core/polish.js): with `polish` on and `review(draft)` from the host
// (a picture of the changed part of the page: { mediaType, data }), a change
// that adds or restyles something gets one look and, if needed, one fix.
export async function runMorse({ settings, request, context, base, exec, emit, signal, maxAttempts = 2, probe, collapse, vet, review, polish = false }) {
  let previous = null;
  let last = null;
  const started = Date.now();
  const repairs = [];
  const route = planRoute(settings, request, context);
  const total = maxAttempts + route.steps.length - 1;
  let step = 0, tries = 0, escalated = false;
  const current = () => route.steps[step];
  const answered = () => ({ model: tierLabel(current(), settingsLabel), tier: current().tier || null, escalated, hard: route.hard, routeWhy: route.why });
  // After a failed attempt: the same model repairs, or the strong one takes over.
  const advance = kind => {
    if (step < route.steps.length - 1 && shouldEscalate(kind, tries)) { step++; tries = 0; escalated = true; }
  };
  // Effect check: the page before the change. speed: measured while the model
  // starts; no CSS goes on the page until it's done.
  let before = null, beforeDone = !probe;
  const beforeP = probe ? probe([]).catch(() => null).then(b => { before = b; beforeDone = true; }) : null;
  // speed: when each stage happened, in ms since the call (first attempt only)
  const timing = {};
  const mark = (k, v = Date.now() - started) => { if (timing[k] == null) timing[k] = v; };
  for (let attempt = 1; attempt <= total; attempt++) {
    const more = attempt < total;
    tries++;
    const stronger = escalated && tries === 1;
    emit({ type: "phase", phase: attempt === 1 ? "thinking" : "fixing", error: previous?.error, ...(stronger && { stronger: true }) });
    if (route.steps.length > 1 || route.hard) emit({ type: "model", label: answered().model, tier: current().tier || null });
    let raw = "", lastCss = "", lastAnswer = "";
    try {
    raw = await streamChat(current(), buildMessages({ request, context, previous, base }), {
      signal,
      // The model has the request ("ready"), or is thinking: real progress for the bar.
      onStage(st) {
        if (st.spawnMs != null) mark("spawn", st.spawnMs);
        if (st.warm != null) mark("warm", st.warm);
        mark("modelReady");
        emit({ type: "stage", stage: st.stage === "thinking" ? "thinking" : "ready" });
      },
      onToken(tok) {
        mark("firstToken");
        timing.lastToken = Date.now() - started;
        raw += tok;
        emit({ type: "token", text: tok });
        // Ask and find: an answer streams as "answer" events, never as CSS.
        const a = parseReply(raw);
        if (a.kind === "answer") {
          const key = `${a.text}\u0000${a.points.length}\u0000${a.steps.length}`;
          if (key !== lastAnswer) { lastAnswer = key; emit({ type: "answer", ...a }); }
          return;
        }
        const css = liveCss(parseModResponse(raw).css); // speed: each finished property, not only finished rules
        if (css !== lastCss && beforeDone && !cssHidesPage(css)) { lastCss = css; if (css.trim()) mark("firstCss"); emit({ type: "css", css }); } // guard hook: never show a page-hiding rule
      },
    });
    } catch (e) {
      // models: the fast model itself failed (a model name this plan doesn't
      // have, a crash): the strong one tries before giving up.
      if (signal?.aborted || e?.code === "no_model" || e?.name === "AbortError" || step >= route.steps.length - 1 || !more) throw e;
      repairs.push(String(e?.message || e)); // previous stays: the last draft and what was wrong with it
      last = { title: "", css: "", js: "", raw: "", attempts: attempt, ms: Date.now() - started, repairs, timing, error: String(e?.message || e) };
      advance("model");
      continue;
    }
    // Ask and find: an answer is final as soon as it's written; nothing runs.
    const answer = parseReply(raw, { final: true });
    if (answer.kind === "answer" && answer.text) {
      emit({ type: "answer", ...answer });
      return { ok: true, kind: "answer", answer, title: "", css: "", js: "", raw, attempts: attempt, ms: Date.now() - started, ...answered() };
    }
    const draft = parseModResponse(raw);
    await beforeP;
    // ---- guard: code that would obviously break the page never runs; the
    // model gets one more try with what was wrong (core/guard.js)
    const harm = draftHarm(draft, `${request} ${base?.prompt || ""}`);
    if (draft.css.trim() && !harm) mark("firstCss");
    emit({ type: "css", css: harm ? "" : draft.css });
    mark("modelDone");
    last = { ...draft, raw, attempts: attempt, ms: Date.now() - started, repairs, timing, ...answered() };
    if (harm) {
      previous = { raw, error: harm.model };
      repairs.push(harm.model);
      last = { ...last, css: "", js: "", error: harm.user };
      advance("guard");
      continue;
    }
    const wrong = more && vet ? vet(draft) : null; // app profiles: a command the app doesn't have
    if (wrong) {
      previous = { raw, error: wrong };
      repairs.push(wrong);
      last = { ...last, error: wrong };
      advance("guard");
      continue;
    }
    if (!draft.css.trim() && !draft.js.trim()) {
      previous = { raw, error: "The reply had no ```css or ```js block (or ANSWER: for a question)." };
      repairs.push(previous.error);
      advance("empty");
      continue;
    }
    // guard: CSS that hides most of the page (a class the sidebar shares with the content).
    const fell = draft.css.trim() && collapse ? collapseHarm(await collapse(draft.css).catch(() => null)) : null;
    if (fell) {
      emit({ type: "css", css: "" });
      previous = { raw, error: fell.model };
      repairs.push(fell.model);
      last = { ...last, css: "", js: "", error: fell.user };
      advance("guard");
      continue;
    }
    // Show me once: steps that can't be taken back are never done without asking.
    const sure = unasked(context, draft.js);
    if (sure) {
      previous = { raw, error: sure };
      repairs.push(sure);
      last = { ...last, css: "", js: "", error: "The change would delete, buy or send something without asking you first, so Morse didn't keep it. Try again." };
      advance("guard");
      continue;
    }
    if (draft.js.trim()) {
      if (signal?.aborted) throw new Error("aborted"); // stopped: never run the JS
      emit({ type: "phase", phase: "applying" });
      const res = await exec(draft.js);
      // Not run at all (Chrome's "Allow User Scripts" is off, or the practice
      // page): not the model's mistake. The CSS shows; the JS waits.
      if (res.waiting) return { ...last, ok: true, waiting: res.waiting, note: res.error };
      if (!res.ok) {
        previous = { raw, error: res.error };
        repairs.push(res.error);
        last.error = res.error;
        advance("exec");
        continue;
      }
      // dogfood (guard): code that hid most of the page, which the CSS check
      // before it lands can't see (VSCodium: a JS-only "hide the sidebar" hid
      // every part of the window).
      const after = before?.shown >= 8 && !signal?.aborted ? await probe([]).catch(() => null) : null;
      const gone = after ? collapseHarm({ before: before.shown, after: after.shown }) : null;
      if (gone) {
        await exec("").catch(() => {}); // same mod id: turns the draft off
        emit({ type: "css", css: "" });
        previous = { raw, error: gone.model.replace("your CSS hid", "your change hid") };
        repairs.push(previous.error);
        last = { ...last, css: "", js: "", error: gone.user };
        continue;
      }
    }
    // ---- class names the page notes call generated: it works now and stops
    // working with the app's next release. The kind of slip a stronger model
    // makes less (core/route.js), so it counts like a guard hit.
    const fleeting = more && !signal?.aborted ? generatedNames(draft, context) : null;
    if (fleeting) {
      if (draft.js.trim()) await exec("").catch(() => {});
      emit({ type: "css", css: "" });
      previous = { raw, error: fleeting };
      repairs.push(fleeting);
      advance("guard");
      continue;
    }
    // ---- hooks nothing uses: JS that marks elements for CSS that isn't there,
    // or a change that only says it happened
    const dead = more && !signal?.aborted ? deadHooks(draft, context) : null;
    if (dead) {
      if (draft.js.trim()) await exec("").catch(() => {}); // same mod id: turns the draft off
      previous = { raw, error: dead };
      repairs.push(dead);
      advance("effect");
      continue;
    }
    // ---- effect check: did the change do anything visible?
    if (before && more && !signal?.aborted) {
      const miss = await noEffect(probe, before, draft).catch(() => null);
      if (miss) {
        if (draft.js.trim()) await exec("").catch(() => {}); // same mod id: turns the inert draft off
        previous = { raw, error: miss };
        repairs.push(miss);
        advance("effect");
        continue;
      }
    }
    // ---- polish: the model looks at a picture of the change in the app and
    // fixes what doesn't look native, once (core/polish.js)
    if (polish && review && !base?.error && !signal?.aborted && wantsPolish(draft, request)) {
      const p = await polishRound({
        settings: current(), request, context, base, raw, draft, review, exec, emit, signal,
        check: d => generatedNames(d, context) || deadHooks(d, context) || (vet ? vet(d) : null), // the same checks a draft gets
      });
      timing.polish = p.ms;
      if (p.verdict === "fixed") last = { ...last, ...p.draft, raw: p.raw };
      last = { ...last, polish: { verdict: p.verdict, ms: p.ms, shotMs: p.shotMs, fixes: p.fixes || [], ...(p.error && { error: p.error }) } };
    }
    return { ...last, ok: true };
  }
  return { ...last, ok: false, error: last?.error || "The model's answer had no change in it. Try other words." };
}

// A class the JS adds (or a CSS variable it sets) that no CSS uses changes
// nothing: the model styled something else, or forgot the rule. Classes and
// variables the page already has (anywhere in the context) are the page's own.
export function deadHooks({ css = "", js = "" }, context) {
  if (!js.trim()) return null;
  // Only a notice ("Turned all devices off") and nothing else: the change itself is missing.
  const noCss = !css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (noCss && !js.replace(/\/\/[^\n]*/g, "").replace(/morse\.toast\((?:[^()]|\([^()]*\))*\)\s*;?/g, "").trim())
    return "It only showed a notice; nothing on the page changed. Make the change itself (add the button, element or behavior that was asked for).";
  const known = JSON.stringify(context || {}), styles = `${css}\n${js}`, out = [];
  for (const m of js.matchAll(/classList\.(?:add|toggle)\(\s*(["'`])([\w-]+)\1/g)) {
    const cls = m[2];
    if (new RegExp(`\\.${cls}(?![\\w-])`).test(styles) || known.includes(cls) || js.split(cls).length > 2) continue;
    out.push(`adds the class "${cls}"`);
  }
  for (const m of js.matchAll(/setProperty\(\s*(["'`])(--[\w-]+)\1/g)) {
    if (!styles.includes(`var(${m[2]}`) && !known.includes(m[2])) out.push(`sets the CSS variable ${m[2]}`);
  }
  if (!out.length) return null;
  return `It ran, but your JS ${[...new Set(out)].slice(0, 3).join(" and ")} and no CSS uses it, so nothing changes on screen. Add CSS rules for it (in the css block), or set the styles directly.`;
}

// When the page notes say class names are generated (runtime/src/20-context.js
// pageNotes, with the same test for what looks generated), a draft that
// selects by one of them breaks with the app's next release. A repair message,
// or null.
const HASHED = /^(css|sc|jsx|emotion|styled|svelte|chakra|mui)-|^_?[a-z0-9]{5,}$|[A-Z][a-z]+_[a-z]+__[a-zA-Z0-9]{5}/;
const looksHashed = c => (/\d/.test(c) && /[a-z]/i.test(c) && HASHED.test(c)) || /^[a-z]{1,3}[0-9][a-z0-9]{3,}$/i.test(c);
export function generatedNames(draft, context) {
  if (!/Class names here are generated/.test(String(context?.notes || ""))) return null;
  const { css, js } = selectorLists(draft);
  const used = new Set();
  for (const sel of [...css, ...js]) for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) if (looksHashed(m[1])) used.add(m[1]);
  if (!used.size) return null;
  return `It uses class names the app generates (${[...used].slice(0, 3).map(c => `.${c}`).join(", ")}). They change with every release of the app, so the change would stop working. `
    + "Use the selectors given (tags and structure), ids, aria-*/data-* attributes, roles or text instead.";
}

// Show me once (core/showonce.js cannotUndo): code made from steps that
// delete, buy or send must ask the person first with morse.confirm. A repair
// message when it doesn't, or null.
function unasked(context, js) {
  const steps = Array.isArray(context?.recording?.steps) ? context.recording.steps : [];
  const sure = steps.filter(cannotUndo);
  if (!sure.length || /\bmorse\.confirm\s*\(/.test(js || "")) return null;
  const what = sure.map(s => `“${s.label || s.text || s.key}”`).slice(0, 3).join(", ");
  return `${sure[0].n ? `Step ${sure[0].n}` : "A step"} (${what}) can't be undone, and the code never asks first. Before the first such step add: if (!(await morse.confirm("…what will happen…"))) return;`;
}

// ---- effect check helpers
// Returns a repair message when the applied draft changed nothing on the page,
// or null. Pure behavior (JS whose selectors all match, like a keyboard
// shortcut) and interaction-only CSS (:hover) legitimately change nothing yet.
async function noEffect(probe, before, draft) {
  const { css, js } = selectorLists(draft);
  const now = await probe([...new Set([...css, ...js])]);
  if (!now || now.fp !== before.fp) return null;
  const dead = new Set(now.unmatched || []);
  // With JS, CSS for state that only appears on interaction ([data-sort="asc"])
  // is fine; what matters is whether the JS found its targets, or, when it
  // names none, whether any of its CSS applies to anything at all.
  const missing = (!draft.js.trim() ? css.filter(s => dead.has(s))
    : js.length ? js.filter(s => dead.has(s))
    : css.length && css.every(s => dead.has(s)) ? css : []).slice(0, 6);
  if (missing.length) {
    return `It ran, but nothing on the page changed. These selectors match no element: ${missing.map(s => `\`${s}\``).join(", ")}. `
      + "Use only selectors that match the HTML and layout you were given.";
  }
  if (draft.js.trim() || /:(hover|focus|active|checked|focus-within|focus-visible)\b/.test(draft.css)) return null;
  return "The CSS applied but nothing on the page changed: existing rules probably win (more specific selectors, inline styles, or !important). "
    + "Target what actually sets the property (see the CSS rules given) and use !important.";
}

// Selectors a draft relies on: core/heal.js (the runtime's self-heal check reads them too).
export { selectorsIn };
