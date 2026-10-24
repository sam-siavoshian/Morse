// Which CDP targets of a desktop app Morse attaches to.
//
// Real apps render in more than one place: several windows ("page"), Electron
// BrowserViews / WebContentsViews (also "page", sometimes "other"), <webview>
// guests (Slack, Discord: "webview"), and out-of-process iframes ("iframe",
// e.g. VS Code webviews). Workers, the browser's own UI and DevTools are not
// documents a person looks at, so they are skipped.

const DOC_TYPES = new Set(["page", "webview", "other", "iframe"]);
const INTERNAL = /^(devtools|chrome|chrome-extension|chrome-untrusted|chrome-search|edge|brave|view-source):/i;
const WEB = /^https?:/i;

export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// "app.slack.com" and "files.slack.com" belong together; "youtube.com" in a
// Slack message does not. Good enough without a public-suffix list: compare
// the last two labels (three when the second-to-last is short, like co.uk).
export function siteOf(url) {
  const h = hostOf(url);
  if (!h || /^[\d.]+$/.test(h) || h.includes(":")) return h;
  const parts = h.split(".");
  const n = parts.length > 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
  return parts.slice(-n).join(".");
}

// Returns { attach, frame, why }. `frame` means the document is not a top-level
// window (an iframe target), so the runtime must be allowed to start there.
// `parentUrl` is the url of the target's parent (for iframes), when known.
export function classifyTarget(t, parentUrl = null) {
  const url = t.url || "";
  if (!DOC_TYPES.has(t.type)) return { attach: false, why: `${t.type || "unknown"} target` };
  if (!url || url === "about:blank" || /^(data|blob|javascript):/i.test(url)) return { attach: false, why: "blank" };
  if (INTERNAL.test(url)) return { attach: false, why: "internal page" };
  if (t.type === "iframe") {
    // App-owned webviews (vscode-webview://, app://, file://) are content the
    // person works in. Third-party web iframes (video embeds, ads, payment
    // forms) are left alone.
    if (!WEB.test(url)) return { attach: true, frame: true, why: "app webview" };
    if (parentUrl && siteOf(parentUrl) && siteOf(parentUrl) === siteOf(url)) return { attach: true, frame: true, why: "same-site frame" };
    return { attach: false, why: "third-party frame" };
  }
  return { attach: true, frame: false, why: t.type };
}

// Targets to attach to, from one /json/list response.
export function selectTargets(list) {
  const byId = new Map(list.map(t => [t.id, t]));
  return list.filter(t => classifyTarget(t, t.parentId ? byId.get(t.parentId)?.url : null).attach);
}

export function describeTarget(t) {
  const kind = t.type === "page" ? (t.openerId ? "popup" : "window") : t.type === "iframe" ? "frame" : t.type === "webview" ? "webview" : "view";
  let title = (t.title || "").trim();
  if (!title || title === t.url) title = hostOf(t.url) || t.url || "untitled";
  return { kind, title: title.length > 60 ? title.slice(0, 57) + "…" : title };
}
