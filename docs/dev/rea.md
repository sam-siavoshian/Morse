# App profiles (and what Morse took from REA)

Most changes people ask for are about how an app looks, and the page's
structure, styles and layout (`runtime/src/20-context.js`) are all the model
needs. Some are about what the app *does*: "add a button that formats the
document", "when I open a note, copy its name", "make Ctrl+Shift+K duplicate
the line instead". From the page alone the model can only guess: it clicks
buttons, fakes key presses (which apps ignore: keys sent from code don't
reach their shortcuts), or rebuilds the behavior from scratch.

An **app profile** is what Morse reads, once per app version, about how a
desktop app works inside, so the model can use the app's own logic:

| Part | Where it comes from | Example (VSCodium) |
|---|---|---|
| Commands, with names | the app's code, and the running app's own command list | `editor.action.formatDocument` (Format Document), 2,300 more |
| A way to run them | the running window: an object with `executeCommand`, `executeCommandById` or `execute` that the app's globals or listeners reach | VS Code's command service; Obsidian's `app.commands` |
| IPC channels | `ipcRenderer.send/invoke/on`, `ipcMain.on/handle`, `webContents.send` in the code | `vscode:runAction`, `tunes:queue` |
| contextBridge APIs | `exposeInMainWorld("name", {...})` in the preloads | `window.tunes {info, queue, like…}` |
| Its own objects | window keys a clean page doesn't have, and what can be called on them | `window.app.vault.{create, modify…}` (Obsidian) |
| Routes and windows | router paths, named routes, hash routes, `loadURL`/`loadFile` | `app://tunes/index.html` |
| Store actions, events, keys | `dispatch({type})`, `x.on("file-open")`, menu `accelerator`s | `NOTE_SELECT` (Joplin), `file-open` (Obsidian) |
| What buttons do | the event listeners on the main buttons, and React `onClick` props | Joplin's New notebook: `()=>{...instance().execute("newFolder")}` |

For a request about behavior, the prompt gets the slice of the profile that
fits it (about 10 to 25 lines), and mods call the app's commands with
`morse.app.command(id, ...args)`.

## REA, and why Morse doesn't depend on it

