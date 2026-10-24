// Smart model routing (docs/models.md, "Quick and harder changes"). Small
// tweaks go to the first model; new UI, new behavior, restyles and drafts the
// first model got wrong go to the strong one. Always within the backend the
// person chose: Claude Code stays Claude Code (sonnet, then opus), an
// Anthropic key stays that key. Nothing here calls a model.
//
// Settings fields this reads (hosts set them; daemon/models.js, extension/background.js):
//   mode     "auto" | "fast" | "best" (prefs "modelMode"; unset = "auto")
//   tiers    { fast: { model, effort }, best: { model, effort } } or null
//   pinned   true when the person named one model (morse config --model,
//            --model on launch, the popup's helper model): routing is off
//   backend  for the "helper" provider: the provider behind it
//
// Pure and dependency-free: core/providers.js and the extension worker use it.

export const MODEL_MODES = ["auto", "fast", "best"];

// The first ("fast") and the strong ("best") model of each backend. Both are
// strong models: the UI a change adds has to look like it belongs, and small
// models don't get there. The first one is the quicker of the two.
// OpenAI: the same gpt-5, the strong one reasoning longer (reasoning_effort).
// Codex: Morse can't know which models a ChatGPT plan has, so both use the
// plan's own model and the strong one thinks longer (model_reasoning_effort).
// Names set in ~/.morse/config.json "tiers" (morse config --fast-model /
// --best-model) win, so a person who chose haiku there keeps it.
export const TIERS = {
  "claude-code": { fast: { model: "sonnet" }, best: { model: "opus" } },
  anthropic: { fast: { model: "claude-sonnet-5-5" }, best: { model: "claude-opus-5-5" } },
  openai: { fast: { model: "gpt-5" }, best: { model: "gpt-5", effort: "high" } },
  codex: { fast: { model: "", effort: "medium" }, best: { model: "", effort: "high" } },
};
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const tierOf = (d, name) => {
  const model = typeof name?.model === "string" ? name.model : typeof name === "string" && name ? name : d?.model || "";
  // A default effort belongs to its default model ("gpt-5" thinking longer):
  // another model named in its place doesn't inherit it.
  const effort = EFFORTS.includes(name?.effort) ? name.effort : d?.model && model !== d.model ? "" : d?.effort || "";
  return effort ? { model, effort } : { model };
};

// Both tiers for a provider, with names from config.json over the defaults.
// Another OpenAI-style server (OpenRouter, a local one) has its own model
// names: only names set for it count. null: nothing to choose between.
export function resolveTiers(provider, custom = {}, { baseUrl = "" } = {}) {
  let d = TIERS[provider];
  if (provider === "openai" && baseUrl && !/^https:\/\/api\.openai\.com\b/.test(baseUrl)) d = null;
  if (!d && !(custom?.fast && custom?.best)) return null;
  return { fast: tierOf(d?.fast, custom?.fast), best: tierOf(d?.best, custom?.best) };
}

// The Morse popup's Anthropic key (extension/background.js): the model picked
// there ("Model for harder changes") is the strong one, after the default
// first model. Picking any other model means that one for every change, so
// nothing steps down from it (and a person who picked haiku keeps haiku).
export function popupTiers(provider, chosen) {
  if (!chosen || chosen === TIERS[provider]?.best.model) return resolveTiers(provider);
  return resolveTiers(provider, { fast: chosen, best: chosen });
}

const sameTier = (a, b) => a.model === b.model && (a.effort || "") === (b.effort || "");
export const modeOf = s => (MODEL_MODES.includes(s?.mode) ? s.mode : "auto");
// The tiers routing can use, or null (a pinned model, or none known).
export const routable = s => (!s?.pinned && s?.tiers?.fast && s?.tiers?.best ? s.tiers : null);

