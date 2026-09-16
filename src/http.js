export class HttpError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  } });
}
// Bound allocation as well as read time: upstream bodies may be HTML or invalid JSON.
export async function readJson(message, maxBytes = 8 * 1024 * 1024) {
  if (Number(message.headers.get('content-length')) > maxBytes) {
    await message.body?.cancel();
    throw new HttpError('ข้อมูลตอบกลับมีขนาดเกินกำหนด');
  }
  const reader = message.body?.getReader();
  if (!reader) throw new HttpError('ไม่ได้รับข้อมูล JSON');
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError('ข้อมูลตอบกลับมีขนาดเกินกำหนด');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); }
    catch { throw new HttpError('เซิร์ฟเวอร์ตอบกลับไม่ใช่ JSON — ตรวจการเข้าสู่ระบบและการตั้งค่า API'); }
  } finally { reader.releaseLock(); }
}
export async function requestJson(url, init = {}, { timeout = 30000, retry = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let again = false;
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        await res.body?.cancel();
        again = retry && attempt === 0 && [502, 503, 504].includes(res.status);
        if (!again) throw new HttpError('เซิร์ฟเวอร์ปลายทางตอบกลับ HTTP ' + res.status,
          res.status === 429 ? 429 : 502);
      } else {
        return await readJson(res);
      }
    } catch (err) {
      if (controller.signal.aborted) throw new HttpError('เซิร์ฟเวอร์ตอบช้าเกินกำหนด กรุณาลองใหม่', 504);
      if (err instanceof HttpError) throw err;
      again = retry && attempt === 0;
      if (!again) throw new HttpError('เชื่อมต่อเซิร์ฟเวอร์ปลายทางไม่ได้');
    } finally { clearTimeout(timer); }
    // Only idempotent reads retry. A disconnected write may already have succeeded.
    if (again) await new Promise(resolve => setTimeout(resolve, 500));
  }
}
export async function requestBody(request) {
  let body;
  try { body = await readJson(request, 16384); }
  catch { throw new HttpError('body ต้องเป็น JSON ขนาดไม่เกิน 16 KB', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError('body ต้องเป็น JSON object', 400);
  }
  return body;
}
