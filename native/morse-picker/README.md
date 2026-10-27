# Native picker for Morse

This macOS helper extends Morse outside web content. Put the pointer over a
native app control and press the configured Morse hotkey. The helper outlines
controls exposed by that app's accessibility API. Press Return to select, then
use Press, increment/decrement, or Set value when the app exposes that operation.
Escape, the close button, or the Morse hotkey closes the picker. Pick again
returns to hovering. Starting over web content retains Morse's existing page
picker and watches for movement into native controls. The Native controls button
on an app's row opens the picker independently of global hotkey registration.

Requires macOS Accessibility permission for the responsible host application
(Morse in a packaged build; the development helper may need its own entry).
Development uses the stable `Morse Native Controls.app` in Morse's user-data
`native-picker` directory. When access is missing, the app row opens an inline
setup guide with a Settings link and a way to reveal this exact app for adding
it with Accessibility's + button. The guide checks access once on return from
Settings, offers a manual check, and can be dismissed without repeated prompts.
A permission previously granted to
Electron does not establish that the helper is trusted. The helper never
changes that permission automatically. No Screen Recording permission is needed.

## Rea provenance

Upstream: https://github.com/morluto/rea
Revision: f061989ad255c994e0e2eec072150b5374a2c5f5 (6.8.0)

`rea/NativeUIValues.swift` is copied from Rea's `bridge/native/NativeUIValues.swift`.
The AX attribute/bounds reading, process ownership check, and selected-element
action dispatch in `main.swift` adapt `bridge/native/ReaNativeUI.swift`.
The MIT license is preserved in `rea/LICENSE` and shipped as `REA-LICENSE`.
Morse adds hover hit-testing, a highlight panel, selection, and hotkey routing.

## Scope

This is native selection and direct manipulation, not arbitrary native redesign.
It does not inject into or patch app binaries, attach a debugger, or enable a
model to operate arbitrary software. Natural-language native modifications,
saved native mods, Windows/Linux native picking, and Rea's binary-analysis
workflows are not implemented. Unsupported actions stay disabled; secure text
values are neither read nor edited. App ownership and launch identity are checked
before actions. Closed/stale controls produce errors instead of coordinate clicks.

## Build

Development builds compile when the source hash changes into a stable, ad-hoc
signed helper app in Morse's user-data cache
using Xcode Command Line Tools. Packaged macOS builds include a universal helper
(arm64 and x86_64), so end users do not need Swift or Rea installed.

```
xcrun swiftc native/morse-picker/main.swift native/morse-picker/rea/NativeUIValues.swift -o /tmp/morse-native-picker
/tmp/morse-native-picker --check
node --test tests/native-picker.test.js
```

The permission check does not request permission. Live hover/actions require a
manual test after the user grants Accessibility; unit tests cover routing,
permission denial, process selection, and helper lifecycle.
