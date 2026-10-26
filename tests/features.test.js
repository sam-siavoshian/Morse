// A feature has to call the app: handlers and backend URLs from its source go
// into the prompt, a new control that only toggles a class is rolled back,
// and innerHTML on a live control never runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanHooks, wantsHooks, formatHooks, unwiredFeature, replacesHost, UNWIRED_ERROR } from "../core/hooks.js";
import { scanCode, profileSlice, needsLogic } from "../core/profile.js";
import { buildMessages } from "../core/prompt.js";
import { runMorse } from "../core/engine.js";
import { registerProvider } from "../core/providers.js";
import { KIT_SOURCE } from "../core/kit.js";

const SECRET = "super-secret-sentinel-9f3a";
const HOST = `
function saveNote(v) { return fetch("/api/notes", { method: "POST", body: JSON.stringify({ text: v }) }); }
function loadNotes() { return fetch("/api/notes"); }
document.querySelector("#save").addEventListener("click", saveNote);
export function notesApi() {}
const SECRET = "${SECRET}";
`;

const DEAD = `TITLE: Save note
\`\`\`css
.morse-save.on { color: green; }
\`\`\`
\`\`\`js
morse.watch("#note", el => {
  const btn = morse.el("button", { class: "morse-save", text: "Save", on: { click() { btn.classList.toggle("on"); } } });
  el.append(btn);
});
\`\`\`
`;
const WIRED = `TITLE: Save note
\`\`\`css
.morse-save { color: inherit; }
\`\`\`
\`\`\`js
morse.watch("#note", el => {
  const btn = morse.el("button", { class: "morse-save", text: "Save", on: { click() { saveNote(el.value); } } });
  el.append(btn);
});
\`\`\`
`;
const WIPE = `TITLE: Save note
\`\`\`js
morse.watch("#save", el => { el.innerHTML = "<button>Save</button>"; });
\`\`\`
`;

test("scanned source names the real handler and the backend URL, and the prompt does not get the rest of the file", () => {
  const found = scanHooks(HOST);
  assert.ok(found.handlers.some(h => h.event === "click" && h.fn === "saveNote"));
  assert.ok(found.functions.includes("saveNote"));
  assert.ok(found.functions.includes("loadNotes"));
  assert.ok(found.endpoints.some(e => e.method === "POST" && e.url === "/api/notes"));
  assert.ok(found.endpoints.some(e => e.method === "GET" && e.url === "/api/notes"));
  assert.ok(found.modules.includes("notesApi"));
  // A minified one-letter listener is not a hook, and DOM click stays out of app events.
  const ev = scanCode(`vault.on("modify", f); workspace.on("file-open", g); el.on("click", h);`);
  assert.deepEqual(ev.events, ["modify", "file-open"]);
  assert.deepEqual(ev.handlers, []);

  assert.equal(needsLogic("add a feature"), true);
  assert.equal(wantsHooks("change this"), true);
  assert.equal(needsLogic("make the status bar taller"), false);
  assert.equal(needsLogic("hide this ribbon"), false);
  assert.equal(profileSlice({ static: { commands: [["editor.action.formatDocument", "Format"]] }, runtime: { runner: { path: "x", method: "y", global: true }, commands: [["editor.action.formatDocument", "Format"]] } }, "make the status bar taller"), "");

  const slice = profileSlice({ static: scanCode(HOST), runtime: {} }, "add a feature to save the note");
  assert.match(slice, /saveNote/);
  assert.match(slice, /POST \/api\/notes/);
  assert.ok(slice.startsWith("How this app works inside"));
  assert.ok(slice.indexOf("saveNote") < slice.indexOf("Do it with the app") || slice.indexOf("saveNote") < slice.indexOf("Prefer the app"));

  const msgs = buildMessages({ request: "add a feature to save the note", context: { url: "https://notes.test/", title: "Notes", sources: HOST } });
  const user = msgs.at(-1).content;
  assert.match(user, /saveNote/);
  assert.match(user, /\/api\/notes/);
  assert.ok(user.indexOf("saveNote") < user.indexOf("Request:"));
  assert.ok(!user.includes(SECRET), "a sentinel in the script is not part of the prompt");
  assert.ok(!user.includes("JSON.stringify"), "raw source stays out; only the hook names go in");
  assert.match(formatHooks(found, "add a feature to save the note"), /call these from anything you add/);
});

