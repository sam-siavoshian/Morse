// Prompt history, per app (desktop) or per site (web), newest last, capped at
// 50 (core/prefs.js pushHistory). ↑/↓ in an empty input walk it, shell-style:
// keep pressing while the text is an untouched history entry.
// Stored by the host (history.get / history.add); an older host falls back
// to this page's localStorage.

const PromptHistory = (() => {
  let list = [], loadedFor = "", idx = -1, pending = null, ticket = 0;
  const scope = () => S.app || location.host || "page";
  const lsKey = sc => `morse:history:${sc}`;

  // One request per scope. A second load() while the first is still out
  // (boot and opening the bar both ask) waits for that same answer, instead
  // of returning with the list still empty.
  function load() {
    const sc = scope();
    if (sc === loadedFor) return pending || Promise.resolve();
    loadedFor = sc;
    pending = call("history.get", { scope: sc })
      .then(l => { if (scope() === sc) list = Array.isArray(l) ? l : []; })
      .catch(() => {
        if (scope() !== sc) return;
        try { list = JSON.parse(localStorage.getItem(lsKey(sc)) || "[]"); } catch { list = []; }
      })
      .finally(() => { if (loadedFor === sc) pending = null; });
    return pending;
  }
  function add(text) {
    const sc = scope();
    list = pushHistory(list, text);
    idx = -1;
    call("history.add", { scope: sc, text })
      .then(l => { if (Array.isArray(l) && scope() === sc) list = l; })
      .catch(() => { try { localStorage.setItem(lsKey(sc), JSON.stringify(list)); } catch {} });
  }
  // dir -1 = older (↑), +1 = newer (↓). Returns true when it handled the key.
  // A key that arrives while the list is still on its way is kept and applied
  // when the answer lands, so the first ↑ after open is not lost.
  function browseKey(dir) {
    if (scope() === loadedFor && !pending) return browse(dir);
    const mine = ++ticket;
    load().then(() => { if (mine === ticket) browse(dir); });
    return true;
  }
  function browse(dir) {
    const browsing = idx !== -1;
    if (browsing ? input.value !== list[idx] : input.value !== "") return false;
    if (dir < 0) {
      if (!list.length) return false;
      idx = browsing ? Math.max(0, idx - 1) : list.length - 1;
    } else {
      if (!browsing) return false;
      idx++;
      if (idx >= list.length) { idx = -1; setInput(""); return true; }
    }
    setInput(list[idx]);
    return true;
  }
  // Typing over an entry ends browsing.
  function edited() { if (idx !== -1 && input.value !== list[idx]) idx = -1; }
  function reset() { idx = -1; }
  return { load, add, browse, browseKey, edited, reset, entries: () => list.slice() };
})();
