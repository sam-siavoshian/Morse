import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../desktop-app/ui/app.js', import.meta.url), 'utf8');
const navigation = source.slice(source.indexOf('const navButtons ='), source.indexOf('for (const b of navButtons)'));
function fixture() {
  const ids = ['apps', 'model', 'mods', 'settings'];
  const buttons = ids.map(tab => ({ dataset: { tab }, current: false,
    setAttribute() { this.current = true; }, removeAttribute() { this.current = false; },
    focus() { document.activeElement = this; } }));
  const panels = ids.map(id => ({ id, hidden: false, contains: el => el?.panel === id }));
  const main = { scrollTop: 0 };
  const document = { activeElement: null, querySelector: () => main,
    querySelectorAll: selector => selector.startsWith('.side') ? buttons : panels };
  const context = vm.createContext({ document, sessionStorage: { setItem() {} }, recording: false,
    stopRecording() { context.recording = false; }, hideUndo() {},
    $: () => ({ children: [1] }) });
  vm.runInContext(navigation, context);
  return { context, buttons, panels, main, document, show: tab => context.show(tab) };
}
test('repeat clicks preserve scroll; page switches restore each page position', () => {
  const f = fixture();
  f.show('apps'); f.main.scrollTop = 420; f.show('apps');
  assert.equal(f.main.scrollTop, 420);
  f.show('mods'); assert.equal(f.main.scrollTop, 0);
  f.main.scrollTop = 130; f.show('apps'); assert.equal(f.main.scrollTop, 420);
  f.show('mods'); assert.equal(f.main.scrollTop, 130);
});
test('rapid switches select exactly one matching panel, including legacy and invalid routes', () => {
  const f = fixture();
  for (const [route, expected] of [['settings','settings'], ['apps','apps'], ['mods','mods'], ['checks','model'], ['invalid','apps']]) {
    f.show(route);
    assert.deepEqual(f.buttons.filter(b => b.current).map(b => b.dataset.tab), [expected]);
    assert.deepEqual(f.panels.filter(p => !p.hidden).map(p => p.id), [expected]);
  }
});
test('leaving settings ends shortcut capture and moves focus out of hidden content', () => {
  const f = fixture(); f.show('settings'); f.context.recording = true;
  f.document.activeElement = { panel: 'settings' };
  f.show('apps');
  assert.equal(f.context.recording, false);
  assert.equal(f.document.activeElement, f.buttons[0]);
});
