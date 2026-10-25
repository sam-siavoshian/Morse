// Take this, Bring here (core/take.js, core/take-host.js, daemon/take.js and
// the Morse helper's /v1/taken): what a taken feature keeps, how the list is
// stored and shared between Chrome and the desktop apps, how a typed request
// finds one, and what the model reads to rebuild it in another app's design.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  cleanTaken, takenAdd, takenRemove, mergeTaken, matchTaken, bringAsk, bringMisses, takenForModel, describeMessages, parseDescription, bringPrompt, TAKEN_MAX, DESCRIBE_SYSTEM,
} from "../core/take.js";
import { createTakeHost } from "../core/take-host.js";
import { buildMessages } from "../core/prompt.js";
import { looksHard } from "../core/route.js";
import { createMod } from "../core/mod.js";
import { modOrigin } from "../core/summary.js";
import { demoResponse } from "../core/demo.js";
import { parseModResponse } from "../core/parse.js";
import { parseReply } from "../core/answer.js";

const PIC = "data:image/jpeg;base64," + "A".repeat(400);
const feature = (over = {}) => ({
  id: "palette01", name: "Command palette", label: "“Command palette” dialog", about: "Opens with Ctrl+Shift+P.",
  from: { app: "VSCodium", host: "" }, html: "<div role=\"dialog\" class=\"quick-input-widget\"><input></div>",
  styles: { root: { "background-color": "rgb(34, 34, 34)", "border-radius": "6px" }, size: "600×300", parts: [] },
  hover: [], steps: [{ n: 1, do: "key", selector: "body", key: "Ctrl+Shift+P" }, { n: 2, do: "type", selector: "input", label: "Search", value: "zoom" }],
  thumb: PIC, created: "2026-10-24T10:00:00.000Z", ...over,
});

test("a taken feature keeps only its shape: plain strings, a small picture, no stray fields", () => {
  const it = cleanTaken({ ...feature(), extra: "nope", secret: { a: 1 }, steps: [...feature().steps, { do: "eval", selector: "x" }, { do: "type", hidden: true, value: "hunter2", selector: "#pw" }] });
  assert.equal(it.morse, "taken");
  assert.equal(it.extra, undefined);
  assert.equal(it.secret, undefined);
  assert.deepEqual(it.steps.map(s => s.do), ["key", "type", "type"], "steps it can't read are left out");
  assert.equal(it.steps[2].value, undefined, "a hidden field's value is never kept");
  assert.equal(it.steps[2].hidden, true);
  assert.equal(it.thumb, PIC);
  assert.equal(cleanTaken({ ...feature(), thumb: "javascript:alert(1)" }).thumb, undefined);
  assert.equal(cleanTaken({ ...feature(), thumb: "data:image/svg+xml;base64,AAAA" }).thumb, undefined, "only plain pictures");
  assert.equal(cleanTaken({ ...feature(), name: "" }).name, "“Command palette” dialog", "the label names it until the model does");
  assert.equal(cleanTaken({ ...feature(), name: "x".repeat(500) }).name.length, 60);
  assert.equal(cleanTaken({ ...feature(), synced: "yes" }).synced, undefined);
  assert.throws(() => cleanTaken({ ...feature(), id: "../../etc" }), /Not a taken feature/);
  assert.throws(() => cleanTaken(null), /Not a taken feature/);
  assert.equal(cleanTaken({ ...feature(), thumb: "data:image/jpeg;base64," + "A".repeat(300_000) }).thumb, undefined, "a big picture is left out");
  assert.ok(JSON.stringify(cleanTaken({ ...feature(), html: "x".repeat(9000), about: "y".repeat(5000) })).length < 9000, "long parts are cut");
});

