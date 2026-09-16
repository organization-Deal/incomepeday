import { HttpError, requestJson } from './http.js';

const HOST = 'https://laundromat-th.eqlink.top';
const fail = () => new HttpError('อ่านข้อมูล EQLink ไม่สำเร็จ — ตรวจบัญชี การจับคู่ตู้ และความครบถ้วนของรายงาน');
const fields = ['EQLINK_USERNAME', 'EQLINK_PASSWORD', 'EQLINK_API_KEY', 'EQLINK_MAPPING'];

export function eqlinkConfig(env) {
  if (!fields.some(key => env[key])) return null;
  if (!fields.every(key => typeof env[key] === 'string' && env[key].trim())) throw fail();
  let mapping;
  try { mapping = JSON.parse(env.EQLINK_MAPPING); } catch { throw fail(); }
  if (!Array.isArray(mapping) || !mapping.length || mapping.length > 100) throw fail();
  const codes = new Set(), devices = new Set();
  for (const item of mapping) {
    if (!item || !/^LO_\d{4,10}$/.test(item.code) || typeof item.device !== 'string' ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(item.device) || codes.has(item.code) || devices.has(item.device)) throw fail();
    codes.add(item.code); devices.add(item.device);
  }
  return { username: env.EQLINK_USERNAME, password: env.EQLINK_PASSWORD,
    key: env.EQLINK_API_KEY, mapping };
}

export async function configFingerprint(config) {
  if (!config) return 'off';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(config)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
function today(now) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}
export function monthDates(month, now = new Date()) {
  if (!/^(0[1-9]|1[0-2])-20\d{2}$/.test(month)) throw new HttpError('เดือน EQLink ไม่ถูกต้อง', 400);
  const [mm, yy] = month.split('-');
  const count = new Date(Date.UTC(Number(yy), Number(mm), 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${yy}-${mm}-${String(i + 1).padStart(2, '0')}`)
    .filter(date => date <= today(now));
}
function label(date) { return date.slice(8, 10) + '/' + date.slice(5, 7); }
function nextLabel(date) { return label(new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString()); }

// Shared deadline, no retries. All POSTs below are reads, except authentication.
async function session(config) {
  const deadline = Date.now() + 40000;
  let auth = {};
  async function post(path, body) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw fail();
    try {
      const data = await requestJson(HOST + path, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-api-key': config.key },
        body: JSON.stringify({ token_type: 1, ...auth, ...body }),
      }, { timeout: Math.min(12000, remaining) });
      if (!data || Number(data.status) !== 200) throw fail();
      return data;
    } catch { throw fail(); } // Never expose upstream messages, tokens or credentials.
  }
  const login = await post('/api/Auth/login', { login: config.username, password: config.password });
  if (typeof login.token !== 'string' || !login.token ||
      !['string', 'number'].includes(typeof login.vendor_id) || !String(login.vendor_id)) throw fail();
  auth = { token: login.token, vendor_id: login.vendor_id };
  const vendor = await post('/api/Vendor/get_vendor_info', {});
  // Verified EQLink currency.json: THB decimal=false, API reports major units.
  if (vendor.vendor_info?.currency !== 'THB') throw fail();
  return post;
}
function rows(data, key) {
  const list = data[key];
  if (!Array.isArray(list) || list.length > 100 || data.count == null ||
      !Number.isInteger(Number(data.count)) || Number(data.count) !== list.length) throw fail();
  const ids = new Set();
  for (const row of list) {
    if (!row || typeof row.devicename !== 'string' || !row.devicename || ids.has(row.devicename)) throw fail();
    ids.add(row.devicename);
  }
  return list;
}
async function report(post, start, end, mapping) {
  const data = await post('/api/Revenue/get_dev_revenue_by_date_range', {
    start_time: start, end_time: end, limit: 100, offset: 0,
  });
  const list = rows(data, 'devices_rev_month'), totals = {};
  for (const { code, device } of mapping) {
    const value = list.find(row => row.devicename === device)?.total;
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' ||
        !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER / 100) throw fail();
    totals[code] = Math.round(Number(value) * 100); // Integer satang during summation.
  }
  return totals;
}
async function mapBounded(items, fn) {
  const results = new Array(items.length); let cursor = 0, error;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length && !error) {
      const i = cursor++;
      try { results[i] = await fn(items[i]); } catch (err) { error = err; }
    }
  }));
  if (error) throw error;
  return results;
}

export async function readMonth(config, month, now = new Date()) {
  const dates = monthDates(month, now);
  if (!dates.length) return { dates, totals: [], status: {}, current: false };
  const post = await session(config);
  const devices = rows(await post('/api/v3/Device/get_devicelist', { type: '1', limit: 100, offset: 0 }), 'devicelist');
  const status = {};
  for (const { code, device } of config.mapping) {
    const row = devices.find(d => d.devicename === device);
    if (!row || row.device_type !== 'CT') throw fail();
    status[code] = Number(row.failure) === 1 ? 'ERROR' :
      row.status === 'online' ? 'ONLINE' : row.status === 'offline' ? 'OFFLINE' : 'UNKNOWN';
  }
  const totals = await mapBounded(dates, date => report(post, date, date, config.mapping));
  return { dates, totals, status, current: dates.includes(today(now)), today: today(now) };
}

export function mergeMonth(data, source, config) {
  if (!Array.isArray(data.rows) || !Array.isArray(data.slots)) throw fail();
  const codes = new Set(config.mapping.map(m => m.code));
  const indices = new Map(data.slots.map((s, i) => [s, i]));
  const seen = new Set();
  const merged = data.rows.map(row => {
    if (!codes.has(row.code)) return row;
    if (seen.has(row.code)) throw fail();
    seen.add(row.code);
    if (!Array.isArray(row.cells)) throw fail();
    let total = 0;
    const daily = {};
    source.dates.forEach((date, i) => {
      total += source.totals[i][row.code];
      if (!Number.isSafeInteger(total)) throw fail();
      const day = label(date);
      const index = indices.get(nextLabel(date) + ' 00:00') ?? indices.get(day + ' 22:00') ?? indices.get(day + ' 00:00');
      daily[day] = { s: row.cells[index]?.s || 'UNKNOWN', d: source.totals[i][row.code] / 100,
        m: total / 100, closed: date < source.today };
    });
    const roundTotals = new Map(source.dates.filter(date => date < source.today)
      .map(date => [nextLabel(date) + ' 00:00', daily[label(date)]]));
    const cells = data.slots.map((slot, i) => {
      const observed = row.cells[i], money = roundTotals.get(slot);
      return observed || money ? { s: observed?.s || 'UNKNOWN', d: money?.d ?? null, m: money?.m ?? null } : null;
    });
    return { ...row, cells, daily, revenueSource: 'eqlink',
      ...(source.current ? { currentStatus: source.status[row.code] } : {}) };
  });
  return seen.size ? { ...data, rows: merged, dailyLabels: source.dates.map(label) } : data;
}

export async function replaceHistory(data, code, config, now = new Date()) {
  const mapping = config.mapping.filter(m => m.code === code);
  if (!mapping.length) return data;
  if (!Array.isArray(data.history) || data.history.length > 36) throw fail();
  const ranges = data.history.map(h => monthDates(h.month, now));
  if (!ranges.some(dates => dates.length)) return data;
  const post = await session(config);
  const history = await mapBounded(data.history, async (entry) => {
    const dates = monthDates(entry.month, now);
    if (!dates.length) return { ...entry, total: null };
    const total = await report(post, dates[0], dates.at(-1), mapping);
    return { ...entry, total: total[code] / 100 };
  });
  return { ...data, history };
}
