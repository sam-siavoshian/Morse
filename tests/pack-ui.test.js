// Mod packs, end to end in real Chromium with the real desktop connector (CDP)
// as the host: make a pack in the Mods panel and copy its link, install it
// through the pack review (untick one, a clash asks Keep both or Replace
// yours, a mod for every website starts unticked), the pack's mods grouped
// under its name with one switch, and a pack from an address: Check this
// address for updates, then Update available and the update review.
import { tempDir } from "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { launchBrowser, noBrowser, chromium } from "./helpers/browser.js";
import { TIMEOUT, waitForReady } from "./helpers/wait.js";
import { freePort } from "./helpers/net.js";

const skip = noBrowser;
const home = process.env.MORSE_HOME;
let browser, page, server, port, connector, running;
let served = null, packHits = 0;
const ui = sel => page.locator(`[data-morse-ui] ${sel}`);
const modFile = id => path.join(home, "mods", `${id}.json`);
const readMod = async id => JSON.parse(await fs.readFile(modFile(id), "utf8"));
const exists = p => fs.access(p).then(() => true, () => false);
const writeMod = m => fs.writeFile(modFile(m.id), JSON.stringify(m, null, 2));
async function until(fn, ms = TIMEOUT) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await page.waitForTimeout(40); }
  throw new Error("timed out waiting for " + fn);
}
const now = new Date().toISOString();
const own = (id, extra = {}) => ({ morse: 1, id, title: id, prompt: `make ${id}`, css: "", js: "", enabled: true, model: "demo", created: now, updated: now, match: { hosts: [`127.0.0.1:${port}`], app: null }, ...extra });

async function openPanel() {
  if (await ui(".panel").isVisible()) return;
  await page.keyboard.press("Alt+Shift+KeyM");
  await ui(".panel .list").waitFor();
}
async function closeModal() { if (await ui(".modal").isVisible()) await ui(".modal .card header [data-a=close]").click(); }

