# Gallery checks

Every checked mod in this gallery was run the way Morse runs it (its style on
the page, its code through the Morse helper kit), with a checker that uses
real clicks and keys. A mod passes when the checker **fails on the page
without the mod**, **passes with it**, and **passes again after a reload**
(the mod runs again, as it does on every page load).

- Run on 2026-10-24 with `node evals/gallery.js --verify` (Chromium 1280×800,
  headless). Result file: `evals/results/gallery-verify-2026-10-24T16-30-52.json`.
- The checkers are in [`evals/gallery-cases.json`](../../evals/gallery-cases.json).
- "haiku" means Claude Code (haiku) made the mod from the request on that
  page (`node evals/gallery.js --generate`; runs:
  `evals/results/gallery-generate-2026-10-24T15-54-36.json`, `evals/results/gallery-generate-2026-10-24T15-55-22.json`, `evals/results/gallery-generate-2026-10-24T16-02-39.json`, `evals/results/gallery-generate-2026-10-24T16-04-33.json`, `evals/results/gallery-generate-2026-10-24T16-22-19.json`, `evals/results/gallery-generate-2026-10-24T16-23-27.json`). When the request was
  asked again in other words, or the code was fixed by hand, the mod's
  `note` says so and the gallery page shows it.

## Real websites (14 of 14 pass)

These can't run in CI (they need the network). Run them again with
`node evals/gallery.js --verify --real-only`.

| Mod | App | Checked on | Made by | Needs “Allow User Scripts” | What the check does | Result |
|---|---|---|---|---|---|---|
| [Dark mode](pypi-dark-mode.morse.json) | PyPI | https://pypi.org/project/requests/ | haiku | No | Most of the screen is dark, and at least 92% of the description, header, tabs and sidebar text has a contrast of 4.5 or more. | Pass |
| [Install command always in view](pypi-sticky-install.morse.json) | PyPI | https://pypi.org/project/requests/ | haiku | Yes | Scrolls 2,500px down: the pip install command is still fully in view and not covered, what stays at the top takes less than 40% of the screen and its text is readable (contrast 3 or more), and description text shows under it. | Pass |
| [Hide pre-releases and yanked versions](pypi-hide-prereleases.morse.json) | PyPI | https://pypi.org/project/requests/#history | haiku | Yes | Opens Release history: no pre-release or yanked version shows, and more than 50 normal releases still do. | Pass |
| [Bigger code examples](nodejs-bigger-code.morse.json) | Node.js docs | https://nodejs.org/api/path.html | haiku | No | The first six code examples are at least 16px. | Pass |
| [Contents on the side](nodejs-side-contents.morse.json) | Node.js docs | https://nodejs.org/api/path.html | haiku | No | Scrolls to 60% of the page: at least three contents links are in view on the right half, and no paragraph in view runs under them. | Pass |
| [J and K to jump between sections](nodejs-section-keys.morse.json) | Node.js docs | https://nodejs.org/api/path.html | haiku | Yes | Presses j (real key): the page moves down to a section heading; j again moves further; k moves back up. | Pass |
| [No cookie notice or survey banner](go-hide-banners.morse.json) | Go packages | https://pkg.go.dev/net/http | haiku, hand-fixed | Yes | The cookie notice and the survey banner are hidden; the documentation still shows. | Pass |
| [Bigger code examples](go-bigger-code.morse.json) | Go packages | https://pkg.go.dev/net/http | haiku | No | The first six code examples are at least 16px. | Pass |
| [Dark mode](rubygems-dark-mode.morse.json) | RubyGems | https://rubygems.org/gems/rails | haiku, hand-fixed | No | Most of the screen is dark, and at least 92% of the text in the header and page has a contrast of 4.5 or more. | Pass |
| [Bigger code on dark blocks](docker-dark-code.morse.json) | Docker Hub | https://hub.docker.com/_/nginx | haiku, hand-fixed | No | The first six code blocks are at least 15px, on a dark background, with text contrast of 4.5 or more. | Pass |
| [Hide the left sidebar](gitlab-hide-sidebar.morse.json) | GitLab | https://gitlab.com/gitlab-org/gitlab | haiku | No | The left sidebar is hidden and the project title moves at least 120px to the left. | Pass |
| [Dark mode](nuget-dark-mode.morse.json) | NuGet | https://www.nuget.org/packages/Newtonsoft.Json | haiku | No | Most of the screen is dark, and at least 92% of the text has a contrast of 4.5 or more. | Pass |
| [Copy the install command](packagist-copy-command.morse.json) | Packagist | https://packagist.org/packages/laravel/framework | haiku | Yes | Clicks the new button (real click): the clipboard holds exactly “composer require laravel/framework”. | Pass |
| [Contents always in view](metacpan-sticky-contents.morse.json) | MetaCPAN | https://metacpan.org/pod/Moose | haiku | No | Scrolls halfway down: at least three contents links are fully in view, and no text in view runs under the contents box. | Pass |

