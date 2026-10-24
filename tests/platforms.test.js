// macOS and Windows, checked from any machine (docs/desktop.md "macOS" and
// "Windows"; docs/dev/platform-testing.md has the 15-minute check on real
// hardware, which these tests don't replace):
//   - the file formats Morse reads, on bytes: binary Info.plists, app.asar,
//     Mach-O universal fuse wires, Windows .lnk shortcuts (including files
//     made by independent writers: Python's plistlib and pylnk3)
//   - finding apps: .app bundles, Squirrel app-<version>\ folders, the Start menu
//   - starting them: the binary inside the bundle, Update.exe --processStart,
//     argument lists (never shell strings), quoting, the environment
//   - quitting them for --restart: AppleScript then SIGTERM, taskkill /T then /T /F
//   - Morse never changes an app's files (code signatures stay intact)
//   - `morse apps` on each platform (snapshots), `morse doctor`'s platform
//     rows, colors, line endings, byte order marks
//
// Snapshots: UPDATE_SNAPSHOTS=1 node --test tests/platforms.test.js rewrites them.
import { home, tempDir } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { promises as fs, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";

const apps = await import("../daemon/apps.js");
const { inspectFuses, fuseVerdict, formatFuses, electronBinaryFor, binaryFormat } = await import("../daemon/fuses.js");
const { colorOn, painter } = await import("../daemon/colors.js");
const { platformChecks, formatChecks, systemName, commandFor } = await import("../daemon/platform.js");
const store = await import("../daemon/store.js");
const { defaultHotkeys, formatCombo } = await import("../core/hotkeys.js");
const { buildMac, buildWindows, buildLinux, binaryPlist, asarBuffer, lnkBuffer, fuseWire } = await import("../demo/fake-installs.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const byId = list => Object.fromEntries(list.map(a => [a.id, a]));
async function fixture(build) {
  const dir = tempDir("morse-plat-");
  return apps.hostContext(await build(dir));
}

// Made by Python's plistlib (FMT_BINARY), not by Morse's own writer.
const PLISTLIB_SLACK = "YnBsaXN0MDDaAQIDBAUGBwgJCgsLDA0OFBUYGRpfEBNDRkJ1bmRsZURpc3BsYXlOYW1lXxASQ0ZCdW5kbGVFeGVjdXRhYmxlXxASQ0ZCdW5kbGVJZGVudGlmaWVyXxAaQ0ZCdW5kbGVTaG9ydFZlcnNpb25TdHJpbmdfEBBDRkJ1bmRsZVVSTFR5cGVzXxAPQ0ZCdW5kbGVWZXJzaW9uXUxTRW52aXJvbm1lbnRfEBZMU01pbmltdW1TeXN0ZW1WZXJzaW9uXxAXTlNIaWdoUmVzb2x1dGlvbkNhcGFibGVfEBxOU01pY3JvcGhvbmVVc2FnZURlc2NyaXB0aW9uVVNsYWNrXxAZY29tLnRpbnlzcGVjay5zbGFja21hY2dhcFg0LjQxLjEwNaEP0hARCxJfEA9DRkJ1bmRsZVVSTE5hbWVfEBJDRkJ1bmRsZVVSTFNjaGVtZXOhE1VzbGFja1Y0NDExMDXRFhdeTWFsbG9jTmFub1pvbmVRMFUxMC4xNQlvEC0AUwBsAGEAYwBrACAAbgBlAGUAZABzACAAdABoAGUAIABtAGkAYwByAG8AcABoAG8AbgBlACAAZgBvAHIAIABoAHUAZABkAGwAZQBzACAgFAAgAGMAYQBmAOkACAAdADMASABdAHoAjQCfAK0AxgDgAP8BBQEhASoBLAExAUMBWAFaAWABZwFqAXkBewGBAYIAAAAAAAACAQAAAAAAAAAbAAAAAAAAAAAAAAAAAAAB3w==";
// Made by pylnk3: a shortcut with only an item list (no LinkInfo), the way
// some tools write them; Squirrel's own shortcut for Slack.
const PYLNK3_SLACK = "TAAAAAEUAgAAAAAAwAAAAAAAAEa1AQAAAAAAAAApxMC+Y90BACnEwL5j3QEAKcTAvmPdAQAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAIMBFAAfUOBP0CDqOmkQotgIACswMJ0ZAC9DOlwAAAAAAAAAAAAAAAAAAAAAAAAANgAyAAAAAABYXXZuEABVc2VycwAiAAMABADvvlhddm5YXXZuFAAAAFUAcwBlAHIAcwAAABQAMAAyAAAAAABYXXZuEABzYW0AHgADAAQA775YXXZuWF12bhQAAABzAGEAbQAAABIAPAAyAAAAAABYXXZuEABBcHBEYXRhACYAAwAEAO++WF12blhddm4UAAAAQQBwAHAARABhAHQAYQAAABYANgAyAAAAAABYXXZuEABMb2NhbAAiAAMABADvvlhddm5YXXZuFAAAAEwAbwBjAGEAbAAAABQANgAyAAAAAABYXXZuEABzbGFjawAiAAMABADvvlhddm5YXXZuFAAAAHMAbABhAGMAawAAABQARgAyAAAAAABYXXZuEABVcGRhdGUuZXhlAAAsAAMABADvvlhddm5YXXZuFAAAAFUAcABkAGEAdABlAC4AZQB4AGUAAAAaAAAABQBTAGwAYQBjAGsALQBDADoAXABVAHMAZQByAHMAXABzAGEAbQBcAEEAcABwAEQAYQB0AGEAXABMAG8AYwBhAGwAXABzAGwAYQBjAGsAXABhAHAAcAAtADQALgA0ADEALgAxADAANQAaAC0ALQBwAHIAbwBjAGUAcwBzAFMAdABhAHIAdAAgACIAcwBsAGEAYwBrAC4AZQB4AGUAIgAAAAAA";

// ================================================================ file formats

test("binary plists: plistlib's file, Morse's writer, and broken files give null", () => {
  const p = apps.parseBinaryPlist(Buffer.from(PLISTLIB_SLACK, "base64"));
  assert.equal(p.CFBundleDisplayName, "Slack");
  assert.equal(p.CFBundleIdentifier, "com.tinyspeck.slackmacgap");
  assert.equal(p.CFBundleShortVersionString, "4.41.105");
  assert.equal(p.NSHighResolutionCapable, true);
  assert.deepEqual(p.CFBundleURLTypes, [{ CFBundleURLName: "Slack", CFBundleURLSchemes: ["slack"] }]);
  assert.match(p.NSMicrophoneUsageDescription, /huddles — café$/, "UTF-16 strings");
  const mine = { CFBundleName: "Café ☕", N: 42, B: false, Long: "x".repeat(300), A: ["a", { b: 1 }] };
  assert.deepEqual(apps.parseBinaryPlist(binaryPlist(mine)), mine);
  const good = binaryPlist({ CFBundleName: "Figma" });
  assert.equal(apps.parseBinaryPlist(good.subarray(0, good.length - 5)), null, "cut short");
  assert.equal(apps.parseBinaryPlist(Buffer.from("bplist00 and then nothing useful at all, padding padding")), null);
  // An array that contains itself: refused, not an endless loop.
  const loop = binaryPlist(["x"]);
  loop[9] = 0x00; // the array's one reference now points at the array
  assert.equal(apps.parseBinaryPlist(loop), null);
  assert.equal(apps.parseBinaryPlist(null), null);
});

test("Info.plist in XML: CRLF line endings and entities are fine", () => {
  const p = apps.parsePlist("<plist>\r\n<dict>\r\n\t<key>CFBundleName</key>\r\n\t<string>Tom &amp; Jerry</string>\r\n</dict>\r\n</plist>\r\n");
  assert.deepEqual(p, { CFBundleName: "Tom & Jerry" });
});

test(".lnk shortcuts: pylnk3's file (item list only), Morse's writer (LinkInfo, %VARIABLE% target), and garbage", () => {
  const py = apps.parseLnk(Buffer.from(PYLNK3_SLACK, "base64"));
  assert.equal(py.target, "C:\\Users\\sam\\AppData\\Local\\slack\\Update.exe", "the path from the item list's long names");
  assert.equal(py.arguments, '--processStart "slack.exe"');
  assert.equal(py.workingDir, "C:\\Users\\sam\\AppData\\Local\\slack\\app-4.41.105");
  const env = apps.parseLnk(lnkBuffer({ target: "C:\\Users\\sam\\AppData\\Local\\GitHubDesktop\\Update.exe", envTarget: "%LOCALAPPDATA%\\GitHubDesktop\\Update.exe", args: "--processStart GitHubDesktop.exe" }));
  assert.equal(env.target, "%LOCALAPPDATA%\\GitHubDesktop\\Update.exe", "the target as typed wins: it follows the person, not the machine");
  const spaces = apps.parseLnk(lnkBuffer({ target: "D:\\Tools\\Acme Chat\\Acme Chat.exe" }));
  assert.equal(spaces.target, "D:\\Tools\\Acme Chat\\Acme Chat.exe");
  const unicode = apps.parseLnk(lnkBuffer({ target: "C:\\Users\\José\\AppData\\Local\\Programs\\Notion\\Notion.exe" }));
  assert.equal(unicode.target, "C:\\Users\\José\\AppData\\Local\\Programs\\Notion\\Notion.exe", "the Unicode path, not the ANSI one");
  assert.equal(apps.parseLnk(Buffer.from("not a shortcut")), null);
  assert.equal(apps.parseLnk(Buffer.alloc(200)), null);
  const cut = lnkBuffer({ target: "C:\\a.exe", args: "--x" });
  assert.doesNotThrow(() => apps.parseLnk(cut.subarray(0, 120)));
  assert.equal(apps.processStartOf('--processStart "Discord.exe"'), "Discord.exe");
  assert.equal(apps.processStartOf("--processStart slack.exe --process-start-args x"), "slack.exe");
  assert.equal(apps.processStartOf("--processStart=Figma.exe"), "Figma.exe");
  assert.equal(apps.processStartOf("--something-else"), null);
});

test("fuses: a universal Mach-O framework has one wire per part; Morse reads the framework, not Contents/MacOS", async () => {
  const ctx = await fixture(buildMac);
  const slack = ctx.real("/Applications/Slack.app");
  const fw = path.join(slack, "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework");
  // The framework's top-level name is a link to Versions/Current, as in real
  // bundles. (Windows needs Developer Mode for links; without it, the
  // framework file goes where the link would be.)
  const fwDir = path.join(slack, "Contents/Frameworks/Electron Framework.framework");
  try {
    await fs.symlink("A", path.join(fwDir, "Versions/Current"));
    await fs.symlink("Versions/Current/Electron Framework", path.join(fwDir, "Electron Framework"));
  } catch (e) {
    if (e.code !== "EPERM") throw e;
    console.log("# no symbolic links here (Windows without Developer Mode): copying the framework file instead");
    await fs.copyFile(fw, path.join(fwDir, "Electron Framework"));
  }
  assert.match(await electronBinaryFor(slack), /Electron Framework\.framework[\\/]Electron Framework$/);
  assert.equal(await electronBinaryFor(path.join(slack, "Contents/MacOS/Slack")), await electronBinaryFor(slack), "a path inside the bundle finds the same file");
  const info = await inspectFuses(slack);
  assert.equal(info.electron, true);
  assert.equal(info.format, "mach-o universal");
  assert.equal(info.parts, 2);
  assert.equal(info.partsDiffer, false);
  assert.equal(info.fuses.EnableNodeCliInspectArguments, "disabled");
  assert.match(formatFuses(info, "Slack"), /2 parts in this universal binary/);
  assert.match(formatFuses(info, "Slack"), /Morse only reads these/);
  // Parts that disagree are reported, not hidden.
  await fs.writeFile(await electronBinaryFor(slack), Buffer.concat([fuseWire("101010r01", { magic: 0xcafebabe }), fuseWire("111010r01", { magic: 0xcffaedfe })]));
  const mixed = await inspectFuses(slack);
  assert.equal(mixed.partsDiffer, true);
  assert.ok(fuseVerdict(mixed).some(l => /Intel and Apple silicon parts/.test(l)));
  assert.ok(fuseVerdict(mixed).some(l => /ELECTRON_RUN_AS_NODE/.test(l)), "RunAsNode on: Morse says it clears the variable");
  // Windows: the wire is in the app's .exe.
  const win = await fixture(buildWindows);
  const figma = await inspectFuses(win.real("C:\\Users\\sam\\AppData\\Local\\Figma\\app-125.0.3\\Figma.exe"));
  assert.equal(figma.format, "pe");
  assert.equal(figma.electron, true);
  assert.equal(binaryFormat(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), "elf");
});

// ================================================================ macOS

test("macOS: bundles with binary plists, the framework's version, app.asar in Contents/Resources", async () => {
  const ctx = await fixture(buildMac);
  const found = byId(apps.discoverApps(ctx));
  assert.equal(found.figma.name, "Figma", "binary Info.plist read without plutil");
  assert.equal(found.figma.bundleId, "com.figma.Desktop");
  assert.equal(found.figma.version, "125.0.3");
  assert.equal(found.figma.electron, "34.2.0", "Electron's version from Versions/A/Resources/Info.plist");
  assert.equal(found.figma.asar, "/Applications/Figma.app/Contents/Resources/app.asar");
  assert.equal(found.slack.asar, "/Applications/Slack.app/Contents/Resources/app.asar");
  assert.equal(found.spotify.asar, null, "CEF apps have no app.asar");
  assert.equal(found.figma.exe, "/Applications/Figma.app/Contents/MacOS/Figma");
  // A path inside a bundle means the bundle.
  const inner = apps.appFromPath(ctx, "/Applications/Slack.app/Contents/MacOS/Slack");
  assert.equal(inner.id, "slack");
  assert.equal(inner.path, "/Applications/Slack.app");
  assert.equal(inner.canAttach, true);
  // The package.json inside app.asar names an app the plist doesn't.
  const tunes = "/Applications/Tunes.app/Contents";
  for (const [p, data] of [[`${tunes}/Info.plist`, binaryPlist({ CFBundleExecutable: "tunes", CFBundleIdentifier: "com.example.tunes" })], [`${tunes}/MacOS/tunes`, "x"],
    [`${tunes}/Frameworks/Electron Framework.framework/Resources/Info.plist`, binaryPlist({ CFBundleVersion: "45.0.0" })],
    [`${tunes}/Resources/app.asar`, asarBuffer({ "package.json": JSON.stringify({ name: "tunes", productName: "Tunes Player", version: "2.0.1" }) })]]) {
    mkdirSync(path.dirname(ctx.real(p)), { recursive: true });
    writeFileSync(ctx.real(p), data);
  }
  const t = apps.appFromPath(ctx, "/Applications/Tunes.app");
  assert.equal(t.name, "Tunes Player");
  assert.equal(t.version, "2.0.1");
  assert.equal(t.exe, "/Applications/Tunes.app/Contents/MacOS/tunes");
});

test("macOS: morse launch runs the binary inside the bundle with the port, never `open -a`", async () => {
  const ctx = await fixture(buildMac);
  const slack = byId(apps.discoverApps(ctx)).slack;
  const cmd = apps.launchCommand(slack, 9334, [], { platform: "darwin", env: { PATH: "/usr/bin", HOME: "/Users/sam" } });
  assert.equal(cmd.file, "/Applications/Slack.app/Contents/MacOS/Slack");
  assert.deepEqual(cmd.args, ["--remote-debugging-port=9334"]);
  assert.equal(cmd.handoff, false, "the process Morse starts is the app");
  assert.equal(apps.executableFor({ path: "/Applications/Foo Bar.app" }, "darwin"), "/Applications/Foo Bar.app/Contents/MacOS/Foo Bar");
  // A browser gets its own profile in ~/.morse.
  const chrome = apps.launchCommand({ ...byId(apps.discoverApps(ctx)).chrome }, 9335, [], { platform: "darwin" });
  assert.ok(chrome.args.includes(`--user-data-dir=${path.posix.join(home, "browser-profile")}`));
});

test("macOS: --restart quits with AppleScript, and with SIGTERM at once when macOS says no", async () => {
  const procs = apps.parsePs(`500 1 /Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9334
501 500 /Applications/Slack.app/Contents/Frameworks/Slack Helper (Renderer).app/Contents/MacOS/Slack Helper (Renderer) --type=renderer`);
  const slack = { id: "slack", name: "Slack", bundleId: "com.tinyspeck.slackmacgap", path: "/Applications/Slack.app", exe: "/Applications/Slack.app/Contents/MacOS/Slack" };
  const ran = [], killed = [];
  let alive = true;
  const ok = await apps.quitApp(slack, { procs, platform: "darwin", waitMs: 300, run: (c, a) => { ran.push([c, ...a]); alive = false; return true; }, kill: (p, s) => killed.push([p, s]), isAlive: () => alive });
  assert.equal(ok, true);
  assert.deepEqual(ran, [["osascript", "-e", 'tell application id "com.tinyspeck.slackmacgap" to quit']]);
  assert.deepEqual(killed, [], "the app quit by itself, like ⌘Q");
  // Automation refused (osascript exits non-zero): SIGTERM right away, no 10 s wait.
  alive = true;
  ran.length = 0;
  const t0 = Date.now();
  const ok2 = await apps.quitApp(slack, { procs, platform: "darwin", waitMs: 5000, run: (c, a) => { ran.push([c, ...a]); return false; }, kill: (p, s) => { killed.push([p, s]); alive = false; }, isAlive: () => alive });
  assert.equal(ok2, true);
  assert.deepEqual(killed, [[500, "SIGTERM"]], "only the main process, not its helpers");
  assert.ok(Date.now() - t0 < 2000);
  // A name with quotes can't break out of the AppleScript string.
  ran.length = 0;
  await apps.quitApp({ ...slack, bundleId: null, name: 'Sl"ack\\' }, { procs, platform: "darwin", waitMs: 10, run: (c, a) => { ran.push(a[1]); return true; }, kill: () => {}, isAlive: () => false });
  assert.deepEqual(ran, ['tell application "Slack" to quit']);
});

test("macOS: a launch that fails says to open the app once from Finder (Gatekeeper)", () => {
  const msg = apps.launchFailure({ id: "figma", name: "Figma", engine: "electron" }, { code: null, signal: "SIGKILL" }, { platform: "darwin", uid: 501 });
  assert.match(msg, /open it once from Finder/);
  assert.doesNotMatch(apps.launchFailure({ name: "Figma" }, { code: 1 }, { platform: "linux", uid: 1000 }), /Finder/);
});

// ================================================================ Windows

test("Windows: Start menu shortcuts find Squirrel apps and apps on other drives; native apps and duplicates are left out", async () => {
  const ctx = await fixture(buildWindows);
  const list = apps.discoverApps(ctx);
  const found = byId(list);
  const gh = found["github-desktop"];
  assert.equal(gh.name, "GitHub Desktop", "named like its shortcut");
  assert.equal(gh.exe, "C:\\Users\\sam\\AppData\\Local\\GitHubDesktop\\app-3.4.9\\GitHubDesktop.exe", "the newest app-<version>");
  assert.equal(gh.launcher, "C:\\Users\\sam\\AppData\\Local\\GitHubDesktop\\Update.exe");
  assert.equal(gh.processName, "GitHubDesktop.exe");
  assert.equal(gh.version, "3.4.9");
  assert.equal(gh.shortcut, "C:\\Users\\sam\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\GitHub, Inc\\GitHub Desktop.lnk");
  const acme = found["acme-chat"];
  assert.equal(acme.exe, "D:\\Tools\\Acme Chat\\Acme Chat.exe");
  assert.equal(acme.version, "2.1.0", "from its app.asar");
  assert.equal(list.filter(a => a.id === "slack").length, 1, "Slack's own shortcut doesn't list it twice");
  assert.equal(found.figma.exe, "C:\\Users\\sam\\AppData\\Local\\Figma\\app-125.0.3\\Figma.exe");
  assert.equal(found.figma.version, "125.0.3");
  assert.equal(found.slack.version, "4.41.105", "Squirrel's folder name gives the version");
  assert.ok(!list.some(a => /notepad/i.test(a.name)), "a native app's shortcut is skipped");
  assert.ok(!list.some(a => /uninstall/i.test(a.name)));
  // Paths and shortcuts typed by the person.
  const viaLnk = apps.resolveApp("C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Acme Chat.lnk", { ctx });
  assert.equal(viaLnk.exe, "D:\\Tools\\Acme Chat\\Acme Chat.exe");
  assert.equal(viaLnk.name, "Acme Chat");
  const viaUpdate = apps.resolveApp("C:\\Users\\sam\\AppData\\Local\\GitHubDesktop\\Update.exe", { ctx });
  assert.equal(viaUpdate.exe, "C:\\Users\\sam\\AppData\\Local\\GitHubDesktop\\app-3.4.9\\GitHubDesktop.exe", "Update.exe means the app it starts");
  assert.equal(viaUpdate.launcher, "C:\\Users\\sam\\AppData\\Local\\GitHubDesktop\\Update.exe");
  assert.equal(apps.resolveApp("github", { ctx }).id, "github-desktop");
  // Under a root, real paths come back as Windows paths.
  assert.equal(ctx.realpath("C:\\Users\\sam\\AppData\\Local\\Figma\\Figma.exe"), "C:\\Users\\sam\\AppData\\Local\\Figma\\Figma.exe");
});

// CommandLineToArgvW's rules, to check winQuote against.
function splitWindows(s) {
  const out = [];
  let i = 0;
  for (;;) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (i >= s.length) return out;
    let arg = "", q = false;
    while (i < s.length && (q || (s[i] !== " " && s[i] !== "\t"))) {
      if (s[i] === "\\") {
        let n = 0;
        while (s[i] === "\\") { n++; i++; }
        if (s[i] === '"') { arg += "\\".repeat(n >> 1); if (n % 2) { arg += '"'; i++; } }
        else arg += "\\".repeat(n);
      } else if (s[i] === '"') {
        if (q && s[i + 1] === '"') { arg += '"'; i += 2; } else { q = !q; i++; }
      } else arg += s[i++];
    }
    out.push(arg);
  }
}

test("Windows: launching runs the app's exe with an argument list; only Update.exe gets --processStart", async () => {
  const ctx = await fixture(buildWindows);
  const found = byId(apps.discoverApps(ctx));
  const acme = apps.launchCommand(found["acme-chat"], 9333, ["--user-data-dir=C:\\My Profile"], { platform: "win32", env: {} });
  assert.equal(acme.file, "D:\\Tools\\Acme Chat\\Acme Chat.exe", "spaces stay as they are: no shell, no quotes");
  assert.deepEqual(acme.args, ["--remote-debugging-port=9333", "--user-data-dir=C:\\My Profile"]);
  assert.equal(acme.handoff, false);
  const discord = apps.launchCommand(found.discord, 9334, [], { platform: "win32", env: {} });
  assert.equal(discord.file, "C:\\Users\\sam\\AppData\\Local\\Discord\\app-1.0.9170\\Discord.exe", "the app itself, so Morse knows its process");
  // Only Update.exe found (no app-<version>\ yet): Squirrel starts the app and passes one string on.
  const stub = { id: "discord", name: "Discord", exe: "C:\\Users\\sam\\AppData\\Local\\Discord\\Update.exe", processName: "Discord.exe" };
  const viaUpdate = apps.launchCommand(stub, 9335, ["--user-data-dir=C:\\Users\\sam\\My Profile\\", "--x=\"quoted\""], { platform: "win32", env: {} });
  assert.deepEqual(viaUpdate.args.slice(0, 3), ["--processStart", "Discord.exe", "--process-start-args"]);
  assert.equal(viaUpdate.handoff, true);
  assert.deepEqual(splitWindows(viaUpdate.args[3]), ["--remote-debugging-port=9335", "--user-data-dir=C:\\Users\\sam\\My Profile\\", "--x=\"quoted\""], "the app gets back exactly these arguments");
  assert.throws(() => apps.launchCommand({ name: "X", exe: "C:\\X\\Update.exe", processName: "Update.exe" }, 9336, [], { platform: "win32" }), /can't tell which app/);
  for (const a of ["plain", "with space", 'quo"te', "trailing\\", "both \\\"", "", "tab\there", "\\\\server\\share\\x y\\"]) assert.deepEqual(splitWindows(apps.winQuote(a)), [a], a);
  // A browser's profile path uses Windows separators.
  const chrome = apps.launchCommand(found.chrome, 9337, [], { platform: "win32", env: {} });
  assert.ok(chrome.args.includes(`--user-data-dir=${path.win32.join(home, "browser-profile")}`));
  assert.ok(!chrome.args.some(a => /remote-debugging-address|allow-origins/.test(a)), "only this computer can reach the port");
});

test("Windows: --restart ends the process tree with taskkill /T, then /T /F for apps that hide in the tray", async () => {
  const procs = apps.parseWinProcesses(JSON.stringify([
    { ProcessId: 20, ParentProcessId: 1, ExecutablePath: "C:\\Users\\sam\\AppData\\Local\\slack\\app-4.41.105\\slack.exe", CommandLine: "\"C:\\Users\\sam\\AppData\\Local\\slack\\app-4.41.105\\slack.exe\"" },
    { ProcessId: 21, ParentProcessId: 20, ExecutablePath: "C:\\Users\\sam\\AppData\\Local\\slack\\app-4.41.105\\slack.exe", CommandLine: "\"C:\\Users\\sam\\AppData\\Local\\slack\\app-4.41.105\\slack.exe\" --type=renderer" },
  ]));
  const slack = { id: "slack", name: "Slack", exe: "C:\\Users\\sam\\AppData\\Local\\slack\\app-4.41.105\\slack.exe", processName: "slack.exe", source: "C:\\Users\\sam\\AppData\\Local\\slack" };
  assert.deepEqual(apps.findAppProcesses(slack, procs, { platform: "win32" }).map(p => p.pid), [20], "the quoted --type= child is a helper");
  const ran = [];
  let calls = 0;
  const ok = await apps.quitApp(slack, { procs, platform: "win32", waitMs: 50, run: (c, a) => { ran.push([c, ...a].join(" ")); return true; }, kill: () => {}, isAlive: () => ++calls < 4 });
  assert.equal(ok, true);
  assert.deepEqual(ran, ["taskkill /PID 20 /T", "taskkill /PID 20 /T /F"]);
});

test("Windows: processes are listed in UTF-8, and quoted arguments with spaces are read whole", () => {
  assert.match(apps.WIN_PROCESS_QUERY, /^\[Console\]::OutputEncoding = \[Text\.Encoding\]::UTF8; /);
  const procs = apps.parseWinProcesses(JSON.stringify({ ProcessId: 30, ParentProcessId: 1, ExecutablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    CommandLine: "\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --remote-debugging-port=9333 \"--user-data-dir=C:\\Users\\José Smith\\.morse\\browser-profile\"" }));
  assert.equal(procs.length, 1, "a single process comes back as an object, not a list");
  assert.equal(apps.argOf(procs[0].cmd, "user-data-dir"), "C:\\Users\\José Smith\\.morse\\browser-profile");
  assert.equal(apps.argOf("x --user-data-dir=\"/tmp/a b\" y", "user-data-dir"), "/tmp/a b");
  assert.equal(apps.argOf("x --user-data-dir=/tmp/p y", "user-data-dir"), "/tmp/p");
  assert.equal(apps.debugPortOf(procs[0].cmd), 9333);
  const chrome = { id: "chrome", name: "Chrome", browser: true, exe: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", processName: "chrome.exe" };
  assert.deepEqual(apps.findAppProcesses(chrome, procs, { platform: "win32", extraArgs: ["--user-data-dir=c:\\users\\josé smith\\.morse\\browser-profile"] }).map(p => p.pid), [30], "profile paths compare without case on Windows");
  // Morse's own node.exe, quoted, isn't the app even when it names the app.
  const self = apps.parseWinProcesses(JSON.stringify([{ ProcessId: 40, ParentProcessId: 1, ExecutablePath: "C:\\Program Files\\nodejs\\node.exe", CommandLine: "\"C:\\Program Files\\nodejs\\node.exe\" cli.js launch \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\"" }]));
  assert.deepEqual(apps.findAppProcesses({ ...chrome, browser: false }, self, { platform: "win32" }), []);
});

test("Windows: a launcher that hands off gets time; a plain exit is still an answer", async () => {
  let n = 0;
  const handoff = { handoff: true, exited: { code: 0, signal: null } };
  const port = await apps.waitForLaunch(handoff, { name: "Discord" }, 9333, { grace: 10, handoffGrace: 3000, wait: async () => { if (++n < 4) throw new Error("not yet"); return "ws://x"; } });
  assert.equal(port, "ws://x");
  await assert.rejects(apps.waitForLaunch({ exited: { code: 0, signal: null } }, { name: "Discord", id: "discord" }, 9333, { grace: 10, wait: async () => { await new Promise(r => setTimeout(r, 20)); throw new Error("no"); } }),
    e => e.failed && /quit right after it started/.test(e.message));
  assert.match(apps.launchFailure({ id: "discord", name: "Discord" }, { code: 0 }, { platform: "win32" }), /tray.*--restart/);
});

// ================================================================ both

test("the environment the app starts with: no ELECTRON_RUN_AS_NODE or NODE_OPTIONS, in any spelling", () => {
  const env = apps.launchEnv({ id: "slack" }, { env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1", node_options: "--inspect", HOME: "/Users/sam" }, has: () => true });
  assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/Users/sam" });
  const img = apps.launchEnv({ appimage: true }, { env: { PATH: "/usr/bin" }, has: () => false });
  assert.equal(img.APPIMAGE_EXTRACT_AND_RUN, "1", "AppImages without FUSE still unpack first");
});

test("Morse never changes an app's files: finding, reading, fuses and launch plans leave every byte and date alone", async () => {
  const roots = [];
  for (const build of [buildMac, buildWindows, buildLinux]) {
    const dir = tempDir("morse-ro-");
    roots.push([dir, apps.hostContext(await build(dir))]);
  }
  const hashes = dir => {
    const out = {};
    const walk = d => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        const st = statSync(p, { throwIfNoEntry: false });
        if (!st) continue;
        if (st.isDirectory()) { walk(p); out[p] = `dir ${st.mode}`; continue; }
        out[p] = `${crypto.createHash("sha256").update(readFileSync(p)).digest("hex")} ${st.mode} ${st.mtimeMs}`;
      }
    };
    walk(dir);
    return out;
  };
  const before = roots.map(([d]) => hashes(d));
  for (const [dir, ctx] of roots) {
    const list = apps.discoverApps(ctx);
    apps.formatApps(list, { platform: ctx.platform, color: false });
    for (const a of list) {
      try { apps.resolveApp(a.name, { ctx, apps: list }); } catch {}
      if (ctx.exists(a.path)) apps.appFromPath(ctx, a.path);
      try { apps.launchCommand(a, 9333, [], { platform: ctx.platform, env: {} }); } catch {}
      try { await inspectFuses(ctx.real(a.path)); } catch {}
    }
    assert.ok(list.length >= 7, `found apps under ${dir}`);
  }
  assert.deepEqual(roots.map(([d]) => hashes(d)), before);
});

test("Morse never changes an app's files: no write in the desktop code except to ~/.morse, and no signing or fuse tools", () => {
  const WRITES = /\b(writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|chmod|chmodSync|unlink|unlinkSync|rm|rmSync|copyFile|copyFileSync|truncate|symlink|utimes|createWriteStream|mkdir|mkdirSync)\s*\(/g;
  const code = f => readFileSync(path.join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "");
  const writes = f => [...code(f).matchAll(WRITES)].map(m => m[1]);
  // Each file that finds, reads, starts or connects to apps, and what it may write (all under HOME).
  assert.deepEqual(writes("daemon/apps.js"), ["mkdir", "writeFile"], "only saveAppPref, into ~/.morse/apps.json");
  assert.match(code("daemon/apps.js"), /await fs\.mkdir\(HOME, \{ recursive: true, mode: 0o700 \}\);\s*await fs\.writeFile\(PREFS\(\),/);
  for (const f of ["daemon/fuses.js", "daemon/desktop.js", "daemon/ports.js", "daemon/cdp.js", "daemon/targets.js", "daemon/platform.js", "daemon/colors.js"]) assert.deepEqual(writes(f), [], f);
  assert.deepEqual(writes("daemon/connector.js"), ["mkdirSync"], "only ~/.morse/mods, to watch it");
  assert.match(code("daemon/connector.js"), /path\.join\(HOME, "mods"\);\s*mkdirSync\(dir/);
  // Files are opened for reading only.
  for (const m of code("daemon/fuses.js").matchAll(/\bopen\(([^)]*)\)/g)) assert.match(m[1], /, "r"$/, m[0]);
  assert.match(code("daemon/apps.js"), /openSync\(real\(p\), "r"\)/);
  // Nothing re-signs, un-quarantines, flips fuses or repacks an app.
  for (const dir of ["daemon", "core"]) for (const f of readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith(".js"))) {
    const src = code(`${dir}/${f}`);
    assert.doesNotMatch(src, /\bcodesign\b|\bxattr\b|flipFuses|@electron\/fuses|@electron\/asar|asar\.createPackage|\bspctl\b|\bicacls\b/, `${dir}/${f}`);
  }
});

test("ports: everything Morse listens on is 127.0.0.1, so no firewall asks", () => {
  for (const f of ["daemon/bridge.js", "daemon/ports.js"]) {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/\.listen\(([^)]*)\)/g)) assert.match(m[1], /host|127\.0\.0\.1/, `${f}: ${m[0]}`);
  }
  assert.match(readFileSync(path.join(ROOT, "daemon/bridge.js"), "utf8"), /host = "127\.0\.0\.1"/);
  assert.match(readFileSync(path.join(ROOT, "daemon/ports.js"), "utf8"), /export function canBind\(port, host = "127\.0\.0\.1"\)/);
});

test("default shortcuts: ⌥Space on a Mac, Ctrl+Shift+Space on Windows and Linux", () => {
  assert.equal(formatCombo(defaultHotkeys("mac").open, "mac"), "⌥Space");
  assert.equal(formatCombo(defaultHotkeys("win").open, "win"), "Ctrl+Shift+Space");
  assert.equal(formatCombo(defaultHotkeys("linux").open, "linux"), "Ctrl+Shift+Space");
});

test("the popular apps are known on both platforms", () => {
  for (const id of ["slack", "discord", "spotify", "vscode", "notion", "obsidian", "figma"]) {
    const c = apps.CATALOG[id];
    assert.ok(c.mac?.bundles?.length && c.mac?.ids?.length, `${id} on macOS`);
    assert.ok(c.win?.length, `${id} on Windows`);
  }
  for (const id of ["slack", "discord", "figma"]) assert.ok(apps.CATALOG[id].squirrel, `${id} installs with Squirrel`);
});

// ---- `morse apps`, one snapshot per platform
const SNAP = path.join(ROOT, "tests/snapshots");
function matchSnapshot(name, text) {
  const file = path.join(SNAP, name);
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) { mkdirSync(SNAP, { recursive: true }); writeFileSync(file, text + "\n"); }
  // A Windows checkout without .gitattributes would have CRLF here.
  assert.equal(text, readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, ""), `${name} changed. If that's intended: UPDATE_SNAPSHOTS=1 node --test tests/platforms.test.js`);
}

