const assert = require('node:assert/strict');
const test = require('node:test');
const { BeeOSClient, TaskExecutionError, BeeOSTimeoutError } = require('../dist/index.js');

function client(fetch) { return new BeeOSClient({ apiKey: 'private-key', baseUrl: 'https://api.example', fetch }); }
function task(status, extra = {}) { return Response.json({ success: true, data: { agent_id: 'agent', task_id: 'task', status, ...extra } }); }

test('instance resource shares IDs and generated request serialization across mobile/computer', async () => {
  const calls = [];
  const api = client(async (url, init = {}) => {
    assert.equal(init.headers.Authorization, 'Bearer private-key');
    calls.push([new URL(url).pathname, init.method, init.body && JSON.parse(init.body)]);
    return Response.json({ success: true, data: { ok: true } });
  });
  const instance = api.instance('phone/id');
  await instance.mobile.tap({ x: 100, y: 200 });
  await instance.mobile.doubleTap({ x: 30, y: 40 });
  await instance.mobile.longPress({ x: 10, y: 20, durationMs: 800 });
  await instance.mobile.openApp('com.android.settings');
  await instance.mobile.pressButton('home');
  await instance.mobile.key('BACK');
  await instance.mobile.type('hello');
  await instance.computer.key(['CTRL', 'L']);
  await instance.computer.move({ x: 10, y: 20 });
  await instance.computer.click({ x: 10, y: 20, button: 'left' });
  assert.equal(calls.length, 10);
  assert.ok(calls.every(([path]) => path.startsWith('/api/v1/instances/phone%2Fid/')));
  assert.deepEqual(calls[3], ['/api/v1/instances/phone%2Fid/mobile/open_app', 'POST', { app: 'com.android.settings' }]);
  assert.deepEqual(calls[5][2], { keys: ['BACK'] });
  assert.deepEqual(calls[7][2], { keys: ['CTRL', 'L'] });
});

test('instance create/get/list/start/stop/restart/destroy use the existing lifecycle contract', async () => {
  const calls = [];
  const api = client(async (url, init) => {
    const path = new URL(url).pathname;
    calls.push([path, init.method]);
    if (init.method === 'DELETE') return Response.json({ success: true, data: 'destroyed' });
    return Response.json({ success: true, data: path.endsWith('/instances') && init.method === 'GET' ? [] : { id: 'instance', status: 'running', connectivity: 'online' } });
  });
  const instance = await api.instances.create({ variantId: 'variant' });
  assert.equal(instance.id, 'instance');
  assert.equal((await api.instances.get(instance.id)).data.status, 'running');
  assert.equal(await instance.waitReady(), instance);
  await api.instances.list();
  await instance.start(); await instance.stop(); await instance.restart();
  assert.equal((await instance.destroy()).data, 'destroyed');
  assert.deepEqual(calls.at(-1), ['/api/v1/instances/instance', 'DELETE']);
});

test('running instance is not ready until connectivity is online', async () => {
  let count = 0;
  const api = client(async () => Response.json({ success: true, data: { id: 'instance', status: 'running', connectivity: ++count > 1 ? 'online' : 'offline' } }));
  await api.instance('instance').waitReady({ pollIntervalMs: 0 });
  assert.equal(count, 2);
});

test('instance identity mismatch and failed startup do not pass readiness', async () => {
  await assert.rejects(client(async () => Response.json({ success: true, data: { id: 'wrong' } })).instances.get('instance'), /identity/);
  await assert.rejects(client(async () => Response.json({ success: true, data: { id: 'instance', status: 'failed' } })).instance('instance').waitReady(), /cannot become ready/);
});

test('all mobile observations are instance-scoped, including query parameters', async () => {
  const calls = [];
  const api = client(async (url) => {
    calls.push(new URL(url));
    return Response.json({ success: true, data: { online: true, apps: [] } });
  });
  const mobile = api.instance('phone').mobile;
  await mobile.waitReady(); await mobile.screenshot();
  await mobile.uiTree({ format: 'compact', query: 'Settings' });
  await mobile.listApps({ includeSystem: true, launchableOnly: true });
  assert.equal(calls[2].searchParams.get('format'), 'compact');
  assert.equal(calls[3].searchParams.get('include_system'), 'true');
  await mobile.listApps();
  assert.equal(calls[4].searchParams.get('include_system'), 'false');
  assert.equal(calls[4].searchParams.get('launchable_only'), 'true');
  await mobile.listApps({ launchableOnly: false });
  assert.equal(calls[5].searchParams.get('launchable_only'), 'false');
});

test('submitTask returns a reusable task handle and preserves idempotency', async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push([new URL(url).pathname, init]);
    return init.method === 'POST' ? task('queued') : task('completed', { result: { text: 'ok' } });
  });
  const handle = await api.submitTask('agent', { message: 'hello', idempotencyKey: 'same-attempt' });
  assert.equal(handle.id, 'task');
  assert.equal((await handle.wait()).data.status, 'completed');
  assert.equal(JSON.parse(calls[0][1].body).idempotency_key, 'same-attempt');
  assert.equal(calls.filter(([, init]) => init.method === 'POST').length, 1);
});

