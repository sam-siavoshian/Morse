# Releasing

How a version of Morse gets to people: the setup you do once, then the three
commands for every release after it. [Morse Desktop](#morse-desktop), at the
end, covers building and signing the desktop app.

## The preview release (every push to main)

Before any version is released, people download Morse from the GitHub
pre-release tagged `preview`. The
[preview workflow](../../.github/workflows/preview.yml) makes it again on
every push to `main` (pushes that only change `docs/`, `site/`, `evals/` or
Markdown are skipped; run it by hand from the Actions tab any time):

1. **package**: `npm run check`, then `morse-cli.tgz` (`npm pack`, about 2 MB).
2. **desktop**: Morse Desktop on `ubuntu-latest`, `macos-latest` and
   `windows-latest`, signed when the secrets in
   [What signing needs](#what-signing-needs) are set. Without them the Mac
   app is signed ad hoc (Apple silicon won't open an app with no signature
   at all) and the job checks it with `codesign --verify` and starts it once.
3. **smoke**: `install.sh` (piped into `sh`, as people run it) and
   `install.ps1` (through `irm | iex` in Windows PowerShell 5.1, then as a
   file in PowerShell 7) against the package just built, served from the
   runner: `morse --version`, `morse doctor --offline`, a second run that says "already up to date", then `morse uninstall`.
4. **release**: only when all of that worked. The `preview` tag moves to the
   commit, and the release's files are replaced, with `SHA256SUMS`. It stays
   a pre-release, so it never shows as the latest release.

The file names never change, so these addresses always give the newest
build (the README, `site/config.js`, `docs/desktop-app.md` and the
installers use them):

| File | What it is |
|---|---|
| `Morse-mac-arm64.dmg`, `Morse-mac-x64.dmg` (and `.zip`) | Morse Desktop for Macs with Apple silicon, and with Intel |
| `Morse-Setup.exe`, `Morse-Setup-arm64.exe` | Morse Desktop for Windows, one installer per architecture (x64 keeps the old name) |
| `Morse-linux-x86_64.AppImage` | Morse Desktop for Linux |
| `morse-cli.tgz` | the `morse` command; what `install.sh` and `install.ps1` install |
| `SHA256SUMS` | the SHA-256 of each; the installers (`install-app.sh` too) check against it |

at `https://github.com/sam-siavoshian/RRAA/releases/download/preview/<file>`.

The installers (developer path): `install.sh` (macOS, Linux) and
`install.ps1` (Windows) need Node 22, download `morse-cli.tgz`, check it,
put Morse in `~/.morse/app` and a `morse` command on the PATH, then run `morse setup --auto`. Running
one again updates; `morse uninstall` (or `--uninstall`, `-Uninstall`)
removes what it added. With no preview release yet, they build the package
from `main` instead. Try them against files on your computer:
`node scripts/serve-files.js <folder> 8765` and
`MORSE_INSTALL_BASE=http://127.0.0.1:8765 sh install.sh`;
`tests/install.test.js` does that for every case. `install-app.sh` puts the
Morse app itself in Applications (macOS) or `~/.local/share/morse` (Linux),
checked against `SHA256SUMS`, with no Gatekeeper prompt: curl marks nothing
as downloaded from the internet.

## What one release makes

You push one tag, such as `v0.3.0`. The
[release workflow](../../.github/workflows/release.yml) then:

1. checks that the tag, `package.json` and `CHANGELOG.md` agree, and runs
   `npm ci`, `npm run check` and `npm test` (the same headless tests as CI).
   If anything fails, nothing is published.
2. builds the npm package. It installs the package once and runs
   `morse --version`, `morse help` and `morse setup --help` to be sure it
   works.
3. publishes `morse-cli` to npm with `npm publish --provenance`, if the
   `NPM_TOKEN` secret is set. Without it, the run says so and goes on.
4. makes the GitHub release, with the notes from that version's section of
   `CHANGELOG.md`, the npm package and its SHA-256. When
   `.github/workflows/release-desktop.yml` is there (Morse Desktop), the tag
   starts it too. The release waits for it and adds its AppImage, dmg and
   Windows installer.



Running the **Release** workflow by hand from the Actions tab is a dry run:
the same checks and files, `npm publish --dry-run`, and no release. Its files
are kept with the run.

The website is separate: the [Pages workflow](../../.github/workflows/pages.yml)
publishes it on every push to `main` that changes it.

## The first time

Do these once, in this order.

1. **Make `main` the default branch.** The repository's default branch is
   still `claude/optimistic-sagan-wnq3d2`. Push `main`
   (`git push origin main`), then on GitHub: **Settings → General → Default
   branch**, click the switch button, choose `main` and confirm. This
   matters because the `github-pages` environment only lets the default
   branch deploy, and the links in the README on npm point at `main`. The
   workflows themselves run on `main` and on tags whatever the default
   branch is.
2. **Turn on GitHub Pages.** **Settings → Pages → Build and deployment →
   Source: GitHub Actions.** Then run the **Pages** workflow from the Actions
   tab (or push to `main`). Check that
   https://getmorse.vercel.app/site/privacy.html opens. If the
   deploy says the branch isn't allowed, open **Settings → Environments →
   github-pages** and add `main` under deployment branches.
3. **Add the npm token.**
   - `npm view morse-cli` should say 404: the name is still free.
   - Sign in at npmjs.com (turn on two-factor authentication), then
     **Access Tokens → Generate New Token → Granular Access Token**:
     read and write, for all packages (a package that doesn't exist yet
     can't be picked). If your account asks for a second factor when
     publishing, turn on the token's option to bypass it, or the workflow
     can't publish.
   - On GitHub: **Settings → Secrets and variables → Actions → New
     repository secret**, name `NPM_TOKEN`, paste the token.
   - npm tokens that can publish expire. Write down the date and make a new
     one before then. The release only skips npm when the secret is missing,
     so an expired token fails the npm step (re-run it after replacing the
     secret).
4. **Optional: signing for Morse Desktop.** Unsigned builds work, but macOS
   and Windows warn people the first time they open them. Add the secrets in
   [What signing needs](#what-signing-needs) as repository secrets. Each
   platform signs only when its own are there.
5. **The first release, 0.2.0.** `package.json` already says 0.2.0 and the
   notes are under "Unreleased" in `CHANGELOG.md`. Before releasing, change
   the README where it says "not released yet" and "until the first npm
   release", and commit that. Then:

   ```bash
   git switch main && git pull
   npm run release -- 0.2.0 --dry-run
   npm run release -- 0.2.0
   git push --follow-tags origin main
   ```

## Every release after that

1. While you work, write what people will notice under `## Unreleased` in
   `CHANGELOG.md`, in plain words ([How Morse talks](../WRITING.md)).
2. Make the release on `main`, with a clean working tree:

   ```bash
   git switch main && git pull
   npm run release -- minor --dry-run   # what it would do, changing nothing
   npm run release -- minor             # or patch, major, or a version: 1.4.0
   ```

   `npm run release` ([scripts/release.js](../../scripts/release.js)) writes
   the new version into `package.json` and `package-lock.json`, moves the "Unreleased" notes under
   `## <version> (<date>)`, runs `npm run check` and `npm test`, commits
   `Release v<version>` and makes the tag. It stops, and puts the files
   back, if the checks fail. It never pushes. It prints the command.
   Changed your mind before pushing? `git tag -d v<version> && git reset
   --hard HEAD~1`.
3. Push the commit and the tag:

   ```bash
   git push --follow-tags origin main
   ```

   Watch **Actions → Release**. When it's done, the release is on the
   Releases page and `npm view morse-cli version` shows the new version.

## When something goes wrong

- **`npm run release` stops on a failed test**: nothing was committed or
  tagged, and the files are back as they were. The browser tests can time
  out on a busy computer. Run the file alone
  (`DISPLAY=:99 node --test --test-timeout=300000 tests/<file>.test.js`). If
  it passes, close what's busy and run `npm run release` again. If it fails
  again, fix it first.
- **The tag doesn't match `package.json`**: the release stops at the first
  step. Make tags with `npm run release`, not by hand.
- **A test fails in the workflow but not on your computer**: fix it on
  `main`, then delete the tag (`git push origin :refs/tags/v<version>` and
  `git tag -d v<version>`) and run `npm run release` again with the next
  patch version. A version that reached npm can't be published again.
- **npm was skipped or failed**: add or replace `NPM_TOKEN`, then **Re-run
  failed jobs** on the run. The npm step skips a version that is already on
  npm, so re-running is safe.
- **Morse Desktop failed**: the release still comes out, without the
  desktop files, and the run has a warning with a link to the desktop run.

## The version check

`morse doctor` tells people when a newer `morse-cli` is on npm
([daemon/update-check.js](../../daemon/update-check.js)): one request to
`https://registry.npmjs.org/morse-cli/latest`, at most once a day, kept in
`~/.morse/update-check.json`. `MORSE_NO_UPDATE_CHECK=1` turns it off and
`MORSE_UPDATE_REGISTRY` points it at another registry (the tests use a fake
one). Nothing else in Morse makes this request. The
[privacy policy](../privacy.md#checking-for-a-newer-version) says so.

## Morse Desktop

Morse Desktop (`desktop-app/`) ships as one download per platform: a Linux
AppImage, a macOS dmg and a Windows installer. Each carries its own Electron,
so people install nothing else. This section covers how they're built,
what signing needs, and what was checked.

### Build it

```bash
npm ci --prefix desktop-app      # electron-builder, once (desktop-app/node_modules, not committed)
npm run desktop:build            # this platform: on Linux, dist/desktop-app/Morse-<version>-linux-x86_64.AppImage
node desktop-app/build.js --mac  # or --win, --linux; --dir for the unpacked app only
```

`desktop-app/build.js`:

1. stages the app in `dist/desktop-app/app`: `desktop-app/`, `daemon/`,
   `core/`, `runtime/`, `design/tokens.css` and the one npm
   dependency (`@anthropic-ai/sdk` and what it needs), with a `package.json`
   whose `main` is `desktop-app/main.js`;
2. draws the icon (`desktop-app/mark.js`, the radar on a dark tile) and
   writes the macOS entitlements into `dist/desktop-app/res`;
3. runs electron-builder with `desktop-app/builder.config.js`.

Everything lands in `dist/`, which git ignores. On Linux the build uses the
Electron runtime already on the machine (`~/.cache/morse/electron`, the one
the tests use) when it's the pinned version (`ELECTRON_VERSION` in
`build.js`). Elsewhere electron-builder downloads it.

The package is locked down with Electron's fuses: it can't run as plain Node
(`ELECTRON_RUN_AS_NODE`), ignores `NODE_OPTIONS` and `--inspect`, and only
loads its own `app.asar`, checked against the hash stored at build time.

### What signing needs

Unsigned builds work, but macOS and Windows warn people the first time, and
macOS hides the Open button unless you right-click. Signing is skipped, never
failed, when its secrets are missing (`builder.config.js` reads them from the
environment).

#### macOS: an Apple Developer ID, and notarization

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
Morse. macOS asks once). `NSAppleEventsUsageDescription` says why.

#### Windows: a code signing certificate

Any of these:

- An **OV or EV code signing certificate** from a certificate authority, as a
  `.pfx`: secrets `WIN_CSC_LINK` (base64 of the `.pfx`) and
  `WIN_CSC_KEY_PASSWORD`. EV certificates now come on a hardware token or in
  a cloud HSM, which needs the vendor's signing tool instead of a `.pfx`.
- **Azure Trusted Signing** (Microsoft's signing service): `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`,
  `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE` and `AZURE_PUBLISHER_NAME`.

Unsigned, SmartScreen says “Windows protected your PC” until the installer has
been downloaded enough times. Signed with a new certificate, it can still say
so for a while.

#### Linux

AppImages aren't signed. electron-builder's AppImage starts the app with
`--no-sandbox`, because Chromium's sandbox helper can't run from an AppImage's
mount and many distributions limit the other kind. The window only ever loads
Morse's own page, which is what the sandbox would protect.

### The release workflow

`.github/workflows/release-desktop.yml` builds all three when a tag like
`v0.2.1` is pushed (or by hand, from the Actions tab):

- `ubuntu-latest` makes the AppImage, `macos-latest` the dmg (arm64 and x64),
  `windows-latest` one installer per architecture (`Morse-Setup.exe` for x64,
  `Morse-Setup-arm64.exe` for arm64).
- Each job signs only when its secrets are set, and says in the log when it
  doesn't.
- Its own job attaches the files to a draft release for the tag. The
  [release workflow](#what-one-release-makes) waits for this one, takes its
  files too, and publishes the release with the notes and the npm package.
- The builds can only read the repo (they run npm packages' install scripts
  next to the signing secrets). Only the job that drafts the release can
  write. Each action is pinned to a commit, with its version in a comment: to
  update one, look up the new tag's commit (`git ls-remote
  https://github.com/actions/checkout refs/tags/v4`) and change both.
  `.github/workflows/release.yml` pins the same way, and
  `tests/round9.test.js` fails on an action pinned to a tag.

Add the secrets above under Settings, Secrets and variables, Actions.

### Check the downloads

After a release, on each platform, with the downloaded file (if one is
broken, delete it from the release and say so in the notes):

1. Open it. The window lists your apps. Nothing asks for permissions.
2. Choose a model and click **Check**.
3. **Open with Morse** on an app, make a change, Save; **Disconnect**. Quit
   Morse from the tray.
4. **Open with Morse** on Chrome: a window of its own opens; make a change on
   a website.
5. Open an app with mods from the Dock or Start menu: Morse opens it again
   with Morse (Always open with Morse). Log out and in: Morse is in the tray,
   without the window.

### What was checked

- **Linux (x64)**: the AppImage was built here (Electron 45) and its app
  opened under Xvfb: the window listed this machine's apps, the model
  answered, and it opened a packaged Tunes with Morse connected and
  disconnected it. `tests/desktop-app-ui.test.js` runs the same app
  unpackaged against Tunes, including the first run.
- **macOS**: the preview workflow builds the dmg and zip, and the app was used
  on a real Mac (open with ⌥Space, a change in Spotify, updating itself).
  **Windows**: built by the workflow, not opened yet.
- The tray menu and **Open at login** were not tried on a real desktop.
- **The installers**: `install.sh` ran end to end on Linux in a fresh home
  against a package served from this computer (install, "already up to
  date", update, a bad checksum refused, no Node, `--uninstall`, `morse
  uninstall`, and the build from `main` when there is no release), checked
  with shellcheck. `install.ps1` ran the same cases in PowerShell 7 on
  Linux. On macOS and Windows they run in the preview workflow's smoke jobs;
  the ad hoc signed Mac app and "Add to Chrome" opening Chrome weren't tried
  on a real Mac or PC.

## Repository size

On `98bf072d` the files in the tree were 276,152,973 bytes, almost all pictures
and video. A checkout of this branch is 14,934,908 bytes, not counting `.git`. The UI catalog `npm run ui`
writes (`docs/ui/*.png`, `docs/ui/index.html`, `docs/ui/catalog.json`) is
gitignored. The launch films (100,464,140 bytes of video, GIF and poster files)
are not in the tree: the landing page shows the bar, not a film. Screenshots
nothing links were removed. Pictures the site and the guides show are still
there, recompressed.

Git history was not rewritten, so a full clone still downloads the old blobs.
`git clone --depth 1` gets the current tree. People who use Morse do not need a
clone: the downloads and the one-line installers take the
[preview release](#the-preview-release-every-push-to-main).
