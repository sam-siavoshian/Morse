# Models and setup

Morse doesn't come with a model, and it has no account or server of its own.
It uses one you already have. The model writes your changes and answers your
questions; everything else (pointing, the Edit tools, Page tools, Easier to
use, Read aloud, Check this page) works without it.

## Which models work

| | What you need | How Morse uses it |
|---|---|---|
| **Claude Code** | The `claude` command, signed in with your Claude plan | Starts Claude Code with all of its tools turned off, in an empty folder, so it can only write text back. Uses `sonnet` for small tweaks and `opus` for new features and restyles (see [Quick and harder changes](#quick-and-harder-changes)) |
| **Codex** | The `codex` command, signed in with your ChatGPT plan | Starts Codex so it can only read, in an empty folder. Uses your plan's model, thinking longer for new features and restyles |
| **Anthropic API key** | A key from console.anthropic.com | Uses `claude-sonnet-5-5` for small tweaks and `claude-opus-5-5` for new features and restyles. If Claude declines a request, Morse tells you in plain words |
| **OpenAI API key** | A key from platform.openai.com, or the address of another server that works the same way | Uses `gpt-5` for small tweaks and `gpt-5` reasoning longer (high effort) for new features and restyles, unless you choose one model |

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
morse config --provider claude-code                      # Claude Code, choosing sonnet or opus each time
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

Some changes are small tweaks: bigger text, a darker color, hiding
something, more space. Others add something new: a button that sorts a
list, a count that keeps up with the app, a progress bar, a whole new look.
Those are judged by how they look and work, and they go much better with
the strongest model you have, which takes longer and uses more of your plan.

Morse chooses for you. It uses two strong models from what you set up, and
never anything else:

| You use | Small tweaks | New features, new UI and restyles |
|---|---|---|
| Claude Code | `sonnet` | `opus` |
| Anthropic API key | `claude-sonnet-5-5` | `claude-opus-5-5`, or the model you picked in the Morse popup |
| OpenAI API key | `gpt-5` | `gpt-5`, reasoning longer (`reasoning_effort: "high"`) |
| Codex | your plan's usual model, thinking a medium amount | the same model, thinking longer |
| Another server that works like OpenAI's | the names you set | the names you set |

Morse doesn't use a small model like haiku unless you ask for one (see
below). If you chose one before, Morse keeps your choice.

Codex doesn't say which models your ChatGPT plan has, so Morse keeps the
model Codex picks and only changes how long it thinks. To name two models,
use `morse config --fast-model` and `--best-model`.

In the Morse popup, the model you pick under **Model for harder changes**
is the strong one, and small tweaks use `claude-sonnet-5-5`. Pick another
model there, and Morse uses it for every change.

Morse stays with what you chose: Claude Code stays on your Claude plan, and
a key is only sent to its own service. It never moves your request to a
service you pay for separately.

### How Morse chooses

In the bar's Settings, under **Model**:

- **Automatic** (recommended). The stronger model makes the change from
  the start when it adds something or changes the whole look:
  - new UI: a panel, a button, a badge, a count, a progress bar, a timer;
  - new behavior: keys, search, copying, saving, asking first, sorting;
  - a restyle: dark mode, a theme, "make it look native", "less cluttered";
  - or two of: working with the numbers, several steps, a drawing, every
    item of a list the app keeps changing.

  Morse decides this from your words and from what it already knows about
  the page, without asking a model, so it takes no time. Everything else
  (small tweaks) uses the first model. If its change didn't work (nothing
  changed on the page, it would have hidden or broken the page, or its code
  still failed after one fix), the stronger model sees what went wrong and
  tries instead, rather than Morse giving up.
- **Always fast.** Every change uses the first model.
- **Always best.** Every change uses the stronger one.

The bar shows which model made each change, like "Claude Code · opus",
and says "Asking a stronger model" while it takes over.

You can also choose in `morse setup`, or with
`morse config --model-mode auto` (or `fast`, or `best`). To use other
models: `morse config --fast-model haiku --best-model opus`. To use one
model for everything: `morse config --model opus`. Then the Model setting
shows that model, and `morse config --model auto` lets Morse choose again.

### Speed and your plan

When the bar opens, Morse starts the first model so it is ready when you
press Enter. When you pause while typing, and your words ask for something
new, it starts the stronger model instead, so it is getting ready while you
finish. Only one model waits at a time, since each uses memory (about
180 MB for Claude Code).

Strong models use more of your plan. On a Claude plan, opus uses about
twice as much as sonnet for each change, and both use far more than haiku
did. If you keep reaching your limits, choose **Always fast** (sonnet for
everything), or name a smaller model with `--fast-model`.

In Morse's own tests (51 requests on 13 practice apps, with Claude Code),
Automatic sent about half of them, the new features and restyles, to opus
and the rest to sonnet. It got 48 of 51 right, against 47 with the old
haiku-then-sonnet choice. Small tweaks on sonnet took about 3 seconds, as
quick as haiku; changes made by opus took about 10 seconds. Details in
[evals](../evals/README.md#fast-and-strong-models-automatic).

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
