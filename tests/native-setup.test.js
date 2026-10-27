import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function setup() {
  const calls = [], ids = new Map(), events = {};
  function node(tag, props = {}, ...kids) {
    const n = { tag, ...props, children: kids.flat().filter(Boolean), textContent: props.text || kids.filter(k => typeof k === 'string').join(''), hidden: false,
      append(...v) { this.children.push(...v); }, classList: { toggle() {} }, replaceChildren(...v) { this.children = v; },
      setAttribute() {}, removeAttribute() {}, focus() {}, scrollIntoView() {}, contains() { return false; }, querySelector() { return null; } };
    if (props.id) ids.set(props.id, n);
    return n;
  }
  node('section', { id: 'native-setup', hidden: true }); ids.get('native-setup').hidden = true;
  node('ul', { id: 'app-list' });
  node('ul', { id: 'first-apps' });
  node('div', { id: 'native-setup-home' });
  const row = node('li');
  ids.get('app-list').querySelector = () => row;
  ids.get('first-apps').querySelector = () => row;
  let trusted = false;
  const api = {
    nativeControls: async id => { calls.push(['open', id]); return trusted ? { ok: true } : { permissionNeeded: true, access: { trusted, targetName: 'Morse Native Controls', canReveal: true } }; },
    nativeSetup: async action => { calls.push([action]); return { trusted, targetName: 'Morse Native Controls', canReveal: true }; },
  };
  const context = { Set, CSS: { escape: s => s }, document: { activeElement: null },
    window: { addEventListener: (e, fn) => { events[e] = fn; } },
    morse: api, $: id => ids.get(id), h: node, setupIcon: () => node("svg"), t: key => key, appError() {}, errorText: e => e.message || String(e) };
  const source = readFileSync(new URL('../desktop-app/ui/app.js', import.meta.url), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('const nativePending ='), source.indexOf('\nfunction appRow(')) + '\nglobalThis.testAPI = {inspectNative, checkNativeAccess, dismissNativeGuide, nativeSetupAction, setupNativeForApp};', context);
  const all = () => { const out = []; const visit = n => { if (!n || typeof n !== 'object') return; out.push(n); n.children?.forEach(visit); }; visit(ids.get('native-setup')); return out; };
  return { ...context.testAPI, ids, calls, api, events, all, node, trust: () => { trusted = true; } };
}

test('permission guide is contextual, dismissible, and never enables Continue before a real check', async () => {
  const s = setup();
  assert.equal(s.ids.get('native-setup').hidden, true);
  assert.equal(s.calls.length, 0, 'no startup permission probes');
  await s.inspectNative({ id: 'chrome', name: 'Chrome' }, s.node('button'));
  assert.equal(s.ids.get('native-setup').hidden, false);
  assert.ok(s.all().some(n => n.class === 'native-setup-instructions'));
  assert.ok(s.ids.get('app-list').querySelector().children.includes(s.ids.get('native-setup')), 'guide belongs to the app row');
  assert.ok(s.all().some(n => n.textContent === 'desk.native.reveal'));
  assert.ok(!s.all().some(n => n.textContent === 'desk.native.continue'));
  await s.checkNativeAccess();
  assert.ok(s.all().some(n => n.textContent === 'desk.native.off'));
  s.trust(); await s.checkNativeAccess();
  assert.ok(s.all().some(n => n.textContent === 'desk.native.ready'));
  assert.ok(s.all().some(n => n.textContent === 'desk.native.continue'));
  assert.equal(s.calls.filter(c => c[0] === 'open').length, 1, 'checking never operates an app');
  s.dismissNativeGuide();
  assert.equal(s.ids.get('native-setup').hidden, true);
  s.events.focus();
  assert.equal(s.ids.get('native-setup').hidden, true);
});
test('a pending check cannot resurrect a dismissed guide', async () => {
  const s = setup();
  await s.inspectNative({ id: 'chrome', name: 'Chrome' }, s.node('button'));
  let release;
  s.api.nativeSetup = () => new Promise(r => { release = r; });
  const pending = s.checkNativeAccess();
  s.dismissNativeGuide(); release({ trusted: true }); await pending;
  assert.equal(s.ids.get('native-setup').hidden, true);
});

test('onboarding checks access without operating the app and allows continuing after approval', async () => {
  const s = setup();
  await s.setupNativeForApp({ id: 'chrome', name: 'Chrome' }, s.node('button'));
  assert.deepEqual(s.calls, [['status']]);
  assert.ok(s.ids.get('first-apps').querySelector().children.includes(s.ids.get('native-setup')));
  s.trust(); await s.checkNativeAccess();
  const next = s.all().find(n => n.textContent === 'desk.ob.continue');
  assert.ok(next);
  await next.onclick({currentTarget: next});
  assert.equal(s.ids.get('native-setup').hidden, true);
  assert.equal(s.calls.some(c => c[0] === 'open'), false);
});
