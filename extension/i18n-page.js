// Extension pages (popup, options, welcome, practice) in the person's
// language: Settings → Language from the bar's settings (bar-host.js keeps
// them in chrome.storage.sync, or local), else the browser's own language.
// Importing this reads that language's words from the package (English is
// built in), then translates the page's data-i18n elements before the page's
// own script runs (core/i18n.js translatePage); the script then uses t().
import { setLanguage, pickLanguage, translatePage, loadLanguage, setLanguageLoader } from "./core/i18n.js";
import { normalizePrefs } from "./core/prefs.js";
import { packagedWords } from "./words.js";

setLanguageLoader(packagedWords);
let stored;
try { stored = (await chrome.storage.sync.get("morse.settings"))["morse.settings"]; } catch {}
if (stored === undefined) try { stored = (await chrome.storage.local.get("morse.settings"))["morse.settings"]; } catch {}
export const lang = setLanguage(await loadLanguage(normalizePrefs(stored).language || pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language])));
translatePage(document);
