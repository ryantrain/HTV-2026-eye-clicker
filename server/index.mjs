import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GoogleGenAI, Type } from '@google/genai';
import {
  fallbackOrder,
  validateOrder,
  validateRouting,
  validateSamples,
} from './domain.mjs';
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const token = process.env.API_TOKEN || '';
if (host !== '127.0.0.1' && host !== 'localhost' && token.length < 24)
  throw new Error('Set API_TOKEN to at least 24 characters for network access');
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    })
  : null;
if (pool) {
  pool.on('error', (error) =>
    console.error('Database pool error', error.message),
  );
  await pool.query(
    await readFile(new URL('./schema.sql', import.meta.url), 'utf8'),
  );
}
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const patient = 'demo-patient';
const orders = [];
const metrics = [];
const pending = new Map();
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 64000) {
      const error = new Error('Request too large');
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(data);
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}
async function routeIntent(input) {
  const time = new Date();
  const hour = Number(
    new Intl.DateTimeFormat('en-CA', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: process.env.ROOM_TIMEZONE || 'America/Toronto',
    }).format(time),
  );
  let routing = fallbackOrder(input.intent, hour);
  let source = 'demo-rules';
  if (ai) {
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: JSON.stringify({
        intent: input.intent,
        localHour: hour,
        context:
          'Demo room. No medication schedule, sensor readings or room image supplied.',
      }),
      config: {
        httpOptions: { timeout: 15000 },
        systemInstruction:
          'Route a non-emergency care request. Do not diagnose, prescribe, infer symptoms, or invent context. Ask staff to check the patient. Output department and a short summary only.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            department: {
              type: Type.STRING,
              enum: ['Care team', 'Facilities'],
            },
            summary: { type: Type.STRING },
          },
          required: ['department', 'summary'],
        },
      },
    });
    routing = validateRouting(JSON.parse(result.text));
    source = 'gemini';
  }
  const order = {
    id: input.requestId,
    patient_id: patient,
    created_at: time.toISOString(),
    intent: input.intent,
    ...routing,
    source,
    status: 'pending',
  };
  if (pool) {
    const result = await pool.query(
      'INSERT INTO work_orders(id,patient_id,intent,department,summary,source) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING *',
      [
        order.id,
        patient,
        order.intent,
        order.department,
        order.summary,
        order.source,
      ],
    );
    return result.rows[0];
  }
  orders.unshift(order);
  if (orders.length > 200) orders.pop();
  return order;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET')
      return json(res, 405, { error: 'Method not allowed' });
    try {
      const relative = decodeURIComponent(
        url.pathname === '/' ? 'index.html' : url.pathname.slice(1),
      );
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep))
        return json(res, 403, { error: 'Forbidden' });
      const bytes = await readFile(file);
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.wasm': 'application/wasm',
          }[ext] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(bytes);
    } catch {
      json(res, 404, {
        error: 'Build the web app with npm run web:build first',
      });
    }
    return;
  }
  const origin = req.headers.origin;
  const local = host === '127.0.0.1' || host === 'localhost';
  const allowed =
    !origin ||
    origin === `https://${req.headers.host}` ||
    origin === `http://${req.headers.host}` ||
    (local &&
      (origin === 'null' ||
        origin === 'file://' ||
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)));
  if (!allowed) return json(res, 403, { error: 'Origin not allowed' });
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    });
    return res.end();
  }
  if (
    ['POST', 'PATCH'].includes(req.method) &&
    !req.headers['content-type']?.startsWith('application/json')
  )
    return json(res, 415, { error: 'Expected application/json' });
  if (token && req.headers.authorization !== `Bearer ${token}`)
    return json(res, 401, {
      error: 'Enter the demo access token in Connection settings',
    });
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const baseline = pool
        ? (
            await pool.query(
              'SELECT dwell_ms, blink_threshold FROM patients WHERE id=$1',
              [patient],
            )
          ).rows[0]
        : { dwell_ms: 2000, blink_threshold: 0.5 };
      return json(res, 200, {
        database: pool ? 'Tiger Data' : 'In-memory demo',
        routing: ai ? 'Gemini' : 'Demo rules',
        patient,
        dwellMs: baseline.dwell_ms,
        blinkThreshold: baseline.blink_threshold,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/orders')
      return json(
        res,
        200,
        pool
          ? (
              await pool.query(
                'SELECT * FROM work_orders WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 200',
                [patient],
              )
            ).rows
          : orders,
      );
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      let input;
      try {
        input = validateOrder(await body(req));
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      const existing = pool
        ? (
            await pool.query(
              'SELECT * FROM work_orders WHERE id=$1 AND patient_id=$2',
              [input.requestId, patient],
            )
          ).rows[0]
        : orders.find((o) => o.id === input.requestId);
      if (existing) return json(res, 200, existing);
      if (!pending.has(input.requestId) && pending.size >= 8)
        return json(res, 429, { error: 'Request queue busy. Please retry.' });
      if (!pending.has(input.requestId)) {
        const promise = routeIntent(input).finally(() =>
          pending.delete(input.requestId),
        );
        pending.set(input.requestId, promise);
      }
      return json(res, 201, await pending.get(input.requestId));
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/orders/')) {
      const { status } = await body(req);
      if (!['acknowledged', 'completed'].includes(status))
        return json(res, 400, { error: 'Invalid status' });
      const id = url.pathname.split('/').pop();
      const order = pool
        ? (
            await pool.query(
              'UPDATE work_orders SET status=$1 WHERE id=$2 AND patient_id=$3 RETURNING *',
              [status, id, patient],
            )
          ).rows[0]
        : orders.find((o) => o.id === id);
      if (!order) return json(res, 404, { error: 'Order not found' });
      order.status = status;
      return json(res, 200, order);
    }
    if (req.method === 'POST' && url.pathname === '/api/telemetry') {
      let samples;
      try {
        samples = validateSamples(await body(req));
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      const now = Date.now();
      if (pool)
        await pool.query(
          'INSERT INTO gaze_metrics(patient_id,gaze_x,gaze_y,jitter_delta,blink_duration_ms) SELECT $1,x,y,jitter,blink FROM jsonb_to_recordset($2::jsonb) AS s(x float8,y float8,jitter float8,blink float8)',
          [
            patient,
            JSON.stringify(samples.map((s) => ({ ...s, blink: s.blinkMs }))),
          ],
        );
      else {
        metrics.push(...samples.map((s) => ({ ...s, time: now })));
        while (
          metrics.length > 18000 ||
          (metrics[0] && metrics[0].time < now - 300000)
        )
          metrics.shift();
      }
      return json(res, 202, { accepted: samples.length });
    }
    if (req.method === 'GET' && url.pathname === '/api/analytics') {
      if (pool) {
        const rows = (
          await pool.query(
            "SELECT * FROM gaze_five_minutes WHERE patient_id=$1 AND bucket >= now() - interval '30 minutes' ORDER BY bucket",
            [patient],
          )
        ).rows;
        const live = (
          await pool.query(
            "SELECT date_trunc('second', timestamp) AS time, avg(jitter_delta) AS jitter, count(*) FILTER(WHERE blink_duration_ms > 0) AS blinks FROM gaze_metrics WHERE patient_id=$1 AND timestamp > now()-interval '60 seconds' GROUP BY 1 ORDER BY 1",
            [patient],
          )
        ).rows;
        return json(res, 200, {
          aggregates: rows,
          live,
          source: 'Tiger Data',
          samples: rows.reduce((n, r) => n + Number(r.samples), 0),
        });
      }
      const recent = metrics.filter((m) => m.time > Date.now() - 60000);
      const buckets = new Map();
      for (const m of recent) {
        const second = Math.floor(m.time / 1000) * 1000;
        const b = buckets.get(second) || {
          time: new Date(second).toISOString(),
          jitter: 0,
          blinks: 0,
          n: 0,
        };
        b.jitter += m.jitter;
        b.blinks += Number(m.blinkMs > 0);
        b.n++;
        buckets.set(second, b);
      }
      const heat = new Map();
      for (const m of metrics.filter((m) => m.time > Date.now() - 300000)) {
        const x = Math.min(2, Math.floor(m.x * 3)),
          y = Math.min(1, Math.floor(m.y * 2));
        const key = `${x}:${y}`;
        const b = heat.get(key) || {
          cell_x: x,
          cell_y: y,
          samples: 0,
          blinks: 0,
        };
        b.samples++;
        b.blinks += Number(m.blinkMs > 0);
        heat.set(key, b);
      }
      return json(res, 200, {
        aggregates: [...heat.values()],
        live: [...buckets.values()].map((b) => ({
          ...b,
          jitter: b.jitter / b.n,
        })),
        source: 'In-memory demo',
        samples: metrics.length,
      });
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    const incident = randomUUID();
    console.error(incident, error);
    json(res, error.status || 503, {
      error: error.status
        ? error.message
        : `Service unavailable. Request ${incident}. No request was confirmed; retry when connected.`,
    });
  }
});
server.requestTimeout = 20000;
server.listen(port, host, () =>
  console.log(
    `OmniAccess http://${host}:${port} · ${pool ? 'Tiger Data' : 'in-memory demo'} · ${ai ? 'Gemini' : 'demo rules'}`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      await pool?.end();
      process.exit(0);
    }),
  );
