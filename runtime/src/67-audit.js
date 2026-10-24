// Check this page: a quick look for common problems, with no model. Pictures
// with no description, buttons and links with no name, form fields with no
// label, text too light to read, things too small to click, video or sound
// that plays by itself (rules in core/a11y.js). Each kind is listed in the bar
// with numbered markers on the page (62-markers.js) and a Fix it button:
//   - fixes Morse can work out (a tooltip or icon gives the name, a darker
//     color, a bigger size) are saved at once in "Accessibility fixes",
//   - the rest becomes one precise request to the model, which you then save
//     or undo like any change,
//   - pictures are described one at a time (68-describe.js).

const Audit = (() => {
  const MAX_MARKS = 30;
  const card = document.createElement("section");
  card.className = "au";
  card.hidden = true;
  card.setAttribute("aria-label", "Check this page");
  bar.insertBefore(card, bar.querySelector(".status"));
  let groups = [];

  const selOf = el => GodMode.targetOf(el).sel;

  function run() {
    if (!S.open) openBar();
    if (S.phase !== "idle") return;
    if (S.target) setTarget(null);
    S.picking = false; // the page is for looking at now; clicks go through
    hl.hidden = true;
    check();
  }

  function check() {
    const issues = auditPage(document);
    groups = AUDIT_ORDER.map(rule => ({ rule, items: issues.filter(i => i.rule === rule) })).filter(g => g.items.length);
    // One number per place: a tiny unnamed button is one marker, listed twice.
    const nums = new Map(), marks = [];
    for (const g of groups) for (const it of g.items) {
      it.sel = selOf(it.el);
      if (!nums.has(it.el)) {
        nums.set(it.el, nums.size + 1);
        if (marks.length < MAX_MARKS) marks.push({ n: nums.size, selector: it.sel, label: label(it) });
      }
      it.n = nums.get(it.el);
    }
    render();
    Markers.show(marks);
    dodge();
    const total = new Set(groups.flatMap(g => g.items.map(i => i.el))).size;
    hintNote = "";
    note(total ? `<b>Checked</b> · ${total} place${total > 1 ? "s" : ""} to fix · <kbd>Esc</kbd> to close` : `<b>Checked</b> · nothing to fix · <kbd>Esc</kbd> to close`, 0);
    setTimeout(() => announce(total ? `Found ${groups.map(g => auditSummary(g.rule, g.items.length, g.items).title).join(". ")}.` : "No common problems found on this page."), 300);
  }

  function label(it) {
    const el = it.el, kind = el.matches("a") ? "link" : el.matches("select") ? "list" : el.matches("input, textarea") ? "field" : el.matches("video, audio") ? el.localName : "button";
    const guess = it.guess?.text ? ` (maybe “${it.guess.text}”)` : "";
    if (it.rule === "contrast") return `“${(el.innerText || "").trim().slice(0, 28)}…” (${it.ratio.toFixed(1)} to 1)`;
    if (it.rule === "target") return `${kind}, ${it.w}×${it.h} pixels`;
    if (it.rule === "alt") { const src = el.getAttribute("src") || ""; return /^data:/.test(src) ? "picture" : src.split(/[/?#]/).filter(Boolean).pop()?.slice(0, 32) || "picture"; }
    if (it.rule === "name" || it.rule === "label") return `${kind}${guess || ", no hint"}`;
    return kind;
  }

  // What Fix it will do for a group: { now: [fixes], model: [items], describe: [items] }
  function plan(g) {
    const now = [], model = [], describe = [];
    for (const it of g.items) {
      if (g.rule === "name" || g.rule === "label") it.guess ? now.push({ kind: g.rule, sel: it.sel, text: it.guess.text }) : model.push(it);
      else if (g.rule === "alt") it.guess ? now.push({ kind: "alt", sel: it.sel, text: it.guess.text }) : describe.push(it);
      else if (g.rule === "contrast") now.push({ kind: "color", sel: it.sel, color: it.color });
      else if (g.rule === "target") now.push({ kind: "size", sel: it.sel, display: it.display });
      else if (g.rule === "autoplay") now.push({ kind: "still", sel: it.sel });
    }
    return { now, model, describe };
  }
  function fixNote(p) {
    const parts = [];
    if (p.now.length) parts.push(`${p.now.length} now`);
    if (p.model.length) parts.push(`${p.model.length} by the model`);
    if (p.describe.length) parts.push(`describe ${p.describe.length}`);
    return parts.join(" · ");
  }

  function render() {
    const total = new Set(groups.flatMap(g => g.items.map(i => i.el))).size;
    card.hidden = false;
    bar.classList.add("has-audit");
    card.innerHTML = `
      <header class="au-head">
        <span class="au-k">Check this page</span>
        <span class="au-sum">${total ? `${groups.length} kind${groups.length > 1 ? "s" : ""} of problem · ${total} place${total > 1 ? "s" : ""}` : "Nothing to fix"}</span>
        <button type="button" class="au-again" data-au="again" title="Check again">Check again</button>
        <button type="button" class="ask-x" data-au="close" aria-label="Close" title="Close">×</button>
      </header>
      ${total ? `<ol class="au-list">${groups.map((g, gi) => {
        const s = auditSummary(g.rule, g.items.length, g.items), p = plan(g);
        const fixLabel = p.describe.length && !p.now.length ? "Describe" : "Fix it";
        return `<li class="au-item">
          <div class="au-main">
            <b>${esc(s.title)}</b>
            <div class="au-sub"><small>${esc(s.help)}</small>
            <span class="au-marks">${g.items.map(it => `<button type="button" class="ask-n" data-n="${it.n}" title="${esc(label(it))}" aria-label="${it.n}: ${esc(label(it))}. Scroll to it">${it.n}</button>`).join("")}</span></div>
          </div>
          <button type="button" class="au-fix" data-fix="${gi}">${fixLabel}<small>${esc(fixNote(p))}</small></button>
        </li>`;
      }).join("")}</ol>` : `<p class="au-ok">No pictures without descriptions, unnamed buttons, unlabeled fields, faint text, tiny targets or autoplaying media found.</p>`}`;
  }
  function hide() {
    if (card.hidden) return;
    card.hidden = true;
    card.innerHTML = "";
    bar.classList.remove("has-audit");
    groups = [];
    if (!Guide.active) Markers.clear();
  }
  // The bar goes to whichever end covers fewer marked things.
  function dodge() {
    const b = bar.getBoundingClientRect(), h = b.height, M = 28;
    const rects = Markers.items.filter(i => Markers.visible(i.el)).map(i => i.el.getBoundingClientRect());
    const covered = (top, bottom) => rects.filter(r => r.right > b.left && r.left < b.right && r.bottom > top && r.top < bottom).length;
    const atTop = covered(M, M + h), atBottom = covered(innerHeight - M - h, innerHeight - M);
    if (atTop !== atBottom) bar.classList.toggle("top", atTop < atBottom);
  }

  async function fix(gi) {
    const g = groups[gi];
    if (!g) return;
    const p = plan(g);
    if (p.now.length) await A11y.addFixes(p.now);
    if (p.model.length) {
      const request = fixRequest(g.rule, p.model.map(it => it.sel));
      hide();
      if (p.now.length) toast(`Fixed ${p.now.length}. Asking the model about the other ${p.model.length}.`);
      setInput(request);
      send(request);
      return;
    }
    if (p.describe.length) {
      if (p.now.length) toast(`Fixed ${p.now.length}. Now describe the other ${p.describe.length === 1 ? "picture" : `${p.describe.length} pictures`}, one at a time.`);
      hide();
      closeBar();
      return DescribeImage.start(p.describe[0].el, { fromAudit: true });
    }
    toast(`${done(g.rule, p.now.length)}. Saved in “${FIX_TITLE}”.`);
    check();
  }
  function done(rule, n) {
    const s = n === 1;
    return {
      name: `Named ${n} button${s ? "" : "s"} and link${s ? "" : "s"}`,
      label: `Labeled ${n} form field${s ? "" : "s"}`,
      alt: `Marked ${n} picture${s ? "" : "s"} as decoration`,
      contrast: `Darkened ${n} piece${s ? "" : "s"} of text`,
      target: `Made ${n} thing${s ? "" : "s"} bigger`,
      autoplay: `Stopped ${n} video${s ? "" : "s"} from playing by ${s ? "itself" : "themselves"}`,
    }[rule] || `Fixed ${n}`;
  }

  card.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.n) return void Markers.scrollTo(b.dataset.n);
    if (b.dataset.au === "close") { hide(); hintNote = ""; setHint(); input.focus(); }
    if (b.dataset.au === "again") check();
    if (b.dataset.fix) fix(+b.dataset.fix).catch(err => toast(`Couldn't fix that. ${plainError(err)}`));
  });
  new MutationObserver(() => { if (bar.hidden) hide(); }).observe(bar, { attributes: true, attributeFilter: ["hidden"] });
  // A new question or change replaces the list.
  outgoing.push(m => { if (m.type === "generate" && !m.context?.a11y) hide(); });

  return { run, check, hide, get groups() { return groups; }, get open() { return !card.hidden; } };
})();
