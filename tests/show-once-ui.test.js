// Show me once, end to end in real Chromium: the real runtime on the Postbox
// mail demo site (demo/sites/mail) with a stand-in host running the real
// engine against the demo model (core/showonce-demo.js answers for a recorded
// flow). The user does the task by hand, the strip lists the steps, Stop
// hands them to the bar, and what they ask for becomes a working mod: the
// same steps for every unread email, or on a shortcut. Also the recording
// rules: hidden values, only the user's own events on this page, only while
// the strip shows, Esc cancels, nothing sent until Send.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openSite } from "../demo/show-once-page.js";
import { axeCheck, axeLines } from "../demo/axe.js"; // axe-core on Morse's own UI (tests/a11y-morse.test.js)
import { readStatus } from "./helpers/wait.js";
import { OPEN_KEY } from "./helpers/keys.js";

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {}
const skip = !chromium && "playwright not installed";
let browser;
before(async () => { if (!skip) browser = await chromium.launch(); });
after(() => browser?.close());

async function scenario(fn) {
  const t = await openSite(browser, "mail");
  try { await fn(t); assert.deepEqual(t.errors, []); }
  finally { await t.ctx.close(); }
}
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { if (Date.now() > end) throw e; }
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + fn);
    await new Promise(r => setTimeout(r, 40));
  }
}
const status = readStatus; // read fresh, never the state from before the last key or click
const sent = page => page.evaluate(() => window.__sent);
const words = page => page.locator(".so-strip .so-w").allInnerTexts();
const unread = page => page.locator('.r9[data-unread="true"]').count();
const mods = page => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("morse:a11y-host:mods") || "{}")));
async function startFromChip(page) {
  await page.keyboard.press(OPEN_KEY);
  await page.locator(".more").click();
  await page.locator('[data-m="showonce"]').click();
  await page.locator(".so-strip").waitFor();
  await until(async () => !(await status(page)).open); // the bar steps aside; the page is theirs
}
async function stopAndAsk(page, request) {
  await page.locator(".so-strip [data-so=stop]").click();
  await until(async () => (await status(page)).open);
  await page.keyboard.type(request);
  await page.keyboard.press("Enter");
  await until(async () => (await status(page)).phase === "result", 30000);
}

