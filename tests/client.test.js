import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
function client(fetch) {
  const context = vm.createContext({ fetch, AbortController, setTimeout, clearTimeout });
  vm.runInContext(readFileSync('public/api-client.js', 'utf8'), context);
  return context.DealApi;
}
test('browser rejects HTML, HTTP errors and malformed success envelopes', async () => {
  for (const response of [new Response('<html>Login</html>'), new Response('{"ok":true}', { status: 503 }), new Response('{}')]) {
    const api = client(async () => response);
    await assert.rejects(api.request('/api'));
  }
});
test('browser timeout restores control without replaying POST', async () => {
  let calls = 0;
  const api = client((_, init) => new Promise((resolve, reject) => {
    calls++; init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  await assert.rejects(api.request('/api', { method: 'POST' }, 10), /เกินกำหนด/);
  assert.equal(calls, 1);
});
test('perfume requests are chunked and results retain all machines', async () => {
  const sizes = [];
  const api = client(async (_, init) => {
    const ids = JSON.parse(init.body).ids; sizes.push(ids.length);
    return new Response(JSON.stringify({ ok: true, results: Object.fromEntries(ids.map(id => [id, id])) }));
  });
  const result = await api.perfume('test', '2026-09-01~2026-09-16', Array.from({length: 51}, (_, i) => i + 1));
  assert.deepEqual(sizes, [20, 20, 11]);
  assert.equal(Object.keys(result.results).length, 51);
});
test('failed perfume chunk preserves successful chunks and continues the fleet', async () => {
  let calls = 0;
  const api = client(async (_, init) => {
    calls++;
    if (calls === 2) throw new Error('offline');
    const ids = JSON.parse(init.body).ids;
    return new Response(JSON.stringify({ ok: true, results: Object.fromEntries(ids.map(id => [id, 5])) }));
  });
  const result = await api.perfume('test', '2026-09-01~2026-09-16', Array.from({length: 51}, (_, i) => i + 1));
  assert.equal(calls, 3);
  assert.equal(result.results[1], 5);
  assert.equal(result.results[21], null);
  assert.equal(result.results[51], 5);
});
