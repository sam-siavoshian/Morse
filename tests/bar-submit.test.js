import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../runtime/src/50-bar.js', import.meta.url), 'utf8');
const start = source.indexOf('input.addEventListener("keydown", e => {');
const end = source.indexOf('// speed, models:', start);
function submit(phase, value, extra = {}) {
  const calls = [];
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    input: { value, addEventListener: (_, fn) => { handler = fn; } },
    S: { phase }, send: v => calls.push(['send', v]), keep: () => calls.push(['save']),
  });
  handler({ key: 'Enter', stopPropagation() {}, preventDefault() {}, ...extra });
  return calls;
}
test('Enter saves an empty preview once and submits a follow-up once', () => {
  assert.deepEqual(submit('result', '   '), [['save']]);
  assert.deepEqual(submit('result', '  make it blue '), [['send', 'make it blue']]);
  assert.deepEqual(submit('idle', ''), []);
});
test('composition and modified Enter never submit or save', () => {
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    assert.deepEqual(submit('result', '', extra), []);
  }
});