before(async () => {
  if (skip) return;
  await fs.mkdir(path.join(home, "mods"), { recursive: true });
  await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ welcome: false, gallery: false }));
  await fs.writeFile(path.join(home, "onboarding.json"), JSON.stringify({ coach: "done", tips: { saved: true, share: true }, dismissed: { model: true } }));
  port = await freePort();
  server = http.createServer((req, res) => {
    if (req.url.startsWith("/team.morse-pack.json")) {
      packHits++;
      if (!served) return res.writeHead(404).end("no");
      return res.writeHead(200, { "Content-Type": "application/json", ETag: `"${served.length}"` }).end(served);
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><title>Team board</title>
      <h1 id="title">Team board</h1><p class="lede">Today's work</p><input id="box"><div class="cards"><div class="card">One</div><div class="card">Two</div></div>`);
  }).listen(port, "127.0.0.1");
  await new Promise(r => server.on("listening", r));
  // Three mods of your own on this site, one of them for every website.
  await writeMod(own("big-title", { title: "Bigger title", css: "#title { font-size: 48px !important; }" }));
  await writeMod(own("count-keys", { title: "Count keys", js: "let n = 0; morse.on(document, 'keydown', () => { n++; });" }));
  await writeMod(own("calm-all", { title: "Calmer everywhere", css: ".lede { letter-spacing: 1px; }", match: { hosts: ["*"], app: null } }));

  const cdp = await freePort();
  browser = await launchBrowser({ args: [`--remote-debugging-port=${cdp}`] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => localStorage.setItem("morse:debug", "1"));
  page = await ctx.newPage();
  page.on("pageerror", e => console.log("pageerror", e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  const { Connector } = await import("../daemon/connector.js");
  connector = new Connector({ port: cdp, app: null, settings: { provider: "demo", model: "demo" }, log: () => {} });
  running = connector.run();
  await waitForReady(page);
});
after(async () => {
  await connector?.stop().catch(() => {});
  await running;
  await browser?.close();
  server?.close();
});

let link = "";

test("Make a pack…: choose mods in the Mods panel, name it, add a note, copy its link", { skip }, async () => {
  await openPanel();
  await ui(".panel .pmore summary").click(); // under the panel's More (docs/dev/simplify.md)
  await ui(".panel [data-pk=make]").click();
  await ui(".panel .pk-pickbar").waitFor();
  assert.match(await ui(".panel .pk-pickbar").textContent(), /Choose mods for the pack.*None chosen yet/s);
  assert.equal(await ui(".panel .pk-pickbar [data-pk=next]").isDisabled(), true, "Next waits for a choice");
  assert.equal(await ui(".panel .list .pk-sel").count(), 3, "a tick on every mod");
  for (const id of ["big-title", "count-keys", "calm-all"]) await ui(`.panel article[data-id="${id}"] [data-pk=sel]`).check();
  assert.match(await ui(".panel .pk-pickbar").textContent(), /3 chosen/);
  // While choosing, Space ticks a row instead of turning the mod off.
  await ui('.panel article[data-id="count-keys"]').focus();
  await page.keyboard.press(" ");
  assert.equal(await ui('.panel article[data-id="count-keys"] [data-pk=sel]').isChecked(), false);
  assert.equal((await readMod("count-keys")).enabled, true, "the mod itself stays on");
  await page.keyboard.press(" ");
  await ui(".panel .pk-pickbar [data-pk=next]").click();

  const card = ui(".modal .card");
  await card.waitFor();
  assert.match(await card.locator("header").textContent(), /Make a pack/);
  assert.deepEqual(await card.locator(".pk-list b").allTextContents(), ["Bigger title", "Calmer everywhere", "Count keys"], "in the order the panel lists them");
  await card.locator("[data-pk=link]").click();
  assert.match(await card.locator(".pk-err").textContent(), /Give the pack a name/);
  await card.locator("[data-pk=name]").fill("Team <b>board</b>");
  await card.locator("[data-pk=note]").fill("What the board team uses every day");
  await card.locator("[data-pk=link]").click();
  await card.locator(".pk-link:not([hidden]) input").waitFor();
  link = await card.locator(".pk-link input").inputValue();
  assert.match(link, /\/share\/install\.html#m=[\w-]+$/);
  await card.locator("[data-pk=file]").click();
  await until(async () => /Saved to/.test(await card.locator(".pk-err").textContent()));
  const file = path.join(home, "exports", "team-b-board-b.morse-pack.json");
  const pack = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(pack.morse, "morse-pack");
  assert.equal(pack.name, "Team <b>board</b>");
  assert.equal(pack.note, "What the board team uses every day");
  assert.deepEqual(pack.mods.map(m => m.id), ["big-title", "calm-all", "count-keys"]);
  assert.ok(pack.mods.every(m => m.enabled === undefined && m.history === undefined), "nothing about this computer goes in a pack");
  await closeModal();
  await ui(".panel .pk-pickbar").waitFor({ state: "detached" });
});

test("Installing a pack: one review for every mod, untick some, a clash asks, nothing installs before Install", { skip }, async () => {
  // As on a teammate's computer: two of the three aren't there, and one of
  // their own mods has the same id as a mod in the pack.
  await fs.rm(modFile("big-title"));
  await fs.rm(modFile("calm-all"));
  await writeMod(own("count-keys", { title: "My own counter", css: ".card { outline: 1px solid; }" }));
  await page.reload();
  await waitForReady(page);
  await openPanel();
  await ui(".panel footer [data-a=import]").click();
  await ui(".modal [data-k=src]").fill(link);
  await ui(".modal [data-a=go]").click();
  const card = ui(".modal .card.pk-card");
  await card.waitFor().catch(async e => { throw new Error(`${e.message}\ntoast: ${await ui(".toast").textContent()}`); });
  assert.match(await card.locator("header").textContent(), /Install the pack “Team <b>board<\/b>”\?.*3 mods.*Nothing is installed until you press Install/s);
  assert.equal(await card.locator("header b b").count(), 0, "the name is text, never markup");
  assert.match(await card.locator(".pk-note").textContent(), /What the board team uses every day/);
  const item = id => card.locator(`.pk-item[data-pkid="${id}"]`);
  assert.equal(await card.locator(".pk-item").count(), 3);
  assert.match(await item("big-title").textContent(), /Bigger title.*For 127\.0\.0\.1.*Changes how the page looks/s);
  assert.match(await item("count-keys").textContent(), /Reads what you type/);
  assert.equal(await item("count-keys").locator('[data-s="typing"]').count(), 1, "a note for reading what you type");
  assert.match(await item("count-keys").locator(".pk-clash").textContent(), /You already have this mod: “My own counter”/);
  assert.equal(await item("count-keys").locator('[data-pk-as="copy"]').getAttribute("aria-checked"), "true", "Keep both unless you choose");
  assert.match(await item("calm-all").locator('[data-s="everywhere"]').textContent(), /runs on every website you visit.*Not ticked/s);
  assert.equal(await item("calm-all").locator("[data-pk=pick]").isChecked(), false, "a mod for every website starts unticked");
  assert.equal(await item("big-title").locator(".ctl-code pre").count(), 1, "Show code for each mod");
  assert.equal(await card.locator("[data-pk=install]").textContent(), "Install 2");
  assert.equal(await card.locator("footer [data-a=close]").evaluate(b => b === b.getRootNode().activeElement), true, "Cancel has the focus, not Install");
  // Untick one: the count follows.
  await item("big-title").locator("[data-pk=pick]").uncheck();
  assert.equal(await card.locator("[data-pk=install]").textContent(), "Install 1");
  await item("big-title").locator("[data-pk=pick]").check();
  await item("count-keys").locator('[data-pk-as="copy"]').click();
  assert.equal(await exists(modFile("big-title")), false, "nothing before Install");
  await card.locator("[data-pk=install]").click();
  await until(() => exists(modFile("count-keys-2")));
  const a = await readMod("big-title"), b = await readMod("count-keys-2"), mine = await readMod("count-keys");
  assert.equal(mine.title, "My own counter", "your own mod is never overwritten without asking");
  assert.equal(b.title, "Count keys");
  for (const m of [a, b]) {
    assert.equal(m.importedFrom, "pack");
    assert.equal(m.pack.name, "Team <b>board</b>");
    assert.equal(m.enabled, true);
  }
  assert.equal(b.pack.mod, "count-keys", "remembers which mod of the pack it is");
  assert.equal(await exists(modFile("calm-all")), false, "unticked: not installed");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("title")).fontSize === "48px");
});

test("The Mods panel groups a pack's mods under its name, with one switch for the pack", { skip }, async () => {
  await openPanel();
  const group = ui(".panel .pk-group");
  await group.waitFor();
  assert.match(await group.locator(".pk-meta").textContent(), /Team <b>board<\/b>.*Pack · 2 mods here/s);
  assert.deepEqual(await group.locator("article").evaluateAll(a => a.map(x => x.dataset.id).sort()), ["big-title", "count-keys-2"]);
  assert.equal(await ui('.panel .list > article[data-id="count-keys"]').count(), 1, "your own mod stays outside the pack");
  assert.match(await group.locator('article[data-id="big-title"]').textContent(), /From the pack “Team <b>board<\/b>”/);
  // The pack's switch turns all of it off, and back on.
  await group.locator(".pk-head label.sw").click();
  await until(async () => (await readMod("big-title")).enabled === false && (await readMod("count-keys-2")).enabled === false);
  assert.equal((await readMod("count-keys")).enabled, true, "only the pack");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("title")).fontSize !== "48px");
  await ui(".panel .pk-group.off").waitFor();
  await ui(".panel .pk-group .pk-head label.sw").click();
  await until(async () => (await readMod("big-title")).enabled === true);
  await page.waitForFunction(() => getComputedStyle(document.getElementById("title")).fontSize === "48px");
  // The off switch works as usual on pack mods.
  await page.keyboard.press("Alt+Shift+Digit0");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("title")).fontSize !== "48px");
  await openPanel();
  await until(async () => /not running/.test(await ui(".panel .pk-group .pk-meta").textContent()));
  await page.keyboard.press("Alt+Shift+Digit0");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("title")).fontSize === "48px");
  // Each mod keeps its own switch.
  await ui('.panel .pk-group article[data-id="count-keys-2"] label.sw').click();
  await until(async () => (await readMod("count-keys-2")).enabled === false);
  assert.equal((await readMod("big-title")).enabled, true);
  assert.equal(await ui(".panel .pk-group [data-pk=toggle]").isChecked(), true, "the pack is on while any of it is");
});

