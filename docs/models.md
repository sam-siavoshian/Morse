# Models and setup

Morse doesn't come with a model, and it has no account or server of its own.
It uses a model you already have. The model writes your changes and answers
your questions. Everything else works without it: pointing, the Edit tools,
Page tools, Easier to use, Read aloud and Check this page.

## Which models work

| | What you need | How Morse uses it |
|---|---|---|
| **Claude Code** | The `claude` command, signed in with your Claude plan | Starts Claude Code with all of its tools turned off, in an empty folder, so it can only write text back. Uses `opus` for every change: thinking briefly for small ones, longer for new features, new looks and second tries (see [Quick and harder changes](#quick-and-harder-changes)) |
| **Codex** | The `codex` command, signed in with your ChatGPT plan | Starts Codex so it can only read, in an empty folder. Uses your plan's model, and thinks longer for new features and new looks |
| **Anthropic API key** | A key from console.anthropic.com | Uses `claude-opus-5-5` for every change: low effort for small ones, high effort for new features, new looks and second tries. If Claude says no to a request, Morse tells you |
| **OpenAI API key** | A key from platform.openai.com, or the address of another server that works the same way | Uses `gpt-5` for small changes, and `gpt-5` thinking longer (high effort) for new features and new looks, unless you choose one model |

Describe this picture needs a model that can look at pictures: Claude Code or
an API key. Codex can't.

When no model is connected, the bar says so, with a button to connect one.

## Choose one

The Morse app chooses for you. The first time it opens, it looks for Claude
Code, Codex and an API key on this computer, uses the first one it finds and
checks that it answers. To change it, open **Model** in the Morse app and
click **Change…**. Each choice says **Ready** or **Not installed**, and
**How to install** says what to do. See [The Morse app](desktop-app.md#model).

For developers, the `morse` command does the same: `morse setup` asks, and
`morse setup --use claude-code` (or `codex`, or `api-key --key <your key>`)
doesn't. Or set it yourself:

```bash
morse model                                              # which model Morse will use
morse config --provider claude-code                      # Claude Code: opus, thinking briefly or longer each time
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
reads `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from your terminal. A key is
only ever sent to the service it is for.

## Quick and harder changes

Some changes are small: bigger text, a darker color, hiding something, more
space. Others add something new: a button that sorts a list, a count that
keeps up with the app, a progress bar, a whole new look. New things turn out
much better with your strongest model. It takes longer and uses more of your
plan.

Morse chooses for you. It uses two strong models from what you set up, and
nothing else:

| You use | Small changes | New features, new buttons and panels, new looks |
|---|---|---|
| Claude Code | `opus`, low effort | `opus`, high effort |
| Anthropic API key | `claude-opus-5-5`, low effort | `claude-opus-5-5`, high effort |
| OpenAI API key | `gpt-5` | `gpt-5`, reasoning longer (`reasoning_effort: "high"`) |
| Codex | your plan's usual model, thinking a medium time | the same model, thinking longer |
| Another server that works like OpenAI's | the names you set | the names you set |

Morse doesn't use a small model like haiku unless you ask for one (see
below). If you chose one before, Morse keeps your choice.

Codex doesn't say which models your ChatGPT plan has. So Morse keeps the
model Codex picks and only changes how long it thinks. To name two models,
use `morse config --fast-model` and `--best-model`.

In the Morse popup, the model you pick under **Model for harder changes**
is the strong one. Small changes use `claude-sonnet-5-5`. If you pick another
model there, Morse uses it for every change.

Morse stays with what you chose. Claude Code stays on your Claude plan, and
a key is only sent to its own service. Morse never moves your request to a
service you pay for separately.

### How Morse chooses

In the bar's Settings, under **Model**:

- **Automatic** (the default). The stronger model makes the change from the
  start when it adds something or changes the whole look:
  - new parts: a panel, a button, a badge, a count, a progress bar, a timer
  - new things it does: keys, search, copying, saving, asking first, sorting
  - a new look: dark mode, a theme, "make it look native", "less cluttered"
  - or two of: working with the numbers, several steps, a drawing, every
    item of a list the app keeps changing.

  Morse decides from your words and what it knows about the page. It
  doesn't ask a model, so this takes no time. Small changes use the first
  model. Sometimes its change doesn't work: nothing changed, it would have
  hidden or broken the page, or its code still failed after one fix. Then
  the stronger model sees what went wrong and tries, so Morse doesn't give
  up.
- **Always fast.** Every change uses the first model.
- **Always best.** Every change uses the stronger one.

The bar shows which model made each change, like "Claude Code · opus",
and says "Asking a stronger model" while it takes over.

You can also choose in `morse setup`, or with
`morse config --model-mode auto` (or `fast`, or `best`). To use other
models, run `morse config --fast-model haiku --best-model opus`. To use one
model for everything, run `morse config --model opus`. Then the Model
setting shows that model. `morse config --model auto` lets Morse choose
again.

### Speed and your plan

When the bar opens, Morse starts the first model, so it is ready when you
press Enter. If you pause while typing and your words ask for something new,
it starts the stronger model instead. Then it gets ready while you finish.
Only one model waits at a time, since each uses memory (about 180 MB for
Claude Code).

Strong models use more of your plan. On a Claude plan, opus uses about twice
as much as sonnet for each change. Both use far more than haiku did. If you
keep reaching your limits, choose **Always fast** (sonnet for everything), or
name a smaller model with `--fast-model`.

Morse's own tests used 51 requests on 13 practice apps, with Claude Code.
Automatic sent about half of them (the new features and new looks) to opus,
and the rest to sonnet. 48 of 51 worked. The old haiku-then-sonnet choice
got 47. Small changes on sonnet took about 3 seconds, as quick as haiku.
Changes by opus took about 10 seconds. See the details in
[evals](../evals/README.md#fast-and-strong-models-automatic).

## In Chrome

Morse in Chrome uses the model you chose in the Morse app. In the app, click
**Use Morse in Chrome**. When Morse's welcome page opens in Chrome, the app
asks **“Allow Chrome to use your Claude Code?”**. Click **Allow**. That's
all ([Getting started](getting-started.md#3-websites-too-use-morse-in-chrome)).
The Morse popup (Chrome's toolbar button) shows which model it uses.

For developers, the popup's **Developer** section (and the welcome page with
`?dev`) has two more ways:

- **The Morse helper from a terminal.** Run `morse serve`. When the welcome
  page asks, the terminal asks you. Type `y`. Or it shows a 6-character code.
  Type the code under **Developer** and click **Pair**. `morse pair` shows a
  new code. `morse unpair` signs every browser out. When you press Stop or
  close the tab, the model on your computer stops too.
- **An Anthropic API key**, kept in this browser. Requests go straight from
  Chrome to Anthropic.

**Test the model** there sends a small real request and shows the reply.

## In desktop apps

Apps you open with the Morse app use the model you chose there. (`morse
launch` uses the one from `morse setup` or `morse config`: it is the same
choice.) There is nothing else to set up.

## Voice in desktop apps

In Chrome, Chrome turns your speech into text. In desktop apps, the Morse
helper does it in one of two ways:

- **With OpenAI**: it uses your OpenAI key from `morse config`, or
  `OPENAI_API_KEY`. Or it uses a key only for voice in
  `~/.morse/config.json`: `"voice": { "openaiKey": "sk-…" }`.
- **With Whisper on your computer**: if `whisper-cli` or `whisper` is
  installed, nothing leaves your computer.

## Check that it works

```bash
morse doctor
```

This shows your Node version and where your settings are. It shows whether
Claude Code and Codex are installed, which keys are set, whether the Morse
helper is running, and which model Morse will use. Then it sends a real test
request and shows the reply and how long it took. If something is wrong, see
[Troubleshooting](troubleshooting.md).
