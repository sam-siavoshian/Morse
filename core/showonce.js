// Show me once: the user does a task by hand, once, and Morse writes down the
// steps; then they say what they want ("add a button that does this", "do
// this when I press Ctrl+Shift+A", "do this to every unread email") and the
// model writes a mod that does the steps for them.
//
// Dependency-free. The runtime inlines it (runtime/bundle.js) to turn the
// user's own clicks, typing, choices and key presses into steps
// (runtime/src/64-show-once.js); core/prompt.js turns the steps into the
// model's context; core/showonce-demo.js answers for the demo model.
//
// A step: { do: "click" | "type" | "choose" | "check" | "uncheck" | "key",
//   selector, text?   the element: what `selector` matches (and, with `text`,
//                     the match whose text contains it)
//   label, role       what a person calls it ("Archive", "button")
//   value?            typed text or chosen option; never for a hidden field
//   hidden?           true for passwords and card fields: no value is kept
//   key?              for "key": "Enter", "Ctrl+Shift+A"
//   item?             when it sits in a list of similar things (emails, rows):
//                     { selector, count, index, label, attrs } }

import { t } from "./i18n.js"; // stepWords in the person's language (the runtime inlines i18n first)

export const SO_MAX_STEPS = 40;
const MAX_VALUE = 200;

// ---- fields whose values are never kept: passwords, card details, codes
const SECRET_WORDS = /pass(word|wd|code|phrase)?\b|passwd|pwd|secret|\bpin\b|cvv|cvc|csc|card.?(num|no)|cc.?(num|no)|security.?code|\bssn\b|\botp\b|one.?time|\btoken\b|api.?key|\biban\b|routing.?(num|no)|account.?(num|no)|social.?security|tax.?id|verification.?code|auth(entication)?.?code|recovery.?(code|key)|\b[2m]fa\b/i;

// ---- what never goes to the model from the page's markup in a step: values
// the person never sees (an email or a token in an attribute, a data-*
// attribute named like a secret). What they see in the strip, they chose.
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const TOKENISH = v => /^eyJ[\w-]{8,}\.[\w-]{8,}/.test(v) || /^[a-f0-9]{32,}$/i.test(v)
  || (/^[A-Za-z0-9+/=_-]{24,}$/.test(v) && /\d/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v));
const SECRET_ATTR = /token|secret|csrf|xsrf|nonce|session|auth|passw|api.?key|signature|\botp\b|\bemail\b/i;
export function privateAttr(name, value) {
  const v = String(value ?? "");
  return EMAIL.test(v) || TOKENISH(v) || SECRET_ATTR.test(String(name).replace(/^(data|aria)-/, ""));
}
export function isSecretField(el) {
  if (!el || !el.getAttribute) return false;
  if ((el.getAttribute("type") || "").toLowerCase() === "password") return true;
  const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
  if (/(^|\s)(cc-|current-password|new-password|one-time-code)/.test(ac)) return true;
  const words = [el.getAttribute("name"), el.id, el.getAttribute("aria-label"), el.getAttribute("placeholder")].filter(Boolean).join(" ").replace(/[-_]/g, " ");
  return SECRET_WORDS.test(words);
}

// ---- what kind of thing was used
const FIELD_TYPES = /^(text|search|email|url|tel|number|date|datetime-local|month|week|time|password|)$/;
export function isTextField(el) {
  if (!el || !el.localName) return false;
  if (el.localName === "textarea") return true;
  if (el.localName === "input") return FIELD_TYPES.test((el.getAttribute("type") || "").toLowerCase());
  return !!el.isContentEditable || el.getAttribute?.("role") === "textbox";
}
// A click on these is recorded by what follows it (typing, a change), not as a click.
export function isFormControl(el) {
  if (!el || !el.localName) return false;
  if (isTextField(el) || el.localName === "select") return true;
  if (el.localName === "input") return /^(checkbox|radio|range|color|file)$/.test((el.getAttribute("type") || "").toLowerCase());
  if (el.localName === "label") { const c = el.control; return !!c && isFormControl(c); }
  return false;
}

