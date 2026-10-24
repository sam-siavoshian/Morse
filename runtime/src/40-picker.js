let hoverEl = null;
function boxTo(el, box, label) {
  if (!el) { box.hidden = true; return; }
  const r = el.getBoundingClientRect();
  box.hidden = false;
  Object.assign(box.style, { left: r.left - 3 + "px", top: r.top - 3 + "px", width: r.width + 6 + "px", height: r.height + 6 + "px" });
  if (label != null) {
    // The label sits above the box; flush with the top edge it moves inside,
    // and it never runs off the left or right of the screen.
    const s = box.querySelector("span");
    s.textContent = label;
    const inside = r.top < 28;
    s.classList.toggle("inside", inside);
    const x = r.left - 3 + (inside ? 4 : -1.5), w = s.offsetWidth;
    s.style.marginLeft = Math.max(4 - x, Math.min(0, innerWidth - 4 - w - x)) + "px";
  }
}
const ours = e => e.composedPath().includes(hostEl);
function onMove(e) {
  if (!S.picking) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === hostEl || el === document.documentElement) { hoverEl = null; hl.hidden = true; return; }
  hoverEl = el;
  boxTo(el, hl, describe(el));
  placeBar(el.getBoundingClientRect());
}
// The bar sits on the opposite half of the screen from what you point at.
function placeBar(r) {
  const c = (r.top + r.height / 2) / innerHeight;
  if (c > 0.55) bar.classList.add("top");
  else if (c < 0.45) bar.classList.remove("top");
}
function swallow(e) { if (S.picking && !ours(e)) { e.preventDefault(); e.stopPropagation(); } }
function onClick(e) {
  if (!S.picking || ours(e)) return;
  e.preventDefault(); e.stopPropagation();
  if (hoverEl) setTarget(hoverEl);
}
let pointerY = innerHeight / 2;
addEventListener("mousemove", e => { pointerY = e.clientY; }, true);
addEventListener("mousemove", onMove, true);
for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) addEventListener(t, swallow, true);
addEventListener("click", onClick, true);
addEventListener("scroll", () => { if (S.target) boxTo(S.target, selBox); }, true);

function setTarget(el) {
  S.target = el;
  S.picking = false;
  hl.hidden = true;
  root.host.style.cursor = "";
  if (el) {
    boxTo(el, selBox);
    placeBar(el.getBoundingClientRect());
    chip.hidden = false;
    chip.querySelector("span").textContent = describe(el);
  } else { selBox.hidden = true; chip.hidden = true; }
  setHint();
  input.focus();
}
chip.querySelector(".x").onclick = () => { setTarget(null); startPicking(); };