// The settings for one tier. A tier with no model name keeps the
// backend's own choice ("" for Claude Code and Codex: the CLI's default).
export function tierSettings(s, tier, name) {
  const out = { ...s, model: tier.model || "", tier: name };
  if (tier.effort) out.effort = tier.effort; else if (s.provider !== "anthropic") delete out.effort;
  return out;
}

// What the person sees in the bar's footer: "Claude Code · sonnet".
export function tierLabel(s, label) {
  if (s.provider !== "helper") return label(s);
  return label({ provider: s.backend || "", model: s.model, effort: s.effort, baseUrl: "" }) || s.label;
}

// ---- Does this request need the strong model from the start? A cheap look
// at the words and at the page notes ("About this page",
// runtime/src/20-context.js), no model call. Anything that has to look and
// work like part of the app goes to the strong model up front: new UI (a
// panel, a button, a count), new behavior, a restyle or a theme. Small tweaks
// (hiding, bigger text, a color, simple CSS) stay on the first model. The
// weaker signals (data, several steps, a canvas, a page that keeps changing)
// count when there are two of them.
// New behavior (needs JS): a button that does something, a key, a search
// as you type, copying, saving, asking first, a timer, jumping somewhere.
const FEATURE = /\b(add (a|an|some) [\w ]{0,20}?button|buttons? (that|to|which)|shortcut|keyboard|press(es|ing)? \w|when i (press|click|type|hit)|let me|toggle|filter|search|cop(y|ies)|download|save (it |this |my )?[\w ]{0,12}as|export|confirm|ask (me )?(first|before)|timer|remind|jump|back to (the )?top|remember|undo|drag|as i type|live)\b/i;
// New UI: a part of the interface that isn't there yet ("add a summary
// panel", "show a word count", "put a badge on…"). Not "add a border to the
// cards" or "make the button green": the thing added has to be a new part.
const PART = "(button|panel|sidebar|side ?bar|toolbar|menu|tab|badge|widget|card|dialog|pop-?up|modal|tooltip|section|summary|overview|list|table|chart|graph|counter|count|totals?|timer|picker|switch|toggle|progress bar|link|icon|label|field|input|box|form|dropdown|slider|preview|footer|header|banner|bar|legend|index|contents|outline|breadcrumb|pagination|control|view|screen|player|editor|calendar|clock|status|indicator)s?";
const FILLER = "(?:(?!(?:to|on|in|into|under|of|around|between|for|with|at|from|the|and)\\b)[\\w'-]+ ){0,3}?";
const NEW_UI = new RegExp(`\\b(add|put|insert|create|build|give me|i (want|need|'d like)|can (i|we|you) (have|get)|show|display)( me)? (a|an|some|another|my own|new) ${FILLER}${PART}\\b|\\b(show|display|add) (how many|the (number|count|total) of)\\b`, "i");
// Restyles: the whole look, a theme, or "make it look like…". They are judged
// by how they look, which is where the strong model pays off most.
const RESTYLE = /\b(re-?style|re-?design|re-?theme|theme|(dark|light|night) (mode|theme)|looks? (like|more|less|native|modern|nicer|better|cleaner|prettier|consistent|professional|polished)|match (the|this) (app|site|page|rest|style|design)|fit in|blend in|polish(ed)?|prettier|nicer|moderni[sz]e|new look|feel native|style (it|this|them) like|(de-?)?clutter(ed)?|make (it|this|everything|the (page|site|app)) dark(er)?)\b/i;
// Working with the data: counting, totals, sorting, comparing numbers.
const DATA = /\b(sort\w*|counts?|counter|how many|total|sum|average|percent(age)?|million|thousand)\b|\b((more|less|fewer|greater) than|over|above|below|under|at least|at most) (a |an )?(\d|million|thousand|hundred)/i;
const MULTI = /\b(then|after that|and also|as well as|but only|unless|except)\b|;/i;
const EVERY = /\b(every|each|all)\b/i;
const CANVAS = /\b(canvas|drawing|sketch|png|pixels?)\b/i;
// Page notes (runtime/src/20-context.js pageNotes) that mean the change has
// to keep up with the app: lists that reuse rows, re-renders, components,
// frames, pictures drawn on a canvas.
const DYNAMIC = /virtualized list|This page re-renders|open shadow roots|Frames showing pages|Drawn on <canvas>/;

