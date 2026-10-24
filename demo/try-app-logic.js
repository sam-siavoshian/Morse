// Changes to what an app does (app profiles, docs/dev/rea.md), on real apps,
// with and without the profile: each request goes through
// demo/try-real-app.js (real shortcut, pointing, typing), then the change is
// used the way a person would (a click on what it added, real keys) and
// checked in the app. The numbers in docs/dev/rea.md#measurements come from this.
//
//   DISPLAY=:99 node demo/try-app-logic.js <name,name|all> <profile|noprofile|both> [model] [--out dir]
//
// Needs VSCodium (`codium`), Obsidian and Joplin installed where `morse apps`
// finds them, Claude Code signed in, xdotool and ImageMagick's import.
// Each run gets its own Morse folder, app profile folder and files, under a
// short folder in the system temp folder (VS Code puts a socket in its
// profile folder, 107 characters at most), removed afterwards. Pictures,
// logs and results.jsonl go to --out (default: <temp>/morse-app-logic).
// With "profile", the app's saved profile is reused across runs, as Morse does.
import { spawn, execFileSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTunes, findElectron } from "./electron-app/build.mjs";

const R = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argv = process.argv.slice(2);
const outAt = argv.indexOf("--out");
const OUT = path.resolve(outAt >= 0 ? argv.splice(outAt, 2)[1] : path.join(os.tmpdir(), "morse-app-logic"));
const RUNS = OUT;
const WORK = path.join(os.tmpdir(), "mal");
const DISPLAY = process.env.DISPLAY || ":99";
const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const VIEW = `document.querySelector('.editor-instance .monaco-editor .view-lines')`;
// The editor's lines in the order they show (Monaco reuses line nodes, so DOM order isn't line order).
const vtext = `[...(${VIEW}?.querySelectorAll(".view-line") || [])].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map(l => l.textContent).join("\\n").replace(/\\u00a0/g, " ")`;
const TOASTS = `window.__toasts = []; new MutationObserver(rs => { for (const r of rs) for (const n of r.addedNodes) if (n.nodeType === 1) window.__toasts.push(n.textContent || ""); }).observe(document.body, { childList: true, subtree: true });`;

const codium = file => ({ app: "codium", window: "workbench\\.html", focus: ".statusbar", setup: `!!${VIEW} && /${path.basename(file).replace(".", "\\.")}/.test(document.title)`, settle: "4000",
  args: ["--no-sandbox", "--user-data-dir=WS/ud", "--disable-workspace-trust", "--skip-welcome", "WS/proj", `WS/proj/${file}`] });
