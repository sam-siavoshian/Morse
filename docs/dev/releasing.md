# Releasing

How a version of Morse gets to people: the setup you do once, then the three
commands for every release after it.

## What one release makes

You push one tag, such as `v0.3.0`. The
[release workflow](../../.github/workflows/release.yml) then:

1. checks that the tag, `package.json` and `CHANGELOG.md` agree, and runs
   `npm ci`, `npm run check` and `npm test` (the same headless tests as CI).
   If anything fails, nothing is published.
2. builds the Chrome Web Store zip (`npm run store`, a `MORSE_STORE=1` build)
   and the npm package, whose extension is the same store build. It installs
   the package once and runs `morse --version`, `morse help`,
   `morse setup --help` and `morse extension` to be sure it works.
3. publishes `morse-cli` to npm with `npm publish --provenance`, if the
   `NPM_TOKEN` secret is set. Without it, the run says so and goes on.
4. makes the GitHub release, with the notes from that version's section of
   `CHANGELOG.md`, the store zip, the npm package and their SHA-256. When
   `.github/workflows/release-desktop.yml` is there (Morse Desktop), the tag
   starts it too; the release waits for it and adds its AppImage, dmg and
   Windows installer.

The Chrome Web Store upload stays a manual step: Google reviews every
version, and uploading from a workflow needs a Google API project and keys
this repository doesn't have.

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
   https://sam-siavoshian.github.io/RRAA/site/privacy.html opens. If the
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
     one before then; the release only skips npm when the secret is missing,
     so an expired token fails the npm step (re-run it after replacing the
     secret).
4. **Optional: signing for Morse Desktop.** Unsigned builds work, but macOS
   and Windows warn people the first time they open them. Add any of these
   as repository secrets; each platform signs only when its secrets are
   there:

   | Secrets | For |
   |---|---|
   | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | the Apple Developer ID Application certificate (a base64 `.p12`) and its password |
   | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarizing the macOS app |
   | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | a Windows code signing certificate (a base64 `.pfx`) |
   | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE`, `AZURE_PUBLISHER_NAME` | Azure Trusted Signing, instead of a `.pfx` |

   `.github/workflows/release-desktop.yml` reads them; the Morse Desktop
   docs that come with it say how to get each one.
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

   Then upload the store zip, as in step 4 below.

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
   the new version into `package.json` and `package-lock.json` (the build
   copies it into the extension), moves the "Unreleased" notes under
   `## <version> (<date>)`, runs `npm run check` and `npm test`, commits
   `Release v<version>` and makes the tag. It stops, and puts the files
   back, if the checks fail. It never pushes; it prints the command.
   Changed your mind before pushing? `git tag -d v<version> && git reset
   --hard HEAD~1`.
3. Push the commit and the tag:

   ```bash
   git push --follow-tags origin main
   ```

   Watch **Actions → Release**. When it's done, the release is on the
   Releases page and `npm view morse-cli version` shows the new version.
4. Upload the store zip. Download `morse-extension-<version>-store.zip` from
   the release (or run `npm run store`, which builds the same thing), and
   follow [Submitting to the Chrome Web Store](../store/SUBMIT.md), "After
   it's approved": **Package → Upload new package**, then **Submit for
   review**. The SHA-256 in the release notes tells you which zip the store
   has.

## When something goes wrong

- **`npm run release` stops on a failed test**: nothing was committed or
  tagged, and the files are back as they were. The browser tests can time
  out on a busy computer; run the file alone
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
one). Nothing else in Morse makes this request; the
[privacy policy](../privacy.md#checking-for-a-newer-version) says so.
