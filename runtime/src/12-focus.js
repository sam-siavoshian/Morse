// Keyboard and screen-reader plumbing for Morse's own UI (65-a11y.js, "Easier
// to use", is for the apps Morse changes; this is for Morse itself):
//   - tabbables(scope): what Tab can reach in one part of the overlay
//   - menuKeys(e, menu): ↑/↓ (wrapping), Home/End and type-ahead in a menu
//   - tabWithin(e, scope): Tab and Shift+Tab stay inside a modal
//   - announce(text): one polite message for screen readers, said in the
//     place they listen to right now (the open modal, the bar, or the page)
//   - nowFocused(): what has focus, in the overlay or on the page
// docs/dev/accessibility.md has the rules; tests/a11y-morse.test.js checks them.

// Parts of the bar that float outside its box but belong to it (the edit
// toolbar and its popover, 45-godmode.js): Tab reaches them from the bar.
const barExtras = [];

function tabbables(scope) {
  if (!scope) return [];
  return [...scope.querySelectorAll("button, textarea, input, select, a[href], summary, [tabindex]")]
    .filter(n => !n.disabled && n.tabIndex >= 0 && !n.closest("[hidden], [inert]") && n.getClientRects().length && getComputedStyle(n).visibility !== "hidden");
}

// Menus (role=menu): arrows wrap, Home and End jump, and typing the first
// letters of an item jumps to it. Returns true when it used the key.
let menuTyped = "", menuTypedAt = 0;
function menuKeys(e, menu) {
  const items = [...menu.querySelectorAll("[role^=menuitem]")].filter(n => !n.disabled && !n.closest("[hidden]") && n.getClientRects().length);
  if (!items.length || e.ctrlKey || e.metaKey || e.altKey) return false;
  const i = items.indexOf(root.activeElement);
  let n = -1;
  if (e.key === "ArrowDown") n = (i + 1) % items.length;
  else if (e.key === "ArrowUp") n = i <= 0 ? items.length - 1 : i - 1;
  else if (e.key === "Home") n = 0;
  else if (e.key === "End") n = items.length - 1;
  else if (e.key.length === 1 && /\S/.test(e.key)) {
    const now = Date.now();
    menuTyped = (now - menuTypedAt < 700 ? menuTyped : "") + e.key.toLowerCase();
    menuTypedAt = now;
    const label = b => (b.querySelector("span:not([class])")?.textContent || b.textContent).trim().toLowerCase();
    // the same letter again moves on to the next item with it
    const from = menuTyped.length === 1 ? i + 1 : Math.max(i, 0);
    const order = items.slice(from).concat(items.slice(0, from));
    const hit = order.find(b => label(b).startsWith(menuTyped)) || (menuTyped.length > 1 && order.find(b => label(b).startsWith(e.key.toLowerCase())));
    if (hit) n = items.indexOf(hit);
    else return true; // no item starts with it: swallow the letter, stay put
  }
  if (n < 0) return false;
  e.preventDefault();
  for (const b of items) b.tabIndex = b === items[n] ? 0 : -1; // the current item is the menu's one Tab stop
  items[n].focus();
  return true;
}

// Modals keep Tab inside; nothing else in Morse traps it.
function tabWithin(e, scope) {
  const list = tabbables(scope);
  e.preventDefault();
  if (!list.length) return;
  const i = list.indexOf(root.activeElement);
  list[e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1)].focus();
}

// Nothing on the page had focus before Morse took it: the page's next Tab
// starts from its top, not from after Morse's own (now hidden) UI at the very
// end of the document, where it would leave the page.
// The listener sits on the page's body, so it has to come off when this copy
// goes quiet (letGo). Left there, the closure keeps that whole overlay.
let pageTopDrop = null;
function clearPageTop() {
  const b = document.body;
  const fn = pageTopDrop;
  pageTopDrop = null;
  if (!fn || !b) return;
  b.removeEventListener("focusout", fn);
  if (b.getAttribute("tabindex") === "-1") b.removeAttribute("tabindex");
}
function focusPageTop() {
  const b = document.body;
  if (!b || !live()) return;
  // Body has to be focusable for this turn or Chromium never records it as
  // the start of Tab order. Taking tabindex away in the same turn drops that
  // start, and the next Tab stays on the body (its text is the whole page).
  // It comes off once focus leaves the body, so the body is not itself a tab stop.
  if (!b.hasAttribute("tabindex")) {
    b.setAttribute("tabindex", "-1");
    pageTopDrop = () => {
      if (document.activeElement === b) return;
      clearPageTop();
    };
    b.addEventListener("focusout", pageTopDrop);
  }
  try { b.focus({ preventScroll: true }); } catch {}
}

function nowFocused() {
  if (root.activeElement) return root.activeElement;
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a && a !== document.body && a !== document.documentElement && a !== hostEl ? a : null;
}

// ---- screen readers: a few meaningful messages, never the streaming code.
// The bar and modals are aria-modal, so while one is open the message goes
// inside it; with nothing open it goes to a region on the overlay itself.
const pageLive = document.createElement("div");
pageLive.className = "sr";
pageLive.setAttribute("role", "status");
pageLive.setAttribute("aria-live", "polite");
root.prepend(pageLive);
function liveRegion() {
  if (!modal.hidden) return modal.querySelector(".card > .sr") || pageLive;
  if (!bar.hidden) return bar.querySelector(":scope > .sr") || pageLive;
  return pageLive;
}
let lastSaid = "", lastSaidAt = 0, sayTimer = 0;
// again: the same words may be said twice (a toast repeated), once 1.5s have passed.
function announce(text, { again = false } = {}) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return;
  const now = Date.now();
  if (t === lastSaid && (!again || now - lastSaidAt < 1500)) return;
  lastSaid = t;
  lastSaidAt = now;
  const el = liveRegion();
  // Emptied first, so a region that just appeared, or the same words again, still speak.
  for (const r of root.querySelectorAll(".sr[role=status]")) if (r !== el) r.textContent = "";
  el.textContent = "";
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { el.textContent = t; }, 60);
}

// A card's <header> and <footer> are just its top and bottom, not landmarks:
// as banner and contentinfo they'd add a second set to the page underneath.
function plainEnds(n) {
  if (n.matches?.("header:not([role]), footer:not([role])")) n.setAttribute("role", "none");
  for (const h of n.querySelectorAll?.("header:not([role]), footer:not([role])") || []) h.setAttribute("role", "none");
}
new MutationObserver(recs => { for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1) plainEnds(n); })
  .observe(root, { childList: true, subtree: true });
