// The words of the languages besides English, read from core/locales/ when
// one is needed: for the CLI and the desktop connector (Node), the tests, and
// the website's pages (the share page, Try it here). Importing this is enough:
// loadLanguage() (core/i18n.js) then finds them.
import { LANGUAGES, setLanguageLoader } from "./i18n.js";

// A language's catalog, or null for English (built in) and codes Morse doesn't have.
export async function readWords(code) {
  if (code === "en" || !LANGUAGES.some(l => l.code === code)) return null;
  return (await import(`./locales/${code}.js`)).default;
}
setLanguageLoader(readWords);
