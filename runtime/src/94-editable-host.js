// Keys typed into Morse also reach the page's own capture-phase listeners,
// retargeted to our shadow host (a plain <div>), so apps run their single-key
// shortcuts ("j", "/", "?") while you type in the bar. Apps skip shortcuts when
// the target is editable, so while focus is inside Morse the host is an
// (empty) plaintext-only editing host: e.target.isContentEditable and
// closest("[contenteditable]") are true for it, as for any text field. Our
// shadow content stays non-editable, and nothing can be typed into the host.
{
  // Writing assistants decorate editable elements; this one isn't a text field.
  const QUIET = ["data-gramm", "data-gramm_editor", "data-enable-grammarly"];
  let editable = false;
  const sync = () => {
    const want = !!root.activeElement;
    if (want === editable) return;
    editable = want;
    if (want) {
      hostEl.contentEditable = "plaintext-only";
      hostEl.spellcheck = false;
      for (const a of QUIET) hostEl.setAttribute(a, "false");
    } else {
      for (const a of ["contenteditable", "spellcheck", ...QUIET]) hostEl.removeAttribute(a);
    }
  };
  // A plaintext-only editing host gets white-space: pre-wrap (Chromium forces
  // it, past our `all: initial`), which our UI would inherit: the template
  // whitespace would show and shift the layout mid-click. Our top-level
  // elements keep the white-space they had; first in the root, so any rule of
  // ours that sets white-space still wins.
  const ws = document.createElement("style");
  ws.textContent = ":host > * { white-space: normal; }";
  root.prepend(ws);
  root.addEventListener("focusin", sync);
  // Focus moving between our own controls fires focusout then focusin; settle after both.
  root.addEventListener("focusout", () => setTimeout(sync, 0));
}
