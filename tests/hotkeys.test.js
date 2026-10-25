import { tempDir } from "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCombo, normalizeCombo, formatCombo, comboParts, comboFromEvent, matchCombo, releasesCombo,
  checkCombo, defaultHotkeys, resolveHotkeys, detectPlatform, decideOpenShortcut,
} from "../core/hotkeys.js";
import { normalizePrefs, mergePrefs, pushHistory, DEFAULT_PREFS, HISTORY_MAX } from "../core/prefs.js";

const ev = (code, mods = {}) => ({ code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta });

test("parses the spellings people write and normalizes to event.code", () => {
  assert.equal(normalizeCombo("Alt+Space"), "Alt+Space");
  assert.equal(normalizeCombo("cmd+shift+m"), "Shift+Meta+KeyM");
  assert.equal(normalizeCombo("⌥⇧M"), "Alt+Shift+KeyM");
  assert.equal(normalizeCombo("Ctrl+,"), "Ctrl+Comma");
  assert.equal(normalizeCombo("option+1"), "Alt+Digit1");
  assert.equal(normalizeCombo("Control+Alt+F13"), "Ctrl+Alt+F13");
  assert.equal(normalizeCombo("none"), "none");
  assert.equal(parseCombo("Alt+Shift"), null, "modifiers alone are not a combo");
  assert.equal(parseCombo(""), null);
});

test("formats with ⌘⌥⌃⇧ on macOS and words elsewhere", () => {
  assert.equal(formatCombo("Alt+Space", "mac"), "⌥Space");
  assert.equal(formatCombo("Ctrl+Alt+Shift+Meta+KeyK", "mac"), "⌃⌥⇧⌘K");
  assert.equal(formatCombo("Ctrl+Shift+Space", "win"), "Ctrl+Shift+Space");
  assert.equal(formatCombo("Meta+KeyK", "win"), "Win+K");
  assert.equal(formatCombo("Meta+KeyK", "linux"), "Super+K");
  assert.equal(formatCombo("Meta+Comma", "mac"), "⌘,");
  assert.deepEqual(comboParts("Alt+Shift+KeyM", "mac"), ["⌥", "⇧", "M"]);
  assert.deepEqual(comboParts("Alt+Shift+KeyM", "linux"), ["Alt", "Shift", "M"]);
  assert.equal(formatCombo("none", "mac"), "Off");
});

test("matches on physical keys and exact modifiers", () => {
  assert.ok(matchCombo(ev("Space", { alt: true }), "Alt+Space"));
  assert.ok(!matchCombo(ev("Space", { alt: true, shift: true }), "Alt+Space"), "extra modifier");
  assert.ok(!matchCombo(ev("Space"), "Alt+Space"));
  assert.ok(matchCombo(ev("KeyM", { alt: true, shift: true }), "Alt+Shift+KeyM"));
  assert.ok(releasesCombo({ code: "AltLeft" }, "Alt+Space"));
  assert.ok(releasesCombo({ code: "Space" }, "Alt+Space"));
  assert.ok(!releasesCombo({ code: "ShiftLeft" }, "Alt+Space"));
});

test("reads combos from key events, modifiers-only as a partial", () => {
  assert.deepEqual(comboFromEvent(ev("KeyK", { ctrl: true, shift: true })), { combo: "Ctrl+Shift+KeyK", partial: "" });
  assert.deepEqual(comboFromEvent(ev("AltLeft", { alt: true, shift: true })), { combo: "", partial: "Alt+Shift" });
  assert.deepEqual(comboFromEvent(ev("ShiftLeft")), { combo: "", partial: "" });
});

test("rejects critical OS and browser shortcuts", () => {
  for (const c of ["Meta+KeyQ", "Meta+KeyW", "Meta+KeyT", "Meta+KeyN", "Meta+KeyR", "Meta+KeyL", "Meta+Space", "Meta+Tab"]) {
    assert.equal(checkCombo(c, "mac").level, "error", c);
  }
  for (const c of ["Alt+F4", "Alt+Tab", "Ctrl+KeyW", "Ctrl+KeyT", "Ctrl+KeyN", "Ctrl+KeyR", "Ctrl+KeyL", "Ctrl+KeyQ"]) {
    assert.equal(checkCombo(c, "win").level, "error", c);
    assert.equal(checkCombo(c, "linux").level, "error", c);
  }
  assert.match(checkCombo("Meta+KeyQ", "mac").message, /⌘Q quits the app/);
  assert.match(checkCombo("Alt+Space", "win").message, /window menu/);
  assert.equal(checkCombo("Alt+Space", "mac").level, "ok");
  assert.equal(checkCombo("Alt+Space", "linux").level, "warn", "allowed, but it opens the window menu or KRunner");
  assert.match(checkCombo("Alt+Space", "linux").message, /KRunner/);
});

