# Pairing Chrome with the Morse helper

The Morse extension uses models on this computer (Claude Code, Codex, keys
kept here) through the Morse helper on `127.0.0.1:7457`
([`daemon/bridge.js`](../../daemon/bridge.js)). Every request that uses the
model needs a token. There are two ways to get one:

| | How | Who offers it |
|---|---|---|
| **Ask** (one click) | The extension asks; the person clicks **Allow** on this computer | A helper started with an `ask` function: Morse Desktop (`health.ask` is `true`, `health.app` is `"desktop"`) |
| **Code** | The person types a 6-character code shown by `morse serve`, `morse pair` or Morse Desktop's **Show a code**, or the welcome page's own code waits in the helper after `morse setup --pair <code>` | Every helper |

The helper side of **Ask** is onboarding v2's, in `daemon/bridge.js`
(`createBridge({ app, ask })`). This page is the contract between it, the
extension and Morse Desktop. If the code and this page disagree, the code in
`daemon/bridge.js` wins; fix this page.

## The requests

All requests go to `http://127.0.0.1:<port>` (7457, or the test port in
`chrome.storage.local` `"morse.helperPort"`) from the extension, so Chrome
sends `Origin: chrome-extension://<extension id>`. JSON in, JSON out. The
poll is a POST because Chrome sends an extension's Origin on POST.

```
GET  /v1/health
→ 200 { ok, version, provider, model, label, …, app: "desktop" | "cli", ask: true | false, signedIn: { claude, codex } }

POST /v1/pair/ask                      Origin: chrome-extension://<id>, body {}
→ 202 { id, expires }                  the person is being asked (asking again while waiting returns the same id)
→ 403                                  no Origin, or not an extension
→ 404 { code: "no-ask" }               this helper can't ask (morse serve): use a code
→ 409                                  it is asking about another browser right now
→ 429                                  this extension was denied a moment ago; wait, then ask again

POST /v1/pair/ask/<id>                 the same Origin, body {}; poll about once a second
→ 200 { state: "waiting" }
→ 200 { state: "allowed", token }      once; send it as Authorization: Bearer <token> from then on
→ 200 { state: "denied" }
→ 404 { state: "expired" }             nobody answered in 2 minutes, or the answer was already read
→ 403                                  another extension's question
```

The token is stored hashed with the asking extension's origin, exactly like
a code-paired one, so `/v1/complete`, `/v1/warm`, `/v1/voice`,
`/v1/transcribe` and `/v1/style` work the same way with it.

## Morse Desktop's side

Morse Desktop starts the helper with `createBridge({ app: "desktop", ask })`
([`desktop-app/service.js`](../../desktop-app/service.js) `askAllow`). The
helper calls `ask({ origin, label, words, signal })` when Chrome asks; Morse
Desktop brings its window forward and shows `words.message` (“Allow Chrome to
use your Claude Code?”) with **Allow** and **Deny**. The words are Morse's own (`askWords` in `daemon/bridge.js`): the only thing filled in is the model's label from this computer's settings, the browser is always “Chrome”, and nothing the extension sends (the request body isn't read) reaches them. Allow resolves `true`,
Deny or Esc resolves `false`, and `signal` aborting (nobody answered in time)
closes the question as a Deny. Turning **Let Chrome use Morse** off answers
whatever waits with Deny.

The question is answered only from Morse Desktop's own window: its IPC
accepts `answerAsk` from that page alone, and web content can't drive the
window ([How Morse works](architecture.md#morse-desktop-desktop-app)).

## What keeps it safe

- **Only the extension can ask**: requests need an Origin of
  `chrome-extension://<32 letters a-p>`. Web pages can't ask or read answers;
  programs without an Origin can't ask.
- **Only from this computer**: the helper listens on 127.0.0.1 and refuses
  Host headers other than `127.0.0.1`, `localhost` and `[::1]` (DNS rebinding).
- **Only a person makes the token**, by clicking Allow in Morse Desktop.
- **Bound to the extension that asked**: only that origin can read the
  answer, the token is handed out once, and it is stored hashed with that
  origin.
- **No question spam**: one question at a time, a pause after Deny, two
  minutes per question.
- **Sign out browsers** in Morse Desktop (or `morse unpair`) removes every token.

The question shows the asking extension's id in small print. Another
extension the person installed could still ask; the wording (“Allow it only if you
set up Morse in Chrome a moment ago”) is what stands between that and a click. A code
doesn't have that question: the person carries it over.

## Opening Morse Desktop from Chrome

When the helper doesn't answer, the welcome page can link to `morse://open`.
That starts Morse Desktop (or shows its window) and carries nothing else.

## Tests

- `tests/desktop-app.test.js`: Morse Desktop's `ask`: shown, Allow, Deny,
  timeout, helper off.
- `tests/desktop-app-ui.test.js`: the real window answering a real request
  (when the helper in the checkout can ask).
- The helper's side is tested with onboarding v2 (`tests/bridge.test.js`).
