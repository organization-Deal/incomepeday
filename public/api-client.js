// Classic script keeps the existing file:// demo working without a build step.
globalThis.DealApi = (() => {
  async function request(url, init = {}, timeout = 70000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
      let value;
      try { value = await res.json(); }
      catch { throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ใช่ JSON กรุณาตรวจการเข้าสู่ระบบหรือการเชื่อมต่อ'); }
      if (!res.ok || !value || value.ok !== true) {
        throw new Error(typeof value?.error === 'string' ? value.error : 'เชื่อมต่อไม่สำเร็จ (HTTP ' + res.status + ')');
      }
      return value;
    } catch (err) {
      if (controller.signal.aborted) throw new Error('การเชื่อมต่อใช้เวลาเกินกำหนด กรุณาลองใหม่');
      if (err instanceof TypeError) throw new Error('เชื่อมต่อไม่ได้ กรุณาตรวจเครือข่าย');
      throw err;
    } finally { clearTimeout(timer); }
  }
  async function perfume(token, time, ids) {
    const results = {};
    let failed = 0, lastError;
    // Keep each Worker invocation below its outbound-request budget.
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      try {
        const part = await request('/api/perfume', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, time, ids: chunk }),
        });
        if (!part.results || typeof part.results !== 'object' || Array.isArray(part.results)) {
          throw new Error('รูปแบบข้อมูลตู้น้ำหอมไม่ถูกต้อง');
        }
        for (const id of chunk) {
          if (!Object.prototype.hasOwnProperty.call(part.results, id) ||
              (part.results[id] !== null && !Number.isFinite(part.results[id]))) {
            throw new Error('ข้อมูลตู้น้ำหอมไม่ครบหรือไม่ถูกต้อง');
          }
          results[id] = part.results[id];
        }
      } catch (err) {
        failed++; lastError = err;
        for (const id of chunk) results[id] = null;
      }
    }
    if (failed && failed === Math.ceil(ids.length / 20)) throw lastError;
    return { ok: true, results };
  }
  return { request, perfume };
})();