test("the list: newest first, one per id, at most 30; two lists merge by what changed last", () => {
  let list = [];
  for (let i = 0; i < TAKEN_MAX + 5; i++) list = takenAdd(list, feature({ id: `feat${String(i).padStart(3, "0")}`, created: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  assert.equal(list.length, TAKEN_MAX);
  assert.equal(list[0].id, `feat0${TAKEN_MAX + 4}`);
  list = takenAdd(list, { ...list[3], about: "Better words." });
  assert.equal(list.length, TAKEN_MAX);
  assert.equal(list[3].about, "Better words.", "put in place, same spot");
  assert.equal(takenRemove(list, list[0].id).length, TAKEN_MAX - 1);
  const old = cleanTaken(feature({ about: "old", updated: "2026-10-24T10:00:00.000Z" })), fresh = cleanTaken(feature({ about: "new", updated: "2026-10-24T11:00:00.000Z" }));
  assert.equal(mergeTaken([old], [fresh])[0].about, "new");
  assert.equal(mergeTaken([fresh], [old])[0].about, "new");
  assert.equal(mergeTaken([old], [cleanTaken(feature({ id: "other01" }))]).length, 2);
});

test("a typed request finds the feature it names, and only then", () => {
  const list = [feature(), feature({ id: "jump0001", name: "Jump to identifier", from: { app: "Go Packages" } }), feature({ id: "dark0001", name: "Dark mode switch", from: { app: "Node.js" } })];
  const name = r => matchTaken(r, list)?.name || null;
  assert.equal(name("add VSCodium's command palette here"), "Command palette");
  assert.equal(name("add a command palette"), "Command palette");
  assert.equal(name("bring the palette here"), "Command palette", "a word like bring, and part of its name");
  assert.equal(name("add the dark mode switch from Node.js"), "Dark mode switch");
  assert.equal(name("add the jump to box from Go Packages"), "Jump to identifier", "part of its name and the app it came from");
  assert.equal(name("add dark mode"), null, "an ordinary request stays ordinary");
  assert.equal(name("add a command bar"), null);
  assert.equal(name("make the buttons bigger"), null);
  assert.equal(matchTaken("add a command palette", []), null);
});

test("a request for a well-known feature of another app is noticed, with the app and the feature", () => {
  assert.deepEqual(bringAsk("add VS Code's command palette here"), { app: "VS Code", what: "command palette" });
  assert.deepEqual(bringAsk("Bring Gmail's undo send here"), { app: "Gmail", what: "undo send" });
  assert.deepEqual(bringAsk("add a file finder like GitHub's"), { app: "GitHub", what: "file finder" });
  assert.deepEqual(bringAsk("add the command palette from VS Code"), { app: "VS Code", what: "command palette" });
  assert.deepEqual(bringAsk("Add Linear's keyboard shortcuts list to this page"), { app: "Linear", what: "keyboard shortcuts list" });
  assert.deepEqual(bringAsk("add a dark mode toggle like the one on nodejs.org"), { app: "nodejs.org", what: "dark mode toggle" });
  assert.equal(bringAsk("make the button blue"), null);
  assert.equal(bringAsk("add a sidebar"), null);
  assert.equal(bringAsk("add a word count from the editor"), null, "a lowercase word isn't an app");
});

test("Take: the model names it and says what it does, from the parts and the steps, never the picture", () => {
  const msgs = buildMessages({ request: "take: describe", context: { take: takenForModel(cleanTaken(feature())), lang: "de" } });
  assert.equal(msgs[0].content, DESCRIBE_SYSTEM);
  assert.match(msgs[1].content, /Taken from: VSCodium/);
  assert.match(msgs[1].content, /1\. Press Ctrl\+Shift\+P\n2\. Type “zoom” in “Search”/);
  assert.match(msgs[1].content, /quick-input-widget/);
  assert.match(msgs[1].content, /in German\.$/, "in the person's language");
  assert.doesNotMatch(JSON.stringify(msgs), /base64/);
  assert.equal(takenForModel(cleanTaken(feature())).thumb, undefined);
  assert.deepEqual(parseDescription("ANSWER: **Command palette**\n- Opens with Ctrl+Shift+P.\n- Type to filter."), { name: "Command palette", about: "Opens with Ctrl+Shift+P.\nType to filter." });
  assert.deepEqual(parseDescription("ANSWER: This is a long sentence that is clearly not a name for anything at all, it just goes on"), { name: "", about: "This is a long sentence that is clearly not a name for anything at all, it just goes on" });
  assert.deepEqual(parseDescription(""), { name: "", about: "" });
});

test("Bring: the request says what to build, how it opened, and to use this app's own design", () => {
  const ctx = { url: "https://pypi.org/project/requests/", title: "requests · PyPI", theme: { bg: "rgb(255, 255, 255)", fg: "rgb(70, 70, 70)", font: "Source Sans Pro" }, bring: takenForModel(cleanTaken(feature())) };
  const [, user] = buildMessages({ request: "Add “Command palette” from VSCodium here", context: ctx });
  const text = user.content;
  assert.match(text, /brought here: “Command palette”, taken from VSCodium/);
  assert.match(text, /What it does there \(written when it was taken\):\nOpens with Ctrl\+Shift\+P\./);
  assert.match(text, /1\. Press Ctrl\+Shift\+P/);
  assert.match(text, /this app's font family and sizes, its text, background, border and accent colors, its spacing, corner radius and shadows/);
  assert.match(text, /The styles it had there are only for its layout and proportions/);
  assert.match(text, /never with the other app's data/);
  assert.ok(text.indexOf("Theme: background rgb(255, 255, 255)") < text.indexOf("brought here"), "the page's look comes first");
  assert.ok(text.trim().endsWith("Request: Add “Command palette” from VSCodium here"));
  assert.doesNotMatch(text, /base64/);
  const known = bringPrompt({ known: true, app: "Linear", what: "keyboard shortcuts list" });
  assert.match(known, /“keyboard shortcuts list” from Linear\. Nothing was taken from it, so build it from what you know/);
  // A follow-up on the result is about the code, not about bringing it again.
  const [, again] = buildMessages({ request: "smaller", context: ctx, base: { prompt: "x", css: "a{}", js: "" } });
  assert.doesNotMatch(again.content, /brought here/);
  // It starts on the strong model: it has to look and work like part of the app.
  assert.equal(looksHard("Add “Command palette” from VSCodium here", { bring: {} }).hard, true);
  assert.ok(looksHard("put it here", { bring: {} }).why.includes("a feature from another app"));
});

test("a brought feature whose code finds none of this page's things gets another try (it would list nothing)", async () => {
  // Seen for real: a Jump to box in the Node.js docs looked for '#toc a[href^="#"]', but the links there are fs.html#…
  const js = `const list = morse.el("div", { class: "mj-list" });\nconst items = () => morse.$$('#toc a[href^="#"]');\nmorse.watch("#gtoc > ul", ul => ul.append(list));\nmorse.$$(".mj-list a");`;
  assert.match(bringMisses(js, ['#toc a[href^="#"]', "#gtoc > ul", ".mj-list a"], ['#toc a[href^="#"]', ".mj-list a"]), /match nothing here: `#toc a\[href\^="#"\]`.*page\.html#part/s);
  assert.equal(bringMisses(js, ["#gtoc > ul"], []), null);
  assert.equal(bringMisses('morse.$$("button, .nt")', ["button", ".nt"], [".nt"]), null, "a list of kinds with one that's here is fine");
  // In the engine: the first draft is undone and the model hears why.
  const { runMorse } = await import("../core/engine.js");
  const replies = [`TITLE: Jump\n\`\`\`css\n\`\`\`\n\`\`\`js\n${js}\n\`\`\`\n`, "TITLE: Jump\n```css\n```\n```js\nmorse.$$('#toc a');\n```\n"];
  const { registerProvider } = await import("../core/providers.js");
  const seen = [];
  registerProvider("bring-test", async (s, messages) => { seen.push(messages.at(-1).content); return replies[seen.length - 1]; });
  const ran = [];
  const res = await runMorse({
    settings: { provider: "bring-test" }, request: "Add “Jump to” here", context: { url: "x", title: "t", bring: { name: "Jump to" } },
    exec: async code => { ran.push(code); return { ok: true }; }, emit: () => {},
    probe: async sels => ({ fp: String(ran.length), unmatched: (sels || []).filter(s => /href|mj-list/.test(s)) }),
  });
  assert.equal(res.ok, true);
  assert.equal(seen.length, 2);
  assert.match(seen[1], /match nothing here/);
  assert.ok(ran.includes(""), "the first draft was turned off");
});

test("the mod remembers what it was brought from: “Taken from VSCodium”", () => {
  const mod = createMod({ prompt: "Add “Command palette” from VSCodium here", css: "", js: "1", url: "https://pypi.org/", from: { app: "VSCodium", url: null, title: null, taken: "palette01" } });
  assert.deepEqual(mod.from, { app: "VSCodium", url: null, title: null, taken: "palette01" });
  assert.match(modOrigin(mod), /^Taken from VSCodium/);
  assert.match(modOrigin(createMod({ prompt: "x", css: "", js: "", url: "https://a.b/", from: { app: "Tunes" } })), /^Rebuilt from/, "a captured look still says Rebuilt");
});

test("the demo model names a taken feature and brings back a working palette", () => {
  const take = demoResponse(buildMessages({ request: "take: describe", context: { take: takenForModel(cleanTaken(feature())) } }));
  const said = parseReply(take, { final: true });
  assert.equal(said.kind, "answer");
  assert.equal(parseDescription(said.text).name, "Command palette");
  const mod = parseModResponse(demoResponse(buildMessages({ request: "Add it here", context: { url: "x", title: "Inkwell", bring: takenForModel(cleanTaken(feature())) } })));
  assert.equal(mod.title, "Command palette from VSCodium");
  assert.match(mod.js, /"key":"p"/);
  assert.match(mod.js, /getComputedStyle\(document\.body\)/, "styled from the page it lands on");
});

// ---- the host side: one list, shared when Chrome is paired

function memory(list = []) {
  const box = { list };
  return { box, load: async () => box.list, save: async l => { box.list = l; } };
}
function farSide() {
  const store = memory();
  const host = createTakeHost({ load: store.load, save: store.save, shared: async () => true });
  let up = true;
  const call = async m => (up ? (await host.handle(m)).items : null);
  return { store, set up(v) { up = v; }, remote: { list: () => call({ type: "taken.list" }), put: item => call({ type: "taken.put", item }), remove: id => call({ type: "taken.remove", takenId: id }) } };
}

test("taken.*: put, list and remove, and whether the other side sees them", async () => {
  const mine = memory();
  const alone = createTakeHost({ load: mine.load, save: mine.save });
  let r = await alone.handle({ type: "taken.put", item: feature() });
  assert.equal(r.items.length, 1);
  assert.equal(r.shared, false, "not paired: only here");
  assert.ok(r.items[0].updated >= feature().created);
  r = await alone.handle({ type: "taken.put", item: { ...r.items[0], name: "Palette" } });
  assert.deepEqual(r.items.map(i => i.name), ["Palette"]);
  await assert.rejects(alone.handle({ type: "taken.put", item: { id: "../x" } }), /Not a taken feature/);
  r = await alone.handle({ type: "taken.remove", takenId: "palette01" });
  assert.deepEqual(r.items, []);
  await assert.rejects(alone.handle({ type: "taken.nope" }), /Unknown request/);
});

test("Chrome and the computer share one list: taken on either side shows on both; deleted on one, gone from both", async () => {
  const far = farSide(), chrome = memory();
  const ext = createTakeHost({ load: chrome.load, save: chrome.save, remote: far.remote });
  // Taken in Chrome while the helper was off: only in Chrome, and it says so.
  far.up = false;
  let r = await ext.handle({ type: "taken.put", item: feature({ id: "webfeat1", name: "Dark mode switch" }) });
  assert.equal(r.shared, false);
  assert.equal(chrome.box.list[0].synced, undefined);
  // Taken in VSCodium (straight into the computer's list).
  far.up = true;
  await far.remote.put(feature());
  // Chrome's next look: both, on both sides.
  r = await ext.handle({ type: "taken.list" });
  assert.equal(r.shared, true);
  assert.deepEqual(r.items.map(i => i.id).sort(), ["palette01", "webfeat1"]);
  assert.deepEqual(far.store.box.list.map(i => i.id).sort(), ["palette01", "webfeat1"], "what Chrome took went over");
  assert.ok(chrome.box.list.every(i => i.synced));
  // Deleted in the desktop app: gone from Chrome too, not brought back.
  await far.remote.remove("palette01");
  r = await ext.handle({ type: "taken.list" });
  assert.deepEqual(r.items.map(i => i.id), ["webfeat1"]);
  assert.deepEqual(far.store.box.list.map(i => i.id), ["webfeat1"]);
  // Deleted in Chrome: gone there too.
  r = await ext.handle({ type: "taken.remove", takenId: "webfeat1" });
  assert.deepEqual(r.items, []);
  assert.deepEqual(far.store.box.list, []);
  // The helper off: Chrome keeps its own list and says it's only here.
  await ext.handle({ type: "taken.put", item: feature({ id: "keep0001" }) });
  far.up = false;
  r = await ext.handle({ type: "taken.list" });
  assert.equal(r.shared, false);
  assert.deepEqual(r.items.map(i => i.id), ["keep0001"]);
});

// ---- the computer: ~/.morse/taken.json, served to Chrome by the Morse helper
const EXT = "chrome-extension://" + "b".repeat(32);
let tmp, bridge, port, startPairing;
before(async () => {
  tmp = tempDir("morse-take-");
  process.env.MORSE_HOME = path.join(tmp, "home");
  await fs.mkdir(process.env.MORSE_HOME, { recursive: true });
  await fs.writeFile(path.join(process.env.MORSE_HOME, "config.json"), JSON.stringify({ provider: "none" }));
  const b = await import("../daemon/bridge.js");
  startPairing = b.startPairing;
  bridge = b.createBridge({ port: 0 });
  port = await bridge.listen();
});
after(async () => { await bridge?.close(); await fs.rm(tmp, { recursive: true, force: true }); });

function req(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...(data && { "Content-Type": "application/json", "Content-Length": data.length }), ...headers } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", d => (text += d));
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json }); });
    });
    r.on("error", reject);
    r.end(data);
  });
}

