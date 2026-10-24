// Morse in the person's language (core/i18n.js, core/locales/*.js): every
// language has every message (or says on purpose which ones stay English),
// the {placeholders} and markup match English, t() falls back to English,
// the language comes from the browser or the terminal, and the CLI speaks it.
import "./helpers/home.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  t, setLanguage, getLanguage, pickLanguage, matchLanguage, languageFromEnv, isRtl, LANGUAGES, CATALOGS, englishName,
} from "../core/i18n.js";
import { PREF_LANGUAGES, normalizePrefs } from "../core/prefs.js";

const EN = CATALOGS.en;
// Messages a language keeps in English on purpose: [lang] -> [id, why].
// (Keep this short: a missing message shows the English one.)
const ENGLISH_ON_PURPOSE = {};
// New messages that show in English until they are translated, in every
// language. Remove an id once the languages have it.
const WAITING_FOR_TRANSLATION = [
  // models (core/route.js): the Model setting, the setup question, the popup label
  "gen.stronger", "settings.model", "settings.model.auto", "settings.model.fast", "settings.model.best",
  "settings.model.note.auto", "settings.model.note.fast", "settings.model.note.best", "settings.model.pinned",
  "popup.modelHarder", "setup.model.which", "setup.model.autoWhy", "setup.model.fastWhy", "setup.model.bestWhy",
  "setup.model.choose", "setup.model.now", "setup.model.always", "setup.model.change", "cli.badModelMode",
  // polish (core/polish.js): the setting and the status while Morse looks at a change
  "gen.polishing", "settings.changes", "settings.polish", "settings.polish.help",
];

const placeholders = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const tags = s => [...String(s).matchAll(/<\/?([a-z][\w-]*)([^>]*)>/gi)].map(m => `${m[1].toLowerCase()}${(m[2].match(/\b(class|id|data-[\w-]+|href|type)="[^"]*"/g) || []).sort().join(" ")}`).sort();
const forms = v => (typeof v === "object" ? Object.values(v) : [v]);

test("every language has every message, and nothing English doesn't have", () => {
  const ids = Object.keys(EN);
  assert.ok(ids.length > 400, `the English catalog has the UI's words (${ids.length})`);
  for (const { code } of LANGUAGES) {
    if (code === "en") continue;
    const cat = CATALOGS[code];
    const kept = new Set([...(ENGLISH_ON_PURPOSE[code] || []).map(([id]) => id), ...WAITING_FOR_TRANSLATION.filter(id => cat[id] == null)]);
    const missing = ids.filter(id => cat[id] == null && !kept.has(id));
    const extra = Object.keys(cat).filter(id => EN[id] == null);
    assert.deepEqual(missing, [], `${code} is missing ${missing.length} messages`);
    assert.deepEqual(extra, [], `${code} has messages English doesn't`);
  }
});

test("translations keep the {placeholders}, the markup and the plural shape", () => {
  const problems = [];
  for (const { code } of LANGUAGES) {
    if (code === "en") continue;
    for (const [id, v] of Object.entries(CATALOGS[code])) {
      const e = EN[id];
      if (e == null) continue;
      if ((typeof e === "object") !== (typeof v === "object")) { problems.push(`${code} ${id}: plural in one, not the other`); continue; }
      const want = [...new Set(forms(e).flatMap(placeholders))].sort();
      const have = [...new Set(forms(v).flatMap(placeholders))].sort();
      if (want.join() !== have.join()) problems.push(`${code} ${id}: {${have}} but English has {${want}}`);
      if (typeof v === "object" && v.other == null) problems.push(`${code} ${id}: a plural needs "other"`);
      for (const f of forms(v)) if (tags(f).join() !== tags(forms(e)[0]).join()) problems.push(`${code} ${id}: markup ${tags(f)} but English has ${tags(forms(e)[0])}`);
      for (const f of forms(v)) if (!String(f).trim()) problems.push(`${code} ${id}: empty`);
    }
  }
  assert.deepEqual(problems, []);
});

