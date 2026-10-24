# Releasing Morse Desktop

Morse Desktop (`desktop-app/`) ships as one download per platform: a Linux
AppImage, a macOS dmg and a Windows installer. Each carries its own Electron,
so people install nothing else. This page covers how they're built, what
signing needs, and what was checked.

## Build it

```bash
npm ci --prefix desktop-app      # electron-builder, once (desktop-app/node_modules, not committed)
npm run desktop:build            # this platform: on Linux, dist/desktop-app/Morse-<version>-linux-x86_64.AppImage
node desktop-app/build.js --mac  # or --win, --linux; --dir for the unpacked app only
```

`desktop-app/build.js`:

1. builds the extension (`scripts/build.js`);
2. stages the app in `dist/desktop-app/app`: `desktop-app/`, `daemon/`,
   `core/`, `runtime/`, `design/tokens.css`, `dist/extension` and the one npm
   dependency (`@anthropic-ai/sdk` and what it needs), with a `package.json`
   whose `main` is `desktop-app/main.js`;
3. draws the icon (`desktop-app/mark.js`, the radar on a dark tile) and
   writes the macOS entitlements into `dist/desktop-app/res`;
4. runs electron-builder with `desktop-app/builder.config.js`.

Everything lands in `dist/`, which git ignores. On Linux the build uses the
Electron runtime already on the machine (`~/.cache/morse/electron`, the one
the tests use) when it's the pinned version (`ELECTRON_VERSION` in
`build.js`); elsewhere electron-builder downloads it.

The package is locked down with Electron's fuses: it can't run as plain Node
(`ELECTRON_RUN_AS_NODE`), ignores `NODE_OPTIONS` and `--inspect`, and only
loads its own `app.asar`, checked against the hash stored at build time.

The packaged extension lives inside `app.asar`, so **Show the extension
folder** copies it to `~/.morse/chrome-extension` first (an AppImage's own
folder changes every time it starts).

## What signing needs

Unsigned builds work, but macOS and Windows warn people the first time, and
macOS hides the Open button unless you right-click. Signing is skipped, never
failed, when its secrets are missing (`builder.config.js` reads them from the
environment).

### macOS: an Apple Developer ID, and notarization

You need an [Apple Developer Program](https://developer.apple.com/programs/)
membership (USD 99 a year) for a **Developer ID Application** certificate.
Notarization (Apple scanning the app, so Gatekeeper opens it without a
warning) needs the same account.

| GitHub secret | Build variable | What it is |
|---|---|---|
| `MAC_CSC_LINK` | `CSC_LINK` | The Developer ID Application certificate and its key, exported from Keychain Access as a `.p12`, base64-encoded |
| `MAC_CSC_KEY_PASSWORD` | `CSC_KEY_PASSWORD` | The password you gave the `.p12` |
| `APPLE_ID` | same | The Apple ID email of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | same | An app-specific password for it, made at appleid.apple.com |
| `APPLE_TEAM_ID` | same | The 10-character team ID from the developer account |

The workflow passes the `MAC_` secrets only to the macOS job, so the Windows
job never tries the Apple certificate.

Instead of the Apple ID trio, an App Store Connect API key works too:
`APPLE_API_KEY` (the `.p8` file's path), `APPLE_API_KEY_ID` and
`APPLE_API_ISSUER` (the workflow passes only the Apple ID trio; add these to
its Build step to use a key instead).

The app is signed with the hardened runtime and these entitlements: JIT and
unsigned executable memory (Electron's JavaScript engine) and Apple Events
(Morse quits an open app through AppleScript before opening it again with
Morse; macOS asks once). `NSAppleEventsUsageDescription` says why.

### Windows: a code signing certificate

Any of these:

- An **OV or EV code signing certificate** from a certificate authority, as a
  `.pfx`: secrets `WIN_CSC_LINK` (base64 of the `.pfx`) and
  `WIN_CSC_KEY_PASSWORD`. EV certificates now come on a hardware token or in
  a cloud HSM, which needs the vendor's signing tool instead of a `.pfx`.
- **Azure Trusted Signing** (Microsoft's signing service): `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`,
  `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE` and `AZURE_PUBLISHER_NAME`.

Unsigned, SmartScreen says “Windows protected your PC” until the installer has
been downloaded enough times; signed with a new certificate, it can still say
so for a while.

### Linux

AppImages aren't signed. electron-builder's AppImage starts the app with
`--no-sandbox`, because Chromium's sandbox helper can't run from an AppImage's
mount and many distributions limit the other kind; the window only ever loads
Morse's own page, which is what the sandbox would protect.

## The release workflow

`.github/workflows/release-desktop.yml` builds all three when a tag like
`v0.2.1` is pushed (or by hand, from the Actions tab):

- `ubuntu-latest` makes the AppImage, `macos-latest` the dmg (arm64 and x64),
  `windows-latest` the installer (x64 and arm64).
- Each job signs only when its secrets are set, and says in the log when it
  doesn't.
- The files are attached to a draft GitHub release for the tag. Check them,
  then publish the release by hand.
- The builds can only read the repo (they run npm packages' install scripts
  next to the signing secrets); only the job that drafts the release can
  write. Each action is pinned to a commit, with its version in a comment: to
  update one, look up the new tag's commit (`git ls-remote
  https://github.com/actions/checkout refs/tags/v4`) and change both.
  `tests/round9.test.js` fails on an action pinned to a tag.

Add the secrets above under Settings, Secrets and variables, Actions.

## Before publishing

On each platform, with the downloaded file:

1. Open it. The window lists your apps; nothing asks for permissions.
2. Choose a model and click **Check**.
3. **Open with Morse** on an app, make a change, Save; **Disconnect**; quit
   Morse from the tray.
4. In Chrome, load the extension from **Show the extension folder** and click
   **Connect** on the welcome page, then **Allow** in Morse Desktop.
5. Turn on **Open at login**, log out and in: Morse is in the tray, without
   the window.

## What was checked

- **Linux (x64)**: the AppImage was built here (Electron 45) and its app
  opened under Xvfb: the window listed this machine's apps, the model and the
  Morse helper (running inside it) answered, and it opened a packaged Tunes
  with Morse connected and disconnected it. `tests/desktop-app-ui.test.js`
  runs the same app unpackaged against Tunes, including the first run and
  one-click pairing (a request made the way the extension will make it).
- **macOS and Windows**: the configuration is written and the workflow runs
  them, but no dmg or installer was built or opened yet, signed or not.
- The tray menu and **Open at login** were not tried on a real desktop.
- One-click pairing from the real extension: the extension side isn't on
  this branch yet ([Pairing](pairing.md) is the contract it follows).
