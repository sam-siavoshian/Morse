// One request: prompt the model, stream CSS to the page as it arrives, run the JS,
// and if the JS throws, show the model the error and try once more.

import { buildMessages } from "./prompt.js";
import { parseModResponse, completeCssPrefix } from "./parse.js";
import { streamChat } from "./providers.js";

export async function runMorse({ settings, request, context, exec, emit, signal, maxAttempts = 2 }) {
  let previous = null;
  let last = null;
  const started = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    emit({ type: "phase", phase: attempt === 1 ? "thinking" : "fixing", error: previous?.error });
    let raw = "", lastCss = "";
    raw = await streamChat(settings, buildMessages({ request, context, previous }), {
      signal,
      onToken(tok) {
        raw += tok;
        emit({ type: "token", text: tok });
        const css = completeCssPrefix(parseModResponse(raw).css);
        if (css !== lastCss) { lastCss = css; emit({ type: "css", css }); }
      },
    });
    const draft = parseModResponse(raw);
    emit({ type: "css", css: draft.css });
    last = { ...draft, raw, attempts: attempt, ms: Date.now() - started };
    if (!draft.css.trim() && !draft.js.trim()) {
      previous = { raw, error: "The reply had no ```css or ```js block." };
      continue;
    }
    if (!draft.js.trim()) return { ...last, ok: true };
    emit({ type: "phase", phase: "applying" });
    const res = await exec(draft.js);
    if (res.ok) return { ...last, ok: true };
    previous = { raw, error: res.error };
    last.error = res.error;
  }
  return { ...last, ok: false, error: last?.error || "The model did not produce a usable change." };
}