test("needs a real modifier so typing never triggers it", () => {
  assert.equal(checkCombo("KeyA", "mac").level, "error");
  assert.match(checkCombo("Shift+KeyA", "linux").message, /types a character/);
  assert.equal(checkCombo("F13", "mac").level, "ok", "F13-F24 are free on their own");
  assert.equal(checkCombo("Alt+Shift", "mac").level, "error");
});

test("warns on common app shortcuts but allows them", () => {
  const w = checkCombo("Meta+KeyC", "mac");
  assert.equal(w.level, "warn");
  assert.match(w.message, /Copy/);
  assert.equal(checkCombo("Ctrl+KeyV", "win").level, "warn");
  assert.equal(checkCombo("Ctrl+KeyC", "mac").level, "ok", "Ctrl+C is not Copy on a Mac");
  assert.match(checkCombo("Alt+KeyV", "mac").message, /special character/);
  assert.match(checkCombo("Alt+KeyV", "win").message, /menu/);
  assert.equal(checkCombo("Ctrl+Space", "mac").level, "warn");
});

test("refuses a combo another action already uses, except talk sharing open", () => {
  const others = { open: "Alt+Space", mods: "Alt+Shift+KeyM" };
  const dup = checkCombo("Alt+Shift+KeyM", "mac", { self: "godmode", others });
  assert.equal(dup.level, "error");
  assert.match(dup.message, /Mods panel/);
  const shared = checkCombo("Alt+Space", "mac", { self: "talk", others });
  assert.equal(shared.level, "ok");
  assert.match(shared.message, /hold to talk/);
});

test("defaults per platform, and push to talk follows open until changed", () => {
  assert.equal(defaultHotkeys("mac").open, "Alt+Space");
  assert.equal(defaultHotkeys("linux").open, "Ctrl+Shift+Space", "Alt+Space is the window menu / KRunner on Linux desktops");
  assert.equal(checkCombo(defaultHotkeys("linux").open, "linux").level, "ok");
  assert.equal(defaultHotkeys("win").open, "Ctrl+Shift+Space");
  const r = resolveHotkeys({ open: "Alt+KeyK", godmode: "none" }, "mac");
  assert.equal(r.open, "Alt+KeyK");
  assert.equal(r.talk, "Alt+KeyK");
  assert.equal(r.mods, "Alt+Shift+KeyM");
  assert.equal(r.godmode, "");
  assert.equal(resolveHotkeys({ talk: "Alt+KeyT" }, "win").talk, "Alt+KeyT");
});

