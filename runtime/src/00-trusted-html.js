// Trusted Types. Some apps and sites make the browser refuse HTML strings:
// VS Code's window says `require-trusted-types-for 'script'`, and then
// `el.innerHTML = "…"` throws "This document requires 'TrustedHTML'
// assignment", in Morse's own world too. The runtime builds its whole UI from
// its own templates that way, so in VS Code it died before the bar existed.
//
// Here, only when the page enforces Trusted Types, and only in Morse's own
// world (each JS world has its own prototypes, so the page's protection is
// untouched), innerHTML and insertAdjacentHTML build the same nodes one by
// one. They never make <script>, <iframe>, <object> or <embed>, on* handlers or
// javascript: links. Mods run in the page's world, where the page's rules apply.
(() => {
  // Desktop: the connector's shim set __morseHost in this world first.
  // Extension: a content script, in the extension's world.
  const isolated = !!globalThis.__morseHost || !!globalThis.chrome?.runtime?.id;
  if (!isolated) return;
  try { document.createElement("div").innerHTML = "<b></b>"; return; } catch {}

  const SVG = "http://www.w3.org/2000/svg";
  const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
  const RAW = new Set(["style", "textarea", "title"]);
  // SVG's animate and set can turn a link's href into javascript: after it is
  // built, and use can pull in another document; Morse's UI uses none of them.
  const BANNED = new Set(["script", "iframe", "object", "embed", "frame", "frameset", "base", "meta", "portal", "fencedframe", "animate", "set", "use"]);
  // Tags that close an open one of the same kind (`<li>a<li>b`), as the parser would.
  const SELF_CLOSING = new Set(["li", "option", "p", "tr", "td", "th", "dt", "dd"]);
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–", larr: "←", rarr: "→", uarr: "↑", darr: "↓", copy: "©", check: "✓" };
  const code = n => (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd"); // as the parser does, never a throw
  const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === "#" ? code(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
  // What a browser reads as the scheme: it drops tabs and line breaks anywhere,
  // and control characters and spaces at the start ("java&#9;script:").
  const scriptUrl = v => /^(javascript|vbscript):/i.test(v.replace(/[\x00-\x20]+/g, ""));

  // HTML text -> a DocumentFragment of `doc`, for content inside `context`.
  function build(html, context) {
    const frag = document.createDocumentFragment();
    const stack = [{ node: frag, tag: "", svg: context?.namespaceURI === SVG }];
    const top = () => stack[stack.length - 1];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|[^<]+|</g;
    const attrRe = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    html = String(html);
    while ((m = re.exec(html))) {
      const [all, close, open, attrs = "", selfClose] = m;
      if (all.startsWith("<!--")) continue;
      if (close) {
        const name = close.toLowerCase();
        const i = stack.map(f => f.tag).lastIndexOf(name);
        if (i > 0) stack.length = i;
        continue;
      }
      if (!open) { top().node.appendChild(document.createTextNode(decode(all))); continue; }
      let name = open.toLowerCase();
      if (SELF_CLOSING.has(name) && top().tag === name) stack.pop();
      const svg = top().svg || name === "svg";
      const el = svg ? document.createElementNS(SVG, open) : document.createElement(name);
      let a;
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(attrs))) {
        const key = a[1], val = decode(a[2] ?? a[3] ?? a[4] ?? "");
        if (/^(on|srcdoc$|http-equiv$)/i.test(key) || (/^(href|src|action|formaction|xlink:href)$/i.test(key) && scriptUrl(val))) continue;
        try { el.setAttribute(key, val); } catch {}
      }
      const banned = BANNED.has(name);
      if (RAW.has(name) && !svg && !selfClose) {
        // Searched in the text itself: lower-casing first can change its length ("İ"), and the offsets with it.
        const endRe = new RegExp(`</${name}`, "gi");
        endRe.lastIndex = re.lastIndex;
        const end = endRe.exec(html)?.index ?? -1;
        const text = html.slice(re.lastIndex, end < 0 ? html.length : end);
        el.textContent = name === "style" ? text : decode(text);
        re.lastIndex = end < 0 ? html.length : html.indexOf(">", end) + 1;
        if (!banned) top().node.appendChild(el);
        continue;
      }
      if (!banned) top().node.appendChild(el);
      if (!selfClose && !VOID.has(name)) stack.push({ node: banned ? document.createDocumentFragment() : el, tag: name, svg: svg && name !== "foreignobject" });
    }
    return frag;
  }

  const setter = (proto, prop) => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d?.set) return;
    Object.defineProperty(proto, prop, { ...d, set(v) { this.replaceChildren(build(v, this)); } });
  };
  setter(Element.prototype, "innerHTML");
  setter(ShadowRoot.prototype, "innerHTML");
  Element.prototype.insertAdjacentHTML = function (where, html) {
    const w = String(where).toLowerCase();
    const frag = build(html, w === "beforebegin" || w === "afterend" ? this.parentNode : this);
    if (w === "beforebegin") this.before(frag);
    else if (w === "afterbegin") this.prepend(frag);
    else if (w === "beforeend") this.append(frag);
    else if (w === "afterend") this.after(frag);
    else throw new SyntaxError(`insertAdjacentHTML: "${where}" isn't a position`);
  };
  globalThis.__morseTrustedHtml = build; // tests
})();
