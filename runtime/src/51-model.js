// The model for the next change, in the bar itself. The host names the models
// this computer can use (hello.modelChoices, core/providers.js modelChoicesFor).
// The choice is a bar setting (modelPick) and the next request uses it.

const modelBtn = makeEl("button", { className: "btn modelpick", type: "button", hidden: true }, { "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "m-model-menu" });
modelBtn.innerHTML = `<span class="mi" aria-hidden="true"></span><span class="name"></span><i class="chev" aria-hidden="true"></i>`;
micBtn.before(modelBtn);
const modelMenu = makeEl("div", { className: "menu modelmenu", hidden: true, id: "m-model-menu" }, { role: "menu" });
bar.append(modelMenu);
modelBtn.addEventListener("mousedown", e => e.preventDefault()); // keep the caret; the menu takes focus on open

// One 16px stroke icon per model, the same set the rest of the bar draws with.
// Automatic uses the Morse mark. A name this list doesn't know gets a mark of
// its own, so two local models don't share a face.
const MODEL_ICON = {
  opus: `<path d="M8 1.6 9.45 6.55 14.4 8 9.45 9.45 8 14.4 6.55 9.45 1.6 8 6.55 6.55Z"/>`,
  sonnet: `<path d="M4.75 12.75V3.75"/><path d="M4.75 4.1c2.4-1.35 5-.15 6.6 1.7"/><path d="M4.75 8.15c2.15-1.1 4.5-.1 5.9 1.35"/>`,
  haiku: `<path d="M2.75 4.5h10.5M2.75 8h7.75M2.75 11.5h5"/>`,
  gpt: `<path d="M8 1.75 13.2 4.85v6.3L8 14.25 2.8 11.15v-6.3Z"/>`,
  mini: `<path d="M8 3.4 11.45 5.4v4.2L8 12.6 4.55 9.6V5.4Z"/><path d="M6.4 8h3.2"/>`,
  spark: `<path d="M8 2.25v11.5M2.25 8h11.5"/>`,
  ring: `<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none"/>`,
  bars: `<path d="M3.75 12.5V7.25M8 12.5V3.5M12.25 12.5V6"/>`,
  diamond: `<path d="M8 2.25 13.25 8 8 13.75 2.75 8Z"/>`,
  wave: `<path d="M2 10.25c1.4-2.6 2.6-2.6 4 0s2.6 2.6 4 0 2.6-2.6 4 0"/>`,
  hex: `<path d="M8 2.25 12.75 5v6L8 13.75 3.25 11V5Z"/><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none"/>`,
};
const MODEL_NAME = {
  opus: "model.id.opus",
  sonnet: "model.id.sonnet",
  haiku: "model.id.haiku",
  "gpt-5": "model.id.gpt-5",
  "gpt-5-mini": "model.id.gpt-5-mini",
  "claude-opus-5-5": "model.id.claude-opus-5-5",
  "claude-sonnet-5-5": "model.id.claude-sonnet-5-5",
  "claude-haiku-5-5": "model.id.claude-haiku-5-5",
};
const FALLBACK_ICONS = ["spark", "ring", "bars", "diamond", "wave", "hex"];
const CHECK = `<svg class="tick" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.25 8.25 7.1 10.1 10.75 6"/></svg>`;

function modelIconKey(id) {
  if (id === "auto") return "auto";
  const s = String(id || "").toLowerCase();
  if (s.includes("opus")) return "opus";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("haiku")) return "haiku";
  if (s.includes("mini") || s.includes("nano")) return "mini";
  if (s === "gpt" || s.startsWith("gpt-") || /^o[134]/.test(s)) return "gpt";
  let n = 0;
  for (const c of s) n = (n + c.charCodeAt(0)) % FALLBACK_ICONS.length;
  return FALLBACK_ICONS[n];
}
function modelIcon(id) {
  if (id === "auto") return radar(16);
  const body = MODEL_ICON[modelIconKey(id)] || MODEL_ICON.spark;
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
function modelLabel(id, short) {
  if (id === "auto") return t(short ? "bar.model.autoShort" : "settings.model.auto");
  const key = MODEL_NAME[id];
  return key ? t(key) : String(id || "");
}
function modelIds() {
  return Array.isArray(S.modelChoices?.ids) ? S.modelChoices.ids.filter(id => typeof id === "string" && id && id !== "auto") : [];
}
function currentModel() {
  const ids = modelIds();
  const pref = PREFS.modelPick;
  if (pref === "auto") return "auto";
  if (pref && ids.includes(pref)) return pref;
  const hinted = S.modelChoices?.current;
  if (!pref && hinted && hinted !== "auto" && ids.includes(hinted)) return hinted;
  return "auto";
}
function renderModelBtn() {
  const ids = modelIds();
  modelBtn.hidden = ids.length === 0;
  if (!ids.length) {
    hideModelMenu();
    modelBtn.setAttribute("aria-label", t("settings.model"));
    return;
  }
  const id = currentModel();
  const name = modelLabel(id, true);
  modelBtn.dataset.model = id;
  modelBtn.dataset.icon = modelIconKey(id);
  modelBtn.querySelector(".mi").innerHTML = modelIcon(id);
  modelBtn.querySelector(".name").textContent = name;
  modelBtn.setAttribute("aria-label", t("bar.model.label", { name: modelLabel(id, false) }));
  modelBtn.title = modelLabel(id, false);
  modelBtn.disabled = bar.classList.contains("working") || bar.classList.contains("saving");
}
function renderModelMenu() {
  const current = currentModel();
  modelMenu.replaceChildren();
  modelMenu.setAttribute("aria-label", t("settings.model"));
  for (const id of ["auto", ...modelIds()]) {
    const b = makeEl("button", { type: "button" }, { role: "menuitemradio", "aria-checked": String(id === current), "data-model": id, "data-icon": modelIconKey(id), tabindex: "-1" });
    b.innerHTML = `${modelIcon(id)}<span></span>${CHECK}`;
    b.querySelector("span").textContent = modelLabel(id, false);
    modelMenu.append(b);
  }
}
function placeModelMenu() {
  const br = bar.getBoundingClientRect();
  const rr = modelBtn.getBoundingClientRect();
  const below = barIsTop();
  modelMenu.classList.toggle("below", below);
  modelMenu.style.insetInlineEnd = "auto";
  modelMenu.style.insetInlineStart = `${Math.max(8, Math.min(rr.left - br.left, Math.max(8, br.width - 208)))}px`;
  if (below) {
    modelMenu.style.top = `${rr.bottom - br.top + 8}px`;
    modelMenu.style.bottom = "auto";
  } else {
    modelMenu.style.bottom = `${br.bottom - rr.top + 8}px`;
    modelMenu.style.top = "auto";
  }
}
function hideModelMenu(back) {
  if (modelMenu.hidden) return;
  modelMenu.hidden = true;
  modelBtn.setAttribute("aria-expanded", "false");
  if (back && S.open) modelBtn.focus();
}
function showModelMenu() {
  if (modelBtn.hidden || modelBtn.disabled) return;
  hideMenu();
  renderModelMenu();
  modelMenu.hidden = false;
  modelBtn.setAttribute("aria-expanded", "true");
  placeModelMenu();
  (modelMenu.querySelector('[aria-checked="true"]') || modelMenu.querySelector("button"))?.focus();
}
function chooseModel(id) {
  const same = id === currentModel();
  hideModelMenu(false);
  if (!same) {
    const saving = savePrefs({ modelPick: id === "auto" ? "auto" : id });
    renderModelBtn();
    announce(t("bar.model.chosen", { name: modelLabel(id, false) }));
    saving.catch(() => {});
  }
  if (S.open) input.focus();
}
function setModelChoices(choices) {
  S.modelChoices = choices && Array.isArray(choices.ids) ? { ids: choices.ids.filter(id => typeof id === "string" && id && id !== "auto"), current: typeof choices.current === "string" ? choices.current : "auto" } : null;
  renderModelBtn();
}

modelBtn.addEventListener("click", () => (modelMenu.hidden ? showModelMenu() : hideModelMenu(true)));
modelBtn.addEventListener("keydown", e => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  e.stopPropagation();
  showModelMenu();
});
modelMenu.addEventListener("click", e => { const b = e.target.closest("[data-model]"); if (b) chooseModel(b.dataset.model); });
modelMenu.addEventListener("keydown", e => {
  if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); hideModelMenu(true); return; }
  if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
    const b = e.target.closest("[data-model]");
    if (b) { e.preventDefault(); e.stopPropagation(); chooseModel(b.dataset.model); }
    return;
  }
  if (menuKeys(e, modelMenu)) e.stopPropagation();
});
root.addEventListener("pointerdown", e => { if (!modelMenu.hidden && !e.composedPath().some(n => n === modelMenu || n === modelBtn)) hideModelMenu(); });
new MutationObserver(() => {
  const busy = bar.classList.contains("working") || bar.classList.contains("saving");
  modelBtn.disabled = busy;
  if (busy) hideModelMenu();
}).observe(bar, { attributes: true, attributeFilter: ["class"] });
prefsSubs.add(renderModelBtn);
langSubs.add(() => { renderModelBtn(); if (!modelMenu.hidden) renderModelMenu(); });
renderModelBtn();
