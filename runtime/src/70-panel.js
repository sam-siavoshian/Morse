// The Mods panel: every mod on this page, newest version first in mind.
//   - Refine opens the bar on a mod; History lists its versions (click one to
//     bring it back); Copy link puts a share link on the clipboard
//   - a saved mod that failed when it loaded says so in plain words, with Fix it
//   - search shows up past 6 mods; ↑/↓ move, Space turns a mod on or off,
//     Enter refines it

// ---- health: did a saved mod work when it loaded? applyMod (30-mods.js)
// reports each run; 5s later a mod whose watches matched nothing is flagged
// (core/kit.js __stats, through the host's "stats" request).
const Health = (() => {
  const WAIT = 5000;
  const st = new Map(); // id -> { state: "checking" | "ok" | "broken", reason, error }
  const changed = () => { if (!panel.hidden) renderPanel(); };
  function set(id, s) {
    clearTimeout(st.get(id)?.timer);
    st.set(id, s);
    changed();
  }
  function broken(id, reason, error) { set(id, { state: "broken", reason, error: String(error || reason) }); }
  function ran(m, r) {
    if (r && r.ok === false) return broken(m.id, modProblem(r.error), r.error);
    const was = st.get(m.id);
    clearTimeout(was?.timer);
    if (!m.js || !m.js.trim()) { st.delete(m.id); if (was?.state === "broken") changed(); return; }
    const s = { state: "checking" };
    s.timer = setTimeout(() => check(m.id, s), WAIT);
    st.set(m.id, s);
    if (was?.state === "broken") changed();
  }
  async function check(id, s) {
    if (st.get(id) !== s) return;
    let stats = null;
    try { stats = await call("stats", { modId: id }); } catch {} // an older host can't tell; assume fine
    if (st.get(id) !== s) return;
    if (stats?.paused) { st.delete(id); return Guard.heard(id, stats.paused); } // guard hook: the kit paused it (64-guard.js)
    const w = stats?.watches || [];
    if (stats?.error) return broken(id, modProblem(stats.error), stats.error);
    if (w.length && w.every(x => !x.total)) {
      const sel = w[0].selector;
      return broken(id, "It looks for a part of the page that isn't there right now.",
        `morse.watch(${JSON.stringify(sel)}) matched nothing on the page for ${WAIT / 1000} seconds` +
        (w.length > 1 ? `, and neither did ${w.slice(1).map(x => JSON.stringify(x.selector)).join(", ")}` : "") + ".");
    }
    st.set(id, { state: "ok" });
  }
  // The page may have changed since (an app that loads late, another route):
  // a mod flagged for finding nothing gets another look when the panel opens.
  async function recheck() {
    for (const [id, s] of st) {
      if (s.state !== "broken" || !/^morse\.watch/.test(s.error)) continue;
      const stats = await call("stats", { modId: id }).catch(() => null);
      if (stats?.watches?.some(x => x.total) && st.get(id) === s) { st.set(id, { state: "ok" }); changed(); }
    }
  }
  return { ran, recheck, get: id => st.get(id) };
})();

// Why a saved mod's own code failed, in plain words (the shared plainError in
// core/onboarding.js covers model and connection errors). The exact error goes to the model.
function modProblem(e) {
  const s = String(e || "").split("\n")[0].replace(/^(Uncaught )?([A-Z]\w*Error): /, "");
  if (/ is not defined/.test(s)) return "It uses something this page doesn't have.";
  if (/Cannot read propert(y|ies) of (null|undefined)|Cannot set propert(y|ies) of (null|undefined)|is null$|is undefined$/.test(s)) return "It expected a part of the page that isn't there.";
  if (/ is not a function/.test(s)) return "It uses something that doesn't work on this page.";
  if (/is not a valid selector/.test(s)) return "It has a mistake in how it finds things on the page.";
  if (/user scripts|Content Security Policy|unsafe-eval|blocks injected/i.test(s)) return explainError(s)?.text || s;
  return "It stopped with an error.";
}

