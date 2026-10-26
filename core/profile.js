// App profiles: what Morse learns about how a desktop app works inside (its
// commands, the channels to its main process, its own objects in the page),
// so the model can change what the app *does*, not only how it looks.
//
// Pure: no files, no network. daemon/profile.js reads the app's code (read
// only) and asks the running app over CDP; this file finds things in code
// text (scanCode), and picks the slice of a profile one request needs
// (profileSlice), which core/prompt.js adds to the prompt.
//
// The patterns are a small, fast reimplementation of the parts of REA's
// JavaScript/Electron static analysis Morse needs (IPC channels, contextBridge
// exposures, command and route registrations). REA parses with Babel and
// keeps evidence for every finding; Morse only needs names, quickly, so it
// scans text with bounded regular expressions. docs/dev/rea.md explains the choice.

import { scanHooks, hookFits } from "./hooks.js";

export const PROFILE_VERSION = 1;

// ---- limits: a profile stays small on disk and in a prompt
const MAX = { commands: 6000, ipc: 300, bridge: 40, keys: 40, actions: 400, routes: 120, events: 120, exports: 200, classes: 400 };

// A namespaced id: editor.action.formatDocument, editor:toggle-bold, player/next.
const NS_ID = /^[A-Za-z][\w$-]*(?:[.:/][\w$-]+)+$/;
// A command name without a namespace: newNote, toggleSideBar (camelCase, no spaces).
const CAMEL_ID = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/;
const isCommandId = s => typeof s === "string" && s.length >= 3 && s.length <= 90 && (NS_ID.test(s) || CAMEL_ID.test(s)) && !/^[a-z][\w+.-]*:\/\//.test(s) && !/^data:/.test(s) && !/\.(js|css|html|json|png|svg|md)$/i.test(s);

// DOM and Node events: not the app's own.
const DOM_EVENTS = new Set(("abort,afterprint,animationend,animationstart,auxclick,beforeinput,beforeprint,beforeunload,blur,canplay,change,click,close,compositionend,compositionstart,"
  + "compositionupdate,contextmenu,copy,cut,dblclick,drag,dragend,dragenter,dragleave,dragover,dragstart,drop,ended,error,focus,focusin,focusout,fullscreenchange,hashchange,"
  + "input,invalid,keydown,keypress,keyup,load,loadeddata,loadedmetadata,message,mousedown,mouseenter,mouseleave,mousemove,mouseout,mouseover,mouseup,offline,online,"
  + "paste,pause,play,playing,pointercancel,pointerdown,pointerenter,pointerleave,pointermove,pointerout,pointerover,pointerup,popstate,progress,readystatechange,reset,"
  + "resize,scroll,select,selectionchange,storage,submit,timeupdate,toggle,touchcancel,touchend,touchmove,touchstart,transitionend,unload,visibilitychange,volumechange,"
  + "wheel,data,end,exit,close,finish,open,ready,line,connect,disconnect,response,request,update,updated,closed,show,hide,timeout,drain,pipe,unpipe,readable,"
  + "uncaughtException,unhandledRejection,will-quit,before-quit,window-all-closed,activate,did-finish-load,dom-ready,did-navigate,new-window,ready-to-show,"
  + "will-navigate,crashed,render-process-gone,closed,maximize,unmaximize,minimize,restore,move,moved,enter-full-screen,leave-full-screen,blur,focus,second-instance").split(","));

