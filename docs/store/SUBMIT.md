# Submitting Morse to the Chrome Web Store

Step by step, from a clean checkout to "Pending review". Everything to paste
is in [listing.md](listing.md); every file to upload is in this folder or in
`dist/` after step 2.

## 1. Before you start

These have to be true first. The first two will get the item rejected or
stuck if they aren't.

- [ ] **The privacy policy is online.** Open
  https://sam-siavoshian.github.io/RRAA/site/privacy.html in a private window.
  If it's a 404, GitHub Pages isn't on yet:
  1. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub
     Actions**.
  2. Push to `main` (or run the **Pages** workflow by hand from the Actions
     tab). The workflow builds `dist/pages` and fails if
     `site/privacy.html` is out of date with `docs/privacy.md`.
  3. Load the address again. `https://sam-siavoshian.github.io/RRAA/privacy.html`
     also works once Pages is on (it sends people to `site/privacy.html`),
     but give the store the `site/` address: it's the page itself.

  The same deploy publishes the gallery list and the share page
  (`/RRAA/share/install.html`), which the extension uses.
- [ ] **`morse-cli` is on npm.** The description and the welcome page tell
  people to install the Morse helper with `npm install -g morse-cli`, then
  run `morse setup`. Today `npm view morse-cli` says 404. Publish it
  (`npm publish` from the repo; `files` in `package.json` already lists what
  ships) before the listing goes live, or a reviewer who follows the
  description will hit an error. People with an API key don't need it.
