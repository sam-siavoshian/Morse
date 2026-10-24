# Show me once

Do a task by hand once, and Morse writes down the steps. Then say what to do
with them:

- “add a button that does this”
- “do this when I press Ctrl+Shift+A”
- “do this to every unread email”

The model writes a mod that does the steps for you. Save, change or undo it
like any change.

## How to use it

1. Open Morse and choose **Show me once**. It is under the box in the empty
   bar, and in the **⋯** menu.
2. Do the task by hand: click, type, choose, press keys. A small strip lists
   each step in plain words as you go: *Click “Archive”*, *Type “invoice” in
   “Search mail”*.
3. Click **Stop**. The bar opens with your steps.
4. Say what you want done with them, and press **Enter**.

Morse sends the steps to the model in order. Each step says what you used
and how to find it again. The mod waits for each thing to appear before it
does the next step.

## What Morse writes down

- **Passwords and card numbers stay yours.** In a password field, or a field
  marked for card details, the step says “(hidden)” and what you typed is
  never kept. The mod stops at that field and asks you to type it.
- **Only what you do, only here.** Morse writes down your own clicks and keys
  on this page while the strip shows. It leaves out what the page does by
  itself, other frames on the page, and Morse itself.
- **Esc** cancels. Nothing is sent until you say what to do and press
  **Enter**.

## How well it works

Tested with real Claude Code (haiku) on a demo mail app. “Do this to every
unread email” made an **Archive unread** button. In 10 of 12 runs, it
archived all 4 unread emails and kept the 6 read ones. In the other 2, the
model forgot to put the button on the page. Each run took about 10 to 25
seconds. “Do this when I press Ctrl+Shift+A” worked every time.

For developers: the steps come from
[`core/showonce.js`](../core/showonce.js) and
[`runtime/src/64-show-once.js`](../runtime/src/64-show-once.js), the check is
[`evals/show-once.js`](../evals/show-once.js), and the screenshots come from
[`demo/shoot-show-once.js`](../demo/shoot-show-once.js).