// ---- names, as a person would say them
const clean = s => String(s || "").replace(/\s+/g, " ").trim();
const short = (s, n = 40) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
function textLines(el) {
  const t = el.innerText != null && el.isConnected ? el.innerText : el.textContent;
  return String(t || "").split("\n").map(clean).filter(Boolean);
}
export function soLabelOf(el) {
  if (!el || !el.getAttribute) return "";
  const by = el.getAttribute("aria-labelledby");
  const labelled = by && clean(by.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent || "").join(" "));
  const own = clean(el.getAttribute("aria-label")) || labelled;
  if (own) return short(own);
  if (el.labels?.[0]) {
    const l = el.labels[0].cloneNode(true); // the label's words, not the options or text inside it
    l.querySelectorAll("input,select,textarea").forEach(c => c.remove());
    const t = clean(l.textContent);
    if (t) return short(t);
  }
  const attr = clean(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt"));
  if (attr) return short(attr);
  if (el.localName === "input" && /^(button|submit|reset)$/i.test(el.type)) return short(clean(el.value));
  // The first words that read as a name: rows often start with initials or an icon.
  const bare = t => clean(t).replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (el.children.length) {
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const own = bare([...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(" "));
      if (own.length >= 3) return short(own);
    }
  }
  const lines = textLines(el).map(bare).filter(Boolean);
  return short(lines.find(l => l.length >= 4) || lines[0] || "");
}
const ROLE_OF = { a: "link", button: "button", summary: "button", select: "menu", textarea: "field", option: "option", li: "list item", tr: "row", img: "image" };
export function soRoleOf(el) {
  const role = (el.getAttribute?.("role") || "").split(" ")[0];
  if (role) return { textbox: "field", searchbox: "search field", combobox: "menu", menuitem: "menu item", gridcell: "cell" }[role] || role;
  if (el.localName === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    return t === "checkbox" ? "checkbox" : t === "radio" ? "option" : /^(button|submit|reset|image)$/.test(t) ? "button" : t === "search" ? "search field" : "field";
  }
  if (el.isContentEditable) return "field";
  return ROLE_OF[el.localName] || "";
}

// ---- selectors that survive re-renders: ids, test ids, names, labels, text
const HASHED = /^(css|sc|jsx|emotion|styled|svelte|chakra|mui)-|^_?[a-z0-9]{5,}$|[A-Z][a-z]+_[a-z]+__[a-zA-Z0-9]{5}/;
const looksHashed = s => (/\d/.test(s) && /[a-z]/i.test(s) && HASHED.test(s)) || /^[a-z]{1,3}[0-9][a-z0-9]{3,}$/i.test(s);
const STATE = /^(is-|has-)?(active|selected|open|on|cur|current|hover|focus|focused|show|visible|checked|unread|read|new)$/;
const cssEsc = s => String(s).replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ");
const idEsc = s => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : String(s).replace(/[^\w-]/g, c => "\\" + c));
const ATTRS = ["data-testid", "data-test", "data-qa", "data-cy", "name", "aria-label", "placeholder", "title", "alt"];

