import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../runtime/src/40-picker.js', import.meta.url), 'utf8');
function fixture() {
  const moves = [], picks = [], hits = [];
  const hostEl = {}, bar = { hidden: false }, hl = { hidden: true };
  const element = { classList: { add() {} }, getBoundingClientRect: () => ({ top: 700, height: 50 }) };
  const context = vm.createContext({
    S: { picking: true, open: true, target: null }, bar, hostEl, hl, hoverEl: null,
    document: { documentElement: {} },
    GodMode: { deepAt: () => { hits.push(1); return element; } },
    barDragging: () => false, barDragEatClick: () => false,
    leaveHover() {}, watchHost() {}, boxTo: () => { hl.hidden = false; }, describe: () => 'Page element',
    placeBar: r => moves.push(r), setTarget: el => picks.push(el), ours: e => e.composedPath().includes(hostEl),
    setTimeout() { throw new Error('Hover must not schedule movement'); },
  });
  vm.runInContext(src.slice(src.indexOf('function onMove(e)'), src.indexOf('// After explicit selection')), context);
  vm.runInContext(src.slice(src.indexOf('function onClick(e)'), src.indexOf('let pointerY')), context);
  const event = path => ({ isTrusted: true, clientX: 100, clientY: 700, composedPath: () => path, preventDefault() {}, stopPropagation() {} });
  return { context, moves, picks, hits, bar, hostEl, hl, event, element };
}
test('hover across page elements highlights without relocating the bar', () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) f.context.onMove(f.event([]));
  assert.equal(f.hl.hidden, false);
  assert.equal(f.moves.length, 0);
  assert.equal(f.picks.length, 0);
});
test('entering the bar clears page hover without hit-testing through it or scheduling a dodge', () => {
  const f = fixture();
  f.context.onMove(f.event([]));
  const count = f.hits.length;
  f.context.onMove(f.event([f.bar, f.hostEl]));
  assert.equal(f.hl.hidden, true);
  assert.equal(f.hits.length, count);
  assert.equal(f.moves.length, 0);
  f.context.onClick(f.event([f.bar, f.hostEl]));
  assert.equal(f.picks.length, 0);
});
test('explicit page click still selects the hovered element; synthetic hover is ignored', () => {
  const f = fixture();
  f.context.onMove({ ...f.event([]), isTrusted: false });
  assert.equal(f.hits.length, 0);
  f.context.onClick(f.event([]));
  assert.deepEqual(f.picks, [f.element]);
});