const EXPS = {
  "vscode-format": {
    ...codium("data.json"), files: { "data.json": `{"name":"demo","b":[1,2,3],"c":{"d":true}}\n` },
    point: ".statusbar", ask: "add a button here that formats the document",
    click: "yes", wait: "5000",
    check: `${vtext}.includes('"name": "demo"')`,
  },
  "vscode-autosave": {
    ...codium("notes.txt"), files: { "notes.txt": "one two three\n" },
    ask: "save the file automatically a second after I stop typing, then show a toast with the word count",
    act: TOASTS, "focus-act": ".editor-instance .monaco-editor .view-lines", press: "ctrl+End", type: " four five", wait: "5000",
    check: `!document.querySelector('.tab.dirty') && ${vtext}.includes("four five") && __toasts.some(t => /\\b5\\b/.test(t) && /word/i.test(t))`,
    fileCheck: ["notes.txt", "four five"],
  },
  "vscode-remap": {
    ...codium("list.txt"), files: { "list.txt": "alpha\nbeta\ngamma\n" },
    ask: "make Ctrl+Shift+K duplicate the current line instead of deleting it",
    "focus-act": ".editor-instance .monaco-editor .view-lines", press: "ctrl+Home ctrl+shift+k", wait: "2500",
    check: `${vtext}.split("\\n").slice(0, 3).join("|") === "alpha|alpha|beta"`,
  },
  "vscode-sort": {
    ...codium("list.txt"), files: { "list.txt": "gamma\nalpha\nbeta" },
    point: ".statusbar", ask: "add a button here that sorts the lines of the file alphabetically",
    click: "yes", wait: "2500",
    check: `${vtext}.split("\\n").slice(0, 3).join("|") === "alpha|beta|gamma"`,
  },
  "vscode-upper": {
    ...codium("words.txt"), files: { "words.txt": "hello world\n" },
    point: ".statusbar", ask: "add a button here that makes the selected text upper case",
    "focus-act": ".editor-instance .monaco-editor .view-lines", press: "ctrl+a", click: "yes", wait: "2500",
    check: `${vtext}.includes("HELLO WORLD")`,
  },
  "vscode-comment": {
    ...codium("app.js"), files: { "app.js": "let a = 1;\nlet b = 2;\n" },
    point: ".statusbar", ask: "add a button here that comments out the line the cursor is on",
    "focus-act": ".editor-instance .monaco-editor .view-lines", press: "ctrl+Home", click: "yes", wait: "2500",
    check: `/^\\s*\\/\\/\\s*let a = 1;/.test(${vtext}.split("\\n")[0]) && ${vtext}.split("\\n")[1].trim() === "let b = 2;"`,
  },
  "joplin-duplicate": {
    app: "joplin", window: "app\\.asar/index\\.html$", joplin: true,
    setup: `!!document.querySelector("button")`, settle: "6000",
    ask: "add a button that makes a copy of the note I'm looking at",
    act: `window.__n = (document.body.innerText.match(/Welcome to Joplin!/g) || []).length;`, click: "yes", wait: "4000",
    check: `(document.body.innerText.match(/Welcome to Joplin!/g) || []).length > window.__n`,
  },
  "obsidian-daily": {
    app: "obsidian", window: "obsidian\\.md/index\\.html", vault: true,
    setup: `(app.workspace.getActiveFile()?.basename === "Welcome" || (app.workspace.openLinkText("Welcome", "", false), false)) && !!document.querySelector(".cm-content")`,
    ask: `add a button that creates a new note named with today's date (like ${ymd}) and opens it`,
    click: "yes", wait: "2500",
    check: `!!app.vault.getAbstractFileByPath("${ymd}.md") && app.workspace.getActiveFile()?.basename === "${ymd}"`,
  },
  "obsidian-date": {
    app: "obsidian", window: "obsidian\\.md/index\\.html", vault: true,
    setup: `(app.workspace.getActiveFile()?.basename === "Welcome" || (app.workspace.openLinkText("Welcome", "", false), false)) && !!document.querySelector(".cm-content")`,
    ask: "add a button that inserts today's date into the note where my cursor is",
    act: `app.workspace.activeEditor.editor.setCursor({ line: 2, ch: 0 }); app.workspace.activeEditor.editor.focus();`, click: "yes", wait: "2000",
    check: `(() => { const v = app.workspace.activeEditor?.editor?.getValue() || ""; return /${ymd}|2026|Oct(ober)? 24|24\\/10|10\\/24/.test(v); })()`,
  },
  "obsidian-open-copy": {
    app: "obsidian", window: "obsidian\\.md/index\\.html", vault: true,
    setup: `(app.workspace.getActiveFile()?.basename === "Welcome" || (app.workspace.openLinkText("Welcome", "", false), false)) && !!document.querySelector(".cm-content")`,
    ask: "whenever I open a note, copy its name to the clipboard",
    act: `require("electron").clipboard.writeText("nothing yet"); app.workspace.openLinkText("Morse code", "", false);`, wait: "2500",
    check: `require("electron").clipboard.readText().includes("Morse code")`,
  },
  "joplin-clipboard": {
    app: "joplin", window: "app\\.asar/index\\.html$", joplin: true,
    setup: `document.querySelectorAll(".note-list-item, [class*=note-list] [role=option], .list-item-container").length > 0 || !!document.querySelector("button")`, settle: "6000",
    ask: "add a keyboard shortcut Ctrl+Alt+N that creates a new note from what is in the clipboard",
    act: `require("electron").clipboard.writeText("Groceries from the clipboard: eggs, rice");`, "focus-act": "h1, .note-list, body", press: "ctrl+alt+n", wait: "4000",
    check: `(() => { const t = document.body.innerText + [...document.querySelectorAll("iframe")].map(f => { try { return f.contentDocument.body.innerText; } catch { return ""; } }).join(" "); return t.includes("Groceries from the clipboard"); })()`,
  },
  "tunes-shuffle": {
    app: path.join(WORK, "Tunes", "tunes"), window: "app://tunes/index\\.html", point: '[aria-label="Shuffle"]',
    ask: "make shuffle actually random",
    act: `(async () => { const o = []; for (let i = 0; i < 5; i++) { document.querySelector('[aria-label="Shuffle"]').click(); await new Promise(r => setTimeout(r, 400)); o.push(tunesApp.player.queue.map(s => s[0]).join("|")); } window.__orders = o; return o; })()`, wait: "800",
    check: `new Set(window.__orders).size >= 2 && window.__orders.some(o => o !== o.split("|").sort((a, b) => a.localeCompare(b)).join("|"))`,
  },
};