// tag plus its first stable class, or its role: what "the same kind of thing" means
export function kindSelector(el) {
  const tag = el.localName;
  const cls = [...(el.classList || [])].find(c => !looksHashed(c) && !STATE.test(c));
  if (cls) return `${tag}.${idEsc(cls)}`;
  const role = el.getAttribute("role");
  if (role) return `${tag}[role="${cssEsc(role)}"]`;
  if (tag === "input") return `input[type="${cssEsc((el.getAttribute("type") || "text").toLowerCase())}"]`;
  return tag;
}
const LANDMARK = /^(nav|header|footer|main|aside|form|dialog)$/;
// The nearest ancestor that names itself uniquely: an id, a test id, a label, a landmark.
function anchorOf(el) {
  const doc = el.ownerDocument;
  for (let n = el.parentElement, i = 0; n && n !== doc.body && i < 8; n = n.parentElement, i++) {
    const tries = [];
    if (n.id && !looksHashed(n.id) && !privateAttr("id", n.id)) tries.push(`#${idEsc(n.id)}`);
    for (const a of ["data-testid", "data-test", "aria-label"]) {
      const v = n.getAttribute(a);
      if (v && v.length <= 60 && !looksHashed(v) && !privateAttr(a, v)) tries.push(`${n.localName}[${a}="${cssEsc(v)}"]`);
    }
    if (LANDMARK.test(n.localName)) tries.push(n.localName);
    const role = n.getAttribute("role");
    if (/^(dialog|menu|toolbar|listbox|navigation|tablist|grid|table|tree|list|form|search|banner|main)$/.test(role || "")) tries.push(`[role="${role}"]`);
    for (const s of tries) { try { if (doc.querySelectorAll(s).length === 1) return s; } catch {} }
  }
  return "";
}
// Words to find it by: its own short text, as written.
function needleOf(el) {
  if (el.localName === "input" || el.localName === "select" || el.localName === "textarea") return "";
  const lines = textLines(el);
  const all = clean(lines.join(" "));
  if (!all) return "";
  if (all.length <= 40) return all;
  const first = lines.find(l => l.length >= 3 && l.length <= 40);
  return first || "";
}
const has = (e, needle) => clean(e.textContent).toLowerCase().includes(needle.toLowerCase());
function structural(el, scope) {
  const doc = el.ownerDocument;
  const parts = [];
  for (let n = el; n && n.nodeType === 1 && n !== doc.documentElement && n !== scope && parts.length < 6; n = n.parentElement) {
    if (n.id && !looksHashed(n.id)) { parts.unshift(`#${idEsc(n.id)}`); break; }
    let s = kindSelector(n);
    const p = n.parentElement;
    if (p) {
      const same = [...p.children].filter(c => c.localName === n.localName);
      if (same.length > 1) s = `${n.localName}${s.slice(n.localName.length)}:nth-of-type(${same.indexOf(n) + 1})`;
    }
    parts.unshift(s);
    if (n === doc.body) break;
  }
  return parts.join(" > ");
}
// { selector, text }: `selector` alone finds exactly this element, or, with
// `text`, the one match whose text contains it. Inside `scope` (a list item),
// the selector is relative to that item.
export function pickSelector(el, scope = null) {
  const root = scope || el.ownerDocument;
  const q = s => { try { return [...root.querySelectorAll(s)]; } catch { return []; } };
  const only = s => { const l = q(s); return l.length === 1 && l[0] === el; };
  const tag = el.localName;
  const cands = [];
  if (el.id && !looksHashed(el.id) && !privateAttr("id", el.id) && !scope) cands.push(`#${idEsc(el.id)}`);
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && v.length <= 60 && !looksHashed(v) && !privateAttr(a, v)) cands.push(`${tag}[${a}="${cssEsc(v)}"]`);
  }
  if (el.getAttribute("role") && el.getAttribute("aria-label") && !privateAttr("aria-label", el.getAttribute("aria-label"))) cands.push(`[role="${cssEsc(el.getAttribute("role"))}"][aria-label="${cssEsc(el.getAttribute("aria-label"))}"]`);
  for (const s of cands) if (only(s)) return { selector: s, text: null };
  const kind = kindSelector(el);
  if (only(kind)) return { selector: kind, text: null };
  const needle = needleOf(el);
  const anchor = scope ? "" : anchorOf(el);
  const bases = [...new Set([anchor && `${anchor} ${kind}`, kind, anchor && `${anchor} ${tag}`, tag].filter(Boolean))];
  if (needle) {
    for (const base of bases) {
      const hits = q(base).filter(e => has(e, needle));
      if (hits.length === 1 && hits[0] === el) return { selector: base, text: needle };
    }
  }
  for (const base of bases) if (base !== kind && only(base)) return { selector: base, text: null };
  return { selector: structural(el, scope), text: null };
}

// ---- lists of similar things (emails, rows, cards): the item a step was in
const ITEMISH = /^(li|tr|article)$/;
const ITEM_ROLES = /^(option|row|listitem|treeitem|article)$/;
const CONTROL = "button,a,summary,label,input,select,textarea,[role=button],[role=link],[role=menuitem],[role=tab],[role=gridcell]";
function itemOf(el) {
  const doc = el.ownerDocument;
  for (let n = el, i = 0; n && n.parentElement && n !== doc.body && i < 7; n = n.parentElement, i++) {
    const p = n.parentElement;
    if (p === doc.documentElement) break;
    const role = n.getAttribute("role") || "";
    // A row of buttons is a toolbar, not a list of things.
    const looksItem = ITEMISH.test(n.localName) || ITEM_ROLES.test(role) || (n.children.length >= 2 && !n.matches(CONTROL));
    if (!looksItem) continue;
    const kind = kindSelector(n);
    const same = [...p.children].filter(c => kindSelector(c) === kind);
    if (same.length >= 3) return { el: n, parent: p, kind, index: same.indexOf(n), count: same.length };
  }
  return null;
}
// State that tells items apart: data-*, aria-selected/checked/expanded/pressed/current.
function stateAttrs(el) {
  const out = {};
  for (const a of el.attributes || []) {
    if (Object.keys(out).length >= 6) break;
    if (!/^(data-(?!morse)|aria-(selected|checked|expanded|pressed|current|disabled|hidden))/.test(a.name)) continue;
    if (a.value.length > 30 || privateAttr(a.name, a.value)) continue;
    out[a.name] = a.value;
  }
  return out;
}
export function describeItem(el) {
  const it = itemOf(el);
  if (!it) return null;
  const parentSel = pickSelector(it.parent).selector;
  const selector = it.parent === it.el.ownerDocument.body ? it.kind : `${parentSel} > ${it.kind}`;
  return { el: it.el, selector, count: it.count, index: it.index, label: soLabelOf(it.el), attrs: stateAttrs(it.el) };
}