## Demo apps (24 of 24 pass)

These run on the Morse demo apps (`node demo/serve.js`), not real websites.
`tests/gallery-mods.test.js` checks them again in every test run.

| Mod | App | Checked on | Made by | Needs “Allow User Scripts” | What the check does | Result |
|---|---|---|---|---|---|---|
| [Contents always in view](wiki-sticky-contents.morse.json) | Openpedia (demo) | demo app `wiki` | haiku | No | Scrolls halfway down the 85,000px page: the contents box is still in view near the top. | Pass |
| [Dark mode](wiki-dark-mode.morse.json) | Openpedia (demo) | demo app `wiki` | haiku | No | Most of the screen is dark, at least 92% of the article, contents and info box text has a contrast of 4.5 or more, and every cell of the big table in view does too. | Pass |
| [Reading mode](wiki-reading-mode.morse.json) | Openpedia (demo) | demo app `wiki` | haiku | No | The contents box and footer are hidden; article text is at least 17px in a column 400 to 820px wide, near the middle. | Pass |
| [Collapse the comments](wiki-collapse-comments.morse.json) | Openpedia (demo) | demo app `wiki` | haiku | Yes | All 400 comments are hidden and the references still show; clicking the new button (real click) shows at least 300 of them. | Pass |
| [Hide the upgrade ad](mail-hide-upgrade.morse.json) | Postbox (demo) | demo app `mail` | haiku | No | The Postbox Pro banner is hidden; the inbox and the open email still show. | Pass |
| [J and K to move through email](mail-jk-keys.morse.json) | Postbox (demo) | demo app `mail` | haiku | Yes | Presses j, j, k (real keys): the third email, then the second, is the one marked or open. | Pass |
| [Bigger email text](mail-bigger-text.morse.json) | Postbox (demo) | demo app `mail` | haiku | No | The email text is at least 15px with a contrast of 7 or more. | Pass |
| [Focus timer](notes-focus-timer.morse.json) | Inkwell (demo) | demo app `notes` | haiku | Yes | Shows 25:00; clicking start (real click) counts down; clicking pause stops it. | Pass |
| [Live word count](notes-word-count.morse.json) | Inkwell (demo) | demo app `notes` | haiku | Yes | Shows a number; typing four more words (real keys) raises it by exactly four. | Pass |
| [Darker, bigger note text](notes-easier-to-read.morse.json) | Inkwell (demo) | demo app `notes` | haiku | No | The note text has a contrast of 7 or more and is at least 15px. | Pass |
| [Focus mode](notes-focus-mode.morse.json) | Inkwell (demo) | demo app `notes` | haiku | No | The sidebar and the breadcrumbs are hidden; the editor still shows. | Pass |
| [Download the table as CSV](dash-download-csv.morse.json) | Metricly (demo) | demo app `dash` | haiku | Yes | Clicks the new button (real click): a file downloads with the table's rows, comma separated. | Pass |
| [Table header stays in view](dash-sticky-header.morse.json) | Metricly (demo) | demo app `dash` | haiku | No | Scrolls the table 150px: the column names stay at its top. | Pass |
| [Failed orders in red](dash-failed-red.morse.json) | Metricly (demo) | demo app `dash` | haiku | No | Every failed order's row is red and no other row is. | Pass |
| [Amounts as dollars](dash-dollars.morse.json) | Metricly (demo) | demo app `dash` | haiku | Yes | Every amount reads like $1,240.50. | Pass |
| [Cross out finished tasks](tasks-cross-out-done.morse.json) | Tasky (demo) | demo app `tasks` | haiku | No | Finished tasks are crossed out and open ones aren't, also after ticking one and after the app redraws. | Pass |
| [Hide finished tasks](tasks-hide-done.morse.json) | Tasky (demo) | demo app `tasks` | haiku | No | Only the 8 open tasks show; ticking one (real click) leaves 7, and still 7 after the app redraws. | Pass |
| [Hide sold-out products](shop-hide-sold-out.morse.json) | Shoply (demo) | demo app `shop` | haiku | Yes | After the next deploy changes every class name, the 3 sold-out products are hidden and the 9 others show. | Pass |
| [Sort by price](shop-sort-price.morse.json) | Shoply (demo) | demo app `shop` | haiku | Yes | Clicks the new button (real click) after the class names change: the 12 products show from lowest price to highest. | Pass |
| [Errors in red](logs-errors-red.morse.json) | Logline (demo) | demo app `logs` | haiku | Yes | Scrolls the 5,000 lines to four places: every error line in view is red and no other line is. | Pass |
| [Reading mode](byte-reading-mode.morse.json) | The Daily Byte (demo) | demo app `byte` | made by hand before this list | No | No ads show; article text is at least 18px with a contrast of 7 or more. | Pass |
| [Copy as Markdown](parley-copy-markdown.morse.json) | Parley (demo) | demo app `parley` | made by hand before this list | Yes | Clicks the new button (real click): the clipboard holds the conversation. | Pass |
| [Bigger rounded covers](tunes-big-covers.morse.json) | Tunes (demo) | demo app `tunes` | made by hand before this list | No | Every album cover is at least 25% wider than before. | Pass |
| [Sleep timer](tunes-sleep-timer.morse.json) | Tunes (demo) | demo app `tunes` | made by hand before this list | Yes | Clicks the new button and picks a time (real clicks): a countdown shows. | Pass |