for (const status of ['failed', 'timeout', 'canceled', 'rejected']) {
  test(`task wait rejects ${status} and retains the snapshot; terminal-only mode is explicit`, async () => {
    const api = client(async () => task(status));
    await assert.rejects(api.task('agent', 'task').wait(), (error) => error instanceof TaskExecutionError && error.snapshot.data.status === status);
    assert.equal((await api.waitTask('agent', 'task', { requireSuccess: false })).data.status, status);
  });
}

test('a truncated task prefix cannot be accepted as authoritative completion', async () => {
  await assert.rejects(client(async () => task('completed', { truncated: true })).waitTask('agent', 'task'), /truncated/);
});

test('a task identity mismatch cannot be accepted as completion', async () => {
  await assert.rejects(client(async () => task('completed', { task_id: 'wrong-task' })).waitTask('agent', 'task'), /identity/);
});

test('waiting timeout interrupts in-flight fetch without cancelling or resubmitting the remote task', async () => {
  const calls = [];
  const api = client((url, init) => {
    calls.push(new URL(url).pathname);
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  });
  await assert.rejects(api.waitTask('agent', 'task', { timeoutMs: 15 }), (error) => error instanceof BeeOSTimeoutError && /not automatically cancelled/.test(error.message));
  assert.deepEqual(calls, ['/api/v1/agents/agent/tasks/task']);
});

test('abort before submission sends no request and busy writes are never replayed', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return Response.json({ error: { code: 'device_busy' } }, { status: 409 }); });
  const controller = new AbortController(); controller.abort(new Error('stop now'));
  await assert.rejects(api.submitTask('agent', { message: 'hello' }, { signal: controller.signal }), /stop now/);
  assert.equal(calls, 0);
  await assert.rejects(api.instance('phone').mobile.pressButton('home'), (error) => error.response.status === 409);
  assert.equal(calls, 1);
});

test('task event parser accepts CRLF split across byte chunks and releases early-broken streams', async () => {
  let canceled = false;
  const encoder = new TextEncoder();
  const chunks = ['id: 10\r', '\nevent: message\r', '\ndata: {"text":"ok"}\r', '\n\r', '\n'];
  const api = client(async () => new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); },
    cancel() { canceled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  for await (const event of api.task('agent', 'task').events({ since: 7 })) {
    assert.deepEqual(event, { id: '10', event: 'message', data: { text: 'ok' } });
    break;
  }
  assert.equal(canceled, true);
});

test('event JSON errors do not silently become an empty successful stream', async () => {
  const api = client(async () => Response.json({ error: { message: 'closed' } }));
  await assert.rejects(async () => { for await (const event of api.taskEvents('agent', 'task')) void event; }, /stream failed/);
});

test('SSE end closes a live stream and preserves cursor-only frames', async () => {
  let canceled = false;
  const api = client(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('id: 42\n\ndata: {}\n\nevent: end\ndata: {}\n\n')); },
    cancel() { canceled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const events = [];
  for await (const event of api.taskEvents('agent', 'task')) events.push(event);
  assert.deepEqual(events.map((event) => [event.id, event.event]), [['42', 'message'], ['42', 'end']]);
  assert.equal(canceled, true);
});

test('incomplete SSE EOF and fake event-stream MIME types cannot produce a reply', async () => {
  const api = client(async () => new Response('data: {"partial":true}', { headers: { 'content-type': 'text/event-stream' } }));
  const events = [];
  for await (const event of api.taskEvents('agent', 'task')) events.push(event);
  assert.equal(events.length, 0);
  const invalid = client(async () => new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream-malformed' } }));
  await assert.rejects(async () => { for await (const event of invalid.taskEvents('agent', 'task')) void event; }, /stream failed/);
});

test('file download resolves ownership first and never forwards auth to object storage', async () => {
  const api = client(async (url, init = {}) => {
    if (new URL(url).host === 'api.example') {
      assert.equal(init.headers.Authorization, 'Bearer private-key');
      return Response.json({ success: true, data: { file_id: 'file', download_url: 'https://objects.example/file?signature=secret', size: 8 } });
    }
    assert.equal(init.headers, undefined);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    return new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } });
  });
  const bytes = await api.files.download('file', { expectedContentType: 'application/pdf', maxBytes: 8 });
  assert.equal(new TextDecoder().decode(bytes), '%PDF-1.7');
});

test('file streaming enforces size caps and cancels the body on rejection', async () => {
  let canceled = false;
  const api = client(async (url) => {
    if (new URL(url).host === 'api.example') return Response.json({ success: true, data: { file_id: 'file', download_url: 'https://objects.example/file' } });
    return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { canceled = true; } }));
  });
  await assert.rejects(api.files.download('file', { maxBytes: 10 }), /maxBytes/);
  assert.equal(canceled, true);
});

test('insecure file URLs require explicit opt-in and failed metadata prevents any download', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return Response.json({ success: true, data: { file_id: 'file', download_url: 'http://objects.example/file' } }); });
  await assert.rejects(api.files.download('file'), /HTTPS/);
  assert.equal(calls, 1);
  await assert.rejects(client(async () => Response.json({ error: { code: 'not_found' } }, { status: 404 })).files.download('file'), (error) => error.response.status === 404);
});
