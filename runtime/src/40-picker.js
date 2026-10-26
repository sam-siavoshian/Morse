let hoverEl = null;
// The dashed box stays only while an element is chosen and the bar is still
// waiting. A finished run, a stop, or a closed bar drops it (releasePick).
let pinned = false;
const HOST_MARK = ["morse-selected", "morse-hover"];
const marked = new Set();
function watchHost(el) {
  if (el && el.nodeType === 1 && el !== hostEl) marked.add(el);
}
function unmarkHost(el) {
  if (!el?.classList) return;
  el.classList.remove(...HOST_MARK);
  marked.delete(el);
}
function clearHostMarks() {
  const els = new Set(marked);
  if (hoverEl) els.add(hoverEl);
  if (S.target) els.add(S.target);
  marked.clear();
  for (const el of els) if (el?.classList) el.classList.remove(...HOST_MARK);
  for (const el of document.querySelectorAll(".morse-selected, .morse-hover")) el.classList.remove(...HOST_MARK);
}
// data-pick lets the stylesheet hide the dashed box once the choice is over,
// even if a scroll tries to draw it again.
function syncPickFlag() {
  if (pinned && S.open && S.phase === "idle" && !bar.hidden) hostEl.dataset.pick = "";
  else delete hostEl.dataset.pick;
}
function releasePick() {
  pinned = false;
  hoverEl = null;
  hl.hidden = true;
  selBox.classList.remove("busy");
  selBox.hidden = true;
  clearHostMarks();
  syncPickFlag();
  GodMode.release();
}
function leaveHover(el) {
  if (!el?.classList) return;
  el.classList.remove("morse-hover");
  if (el !== S.target) unmarkHost(el);
}
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
  if (!S.picking || !e.isTrusted) return;
  if (!S.open || bar.hidden) return;
  const el = GodMode.deepAt(e.clientX, e.clientY); // God mode hook: also points into open shadow roots
  if (!el || el === hostEl || el === document.documentElement) {
    leaveHover(hoverEl);
    hoverEl = null;
    hl.hidden = true;
    return;
  }
  if (hoverEl !== el) leaveHover(hoverEl);
  hoverEl = el;
  watchHost(el);
  el.classList.add("morse-hover");
  // Something is chosen: the page stays still while you type. A click
  // elsewhere still chooses that instead.
  if (S.target) { hl.hidden = true; return; }
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
// A scroll may follow the live hover or the chosen element. It never brings
// the dashed box back after the run ends or the bar closes.
listen("scroll", () => {
  if (!S.open || bar.hidden) {
    hl.hidden = true;
    selBox.classList.remove("busy");
    selBox.hidden = true;
    if (pinned || hoverEl || hostEl.hasAttribute("data-pick") || hostEl.hasAttribute("data-gm")) releasePick();
    return;
  }
  if (S.phase === "working" && selBox.classList.contains("busy") && S.target?.isConnected) boxTo(S.target, selBox);
  else if (pinned && S.phase === "idle" && S.target?.isConnected && !selBox.hidden) boxTo(S.target, selBox);
}, true);

// setTarget lives in 50-bar.js (one definition; it calls the God mode hook).
