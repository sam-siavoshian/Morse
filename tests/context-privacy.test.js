// What the model is sent about a page (runtime/src/20-context.js, through
// core/prompt.js) never carries input values, secrets or email addresses, even
// though the context now includes CSS rules, inline styles and a layout tree.
// Also: the context reaches into open shadow roots and same-origin frames.
import "./helpers/home.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMessages } from "../core/prompt.js";
import { noBrowser, launchBrowser } from "./helpers/browser.js";

const skip = noBrowser;
const SRC = readFileSync(new URL("../runtime/src/20-context.js", import.meta.url), "utf8");
let browser, page;

const SECRETS = {
  password: "hunter2-Correct-Horse",
  card: "4111 1111 1111 1111",
  cardExpiry: "12/29",
  cvc: "737",
  hidden: "q8Zt3kLm9Pw2Xr7Vb4Nc1Hd6",
  csrfInUrl: "u7YtR4eW2qA9sD1f",
  typed: "my secret draft",
  prefilled: "prefilled-account-number-99812",
  textarea: "Dear landlord, my new code is 4471",
  email: "sam.rivera@example.org",
  email2: "billing@acme.io",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  apiKey: "sk-ant-api03-AbCdEf0123456789GhIjKl",
  session: "XYZ123secretSession",
  styleToken: "Zx81Lq0Pw9Mn27Ks55Rt",
};

const PAGE = `<!doctype html><title>Billing</title>
<body style="background:#fff">
<header><a href="/reset?token=${SECRETS.csrfInUrl}">Reset password</a> Signed in as ${SECRETS.email}</header>
<form id="pay" data-owner="${SECRETS.email2}" style="background:url(/bg.png?sig=${SECRETS.styleToken})">
  <label>Password <input type="password" name="pw" value="${SECRETS.password}"></label>
  <label>Card <input autocomplete="cc-number" name="cardnumber" value="${SECRETS.card}"></label>
  <label>Expiry <input autocomplete="cc-exp" value="${SECRETS.cardExpiry}"></label>
  <label>CVC <input autocomplete="cc-csc" value="${SECRETS.cvc}"></label>
  <input type="hidden" name="csrf" value="${SECRETS.hidden}" data-x="${SECRETS.hidden}">
  <label>Account <input name="acct" value="${SECRETS.prefilled}"></label>
  <label>Note <input id="note" placeholder="Add a note"></label>
  <textarea name="msg">${SECRETS.textarea}</textarea>
  <div data-token="${SECRETS.jwt}" data-key="${SECRETS.apiKey}">Paid by card ending 1111</div>
  <button type="submit">Pay now</button>
</form>
<x-panel></x-panel>
<script>
  customElements.define("x-panel", class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = '<style>.k{color:red}</style><p class="k">Key ${SECRETS.apiKey}</p><button part="go">Go</button>'; }
  });
</script>
</body>`;

before(async () => {
  if (skip) return;
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route("http://app.test/**", r => r.fulfill({ contentType: "text/html", body: PAGE }));
  await page.goto(`http://app.test/account?session=${SECRETS.session}&tab=billing`);
  await page.fill("#note", SECRETS.typed); // typed after load: the live value
});
after(() => browser?.close());

const contextFor = sel => page.evaluate(`(() => {
  const S = { app: null, target: ${JSON.stringify(sel)} ? document.querySelector(${JSON.stringify(sel || "x")}) : null };
  ${SRC}
  return context();
})()`);

test("no input values, secrets or emails reach the prompt", { skip }, async () => {
  for (const sel of ["#pay", null, "header"]) {
    const ctx = await contextFor(sel);
    const prompt = buildMessages({ request: "make this bigger", context: ctx }).map(m => m.content).join("\n");
    for (const [what, value] of Object.entries(SECRETS)) {
      assert.ok(!prompt.includes(value), `${what} (${value}) leaked with target ${sel}`);
    }
    if (sel === "#pay") {
      // What the model needs is still there.
      assert.match(prompt, /Pay now/);
      assert.match(prompt, /name="csrf"/, "hidden inputs keep their name");
      assert.match(prompt, /autocomplete="cc-number"/);
      assert.match(prompt, /placeholder="Add a note"/);
      assert.match(prompt, /\[email\]/);
    }
  }
});

test("the redact helper scrubs strings, cloned elements and objects", { skip }, async () => {
  const out = await page.evaluate(`(() => {
    const S = { app: null, target: null };
    ${SRC}
    const el = document.createElement("div");
    el.innerHTML = '<input type="password" value="pw1"><input type="checkbox" value="yes"><input type="submit" value="Send"><textarea>hello</textarea><a href="https://x.test/cb?code=abc&state=1">go</a>';
    redact(el);
    return {
      html: el.innerHTML,
      text: redact("mail me at a.b@c.co, card 4242 4242 4242 4242, order 1234 5678 9012 3456, Bearer abcdefghijklmnop1234"),
      obj: redact({ a: ["x@y.org"], b: { c: "?api_key=zzz" }, n: 3 }),
    };
  })()`);
  assert.equal(out.html, '<input type="password"><input type="checkbox" value="yes"><input type="submit" value="Send"><textarea></textarea><a href="https://x.test/cb?code=[redacted]&amp;state=[redacted]">go</a>');
  assert.equal(out.text, "mail me at [email], card [card], order 1234 5678 9012 3456, Bearer [token]", "Luhn: only card-like numbers");
  assert.deepEqual(out.obj, { a: ["[email]"], b: { c: "?api_key=[redacted]" }, n: 3 });
});

test("the context reaches into open shadow roots and same-origin frames", { skip }, async () => {
  const ctx = await contextFor(null);
  assert.match(ctx.notes, /Web components with open shadow roots: <x-panel>/);
  assert.match(ctx.notes, /parts: go/);
  assert.match(ctx.layout, /x-panel \(.*shadow root/);
  assert.match(ctx.outline, /x-panel >>> button\[part="go"\]|x-panel >>> button/);
  const inside = await page.evaluate(`(() => {
    const S = { app: null, target: document.querySelector("x-panel").shadowRoot.querySelector("button") };
    ${SRC}
    return context().target;
  })()`);
  assert.equal(inside.selector.split(" >>> ")[0], "body > x-panel");
  assert.match(inside.facts, /inside the open shadow root of <x-panel>/);
  assert.match(inside.facts, /x-panel::part\(go\)/);
});
