// One request: prompt the model, stream CSS to the page as it arrives, run the JS,
// and if the JS throws, show the model the error and try once more.

import { buildMessages } from "./prompt.js";
import { parseModResponse, completeCssPrefix } from "./parse.js";
import { parseReply } from "./answer.js"; // Ask and find
import { streamChat } from "./providers.js";

// `probe(selectors)` (optional, from the host) returns { fp, unmatched }: a
// fingerprint of what the page renders and which of the given selectors match
// nothing (runtime/src/20-context.js effectProbe). With it, a change that ran
// but did nothing visible gets the repair round too.
export async function runMorse({ settings, request, context, base, exec, emit, signal, maxAttempts = 2, probe }) {
  let previous = null;
  let last = null;
  const started = Date.now();
  const repairs = [];
  const before = probe ? await probe([]).catch(() => null) : null; // effect check
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    emit({ type: "phase", phase: attempt === 1 ? "thinking" : "fixing", error: previous?.error });
    let raw = "", lastCss = "", lastAnswer = "";
    raw = await streamChat(settings, buildMessages({ request, context, previous, base }), {
      signal,
      onToken(tok) {
        raw += tok;
        emit({ type: "token", text: tok });
        // Ask and find: an answer streams as "answer" events, never as CSS.
        const a = parseReply(raw);
        if (a.kind === "answer") {
          const key = `${a.text}\u0000${a.points.length}\u0000${a.steps.length}`;
          if (key !== lastAnswer) { lastAnswer = key; emit({ type: "answer", ...a }); }
          return;
        }
        const css = completeCssPrefix(parseModResponse(raw).css);
        if (css !== lastCss) { lastCss = css; emit({ type: "css", css }); }
      },
    });
    // Ask and find: an answer is final as soon as it's written; nothing runs.
    const answer = parseReply(raw, { final: true });
    if (answer.kind === "answer" && answer.text) {
      emit({ type: "answer", ...answer });
      return { ok: true, kind: "answer", answer, title: "", css: "", js: "", raw, attempts: attempt, ms: Date.now() - started };
    }
    const draft = parseModResponse(raw);
    emit({ type: "css", css: draft.css });
    last = { ...draft, raw, attempts: attempt, ms: Date.now() - started, repairs };
    if (!draft.css.trim() && !draft.js.trim()) {
      previous = { raw, error: "The reply had no ```css or ```js block (or ANSWER: for a question)." };
      repairs.push(previous.error);
      continue;
    }
    if (draft.js.trim()) {
      if (signal?.aborted) throw new Error("aborted"); // stopped: never run the JS
      emit({ type: "phase", phase: "applying" });
      const res = await exec(draft.js);
      if (!res.ok) {
        previous = { raw, error: res.error };
        repairs.push(res.error);
        last.error = res.error;
        continue;
      }
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

// Selectors a draft relies on: every CSS rule's selector list, and string
// selectors passed to morse.watch / querySelector(All) / morse.byText.
export function selectorsIn(draft) {
  const { css, js } = selectorLists(draft);
  return [...new Set([...css, ...js])].slice(0, 40);
}
function selectorLists({ css = "", js = "" }) {
  const fromCss = new Set(), fromJs = new Set();
  const clean = s => s.replace(/::(part|slotted)\([^)]*\)/g, "").replace(/::?(before|after|placeholder|selection|marker|backdrop|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)\b/g, "")
    .replace(/:(hover|focus|focus-within|focus-visible|active|visited|checked|disabled|enabled|target)\b/g, "").trim();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[^{;]*[{;]/g, "{");
  for (const m of body.matchAll(/([^{}]+)\{/g)) {
    for (const part of m[1].split(",")) {
      const s = clean(part);
      if (s && !/^(from|to|[\d.]+%)$/.test(s) && !/^:root$|^html$|^body$/.test(s)) fromCss.add(s);
    }
  }
  for (const m of js.matchAll(/(?:\b(?:watch|querySelectorAll|querySelector|byText)|\.\$\$?)\(\s*(["'`])((?:\\.|(?!\1)[^\\])+)\1/g)) {
    if (!m[2].includes("${")) for (const part of m[2].replace(/\\(.)/g, "$1").split(",")) { const s = clean(part); if (s) fromJs.add(s); }
  }
  return { css: [...fromCss].slice(0, 30), js: [...fromJs].slice(0, 20) };
}
