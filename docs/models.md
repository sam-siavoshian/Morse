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
| **Anthropic API key** | A key from console.anthropic.com | Uses `claude-haiku-5-5` for quick changes and `claude-opus-5-5` for harder ones (see [Quick and harder changes](#quick-and-harder-changes)). If Claude declines a request, Morse tells you in plain words |
| **OpenAI API key** | A key from platform.openai.com, or the address of another server that works the same way | Uses `gpt-5-mini` for quick changes and `gpt-5` for harder ones, unless you choose one model |

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
morse config --provider claude-code                      # Claude Code, choosing haiku or sonnet each time
morse config --model opus                                # always this one model (--model auto to undo)
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

## Quick and harder changes

Most changes are quick: bigger pictures, a darker page, hiding something.
A fast model makes those well, in a few seconds. Some changes are harder: a
new button that sorts a list, a count that has to keep up with the app, a
drawing you want to save. Those go better with a stronger model, which takes
longer and uses more of your plan.

Morse chooses for you. It uses two models from what you set up, and never
anything else:

| You use | Quick changes | Harder changes |
|---|---|---|
| Claude Code | `haiku` | `sonnet` |
| Anthropic API key | `claude-haiku-5-5` | `claude-opus-5-5`, or the model you picked in the Morse popup |
| OpenAI API key | `gpt-5-mini` | `gpt-5` |
| Codex | your plan's usual model, thinking briefly | the same model, thinking longer |
| Another server that works like OpenAI's | the names you set | the names you set |

Codex doesn't say which models your ChatGPT plan has, so Morse keeps the
model Codex picks and only changes how long it thinks. To name two models,
use `morse config --fast-model` and `--best-model`.

Morse stays with what you chose: Claude Code stays on your Claude plan, and
a key is only sent to its own service. It never moves your request to a
service you pay for separately.

### How Morse chooses

In the bar's Settings, under **Model**:

- **Automatic** (recommended). The fast model goes first. The stronger
  model takes over when:
  - the request looks hard: a new feature with buttons or keys, several
    steps, counting, sorting or comparing numbers, every item of a list the
    app keeps changing, or a drawing. Morse decides this from your words
    and from what it already knows about the page, without asking a model,
    so it takes no time.
  - the fast model's change didn't work: nothing changed on the page, it
    would have hidden or broken the page, or its code still failed after
    one fix. The stronger model sees what went wrong and tries instead,
    rather than Morse giving up.
- **Always fast.** Every change uses the fast model.
- **Always best.** Every change uses the stronger one.

The bar shows which model made each change, like "Claude Code · sonnet",
and says "Asking a stronger model" while it takes over.

You can also choose in `morse setup`, or with
`morse config --model-mode auto` (or `fast`, or `best`). To use other
models: `morse config --fast-model haiku --best-model opus`. To use one
model for everything, as before: `morse config --model opus`. Then the
Model setting shows that model, and `morse config --model auto` lets Morse
choose again.

### Speed and your plan

When the bar opens, Morse starts the fast model so it is ready when you
press Enter. It doesn't start the stronger one ahead of time: most changes
never need it, and each model waiting in the background uses memory. So a
harder change waits a second or two longer to start.

On a Claude plan, sonnet uses up your usage limits much faster than haiku:
each change costs about 20 times as much of your plan. With Automatic, most
changes use haiku, so you get the stronger model where it helps without
using it for every small change. If you keep reaching your limits, choose
**Always fast**.

In Morse's own tests (86 requests on 13 practice apps, with Claude Code),
Automatic sent about one change in seven to sonnet, got as many right as
**Always best**, and was as quick as haiku on the rest. Over all the
changes, that used about a fifth of what **Always best** would use from your
plan.

## In Chrome

The extension can reach your model in three ways. The welcome page sets up
any of them ([Getting started](getting-started.md#3-connect-a-model)); the
Morse popup (Chrome's toolbar button) changes it later:

- **Morse Desktop**, the easiest. It runs the Morse helper. The welcome page
  finds it, you click **Use Claude Code** (or Codex), and Morse Desktop asks
  **“Allow Chrome to use your Claude Code?”**. Click **Allow**.

- **The Morse helper from a terminal**, for Claude Code, Codex, or keys kept
  on your computer. Run `morse serve`. In a terminal, Connect on the welcome
  page asks there: type `y`. Or it shows a 6-character code. Type the code
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
