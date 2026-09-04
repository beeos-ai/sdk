const assert = require('node:assert/strict');
const test = require('node:test');

test('CommonJS root and facade exports load', () => {
  const root = require('../dist/index.js');
  const facade = require('../dist/facade.js');
  assert.equal(typeof root.BeeOSClient, 'function');
  assert.equal(typeof root.MobileClient, 'function');
  assert.equal(typeof facade.BeeOSClient, 'function');
  assert.equal(typeof facade.MobileClient, 'function');
});

test('ESM root and facade exports load', async () => {
  const root = await import('../dist/esm/index.js');
  const facade = await import('../dist/esm/facade.js');
  assert.equal(typeof root.BeeOSClient, 'function');
  assert.equal(typeof root.MobileClient, 'function');
  assert.equal(typeof facade.BeeOSClient, 'function');
  assert.equal(typeof facade.MobileClient, 'function');
});

test('facade reads API key and base URL from the environment', async (t) => {
  const previousKey = process.env.BEEOS_API_KEY;
  const previousUrl = process.env.BEEOS_API_URL;
  t.after(() => {
    if (previousKey === undefined) delete process.env.BEEOS_API_KEY;
    else process.env.BEEOS_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.BEEOS_API_URL;
    else process.env.BEEOS_API_URL = previousUrl;
  });
  process.env.BEEOS_API_KEY = 'environment-key';
  process.env.BEEOS_API_URL = 'https://environment.example/';

  const { BeeOSClient } = require('../dist/facade.js');
  const client = new BeeOSClient({
    fetch: async (input, init = {}) => {
      assert.equal(new URL(input.toString()).origin, 'https://environment.example');
      assert.equal(init.headers.Authorization, 'Bearer environment-key');
      return Response.json({ success: true, data: [] });
    },
  });

  assert.deepEqual(await client.listAgents(), []);
});

test('facade reports how to configure a missing API key', () => {
  const previousKey = process.env.BEEOS_API_KEY;
  delete process.env.BEEOS_API_KEY;
  try {
    const { BeeOSClient } = require('../dist/facade.js');
    assert.throws(() => new BeeOSClient(), /set BEEOS_API_KEY/);
  } finally {
    if (previousKey !== undefined) process.env.BEEOS_API_KEY = previousKey;
  }
});

test('mobile facade waits for readiness and runs a task to completion', async () => {
  const { MobileClient } = require('../dist/facade.js');
  const fetch = async (input, init = {}) => {
    const path = new URL(input.toString()).pathname;
    if (path.endsWith('/mobile')) {
      return Response.json({ success: true, data: { online: true, supported_actions: [] } });
    }
    if (path.endsWith('/tasks') && init.method === 'POST') {
      return Response.json({ success: true, data: { task_id: 'task-1', agent_id: 'agent-1', status: 'queued' } }, { status: 202 });
    }
    if (path.endsWith('/tasks/task-1')) {
      return Response.json({ success: true, data: { task_id: 'task-1', agent_id: 'agent-1', status: 'completed' } });
    }
    throw new Error(`unexpected request: ${init.method ?? 'GET'} ${path}`);
  };
  const client = new MobileClient({
    apiKey: 'test-key', agentId: 'agent-1', instanceId: 'instance-1',
    baseUrl: 'https://example.test', fetch,
  });
  assert.equal((await client.waitReady({ pollIntervalMs: 0 })).data.online, true);
  assert.equal((await client.run({ message: 'Open Settings' }, { pollIntervalMs: 0 })).data.status, 'completed');
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