// What a click acts on: the button or link around the spot clicked, or the
// list item itself when the item is what responds (a row in an inbox).
const ACTIONABLE = "a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=treeitem],[role=row],[contenteditable=''],[contenteditable=true],[onclick]";
export function actionTarget(el) {
  if (!el || el.nodeType !== 1) el = el?.parentElement;
  if (!el) return null;
  const act = el.closest(ACTIONABLE);
  if (act) return act;
  const it = itemOf(el);
  return it ? it.el : el;
}

// ---- a step from an element
export function stepFrom(el, what, extra = {}) {
  const item = describeItem(el);
  const inside = item && item.el !== el ? pickSelector(el, item.el) : null;
  const found = pickSelector(el);
  const step = { do: what, selector: found.selector };
  if (found.text) step.text = found.text;
  step.label = soLabelOf(el) || (item?.label ?? "");
  const role = soRoleOf(el);
  if (role) step.role = role;
  Object.assign(step, extra);
  if (item) {
    step.item = { selector: item.selector, count: item.count, index: item.index, label: item.label, attrs: item.attrs };
    if (inside) { step.item.inside = inside.selector; if (inside.text) step.item.insideText = inside.text; }
  }
  if (step.value != null) step.value = String(step.value).slice(0, MAX_VALUE);
  return step;
}

// ---- the list of steps: typing in one field is one step; repeats fold in
// `els` runs alongside `steps` (the element of each step) and is never sent.
export function addStep(steps, step, els = null, el = null, now = Date.now()) {
  const last = steps[steps.length - 1];
  const lastEl = els ? els[els.length - 1] : null;
  const same = last && (el && lastEl ? el === lastEl : last.selector === step.selector && last.text === step.text);
  if (same && step.do === "type" && last.do === "type") { Object.assign(last, step, { at: now }); return steps; }
  if (same && step.do === "choose" && last.do === "choose") { Object.assign(last, step, { at: now }); return steps; }
  // A double click is one click; checking a box twice is undoing it.
  if (same && step.do === "click" && last.do === "click" && now - (last.at || 0) < 450) return steps;
  if (same && ((step.do === "check" && last.do === "uncheck") || (step.do === "uncheck" && last.do === "check"))) {
    steps.pop(); els?.pop(); return steps;
  }
  if (steps.length >= SO_MAX_STEPS) return steps;
  steps.push({ ...step, at: now });
  els?.push(el);
  return steps;
}

// ---- in plain words: Click “Archive”, Type “invoice” in “Search mail”.
// In the person's language (core/i18n.js); the model always gets English (lang "en").
const q = s => `“${s}”`;
export function stepWords(s, lang) {
  const w = (id, vars) => t(`so.step.${id}`, vars, lang);
  const what = s.label || s.text || s.item?.label || "";
  const it = what ? q(what) : s.role ? w("the", { role: s.role }) : w("marked");
  switch (s.do) {
    case "click": return w("click", { it });
    case "type": return s.hidden ? w("typeHidden", { it }) : s.value ? w("type", { value: q(short(s.value, 28)), it }) : w("clear", { it });
    case "choose": return s.hidden ? w("chooseHidden", { it }) : s.role === "option" ? w("choose", { it }) : w("chooseValue", { value: q(short(String(s.value || ""), 28)), it });
    case "check": return w("check", { it });
    case "uncheck": return w("uncheck", { it });
    case "key": return s.selector && s.label && s.role && /field/.test(s.role) ? w("keyIn", { key: s.key, it }) : w("key", { key: s.key });
    default: return `${s.do} ${it}`;
  }
}

