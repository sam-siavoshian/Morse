# Pairing Chrome with the Morse helper

The Morse extension uses models on this computer (Claude Code, Codex, keys
kept here) through the Morse helper on `127.0.0.1:7457`
([`daemon/bridge.js`](../../daemon/bridge.js)). Every request that uses the
model needs a token. There are two ways to get one:

| | How | Who offers it |
|---|---|---|
| **Ask** (one click) | The extension asks; the person clicks **Allow** in Morse Desktop | Morse Desktop's helper (`health.ask` is `true`) |
| **Code** | The person types a 6-character code shown by `morse serve`, `morse pair` or Morse Desktop's **Show a code**; or the welcome page's own code waits in the helper after `morse setup --pair <code>` | Every helper |

This page is the contract for the extension side of **Ask**.
[`daemon/pair-ask.js`](../../daemon/pair-ask.js) is the helper side, and
[`tests/pair-ask.test.js`](../../tests/pair-ask.test.js) checks it.

## Ask: the requests

All requests go to `http://127.0.0.1:<port>` (7457, or the test port in
`chrome.storage.local` `"morse.helperPort"`), from the extension's service
worker or pages, so Chrome sends `Origin: chrome-extension://<extension id>`.
JSON in, JSON out.

### 1. Can this helper ask?

```
GET /v1/health
→ 200 { ok, version, provider, model, label, harnesses, paired, pairing, ask: true }
```

`ask: true` means a person can answer in Morse Desktop. `ask: false` (or no
`ask`, an older helper, or `morse serve`) means use a code.

### 2. Ask to connect

```
POST /v1/pair/ask
Origin: chrome-extension://<id>
(body ignored; send {})

→ 202 { "id": "<request id>", "status": "waiting", "expires": <ms since epoch> }
→ 403 { "error": "Only the Morse extension can ask to connect." }   no Origin, or not chrome-extension://
→ 429 { "error": "Morse is already asking. Answer it in Morse Desktop first." }   three requests already waiting
```

Morse Desktop shows **“Allow Chrome to use your Claude Code?”** (or Codex,
your API key) with **Allow** and **Deny**, and brings its window forward.
Asking again while a request from the same extension is waiting returns that
same request; it doesn't ask the person twice. A request ends after 2 minutes
(`expires`).

### 3. Wait for the answer

Poll about once a second until the status isn't `waiting`:

```
GET /v1/pair/ask/<id>
Origin: chrome-extension://<id>   (the same extension that asked)

→ 200 { "status": "waiting", "expires": … }
→ 200 { "status": "allowed", "token": "<token>" }   only once; the request is gone after this
→ 200 { "status": "denied" }                          the person clicked Deny (or Esc)
→ 404 { "status": "gone", "error": "…" }              ended: expired, cancelled, already read, or not yours
```

Keep the token the way a code-paired token is kept (`chrome.storage.local`)
and send it as `Authorization: Bearer <token>` on `/v1/complete`, `/v1/warm`,
`/v1/voice` and `/v1/transcribe`, exactly as today.

### 4. Stop asking (optional)

If the page that asked closes or the person cancels in Chrome:

```
DELETE /v1/pair/ask/<id>
Origin: chrome-extension://<id>
→ 200 { "status": "cancelled" }
```

Morse Desktop then closes its question.

## What keeps it safe

- **Only the extension can ask.** The helper refuses any Origin that isn't
  `chrome-extension://<32 letters a-p>`, so web pages can't ask (and can't
  read answers). Requests with no Origin (curl, other programs) can't ask
  either.
- **Only from this computer.** The helper listens on 127.0.0.1, refuses
  connections from other addresses, and refuses Host headers that aren't
  `127.0.0.1`, `localhost` or `[::1]` (DNS rebinding).
- **Only a person makes the token.** The token is created when Allow is
  clicked in Morse Desktop's own window, and in no other way. Morse Desktop's
  window can't be driven by web content (see [How Morse works](architecture.md#morse-desktop-desktop-app)).
- **Bound to the extension that asked.** Only that origin can read the
  answer, and the token is stored hashed with that origin: another extension
  can't use it. It is handed out once.
- **Few and short.** One waiting request per extension, three in all, two
  minutes each. Asking again doesn't stack prompts.
- **Signing out** (Morse Desktop's **Sign out browsers**, or `morse unpair`)
  removes every token.

What the person sees names the extension's id in small print, so a second
extension asking is noticeable. Another extension the person installed could
still ask; the prompt's wording ("Allow it if you just set up Morse in
Chrome") is what stands between that and a click. Codes don't have this
question: they need the person to carry the code over.

## In the extension

A sketch of what the welcome page or popup does:

```js
const base = "http://127.0.0.1:7457";
const health = await (await fetch(`${base}/v1/health`)).json();
if (health.ask) {
  const { id } = await (await fetch(`${base}/v1/pair/ask`, { method: "POST", body: "{}" })).json();
  // Show "Click Allow in Morse Desktop."
  for (;;) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await fetch(`${base}/v1/pair/ask/${id}`);
    if (r.status === 404) break;                 // ended: offer to ask again
    const a = await r.json();
    if (a.status === "allowed") { /* store a.token */ break; }
    if (a.status === "denied") { /* "Morse Desktop said no." */ break; }
  }
} else {
  // Show the code flow (morse setup --pair, or type the helper's code).
}
```

To start Morse Desktop when the helper doesn't answer, the page can link to
`morse://open`. That only opens Morse Desktop's window; the link carries
nothing else.