for (const [name, build, platform] of [["mac", buildMac, "darwin"], ["windows", buildWindows, "win32"], ["linux", buildLinux, "linux"]]) {
  test(`\`morse apps\` on ${name} (snapshot)`, async () => {
    const ctx = await fixture(build);
    const list = apps.discoverApps(ctx);
    const text = apps.formatApps(list, { platform, color: false, running: new Map([["slack", { port: null }], ["discord", { port: 9222 }]]), sessions: [{ id: "vscode", port: 9333 }] });
    assert.doesNotMatch(text, /\x1b\[/);
    matchSnapshot(`apps-${name}.txt`, text);
    const json = JSON.parse(JSON.stringify(list));
    assert.ok(json.every(a => typeof a.path === "string" && a.id && a.name), "--json has a path, id and name for every app");
  });
}

// ---- `morse doctor`
test("`morse doctor` platform rows: the Morse folder's permissions, the shortcut, and each platform's own checks", async () => {
  const plain = painter(false);
  const mac = await platformChecks({ platform: "darwin", release: "24.1.0", arch: "arm64", env: {}, home: "/Users/sam/.morse", userHome: "/Users/sam", stat: async () => ({ mode: 0o40700 }), color: true });
  const by = rows => Object.fromEntries(rows.map(r => [r.label, r]));
  assert.equal(by(mac).system.text, "macOS 15 (Apple silicon)");
  assert.equal(by(mac).folder.ok, true);
  assert.match(by(mac).shortcut.text, /^⌥Space opens Morse/);
  assert.match(by(mac).access.text, /no Accessibility, Screen Recording or other permission/);
  // A folder others can list, with config.json still private: worth knowing, not a problem.
  const listed = await platformChecks({ platform: "darwin", release: "23.0.0", arch: "x64", env: {}, home: "/Users/sam/.morse", stat: async p => ({ mode: p.endsWith("config.json") ? 0o100600 : 0o40755 }) });
  assert.equal(by(listed).folder.ok, null);
  assert.match(by(listed).folder.text, /chmod 700/);
  assert.equal(by(listed).system.text, "macOS 14 (Intel)");
  // API keys others can read: a problem.
  const open = await platformChecks({ platform: "linux", env: { DISPLAY: ":0" }, home: "/home/sam/.morse", stat: async p => ({ mode: p.endsWith("config.json") ? 0o100644 : 0o40755 }) });
  assert.equal(by(open).folder.ok, false);
  assert.match(by(open).folder.text, /chmod 600 "\/home\/sam\/\.morse\/config\.json"/);
  assert.equal(by(open).display.ok, true);

  const win = await platformChecks({ platform: "win32", release: "10.0.22631", arch: "x64", env: { SystemRoot: "C:\\Windows" }, home: "C:\\Users\\sam\\.morse", userHome: "C:\\Users\\sam", exists: () => true, color: false });
  assert.equal(by(win).system.text, "Windows 11 (build 22631, x64)");
  assert.equal(by(win).folder.ok, true);
  assert.match(by(win).folder.text, /only you, administrators and Windows itself/);
  assert.match(by(win).shortcut.text, /^Ctrl\+Shift\+Space opens Morse/);
  assert.equal(by(win).processes.ok, true);
  assert.match(by(win).firewall.text, /127\.0\.0\.1/);
  assert.match(by(win).colors.text, /^off/);
  const shared = await platformChecks({ platform: "win32", release: "10.0.19045", env: {}, home: "D:\\Shared\\morse", userHome: "C:\\Users\\sam", exists: () => false, shortcut: "Alt+Shift+Space" });
  assert.equal(by(shared).folder.ok, false, "outside the user folder");
  assert.equal(by(shared).processes.ok, false);
  assert.match(by(shared).shortcut.text, /Alt\+Shift\+Space opens Morse \(the default here is Ctrl\+Shift\+Space\)/);
  assert.equal(by(shared).system.text, "Windows 10 (build 19045, x64)");
  assert.equal(by(await platformChecks({ platform: "win32", home: "C:\\Users\\samuel\\.morse", userHome: "C:\\Users\\sam", env: {}, exists: () => true })).folder.ok, false, "C:\\Users\\samuel isn't inside C:\\Users\\sam");

  const lin = await platformChecks({ platform: "linux", release: "6.8.0-45-generic", arch: "x64", env: {}, home: "/root/.morse", stat: async () => { throw new Error("ENOENT"); }, uid: 0 });
  assert.equal(by(lin).display.ok, false);
  assert.equal(by(lin).user.ok, false);
  assert.equal(by(lin).folder.ok, null);
  const text = formatChecks(lin, { paint: plain });
  assert.match(text, /^ {2}system {4}/);
  assert.doesNotMatch(text, /\x1b\[/);
});

test("starting .cmd programs on Windows (claude.cmd, codex.cmd): through cmd.exe with the path quoted", () => {
  assert.deepEqual(commandFor("C:\\Program Files\\nodejs\\claude.cmd", ["--version"], { platform: "win32" }), { file: "\"C:\\Program Files\\nodejs\\claude.cmd\"", args: ["--version"], shell: true });
  assert.deepEqual(commandFor("C:\\tools\\codex.exe", ["--version"], { platform: "win32" }), { file: "C:\\tools\\codex.exe", args: ["--version"], shell: false });
  assert.deepEqual(commandFor("/usr/local/bin/claude", ["--version"], { platform: "darwin" }).shell, false);
  assert.throws(() => commandFor("C:\\x\\claude.cmd", ["a & del *"], { platform: "win32" }), /safely/);
  assert.equal(systemName({ platform: "darwin", release: "25.0.0", arch: "arm64" }), "macOS 26 (Apple silicon)");
});

test("colors: only in a terminal, NO_COLOR turns them off, FORCE_COLOR on", () => {
  const tty = { isTTY: true }, pipe = { isTTY: false };
  assert.equal(colorOn({ stream: tty, env: {} }), true);
  assert.equal(colorOn({ stream: pipe, env: {} }), false, "piped or redirected, as in morse apps > apps.txt");
  assert.equal(colorOn({ stream: tty, env: { NO_COLOR: "1" } }), false);
  assert.equal(colorOn({ stream: tty, env: { NO_COLOR: "" } }), true, "an empty NO_COLOR doesn't count");
  assert.equal(colorOn({ stream: pipe, env: { FORCE_COLOR: "1" } }), true);
  assert.equal(colorOn({ stream: tty, env: { FORCE_COLOR: "0" } }), false);
  assert.equal(colorOn({ stream: tty, env: { TERM: "dumb" } }), false);
  assert.equal(painter(false).g("x"), "x");
  assert.equal(painter(true).g("x"), "\x1b[32mx\x1b[0m");
  // Every daemon file takes its colors from colors.js.
  for (const f of readdirSync(path.join(ROOT, "daemon")).filter(f => f.endsWith(".js") && f !== "colors.js")) {
    assert.doesNotMatch(readFileSync(path.join(ROOT, "daemon", f), "utf8"), /`\\x1b\[\d+m\$\{/, `daemon/${f} defines its own colors`);
  }
});

test("line endings and byte order marks: LF in the repo, files saved by Notepad still read", async () => {
  assert.match(readFileSync(path.join(ROOT, ".gitattributes"), "utf8"), /^\* text=auto eol=lf$/m);
  assert.doesNotMatch(readFileSync(path.join(ROOT, "daemon/cli.js"), "utf8"), /\r/, "the #! line must not end in CR");
  assert.deepEqual(apps.parseDesktopEntry("[Desktop Entry]\r\nName=Foo\r\nExec=/opt/foo %U\r\n"), { Name: "Foo", Exec: "/opt/foo %U" });
  // config.json edited in Notepad: a byte order mark and CRLF.
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, "config.json"), "\uFEFF{\r\n  \"provider\": \"claude-code\"\r\n}\r\n");
  assert.equal((await store.loadConfig()).provider, "claude-code");
  assert.deepEqual(store.parseJson("\uFEFF[1]"), [1]);
  await fs.writeFile(path.join(home, "apps.json"), "\uFEFF{\"slack\":{\"restart\":true}}");
  assert.equal((await apps.loadAppPrefs()).slack.restart, true);
});
