import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const core = process.env.MORSE_RELIABILITY_CORE ? pathToFileURL(process.env.MORSE_RELIABILITY_CORE + '/') : new URL('../core/', import.meta.url);
const { runMorse } = await import(new URL('engine.js', core));
const { registerProvider } = await import(new URL('providers.js', core));
const reply = (css = '', js = '') => `TITLE: Test change\n\`\`\`css\n${css}\n\`\`\`\n\`\`\`js\n${js}\n\`\`\``;
let id = 0;
function host(replies, extra = {}) {
  const provider = extra.polish ? "demo" : `reliability-${++id}`, events = [], runs = [];
  registerProvider(provider, async (_, messages, { onToken } = {}) => { const r = replies.length > 1 ? replies.shift() : replies[0]; onToken?.(r); return r; });
  return { events, runs, args: { settings: { provider }, request: 'make this work', context: { url: 'https://app.test', title: 'App' }, emit: e => events.push(e), exec: async js => { runs.push(js); return { ok: true }; }, ...extra } };
}
test('last attempt cannot bypass app command validation', async () => {
  const h = host([reply('', 'morse.app.command("not-a-command");')], { vet: () => 'Unknown app command', maxAttempts: 1 });
  const r = await runMorse(h.args);
  assert.equal(r.ok, false);
  assert.equal(h.runs.some(js => js.includes('not-a-command')), false);
});
test('last attempt cannot accept a notice in place of the feature', async () => {
  const h = host([reply('', 'morse.toast("Done");')], { maxAttempts: 1 });
  const r = await runMorse(h.args);
  assert.equal(r.ok, false);
});

test('truncated code cannot be executed or saved as a complete feature', async () => {
  const h = host(['TITLE: Incomplete\n```js\npartialFeature();'], { maxAttempts: 1 });
  const r = await runMorse(h.args);
  assert.equal(r.ok, false);
  assert.equal(h.runs.some(js => js.includes('partialFeature')), false);
  assert.match(r.error, /code block was closed/);
});
test('a retry removes the previous JavaScript even when the replacement is CSS only', async () => {
  let active = false;
  const h = host([reply('', 'partialFeature();'), reply('body { color: red !important; }')], { exec: async js => { active = !!js; return js ? { ok: false, error: 'late callback failed' } : { ok: true }; } });
  const r = await runMorse(h.args);
  assert.equal(r.ok, true);
  assert.equal(active, false, 'no failed buttons/listeners survive the replacement');
});
test('exhausted retries remove both preview CSS and JavaScript', async () => {
  let active = false, css = '';
  const h = host([reply('.broken { color: red; }', 'partialFeature();')], { exec: async js => { active = !!js; return { ok: !js, error: 'failed' }; }, emit: e => { if(e.type === 'css') css = e.css; } });
  const r = await runMorse(h.args);
  assert.equal(r.ok, false);
  assert.equal(active, false);
  assert.equal(css, '');
  assert.equal(r.js, '');
});

test('cancellation while applying removes the preview instead of accepting it', async () => {
  const controller = new AbortController();
  let active = false, css = '';
  const h = host([reply('body { color: red; }', 'partialFeature();')], {
    signal: controller.signal,
    exec: async js => { active = !!js; if (js) controller.abort(); return { ok: true }; },
    emit: e => { if (e.type === 'css') css = e.css; },
  });
  await assert.rejects(runMorse(h.args), /aborted/);
  assert.equal(active, false);
  assert.equal(css, '');
});
test('a decorative UI change cannot hide that all behavior targets are missing', async () => {
  let probes = 0;
  const h = host([reply('.badge { color: inherit; }', 'morse.watch("#missing-player", el => el.title = "ready");')], { maxAttempts: 1, probe: async sels => ({ fp: ++probes === 1 ? 'before' : 'decorative-badge', unmatched: sels, shown: 2 }) });
  const r = await runMorse(h.args);
  assert.equal(r.ok, false);
  assert.equal(r.noEffect, true);
});
test('visual polish cannot replace a working feature with selectors that match nothing', async () => {
  let active = '', css = '';
  const good = reply('.counter { color: inherit; }', 'morse.watch("#toolbar", el => el.append(morse.el("span", {class:"counter", text:"Count: 1"})));');
  const bad = reply('.counter { color: inherit; padding: 4px; }', 'morse.watch("#missing-toolbar", el => el.append(morse.el("span", {class:"counter", text:"Count: 1"})));');
  const h = host([good, bad], { request: 'add a count', polish: true, review: async () => ({data:'ZmFrZQ==',mediaType:'image/png'}),
    exec: async js => { active = js; return {ok:true}; }, emit: e => {if(e.type==='css') css=e.css;},
    probe: async sels => ({ fp: active.includes('#toolbar') ? 'working-counter' : 'before', unmatched: sels.filter(s => !active.includes('#toolbar') || s === '#missing-toolbar'), shown: 2 }) });
  const r = await runMorse(h.args);
  assert.equal(r.ok, true);
  assert.equal(r.polish.verdict, 'kept');
  assert.match(active, /#toolbar/);
  assert.doesNotMatch(active, /#missing-toolbar/);
  assert.equal(css, r.css);
});

test('truncated visual polish keeps the working draft', async () => {
  const css = 'body { color: red; background: white; padding: 8px; margin: 0; }';
  const h = host([reply(css), '```css\nbody { color: blue; }'], {
    request: 'restyle the page', polish: true,
    review: async () => ({ data: 'ZmFrZQ==', mediaType: 'image/png' }),
  });
  const r = await runMorse(h.args);
  assert.equal(r.ok, true);
  assert.equal(r.polish.verdict, 'kept');
  assert.equal(r.css.trim(), css);
});
