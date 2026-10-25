# Troubleshooting

When something goes wrong, Morse says what happened in one sentence, and what
to try. In the bar, the message starts “That didn't work:”. Here is what each
message means.

Start with these two commands. They answer most questions:

```bash
morse doctor     # what's installed, which model Morse uses, and a real test request
morse status     # which desktop apps Morse is connected to, and the mods on in each
```

## Messages about the model

| Message | What it means | What to do |
|---|---|---|
| The Morse app isn't open on this computer. Open it, then try again. | Chrome reaches your model through the Morse app, and it isn't open. | Open the Morse app. If Chrome isn't connected yet, Morse's welcome page asks it, and you click **Allow** there. (Developers with `morse serve`: keep that terminal open.) |
| Claude Code or Codex isn't installed here. Open the Morse app to choose what Morse uses. | Morse was set to use Claude Code or Codex, and can't find it. | Install it, or open **Model** in the Morse app and choose another one. **How to install** there says what to do. |
| The model didn't accept the sign-in or API key. Check it in model settings. | The key is wrong or was removed, or Claude Code or Codex is signed out. | Check the key in the Morse popup or with `morse model`. For Claude Code or Codex, sign in again in a terminal (`claude`, `codex`). |
| The model is busy or has run out of credit. Wait a minute and try again. | The service is limiting requests, or your plan or account has no credit left. | Wait a minute. If it keeps happening, check your plan or credit. |
| The model's server had a problem. Wait a minute and try again. | The service had an error on its side. | Wait and try again. |
| That model isn't available. Pick another one in model settings. | The model name you chose doesn't exist for this key or plan. | Choose another model: `morse config --model <name>`, or in the popup. |
| Morse couldn't reach the model. Make sure it's running, or choose another one in model settings. | No answer from the model's server, or no internet connection. | Check your connection. If you set a server address, check that it's running. |
| The model took too long to answer. Try again, or ask for something smaller. | The request took too long and Morse stopped it. | Ask for a smaller change, or split it in two. |
| Not connected to the Morse app yet. Connect on the welcome page that opened. | Chrome isn't connected to the Morse app. | Open the Morse app and click **Use Morse in Chrome**, or open Morse's welcome page in Chrome. Click **Allow** when the app asks. See [Models and setup](models.md#in-chrome). |
| No model is connected. Run morse setup to choose one. | The morse command (for developers) opened an app, but no model is chosen. | Run `morse setup`, or choose one under **Model** in the Morse app. |

## Messages about the change

| Message | What it means | What to do |
|---|---|---|
| “Word count” adds features that wait for “Allow User Scripts”. It stays off until then, so the page isn't left half changed. | Chrome's “Allow User Scripts” switch is off for Morse, so a mod's code doesn't run. Its new look waits too, since on its own it could hide something the code was meant to replace. Mods that only change how a site looks still run. The Mods panel and the Morse button in Chrome's toolbar list every mod that is waiting. | Click **Open Morse's details** (or **Turn it on**). Turn on **“Allow User Scripts”**, then come back to the tab. The waiting mods run then. |
| This site blocks scripts that Morse adds. Turn on “Allow User Scripts” for Morse, then try again. | The site has strict security settings, and Chrome's “Allow User Scripts” switch is off for Morse. | Open `chrome://extensions`, open Morse's details and turn on **“Allow User Scripts”**. |
| The model's answer had no change in it. Try saying it another way. | The model answered, but not with a change. | Say it differently, or point at the part you mean. |
| The change didn't do anything you can see here. Point at the part you mean, or say it another way. | The change ran, but nothing on the page looks different. | Point at the exact part, and try again. |
| The change the model wrote didn't work on this page. Try again, or describe it differently. | The code failed, even after Morse showed the model the error. | Try again, or describe it another way. |
| The change didn't run on this page. Reload the page and try again. | The page didn't answer when Morse ran the change. | Reload the page. |
| Morse lost touch with this page. Reload the page and try again. | Chrome restarted Morse, or the page changed under it. | Reload the page. |
| Morse got an answer it couldn't read. Try again. | The answer came back broken. | Try again. |
| The page closed or reloaded. Try again. | The page went away while Morse was working. | Try again once the page has loaded. |
| Stopped. Nothing was changed. | You pressed Stop or Esc. | Nothing to do. |
| Something went wrong. Try again. | An error Morse can't explain. The details are in the message's tooltip. | Try again. If it keeps happening, [report it](https://github.com/sam-siavoshian/RRAA/issues/new) with what you did. |

## Messages about a saved mod

| Message | What it means | What to do |
|---|---|---|
| Stopped working after this site changed. | The site changed its page, and nothing the mod used to change is there any more. | Click **Fix it**. See [Mods](mods.md#when-a-site-changes). |
| Paused because it was slowing this page down. | The mod kept the page busy, kept running every time the page changed, or added too much. | **Fix it** asks the model for a lighter version. **Turn back on** runs it again. |
| Paused because it froze this page. | The mod's code never finished, so Morse stopped it. | Click **Fix it**, or delete the mod. |
| Paused because it would freeze this page. | The mod's code has a loop that never ends, so Morse never started it. | Click **Fix it**. |
| Paused because it hid this page. | The mod would have hidden everything on the page. | Click **Fix it**, or **Turn back on** if you meant it. |
| Paused this change because … Try describing it another way. | A change you haven't saved yet slowed down or froze the page. | Describe it another way. |

More in [Your controls](your-controls.md#mods-cant-freeze-or-slow-down-a-page).

## Pages where Morse can't run

| Message | What to do |
|---|---|
| This is a new tab. Open any website, then press the Morse shortcut there. | Open a website. |
| Chrome doesn't let extensions change its own pages. Any website works. | Use Morse on a website instead. |
| Chrome doesn't let extensions change the Chrome Web Store. Any other site works. | Use Morse on another site. |
| Morse can't change PDFs in Chrome's PDF viewer. Web pages work. | Nothing. Morse can't change PDFs. |
| To use Morse on files from your computer, turn on “Allow access to file URLs” for Morse. | Turn it on in Morse's details in `chrome://extensions`. |
| This tab was open before Morse was installed. Reload it to use Morse here. | Reload the tab. |

## Messages in the terminal

| Message | What to do |
|---|---|
| Morse couldn't find an app called “…”. Run morse apps to see what it found, or give the app's path. | Run `morse apps`, or give the path: `morse launch "/path/to/My App"`. |
| “…” could be A or B. Say which one. | Use a longer part of the name. |
| … is already open. Morse can only connect to an app when it starts. | Run `morse launch <app> --restart`. Morse quits the app and opens it again, and remembers that choice. |
| … didn't quit. Close it yourself, then run this again. | Quit the app, then run `morse launch` again. |
| … is a native app …, so Morse can't connect to it. | Morse only works with apps built from web pages. See [Desktop apps](desktop.md#which-apps-cant-work-and-why). |
| … started but never opened its debugging port. | The app may still be running in the background. Try `--restart`. Some apps block what Morse needs. `morse fuses <app>` tells you more. |
| … quit right after it started, before Morse could connect. You're running as root … | Run Morse as your own user, not root. See [Desktop apps](desktop.md#which-apps-cant-work-and-why). |
| Port … is already in use, probably by a Morse helper that is already running. | The helper is already running. Run `morse pair` for a new pairing code. |
| Port … is already used by another program. Leave out --port and Morse picks a free one. | Run the command again without `--port`. |
| Port … can be reached from other computers …, so Morse won't use it. | Quit the app and run `morse launch` again without extra network switches. |
| Couldn't make the clip. Check that ffmpeg is installed and try again. | Install `ffmpeg`. |
| “…” isn't a model name Morse can use. Check the spelling. | Check `morse help` for model names, like `opus` or `sonnet`. |
| Add --yes to install without being asked. | `morse install` needs a terminal to ask you. Add `--yes` if you already checked the mod. |

In the terminal, the original error shows in grey after the plain sentence.
Include it when you report a problem.

## If it still doesn't work

- Reload tabs that were open before you installed Morse.
- In a desktop app, keep the terminal where `morse launch` runs open.
- If a shortcut does nothing, another app may use the same keys. Change it in
  Settings.
- [Open an issue](https://github.com/sam-siavoshian/RRAA/issues/new) with
  what you did, what Morse said, and `morse doctor`'s output. Leave out your
  API keys.
