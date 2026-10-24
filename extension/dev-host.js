// For people working on Morse, never in a store build (MORSE_STORE=1): after
// `npm run build`, a Chrome profile that already has Morse keeps running the
// old service worker until the extension is reloaded, while new pages may get
// the new files. scripts/build.js writes one id into this worker and into
// build-id.txt; when the file on disk no longer matches, Morse was rebuilt
// under this worker. The bar says so (hello's `rebuilt`, runtime/src/97-boot.js)
// and so does the worker's console.

const BUILD_ID = globalThis.MORSE_BUILD_ID || ""; // "" in a store build: nothing below runs

let stale = false, checkedAt = 0;
export async function rebuilt() {
  if (!BUILD_ID) return false;
  if (stale || Date.now() - checkedAt < 1000) return stale;
  checkedAt = Date.now();
  try {
    const r = await fetch(chrome.runtime.getURL("build-id.txt"), { cache: "no-store" });
    const id = r.ok ? (await r.text()).trim() : "";
    stale = !!id && id !== BUILD_ID; // no file: a build is being written right now
  } catch {}
  if (stale) console.warn("[morse] Morse was rebuilt (npm run build). Reload it in chrome://extensions to run the new code.");
  return stale;
}

rebuilt();
