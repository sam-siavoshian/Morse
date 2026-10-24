// The design eval's judge: a strong model looks at the page before and after
// each version of a change (and the same part in the app's other theme, where
// the eval can switch it) and scores how native each version looks. The
// versions are shown in a shuffled order under neutral letters, with their
// code. The prompt and rubric are also in evals/design/README.md.

export const RUBRIC = [
  ["native", "Native look: colors and theme variables. Uses the app's own palette (its CSS variables or exact colors), not foreign colors."],
  ["typography", "Typography match: font family, size, weight and line height match the app's own text of the same role."],
  ["spacing", "Spacing and alignment: padding, height, gaps and alignment match the neighbors; sits on the app's grid; nothing cramped or floating."],
  ["theme", "Dark/light correctness: readable and consistent in the current theme, and (where shown, or as the code suggests) it follows the other theme too: no hard-coded colors that break it."],
  ["polish", "Polish: looks finished and deliberate: hover/focus states, icons from the app's icon set (not emoji unless the app uses emoji), sensible empty states and labels."],
  ["bugs", "No visual bugs: nothing overlapping, clipped, misaligned, broken or covering the app's content; the rest of the app is not disturbed. 5 means none at all."],
];

export const JUDGE_PROMPT = `You are a senior product designer reviewing changes made to a real app by a tool that edits apps with CSS and JavaScript. For one request, you see the app before the change and after each version of the change (labeled with letters, in no particular order), and the code of each version.

Score each version from 1 to 5 on each item, judging only what you can see and what the code implies:
${RUBRIC.map(([k, d]) => `- ${k}: ${d}`).join("\n")}

Scale: 5 = indistinguishable from something the app's own designers shipped; 4 = native with a small slip; 3 = acceptable but visibly added on; 2 = clearly foreign or sloppy; 1 = broken, or no visible change at all.
A version that made no visible change gets 1 on every item. Be strict and consistent across versions: compare them with each other and with the app itself. Ignore whether the feature works when clicked (that is tested separately); judge how it looks and fits.

Reply with only JSON, no prose before or after:
{"A": {"native": n, "typography": n, "spacing": n, "theme": n, "polish": n, "bugs": n, "note": "<one short sentence>"}, "B": {...}, ...}`;

// Deterministic shuffle per case, so a rerun shows the versions in the same order.
export function shuffled(list, seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The judge's reply -> { A: { native, ..., note }, ... } with only numbers 1-5 kept.
export function parseVerdict(text, labels) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("the judge's reply has no JSON");
  const raw = JSON.parse(m[0]), out = {};
  for (const l of labels) {
    const v = raw[l];
    if (!v) throw new Error(`the judge's reply has no scores for ${l}`);
    out[l] = { note: String(v.note || "").slice(0, 300) };
    for (const [k] of RUBRIC) { const n = Math.round(+v[k]); if (!(n >= 1 && n <= 5)) throw new Error(`bad ${k} score for ${l}: ${v[k]}`); out[l][k] = n; }
  }
  return out;
}

export const mean = scores => RUBRIC.reduce((s, [k]) => s + scores[k], 0) / RUBRIC.length;
