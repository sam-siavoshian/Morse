// The README and docs/: every relative link and image points at a file that
// exists, and every #anchor at a heading that exists (GitHub's heading ids).
// Links to websites are not fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function mdFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...mdFiles(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
export const docFiles = () => [path.join(root, "README.md"), ...(existsSync(path.join(root, "CONTRIBUTING.md")) ? [path.join(root, "CONTRIBUTING.md")] : []), ...mdFiles(path.join(root, "docs"))];

// Markdown with fenced code blocks blanked out (line numbers kept), and
// inline code too unless `keepInline`.
export function withoutCode(src, { keepInline = false } = {}) {
  const lines = src.split("\n");
  let fence = null;
  return lines.map(l => {
    const f = /^\s*(```|~~~)/.exec(l);
    if (fence) { if (f && l.trim().startsWith(fence)) fence = null; return ""; }
    if (f) { fence = f[1]; return ""; }
    return keepInline ? l : l.replace(/(`+)[^`]*?\1/g, m => " ".repeat(m.length));
  }).join("\n");
}

// Every link and image target: [text](target "title"), ![alt](target),
// [text]: target (reference definitions), and src= / href= in inline HTML.
export function links(src) {
  const out = [];
  withoutCode(src).split("\n").forEach((l, i) => {
    const line = i + 1;
    for (const m of l.matchAll(/!?\[(?:[^\][]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ target: m[1], line, image: m[0].startsWith("!") });
    const def = /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(\s|$)/.exec(l);
    if (def) out.push({ target: def[1], line, image: false });
    for (const m of l.matchAll(/<(img|a|source|video)\b[^>]*?\b(src|href|poster)="([^"]+)"/gi)) out.push({ target: m[3], line, image: m[1].toLowerCase() !== "a" });
  });
  return out;
}

// GitHub's heading ids: lowercase, punctuation dropped, spaces to hyphens,
// repeats numbered -1, -2…
export function anchors(src) {
  const seen = new Map(), out = new Set();
  for (const l of withoutCode(src, { keepInline: true }).split("\n")) {
    const h = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (!h) continue;
    const text = h[1].replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/[`*~]/g, "");
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  // Explicit anchors: <a id="..."> / <a name="...">
  for (const m of src.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]);
  return out;
}

const external = t => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(t);

test("every relative link and image in the README and docs/ exists", () => {
  const broken = [];
  let checked = 0;
  for (const file of docFiles()) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    for (const { target, line } of links(src)) {
      if (external(target)) continue;
      const [p, hash] = target.split("#");
      const dest = p ? path.resolve(path.dirname(file), decodeURIComponent(p.split("?")[0])) : file;
      checked++;
      if (!dest.startsWith(root + path.sep) && dest !== root) { broken.push(`${rel}:${line} ${target} (outside the repo)`); continue; }
      if (!existsSync(dest)) { broken.push(`${rel}:${line} ${target} (no such file)`); continue; }
      if (hash && dest.endsWith(".md") && statSync(dest).isFile() && !anchors(readFileSync(dest, "utf8")).has(decodeURIComponent(hash).toLowerCase()))
        broken.push(`${rel}:${line} ${target} (no heading #${hash} in ${path.relative(root, dest)})`);
    }
  }
  assert.ok(checked > 100, `the scan reads the docs' links (saw ${checked})`);
  assert.deepEqual(broken, [], `broken links:\n${broken.join("\n")}`);
});

test("the README stays short: depth lives in docs/", () => {
  const lines = readFileSync(path.join(root, "README.md"), "utf8").split("\n").length;
  assert.ok(lines <= 180, `README.md is ${lines} lines. Move the detail to a page in docs/ and keep one row in “What you can do”.`);
});

test("every user page in docs/ is listed in docs/README.md", () => {
  const index = readFileSync(path.join(root, "docs/README.md"), "utf8");
  const listed = new Set(links(index).map(l => path.resolve(path.join(root, "docs"), l.target.split("#")[0])));
  const pages = [...readdirSync(path.join(root, "docs")).filter(f => f.endsWith(".md") && f !== "README.md").map(f => path.join(root, "docs", f)),
    ...readdirSync(path.join(root, "docs/dev")).filter(f => f.endsWith(".md")).map(f => path.join(root, "docs/dev", f))];
  const missing = pages.filter(p => !listed.has(p)).map(p => path.relative(root, p));
  assert.deepEqual(missing, [], `pages not linked from docs/README.md: ${missing.join(", ")}`);
});

test("the link scanner finds links and images, and skips code", () => {
  const src = [
    "See [the guide](docs/a.md#top) and ![shot](img/x.png).",
    "`[not a link](nope.md)`",
    "```",
    "[also not](nope2.md)",
    "```",
    "[ref]: ../b.md",
    "<img src=\"pic.png\" alt=\"\"> [web](https://example.com)",
  ].join("\n");
  assert.deepEqual(links(src).map(l => l.target), ["docs/a.md#top", "img/x.png", "../b.md", "https://example.com", "pic.png"]);
  assert.deepEqual([...anchors("# Hello, world\n## `morse launch` --watch\n## Hello, world\n```\n# not\n```")], ["hello-world", "morse-launch---watch", "hello-world-1"]);
});