export function looksHard(request, context) {
  const text = String(request || "");
  const notes = typeof context?.notes === "string" ? context.notes : "";
  const why = [];
  const feature = FEATURE.test(text), data = DATA.test(text), every = EVERY.test(text);
  if (feature) why.push("adds behavior");
  if (NEW_UI.test(text)) why.push("new UI");
  if (RESTYLE.test(text)) why.push("a restyle");
  const strong = why.length > 0; // any one of these is enough
  if (data) why.push("works with the data");
  if (MULTI.test(text) || text.length > 140) why.push("several steps");
  if (CANVAS.test(text)) why.push("a canvas");
  // Looks on a changing page are fine (CSS keeps working); behavior, data or
  // "every item" there has to follow the app.
  if ((feature || data || every) && DYNAMIC.test(notes)) why.push("a page that keeps changing");
  return { hard: strong || why.length >= 2, why };
}

// The plan for one request: the settings to try, in order, and why.
//   { steps: [settings…], mode, hard, why }
// One step: no choice (a pinned model, one tier, "Always fast/best"). Two: the
// fast model first, then the strong one when the fast one gets it wrong.
export function planRoute(settings, request, context) {
  const s = settings || {};
  const tiers = routable(s), mode = modeOf(s);
  if (!tiers) return { steps: [s], mode: "single", hard: false, why: [] };
  const fast = tierSettings(s, tiers.fast, "fast"), best = tierSettings(s, tiers.best, "best");
  if (mode === "fast") return { steps: [fast], mode, hard: false, why: [] };
  if (mode === "best" || sameTier(tiers.fast, tiers.best)) return { steps: [best], mode, hard: false, why: [] };
  const { hard, why } = looksHard(request, context);
  return { steps: hard ? [best] : [fast, best], mode, hard, why };
}

// The model to get ready before a request exists (speed: the warm process,
// daemon/harness.js). When the bar opens: the first model, the one most
// requests start on. While the person types (request: the words so far, the
// bar's "warm" as you type): the one this request would start on, so new UI
// and features find the strong model started. Only one model waits at a time
// (a waiting Claude Code process holds about 180 MB, whichever the model);
// after each request the first model is started again.
export function warmSettings(settings, request) {
  const s = settings || {};
  const tiers = routable(s);
  if (!tiers) return s;
  if (request && modeOf(s) === "auto") return planRoute(s, request, null).steps[0];
  return modeOf(s) === "best" ? tierSettings(s, tiers.best, "best") : tierSettings(s, tiers.fast, "fast");
}

// Should the fast model's failed draft go to the strong model now?
//   kind "exec": the JS threw. The fast model gets its own repair round first.
//   anything else (a guard, the effect check, an empty or notice-only reply,
//   an error from the model itself): straight to the strong model.
export function shouldEscalate(kind, triesOnThisTier) {
  return kind !== "exec" || triesOnThisTier >= 2;
}

// The bar's footer before any model has answered: "Claude Code · Automatic",
// or the one model every request uses ("Claude Code · opus").
export function startLabel(s, label) {
  if (routable(s) && modeOf(s) === "auto") return label(s);
  return tierLabel(warmSettings(s), label);
}

// What the bar's Settings sheet says about the models (names only, no keys):
// { fast, best } to choose between, or { pinned } when one model does everything.
export function modelNames(s, label) {
  if (!s || !s.provider || s.provider === "none") return null;
  const tiers = routable(s);
  if (!tiers) return { pinned: tierLabel({ ...s, mode: "" }, label) };
  const name = t => [t.model, t.effort && `${t.effort} effort`].filter(Boolean).join(", ") || "its usual model";
  return { fast: name(tiers.fast), best: name(tiers.best) };
}