test("Show me once: do it by hand, say “every unread email”, and a button does it for all of them", { skip }, () => scenario(async ({ page }) => {
  // The way in: More keeps optional workflows out of the request row.
  await page.keyboard.press(OPEN_KEY);
  await page.locator(".more").click();
  assert.equal((await page.locator('[data-m="showonce"]').innerText()).trim(), "Show me once");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await startFromChip(page);
  assert.match(await page.locator(".so-strip").innerText(), /Do the task by hand, once/);
  assert.equal(await unread(page), 4);

  // The user does it: open Leo's unread email, archive it. The page really reacts.
  await page.locator(".r9", { hasText: "Leo Martins" }).click();
  await page.locator(".rd .acts button", { hasText: "Archive" }).click();
  assert.deepEqual(await words(page), ["Click “Leo Martins”", "Click “Archive”"]);
  assert.match(await page.locator(".so-head").innerText(), /2 steps/);
  assert.equal(await unread(page), 3);
  // Nothing has left the page: no model request, no step in any message.
  assert.equal((await sent(page)).some(m => m.type === "generate" || JSON.stringify(m).includes("Leo Martins")), false);

  // Stop: the bar opens with the steps and what people usually ask for.
  await page.locator(".so-strip [data-so=stop]").click();
  await until(async () => (await status(page)).open);
  assert.equal(await page.locator(".so-strip").isHidden(), true);
  assert.deepEqual(await page.locator(".so-card .so-w").allInnerTexts(), ["Click “Leo Martins”", "Click “Archive”"]);
  assert.deepEqual(axeLines(await axeCheck(page)), [], "axe-core: the steps in the bar");
  assert.deepEqual((await page.locator(".sugs .sug").allInnerTexts()).map(s => s.replace(/\n/g, "").trim()), ["Add a button", "Add a shortcut…", "Do it to every…"]);
  assert.equal(await page.locator("textarea.in").getAttribute("placeholder"), "What should Morse do with these steps?");
  assert.match((await status(page)).hint, /Say what Morse should do with these steps/);

  // "Do it to every…" fills the start of the request.
  await page.locator(".sugs .sug", { hasText: "Do it to every" }).click();
  await until(async () => (await status(page)).input === "Do these steps to every ");
  await page.keyboard.type("unread email");
  await page.keyboard.press("Enter");
  await until(async () => (await status(page)).phase === "result", 30000);
  assert.match((await status(page)).hint, /Archive every unread email/);
  assert.equal(await page.locator(".so-card").isHidden(), true, "the list folds away while there's a result");

  // The model got the steps as structured context: order, selectors, labels, the list item.
  const gen = (await sent(page)).find(m => m.type === "generate");
  assert.equal(gen.request, "Do these steps to every unread email");
  const steps = gen.context.recording.steps;
  assert.deepEqual(steps.map(s => [s.n, s.do, s.label]), [[1, "click", "Leo Martins"], [2, "click", "Archive"]]);
  assert.equal(steps[0].item.selector, "div.lst > div.r9");
  assert.equal(steps[0].item.attrs["data-unread"], "true");
  assert.deepEqual([steps[1].selector, steps[1].text], ['section[aria-label="Reading pane"] button', "Archive"]);

  // It's live: the button counts the unread emails and archives every one.
  const btn = page.locator(".morse-so-btn");
  await until(async () => /Archive every unread email \(3\)/.test(await btn.innerText()));
  await btn.click();
  // (Opening an email marks it read a moment before Archive takes it away: wait for the end.)
  await until(async () => /Done for 3 unread emails/.test(await page.evaluate(() => document.body.innerText)), 15000);
  assert.equal(await unread(page), 0);
  assert.equal(await page.locator(".r9").count(), 6, "read emails stay");

  // Save keeps it like any mod; the steps go with the bar.
  await page.locator(".actions [data-a=keep]").click();
  await until(async () => (await mods(page)).length === 1);
  assert.equal((await mods(page))[0].title, "Archive every unread email");
  // The host has it; the bar closes when its answer comes back. The hotkey
  // pressed before that would close the still-open bar instead of opening it.
  await until(async () => { const s = await status(page); return !s.open && s.phase === "idle"; });
  assert.equal(await page.locator(".so-card").isHidden(), true);
  await page.keyboard.press(OPEN_KEY);
  await page.locator(".more").click();
  await page.locator('[data-m="showonce"]').waitFor();
  assert.equal(await page.locator(".so-card").isHidden(), true, "a new bar starts without old steps");
  assert.equal((await page.locator('[data-m="showonce"]').count()), 1);
}));

test("Show me once from the ⋯ menu, on a shortcut: Ctrl+Shift+A archives whatever email is open", { skip }, () => scenario(async ({ page }) => {
  await page.locator(".r9", { hasText: "GitHub" }).click(); // open an email first
  await page.keyboard.press(OPEN_KEY);
  await page.locator(".bar .more").focus();
  await page.keyboard.press("Enter");
  const item = page.locator(".bmenu [data-m=showonce]");
  assert.equal((await item.innerText()).trim(), "Show me once");
  assert.equal(await page.locator(".bmenu [data-m=showonce] .caps").count(), 0, "no shortcut shown, not even Off");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.querySelector("[data-morse-ui]").shadowRoot.activeElement?.dataset.m), "showonce", "optional workflows are reachable with arrow keys");
  await page.keyboard.press("Enter");
  await page.locator(".so-strip").waitFor();
  await page.locator(".rd .acts button", { hasText: "Archive" }).click();
  assert.deepEqual(await words(page), ["Click “Archive”"]);
  await stopAndAsk(page, "do this when I press Ctrl+Shift+A");
  assert.match((await status(page)).hint, /Archive with Ctrl\+Shift\+A/);
  await page.locator(".actions [data-a=keep]").click();
  await until(async () => !(await status(page)).open);

  await page.locator(".r9", { hasText: "Northwind Billing" }).click();
  await page.keyboard.press("Control+Shift+A");
  await until(async () => (await page.locator(".r9", { hasText: "Northwind Billing" }).count()) === 0);
  assert.equal(await page.locator(".r9").count(), 8);
  assert.match(await page.locator(".rd").innerText(), /Conversation archived/);
}));

