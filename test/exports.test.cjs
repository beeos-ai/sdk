const assert = require('node:assert/strict');
const test = require('node:test');

test('CommonJS root and facade exports load', () => {
  const root = require('../dist/index.js');
  const facade = require('../dist/facade.js');
  assert.equal(typeof root.BeeOSClient, 'function');
  assert.equal(typeof facade.BeeOSClient, 'function');
});

test('ESM root and facade exports load', async () => {
  const root = await import('../dist/esm/index.js');
  const facade = await import('../dist/esm/facade.js');
  assert.equal(typeof root.BeeOSClient, 'function');
  assert.equal(typeof facade.BeeOSClient, 'function');
});

test('facade parses task SSE frames', async () => {
  const { BeeOSClient } = require('../dist/facade.js');
  const client = new BeeOSClient({
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    fetch: async () => new Response(
      'id: 7\nevent: message\ndata: {"status":"working"}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    ),
  });
  const events = [];
  for await (const event of client.taskEvents('agent', 'task')) events.push(event);
  assert.deepEqual(events, [{ event: 'message', id: '7', data: { status: 'working' } }]);
});