- [ ] **The developer account is ready:** the one-time fee is paid, the
  contact email is verified, the Google account has 2-Step Verification on
  (the dashboard won't publish without it), and the trader / non-trader
  declaration in **Account** is filled in (required for the EU).

## 2. Build and check the zip

```bash
git switch main && git pull
npm ci
npm run check && npm test             # DISPLAY=:99 on a machine without a screen
npm run store                         # prints the zip's path and SHA-256
DISPLAY=:99 npm run store:smoke       # the zip, unpacked, in a fresh profile
```

`npm run store` writes `dist/morse-extension-0.2.0-store.zip`. Write down the
SHA-256 it prints; it tells you later which build is in the store. Upload
**that** zip, not `dist/morse-extension-0.2.0.zip` (`npm run
package:extension` makes that one from the test build, which trusts a local
test address).

`store:smoke` should end with "clean: no errors or warnings from the
extension".

## 3. Create the item

1. Open https://chrome.google.com/webstore/devconsole.
2. **Items → New item** (top right), and upload
   `dist/morse-extension-0.2.0-store.zip`.
3. The dashboard reads the manifest: name **Morse**, version **0.2.0**, and
   the summary. If it complains about the manifest, stop: something is wrong
   with the build.

Then fill in the tabs on the left. **Save draft** often.

## 4. Store listing tab

| Field | What to put |
|---|---|
| Description | The **Description** block from listing.md |
| Category | **Make Chrome Yours → Functionality & UI** (older form: **Productivity**) |
| Language | English |
| Store icon | `dist/store/extension/icons/128.png` (128×128, artwork in the middle 96×96) |
| Global promo video | Leave empty (the demo video in `docs/launch/` is out of date; see `docs/screenshots/REVIEW.md`) |
| Screenshots | `docs/store/screenshots/1-…png` to `5-…png`, in that order |
| Small promo tile | `docs/store/promo/small-tile-440x280.png` |
| Marquee promo tile | `docs/store/promo/marquee-1400x560.png` |
| Official URL | Leave as "None" unless you've verified `sam-siavoshian.github.io` in Google Search Console |
| Homepage URL | `https://sam-siavoshian.github.io/RRAA/site/` |
| Support URL | `https://github.com/sam-siavoshian/RRAA/issues` |
| Mature content | No |

The summary isn't a field here: it is the manifest's `description` (130
characters). To change it, change `extension/manifest.json` and listing.md
together (`tests/store.test.js` keeps them the same), and upload a new zip.

## 5. Privacy tab

| Field | What to put |
|---|---|
| Single purpose description | The **Single purpose** block from listing.md (it starts "Change any website in your own words.") |
| Permission justification: `storage`, `scripting`, `userScripts`, `tabs`, `downloads` | The matching block from listing.md, one per box |
| Host permission justification | The **Host permission (<all_urls>)** block |
| Are you using remote code? | **Yes, I am using remote code**, and paste the **Remote code** block |
| Data usage: what you collect | Tick **Authentication information**, **Web history**, **User activity**, **Website content**. Leave the rest unticked. listing.md has the reason for each, checked against `docs/privacy.md` and the code |
| The three certifications | Tick all three |
| Privacy policy URL | `https://sam-siavoshian.github.io/RRAA/site/privacy.html` (must load: step 1) |

"Collect" in this form means "sends off the user's computer", even to a
service the user chose. That's why Website content and Web history are ticked
though nothing goes to the people who make Morse: they go to the user's own
model.

## 6. Distribution tab

- **Payments:** Free.
- **Visibility:** Public. (Unlisted is a quiet start: only people with the
  link can find it.)
- **Regions:** All regions.

## 7. Test instructions tab

If your dashboard has this tab, give the reviewer a way to see Morse work
without installing anything. Paste:

```
No account is needed. After install, the welcome page opens. Under "Try it here", click "Or click here", then pick a suggestion such as "Easier to read": the practice article changes using built-in sample answers, with no model connected.

To make changes on real websites, Morse needs a model. The quickest for a review: open the welcome page, expand "Use an Anthropic API key instead" and paste the key below (it has a small spending limit and will be revoked after the review). Then open any website, press Ctrl+Shift+Space (Option+Space on a Mac), click a part of the page and describe a change, for example "make this text bigger".

Changes that only restyle a page work right away. Changes that add buttons or features run through chrome.userScripts, so they need "Allow User Scripts" turned on in chrome://extensions → Morse → Details. Until then Morse shows the style part and says the rest is waiting.
```

If you add a key: make a new one in the Anthropic console with a low monthly
limit, and delete it once the review is done. Without a key, the reviewer can
still see the practice area, the Edit tools and Page tools (no model needed).

## 8. Submit

1. Check every tab has no red marks, then **Submit for review**.
2. Choose whether to publish as soon as it's approved, or to publish by hand
   (you then have 30 days to press Publish after approval).
3. The item shows **Pending review**. Google emails the developer account's
   contact address with the result.

**How long:** most new items get an answer in a few days. Morse asks for
`<all_urls>` and uses remote code through `userScripts`, so expect the
in-depth review: plan for one to three weeks. If there's no answer after
three weeks, ask through the developer support form (dashboard → **Support**),
quoting the item ID.

## 9. What reviewers may ask, and what to answer

**"Why do you need access to all websites (`<all_urls>`)?"**
Morse's single purpose is to let the user change any website they visit, in
their own words. The bar has to open on whatever page they're on, and the
changes they saved have to come back on the sites they were made for. Morse
can't know those sites in advance. The content script reads nothing and sends
nothing until the user opens Morse on that page; a narrower list of sites, or
`activeTab` alone, would break saved changes, which have to apply on every
visit without a click.

**"Your item runs remote code."**
Yes, and only through `chrome.userScripts`, which is the API Chrome made for
this: the code of a change the user just asked for, written by the model they
connected (their own Claude Code, Codex, Anthropic or OpenAI account), or of a
mod they chose to install after a review that says in plain words what it
does. It runs in an isolated `USER_SCRIPT` world, only on the site it was made
for, and only after the user turns on "Allow User Scripts". Nothing is fetched
from a Morse server; there is none. There is no `eval`, no `new Function` and
no remote script anywhere in the package; `chrome.scripting` only runs files
from the package. The full list is in `docs/store/README.md`, "Code that Morse
runs", and the source is public: https://github.com/sam-siavoshian/RRAA

**"Why `userScripts`?"**
Because it is the only way the store allows code that isn't in the package
to run. Morse's changes are written at the user's request, so they can't be
in the package. With "Allow User Scripts" off, Morse runs none of that code:
it only adds the style part of a change and tells the user which changes are
waiting, with a button to the switch.

**"What does it send, and where?"**
Only when the user asks for something: what they asked, the address and title
of the page, and the part of the page they pointed at, to the model they
chose (their own account at Anthropic or OpenAI, or Claude Code or Codex on
their computer through the Morse helper at `http://127.0.0.1:7457`). Nothing
goes to the developer: there's no server, no analytics. The policy:
https://sam-siavoshian.github.io/RRAA/site/privacy.html

**"What is the program on 127.0.0.1?"**
The Morse helper, an optional open-source program the user installs and
starts themselves (`morse setup`), so Morse can use the Claude Code or Codex
they already have. It listens only on the user's own computer, and a browser
must pair with it with a one-time code first. The extension works without it
when the user pastes an API key.

**"Why `tabs`?"**
To read the address of the active tab: to show that site's mods, and, on
Chrome's own pages, to explain in the popup that Morse can't run there. Those
addresses (and those of Morse's own pages) are only visible with `tabs`.

**"Why `scripting` as well as `userScripts`?"**
`scripting` only runs files from the package: the rest of Morse's interface
(`ui.js`) the first time the user opens Morse on a page, and one fixed
function in the popup that checks whether Morse is on the tab. The user's
changes never go through it.

**"What is `morse.helperPort`?"** (if they read the code)
A test setting that moves the helper to another port on `127.0.0.1`, so
several test runs can run at once. Only the extension's own worker and pages
can set it, there's no setting or message for it, and it can't point anywhere
but the user's own computer.

If a reviewer rejects the item, the email names the policy. Fix what it says,
upload a new zip (bump the version in `package.json` first, then `npm run
store`), and answer in the dashboard's appeal or resubmit with a note.

## 10. After it's approved

- Point the website's "Get it for Chrome" buttons at the store page
  (`site/index.html`, marked with a comment) and the README's install steps.
- Each update: bump `version` in `package.json`, `npm run store`, then
  **Package → Upload new package** in the dashboard and **Submit for review**.
  Updates that don't add permissions usually go through faster.
