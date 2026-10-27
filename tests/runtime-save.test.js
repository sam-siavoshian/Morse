// Exercise the real save transaction without a browser or an AI connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../runtime/src/60-generate.js', import.meta.url), 'utf8');
const keepSource = source.slice(source.indexOf('async function keep('), source.indexOf('// Undo on that toast:'));
function harness() {
  let resolve, reject;
  const controls = [{ disabled: false }, { disabled: true }];
  const classes = new Set();
  const attributes = new Map();
  const state = { phase: 'result', draft: { id: 'draft', title: 'Readable text', request: 'Make text larger', css: '', js: '' }, mods: [] };
  const view = { calls: 0, closed: 0, error: null, saved: null };
  const context = vm.createContext({
    S: state, bar: { querySelectorAll: () => controls, classList: { add: v => classes.add(v), remove: v => classes.delete(v) }, setAttribute: (k, v) => attributes.set(k, v) },
    hint: {}, actions: { querySelector: () => ({}) }, location: { href: 'https://example.test' },
    hideMenu() {}, t: id => id, announce() {}, plainError: e => e.message || String(e),
    call() { view.calls++; return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    showResult(draft, options) { view.error = options; state.phase = 'result'; },
    closeBar() { view.closed++; }, Health: { ran() {} }, Heal: { kept() {} }, versionsOf: () => [],
    toast(message) { view.saved = message; }, controlToast(message) { view.saved = message; },
  });
  vm.runInContext(keepSource, context);
  return { keep: options => context.keep(options), state, view, controls, classes, attributes,
    resolve: () => resolve({ id: 'draft', title: 'Readable text' }), reject: () => reject(new Error('Disk full')) };
}
test('save locks controls, prevents duplicate writes, and closes only after success', async () => {
  const h = harness();
  const first = h.keep();
  const duplicate = h.keep();
  assert.equal(h.view.calls, 1);
  assert.equal(h.view.closed, 0);
  assert.equal(h.attributes.get('aria-busy'), 'true');
  assert.ok(h.controls.every(el => el.disabled));
  h.resolve();
  await Promise.all([first, duplicate]);
  assert.equal(h.view.closed, 1);
  assert.equal(h.state.mods.length, 1);
  assert.equal(h.attributes.get('aria-busy'), 'false');
  assert.deepEqual(h.controls.map(el => el.disabled), [false, true]);
});
test('failed save preserves the preview, restores controls, and allows retry', async () => {
  const h = harness();
  const draft = h.state.draft;
  const first = h.keep({ closed: true });
  const duplicate = h.keep();
  h.reject();
  assert.equal(await first, null);
  assert.equal(await duplicate, null);
  assert.equal(h.state.draft, draft);
  assert.equal(h.state.mods.length, 0);
  assert.equal(h.view.closed, 0);
  assert.equal(h.view.error.saveError, true);
  assert.equal(h.view.error.keepInput, true);
  assert.equal(h.view.error.error, 'Disk full');
  assert.equal(h.classes.has('saving'), false);
  assert.equal(h.controls[0].disabled, false);
  const retry = h.keep();
  h.resolve();
  await retry;
  assert.equal(h.view.calls, 2);
  assert.equal(h.view.closed, 1);
});
