import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterApps, nativeAction } from '../desktop-app/ui/app-list.js';
const apps = [{ name: 'Café Notes', state: 'closed' }, { name: 'Music', state: 'connected' }, { name: 'Music Studio', state: 'connecting' }];
test('native actions are limited to running browsers and native apps on macOS', () => {
  const browser = { browser: true, engine: 'chromium', running: true, state: 'open' };
  assert.equal(nativeAction(browser, 'darwin'), 'browser');
  assert.equal(nativeAction({ engine: 'native', running: true, state: 'open' }, 'darwin'), 'native');
  for (const engine of ['electron', 'cef', undefined]) assert.equal(nativeAction({ engine, running: true, state: 'connected' }, 'darwin'), null);
  for (const state of ['opening', 'connecting', 'disconnecting', 'no-answer']) assert.equal(nativeAction({ ...browser, state }, 'darwin'), null);
  assert.equal(nativeAction({ ...browser, running: false }, 'darwin'), null);
  assert.equal(nativeAction(browser, 'win32'), null);
});
test('app search handles accents, case, whitespace and multiple words without changing order', () => {
  assert.deepEqual(filterApps(apps, '  NOTES cafe '), [apps[0]]);
  assert.deepEqual(filterApps(apps, 'MUSIC'), [apps[1], apps[2]]);
  assert.deepEqual(filterApps(apps, 'missing'), []);
  assert.equal(apps.length, 3);
});
test('connected filter excludes connecting apps and combines with search', () => {
  assert.deepEqual(filterApps(apps, '', true), [apps[1]]);
  assert.deepEqual(filterApps(apps, 'studio', true), []);
  assert.deepEqual(filterApps(apps), apps);
});
