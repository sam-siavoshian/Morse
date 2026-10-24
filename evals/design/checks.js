// In-page helpers for the design eval's functional checks (evals/design/cases.json):
// `D`, next to the main eval's `T` (evals/page-helpers.js). Each returns
// true, or a short reason it failed.

export function designChecks() {
  const el = x => (typeof x === "string" ? document.querySelector(x) : x);
  const clickable = e => e.matches("button,[role=button],a,input[type=button],input[type=checkbox],select,summary") || getComputedStyle(e).cursor === "pointer";
  const D = {
    // New visible elements inside a part of the page (a selector or an element).
    freshIn(root) { const r = el(root); return r ? T.fresh().filter(e => r.contains(e) && T.visible(e)) : []; },
    text(root) { return D.freshIn(root).map(e => e.innerText || e.value || "").join(" ") + " " + T.freshText(); },
    clickables(root) { return D.freshIn(root).filter(clickable); },
    words: s => String(s || "").split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length,
    numbers: s => [...String(s).matchAll(/\d[\d,.]*/g)].map(m => +m[0].replace(/,/g, "")).filter(Number.isFinite),
    // A countdown or stopwatch (mm:ss) in root that runs, by itself or once clicked.
    async timer(root) {
      const time = () => (D.text(root).match(/\b\d{1,2}:\d{2}\b/) || [])[0];
      const t0 = time();
      if (!t0) return `no timer (mm:ss) there: "${D.text(root).trim().slice(0, 80)}"`;
      await T.sleep(2200);
      if (time() !== t0) return true;
      // The time itself first (a start/pause toggle), then a start button, never reset first.
      const rank = c => (/\d{1,2}:\d{2}/.test(c.innerText || "") ? 0 : /start|play|begin|resume/i.test(`${c.innerText} ${c.getAttribute("aria-label") || ""} ${c.title || ""} ${c.className}`) ? 1 : /reset|restart|stop|skip/i.test(`${c.getAttribute("aria-label") || ""} ${c.title || ""} ${c.className} ${c.closest("[aria-label],[title]")?.getAttribute("aria-label") || ""}`) ? 3 : 2);
      const cs = D.clickables(root).sort((a, b) => rank(a) - rank(b));
      if (!cs.length) return "it doesn't run, and nothing there starts it";
      for (const c of cs.slice(0, 3)) {
        await T.click(c);
        await T.sleep(2300);
        if (time() && time() !== t0) return true;
      }
      return "the timer doesn't run after clicking it";
    },
    // A count shown in root within [lo, hi].
    count(root, lo, hi) {
      const t = D.text(root), ns = D.numbers(t);
      return ns.some(n => n >= lo && n <= hi) || `no number between ${lo} and ${hi}: "${t.trim().slice(0, 80)}"`;
    },
    // Rows of a list: how many, their usual height, and whether they overlap
    // or leave gaps (a virtualized list that still places rows at the old height).
    rows(sel) {
      const rs = [...document.querySelectorAll(sel)].filter(T.visible).map(e => e.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      const hs = rs.map(r => r.height).sort((a, b) => a - b);
      let overlap = 0, gap = 0;
      for (let i = 1; i < rs.length; i++) { const d = rs[i].top - rs[i - 1].bottom; if (d < -1) overlap++; if (d > 4) gap++; }
      return { n: rs.length, h: hs[hs.length >> 1] || 0, overlap, gap };
    },
    compact(sel, B, { min = 12 } = {}) {
      const A = D.rows(sel);
      if (A.n < Math.min(B.n, 3)) return `rows went missing (${A.n} of ${B.n})`;
      if (A.h > B.h - 2) return `rows are ${Math.round(A.h)}px, were ${Math.round(B.h)}px`;
      if (A.h < min) return `rows are ${Math.round(A.h)}px: too small to read`;
      if (A.overlap > B.overlap) return `rows overlap (${A.overlap})`;
      if (A.gap > B.gap) return `rows have gaps between them (${A.gap}): the list still places them at the old height`;
      return true;
    },
    // Something new that changes when the page (or a scroller) scrolls.
    async scrolls(scroller) {
      const sig = () => T.fresh().filter(T.visible).map(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return `${Math.round(r.width)}|${Math.round(r.height)}|${s.transform}|${s.width}|${e.getAttribute("value")}|${e.getAttribute("aria-valuenow")}`; }).join(",") + T.topBarWidth();
      const s0 = sig();
      if (!T.fresh().filter(T.visible).length && !T.topBarWidth()) return "nothing new on screen";
      const sc = scroller ? el(scroller) : document.scrollingElement;
      sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * 0.5;
      (scroller ? sc : window).dispatchEvent(new Event("scroll"));
      await T.sleep(600);
      return sig() !== s0 || "nothing new changes when it scrolls";
    },
    // Clicking something new in root puts text containing `want` on the clipboard.
    async copies(root, want) {
      const cs = D.clickables(root);
      if (!cs.length) return "no new button there";
      for (const c of cs.slice(0, 3)) { await T.click(c); await T.sleep(400); if (String(window.__clip).includes(want)) return true; }
      return `the clipboard has "${String(window.__clip).slice(0, 60)}"`;
    },
    // The mod again from the start (as after a reload): what it stored stays.
    rerun: () => window.__evalRerun(),
  };
  window.D = D;
}
