import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete globalThis.caches; });
const env = { GAS_URL: 'https://script.google.com/macros/s/test/exec', GAS_TOKEN: 'test-secret', ASSETS: { fetch: () => new Response('asset') } };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function setup(upstream) {
  const entries = new Map(), calls = [], pending = [];
  globalThis.caches = { default: {
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, value) { entries.set(key.url, value); },
  } };
  globalThis.fetch = async (url, init) => { calls.push({ url: new URL(url), init }); return upstream(url, init); };
  return { calls, entries, async request(path = '/api?action=months', body) {
    const req = new Request('https://dashboard.test' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const res = await worker.fetch(req, env, { waitUntil: p => pending.push(p) });
    await Promise.all(pending.splice(0));
    return res;
  } };
}

test('GAS HTML becomes a JSON error and is never cached', async () => {
  const h = setup(() => new Response('<html>Login required</html>'));
  const res = await h.request();
  assert.equal(res.status, 502);
  assert.equal((await res.json()).ok, false);
  assert.equal(h.entries.size, 0);
});
test('GAS application errors are never cached', async () => {
  const h = setup(() => json({ ok: false, error: 'unauthorized' }));
  await h.request(); await h.request();
  assert.equal(h.calls.length, 2);
  assert.equal(h.entries.size, 0);
});
test('canonical cache ignores order, trailing slash, fresh and unknown parameters', async () => {
  const h = setup(() => json({ ok: true, data: { rows: [] } }));
  await h.request('/api?fresh=1&action=month&month=07-2026&ignored=1');
  const res = await h.request('/api/?month=07-2026&action=month');
  assert.equal(h.calls.length, 1);
  assert.equal(res.headers.get('x-cache'), 'HIT');
  assert.match(res.headers.get('cache-control'), /no-store/);
});
test('notes bypass both edge and upstream caches', async () => {
  const h = setup(() => json({ ok: true, data: { notes: [] } }));
  await h.request('/api?action=notes&code=LO_0001');
  const res = await h.request('/api?action=notes&code=LO_0001');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url.searchParams.get('fresh'), '1');
  assert.equal(h.entries.size, 0);
  assert.match(res.headers.get('cache-control'), /no-store/);
});
test('transient read failure is retried once', async () => {
  let n = 0;
  const h = setup(() => ++n === 1 ? json({ error: 'busy' }, 503) : json({ ok: true, data: { months: [] } }));
  assert.equal((await (await h.request()).json()).ok, true);
  assert.equal(n, 2);
});
test('ambiguous writes are never retried', async () => {
  const h = setup(() => { throw new Error('network failed ' + env.GAS_TOKEN); });
  const res = await h.request('/api', { action: 'note', code: 'LO_0001', note: 'repair', by: 'test' });
  assert.equal(res.status, 502);
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(await res.text(), /test-secret/);
});
test('write HTML and malformed envelopes cannot become successful writes', async () => {
  for (const value of ['<html>login</html>', '{}']) {
    const h = setup(() => new Response(value));
    assert.equal((await h.request('/api', { action: 'rename', code: 'LO_0001', name: 'New' })).status, 502);
  }
});
test('invalid write bodies return 400 instead of throwing', async () => {
  const h = setup(() => json({ ok: true, data: {} }));
  for (const body of [null, [], { action: 'note' }, { action: 'rename', code: 'LO_0001', name: '' }]) {
    assert.equal((await h.request('/api', body)).status, 400);
  }
  assert.equal(h.calls.length, 0);
});
test('unknown API paths return JSON 404 instead of SPA HTML', async () => {
  const h = setup(() => json({ ok: true, data: {} }));
  assert.equal((await h.request('/api/missing')).status, 404);
});
test('unavailable cache does not break a successful read', async () => {
  const h = setup(() => json({ ok: true, data: { months: [] } }));
  globalThis.caches.default.match = async () => { throw new Error('cache unavailable'); };
  globalThis.caches.default.put = async () => { throw new Error('cache unavailable'); };
  assert.equal((await h.request()).status, 200);
});
test('GAS request has a timeout signal', async () => {
  const h = setup(() => json({ ok: true, data: {} }));
  await h.request();
  assert.ok(h.calls[0].init.signal instanceof AbortSignal);
});

const perfume = { token: 'test-token', time: '2026-09-01~2026-09-16', ids: [794] };
test('perfume preserves real zero, sums daily sales and marks missing data unavailable', async () => {
  for (const [data, expected] of [
    [{ dateList: [], allsales: 999 }, 0],
    [{ dateList: [{ salePrice: '10.25' }, { salePrice: 20 }], allsales: 999 }, 30.25],
    [{}, null],
    [{ dateList: [{ salePrice: 'broken' }] }, null],
  ]) {
    const h = setup(() => json({ data }));
    const result = await (await h.request('/api/perfume', perfume)).json();
    assert.equal(result.results['794'], expected);
  }
});
test('perfume validates body types, real dates and machine IDs before fetching', async () => {
  const h = setup(() => json({ data: { dateList: [] } }));
  for (const body of [null, { ...perfume, token: 42 }, { ...perfume, time: 'bad~bad' },
    { ...perfume, time: '2026-02-30~2026-03-01' }, { ...perfume, time: '2026-09-16~2026-09-01' },
    { ...perfume, ids: ['__proto__'] }, { ...perfume, ids: Array.from({ length: 41 }, (_, i) => i + 1) }]) {
    assert.equal((await h.request('/api/perfume', body)).status, 400);
  }
  assert.equal(h.calls.length, 0);
});
test('perfume deduplicates IDs and bounds simultaneous requests to six', async () => {
  let active = 0, peak = 0;
  const h = setup(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return json({ data: { dateList: [] } });
  });
  const res = await h.request('/api/perfume', { ...perfume, ids: [1,2,3,4,5,6,7,8,9,1] });
  assert.equal((await res.json()).count, 9);
  assert.equal(h.calls.length, 9);
  assert.ok(peak <= 6);
});