## Not checked

Written by hand for apps the checks can't open from this machine (the sites
refuse the connection, or the app is a desktop app). The gallery page says
“Not checked by Morse” for these.

| Mod | App | Runs on | Needs “Allow User Scripts” |
|---|---|---|---|
| [Obvious active tab](vscode-obvious-tab.morse.json) | VS Code | vscode-app | No |
| [No Nitro upsells](discord-no-upsells.morse.json) | Discord | discord.com | No |
| [Comfortable reading](gmail-reading-pane.morse.json) | Gmail | mail.google.com | No |
| [Hide trends](x-hide-trending.morse.json) | X | x.com | Yes |
| [Dark mode](hn-dark-mode.morse.json) | Hacker News | news.ycombinator.com | No |
| [Focus mode](notion-focus-mode.morse.json) | Notion | www.notion.so | Yes |
| [Quiet sidebar](slack-quiet-sidebar.morse.json) | Slack | app.slack.com | No |
| [Sleep timer](spotify-sleep-timer.morse.json) | Spotify | xpui.app.spotify.com | Yes |
| [Enter for newline](claude-enter-newline.morse.json) | Claude | claude.ai | Yes |
| [Composer word count](chatgpt-word-count.morse.json) | ChatGPT | chatgpt.com | Yes |
| [Full-width diffs](github-wide-diffs.morse.json) | GitHub | github.com | No |
| [Hide Shorts](youtube-hide-shorts.morse.json) | YouTube | www.youtube.com | Yes |