// ---- the panel
const PanelUI = { q: "", hist: null, focus: null, back: null };
const SEARCH_AFTER = 6;

async function openPanel() {
  closeBar();
  applyTheme();
  if (panel.hidden) {
    const a = deepActive();
    PanelUI.back = a && a !== document.body && a !== document.documentElement && a !== hostEl ? a : null;
  }
  panel.hidden = false;
  await syncMods().catch(() => {});
  renderPanel();
  focusRow(PanelUI.focus ? rows().findIndex(r => r.dataset.id === PanelUI.focus) : 0);
  Health.recheck().catch(() => {});
}
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Mods on this page");
// Closing the panel gives focus back to the page, unless the bar took it.
new MutationObserver(() => {
  if (!panel.hidden) return;
  const back = PanelUI.back;
  PanelUI.back = null;
  if (!S.open && back?.isConnected) try { back.focus({ preventScroll: true }); } catch {}
}).observe(panel, { attributes: true, attributeFilter: ["hidden"] });

const rows = () => [...panel.querySelectorAll(".list article")];
function focusRow(i) {
  const list = rows();
  if (!list.length) return panel.querySelector(".search, [data-a=import]")?.focus({ preventScroll: true });
  const el = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i))];
  list.forEach(r => (r.tabIndex = r === el ? 0 : -1));
  PanelUI.focus = el.dataset.id;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest" });
}