test("A pack from an address: you choose to get updates; a change shows Update available and what changed", { skip }, async () => {
  const v1 = {
    morse: "morse-pack", version: 1, id: "board-team", name: "Board team", note: "From the team repo",
    mods: [
      { morse: 1, id: "lede", title: "Quiet lede", prompt: "make the lede quieter", css: ".lede { opacity: .7; }", js: "", match: { hosts: [`127.0.0.1:${port}`], app: null } },
      { morse: 1, id: "cards", title: "Card borders", prompt: "add borders to cards", css: ".card { border: 1px solid #999; }", js: "", match: { hosts: [`127.0.0.1:${port}`], app: null } },
    ],
  };
  served = JSON.stringify(v1);
  const address = `http://127.0.0.1:${port}/team.morse-pack.json`;
  await closeModal();
  await openPanel();
  await ui(".panel footer [data-a=import]").click();
  await ui(".modal [data-k=src]").fill(address);
  await ui(".modal [data-a=go]").click();
  const card = ui(".modal .card.pk-card");
  await card.waitFor();
  assert.match(await card.locator("header").textContent(), /Install the pack “Board team”\?/);
  const sub = card.locator("[data-pk=sub]");
  assert.equal(await sub.isChecked(), false, "getting updates is your choice, never the default");
  assert.match(await card.locator(".pk-sub").textContent(), /Check this address for updates.*At most once a day/s);
  await sub.check();
  await card.locator("[data-pk=install]").click();
  await until(() => exists(modFile("cards")));
  assert.equal((await readMod("cards")).pack.url, address);
  const saved = JSON.parse(await fs.readFile(path.join(home, "packs.json"), "utf8"));
  assert.ok(saved.subs[address], "the subscription is kept");
  const hits = packHits;

  // Opening the panel again the same day doesn't fetch the pack again.
  await ui(".panel [data-a=close]").click();
  await openPanel();
  await ui('.panel .pk-group[data-pack="board-team"]').waitFor();
  await page.waitForTimeout(300);
  assert.equal(packHits, hits, "checked at most once a day");
  assert.match(await ui('.panel .pk-group[data-pack="board-team"] .pk-meta').textContent(), /gets updates/);

  // The team changes the pack: one mod changes, one is new, one is gone.
  served = JSON.stringify({ ...v1, mods: [
    { ...v1.mods[0], css: ".lede { opacity: .5; }\n.lede::before { content: \"Note: \"; }", js: "fetch('https://stats.example/hit');", match: { hosts: [`127.0.0.1:${port}`, "stats.example"], app: null } },
    { morse: 1, id: "fresh", title: "Fresh title", prompt: "underline the title", css: "#title { text-decoration: underline; }", js: "", match: { hosts: [`127.0.0.1:${port}`], app: null } },
  ] });
  // A day later (the cache says it was last checked long ago).
  const subs = JSON.parse(await fs.readFile(path.join(home, "packs.json"), "utf8"));
  subs.subs[address].cache.fetchedAt = Date.now() - 2 * 864e5;
  await fs.writeFile(path.join(home, "packs.json"), JSON.stringify(subs));
  await ui(".panel [data-a=close]").click();
  await openPanel();
  const upd = ui('.panel .pk-group[data-pack="board-team"] .pk-upd');
  await upd.waitFor();
  assert.equal(packHits, hits + 1);
  assert.match(await upd.textContent(), /Update available\. 1 changed, 1 new, 1 removed/);
  assert.equal((await readMod("lede")).css, ".lede { opacity: .7; }", "nothing changes on its own");
  assert.equal(await exists(modFile("fresh")), false);
  await upd.locator("[data-pk=update]").click();
  const rev = ui(".modal .card.pk-card");
  await rev.waitFor();
  assert.match(await rev.locator("header").textContent(), /Update “Board team”\?.*Nothing changes until you press Update/s);
  assert.match(await rev.textContent(), /Changed.*Quiet lede.*New in the pack.*Fresh title.*No longer in the pack.*Card borders/s);
  const changed = rev.locator('.pk-item[data-kind="change"]');
  assert.match(await changed.textContent(), /Now also:.*Sends data to another website/s);
  assert.match(await changed.locator('[data-s="wider"]').textContent(), /also run on stats\.example/);
  assert.match(await changed.locator(".gl-diff").first().textContent(), /opacity: \.7.*opacity: \.5/s);
  assert.match(await rev.locator('.pk-item[data-kind="remove"]').textContent(), /Untick it to keep it as your own mod/);
  // Keep the removed one as your own; take the rest.
  await rev.locator('.pk-item[data-kind="remove"] [data-pk=pick]').uncheck();
  await rev.locator("[data-pk=apply]").click();
  await until(async () => (await readMod("lede")).css.includes(".5"));
  const lede = await readMod("lede");
  assert.deepEqual(lede.match.hosts, [`127.0.0.1:${port}`, "stats.example"]);
  assert.equal(lede.history.at(-1).css, ".lede { opacity: .7; }", "the old version is in History");
  assert.ok(await exists(modFile("fresh")));
  const cards = await readMod("cards");
  assert.equal(cards.pack, undefined, "kept as your own mod");
  await until(async () => (await ui('.panel .pk-group[data-pack="board-team"] .pk-upd').count()) === 0);

  // Stop updates: the mods stay.
  await ui('.panel .pk-group[data-pack="board-team"] [data-pk=unsub]').click();
  await until(async () => !JSON.parse(await fs.readFile(path.join(home, "packs.json"), "utf8")).subs[address]);
  assert.ok(await exists(modFile("lede")));
});

