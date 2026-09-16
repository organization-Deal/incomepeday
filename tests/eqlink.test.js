import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { eqlinkConfig, readMonth, mergeMonth, replaceHistory, monthDates } from '../src/eqlink.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const env = { EQLINK_USERNAME: 'fixture-user', EQLINK_PASSWORD: 'fixture-password',
  EQLINK_API_KEY: 'fixture-key', EQLINK_MAPPING: JSON.stringify([{ code: 'LO_0001', device: 'SERIAL1' }]) };
const now = new Date('2026-09-02T03:00:00Z');
const base = () => ({ month: '09-2026', slots: ['01/09 22:00', '02/09 00:00'],
  rows: ['LO_0001','LO_0002'].map(code => ({ code, name: 'Original name', owner: 'Zone',
    cells: [{ s: 'OFFLINE', d: 999, m: 999 }, { s: 'ONLINE', d: 999, m: 999 }] })) });
function mock(change = () => {}) {
  const calls = []; let active = 0, peak = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://laundromat-th.eqlink.top');
    assert.equal(init.redirect, 'manual');
    const body = JSON.parse(init.body); const path = new URL(url).pathname;
    calls.push({ path, body }); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    let data;
    if (path.endsWith('/login')) data = { status: 200, token: 'private-token', vendor_id: 'vendor1' };
    else if (path.endsWith('/get_vendor_info')) data = { status: 200, vendor_info: { currency: 'THB' } };
    else if (path.endsWith('/get_devicelist')) data = { status: 200, count: 1, devicelist: [{ devicename: 'SERIAL1', status: 'offline', device_type: 'CT' }] };
    else data = { status: 200, count: 1, devices_rev_month: [{ devicename: 'SERIAL1', total: body.start_time.endsWith('01') ? 320 : 0 }] };
    change(data, path, body);
    return new Response(JSON.stringify(data));
  };
  return { calls, peak: () => peak };
}
test('configuration is opt-in, explicit and rejects incomplete or ambiguous mappings', () => {
  assert.equal(eqlinkConfig({}), null);
  for (const changes of [{ EQLINK_PASSWORD: '' }, { EQLINK_MAPPING: '{}' },
    { EQLINK_MAPPING: '[{"code":"LO_0001","device":"X"},{"code":"LO_0001","device":"Y"}]' },
    { EQLINK_MAPPING: '[{"code":"LO_0001","device":"X"},{"code":"LO_0002","device":"X"}]' }]) {
    assert.throws(() => eqlinkConfig({ ...env, ...changes }), /EQLink/);
  }
});
test('Bangkok dates include only elapsed dates and handle leap/future months', () => {
  assert.equal(monthDates('02-2024', now).length, 29);
  assert.equal(monthDates('09-2026', new Date('2026-09-01T17:01:00Z')).length, 2);
  assert.equal(monthDates('10-2026', now).length, 0);
  assert.throws(() => monthDates('13-2026', now));
});
test('daily totals replace mapped revenues in THB; unmatched rows remain unchanged', async () => {
  const h = mock(); const source = await readMonth(eqlinkConfig(env), '09-2026', now);
  const input = base(), unchanged = structuredClone(input.rows[1]);
  const result = mergeMonth(input, source, eqlinkConfig(env));
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[1], unchanged);
  assert.equal(result.rows[0].name, 'Original name');
  assert.equal(result.rows[0].daily['01/09'].d, 320);
  assert.equal(result.rows[0].daily['02/09'].d, 0);
  assert.equal(result.rows[0].daily['02/09'].m, 320);
  assert.equal(result.rows[0].daily['01/09'].s, 'ONLINE');
  assert.equal(result.rows[0].daily['02/09'].s, 'ONLINE'); // Actual 00:00 observation.
  assert.equal(result.rows[0].currentStatus, 'OFFLINE');
  assert.equal(result.rows[0].cells[0].d, null);
  assert.equal(result.rows[0].cells[1].d, 320);
  assert.equal(h.calls.length, 5);
  assert.doesNotMatch(JSON.stringify(result), /private-token|SERIAL1|fixture-password/);
});
test('past months never inherit current online status and closed last day stays closed', async () => {
  mock(); const source = await readMonth(eqlinkConfig(env), '08-2026', now);
  const input = base(); input.month = '08-2026'; input.slots = ['31/08 22:00'];
  input.rows.forEach(r => { r.cells = [{ s: 'OFFLINE', d: 1, m: 1 }]; });
  const result = mergeMonth(input, source, eqlinkConfig(env));
  assert.equal(result.rows[0].currentStatus, undefined);
  assert.equal(result.rows[0].daily['31/08'].closed, true);
  assert.equal(result.rows[0].daily['31/08'].s, 'OFFLINE');
});
test('missing reports, invalid currency, duplicate serials and truncated fleets fail closed', async () => {
  for (const change of [
    (d,p) => { if(p.endsWith('/get_vendor_info')) d.vendor_info.currency = 'USD'; },
    (d,p) => { if(p.endsWith('/get_devicelist')) d.count = 101; },
    (d,p) => { if(d.devices_rev_month) d.devices_rev_month = []; },
    (d,p) => { if(d.devices_rev_month) d.devices_rev_month[0].total = null; },
    (d,p) => { if(d.devices_rev_month) d.devices_rev_month[0].total = 'not-money'; },
    (d,p) => { if(d.devices_rev_month) { d.devices_rev_month.push(d.devices_rev_month[0]); d.count = 2; } },
    (d,p) => { if(p.endsWith('/login')) { d.status = 401; d.message = 'fixture-password private-token'; } },
  ]) {
    mock(change);
    await assert.rejects(readMonth(eqlinkConfig(env), '09-2026', now), e => /EQLink/.test(e.message) && !/fixture-password|private-token/.test(e.message));
  }
});
test('bulk monthly reads stay below 50 calls and at most four concurrent requests', async () => {
  const h = mock(); await readMonth(eqlinkConfig(env), '08-2026', now);
  assert.equal(h.calls.length, 34); assert.ok(h.peak() <= 4);
});
test('unknown mapped serial fails instead of silently reverting to old revenue', async () => {
  mock((d,p) => { if(p.endsWith('/get_devicelist')) d.devicelist[0].devicename = 'OTHER'; });
  await assert.rejects(readMonth(eqlinkConfig(env), '09-2026', now), /EQLink/);
});
test('history replaces totals while retaining original uptime and LO identity', async () => {
  mock();
  const data = { code: 'LO_0001', history: [{ month: '08-2026', total: 999, uptime: 77 }] };
  const result = await replaceHistory(data, 'LO_0001', eqlinkConfig(env), now);
  assert.equal(result.history[0].total, 320); assert.equal(result.history[0].uptime, 77);
});

test('mapped codes absent from a month do not add rows or change its timeline', async () => {
  mock(); const config=eqlinkConfig(env), source=await readMonth(config,'09-2026',now);
  const data=base(); data.rows=data.rows.filter(r=>r.code!=='LO_0001');
  assert.deepEqual(mergeMonth(data,source,config),data);
});

test('31 December closes at 1 January without fabricating a 32nd day', async () => {
  mock(); const config=eqlinkConfig(env), source=await readMonth(config,'12-2025',now);
  const data=base(); data.month='12-2025'; data.slots=['31/12 22:00','01/01 00:00'];
  const result=mergeMonth(data,source,config);
  assert.equal(result.rows[0].daily['31/12'].closed,true);
  assert.equal(result.rows[0].cells[1].m,320);
  assert.equal(result.dailyLabels.length,31);
});
