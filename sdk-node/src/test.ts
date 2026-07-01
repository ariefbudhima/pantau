/**
 * Integration tests for pantau-js SDK.
 * Run: npx tsx src/test.ts
 */
import express from 'express';
import http from 'http';
import { init, middleware, startHeartbeat, stopHeartbeat, shutdown } from './index';

let server: http.Server;
let app: express.Express;
const PANTAU_PORT = 3099;

// Fake Pantau API to capture heartbeat data
let receivedHeartbeats: any[] = [];

function startFakePantauAPI(): Promise<void> {
  return new Promise((resolve) => {
    const fakeApp = express();
    fakeApp.use(express.json());

    fakeApp.post('/api/ingest', (req, res) => {
      receivedHeartbeats.push(req.body);
      res.json({ ok: true });
    });

    fakeApp.listen(PANTAU_PORT, () => {
      console.log(`  Fake Pantau API on :${PANTAU_PORT}`);
      resolve();
    });
  });
}

function startTestApp(): Promise<void> {
  return new Promise((resolve) => {
    app = express();
    app.use(express.json());

    // Init Pantau SDK
    init({
      apiKey: 'pk_test_1234567890abcdef',
      baseUrl: `http://localhost:${PANTAU_PORT}`,
      serviceName: 'test-service',
    });

    // Middleware after body parser
    app.use(middleware());

    // Test routes
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.get('/slow', async (_req, res) => {
      await new Promise((r) => setTimeout(r, 100));
      res.json({ slow: true });
    });
    app.get('/error', (_req, res) => {
      res.status(500).json({ error: 'boom' });
    });
    app.post('/data', (req, res) => {
      res.status(201).json({ received: req.body });
    });

    server = app.listen(3098, () => {
      console.log(`  Test app on :3098`);
      resolve();
    });
  });
}

async function makeRequest(path: string, method = 'GET', body?: any): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port: 3098, path, method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode || 0));
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ==================== TESTS ====================

const tests: { name: string; fn: () => Promise<void> }[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// --- Tests ---

test('middleware tracks successful requests', async () => {
  const res = await makeRequest('/health');
  assert(res === 200, `Expected 200, got ${res}`);
});

test('middleware tracks slow requests', async () => {
  const res = await makeRequest('/slow');
  assert(res === 200, `Expected 200, got ${res}`);
});

test('middleware tracks error requests', async () => {
  const res = await makeRequest('/error');
  assert(res === 500, `Expected 500, got ${res}`);
});

test('middleware tracks POST requests', async () => {
  const res = await makeRequest('/data', 'POST', { hello: 'world' });
  assert(res === 201, `Expected 201, got ${res}`);
});

test('heartbeat sends data to Pantau API', async () => {
  receivedHeartbeats = [];
  startHeartbeat(1000); // every 1 second for fast testing

  // Make some requests
  await makeRequest('/health');
  await makeRequest('/health');
  await makeRequest('/slow');
  await makeRequest('/error');

  // Wait for heartbeat to fire
  await sleep(2000);
  stopHeartbeat();

  assert(receivedHeartbeats.length > 0, 'No heartbeats received');
  const last = receivedHeartbeats[receivedHeartbeats.length - 1];
  assert(last.service === 'test-service', `Expected service 'test-service', got '${last.service}'`);
  assert(Array.isArray(last.endpoints), 'endpoints should be an array');
  assert(last.endpoints.length >= 3, `Expected at least 3 endpoints, got ${last.endpoints.length}`);

  console.log(`    Endpoints detected: ${last.endpoints.map((e: any) => `${e.method} ${e.path}`).join(', ')}`);
});

test('shutdown sends final heartbeat', async () => {
  receivedHeartbeats = [];
  startHeartbeat(60000); // long interval, won't auto-fire

  await makeRequest('/health');

  await shutdown();
  await sleep(500);

  assert(receivedHeartbeats.length >= 1, `Shutdown should send final heartbeat, got ${receivedHeartbeats.length}`);
});

// ==================== RUNNER ====================

async function run() {
  console.log('\n🧪 pantau-js SDK Tests\n');

  try {
    await startFakePantauAPI();
    await startTestApp();
    await sleep(200); // let middleware register
  } catch (err: any) {
    console.error('Setup failed:', err.message);
    process.exit(1);
  }

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
      passed++;
    } catch (err: any) {
      console.log(`  ✗ ${t.name}`);
      console.log(`    ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total\n`);

  // Cleanup
  server?.close();
  process.exit(failed > 0 ? 1 : 0);
}

run();
