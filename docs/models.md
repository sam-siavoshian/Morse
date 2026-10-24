# Models and setup

Morse doesn't come with a model, and it has no account or server of its own.
It uses one you already have. The model writes your changes and answers your
questions; everything else (pointing, the Edit tools, Page tools, Easier to
use, Read aloud, Check this page) works without it.

## Which models work

| | What you need | How Morse uses it |
|---|---|---|
| **Claude Code** | The `claude` command, signed in with your Claude plan | Starts Claude Code with all of its tools turned off, in an empty folder, so it can only write text back |
| **Codex** | The `codex` command, signed in with your ChatGPT plan | Starts Codex so it can only read, in an empty folder |
| **Anthropic API key** | A key from console.anthropic.com | Uses `claude-opus-5-5` unless you choose `claude-sonnet-5-5` or `claude-haiku-5-5`. If Claude declines a request, Morse tells you in plain words |
| **OpenAI API key** | A key from platform.openai.com, or the address of another server that works the same way | Uses `gpt-5` unless you choose another model |

Describe this picture needs a model that can look at pictures: Claude Code or
an API key. Codex can't.

When no model is connected, the bar says so, with a button to connect one.

## Choose one

`morse setup` looks for Claude Code, Codex and an API key on this computer,
recommends the first one it finds, and saves your choice. To choose without
questions: `morse setup --use claude-code` (or `codex`, or
`api-key --key <your key>`).

Or set it yourself:

```bash
morse model                                              # which model Morse will use
morse config --provider claude-code --model haiku        # opus · sonnet · haiku
morse config --provider anthropic --anthropic-key sk-ant-…
morse config --provider openai --openai-key sk-…
morse config --provider openai --base-url <address>   # another server that works like OpenAI's
morse config --provider auto                             # let Morse choose again
morse doctor                                             # what's installed, plus a real test request
```

When you haven't chosen, Morse uses the first one it finds, in this order:
Claude Code, Codex, an Anthropic key, an OpenAI key.

Keys are saved in `~/.morse/config.json`, which only you can read. Morse also
reads the `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` settings from your
terminal. A key is only ever sent to the service it is for.

## In Chrome

The extension can reach your model in two ways. Pick one in the Morse popup
(Chrome's toolbar button):

- **The Morse helper**, for Claude Code, Codex, or keys kept on your
  computer. Run `morse serve`. It shows a 6-character code. Type the code
  into the popup and click **Pair**. Keep the terminal open. `morse pair`
  shows a new code, and `morse unpair` signs every browser out. When you
  press Stop or close the tab, the model on your computer stops too.
- **An Anthropic API key**, with nothing to install. Paste a key in the popup
  and pick a model. The key stays in this browser, and requests go straight
  from Chrome to Anthropic.

The popup's **Test the model** button sends a small real request and shows
the reply.

![The Morse popup: mods on this site and model settings](screenshots/34-popup.png)

## In desktop apps

`morse launch` uses the model you chose with `morse setup` or `morse config`.
Nothing else to set up.

## Voice in desktop apps

In Chrome, Chrome turns your speech into text. In desktop apps, the Morse
helper does it in one of two ways:

- **With OpenAI**: it uses your OpenAI key from `morse config`, or
  `OPENAI_API_KEY`, or a key set only for voice in `~/.morse/config.json`:
  `"voice": { "openaiKey": "sk-…" }`.
- **With Whisper on your computer**: if `whisper-cli` or `whisper` is
  installed, nothing leaves your computer.

## Check that it works

```bash
morse doctor
```

shows the version of Node, where your settings are, whether Claude Code and
Codex are installed, which keys are set, whether the Morse helper is running,
and which model Morse will use. Then it sends a real test request and shows
the reply and how long it took. If something is wrong, see
[Troubleshooting](troubleshooting.md).