function matches(m, q) {
  const hay = [m.title, m.prompt, m.refined, m.target?.label].filter(Boolean).join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function renderPanel() {
  const where = S.appName || location.host || "this page";
  const active = panel.contains(root.activeElement) ? root.activeElement : null;
  const keep = active && { search: active.classList.contains("search"), id: active.closest("article")?.dataset.id, a: active.dataset.a, row: active.tagName === "ARTICLE",
    sel: active.classList.contains("search") ? [active.selectionStart, active.selectionEnd] : null };
  const searchable = S.mods.length > SEARCH_AFTER;
  if (!searchable) PanelUI.q = "";
  panel.innerHTML = `
    <header><span class="mark">${radar(16)}</span><div><b>Mods</b><small>${esc(where)}</small></div><button data-a="close" title="Close" aria-label="Close">×</button></header>
    ${searchable ? `<div class="psearch"><input class="search" type="search" placeholder="Search ${S.mods.length} mods" aria-label="Search mods" spellcheck="false" autocomplete="off" value="${esc(PanelUI.q)}"></div>` : ""}
    <div class="list" role="list" aria-label="Mods"></div>
    <footer><button data-a="import">Install a mod…</button><span>${esc(S.label)}</span></footer>`;
  renderList();
  controlPanel(); // user control: pause, backup (63-control.js)
  if (!keep) return;
  if (keep.search) {
    const s = panel.querySelector(".search");
    if (s) { s.focus({ preventScroll: true }); if (keep.sel) s.setSelectionRange(...keep.sel); }
    return;
  }
  const art = keep.id && panel.querySelector(`article[data-id="${cssEsc(keep.id)}"]`);
  if (!art) return focusRow(0);
  const target = keep.row ? art : art.querySelector(`[data-a="${keep.a}"]`) || art;
  if (target === art) focusRow(rows().indexOf(art)); else target.focus({ preventScroll: true });
}

function renderList() {
  const list = panel.querySelector(".list");
  const mods = S.mods.filter(m => m.kind !== "style"); // your-style hook: Your style has its own row at the top
  const shown = PanelUI.q ? mods.filter(m => matches(m, PanelUI.q)) : mods;
  list.innerHTML = YourStyle.rowHtml() + (!mods.length // your-style hook (72-style.js)
    ? emptyModsHtml() /* onboarding hook: 59-onboarding.js */
    : shown.length ? shown.map(rowHtml).join("") : `<p class="empty">No mods match “${esc(PanelUI.q)}”.</p>`);
  list.insertAdjacentHTML("beforeend", gallerySectionHtml()); // gallery hook: Mods for this site (68-gallery.js)
  const r = rows();
  const i = Math.max(0, r.findIndex(a => a.dataset.id === PanelUI.focus));
  r.forEach((a, j) => (a.tabIndex = j === i ? 0 : -1));
  controlRows(); // user control: where each mod came from, Show code (63-control.js)
}

function rowHtml(m) {
  const h = m.enabled ? Health.get(m.id) : null;
  const broken = h?.state === "broken";
  const versions = versionsOf(m);
  const open = PanelUI.hist === m.id && versions.length;
  const changed = m.updated && m.created && m.updated !== m.created;
  const when = relativeTime(changed ? m.updated : m.created);
  const label = `${m.title}${m.enabled ? "" : ", off"}${broken ? ", not working" : ""}`;
  return `
      <article data-id="${esc(m.id)}" class="${m.enabled ? "" : "off"}${broken ? " broken" : ""}" role="listitem" tabindex="-1" aria-label="${esc(label)}">
        <label class="sw" title="${m.enabled ? "Turn off" : "Turn on"}"><input type="checkbox" data-a="toggle" tabindex="-1" aria-label="${esc(m.title)}" ${m.enabled ? "checked" : ""}><span></span></label>
        <div class="meta"><b>${esc(m.title)}</b><small>“${esc(m.prompt)}”</small>${m.refined ? `<small class="latest">Latest change: “${esc(m.refined)}”</small>` : ""}
          <div class="tags">${m.css.trim() ? "<span>style</span>" : ""}${m.js.trim() ? "<span>script</span>" : ""}${m.target ? `<span>${esc(m.target.label || "")}</span>` : "<span>whole page</span>"}${when ? `<em class="when">${changed ? "changed" : "added"} ${esc(when)}</em>` : ""}</div>
        </div>
        ${broken ? `<div class="health" role="status"><p><b>${esc(h.lead || "Not working." /* self-heal hook: 71-heal.js */)}</b> ${esc(h.reason)}</p><button class="primary" data-a="fix">Fix it</button></div>` : ""}
        ${guardRowHtml(m) /* guard hook: Paused because it was slowing this page down (64-guard.js) */}
        ${galleryRowHtml(m) /* gallery hook: Update available (68-gallery.js) */}
        ${healRowHtml(m) /* self-heal hook: Share the fix (71-heal.js) */}
        <div class="btns"><button data-a="refine">Change</button>${versions.length ? `<button data-a="history" aria-expanded="${open ? "true" : "false"}">History <em>${versions.length + 1}</em></button>` : ""}<button data-a="link">Copy link</button><button data-a="share">Share</button><button data-a="code">Edit code</button><button data-a="del">Delete</button></div>
        ${open ? versionsHtml(m, versions) : ""}
      </article>`;
}

function versionsHtml(m, vs) {
  const row = (n, prompt, time, i) => `<span class="vn">${n}</span><span class="vp">“${esc(prompt)}”</span><span class="vt">${esc(time)}</span>`;
  const items = [`<li class="cur" aria-current="true">${row(vs.length + 1, m.refined || m.prompt, "showing now")}</li>`];
  for (let i = vs.length - 1; i >= 0; i--) {
    items.push(`<li><button data-a="restore" data-v="${i}" title="Bring back version ${i + 1}">${row(i + 1, vs[i].prompt, relativeTime(vs[i].at) || "earlier")}</button></li>`);
  }
  return `<ol class="versions" aria-label="Versions of ${esc(m.title)}">${items.join("")}</ol><p class="vhint">Click a version to bring it back. The one showing now stays in this list.</p>`;
}

// ---- actions
async function toggleMod(m, on) {
  m.enabled = on;
  if (on) Guard.clear(m); // guard hook: turned back on by hand (64-guard.js)
  await call("mods.save", { mod: m });
  m.enabled ? await applyMod(m) : await removeMod(m.id);
  renderPanel();
}
async function restoreTo(m, i) {
  const v = versionsOf(m)[i];
  const next = restoreVersion(m, i);
  if (!v || next === m) return;
  const saved = (await call("mods.save", { mod: next })) || next;
  S.mods = S.mods.map(x => (x.id === m.id ? saved : x));
  if (saved.enabled) {
    if (!saved.js.trim()) await call("off", { modId: saved.id }).catch(() => {});
    await applyMod(saved);
  }
  renderPanel();
  toast(`Back to version ${i + 1} (“${v.prompt}”)`);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch {}
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  panel.append(ta);
  ta.select();
  const ok = document.execCommand?.("copy");
  ta.remove();
  if (!ok) throw new Error("this page blocks the clipboard");
}
async function copyLink(m, btn) {
  try {
    const r = await call("share", { mod: m, kind: "link" });
    await copyText(r.link);
    btn.textContent = "Copied";
    setTimeout(() => { if (btn.isConnected) btn.textContent = "Copy link"; }, 1600);
    toast(`Link copied. Anyone with Morse can install “${m.title}”.`);
  } catch (e) { console.warn("[morse] copy link", e); toast("Couldn't copy the link. Try Share instead."); }
}

panel.addEventListener("click", async e => {
  const art = e.target.closest("article");
  if (art) PanelUI.focus = art.dataset.id;
  const btn = e.target.closest("[data-a]");
  if (!btn) return;
  const a = btn.dataset.a;
  const m = S.mods.find(x => x.id === art?.dataset.id);
  if (a === "close") panel.hidden = true;
  if (a === "toggle" && m) await toggleMod(m, btn.checked);
  if (a === "del" && m) {
    const i = rows().indexOf(art);
    await removeMod(m.id);
    await call("mods.delete", { modId: m.id });
    S.mods = S.mods.filter(x => x !== m);
    renderPanel();
    focusRow(Math.min(i, rows().length - 1));
    toast(`Deleted “${m.title}”`);
  }
  if (a === "code" && m) showCode(m);
  if (a === "share" && m) showShare(m);
  if (a === "import") showImport();
  if (a === "refine" && m) refineMod(m);
  if (a === "fix" && m) fixMod(m, Health.get(m.id)?.error || "It stopped working.");
  if (a === "link" && m) copyLink(m, btn);
  if (a === "history" && m) { PanelUI.hist = PanelUI.hist === m.id ? null : m.id; renderPanel(); }
  if (a === "restore" && m) await restoreTo(m, +btn.dataset.v);
});

panel.addEventListener("input", e => {
  if (!e.target.classList.contains("search")) return;
  PanelUI.q = e.target.value;
  renderList();
});
// Keys inside the panel stay in the panel (the page never sees them).
for (const t of ["keyup", "keypress", "input"]) panel.addEventListener(t, e => e.stopPropagation());
panel.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.classList.contains("search")) {
    if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); focusRow(0); }
    return;
  }
  if (t.tagName !== "ARTICLE") return; // buttons inside a row work as buttons
  const list = rows(), i = list.indexOf(t);
  const m = S.mods.find(x => x.id === t.dataset.id);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const j = i + (e.key === "ArrowDown" ? 1 : -1);
    if (j < 0 && panel.querySelector(".search")) return panel.querySelector(".search").focus();
    focusRow(Math.min(Math.max(j, 0), list.length - 1));
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    focusRow(e.key === "Home" ? 0 : list.length - 1);
  } else if (e.key === " " && m) {
    e.preventDefault();
    toggleMod(m, !m.enabled);
  } else if (e.key === "Enter" && m) {
    e.preventDefault();
    refineMod(m);
  } else if (e.key.length === 1 && /\S/.test(e.key) && panel.querySelector(".search")) {
    panel.querySelector(".search").focus(); // just start typing to search
  }
});
