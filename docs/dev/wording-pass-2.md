# Wording pass 2

The second plain-words pass over every message in `core/locales/en.js`: the
bar, panels, toasts, errors, settings, the welcome page and first run, the
popup, the share page, and the `morse` command line. Each key was read and
rewritten where it could be simpler, following [the writing guide](../WRITING.md):
short everyday words, one idea per sentence, active voice, errors that say
what went wrong and what to do, no semicolons, no rhetorical questions.

Every message changed here was also rewritten in the other eight languages
(es, de, fr, pt-BR, zh-CN, ja, fa, ar) to the new meaning. Placeholders
(`{key}`, `{n}`…) and markup are the same as before.

Rule decided in this pass (now in the writing guide, under "Mod and change"):
**change** for anything not saved yet, **mod** for a saved one and wherever
the sentence names the Mods panel, a share link, a pack, install or back up.

## English messages changed (136)

| Key | Before | After |
|---|---|---|
| `bar.hint.target` | `Describe what to change about this · <kbd>Enter</kbd> to send` | `Describe a change to this · <kbd>Enter</kbd> to send` |
| `bar.hint.wider` | `<kbd>{key}</kbd> bigger part` | `<kbd>{key}</kbd> for a bigger part` |
| `voice.listening.hold` | `Listening · release to finish` | `Listening · let go to finish` |
| `voice.listening.tap` | `Listening · pause or <kbd>Esc</kbd> to finish` | `Listening · stop talking or press <kbd>Esc</kbd> to finish` |
| `voice.pageBlocks` | `This page doesn't allow the microphone` | `This page doesn't allow the microphone. Type your change instead.` |
| `voice.chrome` | `Chrome's speech recognition` | `Chrome's speech to text` |
| `voice.blocked` | `Microphone access is blocked. Allow it for this site, then try again.` | `The microphone is blocked. Allow it for this site and try again.` |
| `voice.inUse` | `The microphone is in use by another app. Close it and try again.` | `Another app is using the microphone. Close it and try again.` |
| `voice.unavailable` | `Voice isn't available in this app. Type your change instead.` | `Voice doesn't work in this app. Type your change instead.` |
| `voice.didntCatch` | `Didn't catch that. Try again.` | `Morse didn't hear any words. Try again.` |
| `toast.keptOnClose` | `Kept “{title}”. Closing the bar keeps a change.` | `Saved “{title}”. Closing the bar saves a change.` |
| `mod.problem.null` | `It expected a part of the page that isn't there.` | `It needs a part of the page that isn't there.` |
| `settings.recording.say` | `Press the new shortcut. Escape cancels.` | `Press the new shortcut. Press Escape to cancel.` |
| `settings.effects.system` | `Follows your system's motion setting` | `Follows your computer's motion setting` |
| `settings.effects.subtle` | `Subtle` | `Less` |
| `settings.model.note.auto` | `Small tweaks use {fast}. New features, restyles and second tries use {best}` | `Small changes use {fast}. New features, new looks and second tries use {best}` |
| `settings.model.note.best` | `Every change uses {best}. Slower, and uses more of your plan` | `Every change uses {best}. It is slower and uses more of your plan` |
| `settings.model.pinned` | `Always {model}, as chosen in morse config` | `Always {model}. You chose it with morse config` |
| `settings.welcome.help` | `“Morse is ready” when an app or page loads` | `Shows “Morse is ready” when an app or page opens` |
| `settings.autoFix` | `Fix my mods automatically when a site changes` | `Fix my mods when a site changes` |
| `settings.autoFix.help` | `Fixes them in the background and tells you, with Undo` | `Morse fixes them and tells you. You can undo it` |
| `hk.talk` | `Push to talk` | `Hold to talk` |
| `hk.help.talk` | `Hold to talk, release to finish` | `Hold to talk, let go to finish` |
| `hk.help.mods` | `See and manage the mods here` | `See the mods here and turn them on or off` |
| `hk.err.single` | `A single key would fire while you type. Add {need}.` | `One key alone would go off while you type. Add {need}.` |
| `hk.warn.common` | `{shown} is {what} in most apps. Morse will take it over.` | `{shown} is {what} in most apps. Morse will use it instead.` |
| `hk.warn.macAlt` | `{shown} types a special character in text fields. Morse will take it over.` | `{shown} types a special character in text boxes. Morse will use it instead.` |
| `hk.does.addressBar` | `focuses the address bar` | `jumps to the address bar` |
| `hk.does.system` | `is reserved by the system` | `is used by your computer` |
| `gm.late` | `Morse didn't hear back in time. Try again.` | `That took too long. Try again.` |
| `gm.frame` | `<b>This part is another page{from}.</b> Morse can hide, move or resize it, but can't edit what's inside.` | `<b>This part is another page{from}.</b> Morse can hide, move or resize it. It can't change what's inside.` |
| `gm.formField` | `Text in a form field can't be edited here. Press A to describe the change instead.` | `You can't edit text in a form field here. Press A to describe the change instead.` |
| `sug.readPage.p` | `Make the text on this page easier to read: a bit larger, more line height, comfortable line length` | `Make the text on this page easier to read: a bit bigger, more space between lines, and shorter lines` |
| `sug.sleep.p` | `Add a sleep timer that pauses playback after a chosen number of minutes` | `Add a sleep timer that stops playing after a number of minutes I choose` |
| `sug.biggerControls.p` | `Make these controls bigger and easier to hit` | `Make these controls bigger and easier to click` |
| `sug.readText.p` | `Make this text easier to read: a bit larger, more line height, comfortable line length` | `Make this text easier to read: a bit bigger, more space between lines, and shorter lines` |
| `sug.tidy.p` | `Make this look cleaner: consistent spacing and alignment` | `Make this look neater: even spacing, and things lined up` |
| `help.save.d` | `A change you save is called a mod. Morse brings it back next time. {key} opens the Mods panel to turn mods off, edit or share them.` | `A change you save is called a mod. Morse brings it back next time. {key} opens the Mods panel. There you can turn off, edit or share a mod.` |
| `help.save.dNoKey` | `A change you save is called a mod. Morse brings it back next time. Open the Mods panel to turn mods off, edit or share them.` | `A change you save is called a mod. Morse brings it back next time. In the Mods panel you can turn off, edit or share a mod.` |
| `help.userScripts` | `Turn on Allow User Scripts` | `Turn on “Allow User Scripts”` |
| `ob.scriptsOff` | `“Allow User Scripts” is off, so changes that add buttons or features won't run. Changes to how pages look still work.` | `“Allow User Scripts” is off. Changes that add buttons or features won't run. Changes to how pages look still work.` |
| `ob.win.body` | `A mod is a change you saved. Morse brings {mod} back every time you open {where}. {key} opens the Mods panel, to turn it off or share it.` | `A mod is a change you saved. Morse brings {mod} back every time you open {where}. {key} opens the Mods panel. There you can turn it off or share it.` |
| `ob.shareTip` | `Anyone with Morse can install it from this link, after seeing its code. The Tampermonkey download works without Morse.` | `Anyone with Morse can install it from this link. They see its code first. The Tampermonkey file works without Morse.` |
| `err.userScripts` | `This site blocks scripts that Morse adds. Turn on “Allow User Scripts” for Morse, then try again.` | `This site blocks code that Morse adds. Turn on “Allow User Scripts” for Morse and try again.` |
| `err.nothingVisible` | `The change didn't do anything you can see here. Point at the part you mean, or say it another way.` | `The change made no difference you can see. Point at the part you mean, or try other words.` |
| `err.badCode` | `The change the model wrote didn't work on this page. Try again, or describe it differently.` | `The model's change didn't work on this page. Try again, or try other words.` |
| `page.other` | `Morse works on websites (http and https). Open one, then press the Morse shortcut.` | `Morse works on websites. Open one, then press the Morse shortcut.` |
| `popup.modelHint` | `New features and restyles use this model, small tweaks claude-sonnet-5-5. Choose another model to use it for every change.` | `New features and new looks use this model. Small changes use claude-sonnet-5-5. Choose another model to use it for every change.` |
| `popup.noModel` | `No model connected yet. The welcome page connects one with a single command.` | `No model connected yet. Connect one on the welcome page. It takes one command.` |
| `welcome.lede` | `Morse changes any website the way you describe it: press <span class="hk" data-hk="open"></span>, point at something, and say what you want to change.` | `Morse changes any website the way you describe. Press <span class="hk" data-hk="open"></span>, point at something, and say what to change.` |
| `welcome.step2` | `Click the article to pick it.` | `Click the article to point at it.` |
| `welcome.practice.model` | `This page uses your model. It shows how a change looks; changes that add features work on real websites.` | `This page uses your model. It shows how a change looks. Changes that add features work on real websites.` |
| `welcome.scripts` | `Without it, changes to how a site looks still work, but new buttons and features don't run on some sites.` | `Without it, changes to how a site looks still work. New buttons and features don't run on some sites.` |
| `welcome.first` | `On the practice page, or on any website. Save it, and it's there next time.` | `Make it on the practice page or on any website. Save it to keep it for next time.` |
| `welcome.know.tabs` | `Reload them once. Chrome only adds Morse to pages loaded after it was installed.` | `Reload them once. Chrome adds Morse only to pages opened after you installed it.` |
| `welcome.know.mods` | `A change you save is called a mod. Morse brings it back every time you open that site. <span class="hk" data-hk="mods"></span> opens the Mods panel, where you can turn one off, edit it or share it.` | `A change you save is called a mod. Morse brings it back every time you open that site. <span class="hk" data-hk="mods"></span> opens the Mods panel. There you can turn a mod off, edit it or share it.` |
| `start.lede` | `Point at something, say what you want different, and watch it change. Your changes stay.` | `Point at something and say what to change. Morse changes it while you watch. Save it to keep it.` |
| `start.connect.lede` | `Morse uses a model you already have to make your changes.` | `Morse makes your changes with a model you already have.` |
| `start.step.save.d` | `Click Save. Undo takes it away.` | `Click Save. Undo puts the page back.` |
| `start.noModel` | `It doesn't have a model chosen yet.` | `It has no model yet.` |
| `start.getDesktop.web` | `Free. It uses Claude Code or Codex if you have them, and changes desktop apps too.` | `Free. It uses Claude Code or Codex if you have them. It changes desktop apps too.` |
| `start.getDesktop.d` | `Free. It opens your desktop apps with Morse, and uses Claude Code or Codex if you have them.` | `Free. It opens your desktop apps with Morse. It uses Claude Code or Codex if you have them.` |
| `start.haveDesktop` | `Already have it? <button type="button" class="link" id="open-desktop">Open Morse Desktop</button>.` | `If you have it, <button type="button" class="link" id="open-desktop">open Morse Desktop</button>.` |
| `start.key.more` | `Only websites for now? Use an Anthropic API key` | `For websites only, you can use an Anthropic API key` |
| `start.terminal.d` | `Have Node and the morse command? Paste this in a terminal and press Enter. This page connects by itself.` | `If you have Node and the morse command, paste this in a terminal and press Enter. This page connects by itself.` |
| `start.practice.model` | `This page uses {label}. It shows how a change looks; changes that add buttons work on real websites.` | `This page uses {label}. It shows how a change looks. Changes that add buttons work on real websites.` |
| `start.win.sample.d` | `Connect a model, and Morse makes any change you describe, on any site.` | `Connect a model so Morse can make any change you describe, on any site.` |
| `start.win.help` | `{mods} opens the Mods panel, where you turn mods off, change them or share them. In the bar, F1 shows example sentences. Tabs that were open before you added Morse need one reload.` | `{mods} opens the Mods panel. There you can turn mods off, change them or share them. In the bar, F1 shows examples. Reload tabs that were open before you added Morse.` |
| `allow.d` | `This change adds a button or a feature. Chrome asks you to allow that yourself, once.` | `This change adds a button or a feature. Chrome needs you to allow that once.` |
| `sum.clicks` | `Reacts when you click, scroll or point` | `Does something when you click, scroll or point` |
| `sum.typing` | `Reads what you type in this page` | `Reads what you type on this page` |
| `sum.typing.detail` | `Including text you enter in boxes and fields.` | `This includes text you type in boxes.` |
| `sum.clipboard.detail` | `Copying, and possibly reading what you copied.` | `It copies, and may read what you copied.` |
| `sum.dynamic` | `Runs code it builds while running` | `Makes new code while it runs` |
| `sum.dynamic.detail` | `So the code below may not show everything it does.` | `The code below may not show everything it does.` |
| `sum.note.network` | `This mod can send information from this page to another website, including things you see or type here. Install it only if you trust the person who shared it.` | `This mod can send what you see or type on this page to another website. Install it only if you trust the person who shared it.` |
| `sum.note.dynamic` | `Part of this mod's code is put together while it runs, so reading it won't tell you everything it does.` | `Part of this mod's code is made while it runs. Reading the code won't show everything it does.` |
| `origin.file` | `Imported from a file{by}{on}` | `Installed from a file{by}{on}` |
| `install.nav.what` | `What is Morse?` | `About Morse` |
| `install.foot` | `A mod is a change to a website or app, made with Morse. Morse brings it back every time you open that site or app. The whole mod is in this link, after the <code>#</code>. Browsers never send that part to a server. The list above comes from reading the code. After you install it, <kbd>⌥⇧0</kbd> (Alt+Shift+0) turns off every mod on a page.` | `A mod is a change someone saved with Morse. Morse brings it back every time you open that site or app. The whole mod is in this link, after the <code>#</code>. Browsers never send that part to a server. The list above comes from reading the code. After you install it, <kbd>⌥⇧0</kbd> (Alt+Shift+0) turns off every mod on a page.` |
| `install.copied.web` | `Morse isn't installed in this browser. The link is copied: paste it into Morse under Mods → Install a mod…, or download the mod for Tampermonkey.` | `Morse isn't installed in this browser. The link is copied. Paste it into Morse under Mods → Install a mod…, or download the mod for Tampermonkey.` |
| `cli.serve.inUse` | `Port {port} is already in use, probably by a Morse helper that is already running. Run morse pair to get a new code for it.` | `Another program is using port {port}. It's probably a Morse helper that's already running. Run morse pair to get a new code for it.` |
| `setup.why.key` | `Anthropic or OpenAI, paid per use` | `Anthropic or OpenAI, you pay for what you use` |
| `setup.install.key` | `create one at console.anthropic.com or platform.openai.com` | `get one at console.anthropic.com or platform.openai.com` |
| `setup.start1` | `Welcome to Morse. First, run {cmd} to choose what writes your changes: Claude Code, Codex or an API key.` | `Welcome to Morse. First, run {cmd} to choose what makes your changes: Claude Code, Codex or an API key.` |
| `setup.looking` | `Looking for something that can write your changes…` | `Looking for Claude Code, Codex or an API key…` |
| `setup.model.which` | `Which model should write your changes?` | `Which model should make your changes?` |
| `setup.model.autoWhy` | `{fast} for small tweaks, {best} for new features and restyles` | `{fast} for small changes, {best} for new features and new looks` |
| `setup.model.now` | `Small tweaks use {fast}, new features and restyles {best}.` | `Small changes use {fast}. New features and new looks use {best}.` |
| `setup.leaveOpen` | `Leave this window open while you use Morse in Chrome. Ctrl+C stops it, and morse serve starts it again.` | `Leave this window open while you use Morse in Chrome. Ctrl+C stops it. morse serve starts it again.` |
| `launch.stopped` | `Disconnected from {name}. It keeps running without Morse. Its debugging port closes when you quit it.` | `Disconnected from {name}. It keeps running without Morse. Until you quit it, Morse can connect again.` |
| `launch.waiting` | `Opening {name}. Morse is already waiting for it on port {port} and will connect.` | `Opening {name}. Morse will connect when it opens (port {port}).` |
| `launch.openWithPort` | `{name} is already open with a debugging port. Connecting to it.` | `{name} is already open and ready for Morse. Connecting to it.` |
| `launch.waitingPipe` | `Morse is already waiting for {name}. It opens it now and connects.` | `Morse is already waiting for {name}. Opening it now and connecting.` |
| `launch.noPipe` | `{name} didn't answer on Morse's private pipe (Electron 9 and older don't have one), so Morse opens it with a debugging port instead.` | `{name} didn't answer on Morse's private connection. Apps on Electron 9 or older don't have one. Morse opens it with a debugging port instead.` |
| `ctl.suspect` | `“{title}” is off for now. This page closed or reloaded within seconds after it ran, more than once.` | `“{title}” is off for now. More than once, this page closed or reloaded a few seconds after it ran.` |
| `ctl.keptOff` | `“{title}” is turned off. You can turn it on again in the Mods panel.` | `“{title}” is off. Turn it back on in the Mods panel.` |
| `ctl.trySub` | `Here is what it does. Nothing runs until you press Try it, and nothing is saved.` | `Here is what it does. Nothing runs until you press Try it. Nothing is saved.` |
| `ctl.cancelled` | `Not installed. You cancelled it.` | `Cancelled. Nothing was installed.` |
| `ctl.heldNote` | `“{title}” is held back: this page closed or reloaded right after it ran.` | `“{title}” is off for now. This page closed or reloaded right after it ran.` |
| `ctl.exportAll` | `Export all mods` | `Back up all mods` |
| `guard.note.loop` | `It kept running again every time the page changed.` | `It ran again every time the page changed.` |
| `guard.pausedChange` | `Paused this change {because}. Try describing it another way.` | `Paused this change {because}. Try other words.` |
| `err.harmHide` | `The change would have hidden this whole page, so Morse didn't apply it. Try other words.` | `The change would have hidden this whole page, so Morse didn't run it. Try other words.` |
| `ask.follows` | `one: follows {n} earlier question / other: follows {n} earlier questions` | `one: remembers {n} earlier question / other: remembers {n} earlier questions` |
| `ask.cantSee` | `Can't see it yet. It may be inside a menu that's closed: go back a step.` | `Can't see it yet. It may be in a closed menu. Go back a step.` |
| `ask.hiddenNamed` | `“{label}” isn't showing right now. It may be inside a menu that's closed.` | `“{label}” isn't showing right now. It may be in a closed menu.` |
| `ask.hidden` | `That isn't showing right now. It may be inside a menu that's closed.` | `That isn't showing right now. It may be in a closed menu.` |
| `so.cancelled` | `Cancelled. No steps were kept.` | `Cancelled. No steps were saved.` |
| `au.ok` | `No pictures without descriptions, unnamed buttons, unlabeled fields, faint text, tiny targets or autoplaying media found.` | `Found no pictures without descriptions, unnamed buttons, unlabeled fields, faint text, tiny targets, or video and sound that play by themselves.` |
| `au.help.contrastRatio` | `The text is too light for its background (as low as {ratio} to 1; 4.5 to 1 is the minimum).` | `The text is too light for its background. It goes as low as {ratio} to 1. It needs at least 4.5 to 1.` |
| `au.help.autoplay` | `Moving or sounding content is distracting and hard to stop.` | `Things that move or make sound by themselves are distracting and hard to stop.` |
| `ds.offScreen` | `The picture isn't on screen. Scroll to it and try again` | `The picture isn't on screen. Scroll to it and try again.` |
| `ds.noDescription` | `The model's answer had no description in it. Try again` | `The model's answer had no description in it. Try again.` |
| `gl.submittedFile` | `Opened GitHub to send your mod to the gallery. It's too long for the link, so it was saved{to}. Attach that file there.` | `Opened GitHub to send your mod to the gallery. The mod is too long for a link, so Morse saved it as a file{to}. Add that file there.` |
| `ys.dark.help` | `Light pages turn dark; dark ones stay as they are` | `Light pages turn dark. Dark pages stay the same` |
| `wait.tagTitle` | `It runs, look and all, once “Allow User Scripts” is on.` | `It runs fully once “Allow User Scripts” is on.` |
| `modal.covered` | `This page kept covering Morse's review, so Morse closed it. Nothing was installed.` | `This page kept covering Morse's window, so Morse closed it. Nothing was installed.` |
| `guard.refused.hide` | `Morse didn't apply it: <i>it would have hidden this whole page</i>` | `Morse didn't run it: <i>it would have hidden this whole page</i>` |
| `pk.whyUnticked` | `Not ticked: tick it if you want it.` | `Not ticked. Tick it if you want it.` |
| `pk.clash` | `You already have a mod with this id: “{title}”.` | `You already have this mod: “{title}”.` |
| `pk.makeSub` | `Share these mods together. Anyone with Morse can install them, and untick any they don't want.` | `Share these mods together. Anyone with Morse can install them. They can untick any they don't want.` |
| `gl.err.unreadable` | `The gallery list isn't readable.` | `Morse couldn't read the gallery list.` |
| `pk.err.clash` | `You already have a mod with the id {id} (“{title}”). Choose whether to keep both or replace yours.` | `You already have this mod ({id}, “{title}”). Choose Keep both or Replace yours.` |
| `pk.err.redirect` | `This address sends Morse on to one that isn't https://, so Morse didn't read it. Check the address and try again.` | `This address leads to one that isn't https://, so Morse stopped. Check the address and try again.` |
| `pk.err.noFiles` | `This version of Morse can't save files.` | `This version of Morse can't save files. Update Morse and try again.` |
| `install.pk.foot` | `A pack is a few mods shared together. A mod is a change to a website or app, made with Morse. When you install the pack, you can untick the mods you don't want. The whole pack is in the link, after the <code>#</code>. Browsers never send that part to a server. The lists above come from reading the code.` | `A pack is a few mods shared together. A mod is a change someone saved with Morse. When you install the pack, you can untick the mods you don't want. The whole pack is in the link, after the <code>#</code>. Browsers never send that part to a server. The lists above come from reading the code.` |
| `install.pk.copied` | `Morse isn't installed in this browser. The link is copied: paste it into Morse under Mods → Install a mod…, or run <code>morse pack install "&lt;link&gt;"</code> in a terminal.` | `Morse isn't installed in this browser. The link is copied. Paste it into Morse under Mods → Install a mod…, or run <code>morse pack install "&lt;link&gt;"</code> in a terminal.` |
| `help.launch.restart` | `quit the app first if it's open (remembered per app; --no-restart forgets)` | `quit the app first if it's open (remembered for each app, --no-restart forgets)` |
| `help.launch.name` | `name mods are filed under (defaults to the app)` | `the name to save mods under (the app's name if you leave it out)` |
| `help.model.note` | `(bring your own: Claude Code, Codex, or an API key)` | `(use one you have: Claude Code, Codex or an API key)` |
| `help.install.more` | `(says what each mod does and asks first; --yes to skip asking)` | `(says what each mod does and asks first, --yes skips asking)` |
| `help.resume.all` | `--all also resumes every single site` | `--all also resumes each site you paused` |
| `help.foot.off` | `Press {key} to turn all your mods off (press it again to turn them back on).` | `Press {key} to turn all your mods off. Press it again to turn them back on.` |
| `setup.help.mode` | `Automatic (recommended): the fast model for small tweaks, the best one for new features and restyles. Or always the fast one, or always the best` | `Automatic (recommended): the fast model for small changes, the best one for new features and new looks. Or always the fast one, or always the best` |
| `setup.help.foot` | `Setup checks that the model answers. Run it again any time to switch; {doctor} checks again.` | `Setup checks that the model answers. Run it again any time to switch. {doctor} checks again.` |

