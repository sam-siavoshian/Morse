import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNativePicker } from '../desktop-app/native-picker.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function fixture(t, native = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'morse-picker-test-'));
  await fs.writeFile(path.join(dir, 'morse-native-picker'), '');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [], reports = [];
  const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
  proc.kill = () => calls.push('kill');
  const opts = { platform: 'darwin', packaged: true, resourcesPath: dir,
    run: async (...args) => { calls.push(args); return { stdout: JSON.stringify({ native }) }; },
    start: (...args) => { calls.push(args); return proc; }, report: (...args) => reports.push(args) };
  return { opts, calls, reports, proc };
}
test('native hit starts one selected-process picker and the next hotkey closes it', async t => {
  const f = await fixture(t), picker = createNativePicker(f.opts);
  assert.equal(await picker.toggle(123), true);
  assert.deepEqual(f.calls[0][1], ['--probe', '123']);
  assert.deepEqual(f.calls[1][1], ['--pick', '123']);
  assert.equal(await picker.toggle(123), true);
  assert.equal(f.calls.at(-1), 'kill');
});
test('webpage hit watches for toolbar crossover while retaining CDP picker', async t => {
  const f = await fixture(t, false), picker = createNativePicker(f.opts);
  assert.equal(await picker.toggle(123), false);
  assert.deepEqual(f.calls[1][1], ['--pick', '123', '--watch-web']);
  assert.equal(await picker.toggle(123), false, "closing the watcher also lets CDP close its bar");
});
test('denied permission is explicit and does not launch the helper', async t => {
  const f = await fixture(t);
  f.opts.run = async () => { throw Object.assign(new Error('denied'), { stdout: JSON.stringify({ code: 'accessibility-denied', error: 'Grant Accessibility' }) }); };
  assert.equal(await createNativePicker(f.opts).toggle(123), false);
  assert.deepEqual(f.reports, [['Grant Accessibility', 'accessibility-denied', null]]);
  assert.equal(f.calls.length, 0);
});
test('other platforms and invalid processes never start native control', async t => {
  const f = await fixture(t);
  assert.equal(await createNativePicker({ ...f.opts, platform: 'linux' }).toggle(123), false);
  const p = createNativePicker(f.opts);
  for (const id of [0, -1, '123', process.pid, NaN]) assert.equal(await p.toggle(id), false);
  assert.equal(f.calls.length, 0);
});
test('helper exit permits a subsequent launch and surfaces failures', async t => {
  const f = await fixture(t), p = createNativePicker(f.opts);
  await p.toggle(123);
  f.proc.stdout.emit('data', '{"error":"Target closed"}'); f.proc.emit('exit', 1);
  assert.deepEqual(f.reports, [['Target closed']]);
  assert.equal(await p.toggle(123), true);
  p.stop();
});

test('repeated hotkeys during a probe do not launch duplicate helpers', async t => {
  const f = await fixture(t);
  let release;
  f.opts.run = () => new Promise(resolve => { release = resolve; });
  const p = createNativePicker(f.opts), first = p.toggle(123);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(await p.toggle(123), true);
  release({ stdout: '{"native":true}' });
  assert.equal(await first, true);
  assert.equal(f.calls.length, 1);
  p.stop();
});

test('macOS packaging ships the helper and Rea license outside asar', async () => {
  const { builderConfig } = await import('../desktop-app/builder.config.js');
  const cfg = builderConfig({ stage: '/stage', out: '/out', res: '/res', electronVersion: '45.0.0' });
  assert.deepEqual(cfg.mac.extraResources.map(f => f.to), ['morse-native-picker', 'REA-LICENSE']);
});

test('direct Native controls opens even when pointer starts over web content', async t => {
  const f = await fixture(t, false), p = createNativePicker(f.opts);
  assert.equal(await p.toggle(123, { force: true }), true);
  assert.deepEqual(f.calls[1][1], ['--pick', '123']);
  p.stop();
});

test('access checks read actual helper trust without launching a picker or requesting permission', async t => {
  const f = await fixture(t);
  f.opts.run = async (file, args) => { f.calls.push(args); return { stdout: '{"trusted":false}' }; };
  const p = createNativePicker(f.opts);
  assert.deepEqual(await p.access(), { supported: true, trusted: false, targetName: 'Morse', canReveal: false });
  assert.deepEqual(f.calls, [['--check']]);
  assert.deepEqual(f.reports, []);
  f.opts.run = async () => ({ stdout: '{"trusted":true}' });
  assert.equal((await createNativePicker(f.opts).access()).trusted, true);
});
test('malformed access results cannot enable Continue', async t => {
  const f = await fixture(t);
  f.opts.run = async () => ({ stdout: '{}' });
  await assert.rejects(createNativePicker(f.opts).access(), /Could not check/);
});
