import { HttpError, json, requestJson, requestBody } from './http.js';

const DKM_URL = 'https://dkmvending.com/system/data.index/singleMachineAnalysis';
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date) && date.toISOString().slice(0, 10) === value;
}
async function oneMachine(token, id, time) {
  try {
    const result = await requestJson(DKM_URL, {
      method: 'POST', headers: { token, 'content-type': 'application/json' },
      body: JSON.stringify({ id, time }),
    }, { timeout: 10000 });
    const list = result?.data?.dateList;
    if (!Array.isArray(list)) return [id, null];
    let sum = 0;
    for (const item of list) {
      const value = item?.salePrice;
      if ((typeof value !== 'number' && typeof value !== 'string') ||
          String(value).trim() === '' || !Number.isFinite(Number(value))) return [id, null];
      sum += Number(value);
    }
    return [id, Number.isFinite(sum) ? Math.round(sum * 100) / 100 : null];
  } catch { return [id, null]; }
}
export async function handlePerfume(request) {
  const body = await requestBody(request);
  if (typeof body.token !== 'string' || !body.token.trim() || body.token.length > 4096 || /[\r\n]/.test(body.token)) {
    throw new HttpError('ไม่มี token หรือ token ไม่ถูกต้อง', 400);
  }
  const range = typeof body.time === 'string' ? body.time.split('~') : [];
  if (range.length !== 2 || !range.every(validDate) || range[0] > range[1]) {
    throw new HttpError('time ต้องเป็น YYYY-MM-DD~YYYY-MM-DD และวันเริ่มไม่เกินวันสิ้นสุด', 400);
  }
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 40 ||
      body.ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new HttpError('machine ids ต้องเป็นเลขจำนวนเต็มบวก ไม่เกิน 40 รายการต่อครั้ง', 400);
  }
  const ids = [...new Set(body.ids)], results = {};
  // Browser sends chunks of 20. Six live connections at most, with no retry storm.
  for (let i = 0; i < ids.length; i += 6) {
    const part = await Promise.all(ids.slice(i, i + 6).map(id => oneMachine(body.token.trim(), id, body.time)));
    for (const [id, value] of part) results[id] = value;
  }
  return json({ ok: true, time: body.time, count: ids.length, results });
}