[REA](https://github.com/morluto/rea) (MIT, by morluto) is a read-only
reverse-engineering toolkit for coding agents. Its JavaScript and Electron
side is the closest thing to what profiles need: `@electron/asar` to read
archives, Babel ASTs for IPC channels (`electronStaticAnalysisIpc.ts`),
contextBridge exposures (`javascriptContextBridgeExposure.ts`), routes
(`javascriptRouteScan.ts`) and bundler registrations, an application graph
that links them with evidence for every edge, and `inspect_web_event_listeners`
(`CdpEventListeners.ts`), which reads `DOMDebugger.getEventListeners` without
running a handler.

Three ways to use it were weighed:

- **Depend on `rea-agents`.** About 2,900 TypeScript files and 40 runtime
  dependencies (Babel, Playwright, the MCP SDK, isomorphic-git, openpgp…),
  Node 22.23+, a worker process for analysis, and output built for an agent
  reading evidence, not for a prompt. Morse has one dependency today. It also
  analyzes far more than a profile needs, carefully: it is built for evidence,
  not for a pass that has to finish in seconds in the background.
- **Vendor the parts.** The parts that matter sit on top of REA's AST
  pipeline, so vendoring them means vendoring Babel and the graph builder.
- **Reimplement the minimal pieces** (what `daemon/fuses.js` already did for
  `inspect_electron_fuses`). Chosen. Morse needs names, not proofs: which
  channels, which commands, what to call. Bounded regular expressions over
  the bundle text find them in seconds, with no dependency, and handle
  minified code (renamed `ipcRenderer` and `contextBridge`, hoisted id and
  label constants, esbuild's kept class names).

No REA code is copied. The approach (and the list of things worth finding)
is REA's. Credit to its authors, under its MIT license.

What Morse does that REA doesn't: it looks for a **command runner** in the
running window and hands mods a way to call it. That is a write path into the
running app (calling the app's own commands, as its menus do), so it is
Morse's own, and it stays inside what Morse already does in the page.

## The two passes

`AppProfiler` (in `daemon/profile.js`, one per `Connector`) starts when the
first visible app window is attached, after the page stops growing (apps keep
starting up after their window shows). Nothing waits for it: the bar works
throughout, and a request about behavior waits at most 12 seconds for a
profile that is still being made.

**Static, in a worker thread.** `resourcesDir()` finds the app's
`resources` folder from the running app's own executable (the process with
Morse's debugging port: an AppImage runs from a folder it unpacked or
mounted) or from where it is installed (`.app/Contents/Resources` on a Mac).
`codeRoots()` takes `app.asar` and the app's other archives (Obsidian keeps
its code in `obsidian.asar`), not Electron's `default_app.asar`, or
`resources/app/`. `Asar` reads the header and only the files it needs, with
plain read-only file handles (files marked unpacked come from
`<name>.asar.unpacked/`). `pickFiles()` chooses what to scan:

1. the main process: `package.json` `main`;
2. the scripts the running window loaded (`document.scripts` and the
   performance entries), matched to files by the end of their path;
3. otherwise the scripts the app's own HTML pages load;
4. the biggest of the app's own scripts when those are only a small loader
   (VS Code's `workbench.js` loads its 20 MB bundle itself);
5. the preloads the main process names, and files called `preload*.js`.

At most 32 MB a file and 96 MB in all. `core/profile.js` `scanCode()` reads
each one; `mergeScans()` joins them.

**Runtime, over CDP, in the page's own world.** `runtimeProfile()`:

- **Globals**: window keys a fresh isolated world of the same page doesn't
  have, with what can be called on them and on their child objects. Only
  property descriptors are read, never getters.
- **The command runner**: a breadth-first walk of the app's objects,
  in the page, that yields to the page every 25 ms (through a
  `MessageChannel`, since a window in the background has its timers slowed to
  once a second). It starts from `window`. When that finds nothing, it starts
  again from what the listeners on `window`, `document` and `body` can see:
  their closure scopes, read with `Runtime.getProperties` on `[[Scopes]]`
  (this is how VS Code's command service is reached: it has no globals). A
  runner is an object reached by a name with "command" in it that has
  `executeCommand`, `executeCommandById`, `execute` or `runCommand`, or a
  class named like one with a singleton (`CommandService.instance_`, Joplin).
  Lists come from `listCommands()`, `getCommands()` or `commandNames()` on it
  or on a registry nearby.
- **Listeners**: `DOMDebugger.getEventListeners` on the main buttons (and,
  for a request, on what the person pointed at and three parts around it),
  plus React `onClick` props, with the first 300 characters of each handler.
  No handler runs.

Reading a closure scope holds up the page for as long as it takes, and the
outermost scope of a big bundle has thousands of names (20,000 in VS Code,
about 1.5 s on an idle machine). So the inner scopes are read first, the
outermost only when they lead nowhere, and each scope at most once.

Where the runner was found becomes a **recipe**: the path from `window`, or
from a variable a listener on `window` sees (listener type, variable name,
inner or outer scope) and the keys after it. `installHandle()` follows it in
a new document (a reload, a second window with the same address) and puts a
frozen `{ run, list, via }` on `window[Symbol.for("morse.app")]`. A symbol,
not a name: the app's own window gets no new names (the tests check). The
connector installs it after attaching and again before running mod code that
mentions `morse.app` (`AppProfiler.ready`), and `morse stop` takes it away.

## In the prompt

`needsLogic(request)` decides whether a request is about behavior (when,
shortcut, run, insert, save, copy, random…). Only those get the slice;
"make the status bar taller" gets nothing, so prompts for looks stay as they
were. `profileSlice()` ranks the commands by the request's words (each word
counts less the more commands share it, and a command with two of the
request's words beats one with one), and lists at most 18, then the app's own
objects, the bridge and its channels, the app's events, store actions, menu
keys for key requests, and what the pointed-at part's handlers do. Then a few
rules: use the app's commands, not fake key presses. Wrap calls in try/catch;
react with `morse.on` on the app's events or keys. Never replace the app's
functions. And, for keys the app already uses, listen in the capture phase.

`AppProfiler.vet()` is the engine's `vet` hook (`core/engine.js`): a draft
that calls `morse.app.command` with an id the app doesn't have gets a repair
round with the close ones, before it runs.

## The kit

- `morse.app.command(id, ...args)`: runs the app's command and resolves to
  what it returns. A missing runner, an error, or an app answering `false`
  (Obsidian, for a command it doesn't have) is recorded as the mod's error, so
  the repair round and the Mods panel see it.
- `morse.app.commands()`: the running app's list, when the runner can list.
- `morse.on(target, event, fn)` also takes an app's own event emitter
  (`app.vault.on("modify", …)`, an EventEmitter) and lets go when the mod is
  turned off: `dispose()`, `offref()`, `off()` or `removeListener()`.
- Selectors like `#workbench.parts.statusbar` (an id and two classes) find
  VS Code's `id="workbench.parts.statusbar"` when the page has that id and no
  `workbench`. Models write ids with dots that way; `20-context.js` now gives
  such ids as `[id="…"]`, which survives being put in a JS string.

## Cache

`~/.morse/profiles/<app id>-<stamp>.json`, where the stamp is a hash of the
code roots' paths, sizes and times: an app update gets a fresh profile and
the old one is deleted when the new one is saved. `PROFILE_VERSION` in
`core/profile.js` discards profiles from an older Morse. `morse profile
<app>` prints the static part for any installed app (and the saved runtime
part, if there is one), `--json` all of it.

## Read only

- The app's files are opened read-only and only read (tests hash every file
  of the sample app, unpacked and as `app.asar`, before and after. And of the
  real packaged Tunes before `morse launch` and after it quits).
- No native instrumentation, no hooking, no injection into native processes:
  static reads of the app's JavaScript, and CDP in its pages.
- The runtime pass reads property descriptors, never getters, and calls no
  app function except command lists (`getCommands()` and the like) and
  zero-argument label functions. It changes nothing on the page. The handle
  is a symbol property.
- `MORSE_PROFILE=off` turns profiles off entirely (no pass, no slice, no
  handle): the baseline below.

## Measurements

Static pass, in the worker, on a heavily loaded 4-core machine (load average
15 to 70 during these runs):

| App | Files scanned | Static | Runtime | Runner | Commands |
|---|---|---|---|---|---|
| Tunes (`demo/electron-app`) | 3 (main, preload, renderer) | 0.1 s | 0.3 to 0.5 s | `window.tunesApp.commands.execute` | 6 |
| VSCodium 1.14x | 8 (main, preloads, two 20 MB bundles) | 2.5 to 13 s | 3 to 4 s | the command service, through a `keydown` listener | 2,368 from the code |
| Obsidian 1.14.5 | 2 (`main.js`, 4 MB `app.js`) | 0.7 s | 0.6 s | `window.app.commands.executeCommandById` | 152 from the app |
| Joplin 3.7.21 | 4 (13 MB main, 20 MB renderer, preloads) | 5.6 s | 2 to 6 s | `CommandService.execute`, through the bundle's scope | 151 from the app |

The longest the page was held up while the runtime pass ran (a probe
evaluating `1` every 50 ms): about 130 ms in Obsidian, 400 ms to 1 s in
Joplin, and 1.2 s in VSCodium (reading closure scopes).

### Changes to what the app does, with and without a profile

Real apps installed here (VSCodium from its `.deb`, Obsidian and Joplin as
AppImages), opened with `morse launch` and driven with real X input by
`demo/try-real-app.js`: the real shortcut, pointing, typing the request,
then **using** the change (`--click` on what it added, `--press` real keys,
`--act` to open a note or fill the clipboard) and checking the result in the
app. Claude Code with haiku (pinned), each request once with the profile and
once with `MORSE_PROFILE=off`. Each request, how it was used and how it
was checked are in [`demo/try-app-logic.js`](../../demo/try-app-logic.js)
(`DISPLAY=:99 node demo/try-app-logic.js all both haiku` runs them all and
keeps every run's pictures and log).

| Request | App | Profile | Without | With the profile it… | Without it… |
|---|---|---|---|---|---|
| "add a button here that formats the document" (pointing at the status bar) | VSCodium | ✓ | ✗ | ran `editor.action.formatDocument` | sent a fake Shift+Alt+F, which VS Code ignores |
| "add a button here that sorts the lines of the file alphabetically" | VSCodium | ✓ | ✗ | ran `editor.action.sortLinesAscending` | sent a fake Ctrl+Shift+P and told the person what to type |
| "make Ctrl+Shift+K duplicate the current line instead of deleting it" | VSCodium | ✓ | ✗ | took the key in the capture phase and ran `editor.action.duplicateSelection` | sent a fake Shift+Alt+Down; VS Code deleted the line |
| "add a button here that makes the selected text upper case" | VSCodium | ✓ | ✗ | ran `editor.action.transformToUppercase` | sent a fake F1 and told the person what to type |
| "add a button here that comments out the line the cursor is on" | VSCodium | ✓ | ✗ | ran `editor.action.commentLine` | sent a fake Ctrl+/ |
| "save the file automatically a second after I stop typing, then show a toast with the word count" | VSCodium | ✗ | ✗ | ran `workbench.action.files.save`, but on `input` events VS Code's editor doesn't send | the same, with a fake Ctrl+S |
| "add a button that makes a copy of the note I'm looking at" | Joplin | ✓ | ✗ | ran `duplicateNote` | made an empty note with the same title |
| "add a keyboard shortcut Ctrl+Alt+N that creates a new note from what is in the clipboard" | Joplin | ✓ | ✓ | ran `newNote`, then typed the text in | clicked New note, then pasted |
| "add a button that inserts today's date into the note where my cursor is" | Obsidian | ✓ | ✓ | ran `insert-current-date` | typed the date with `execCommand` |
| "whenever I open a note, copy its name to the clipboard" | Obsidian | ✓ | ✓ | listened to `app.workspace`'s `file-open` | watched the title for changes |
| "add a button that creates a new note named with today's date and opens it" | Obsidian | ✓ | ✓ | `app.fileManager.createNewMarkdownFile` | `app.vault.create` (the model knows Obsidian's API) |
| "make shuffle actually random" (pointing at Shuffle) | Tunes (`demo/electron-app`) | ✓ | ✗ | shuffled the queue from `tunes.queue()` into `tunesApp.player.setQueue` | clicked a random album |

**With a profile: 11 of 12 (10 of 11 on the real apps). Without: 4 of 12
(4 of 11).** Six of the changes on real apps (five in VSCodium, one in
Joplin) and the Tunes one could not be made from the page alone: they need
the app's own commands, which the page doesn't show. Obsidian's four worked
either way, because models already know Obsidian's `app` object. The profile
made them use its commands and events instead of typing into the page.

These are the last runs of each, on the code as committed. Getting there
took earlier runs that failed, and each failure fixed something:

- VS Code's ids have dots (`workbench.parts.statusbar`), and the model wrote
  `#workbench.parts.statusbar`, which matches nothing (the kit now reads it
  as the id, and the page outline gives such ids as `[id="…"]`).
- The first ranking put `focusSecondEditorGroup` above `files.save` for
  "save … a second after". Commands now score on how many of the request's
  words they have, and how rare those words are.
- A key the app already uses has to be caught in the capture phase. The
  slice now says so for key requests.
- Joplin runs each plugin in a hidden window, and the first profile was of
  one of those. The profiler now waits for the windows and takes the
  biggest.
- Requests like "a button here that makes … upper case" weren't recognized
  as being about behavior.
- And the driver's own checks (Monaco's line nodes aren't in line order;
  Tunes' shuffle runs after an `await`).

About a third of all runs ended early for reasons outside Morse: the machine
was shared with other agents (load average 15 to 73), apps didn't open
within the driver's time limits, and VSCodium refused a profile folder whose
path was too long for its socket.

Microsoft's VS Code (`/usr/share/code`) was installed too: `morse profile
code` reads its 22 MB bundles the same way as VSCodium's; the tries above
used VSCodium.

## What doesn't work yet

- Apps whose commands no global or window listener leads to (a React app
  that keeps everything in module scope and listens on its root) get the
  static part only: commands are listed, but as things to do through the
  app's buttons and keys.
- VS Code's runtime command list (with extension commands) lives in the
  bundle's outermost scope. Reading it would hold the window up for seconds,
  so the list comes from the code (2,368 built-in commands, no extension
  ones).
- The page-change check (`noEffect` in `core/engine.js`) can't tell whether a
  behavior change works until someone uses it. The tries above used it the
  way a person would (`demo/try-real-app.js --click/--press/--act`).
- Websites don't get profiles: a site has no app to read.