test("A hostile pack link: too many mods, or a name with markup, can't do harm", { skip }, async () => {
  const { encodeShareText } = await import("../core/mod.js");
  const many = { morse: "morse-pack", version: 1, id: "lots", name: "Lots", mods: Array.from({ length: 60 }, (_, i) => ({ morse: 1, id: `m${i}`, title: "x", prompt: "x", css: "", js: "", match: { hosts: ["*"], app: null } })) };
  await closeModal();
  await openPanel();
  await ui(".panel footer [data-a=import]").click();
  await ui(".modal [data-k=src]").fill(await encodeShareText(JSON.stringify(many)));
  await ui(".modal [data-a=go]").click();
  await until(async () => /up to 50 from one pack/.test(await ui(".toast").textContent()));
  await closeModal();
  await openPanel();
  const evil = { morse: "morse-pack", version: 1, id: "evil", name: "<img src=x onerror=\"window.__pwned=1\">‮evil", mods: [
    { morse: 1, id: "x1", title: "<script>window.__pwned=2</script>", prompt: "<img src=y onerror=\"window.__pwned=3\">", css: "", js: "", match: { hosts: [`127.0.0.1:${port}`], app: null }, history: [{ css: "body{display:none}", js: "", prompt: "old" }] },
  ] };
  await ui(".panel footer [data-a=import]").click();
  await ui(".modal [data-k=src]").fill(JSON.stringify(evil));
  await ui(".modal [data-a=go]").click();
  const card = ui(".modal .card.pk-card");
  await card.waitFor();
  assert.match(await card.locator("header b").textContent(), /<img src=x onerror="window.__pwned=1"> evil/);
  assert.equal(await card.locator("img, script").count(), 0);
  await card.locator("[data-pk=install]").click();
  await until(() => exists(modFile("x1")));
  assert.equal((await readMod("x1")).history, undefined, "History never comes in with a pack");
  await openPanel();
  await ui('.panel .pk-group[data-pack="evil"]').waitFor();
  assert.equal(await ui(".panel img, .panel script").count(), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});