// Words around an object literal that make it a command: something that runs.
const RUNS = /\b(run|handler|callback|execute|exec|checkCallback|editorCallback|editorCheckCallback|precondition|keybinding|kbOpts|hotkeys|accelerator|f1|menu|when)\s*[:(]/;
const COMMANDISH = /(registerCommand|addCommand|Action2|EditorAction|registerDeclaration|registerAction|declaration\s*=|commands?\s*[.:=]|Command\b|\.register\()/;

// What a label looks like in minified code: "Format Document", O(1210,"Format
// Document"), ()=>_("New note"), i18n.commands.toggleBold() (named from the key).
const LABEL = /\b(?:label|title|name|description)\s*:\s*(?:(["'`])([^"'`\n]{2,80})\1|[\w$.]{1,40}\(\s*(?:\d+\s*,\s*)?(["'`])([^"'`\n]{2,80})\3|(?:[\w$]{1,3}\(\s*)?\(\)\s*=>\s*(?:\(\s*0\s*,\s*[\w$.]{1,30}\s*\)|[\w$.]{1,30})\s*\(\s*(["'`])([^"'`\n]{2,80})\5|([\w$]+(?:\.[\w$]+){1,4})\(\))/;

// "toggleSourceMode" or "editor:toggle-source" → "toggle source mode".
export function humanize(s) {
  return String(s).replace(/^.*[.:/]/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim().toLowerCase();
}

function labelIn(text) {
  const m = LABEL.exec(text);
  if (!m) return "";
  if (m[2] || m[4] || m[6]) return (m[2] || m[4] || m[6]).trim();
  return m[7] ? humanize(m[7].split(".").pop()) : "";
}

// The end of the object literal starting at `from` (an index just after "{"),
// strings and nested braces skipped. Bounded: never more than `max` characters.
function objectEnd(text, from, max = 1500) {
  let depth = 1, q = null;
  const end = Math.min(text.length, from + max);
  for (let i = from; i < end; i++) {
    const c = text[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return end;
}

// Top-level keys of the object literal at text[from] === "{".
function objectKeys(text, from, max = 4000) {
  const end = objectEnd(text, from + 1, max);
  const body = text.slice(from + 1, end);
  const keys = [];
  let depth = 0, q = null, start = 0;
  const take = part => {
    const m = /^\s*(?:async\s+)?(?:get\s+|set\s+)?\*?\s*["']?([A-Za-z_$][\w$]*)["']?\s*(?=[:(,]|$)/.exec(part);
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if ("{[(".includes(c)) depth++;
    else if ("}])".includes(c)) depth--;
    else if (c === "," && depth === 0) { take(body.slice(start, i)); start = i + 1; }
  }
  take(body.slice(start));
  return keys.slice(0, 40);
}

const add = (map, key, value, max) => { if (map.size < max && !map.has(key)) map.set(key, value); else if (value && !map.get(key)) map.set(key, value); };

// Everything scanCode finds in one file of an app's code. `role` is where it
// runs: "main" (the main process), "preload", "renderer" or "" (unknown).
export function scanCode(text, { file = "", role = "" } = {}) {
  text = String(text || "");
  const out = { file, role, size: text.length, bundler: bundlerOf(text), ipc: [], bridge: [], commands: [], keys: [], actions: [], routes: [], events: [], exports: [], classes: [], windows: [], preloads: [] };

  // IPC: ipcRenderer.send/invoke/on("channel"), ipcMain.on/handle("channel"),
  // webContents.send("channel"). Minified code keeps these property names.
  // Minified code renames them ({ ipcRenderer: r } = require("electron")): follow the aliases.
  const alias = { ipcRenderer: "ipcRenderer", ipcMain: "ipcMain", webContents: "webContents" };
  for (const m of text.matchAll(/\b(ipcRenderer|ipcMain)\s*:\s*([\w$]{1,12})\b(?!\s*\()/g)) if (!alias[m[2]] && m[2] !== "true" && m[2] !== "false") alias[m[2]] = m[1];
  for (const m of text.matchAll(/\b([\w$]{1,12})\s*=\s*(?:[\w$]+\.)?(?:require\(\s*["']electron["']\s*\)\.)?(ipcRenderer|ipcMain)\b\s*[,;)]/g)) if (!alias[m[1]]) alias[m[1]] = m[2];
  const names = Object.keys(alias).map(n => n.replace(/\$/g, "\\$")).join("|");
  const ipc = new Map();
  for (const m of text.matchAll(new RegExp(`(?:^|[^\\w$.])(${names})\\s*\\.\\s*(send|sendSync|invoke|on|once|handle|handleOnce|postMessage|sendToHost|addListener)\\s*\\(\\s*(["'\`])([^"'\`\\n]{1,80})\\3`, "g"))) {
    const who = alias[m[1]];
    const side = who === "ipcMain" ? "main" : who === "webContents" ? "to-renderer" : "renderer";
    add(ipc, `${side}\0${m[2]}\0${m[4]}`, { side, op: m[2], channel: m[4] }, MAX.ipc);
  }
  for (const m of text.matchAll(/\.webContents\s*\.\s*send\s*\(\s*(["'`])([^"'`\n]{1,80})\1/g)) add(ipc, `to-renderer\0send\0${m[2]}`, { side: "to-renderer", op: "send", channel: m[2] }, MAX.ipc);
  out.ipc = [...ipc.values()];

  // contextBridge.exposeInMainWorld("name", { a, b() {}, c: … }): window.name in the page.
  for (const m of text.matchAll(/\.\s*exposeInMainWorld\s*\(\s*(["'`])([\w$]+)\1\s*,\s*/g)) {
    if (out.bridge.length >= MAX.bridge) break;
    const at = m.index + m[0].length;
    out.bridge.push({ name: m[2], keys: text[at] === "{" ? objectKeys(text, at) : [] });
  }

  // Commands, three ways: an object literal with an id and something that
  // runs ({ id: "x", title: …, run() }), a call that names one
  // (registerCommand("x"), executeCommand("x")), and registry calls
  // (commands.register("x", "Label", fn)).
  const cmds = new Map();
  for (const m of text.matchAll(/\b(id|command|commandId|name)\s*:\s*(["'`])([A-Za-z][\w$.:/-]{2,89})\2/g)) {
    const id = m[3];
    if (!isCommandId(id) || (m[1] === "name" && !CAMEL_ID.test(id) && !NS_ID.test(id))) continue;
    const open = text.lastIndexOf("{", m.index);
    if (open < 0 || m.index - open > 400) continue;
    const end = objectEnd(text, open + 1, 1200);
    const body = text.slice(open, end + 1);
    const before = text.slice(Math.max(0, open - 160), open);
    if (!RUNS.test(body) && !COMMANDISH.test(before)) continue;
    if (m[1] === "name" && !/\blabel\s*:/.test(body) && !COMMANDISH.test(before)) continue; // "name" alone is too common
    const rest = body.replace(m[0], "");
    add(cmds, id, labelIn(rest), MAX.commands);
  }
  for (const m of text.matchAll(/\b(registerCommand|addCommand|executeCommand|executeCommandById|runCommand|registerCommandAlias)\s*\(\s*(["'`])([A-Za-z][\w$.:/-]{2,89})\2/g))
    if (isCommandId(m[3])) add(cmds, m[3], "", MAX.commands);
  // Minifiers hoist ids and labels into constants (VS Code:
  // rTe="workbench.action.files.save",Idi=O(17647,"Save") … {id:rTe,title:Idi,…}):
  // follow names that hold a namespaced id or a label into command objects.
  const ids = new Map(), labels = new Map();
  for (const m of text.matchAll(/[,;{(\s]([\w$]{1,8})\s*=\s*(["'`])([A-Za-z][\w$-]*(?:\.[\w$-]+){2,8})\2(?=\s*[,;)])/g)) if (ids.size < 50000 && isCommandId(m[3])) ids.set(m[1], m[3]);
  for (const m of text.matchAll(/[,;{(\s]([\w$]{1,8})\s*=\s*[\w$.]{1,30}\(\s*\d+\s*,\s*(["'`])([^"'`\n]{2,80})\2\s*\)/g)) if (labels.size < 50000) labels.set(m[1], m[3]);
  if (ids.size) {
    for (const m of text.matchAll(/\b(?:id|command)\s*:\s*([\w$]{1,8})\s*[,}]/g)) {
      const id = ids.get(m[1]);
      if (!id || cmds.has(id)) continue;
      const open = text.lastIndexOf("{", m.index);
      if (open < 0 || m.index - open > 400) continue;
      const body = text.slice(open, objectEnd(text, open + 1, 1200) + 1);
      if (!RUNS.test(body) && !COMMANDISH.test(text.slice(Math.max(0, open - 160), open)) && !/\btitle\s*:/.test(body)) continue;
      const t = /\b(?:title|label)\s*:\s*([\w$]{1,8})\s*[,}]/.exec(body);
      add(cmds, id, (t && labels.get(t[1])) || labelIn(body.replace(m[0], "")), MAX.commands);
    }
    for (const m of text.matchAll(/\b(?:registerCommand|executeCommand|registerCommandAlias)\s*\(\s*([\w$]{1,8})\s*[,)]/g)) { const id = ids.get(m[1]); if (id) add(cmds, id, "", MAX.commands); }
  }
  for (const m of text.matchAll(/\.(?:execute|register)\s*\(\s*(["'`])([A-Za-z][\w$.:/-]{2,89})\1\s*([,)])\s*(?:(["'`])([^"'`\n]{2,80})\4)?/g))
    if (isCommandId(m[2]) && (m[5] || NS_ID.test(m[2]) || CAMEL_ID.test(m[2]))) add(cmds, m[2], m[5] || "", MAX.commands);
  out.commands = [...cmds].map(([id, label]) => label ? [id, label] : [id]);

  // Menu accelerators: accelerator: "CmdOrCtrl+Shift+M", with the label near it.
  for (const m of text.matchAll(/\baccelerator\s*:\s*(["'`])([^"'`\n]{1,40})\1/g)) {
    if (out.keys.length >= MAX.keys) break;
    const open = text.lastIndexOf("{", m.index);
    const body = open >= 0 && m.index - open < 300 ? text.slice(open, objectEnd(text, open + 1, 600) + 1) : "";
    out.keys.push([m[2], labelIn(body.replace(m[0], ""))]);
  }

  // Store actions: dispatch({ type: "NOTE_SELECT" }) and reducers' case "X".
  const actions = new Set();
  for (const m of text.matchAll(/\btype\s*:\s*(["'`])([A-Z][A-Z0-9_]{2,60}(?:\/[A-Z0-9_]+)?)\1/g)) { if (actions.size >= MAX.actions) break; actions.add(m[2]); }
  for (const m of text.matchAll(/\bdispatch\s*\(\s*\{\s*type\s*:\s*(["'`])([\w/:.-]{3,60})\1/g)) { if (actions.size >= MAX.actions) break; actions.add(m[2]); }
  out.actions = [...actions];

  // Routes and views: router paths, named routes, hash routes, and what the
  // main process loads into its windows.
  const routes = new Set();
  if (/\b(Route|Router|routes|router|navigate|history\.push)\b/.test(text)) {
    for (const m of text.matchAll(/\bpath\s*:\s*(["'`])(\/[\w\-/:.*]{0,60})\1/g)) { if (routes.size >= MAX.routes) break; routes.add(m[2]); }
  }
  for (const m of text.matchAll(/\b(?:routeName|route)\s*:\s*(["'`])([A-Za-z][\w/-]{1,40})\1/g)) { if (routes.size >= MAX.routes) break; routes.add(m[2]); }
  for (const m of text.matchAll(/["'`](#\/[\w\-/]{1,40})["'`]/g)) { if (routes.size >= MAX.routes) break; routes.add(m[1]); }
  out.routes = [...routes];
  for (const m of text.matchAll(/\b(loadURL|loadFile)\s*\(\s*(["'`])([^"'`\n]{1,160})\2/g)) if (out.windows.length < 20) out.windows.push(m[3]);
  for (const m of text.matchAll(/\bpreload\s*:\s*[^}]{0,120}?(["'`])([^"'`\n]{0,120}?\.(?:c|m)?js)\1/g)) if (out.preloads.length < 10) out.preloads.push(m[2]);

  // The app's own events: something.on("file-open"), emit("layout-change").
  const events = new Map();
  for (const m of text.matchAll(/\.(?:on|once|emit|trigger)\s*\(\s*(["'`])([a-z][\w:-]{2,40})\1/g)) {
    const e = m[2];
    if (DOM_EVENTS.has(e) || /^(on|data|vscode):?$/.test(e)) continue;
    events.set(e, (events.get(e) || 0) + 1);
  }
  out.events = [...events].sort((a, b) => b[1] - a[1]).slice(0, MAX.events).map(([e]) => e);

  // Exported names (ES modules, CommonJS, webpack's export getters) and class
  // names esbuild keeps (keepNames: o(this, "CommandService")).
  const ex = new Set();
  for (const m of text.matchAll(/\bexport\s*\{([^}]{1,4000})\}/g)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n && n.length > 2 && ex.size < MAX.exports) ex.add(n); }
  for (const m of text.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]{2,})/g)) if (ex.size < MAX.exports) ex.add(m[1]);
  for (const m of text.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]{2,})\s*=/g)) if (ex.size < MAX.exports) ex.add(m[1]);
  for (const m of text.matchAll(/\.d\(\s*[\w$]+\s*,\s*\{((?:\s*[\w$]+\s*:\s*(?:\(\)\s*=>|function\s*\(\)\s*\{\s*return)\s*[\w$.]+\s*\}?\s*,?){1,60})\}/g))
    for (const k of m[1].matchAll(/([\w$]+)\s*:/g)) if (k[1].length > 2 && ex.size < MAX.exports) ex.add(k[1]);
  out.exports = [...ex];
  const classes = new Set();
  for (const m of text.matchAll(/\(\s*this\s*,\s*"([A-Z][\w$]{3,60})"\s*\)/g)) { if (classes.size >= MAX.classes) break; classes.add(m[1]); }
  for (const m of text.matchAll(/\bclass\s+([A-Z][\w$]{3,60})\b/g)) { if (classes.size >= MAX.classes) break; classes.add(m[1]); }
  out.classes = [...classes];
  // Click/submit handlers, the functions that call the backend, and those URLs.
  // DOM event names stay out of `events` (those are the app's own events).
  const hooks = scanHooks(text);
  out.handlers = hooks.handlers;
  out.endpoints = hooks.endpoints;
  out.functions = hooks.functions;
  out.modules = hooks.modules;
  return out;
}

export function bundlerOf(text) {
  const head = text.length > 400000 ? text.slice(0, 200000) + text.slice(-200000) : text;
  if (/__webpack_require__|webpackChunk|__webpack_modules__/.test(head)) return "webpack";
  if (/\b__toESM\b|\b__commonJS\b|\b__esm\b/.test(head)) return "esbuild";
  if (/__vitePreload|import\.meta\.url/.test(head)) return "vite";
  if (/\bparcelRequire\b/.test(head)) return "parcel";
  if (/\bdefine\s*\(\s*\[/.test(head)) return "amd";
  if (/^\s*(import|export)\b/m.test(head)) return "esm";
  return "plain";
}

// Many files' findings in one profile part ({ files, ipc, bridge, commands, … }).
export function mergeScans(scans) {
  const p = { files: [], ipc: [], bridge: [], commands: [], keys: [], actions: [], routes: [], events: [], classes: [], windows: [], handlers: [], endpoints: [], functions: [], modules: [] };
  const cmd = new Map(), seen = new Map();
  const uniq = (key, list, max) => { const s = seen.get(key) || seen.set(key, new Set(p[key].map(x => JSON.stringify(x)))).get(key); for (const x of list) { const k = JSON.stringify(x); if (s.size >= max) break; if (!s.has(k)) { s.add(k); p[key].push(x); } } };
  for (const s of scans) {
    p.files.push({ file: s.file, role: s.role, size: s.size, bundler: s.bundler, exports: s.exports.slice(0, 40) });
    uniq("ipc", s.ipc, MAX.ipc);
    uniq("bridge", s.bridge, MAX.bridge);
    for (const [id, label] of s.commands) if (!cmd.has(id) || (label && !cmd.get(id))) { if (cmd.size < MAX.commands || cmd.has(id)) cmd.set(id, label || ""); }
    uniq("keys", s.keys, MAX.keys);
    uniq("actions", s.actions, MAX.actions);
    uniq("routes", s.routes, MAX.routes);
    uniq("events", s.events, MAX.events);
    uniq("classes", s.classes, MAX.classes);
    uniq("windows", s.windows, 20);
    uniq("handlers", s.handlers || [], 80);
    uniq("endpoints", s.endpoints || [], 80);
    uniq("functions", s.functions || [], 60);
    uniq("modules", s.modules || [], 80);
  }
  p.commands = [...cmd].map(([id, label]) => label ? [id, label] : [id]);
  return p;
}

// ---------------------------------------------------------------- the prompt
// Requests about what the app does, not how it looks: they get the profile.
const LOGIC = /\b(when(ever)?|every ?time|after|before|once|on (save|open|close|start)|shortcuts?|keyboard|hot ?keys?|key ?(combo|binding)s?|press(es|ing)?|ctrl|cmd|alt\+|run(s|ning)?|commands?|actually|really|random(ly|ize)?|shuffl\w*|automatic(ally)?|auto[- ]?\w*|insert\w*|creat\w*|new (note|file|tab|window|todo|task)s?|cop(y|ies|ying)|clipboard|past(e|ing)|format\w*|toggl\w*|undo|redo|word count|counts?|remap\w*|instead|behaviou?rs?|trigger\w*|sort\w*|sav(e|es|ed|ing)|open(s|ed|ing)?|clos(e|es|ed|ing)|delet\w*|export\w*|sync\w*|play\w*|skip\w*|next|previous|repeat\w*|search\w*|replac\w*|duplicat\w*|today'?s|dates?|timestamps?|buttons?\b[^.]{0,30}\b(that|to|which|for)|upper ?case|lower ?case|capitali[sz]\w*|comment\w*|indent\w*|convert\w*|select(ed|ion)?|calls?|api|functions?|actions?|does|do|features?|change this|add (?:a |an |another )?(?:new )?(?:button|card|section|control|widget)\b)\b/i;
export const needsLogic = request => LOGIC.test(String(request || ""));

const STOP = new Set("the a an and or to of in on for with that this here there it its me my i you your make makes made add when then after also all any be is are was do does show put use using into from at by as so if not no can just like want please button key keys shortcut press app".split(" "));
// A few everyday words and what apps call them.
const ALSO = { today: ["date", "time", "timestamp"], date: ["date", "time", "timestamp", "today"], time: ["time", "date"], random: ["shuffle", "random"], shuffle: ["shuffle", "random"],
  copy: ["copy", "clipboard"], clipboard: ["clipboard", "copy", "paste"], save: ["save", "write", "modify"], delete: ["delete", "remove", "trash"], remove: ["remove", "delete"],
  new: ["new", "create", "add"], create: ["create", "new", "add"], note: ["note"], file: ["file"], format: ["format"], words: ["word", "count"], word: ["word", "count"],
  next: ["next", "skip"], skip: ["skip", "next"], back: ["previous", "back"], previous: ["previous", "back", "prev"], search: ["search", "find"], find: ["find", "search"],
  bold: ["bold", "strong"], italic: ["italic", "emphasis"], sidebar: ["sidebar", "side", "bar"], terminal: ["terminal"], play: ["play", "pause"], pause: ["pause", "play"],
  zoom: ["zoom"], theme: ["theme", "dark", "light"], dark: ["dark", "theme"], tab: ["tab", "editor"], close: ["close"], open: ["open"], insert: ["insert", "add"] };
// "files" and "file", "formats" and "format", "saving" and "save" count as one word.
const stem = w => w.length < 4 ? w : w.replace(/(?<=..[a-z])(ings?|ed)$/, "").replace(/(?<=..[a-z])(ies)$/, "y").replace(/(?<=..[a-z])s$/, "").replace(/(?<=...)e$/, "");
export function requestWords(request) {
  const words = String(request || "").toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [];
  const out = new Map(); // word -> weight
  for (const w of words) {
    if (STOP.has(w)) continue;
    out.set(stem(w), Math.max(out.get(stem(w)) || 0, 3));
    for (const a of ALSO[w] || ALSO[stem(w)] || []) if (!out.has(stem(a))) out.set(stem(a), 1);
  }
  // Two words people write apart that names write as one: "upper case", "word wrap", "side bar".
  for (let i = 0; i + 1 < words.length; i++) if (!STOP.has(words[i]) && !STOP.has(words[i + 1])) out.set(stem(words[i] + words[i + 1]), 5);
  return out;
}
const wordsOf = s => String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z][a-z0-9]*/g) || [];
// How well a name (an id and its label) fits the request's words.
// `rare` (optional): word -> how much it counts, so a word many names share
// ("word" in cursorWordLeft…) counts less than one few have ("save").
export function fit(words, ...names) {
  const rare = names[0] instanceof Map ? names.shift() : null;
  const have = new Set(names.flatMap(wordsOf).map(stem));
  let score = 0, matched = 0;
  for (const [w, weight] of words) {
    const k = weight * (rare ? 0.5 + 0.5 * (rare.get(w) ?? 1) : 1);
    if (have.has(w)) { score += k; if (weight > 1) matched++; }
    else if (w.length > 4 && [...have].some(h => h.length > 3 && (h.startsWith(w) || w.startsWith(h)))) score += k / 2;
  }
  // A name that has two or more of the request's own words fits better than one that has one.
  return score + (matched > 1 ? 1.5 * (matched - 1) : 0);
}
// How much each request word counts among `list` (each an array of names):
// 1 for a word few have, less the more have it.
function rarity(words, list) {
  const df = new Map([...words.keys()].map(w => [w, 0]));
  for (const names of list) { const have = new Set(names.flatMap(wordsOf).map(stem)); for (const w of df.keys()) if (have.has(w)) df.set(w, df.get(w) + 1); }
  return new Map([...df].map(([w, n]) => [w, 1 / (1 + Math.log2(1 + n / 4))]));
}
const best = (list, score, n) => list.map(x => [x, score(x)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([x]) => x);

// Click handlers, functions, backend URLs and modules, ranked by the request.
// Shown first so a prompt that clips the slice still keeps them. When nothing
// scores (a bare "add a feature"), the first few still go in.
function hookLines(st, request) {
  const rank = (list, label, n) => {
    const scored = list.map(x => ({ x, s: hookFits(request, label(x)) }));
    const hit = scored.filter(i => i.s > 0).sort((a, b) => b.s - a.s);
    return (hit.length ? hit : scored).slice(0, n).map(i => i.x);
  };
  const out = [];
  const handlers = rank(st.handlers || [], h => `${h.event} ${h.fn}`, 8);
  if (handlers.length) out.push(`- Handlers in its code: ${handlers.map(h => `${h.event} ${h.fn}`).join(", ")}`);
  const fns = rank(st.functions || [], f => f, 8);
  if (fns.length) out.push(`- Functions that call its backend or those handlers: ${fns.join(", ")}`);
  const ends = rank(st.endpoints || [], e => `${e.method} ${e.url}`, 8);
  if (ends.length) out.push(`- Backend calls in its code: ${ends.map(e => `${e.method} ${e.url}`).join(", ")}`);
  const mods = rank(st.modules || [], m => m, 8);
  if (mods.length) out.push(`- Modules it exports: ${mods.join(", ")}`);
  return out;
}

// The part of a profile that helps with this request, as prompt text, or "".
// `target`: what the person pointed at does ({ listeners: [...] } from the
// running app, daemon/profile.js targetLogic). Small on purpose: at most ~25
// lines, the names most related to the request first.
export function profileSlice(profile, request, { target = null, force = false } = {}) {
  if (!profile || (!force && !needsLogic(request))) return "";
  const words = requestWords(request);
  const rt = profile.runtime || {};
  const st = profile.static || {};
  const lines = hookLines(st, request);
  // The running app's list when there is one (it has the commands plugins
  // added), with names from the code where the app gave none.
  const named = new Map((st.commands || []).filter(c => c[1]).map(c => [c[0], c[1]]));
  const commands = (rt.commands?.length ? rt.commands : st.commands || []).map(([id, label]) => [id, label || named.get(id) || ""]);
  const runner = rt.runner;
  if (runner && commands.length) {
    const rare = rarity(words, commands);
    const picks = best(commands, ([id, label]) => fit(words, rare, id, label), 18);
    const how = runner.global ? `the same as ${runner.path}.${runner.method}(id)` : "Morse found the app's own command runner";
    lines.push(`- Run the app's own commands with \`await morse.app.command(id, ...args)\` (${commands.length} commands; ${how}). A command does what the app's menu item or shortcut does. Use only ids listed here${picks.length ? "; the ones that fit this request:" : "."}`);
    for (const [id, label] of picks) lines.push(`    ${id}${label && label !== id && humanize(id) !== label.toLowerCase() ? ` (${label})` : ""}`);
    if (!picks.length) lines.push(`    for example: ${commands.slice(0, 8).map(c => c[0]).join(", ")}`);
  } else if (commands.length) {
    const rare = rarity(words, commands);
    const picks = best(commands, ([id, label]) => fit(words, rare, id, label), 10);
    if (picks.length) lines.push(`- The app's commands (Morse found no way to run them directly; use its buttons, menus or shortcuts for these): ${picks.map(([id, l]) => l ? `${id} (${l})` : id).join(", ")}`);
  }
  // The app's own objects in the page: window.<name> and what can be called on it.
  // The app's own object always counts; a library (moment, PIXI) only when the request names what it does.
  const bridges = new Map((st.bridge || []).map(b => [b.name, b]));
  const globals = (rt.globals || []).filter(g => !bridges.has(g.name)).map(g => [g, fit(words, g.name, ...(g.methods || []), ...Object.keys(g.children || {}), ...Object.values(g.children || {}).flat())]);
  const shownG = [...globals.filter(([g]) => g.app), ...globals.filter(([g, s]) => !g.app && s >= 3).sort((a, b) => b[1] - a[1]).slice(0, 2)].slice(0, 3).map(([g]) => g);
  for (const g of shownG) {
    const kids = Object.entries(g.children || {}).map(([k, ms]) => [k, ms, fit(words, k, ...ms)]).sort((a, b) => b[2] - a[2]).slice(0, g.app ? 7 : 2)
      .map(([k, ms]) => `${g.name}.${k}.{${best(ms, m => fit(words, m) + 0.01, 8).join(", ")}}`);
    const own = best(g.methods || [], m => fit(words, m) + 0.01, g.app ? 8 : 5);
    lines.push(`- \`window.${g.name}\` is ${g.app ? "the app's own object" : "a library the app loads"}: ${[own.length ? `${g.name}.{${own.join(", ")}}` : "", ...kids].filter(Boolean).join("; ")}`.slice(0, 900));
  }
  // The preload's API (contextBridge) and the IPC channels behind it.
  for (const b of [...bridges.values()].slice(0, 3)) {
    const g = (rt.globals || []).find(x => x.name === b.name); // what the running window has on it
    const what = b.keys.length ? b.keys.join(", ") : g ? [...(g.methods || []), ...Object.entries(g.children || {}).map(([k, ms]) => `${k}.{${ms.slice(0, 6).join(", ")}}`)].join(", ") : "";
    lines.push(`- \`window.${b.name}\` (the app's bridge to its main process): ${what || "(see its methods)"}`.slice(0, 600));
  }
  const ipc = best(st.ipc || [], c => fit(words, c.channel) + (c.side === "renderer" ? 0.5 : 0), 6);
  if (ipc.length && (st.bridge || []).length) lines.push(`- Main-process channels behind it: ${ipc.map(c => `${c.channel} (${c.op})`).join(", ")}`);
  const keys = best(st.keys || [], ([k, l]) => fit(words, l, k) + 0.01, 6);
  if (keys.length && /\b(shortcut|key|press|ctrl|cmd|alt|remap)/i.test(request)) lines.push(`- Shortcuts the app already uses: ${keys.map(([k, l]) => `${k}${l ? ` ${l}` : ""}`).join(", ")}`);
  const events = best([...(rt.events || []), ...(st.events || [])].filter((e, i, a) => a.indexOf(e) === i), e => fit(words, e), 6);
  if (events.length) lines.push(`- Events the app's code listens to (its own event names): ${events.join(", ")}`);
  const actions = best(st.actions || [], a => fit(words, a), 6);
  if (actions.length) lines.push(`- Store actions in its code: ${actions.join(", ")}`);
  if (target?.listeners?.length) {
    lines.push("- What the part the user pointed at does now (its event handlers, from the running app):");
    for (const l of target.listeners.slice(0, 4)) lines.push(`    ${l.where} on ${l.type}: ${String(l.source || "").replace(/\s+/g, " ").slice(0, 220)}`);
  }
  if (!lines.length) return "";
  const rules = [
    runner ? "Do it with the app's own commands and objects, not by clicking its buttons or faking key presses (keys sent from code don't reach the app's shortcuts). Wrap calls in try/catch and morse.toast a short message if one fails."
      : "Prefer the app's own objects over clicking its buttons or faking key presses (keys sent from code don't reach the app's shortcuts).",
    "To react to the app (a save, a note opening), listen with morse.on on its events, or on keys. Never replace or wrap the app's own functions.",
    "A new control calls a listed function, module, hook, or backend route. It must not only toggle a class, and it must not cover or replace a control that already works.",
  ];
  // Taking over a key the app already uses: the app's own handler runs first unless the mod's runs in the capture phase.
  if (/\b(shortcut|key|press|ctrl|cmd|alt|remap|instead)\b/i.test(request)) rules.push("A key the app already uses: listen with morse.on(window, \"keydown\", fn, true) (capture, so yours runs first), check the exact keys, then e.preventDefault() and e.stopImmediatePropagation() before running the command.");
  return `How this app works inside (Morse read its code; use this for behavior):\n${lines.join("\n")}\n${rules.join("\n")}`;
}
