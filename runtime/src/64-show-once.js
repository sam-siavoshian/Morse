// Show me once: people automate repetitive clicking without knowing how.
// From the bar (a chip under the input, and the ⋯ menu) the user starts it,
// does the task by hand on the page, and a strip lists the steps in plain
// words ("Click “Archive”", "Type “invoice” in “Search mail”"). Stop opens the
// bar with the steps; they say what they want ("add a button that does
// this", "do this when I press Ctrl+Shift+A", "do this to every unread
// email") and the steps go to the model as context (core/prompt.js). The
// result is a mod like any other: refine it, save it, undo it.
//
// Recording rules:
//   - only the user's own events (isTrusted), only on this page (not frames,
//     not Morse's own UI), only while the strip is showing
//   - passwords and card fields: the step is kept, the value never is
//   - Esc cancels; nothing leaves the page until Send
// Steps, selectors and words come from core/showonce.js (inlined by
// runtime/bundle.js). Hooks: 50-bar.js (⋯ menu), 58-suggest.js (chips).

const ShowOnce = (() => {
  const R = { on: false, steps: [], els: [], attached: null };
  const css = document.createElement("style");
  css.textContent = SHOW_ONCE_CSS();
  root.append(css);
  const svg = (d, fill = "none") => `<svg viewBox="0 0 16 16" width="16" height="16" fill="${fill}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I_REC = svg('<circle cx="8" cy="8" r="5.75"/><circle cx="8" cy="8" r="2.25" fill="currentColor" stroke="none"/>');
  const I_X = svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>');
  const I_STOP = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>`;

  // ---- the strip, while recording
  const strip = document.createElement("section");
  strip.className = "so-strip";
  strip.hidden = true;
  strip.setAttribute("role", "region");
  tBind(strip, "aria-label", "menu.showonce");
  root.append(strip);
  const say = t => announce(t, { again: true }); // 12-focus.js
  for (const t of ["keydown", "keyup", "keypress"]) strip.addEventListener(t, ev => { if (ev.key !== "Escape") ev.stopPropagation(); });

  function stepRow(s, i, { remove = true, last = false } = {}) {
    const hid = esc(t("so.hidden"));
    return `<li class="${last ? "so-last" : ""}"><span class="so-n">${i + 1}</span><span class="so-w" title="${esc(stepWords(s))}">${esc(stepWords(s)).replace(hid, `<span class="so-hid">${hid}</span>`)}</span>${remove
      ? `<button type="button" class="ibtn xs so-rm" data-so="remove" data-i="${i}" aria-label="${esc(t("so.remove", { n: i + 1 }))}" title="${esc(t("so.removeTitle"))}">${I_X}</button>` : ""}</li>`;
  }
  function renderStrip() {
    const n = R.steps.length, shown = Math.min(n, 4), first = n - shown;
    strip.innerHTML = `
      <header class="so-head">
        <span class="so-dot" aria-hidden="true"></span>
        <b>${t("menu.showonce")}</b>
        <span class="so-count">${n ? t("so.steps", { n }) : t("so.watching")}</span>
        <span class="so-sp"></span>
        <button type="button" class="tbtn" data-so="cancel" title="${esc(t("so.cancelTitle"))}">${t("btn.cancel")}</button>
        <button type="button" class="btn primary" data-so="stop" title="${esc(t("so.stopTitle"))}">${I_STOP}${t("bar.stop")}</button>
      </header>
      ${n ? `<ol class="so-steps">${first ? `<li class="so-more">${t("so.earlier", { n: first })}</li>` : ""}${R.steps.slice(first).map((s, k) => stepRow(s, first + k, { last: first + k === n - 1 })).join("")}</ol>`
        : `<p class="so-empty">${t("so.empty")}</p>`}
      <footer class="so-foot">${t("so.foot")}</footer>`;
  }
  strip.addEventListener("click", ev => {
    const b = ev.target.closest("[data-so]");
    if (!b) return;
    const a = b.dataset.so;
    if (a === "stop") finish();
    if (a === "cancel") cancel();
    if (a === "remove") { R.steps.splice(+b.dataset.i, 1); R.els.splice(+b.dataset.i, 1); renderStrip(); strip.querySelector("[data-so=stop]")?.focus(); }
  });

  // The strip moves out of the way of what the user is about to click.
  listen("mousemove", e => {
    if (!R.on || strip.hidden || ours(e)) return;
    const el = actionTarget(e.target);
    if (!el || el === document.body || el === document.documentElement) return;
    const r = el.getBoundingClientRect(), s = strip.getBoundingClientRect();
    if (r.width * r.height > innerWidth * innerHeight * 0.25) return;
    const hit = r.right > s.left - 8 && r.left < s.right + 8 && r.bottom > s.top - 8 && r.top < s.bottom + 8;
    if (hit) strip.classList.toggle("top");
  }, true);

  // ---- start, stop, cancel
  function start() {
    if (S.phase === "working") return;
    if (Guide.active) Guide.stop();
    detach();
    R.steps = []; R.els = []; R.on = true;
    typedIn = new WeakMap();
    if (S.open) closeBar(); // an unsaved result is kept, as always when the bar closes
    renderStrip();
    strip.classList.remove("top");
    strip.hidden = false;
    say(t("so.say.start"));
  }
  function finish() {
    if (!R.on) return;
    R.on = false;
    strip.hidden = true;
    if (!R.steps.length) {
      toast(t("so.noSteps"));
      return;
    }
    R.attached = { steps: R.steps, els: R.els };
    R.steps = []; R.els = [];
    if (!S.open) openBar();
    showAttached();
  }
  function cancel() {
    if (!R.on) return;
    R.on = false;
    strip.hidden = true;
    R.steps = []; R.els = [];
    toast(t("so.cancelled"));
  }

  // ---- recording: the user's own clicks, typing, choices and keys
  const recording = () => R.on && !strip.hidden && live();
  function record(el, what, extra = {}) {
    let step;
    try { step = stepFrom(el, what, extra); } catch (e) { console.warn("[morse] show once", e); return; }
    const n = R.steps.length;
    addStep(R.steps, step, R.els, el);
    renderStrip();
    if (R.steps.length > n) say(t("so.say.step", { n: R.steps.length, words: stepWords(R.steps[R.steps.length - 1]) }));
  }
  listen("click", e => {
    if (!e.isTrusted || !recording() || ours(e)) return;
    const el = actionTarget(e.target);
    if (!el || el === document.body || el === document.documentElement || isFormControl(el)) return; // fields: what follows is recorded
    record(el, "click");
  }, true);
  // A rich editor (an email body, a document) already holds text the person
  // didn't type for this task: only what they type while recording is kept.
  let typedIn = new WeakMap();
  function typedText(el, e) {
    const was = typedIn.get(el) || "";
    const t = e.inputType || "";
    const add = /^insert(Text|ReplacementText)$/.test(t) ? e.data || ""
      : /^insertFrom(Paste|Drop)$/.test(t) ? e.dataTransfer?.getData("text/plain") || ""
      : /^insert(LineBreak|Paragraph)$/.test(t) ? "\n" : null;
    const now = add != null ? was + add : t === "deleteContentBackward" ? was.slice(0, -1) : was;
    typedIn.set(el, now);
    return now;
  }
  listen("compositionend", e => { // a word from an input method (Japanese, Chinese, …)
    const el = e.target;
    if (!e.isTrusted || !recording() || ours(e) || !el?.isContentEditable || !e.data || isSecretField(el)) return;
    typedIn.set(el, (typedIn.get(el) || "") + e.data);
    record(el, "type", { value: typedIn.get(el) });
  }, true);
  listen("input", e => {
    if (!e.isTrusted || !recording() || ours(e)) return;
    const el = e.target;
    if (!isTextField(el)) return;
    // The field itself may sit in a component's shadow root (a password box inside <x-input>).
    const inner = e.composedPath?.()[0];
    const secret = isSecretField(el) || (inner !== el && inner?.nodeType === 1 && isSecretField(inner));
    if (secret) return record(el, "type", { hidden: true });
    if (!el.isContentEditable) return record(el, "type", { value: el.value });
    if (e.isComposing || e.inputType === "insertCompositionText") return; // the word lands on compositionend
    const typed = typedText(el, e);
    if (typed) record(el, "type", { value: typed });
  }, true);
  listen("change", e => {
    if (!e.isTrusted || !recording() || ours(e)) return;
    const el = e.target, type = (el.getAttribute?.("type") || "").toLowerCase();
    if (el.localName === "select") {
      const opt = el.selectedOptions?.[0];
      record(el, "choose", isSecretField(el) ? { hidden: true } : { value: opt ? opt.text.trim() : el.value });
    } else if (el.localName === "input" && type === "checkbox") record(el, el.checked ? "check" : "uncheck");
    else if (el.localName === "input" && type === "radio") record(el, "choose", { value: soLabelOf(el) });
    else if (el.localName === "input" && /^(range|color)$/.test(type)) record(el, "type", { value: el.value });
  }, true);

  const NAMES = { Control: 1, Shift: 1, Alt: 1, Meta: 1, AltGraph: 1, CapsLock: 1, Tab: 1, " ": 1, Dead: 1, Unidentified: 1, Process: 1 };
  function keyName(e) {
    if (NAMES[e.key]) return "";
    const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.metaKey && "⌘"].filter(Boolean);
    if (e.shiftKey && (mods.length || e.key.length > 1)) mods.push("Shift");
    return [...mods, e.key.length === 1 ? e.key.toUpperCase() : e.key].join("+");
  }
  listen("keydown", e => {
    if (!e.isTrusted || !recording()) return;
    if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && panel.hidden && modal.hidden) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
      return;
    }
    if (ours(e) || e.repeat || e.isComposing || e.keyCode === 229 || hotkeyFor(e)) return;
    const key = keyName(e);
    if (!key) return;
    const el = e.target, modded = e.ctrlKey || e.metaKey || e.altKey;
    if (isTextField(el)) {
      // Typing is recorded as text; in a field only Enter and shortcuts count,
      // not editing keys (copy, paste, undo, select all).
      if (modded ? /^(Ctrl|⌘)\+(A|C|V|X|Z|Y|Shift\+Z)$/.test(key) : key !== "Enter" || el.localName === "textarea" || el.isContentEditable) return;
      record(el, "key", { key });
      return;
    }
    // Enter on a button or link clicks it, and keys on a menu or a checkbox
    // change it: that click or change is the step.
    if (!modded && (isFormControl(el) || (key === "Enter" && el.closest?.("button,a[href],summary,[role=button],[role=link]")))) return;
    if (/^(Ctrl|⌘)\+(C|A)$/.test(key)) return;
    const n = R.steps.length;
    addStep(R.steps, { do: "key", selector: "body", key }, R.els, null);
    renderStrip();
    if (R.steps.length > n) say(t("so.say.step", { n: R.steps.length, words: stepWords(R.steps[R.steps.length - 1]) }));
  }, true);

  // ---- after Stop: the steps in the bar, waiting for what to do with them
  const card = document.createElement("section");
  card.className = "so-card";
  card.hidden = true;
  tBind(card, "aria-label", "so.yourSteps");
  bar.prepend(card);
  // PLACEHOLDER(): 60-generate.js
  // (a phone-width bar fits only the short one: a textarea's placeholder can't end in an ellipsis)
  const askWhat = () => (innerWidth < 560 ? t("so.askShort") : t("so.askWhat"));
  const asking = () => input.placeholder === t("so.askWhat") || input.placeholder === t("so.askShort");
  function renderCard() {
    const steps = R.attached?.steps || [];
    card.innerHTML = `
      <header class="so-ch">
        <span class="eyebrow">${t("so.yourSteps")}</span><span class="so-count">${steps.length}</span>
        <span class="so-sp"></span>
        <button type="button" class="tbtn" data-so="again" title="${esc(t("so.againTitle"))}">${t("so.again")}</button>
        <button type="button" class="ibtn xs" data-so="forget" aria-label="${esc(t("so.forget"))}" title="${esc(t("so.forget"))}">${I_X}</button>
      </header>
      <ol class="so-steps">${steps.map((s, i) => stepRow(s, i, { remove: steps.length > 1 })).join("")}</ol>`;
  }
  function showAttached() {
    // Words, not pointing, come next: the bar stays put and the page's clicks go through.
    S.picking = false;
    hl.hidden = true;
    renderCard();
    syncCard();
    input.placeholder = askWhat();
    note(t("so.sayWhat"), 0);
    updateChips();
    input.focus();
  }
  function detach() {
    if (!R.attached) return;
    R.attached = null;
    card.hidden = true;
    card.innerHTML = "";
    bar.classList.remove("has-so");
    if (asking()) input.placeholder = PLACEHOLDER();
    if (hintNote === t("so.sayWhat")) { hintNote = ""; setHint(); }
    updateChips();
  }
  // The list shows while the bar waits for words; working on, or showing,
  // the result it folds away (the steps still go along with a refine).
  function syncCard() {
    const show = !!R.attached && S.open && S.phase === "idle" && !bar.classList.contains("has-pane");
    card.hidden = !show;
    bar.classList.toggle("has-so", show);
    if (R.attached && S.phase === "idle" && input.placeholder === PLACEHOLDER()) input.placeholder = askWhat();
  }
  new MutationObserver(syncCard).observe(bar, { attributes: true, attributeFilter: ["class"] });
  // Voice and the bar reset the words in the empty input; while steps wait, ours stay.
  new MutationObserver(() => {
    if (R.attached && S.phase === "idle" && input.placeholder === PLACEHOLDER()) input.placeholder = askWhat();
  }).observe(input, { attributes: true, attributeFilter: ["placeholder"] });
  card.addEventListener("click", ev => {
    const b = ev.target.closest("[data-so]");
    if (!b) return;
    const a = b.dataset.so;
    if (a === "again") start();
    if (a === "forget") { detach(); input.focus(); toast(t("so.forgot")); }
    if (a === "remove" && R.attached) {
      R.attached.steps.splice(+b.dataset.i, 1);
      R.attached.els.splice(+b.dataset.i, 1);
      renderCard();
      (card.querySelector(`[data-so=remove][data-i="${Math.min(+b.dataset.i, R.attached.steps.length - 1)}"]`) || input).focus();
    }
  });

  // Opening the bar while recording (the Morse shortcut) is the same as Stop;
  // closing it lets the steps go.
  new MutationObserver(() => {
    if (!bar.hidden && R.on) finish();
    else if (bar.hidden && !R.on) detach();
  }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });

  // Every request from the bar carries the steps while they're attached.
  outgoing.push(m => {
    if (m.type !== "generate" || !R.attached?.steps.length) return;
    m.context = { ...m.context, recording: { steps: stepsForModel(R.attached.steps) } };
  });

  // ---- ways in: a chip in the empty bar, and the ⋯ menu (50-bar.js)
  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "sug so-sug";
  entry.tabIndex = -1;
  const entryWords = () => { entry.title = t("so.entryTitle"); entry.innerHTML = `${I_REC}${esc(t("menu.showonce"))}`; };
  entryWords();
  langSubs.add(entryWords);
  entry.addEventListener("click", ev => { ev.stopPropagation(); start(); });
  function placeEntry() {
    if (sugEl.hidden || R.attached) { if (entry.isConnected) entry.remove(); return; }
    if (entry.isConnected) return;
    const gallery = sugEl.querySelector(".gl-sug");
    gallery ? gallery.before(entry) : sugEl.append(entry);
  }
  new MutationObserver(placeEntry).observe(sugEl, { attributes: true, attributeFilter: ["hidden"], childList: true });

  // With steps attached, the chips are what people usually want.
  // label "so.chip.<x>", what it asks "so.chip.<x>.p" (a `fill` one is finished in the input)
  const CHIPS = () => [
    { id: "button", label: t("so.chip.button"), prompt: t("so.chip.button.p") },
    { id: "shortcut", label: t("so.chip.shortcut"), prompt: t("so.chip.shortcut.p"), fill: true },
    { id: "every", label: t("so.chip.every"), prompt: t("so.chip.every.p"), fill: true },
  ];

  return {
    start, finish, cancel,
    chips: () => (R.attached ? CHIPS() : null),
    get recording() { return R.on; },
    get steps() { return (R.on ? R.steps : R.attached?.steps || []).map(s => ({ ...s, words: stepWords(s) })); },
  };
})();
function showOnceChips() { return ShowOnce.chips(); } // 58-suggest.js hook