async function prepare(name, e, dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const args = [];
  if (e.app === "codium") {
    await fs.mkdir(path.join(dir, "proj"), { recursive: true });
    for (const [f, c] of Object.entries(e.files)) await fs.writeFile(path.join(dir, "proj", f), c);
    await fs.mkdir(path.join(dir, "ud", "User"), { recursive: true });
    await fs.writeFile(path.join(dir, "ud", "User", "settings.json"), JSON.stringify({ "workbench.startupEditor": "none", "security.workspace.trust.enabled": false, "update.mode": "none", "workbench.tips.enabled": false, "window.restoreWindows": "none" }));
    return e.args.map(a => a.replace("WS", dir));
  }
  if (e.vault) {
    // A small vault: two notes, and the core plugins Obsidian turns on by default.
    await fs.mkdir(path.join(dir, "vault", ".obsidian"), { recursive: true });
    await fs.writeFile(path.join(dir, "vault", "Welcome.md"), "# Welcome\n\nThis is my vault. Notes about [[Morse code]] and a shopping list.\n\n- [ ] milk\n- [ ] bread\n");
    await fs.writeFile(path.join(dir, "vault", "Morse code.md"), "# Morse code\n\nA method of encoding text as sequences of dots and dashes.\n");
    await fs.writeFile(path.join(dir, "vault", ".obsidian", "core-plugins.json"), JSON.stringify({ "file-explorer": true, "global-search": true, switcher: true, "daily-notes": true, templates: true, "command-palette": true, "editor-status": true, "word-count": true }));
    await fs.mkdir(path.join(dir, "ud"), { recursive: true });
    await fs.writeFile(path.join(dir, "ud", "obsidian.json"), JSON.stringify({ vaults: { a1b2c3d4e5f60719: { path: path.join(dir, "vault"), ts: 1761300000000, open: true } } }));
    return ["--no-sandbox", `--user-data-dir=${dir}/ud`];
  }
  if (e.joplin) return ["--no-sandbox", "--profile", `${dir}/joplin-profile`, `--user-data-dir=${dir}/ud`];
  return ["--no-sandbox", `--user-data-dir=${dir}/ud`];
}

function run(name, cond, model) {
  return new Promise(async resolve => {
    const e = EXPS[name];
    const dir = path.join(WORK, `${name}-${cond}`);
    const args = await prepare(name, e, dir);
    const home = path.join(dir, "home");
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true } })); // no first-run cards in the pictures
    // The profile is built once per app version; later runs use the saved one (as Morse does).
    const seed = path.join(RUNS, "profiles");
    if (cond === "profile" && existsSync(seed)) await fs.cp(seed, path.join(home, "profiles"), { recursive: true });
    const shots = path.join(RUNS, "shots", `${name}-${cond}`);
    const opts = ["--app", e.app, "--window", e.window, "--ask", e.ask, "--check", e.check, "--shots", shots, "--first", "1", "--name", name, "--relaunch", "no", "--timeout", "300000"];
    for (const k of ["point", "focus", "setup", "settle", "act", "click", "press", "type", "wait", "focus-act"]) if (e[k]) opts.push(`--${k}`, e[k]);
    if (cond === "profile") opts.push("--profile", "yes");
    const env = { ...process.env, DISPLAY, MORSE_HOME: home, MORSE_PROVIDER: "claude-code", MORSE_TRACE: "1", FORCE_COLOR: "0", ...(model ? { MORSE_MODEL: model } : {}), ...(cond === "noprofile" ? { MORSE_PROFILE: "off" } : {}) };
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(R, "demo", "try-real-app.js"), ...opts, "--", ...args], { env });
    let out = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { out += d; });
    const kill = setTimeout(() => p.kill("SIGKILL"), 600000);
    p.on("exit", async () => {
      clearTimeout(kill);
      await fs.writeFile(path.join(RUNS, "logs", `${name}-${cond}.log`), out).catch(() => {});
      let res = {};
      try { res = JSON.parse(out.trim().split("\n").filter(l => l.startsWith("{")).pop()); } catch { res = { error: "no result: " + out.slice(-300) }; }
      if (e.fileCheck) { try { res.fileSaved = (await fs.readFile(path.join(dir, "proj", e.fileCheck[0]), "utf8")).includes(e.fileCheck[1]); res.ok = !!res.ok && res.fileSaved; } catch {} }
      if (cond === "profile" && existsSync(path.join(home, "profiles"))) await fs.cp(path.join(home, "profiles"), seed, { recursive: true }).catch(() => {});
      const line = { name, cond, model: model || "auto", wall: Date.now() - t0, ...res };
      await fs.appendFile(path.join(RUNS, "results.jsonl"), JSON.stringify(line) + "\n");
      // stop anything of this run still running
      try { execFileSync("pkill", ["-9", "-f", dir]); } catch {}
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); // disk is tight
      resolve(line);
    });
  });
}

await fs.mkdir(path.join(RUNS, "logs"), { recursive: true });
const names = argv[0] === "all" ? Object.keys(EXPS) : String(argv[0] || "").split(",").filter(n => EXPS[n]);
const conds = argv[1] === "both" || !argv[1] ? ["profile", "noprofile"] : [argv[1]];
if (!names.length) { console.log(`names: ${Object.keys(EXPS).join(", ")}`); process.exit(1); }
if (names.includes("tunes-shuffle") && !existsSync(path.join(WORK, "Tunes", "tunes"))) await buildTunes(path.join(WORK, "Tunes"), { dist: findElectron() });
for (const n of names) for (const c of conds) {
  const r = await run(n, c, argv[2]);
  console.log(JSON.stringify({ name: r.name, cond: r.cond, ok: r.ok, applied: r.applied, prompted: r.prompted, ms: r.ms, error: r.error, title: r.title, clicked: r.clicked }));
}
