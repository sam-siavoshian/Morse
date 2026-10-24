// Prompt history, per app (desktop) or per site (web), newest last, capped at
// 50 (core/prefs.js pushHistory). ↑/↓ in an empty input walk it, shell-style:
// keep pressing while the text is an untouched history entry.
// Stored by the host (history.get / history.add); an older host falls back
// to this page's localStorage.

const PromptHistory = (() => {
  let list = [], loadedFor = "", idx = -1;
  const scope = () => S.app || location.host || "page";
  const lsKey = sc => `morse:history:${sc}`;

  async function load() {
    const sc = scope();
    if (sc === loadedFor) return;
    loadedFor = sc;
    try { list = (await call("history.get", { scope: sc })) || []; }
    catch { try { list = JSON.parse(localStorage.getItem(lsKey(sc)) || "[]"); } catch { list = []; } }
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
  return { load, add, browse, edited, reset, entries: () => list.slice() };
})();
