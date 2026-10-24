// Polish: after a change that adds or restyles something is on the page, the
// model looks at a picture of it, in the app, and fixes what doesn't look like
// it shipped with the app. One round, and only when it's worth the seconds:
//   - the person's "Polish changes" setting (core/prefs.js, on by default)
//   - a change that adds UI or restyles a part (wantsPolish); a small CSS tweak
//     (hide this, bigger text) skips it
//   - the host can take the picture (review(): desktop over CDP with a clip,
//     the extension crops captureVisibleTab), and the model can see pictures
// The reply is "OK", or FIX: lines and the complete new version. The new
// version replaces the draft only when it runs cleanly; otherwise the draft
// that already worked goes back on the page.

import { buildMessages } from "./prompt.js";
import { parseModResponse } from "./parse.js";
import { streamChat } from "./providers.js";
import { draftHarm } from "./guard.js";

export const POLISH_ASK = `This picture shows your change applied in the app, with what is around it. Does it look like it shipped with the app: its colors and variables, fonts and sizes, spacing and alignment, icons, light/dark mode? Is anything broken (overlapping, clipped or misaligned, unreadable, out of place)?
If it looks native and nothing is broken, reply with only: OK
Otherwise list each concrete problem on its own FIX: line, then reply with the complete new version (all of its CSS and JS) in the same format. Fix how it looks; keep what it does.`;

// Words that ask for something new, or a new look.
const ADDS = /\b(add|adds|adding|new|create|make|build|put|show|insert|include|give)\b[^.]*\b(button|panel|bar|timer|badge|count|counter|widget|menu|list|toolbar|tab|card|banner|indicator|section|box|field|input|view|clock|progress|tooltip|toggle|switch|label|link|icon|summary|preview|filter|search|picker|overlay|popup|dialog|sidebar|footer|header)s?\b/i;
const RESTYLE = /\b(restyle|redesign|style|styling|look|looks|theme|prettier|nicer|cleaner|modern|compact|denser|polish|tidy|layout|re-?arrange|card|cards)\b/i;
const MAKES = /morse\.el\(|createElement\(|insertAdjacent(?:HTML|Element)|innerHTML\s*=|\.append(?:Child)?\(|\.prepend\(|\.before\(|\.after\(/;

// Is this change worth a look? Adds UI (or the words ask for it), or restyles
// with more than a few declarations. A tweak (hide this, bigger text, one
// color) isn't.
export function wantsPolish(draft, request = "") {
  const css = String(draft?.css || "").replace(/\/\*[\s\S]*?\*\//g, ""), js = String(draft?.js || "");
  const decls = (css.match(/[\w-]+\s*:[^;{}]+/g) || []).length;
  const hidesOnly = decls > 0 && !js.trim() && (css.match(/display\s*:\s*none|visibility\s*:\s*hidden/g) || []).length >= decls;
  if (hidesOnly) return false;
  if (MAKES.test(js)) return true;
  if (ADDS.test(request) && (js.trim() || /content\s*:/.test(css))) return true;
  return RESTYLE.test(request) && decls >= 4;
}

// The messages for the look: the same request and page, the draft as the
// model wrote it, then the picture and the question.
export function polishMessages({ request, context, base, raw, shot }) {
  return [
    ...buildMessages({ request, context, base }),
    { role: "assistant", content: raw },
    { role: "user", content: [
      { type: "image", source: { type: "base64", media_type: shot.mediaType || "image/png", data: shot.data } },
      { type: "text", text: POLISH_ASK },
    ] },
  ];
}

const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
const fixesIn = text => [...String(text).matchAll(/^\s*FIX:\s*(.+)$/gm)].map(m => m[1].trim().slice(0, 200)).slice(0, 8);

// One round. draft: { title, css, js } as it is on the page now; raw: the
// model's reply that made it. Returns { verdict, ms, shotMs, fixes, draft?, raw?, error? }:
//   "ok"       the model says it looks native: keep the draft
//   "fixed"    the new version is on the page (draft, raw)
//   "kept"     the new version wasn't better (no code, a guard hit, an error
//              when it ran): the draft is back on the page
//   "noshot"   no picture (the host couldn't take one)
//   "error"    the model call failed (or can't see pictures): the draft stays
export async function polishRound({ settings, request, context, base, raw, draft, review, exec, emit, signal, check, timeoutMs = 60_000 }) {
  const t0 = Date.now();
  const shot = await withTimeout(Promise.resolve().then(() => review(draft)).catch(() => null), 8000);
  const shotMs = Date.now() - t0;
  if (!shot?.data) return { verdict: "noshot", ms: Date.now() - t0, shotMs };
  if (signal?.aborted) return { verdict: "error", ms: Date.now() - t0, shotMs, error: "stopped" };
  emit?.({ type: "phase", phase: "polishing" });
  let reply = "";
  try {
    reply = await streamChat({ ...settings, timeoutMs: Math.min(settings.timeoutMs || timeoutMs, timeoutMs) }, polishMessages({ request, context, base, raw, shot }), { signal });
  } catch (e) {
    return { verdict: "error", ms: Date.now() - t0, shotMs, error: String(e?.message || e) };
  }
  const ms = () => Date.now() - t0;
  const fixes = fixesIn(reply);
  const next = parseModResponse(reply);
  if (/^\s*OK\b/i.test(reply) && !next.css.trim() && !next.js.trim()) return { verdict: "ok", ms: ms(), shotMs, fixes: [] };
  if (!next.css.trim() && !next.js.trim()) return { verdict: "ok", ms: ms(), shotMs, fixes };
  // Keep what it does: a new version that drops the draft's JS isn't a polish.
  const why = (draft.js.trim() && !next.js.trim() ? "the new version dropped the JS" : null)
    || draftHarm(next, `${request} ${base?.prompt || ""}`)?.model
    || (check ? check(next) : null);
  if (why) return { verdict: "kept", ms: ms(), shotMs, fixes, error: why };
  if (signal?.aborted) return { verdict: "error", ms: ms(), shotMs, error: "stopped" };
  emit?.({ type: "css", css: next.css });
  if (next.js.trim() || draft.js.trim()) {
    const res = await exec(next.js).catch(e => ({ ok: false, error: String(e?.message || e) }));
    if (!res?.ok) {
      // Put the draft that worked back.
      emit?.({ type: "css", css: draft.css });
      if (draft.js.trim()) await exec(draft.js).catch(() => {});
      return { verdict: "kept", ms: ms(), shotMs, fixes, error: res?.error || "it didn't run" };
    }
  }
  return { verdict: "fixed", ms: ms(), shotMs, fixes, draft: { ...next, title: draft.title || next.title }, raw: reply };
}
