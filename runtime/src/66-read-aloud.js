// Read aloud: the browser's own speech (speechSynthesis), so it works offline
// and needs no model. It reads what you selected, what you pointed at, or the
// main text of the page, one sentence at a time, and marks the sentence being
// read. Play/pause, previous/next sentence, speed. Esc stops.
// Started from the page tools (65-a11y.js) or the edit toolbar.

const ReadAloud = (() => {
  const RATES = [0.75, 1, 1.25, 1.5, 2];
  const SKIP = "script, style, noscript, template, textarea, select, option, [aria-hidden=true], [hidden], [data-morse-ui]";
  const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, td, th, dd, dt, blockquote, figcaption, pre, div, section, article, header, footer, aside, main, nav, label, button, summary, tr";
  const icon = d => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    play: '<path d="M5 3.25v9.5L12.75 8z" fill="currentColor"/>',
    pause: '<path d="M5.25 3.5v9M10.75 3.5v9" stroke-width="2"/>',
    prev: '<path d="M4 3.5v9M12 3.5 6.5 8l5.5 4.5z" fill="currentColor"/>',
    next: '<path d="M12 3.5v9M4 3.5 9.5 8 4 12.5z" fill="currentColor"/>',
  };

  const layer = document.createElement("div");
  layer.className = "ra-layer";
  const card = document.createElement("div");
  card.className = "ra";
  card.hidden = true;
  card.setAttribute("role", "region");
  card.setAttribute("aria-label", "Read aloud");
  root.insertBefore(layer, bar);
  root.append(card);

  let R = null, raf = 0;
  const synth = () => globalThis.speechSynthesis;

  // ---- what to read: the last selection on the page, kept while the bar opens
  let lastSel = null;
  document.addEventListener("selectionchange", () => {
    const s = document.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (r.commonAncestorContainer === hostEl || hostEl.contains(r.commonAncestorContainer) || !r.toString().trim()) return;
    lastSel = r.cloneRange();
  });
  listen("pointerdown", e => { if (!ours(e) && !card.contains(e.target)) lastSel = null; }, true);
  const hasSelection = () => !!(lastSel && lastSel.startContainer.isConnected && lastSel.toString().trim());

  const shown = el => !el.closest(SKIP) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const readable = el => !!el && el.nodeType === 1 && !el.matches("img, video, audio, canvas, iframe, input, select, textarea") && (el.innerText || "").trim().length > 1;

  // The main text of the page: a landmark holding most of the text, else the
  // block with the most paragraph text.
  function mainText() {
    const len = el => (el.innerText || "").length;
    const marks = [...document.querySelectorAll("article, main, [role=main]")].filter(el => shown(el) && len(el) > 200).sort((a, b) => len(b) - len(a));
    if (marks.length) return marks.find(m => marks[0].contains(m) && m !== marks[0] && len(m) > len(marks[0]) * 0.6) || marks[0];
    const score = new Map();
    for (const p of document.querySelectorAll("p")) {
      if (!shown(p)) continue;
      for (let n = p.parentElement, i = 0; n && n !== document.body && i < 3; n = n.parentElement, i++) score.set(n, (score.get(n) || 0) + len(p) / (i + 1));
    }
    let best = document.body, top = 0;
    for (const [n, s] of score) if (s > top) { best = n; top = s; }
    return best;
  }

  // Text nodes in reading order, joined with a line break between blocks so
  // sentences never run across a heading. Each sentence becomes a Range.
  function sentences(range) {
    const scope = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeValue.trim() && range.intersectsNode(n) && n.parentElement && shown(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const parts = [];
    let text = "", lastBlock = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n === range.startContainer ? range.startOffset : 0, e = n === range.endContainer ? range.endOffset : n.length;
      if (e <= s) continue;
      const block = n.parentElement.closest(BLOCK);
      if (lastBlock && block !== lastBlock) text += "\n";
      lastBlock = block;
      parts.push({ n, s, at: text.length, len: e - s });
      text += n.nodeValue.slice(s, e);
    }
    const spans = [];
    if (globalThis.Intl?.Segmenter) {
      for (const seg of new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: "sentence" }).segment(text)) spans.push([seg.index, seg.index + seg.segment.length]);
    } else {
      for (const m of text.matchAll(/[^.!?\n]+[.!?]*["')\]]*\s*|\n+/g)) spans.push([m.index, m.index + m[0].length]);
    }
    const at = i => { // text offset -> (node, offset)
      let lo = 0, hi = parts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (parts[mid].at <= i) lo = mid; else hi = mid - 1; }
      const p = parts[lo];
      return [p.n, p.s + Math.max(0, Math.min(p.len, i - p.at))];
    };
    const out = [];
    for (let [a, b] of spans) {
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b - a < 2 || !/[\p{L}\p{N}]/u.test(text.slice(a, b))) continue;
      const r = document.createRange();
      r.setStart(...at(a));
      r.setEnd(...at(b - 1)); // the last character's node
      r.setEnd(r.endContainer, r.endOffset + 1);
      out.push({ text: text.slice(a, b).replace(/\s+/g, " "), range: r });
      if (out.length >= 600) break;
    }
    return out;
  }

  function voiceFor(lang) {
    const all = synth()?.getVoices?.() || [];
    const l = (lang || "en").toLowerCase().slice(0, 2);
    return all.find(v => v.localService && v.default && v.lang.toLowerCase().startsWith(l)) ||
      all.find(v => v.localService && v.lang.toLowerCase().startsWith(l)) || null;
  }

  // ---- reading
  function start(what) {
    if (!synth() || !globalThis.SpeechSynthesisUtterance) return toast("This app has no voice to read aloud with.");
    let range = what;
    if (!(what instanceof Range)) {
      range = document.createRange();
      range.selectNodeContents(what || mainText());
    }
    const segs = sentences(range);
    if (!segs.length) return toast("There's no text to read there. Point at some text, or select it first.");
    stop(true);
    if (S.open) closeBar(); // the page is theirs while it reads
    const lang = (range.startContainer.parentElement?.closest("[lang]") || document.documentElement).getAttribute("lang") || navigator.language;
    let rate = 1;
    try { rate = RATES.includes(+localStorage.getItem("morse:read-rate")) ? +localStorage.getItem("morse:read-rate") : 1; } catch {}
    R = { segs, i: 0, rate, lang, playing: true, token: null };
    card.hidden = false;
    render();
    speak();
    if (!raf) raf = requestAnimationFrame(loop);
    card.querySelector("[data-ra=play]")?.focus({ preventScroll: true });
  }
  function fromPage() {
    if (hasSelection()) return start(lastSel);
    if (S.target && readable(S.target)) return start(S.target);
    start(null);
  }
  function speak() {
    const s = synth(), seg = R.segs[R.i], token = {};
    R.token = token;
    s.cancel();
    const u = new SpeechSynthesisUtterance(seg.text);
    u.rate = R.rate;
    u.lang = R.lang;
    const v = voiceFor(R.lang);
    if (v) u.voice = v;
    u.onend = () => { if (R && R.token === token && R.playing) R.i + 1 < R.segs.length ? (R.i++, speak()) : done(); };
    u.onerror = e => {
      if (!R || R.token !== token || /interrupted|canceled/.test(e.error || "")) return;
      stop();
      console.warn("[morse] read aloud", e.error);
      toast("Couldn't read aloud. Check that this computer has a voice installed.");
    };
    s.speak(u);
    render();
    reveal();
  }
  function play() { if (!R) return; R.playing = true; speak(); }
  function pause() {
    if (!R) return;
    R.playing = false;
    R.token = null;
    synth().cancel();
    render();
  }
  function go(d) {
    if (!R) return;
    R.i = Math.max(0, Math.min(R.segs.length - 1, R.i + d));
    R.playing ? speak() : (render(), reveal());
  }
  function setRate() {
    if (!R) return;
    R.rate = RATES[(RATES.indexOf(R.rate) + 1) % RATES.length];
    try { localStorage.setItem("morse:read-rate", String(R.rate)); } catch {}
    R.playing ? speak() : render(); // the new speed starts with this sentence
  }
  function done() {
    stop(true);
    toast("Finished reading");
  }
  function stop(quiet) {
    if (!R) return;
    R.token = null;
    R = null;
    try { synth()?.cancel(); } catch {}
    card.hidden = true;
    layer.textContent = "";
    cancelAnimationFrame(raf);
    raf = 0;
    if (!quiet) toast("Stopped reading");
  }

  // ---- the card, and the mark on the sentence being read
  function render() {
    if (!R) return;
    const n = R.segs.length;
    card.innerHTML = `
      <button type="button" class="ra-main" data-ra="play" aria-label="${R.playing ? "Pause" : "Play"}" title="${R.playing ? "Pause" : "Play"}">${icon(R.playing ? I.pause : I.play)}</button>
      <button type="button" data-ra="prev" aria-label="Previous sentence" title="Previous sentence" ${R.i === 0 ? "disabled" : ""}>${icon(I.prev)}</button>
      <button type="button" data-ra="next" aria-label="Next sentence" title="Next sentence" ${R.i >= n - 1 ? "disabled" : ""}>${icon(I.next)}</button>
      <div class="ra-text" aria-live="off"><b>${R.playing ? "Reading aloud" : "Paused"}</b><small>Sentence ${R.i + 1} of ${n}</small></div>
      <button type="button" class="ra-rate" data-ra="rate" aria-label="Speed ${R.rate} times. Change speed" title="Speed">${R.rate}×</button>
      <button type="button" class="ra-x" data-ra="stop" aria-label="Stop reading" title="Stop (Esc)">×</button>`;
  }
  function reveal() {
    const r = R?.segs[R.i]?.range.getBoundingClientRect();
    if (r && (r.top < 60 || r.bottom > innerHeight - 120)) {
      const el = R.segs[R.i].range.startContainer.parentElement;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  function loop() {
    raf = 0;
    if (!R) return;
    const rects = [...R.segs[R.i].range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
    // One mark per line: merge the rects that share a line.
    const lines = [];
    for (const r of rects) {
      const l = lines.find(x => Math.abs(x.top - r.top) < 4 && Math.abs(x.bottom - r.bottom) < 4);
      if (l) { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    while (layer.children.length < lines.length) layer.append(document.createElement("i"));
    [...layer.children].forEach((m, k) => {
      const l = lines[k];
      m.hidden = !l;
      if (l) Object.assign(m.style, { transform: `translate(${l.left - 2}px, ${l.top - 1}px)`, width: l.right - l.left + 4 + "px", height: l.bottom - l.top + 2 + "px" });
    });
    raf = requestAnimationFrame(loop);
  }

  card.addEventListener("click", e => {
    const a = e.target.closest("button")?.dataset.ra;
    if (a === "play") R?.playing ? pause() : play();
    if (a === "prev") go(-1);
    if (a === "next") go(1);
    if (a === "rate") setRate();
    if (a === "stop") stop();
    if (a && a !== "stop") card.querySelector(`[data-ra=${a}]`)?.focus({ preventScroll: true });
  });
  // Esc stops reading (the bar takes Esc first while it's open).
  listen("keydown", e => {
    if (!e.isTrusted || !R || S.open || e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stop();
  }, true);
  listen("pagehide", () => stop(true));

  return {
    start, fromPage, stop, play, pause, readable, hasSelection,
    get state() { return R ? { playing: R.playing, i: R.i, n: R.segs.length, rate: R.rate, text: R.segs[R.i].text } : null; },
  };
})();
