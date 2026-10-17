import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const port = 18000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const token = 'integration-test-token-12345678';
let child;
const request = (path, method = 'GET', body) =>
  fetch(base + '/api/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
before(async () => {
  child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      API_TOKEN: token,
      DATABASE_URL: '',
      GEMINI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Server failed to start')),
      10000,
    );
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Server exited'));
    });
    child.stdout.once('data', () => {
      clearTimeout(timer);
      resolve();
    });
  });
});
after(() => {
  child?.kill();
});
test('auth, origin and request validation protect the API', async () => {
  assert.equal((await fetch(base + '/api/health')).status, 401);
  assert.equal((await request('health')).status, 200);
  assert.equal(
    (
      await fetch(base + '/api/orders', {
        method: 'POST',
        headers: {
          Origin: 'https://malicious.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('orders', 'POST', {
        intent: 'UNKNOWN',
        requestId: randomUUID(),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('telemetry', 'POST', [
        { x: 2, y: 0, jitter: 0, blinkMs: 0 },
      ])
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(base + '/api/health', {
        method: 'OPTIONS',
        headers: { Origin: 'null' },
      })
    ).headers.get('access-control-allow-origin'),
    'null',
  );
});
test('orders deduplicate, transition and appear in the queue', async () => {
  const input = { intent: 'COMFORT', requestId: randomUUID() };
  const responses = await Promise.all([
    request('orders', 'POST', input),
    request('orders', 'POST', input),
  ]);
  assert.ok(responses.every((r) => r.ok));
  const list = await (await request('orders')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].department, 'Facilities');
  assert.equal(list[0].source, 'demo-rules');
  assert.equal(
    (
      await (
        await request(`orders/${input.requestId}`, 'PATCH', {
          status: 'completed',
        })
      ).json()
    ).status,
    'completed',
  );
});
test('telemetry reaches live analytics and heatmap', async () => {
  assert.equal(
    (
      await request('telemetry', 'POST', [
        { x: 1, y: 1, jitter: 0.2, blinkMs: 160 },
      ])
    ).status,
    202,
  );
  const data = await (await request('analytics')).json();
  assert.equal(data.samples, 1);
  assert.equal(data.live[0].blinks, 1);
  assert.equal(data.aggregates[0].cell_x, 2);
  assert.equal(data.aggregates[0].cell_y, 1);
});