// ---- steps that can't be taken back
// The rule, in plain words: a button or shortcut made from your steps asks
// you first ("Delete 12 emails?") when one of the steps deletes or removes
// something, buys or pays for something, or sends, posts or submits
// something to other people. Everything else just runs.
const FOR_GOOD = /\b(delete|remove|discard|erase|trash|destroy|empty|wipe|clear all|buy|purchase|order|check ?out|pay|donate|transfer|send|post|publish|submit|reply|forward|unsubscribe|deactivate|close account|cancel (my )?(order|subscription|plan|membership|account|booking))\b/i;
export function cannotUndo(s) {
  if (!s || s.hidden) return false;
  if (s.do === "key") return /^(Delete|(Ctrl|⌘)\+Enter)$/.test(String(s.key || ""));
  if (s.do !== "click") return false;
  return FOR_GOOD.test([s.label, s.text, s.item?.insideText].filter(Boolean).join(" "));
}

// What leaves the page on Send: the steps without the bookkeeping, and no
// value of a hidden field (there never is one; this makes sure). Steps that
// can't be taken back are marked confirm.
export function stepsForModel(steps) {
  return steps.slice(0, SO_MAX_STEPS).map((s, i) => {
    const o = { n: i + 1, do: s.do, selector: s.selector };
    for (const k of ["text", "label", "role", "key", "item"]) if (s[k] != null && s[k] !== "") o[k] = s[k];
    if (o.item?.attrs) o.item = { ...o.item, attrs: Object.fromEntries(Object.entries(o.item.attrs).filter(([k, v]) => !privateAttr(k, v))) };
    if (s.hidden) o.hidden = true;
    else if (s.value != null) o.value = String(s.value).slice(0, MAX_VALUE);
    if (cannotUndo(s)) o.confirm = true;
    return o;
  });
}

// ---- for the model (core/prompt.js)
export function recordingPrompt(rec) {
  const steps = stepsForModel(rec?.steps || []);
  if (!steps.length) return "";
  const words = steps.map(s => {
    let line = `${s.n}. ${stepWords(s, "en")}`;
    if (s.item) {
      const attrs = Object.entries(s.item.attrs || {}).map(([k, v]) => `${k}="${v}"`).join(" ");
      line += ` (item ${s.item.index + 1} of ${s.item.count} matching \`${s.item.selector}\`${attrs ? `; it had ${attrs}` : ""})`;
    }
    if (s.confirm) line += " [confirm: can't be undone]";
    return line;
  });
  return [
    "The user just showed you a task by doing it once by hand on this page. Recorded steps, in order:",
    words.join("\n"),
    "The same steps as JSON (selector + optional text = the element matching selector whose text contains text; item = the list item it was in; inside = the selector within that item):\n" + JSON.stringify(steps),
    `Write a change that does these steps for the user, the way their request says: a button, a keyboard shortcut, or the same steps for every matching item. It is a change, not a question: never reply with ANSWER.
- Do nothing when the code loads. Run the steps only when the user clicks the button or presses the shortcut.
- Add only the way to start it that the request asks for: a shortcut gets no button, a button no shortcut.
- Run the steps in order in an async function (your code itself runs in a plain function: no await outside it). Before each step wait for its element: const el = await morse.waitFor(selector, { text, within }) (waits up to 5 s, then throws).
- Click with el.click(). Type with morse.type(el, "text"). Choose with morse.choose(el, "option text") or morse.choose(checkbox, true). Keys with morse.key(el, "Enter") or morse.key(document.body, "a", { ctrl: true, shift: true }).
- "Every"/"all" requests: first collect the items (the item selector, narrowed by the attributes that fit the request, e.g. [data-unread="true"]), then do the steps for each item in turn, finding things inside the item with { within: item }. Say how many in the button label or a toast.
- A shortcut: morse.on(document, "keydown", e => { ... }) matching e.key and e.ctrlKey/e.shiftKey/e.altKey/e.metaKey, with e.preventDefault(). Ignore plain keys typed into fields.
- A step marked hidden is private and was not recorded. Never type it: focus that field and stop with morse.toast("Type your password, then …").
- A step marked confirm can't be taken back (it deletes, buys or pays, or sends something). Before the first such step, ask once and stop on No: if (!(await morse.confirm("Delete 12 emails?"))) return; Say in plain words what will happen, with the count for "every" requests.
- Wrap the run in try/catch; on a problem show morse.toast with what it couldn't find. When done, morse.toast what it did.
- A button must be put on the page: morse.watch("<where it goes>", spot => spot.append(button)). Put it next to the controls it belongs with (for list items, the list's toolbar), in the app's own style, with a short verb label.`,
  ].join("\n\n");
}
