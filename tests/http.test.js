import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, readJson } from '../src/http.js';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
test('deadline aborts stalled upstream body and never retries a timeout', async () => {
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      init.signal.addEventListener('abort', () => controller.error(new Error('aborted')));
    } }));
  };
  await assert.rejects(requestJson('https://upstream.test', {}, { timeout: 10, retry: true }), err => err.status === 504);
  assert.equal(calls, 1);
});
test('oversized upstream stream is cancelled', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('123456')); }, cancel() { cancelled = true; },
  }));
  await assert.rejects(readJson(response, 5), /ขนาดเกิน/);
  assert.equal(cancelled, true);
});
test('authentication and throttling errors do not cause retries', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('denied', { status }); };
    await assert.rejects(requestJson('https://upstream.test', {}, { retry: true }));
    assert.equal(calls, 1);
  }
});
