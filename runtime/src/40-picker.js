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
// Pointing is the person's own mouse: a page's synthetic mousemove and click
// can't choose what Morse changes (isTrusted, like every key Morse takes).
function onMove(e) {
  if (!S.picking || !e.isTrusted || barDragging()) return;
  const el = GodMode.deepAt(e.clientX, e.clientY); // God mode hook: also points into open shadow roots
  if (!el || el === hostEl || el === document.documentElement) { hoverEl = null; hl.hidden = true; return; }
  hoverEl = el;
  // Something is chosen: the page stays still while you type. A click
  // elsewhere still chooses that instead.
  if (S.target) { hl.hidden = true; return; }
  boxTo(el, hl, describe(el));
  placeBar(el.getBoundingClientRect());
}
// The bar sits on the opposite half of the screen from what you point at.
// A drag this page (50-bar.js) keeps the dropped spot; pointing leaves it.
function placeBar(r) {
  if (barDragHeld()) return;
  const c = (r.top + r.height / 2) / innerHeight;
  if (c > 0.55) bar.classList.add("top");
  else if (c < 0.45) bar.classList.remove("top");
}
function swallow(e) { if (S.picking && !ours(e)) { e.preventDefault(); e.stopPropagation(); } }
function onClick(e) {
  if (barDragEatClick()) { e.preventDefault(); e.stopPropagation(); return; }
  if (!S.picking || ours(e)) return;
  e.preventDefault(); e.stopPropagation();
  if (!e.isTrusted) return;
  // A tap on a touch screen clicks with no mouse move first: point at what is under it.
  if (e.clientX || e.clientY) onMove(e);
  if (hoverEl) setTarget(hoverEl);
}
let pointerY = innerHeight / 2;
listen("mousemove", e => { pointerY = e.clientY; }, true);
listen("mousemove", onMove, true);
for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) listen(t, swallow, true);
listen("click", onClick, true);
listen("scroll", () => { if (S.target) boxTo(S.target, selBox); }, true);

// setTarget lives in 50-bar.js (one definition; it calls the God mode hook).