test("a long profile keeps the hook names and the rules that say to use them", () => {
  const head = "How this app works inside (Morse read its code; use this for behavior):\n- Handlers in its code: click saveNote\n" + "x-padding: 1;\n".repeat(400);
  const tail = "\nDo it with the app's own commands and objects, not by clicking its buttons.";
  const user = buildMessages({ request: "add a feature", context: { url: "u", title: "t", appLogic: head + tail } }).at(-1).content;
  assert.match(user, /click saveNote/);
  assert.match(user, /Do it with the app's own commands/);
});

test("the new control calls the page's saveNote, after a class-toggle button is sent back", async () => {
  const prompts = [];
  registerProvider("wired", async (s, messages, { onToken }) => {
    prompts.push(messages.at(-1).content);
    const r = prompts.length === 1 ? DEAD : WIRED;
    onToken(r);
    return r;
  });
  const ran = [];
  const css = [];
  const res = await runMorse({
    settings: { provider: "wired" },
    request: "add a feature to save the note",
    context: { url: "https://notes.test/", title: "Notes", sources: HOST },
    emit: e => { if (e.type === "css") css.push(e.css); },
    exec: async js => { ran.push(js); return { ok: true }; },
  });
  assert.equal(res.ok, true);
  assert.match(prompts[1], /saveNote/);
  assert.match(res.js, /saveNote\(/);
  assert.equal(ran.at(-1), res.js);

  const calls = [];
  const saveNote = v => { calls.push(["saveNote", v]); return fetch("/api/notes", { method: "POST", body: v }); };
  const fetch = (url, opts) => { calls.push(["fetch", url, opts && opts.method]); return Promise.resolve({ ok: true }); };
  const buttons = [];
  const morse = {
    watch(_sel, fn) { fn({ value: "hello", append() {} }); },
    el(_tag, props) {
      const b = { click() { props.on.click(); } };
      buttons.push(b);
      return b;
    },
  };
  new Function("morse", "saveNote", "fetch", res.js)(morse, saveNote, fetch);
  assert.equal(buttons.length, 1);
  buttons[0].click();
  assert.deepEqual(calls[0], ["saveNote", "hello"]);
  assert.deepEqual(calls[1], ["fetch", "/api/notes", "POST"]);
});

test("a control that never calls the app is rolled back and the bar gets a short error", async () => {
  registerProvider("wired-dead", async (s, messages, { onToken }) => { onToken(DEAD); return DEAD; });
  const ran = [];
  const css = [];
  const res = await runMorse({
    settings: { provider: "wired-dead" },
    request: "add a feature to save the note",
    context: { url: "https://notes.test/", title: "Notes", sources: HOST },
    emit: e => { if (e.type === "css") css.push(e.css); },
    exec: async js => { ran.push(js); return { ok: true }; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.unwired, true);
  assert.equal(res.css, "");
  assert.equal(res.js, "");
  assert.equal(res.error, UNWIRED_ERROR);
  assert.ok(res.error.length < 120);
  assert.ok(ran.includes(""), "the applied mod is turned back off");
  assert.ok(ran.some(js => js.includes("classList")), "the dead control did run, then it was removed");
  assert.equal(css.at(-1), "");
  assert.ok(!String(res.js).includes("morse-save"));
});

test("innerHTML on a live control never runs; a morse.el fill still may", async () => {
  assert.equal(replacesHost('const out = morse.el("div"); out.innerHTML = "<span>1</span>";'), "");
  assert.match(replacesHost('morse.watch("#save", el => { el.innerHTML = "<button>Save</button>"; })'), /listeners/);
  assert.match(KIT_SOURCE, /function keepHostControls/);
  const prompts = [];
  registerProvider("wired-wipe", async (s, messages, { onToken }) => {
    prompts.push(messages.at(-1).content);
    const r = prompts.length === 1 ? WIPE : WIRED;
    onToken(r);
    return r;
  });
  const ran = [];
  const res = await runMorse({
    settings: { provider: "wired-wipe" },
    request: "add a feature to save the note",
    context: { url: "https://notes.test/", title: "Notes", sources: HOST },
    emit: () => {},
    exec: async js => { ran.push(js); return { ok: true }; },
  });
  assert.equal(res.ok, true);
  assert.ok(ran.every(js => !js.includes("innerHTML")));
  assert.match(prompts[1], /listeners/);
  assert.match(prompts[1], /beside/);
  assert.match(res.js, /saveNote\(/);
});

test("with no hook for the action, a class-toggle button is not kept", () => {
  const dead = { css: ".x.on{}", js: 'morse.el("button", { on: { click() { btn.classList.toggle("on"); } } });' };
  const wire = unwiredFeature(dead, { url: "https://x/" }, "add a feature");
  assert.equal(wire.user, UNWIRED_ERROR);
  assert.match(wire.model, /no function/);
  const alive = { css: "", js: 'morse.el("button", { on: { click() { pp.click(); } } }); morse.every(1000, () => {});' };
  assert.equal(unwiredFeature(alive, { url: "https://x/" }, "add a sleep timer"), null);
});
