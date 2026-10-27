import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { endpointBase, probeEndpoint, connectChoice } from '../daemon/connect.js';
import { applyChoice } from '../daemon/setup.js';
import { settingsFromConfig } from '../daemon/models.js';
import { streamChat } from '../core/providers.js';

test('endpoint validation preserves proxy prefixes and accepts remote servers', () => {
  assert.equal(endpointBase('https://models.example.com/proxy/v1/'), 'https://models.example.com/proxy');
  assert.equal(endpointBase('http://192.168.1.10:8080/v1'), 'http://192.168.1.10:8080');
  for (const url of ['file:///tmp/model', 'https://user:secret@example.com/v1', 'https://example.com?key=secret', 'invalid']) assert.equal(endpointBase(url), '');
});
test('authenticated discovery, persistence and streamed inference use the same endpoint and selected model', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization });
    if (req.headers.authorization !== 'Bearer test-secret') { res.writeHead(401).end(); return; }
    if (req.url === '/proxy/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] })); return; }
    if (req.url === '/proxy/v1/chat/completions') {
      let body = ''; for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).model, 'model-b');
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'); return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/proxy/v1/`;
  try {
    const refused = await probeEndpoint(endpoint);
    assert.equal(refused.status, 'bad-key');
    const discovered = await probeEndpoint(endpoint, 'test-secret');
    assert.deepEqual(discovered.models.map(m => m.id), ['model-a', 'model-b']);
    const result = await connectChoice('local', 'model-b', { address: endpoint, selfHosted: true, apiKey: 'test-secret' });
    assert.equal(result.status, 'ready');
    const cfg = applyChoice({}, result.config);
    const settings = settingsFromConfig(cfg, {}, { env: {}, harnesses: { claude: {}, codex: {} } });
    assert.equal(settings.apiKey, 'test-secret');
    let output = '';
    await streamChat(settings, [{ role: 'user', content: 'Hello' }], { onToken: token => { output += token; } });
    assert.equal(output, 'Hello');
    assert.equal(requests.at(-1).path, '/proxy/v1/chat/completions');
    const anonymous = applyChoice(cfg, { ...result.config, keys: { local: '' } });
    assert.equal(settingsFromConfig(anonymous, {}, { env: {}, harnesses: { claude: {}, codex: {} } }).apiKey, '');
    const missing = await connectChoice('local', 'not-listed', { address: endpoint, selfHosted: true, apiKey: 'test-secret' });
    assert.match(missing.error, /doesn't have that model/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