test("saving the shortcut that opens Morse: the default, a refusal, and a warning", () => {
  assert.deepEqual(decideOpenShortcut({}, "", "linux"), { ok: true, value: "", level: "ok", message: "" });
  assert.deepEqual(decideOpenShortcut({}, "default", "mac"), { ok: true, value: "", level: "ok", message: "" });
  const off = decideOpenShortcut({}, "none", "linux");
  assert.equal(off.ok, false);
  assert.match(off.message, /Morse needs a shortcut/);
  const bare = decideOpenShortcut({}, "KeyA", "linux");
  assert.equal(bare.ok, false);
  assert.match(bare.message, /One key alone/);
  assert.match(decideOpenShortcut({}, "Alt+Shift", "win").message, /Add a letter/);
  assert.match(decideOpenShortcut({}, "nope", "mac").message, /One key alone/);
  assert.match(decideOpenShortcut({}, "Meta+KeyQ", "mac").message, /quits the app/);
  assert.match(decideOpenShortcut({}, "Ctrl+KeyQ", "linux").message, /quits the app/);
  assert.match(decideOpenShortcut({}, "Ctrl+KeyQ", "win").message, /quits the app/);
  const mods = decideOpenShortcut({}, "Alt+Shift+KeyM", "linux");
  assert.equal(mods.ok, false);
  assert.match(mods.message, /Mods panel/);
  const ok = decideOpenShortcut({}, "Alt+Shift+KeyK", "linux");
  assert.deepEqual(ok, { ok: true, value: "Alt+Shift+KeyK", level: "ok", message: "" });
  assert.equal(decideOpenShortcut({}, "Alt+Space", "mac").value, "", "recording the Mac default stores nothing");
  assert.equal(decideOpenShortcut({}, "Ctrl+Shift+Space", "linux").value, "");
  assert.equal(decideOpenShortcut({}, "Ctrl+Shift+Space", "win").value, "");
  const copy = decideOpenShortcut({}, "Ctrl+KeyC", "linux");
  assert.equal(copy.ok, true);
  assert.equal(copy.value, "Ctrl+KeyC");
  assert.match(copy.message, /Copy/);
  assert.match(decideOpenShortcut({}, "Meta+KeyC", "mac").message, /Copy/);
  const talk = decideOpenShortcut({ talk: "Alt+KeyJ" }, "Alt+KeyJ", "linux");
  assert.equal(talk.ok, true);
  assert.match(talk.message, /hold to talk/);
  assert.equal(decideOpenShortcut({}, "F13", "win").value, "F13");
});

test("detects the platform", () => {
  assert.equal(detectPlatform({ platform: "MacIntel" }), "mac");
  assert.equal(detectPlatform({ platform: "Win32" }), "win");
  assert.equal(detectPlatform({ platform: "Linux x86_64" }), "linux");
  assert.equal(detectPlatform({ userAgentData: { platform: "macOS" } }), "mac");
});

test("settings normalize, merge one level deep, and drop junk", () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  const p = normalizePrefs({ hotkeys: { open: "Alt+KeyK", mods: "<script>" }, effects: "loud", theme: "dark", welcome: false, extra: 1 });
  assert.equal(p.hotkeys.open, "Alt+KeyK");
  assert.equal(p.hotkeys.mods, "");
  assert.equal(p.effects, "");
  assert.equal(p.theme, "dark");
  assert.equal(p.welcome, false);
  assert.equal(p.extra, undefined);
  const m = mergePrefs(p, { hotkeys: { talk: "none" }, voice: { autoSubmit: true } });
  assert.equal(m.hotkeys.open, "Alt+KeyK", "other hotkeys kept");
  assert.equal(m.hotkeys.talk, "none");
  assert.equal(m.voice.autoSubmit, true);
});

test("history keeps the newest 50, a repeat moves to the end", () => {
  let h = [];
  for (let i = 0; i < 60; i++) h = pushHistory(h, `p${i}`);
  assert.equal(h.length, HISTORY_MAX);
  assert.equal(h[0], "p10");
  h = pushHistory(h, "p20");
  assert.equal(h.at(-1), "p20");
  assert.equal(h.filter(x => x === "p20").length, 1);
  assert.deepEqual(pushHistory(["a"], "  "), ["a"]);
});

test("the CLI help shows the hotkey actually configured", async () => {
  const { writeFile, rm } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const home = tempDir("morse-cli-");
  const cli = new URL("../daemon/cli.js", import.meta.url).pathname;
  const help = () => execFileSync(process.execPath, [cli, "help"], { env: { ...process.env, MORSE_HOME: home }, encoding: "utf8" }).replace(/\x1b\[\d+m/g, "");
  const re = s => s.replace(/[+]/g, "\\+");
  try {
    const platform = detectPlatform({ platform: process.platform });
    assert.match(help(), new RegExp(`In a connected app, press ${re(formatCombo(defaultHotkeys(platform).open, platform))} to open Morse`));
    await writeFile(path.join(home, "settings.json"), JSON.stringify({ hotkeys: { open: "Alt+KeyJ", mods: "none" } }));
    assert.match(help(), new RegExp(`In a connected app, press ${re(formatCombo("Alt+KeyJ", platform))} to open Morse\\.`));
  } finally { await rm(home, { recursive: true, force: true }); }
});
