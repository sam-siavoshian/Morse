// The words of a language besides English: locales/<code>.json in the
// extension's own package (scripts/build.js writes them), read only when that
// language is chosen. The worker and the extension's pages use it
// (setLanguageLoader in core/i18n.js); the bar on a page asks the worker
// ("i18n.words" in background.js). Nothing is fetched from anywhere else.
export async function packagedWords(code) {
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(code) || code === "en") return null;
  const r = await fetch(chrome.runtime.getURL(`locales/${code}.json`));
  return r.ok ? r.json() : null;
}