## Translations fixed where English stayed the same (9)

Semicolons the English never had, and the English word "mod" left inside
Persian, Arabic, Chinese and Japanese text.

| Key | Language | Before | After |
|---|---|---|---|
| `setup.fix.signIn` | es | `Ejecuta {cmd} una vez en una terminal e inicia sesión; luego vuelve a ejecutar {setup}.` | `Ejecuta {cmd} una vez en una terminal e inicia sesión. Luego vuelve a ejecutar {setup}.` |
| `start.win.h` | zh-CN | `你的第一个 mod 已保存。` | `你的第一个模组已保存。` |
| `start.win.lede` | zh-CN | `mod 就是你保存的改动。每次打开那个网站或应用，Morse 都会把它带回来。` | `模组就是你保存的改动。每次打开那个网站或应用，Morse 都会把它带回来。` |
| `start.win.h` | ja | `最初の mod を保存しました。` | `最初の MOD を保存しました。` |
| `start.win.lede` | ja | `mod とは保存した変更のことです。そのサイトやアプリを開くたびに、Morse が元に戻してくれます。` | `MOD とは保存した変更のことです。そのサイトやアプリを開くたびに、Morse が戻します。` |
| `start.win.h` | fa | `اولین mod شما ذخیره شد.` | `اولین ماد شما ذخیره شد.` |
| `start.win.lede` | fa | `mod تغییری است که ذخیره کرده‌اید. Morse هر بار که آن سایت یا برنامه را باز کنید، آن را برمی‌گرداند.` | `ماد تغییری است که ذخیره کرده‌اید. Morse هر بار که آن سایت یا برنامه را باز کنید، آن را برمی‌گرداند.` |
| `start.win.h` | ar | `تم حفظ أول mod لك.` | `حُفظ أول تعديل لك.` |
| `start.win.lede` | ar | `الـ mod تغيير حفظته. يعيده Morse في كل مرة تفتح فيها ذلك الموقع أو التطبيق.` | `التعديل تغيير حفظته. يعيده Morse في كل مرة تفتح فيها ذلك الموقع أو التطبيق.` |