test("Recording rules: hidden values, only the user's own events on this page, only while the strip shows; Esc cancels", { skip }, () => scenario(async ({ page }) => {
  // A sign-in and checkout form, and a frame, added to the page for this test.
  await page.evaluate(() => {
    document.querySelector(".rd").insertAdjacentHTML("afterbegin", `<form id="f" onsubmit="event.preventDefault(); window.__submitted = 1">
      <label>Email <input name="email"></label> <label>Password <input type="password" name="pw"></label>
      <input autocomplete="cc-number" aria-label="Card number">
      <label>Shipping <select name="ship"><option>Standard</option><option>Express</option></select></label>
      <label><input type="checkbox" name="gift"> Gift wrap</label> <button id="pagebtn" type="button">Apply</button></form>
      <iframe id="fr" srcdoc="<button>Inside a frame</button>" style="height:40px"></iframe>`);
  });
  // Before the strip shows, nothing is recorded.
  await page.locator("#pagebtn").click();
  await startFromChip(page);
  await page.locator("[name=email]").click();
  await page.keyboard.type("sam@example.com");
  await page.locator("[name=pw]").click();
  await page.keyboard.type("hunter2-secret");
  await page.locator("[aria-label='Card number']").fill("4242 4242 4242 4242");
  await page.locator("[name=ship]").focus();
  await page.keyboard.press("ArrowDown"); // a real choice (selectOption's events are made up, so not recorded)
  await page.locator("text=Gift wrap").click(); // the label: one step, the box turned on
  await page.locator("[name=email]").press("Enter");
  // Not recorded: clicks the page's own script makes, clicks in a frame, clicks on Morse.
  await page.evaluate(() => { document.getElementById("pagebtn").click(); document.getElementById("pagebtn").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await page.frameLocator("#fr").locator("button").click();
  await page.locator(".so-strip .so-head b").click();
  assert.equal(await page.locator(".so-strip .so-count").innerText(), "6 steps", (await page.locator(".so-strip").innerText()));
  await page.locator(".so-strip").evaluate(s => s.querySelector(".so-steps").scrollIntoView());
  // The strip shows the last four; the model gets all of them.
  assert.deepEqual(await words(page), ["Type (hidden) in “Card number”", "Choose “Express” in “Shipping”", "Turn on “Gift wrap”", "Press Enter in “Email”"]);
  assert.match(await page.locator(".so-more").innerText(), /2 earlier steps/);
  // Remove a step the user didn't mean.
  await page.locator(".so-strip li:last-child").hover();
  await page.locator(".so-strip li:last-child [data-so=remove]").click();
  assert.equal(await page.locator(".so-strip .so-count").innerText(), "5 steps");
  await page.locator(".so-strip [data-so=stop]").click();
  await until(async () => (await status(page)).open);
  assert.deepEqual(await page.locator(".so-card .so-w").allInnerTexts(), ["Type “sam@example.com” in “Email”", "Type (hidden) in “Password”",
    "Type (hidden) in “Card number”", "Choose “Express” in “Shipping”", "Turn on “Gift wrap”"]);
  // Only on Send does anything leave, and never a hidden value.
  assert.equal((await sent(page)).some(m => m.type === "generate"), false);
  await page.keyboard.type("add a button that does this");
  await page.keyboard.press("Enter");
  await until(async () => (await status(page)).phase === "result", 30000);
  const all = JSON.stringify(await sent(page));
  assert.doesNotMatch(all, /hunter2|4242/);
  const steps = (await sent(page)).find(m => m.type === "generate").context.recording.steps;
  assert.deepEqual(steps.map(s => [s.do, s.hidden || false]), [["type", false], ["type", true], ["type", true], ["choose", false], ["check", false]]);
  assert.equal(steps[0].value, "sam@example.com");
  assert.equal(steps[0].selector, 'input[name="email"]');
  // Undo; the next recording is cancelled with Esc and leaves nothing.
  await page.locator(".actions [data-a=undo]").click();
  await until(async () => !(await status(page)).open);
  await startFromChip(page);
  await page.locator("#pagebtn").click();
  assert.deepEqual(await words(page), ["Click “Apply”"]);
  await page.keyboard.press("Escape");
  await until(async () => page.locator(".so-strip").isHidden());
  assert.match(await page.locator(".toast").innerText(), /Cancelled\. No steps were saved/);
  assert.equal((await status(page)).open, false);
  await page.locator("#pagebtn").click(); // after: not recorded, nowhere to show
  await page.keyboard.press(OPEN_KEY);
  assert.equal(await page.locator(".so-card").isHidden(), true);
  // Opening the bar while recording is the same as Stop.
  await page.keyboard.press("Escape");
  await startFromChip(page);
  await page.locator("#pagebtn").click();
  await page.keyboard.press(OPEN_KEY);
  await until(async () => (await page.locator(".so-card .so-w").allInnerTexts()).join() === "Click “Apply”");
}));