test("requests the person finishes in the bar keep their shape in every language", () => {
  // Rename puts the caret before the last character (58-suggest.js caret -1),
  // so the request ends in its closing quote; the Show me once chips are
  // finished by typing after them, so the shortcut one ends in Ctrl+Shift+
  // and the "every" one in a space or a colon the person types after.
  const problems = [];
  for (const { code } of LANGUAGES) {
    const rename = t("sug.rename.p", {}, code), key = t("so.chip.shortcut.p", {}, code), every = t("so.chip.every.p", {}, code);
    if (!/[”“»」"]$/.test(rename)) problems.push(`${code} sug.rename.p: “${rename}” doesn't end in a closing quote`);
    if (!key.endsWith("Ctrl+Shift+")) problems.push(`${code} so.chip.shortcut.p: “${key}” doesn't end in Ctrl+Shift+`);
    if (!/[\s:：]$/.test(every)) problems.push(`${code} so.chip.every.p: “${every}” doesn't end where the person types`);
  }
  assert.deepEqual(problems, []);
});

test("product and key names stay as they are", () => {
  const keep = ["Morse", "Claude Code", "Codex", "Chrome", "Esc", "Enter", "Ctrl", "Alt", "Shift", "F1", "Tampermonkey"];
  const problems = [];
  for (const { code } of LANGUAGES) {
    if (code === "en") continue;
    for (const [id, e] of Object.entries(EN)) {
      const v = CATALOGS[code][id];
      if (v == null) continue;
      for (const name of keep) {
        const n = s => String(s).split(name).length - 1;
        if (n(forms(e).join(" ")) && !n(forms(v).join(" "))) problems.push(`${code} ${id}: “${name}” is missing`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("t(): placeholders, plurals, and English for anything a language lacks", () => {
  const was = getLanguage();
  try {
    setLanguage("en");
    assert.equal(t("toast.deleted", { title: "Sleep timer" }), "Deleted “Sleep timer”");
    assert.equal(t("panel.search", { n: 1 }), "Search 1 mod");
    assert.equal(t("panel.search", { n: 7 }), "Search 7 mods");
    assert.equal(t("no.such.message"), "no.such.message", "an unknown id shows itself");
    assert.equal(t("toast.deleted"), "Deleted “{title}”", "a missing var stays visible");
    setLanguage("es");
    assert.equal(t("btn.save"), "Guardar");
    assert.equal(t("panel.search", { n: 3 }), "Buscar en 3 mods");
    // A message the language doesn't have falls back to English.
    CATALOGS.es["test.only"] = undefined;
    CATALOGS.en["test.only"] = "Only in English, {n}";
    assert.equal(t("test.only", { n: 2 }), "Only in English, 2");
    delete CATALOGS.en["test.only"];
    delete CATALOGS.es["test.only"];
    // Arabic plurals use their own categories, and "other" when one is missing.
    setLanguage("ar");
    assert.ok(t("panel.search", { n: 11 }).includes("11"));
    // An unknown language is English.
    assert.equal(setLanguage("xx"), "en");
    assert.equal(t("btn.save"), "Save");
  } finally { setLanguage(was); }
});

test("the language comes from the browser or the terminal", () => {
  assert.equal(pickLanguage(["es-MX", "en"]), "es");
  assert.equal(pickLanguage(["nl", "de-AT"]), "de");
  assert.equal(pickLanguage(["pt-PT"]), "pt-BR");
  assert.equal(pickLanguage(["zh-CN"]), "zh-CN");
  assert.equal(pickLanguage(["zh-Hans"]), "zh-CN");
  assert.equal(pickLanguage(["zh-TW"]), "en", "Traditional Chinese is not Simplified");
  assert.equal(pickLanguage(["ja-JP"]), "ja");
  assert.equal(pickLanguage(["fa-IR"]), "fa");
  assert.equal(pickLanguage(["ar-EG"]), "ar");
  assert.equal(pickLanguage([]), "en");
  assert.equal(matchLanguage("ko"), "");
  assert.equal(languageFromEnv({ LANG: "es_ES.UTF-8" }), "es");
  assert.equal(languageFromEnv({ LANG: "en_US.UTF-8", LC_ALL: "fr_FR.UTF-8" }), "fr");
  assert.equal(languageFromEnv({ LANG: "C.UTF-8" }), "en");
  assert.equal(languageFromEnv({ LANG: "POSIX" }), "en");
  assert.equal(languageFromEnv({}), "en");
  assert.equal(languageFromEnv({ LANG: "de_DE.UTF-8", LANGUAGE: "ja:de" }), "ja");
  assert.equal(languageFromEnv({ LANG: "de_DE.UTF-8", MORSE_LANG: "fa" }), "fa");
  assert.ok(isRtl("fa") && isRtl("ar") && !isRtl("es") && !isRtl("ja"));
  assert.equal(englishName("ja"), "Japanese");
});

test("Settings offers every language, and Same as my computer by default", () => {
  assert.deepEqual(PREF_LANGUAGES, LANGUAGES.map(l => l.code));
  assert.equal(normalizePrefs({}).language, "");
  assert.equal(normalizePrefs({ language: "fa" }).language, "fa");
  assert.equal(normalizePrefs({ language: "klingon" }).language, "");
});

test("Ask and explanations are asked to answer in the person's language", async () => {
  const { buildMessages } = await import("../core/prompt.js");
  const ctx = { url: "https://example.com/", title: "Example", lang: "ja" };
  const ja = buildMessages({ request: "what is this page for?", context: ctx }).at(-1).content;
  assert.match(ja, /ANSWER[^\n]*Japanese/);
  const en = buildMessages({ request: "what is this page for?", context: { ...ctx, lang: "en" } }).at(-1).content;
  assert.doesNotMatch(en, /Japanese|ANSWER text in/);
});

// ---- the CLI in Spanish
const CLI = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../daemon/cli.js");
const run = (args, env) => new Promise(resolve => execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, timeout: 60000 }, (e, out, err) => resolve({ code: e?.code || 0, out: String(out) + String(err) })));

test("the CLI speaks the terminal's language (LANG=es)", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "morse-i18n-"));
  const env = { HOME: home, MORSE_HOME: path.join(home, ".morse"), LC_ALL: "", LC_MESSAGES: "", LANGUAGE: "", MORSE_LANG: "" };
  const es = await run(["mods"], { ...env, LANG: "es_ES.UTF-8" });
  assert.match(es.out, /Aún no hay mods/);
  const start = await run([], { ...env, LANG: "es_ES.UTF-8" });
  assert.match(start.out, /Te damos la bienvenida a Morse/);
  assert.match(start.out, /morse setup/, "commands stay as they are");
  const plain = await run(["mods"], { ...env, LANG: "C.UTF-8" });
  assert.match(plain.out, /No mods yet/);
});
