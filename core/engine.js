// One request: prompt the model, stream CSS to the page as it arrives, run the JS,
// and if the JS throws, show the model the error and try once more.

import { buildMessages } from "./prompt.js";
import { parseModResponse, liveCss } from "./parse.js";
import { parseReply } from "./answer.js"; // Ask and find
import { streamChat } from "./providers.js";
import { selectorsIn, selectorLists } from "./heal.js"; // self-heal hook: shared selector parsing
import { cannotUndo } from "./showonce.js"; // show-once hook: ask before steps that can't be undone
import { draftHarm, cssHidesPage, collapseHarm } from "./guard.js"; // guard hook: code that would obviously break the page

// `probe(selectors)` (optional, from the host) returns { fp, unmatched }: a
// fingerprint of what the page renders and which of the given selectors match
// nothing (runtime/src/20-context.js effectProbe). With it, a change that ran
// but did nothing visible gets the repair round too.
// `collapse(css)` (optional, from the host) applies the CSS in the page for a
// moment and returns { before, after } (core/guard.js pageCollapse): a change
// that hides most of the page gets the repair round like a guard hit.
export async function runMorse({ settings, request, context, base, exec, emit, signal, maxAttempts = 2, probe, collapse }) {
  let previous = null;
  let last = null;
  const started = Date.now();
  const repairs = [];
  // Effect check: the page before the change. speed: measured while the model
  // starts; no CSS goes on the page until it's done.
  let before = null, beforeDone = !probe;
  const beforeP = probe ? probe([]).catch(() => null).then(b => { before = b; beforeDone = true; }) : null;
  // speed: when each stage happened, in ms since the call (first attempt only)
  const timing = {};
  const mark = (k, v = Date.now() - started) => { if (timing[k] == null) timing[k] = v; };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    emit({ type: "phase", phase: attempt === 1 ? "thinking" : "fixing", error: previous?.error });
    let raw = "", lastCss = "", lastAnswer = "";
    raw = await streamChat(settings, buildMessages({ request, context, previous, base }), {
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
    // Ask and find: an answer is final as soon as it's written; nothing runs.
    const answer = parseReply(raw, { final: true });
    if (answer.kind === "answer" && answer.text) {
      emit({ type: "answer", ...answer });
      return { ok: true, kind: "answer", answer, title: "", css: "", js: "", raw, attempts: attempt, ms: Date.now() - started };
    }
    const draft = parseModResponse(raw);
    await beforeP;
    // ---- guard: code that would obviously break the page never runs; the
    // model gets one more try with what was wrong (core/guard.js)
    const harm = draftHarm(draft, `${request} ${base?.prompt || ""}`);
    if (draft.css.trim() && !harm) mark("firstCss");
    emit({ type: "css", css: harm ? "" : draft.css });
    mark("modelDone");
    last = { ...draft, raw, attempts: attempt, ms: Date.now() - started, repairs, timing };
    if (harm) {
      previous = { raw, error: harm.model };
      repairs.push(harm.model);
      last = { ...last, css: "", js: "", error: harm.user };
      continue;
    }
    if (!draft.css.trim() && !draft.js.trim()) {
      previous = { raw, error: "The reply had no ```css or ```js block (or ANSWER: for a question)." };
      repairs.push(previous.error);
      continue;
    }
    // guard: CSS that hides most of the page (a class the sidebar shares with the content).
    const fell = draft.css.trim() && collapse ? collapseHarm(await collapse(draft.css).catch(() => null)) : null;
    if (fell) {
      emit({ type: "css", css: "" });
      previous = { raw, error: fell.model };
      repairs.push(fell.model);
      last = { ...last, css: "", js: "", error: fell.user };
      continue;
    }
    // Show me once: steps that can't be taken back are never done without asking.
    const sure = unasked(context, draft.js);
    if (sure) {
      previous = { raw, error: sure };
      repairs.push(sure);
      last = { ...last, css: "", js: "", error: "The change would delete, buy or send something without asking you first, so Morse didn't keep it. Try again." };
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
        continue;
      }
    }
    // ---- hooks nothing uses: JS that marks elements for CSS that isn't there,
    // or a change that only says it happened
    const dead = attempt < maxAttempts && !signal?.aborted ? deadHooks(draft, context) : null;
    if (dead) {
      if (draft.js.trim()) await exec("").catch(() => {}); // same mod id: turns the draft off
      previous = { raw, error: dead };
      repairs.push(dead);
      continue;
    }
    // ---- effect check: did the change do anything visible?
    if (before && attempt < maxAttempts && !signal?.aborted) {
      const miss = await noEffect(probe, before, draft).catch(() => null);
      if (miss) {
        if (draft.js.trim()) await exec("").catch(() => {}); // same mod id: turns the inert draft off
        previous = { raw, error: miss };
        repairs.push(miss);
        continue;
      }
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