test("the Morse helper shares the computer's list with a paired Chrome, and only with it", async () => {
  const { Take, TAKEN_FILE } = await import("../daemon/take.js");
  assert.equal((await req("GET", "/v1/taken", { headers: { Origin: EXT } })).status, 401, "not paired: nothing");
  const { code } = await startPairing();
  const token = (await req("POST", "/v1/pair", { body: { code }, headers: { Origin: EXT } })).json.token;
  const auth = { Origin: EXT, Authorization: `Bearer ${token}` };
  // Taken in a desktop app (the connector's taken.put), seen by Chrome.
  let r = await Take.handle({ type: "taken.put", item: feature() });
  assert.equal(r.shared, true, "a browser is paired: both see it");
  r = await req("GET", "/v1/taken", { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items.map(i => i.name), ["Command palette"]);
  // Taken in Chrome, seen by the desktop apps.
  r = await req("POST", "/v1/taken", { headers: auth, body: { item: feature({ id: "webfeat1", name: "Jump to identifier" }) } });
  assert.equal(r.status, 200);
  assert.deepEqual((await Take.handle({ type: "taken.list" })).items.map(i => i.id).sort(), ["palette01", "webfeat1"]);
  assert.equal((await req("POST", "/v1/taken", { headers: auth, body: { item: { id: "../bad" } } })).status, 400);
  assert.equal((await req("PUT", "/v1/taken", { headers: auth })).status, 405);
  r = await req("POST", "/v1/taken/remove", { headers: auth, body: { id: "palette01" } });
  assert.deepEqual(r.json.items.map(i => i.id), ["webfeat1"]);
  const file = await fs.stat(TAKEN_FILE);
  if (process.platform !== "win32") assert.equal(file.mode & 0o777, 0o600, "only you can read it");
  assert.deepEqual(JSON.parse(await fs.readFile(TAKEN_FILE, "utf8")).map(i => i.id), ["webfeat1"]);
});
