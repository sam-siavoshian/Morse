// One iteration of realistic use, the same in the extension and in a desktop
// app (the runtime is the same; only the host differs). Every step plays the
// user through the real UI (keys, clicks, drags) and waits on the runtime's
// debug status, never on fixed sleeps where a condition exists.
import { pressOpen } from "../../tests/helpers/keys.js";
import { sleep } from "./lib.js";

const STATUS = page => page.evaluate(() => JSON.parse(document.querySelector("[data-morse-ui]")?.dataset.status || "null"));
const ui = (page, sel) => page.locator(`[data-morse-ui] ${sel}`);
const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

export async function until(page, pred, what, ms = 20000) {
  const end = Date.now() + ms;
  let s;
  for (;;) {
    try { s = await STATUS(page); if (s && pred(s)) return s; } catch {}
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}; last ${JSON.stringify(s && { phase: s.phase, open: s.open, pane: s.pane, hint: s.hint?.slice(0, 80) })}`);
    await sleep(30);
  }
}
const visible = (page, sel) => ui(page, sel).first().isVisible().catch(() => false);

// The three demo sites: where to point, what to ask, what to edit.
export const SITES = {
  parley: { path: "/demo/sites/parley/", point: '.msg[data-role="assistant"] p', ask: "show a live word count under the message box", edit: ".f3n", hide: ".m2q span", once: ["nav a >> nth=1", "nav a >> nth=2"], spa: true },
  byte: { path: "/demo/sites/byte/", point: "article h1", ask: "hide the ads and make it easier to read", edit: "article h1", hide: "article p >> nth=1", once: [".tb a >> nth=0", ".tb a >> nth=1"], spa: true },
  tunes: { path: "/demo/sites/tunes/", point: '[data-testid="album-grid"]', ask: "make the album covers bigger and round", edit: ".q8c >> nth=1", hide: ".q8c >> nth=11", once: ['[data-testid="play-pause"]', '[data-testid="play-pause"]'], spa: true, gallery: true },
};

// Back to a quiet page: no menu, pane, panel, modal or bar.
export async function quiet(page) {
  for (let k = 0; k < 6; k++) {
    const s = await STATUS(page).catch(() => null);
    const extra = await page.evaluate(() => {
      const r = document.querySelector("[data-morse-ui]")?.shadowRoot;
      if (!r) return false;
      const shown = sel => [...r.querySelectorAll(sel)].some(e => !e.hidden && e.getClientRects().length);
      return shown(".panel") || shown(".modal") || shown(".so-strip") || shown(".gl-trial") || shown(".gm-menu");
    }).catch(() => false);
    if (s && !s.open && !extra) return;
    if (s?.phase === "working") { await until(page, x => x.phase !== "working", "the change to finish", 30000).catch(() => {}); continue; }
    if (await visible(page, ".so-strip")) { await ui(page, ".so-strip [data-so=cancel]").click().catch(() => {}); continue; }
    if (await visible(page, ".gl-trial")) { await ui(page, ".gl-trial [data-gl=remove]").click().catch(() => {}); await sleep(200); continue; }
    if (await visible(page, ".modal")) { await page.keyboard.press("Escape"); await sleep(80); continue; }
    if (await visible(page, ".panel")) { await ui(page, ".panel header [data-a=close]").click().catch(() => page.keyboard.press("Escape")); continue; }
    await page.keyboard.press("Escape");
    await sleep(60);
  }
}

async function openBar(page) {
  const s = await STATUS(page);
  if (s?.open) return;
  await pressOpen(page);
  await until(page, s => s.open, "the bar to open");
}

async function pointAt(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`nothing to point at: ${sel}`);
  const x = box.x + Math.min(box.width / 2, 40), y = box.y + Math.min(box.height / 2, 14);
  await page.mouse.move(x - 30, y - 10);
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.click(x, y);
  await until(page, s => /Describe what to change about this/.test(s.hint) || s.focus === "in", "the target to be picked", 5000);
}

// open, point, generate, refine, then Save or Undo (alternating by `i`)
export async function generate(page, site, i, steps) {
  let ok = true;
  ok = await steps.run("open bar", () => openBar(page)) && ok;
  ok = ok && await steps.run("point", () => pointAt(page, site.point));
  ok = ok && await steps.run("generate", async () => {
    await page.keyboard.type(site.ask, { delay: 2 });
    await page.keyboard.press("Enter");
    const s = await until(page, s => s.phase === "result" || s.phase === "error", "the result", 60000);
    if (s.phase !== "result") throw new Error(`no result: ${s.hint}`);
  });
  ok = ok && await steps.run("refine", async () => {
    await page.keyboard.type(i % 4 < 2 ? "make it smaller" : "make it bigger", { delay: 2 });
    await page.keyboard.press("Enter");
    await until(page, s => s.phase === "working" || /version 2/.test(s.hint), "the refine to start", 10000).catch(() => {});
    const s = await until(page, s => s.phase === "result" || s.phase === "error", "the refined result", 60000);
    if (s.phase !== "result") throw new Error(`refine failed: ${s.hint}`);
  });
  await steps.run(i % 2 ? "undo" : "save", async () => {
    if (!ok) return;
    if (i % 2) await ui(page, ".actions [data-a=undo]").click();
    else await page.keyboard.press("Enter"); // empty input: keep
    await until(page, s => !s.open && s.phase === "idle", i % 2 ? "the undo" : "the save", 15000);
  });
  await quiet(page);
}

// The Mods panel: turn the newest mod off and on again; delete the oldest
// ones past `keep` (a person tidying up) so saved mods don't pile up.
export async function modsPanel(page, steps, keep = 6) {
  await steps.run("mods panel", async () => {
    await openBar(page);
    await ui(page, ".actions [data-a=mods]").click();
    await ui(page, ".panel:not([hidden])").waitFor({ timeout: 10000 });
    const rows = ui(page, ".panel .list article[data-id]");
    const n = await rows.count();
    if (n) {
      await rows.first().locator("label.sw").click();
      await sleep(150);
      await ui(page, ".panel .list article[data-id]").first().locator("label.sw").click();
      await sleep(150);
    }
    for (let k = n; k > keep; k--) {
      const last = ui(page, ".panel .list article[data-id]").last();
      await last.locator("[data-a=del]").click();
      await sleep(120);
    }
    await ui(page, ".panel header [data-a=close]").click();
    await ui(page, ".panel").waitFor({ state: "hidden", timeout: 5000 });
  });
  await quiet(page);
}

// Settings, then Help, from the ⋯ menu; Escape closes each.
export async function settingsAndHelp(page, steps) {
  await steps.run("settings + help", async () => {
    await openBar(page);
    await ui(page, ".bar .more").click();
    await ui(page, ".bmenu [data-m=settings]").click();
    await until(page, s => s.pane === "settings", "the settings pane", 5000);
    await page.keyboard.press("Escape"); // the pane closes, the bar stays
    await until(page, s => !s.pane && s.open, "the settings pane to close", 5000);
    await ui(page, ".bar .more").click();
    await ui(page, ".bmenu [data-m=help]").click();
    await until(page, s => s.pane === "help", "the help pane", 5000);
    await page.keyboard.press("Escape");
    await until(page, s => !s.pane, "the pane to close", 5000);
  });
  await quiet(page);
}

// Show me once: start from the ⋯ menu, click two things, Stop, then close.
export async function showOnce(page, site, steps) {
  await steps.run("show me once", async () => {
    await openBar(page);
    await ui(page, ".bar .more").click();
    await ui(page, ".bmenu [data-m=showonce]").click();
    await ui(page, ".so-strip").waitFor({ timeout: 5000 });
    for (const sel of site.once) { // things a person clicks: links and buttons
      const b = await page.locator(sel).first().boundingBox();
      if (b) await page.mouse.click(b.x + Math.min(10, b.width / 2), b.y + Math.min(8, b.height / 2));
      await sleep(80);
    }
    await ui(page, ".so-strip [data-so=stop]").click();
    await until(page, s => s.open, "the bar with the steps", 5000);
  });
  await quiet(page);
}

// The edit tools: recolor and move one thing, undo both, redo the color (kept
// as a "Direct edits" mod), then in a new session hide another thing and
// undo / redo / undo that with the keys.
export async function editTools(page, site, i, steps) {
  await steps.run("edit tools", async () => {
    await openBar(page);
    const target = page.locator(site.edit).first();
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const b = await target.boundingBox();
    if (!b) throw new Error("nothing to edit");
    await page.mouse.move(b.x + 6, b.y + 6, { steps: 3 });
    await page.mouse.click(b.x + 6, b.y + 6);
    await ui(page, ".gm [data-t=color]").waitFor({ timeout: 5000 });
    await ui(page, ".gm [data-t=color]").click();
    await ui(page, '.gm [data-c="#3b82f6"]').click();
    await ui(page, ".gm [data-t=move]").click();
    const r = await target.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + 24, r.y + r.height / 2 + 6, { steps: 4 });
    await page.mouse.up();
    // (a drag that didn't move, or a swatch that matched, leaves less to undo)
    for (const t of ["undo", "undo", "redo"]) if (await ui(page, `.gm [data-t=${t}]`).isEnabled().catch(() => false)) await ui(page, `.gm [data-t=${t}]`).click();
    // hide something else, then undo / redo / undo with the keys
    await quiet(page);
    await openBar(page);
    await page.locator(site.hide).first().scrollIntoViewIfNeeded().catch(() => {});
    const h = await page.locator(site.hide).first().boundingBox();
    if (!h) throw new Error("nothing to hide");
    await page.mouse.move(h.x + 4, h.y + 4, { steps: 3 });
    await page.mouse.click(h.x + 4, h.y + 4);
    await ui(page, ".gm [data-t=hide]").click();
    await page.keyboard.press(`${PRIMARY}+z`);
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await page.keyboard.press(`${PRIMARY}+z`); // the hidden thing comes back
  });
  await quiet(page);
}

// Page tools: dark mode on, text bigger, dark mode off, text back.
export async function pageTools(page, steps) {
  await steps.run("page tools", async () => {
    for (const k of ["dark", "bigger", "dark", "smaller"]) {
      await openBar(page);
      await ui(page, ".gm-qbtn").click();
      await ui(page, `.gm-menu [data-k=${k}]`).click();
      await sleep(150);
    }
  });
  await quiet(page);
}

// Mods for this site: Try it on a gallery mod, then Undo.
export async function galleryTry(page, steps) {
  await steps.run("gallery try it", async () => {
    await openBar(page);
    await ui(page, ".actions [data-a=mods]").click();
    await ui(page, ".panel:not([hidden])").waitFor({ timeout: 10000 });
    const item = ui(page, ".panel .gl-item [data-gl=try]").first();
    if (!(await item.isVisible().catch(() => false))) {
      await ui(page, ".panel .gl-show").first().click({ timeout: 8000 });
    }
    await item.click({ timeout: 8000 });
    await ui(page, ".modal .card [data-a=install]").click({ timeout: 8000 });
    await ui(page, ".gl-trial").waitFor({ timeout: 10000 });
    await ui(page, ".gl-trial [data-gl=remove]").click();
    await ui(page, ".gl-trial").waitFor({ state: "hidden", timeout: 10000 });
  });
  await quiet(page);
}

// In-page navigation (an SPA route change), back again.
export async function spaNav(page, i, steps) {
  await steps.run("spa navigate", async () => {
    await page.evaluate(n => { history.pushState({}, "", `${location.pathname}?route=${n}`); dispatchEvent(new PopStateEvent("popstate")); }, i);
    await sleep(1100); // the runtime checks the URL once a second
    await page.evaluate(() => history.back());
    await sleep(300);
  });
}

// Everything, in the order a person might do it. Full loads and reloads are
// left to the scenario (which tab, how often).
// SOAK_ONLY=edit,page (names below) runs just those, every time: for
// working on one step.
const ONLY = (process.env.SOAK_ONLY || "").split(",").filter(Boolean);
const want = (name, every) => (ONLY.length ? ONLY.includes(name) : every);
export async function iteration(page, site, i, steps, { gallery = true } = {}) {
  page.setDefaultTimeout(8000);
  await quiet(page);
  if (want("generate", true)) await generate(page, site, i, steps);
  if (want("mods", i % 2 === 0)) await modsPanel(page, steps);
  if (want("spa", true)) await spaNav(page, i, steps);
  if (want("settings", i % 3 === 0)) await settingsAndHelp(page, steps);
  if (want("showonce", i % 5 === 0)) await showOnce(page, site, steps);
  if (want("edit", true)) await editTools(page, site, i, steps);
  if (want("page", i % 2 === 1)) await pageTools(page, steps);
  if (want("gallery", gallery && site.gallery && i % 2 === 0)) await galleryTry(page, steps);
}
