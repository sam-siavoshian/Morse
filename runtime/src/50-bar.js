function setHint() {
  if (S.phase !== "idle") return;
  hint.innerHTML = S.picking
    ? `<b>Point</b> at anything to change it · or just describe it · <kbd>Esc</kbd> to close`
    : S.target ? `Describe what to change about this · <kbd>Enter</kbd>` : `Describe a change to this page · <kbd>Enter</kbd>`;
  ticker.textContent = "";
  actions.innerHTML = `<button data-a="mods">Mods${S.mods.length ? ` <em>${S.mods.length}</em>` : ""}</button><span class="model">${esc(S.label)}</span>`;
}
function startPicking() { S.picking = true; setHint(); }
function openBar() {
  if (S.phase === "working") return;
  S.open = true;
  applyTheme();
  S.phase = "idle";
  bar.hidden = false;
  bar.classList.remove("done", "err");
  bar.classList.toggle("top", pointerY > innerHeight * 0.55);
  input.value = "";
  input.disabled = false;
  setTarget(null);
  startPicking();
  requestAnimationFrame(() => input.focus());
  call("clip.start").catch(() => {});
}
function closeBar() {
  if (S.phase === "working") return;
  // Dismissing a result keeps it; Undo is always one click away in Mods.
  if (S.phase === "result" && S.draft && !S.draft.saved) { keep(); return; }
  if (S.phase === "idle") call("clip.cancel").catch(() => {});
  S.open = false; S.picking = false;
  bar.hidden = true; hl.hidden = true; selBox.hidden = true;
  S.phase = "idle";
}
// While pointing, the bar dodges the cursor so nothing is unreachable.
bar.addEventListener("mouseenter", () => { if (S.picking && !input.value) bar.classList.toggle("top"); });
input.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Enter" && input.value.trim()) submit(input.value.trim());
  if (e.key === "Escape") closeBar();
});
for (const t of ["keyup", "keypress", "input"]) input.addEventListener(t, e => e.stopPropagation());
$(".go").onclick = () => input.value.trim() && submit(input.value.trim());

actions.addEventListener("click", e => {
  const a = e.target.closest("button")?.dataset.a;
  if (a === "mods") openPanel();
  if (a === "keep") keep();
  if (a === "undo") undo();
  if (a === "code") showCode(S.draft);
  if (a === "share") keep().then(m => m && showShare(m));
  if (a === "again") { S.phase = "idle"; bar.classList.remove("err"); input.disabled = false; input.focus(); setHint(); }
});
