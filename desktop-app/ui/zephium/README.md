# Zephium onboarding port

Source: https://github.com/zephium-browser/Zephium/tree/276b1ba8a1e6e74966fbb0688ff61ff351dc4931/frame/src/features/onboarding

The CSS in this directory is copied from Onboarding.svelte, Window.svelte,
steps/Models.svelte, shared/ui/Button, and styles/tokens (MPL-2.0).
Selectors are scoped and renamed for vanilla DOM. camera.js is a JavaScript
port of lib/camera.ts. Sky images come from shared/sky/assets.

Morse supplies its own copy, setup actions, and content in the scenes. The
stage proportions, camera shots, typography, tokens, controls, and card
metrics come from upstream. morse.css contains the integration adjustments.
The neutral opaque material is used for portability; native Tauri vibrancy
is not part of this Electron port.
