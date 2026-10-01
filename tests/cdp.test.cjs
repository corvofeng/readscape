const { test } = require('node:test');
const assert = require('node:assert/strict');

test('CDP endpoints accept remote hosts and reject ambiguous paths', async () => {
  const { normalizeEndpoint } = await import('../scripts/cdp.mjs');
  assert.equal(normalizeEndpoint(), 'http://localhost:9222');
  assert.equal(normalizeEndpoint('192.168.101.165:9222'), 'http://192.168.101.165:9222');
  assert.equal(normalizeEndpoint('https://browser.example/'), 'https://browser.example');
  for (const endpoint of ['ws://localhost:9222', 'http://localhost:9222/json/version', 'http://user:pass@localhost:9222', 'http://localhost:9222?x=1']) {
    assert.throws(() => normalizeEndpoint(endpoint));
  }
});

test('CDP discovery URLs follow the reachable host and tunnel port', async () => {
  const { debuggerUrl } = await import('../scripts/cdp.mjs');
  assert.equal(debuggerUrl('ws://127.0.0.1:9222/devtools/page/abc', 'http://192.168.101.165:9222'),
    'ws://192.168.101.165:9222/devtools/page/abc');
  assert.equal(debuggerUrl('ws://192.168.101.165:9222/devtools/page/abc?x=1', 'http://localhost:19222'),
    'ws://localhost:19222/devtools/page/abc?x=1');
  assert.equal(debuggerUrl('ws://localhost:9222/devtools/browser/abc', 'https://browser.example'),
    'wss://browser.example/devtools/browser/abc');
});
