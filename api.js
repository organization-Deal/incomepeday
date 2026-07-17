/**
 * Cloudflare Pages Function — /api
 * ------------------------------------------------------------------
 * ทำหน้าที่เป็นตัวกลางระหว่างหน้าเว็บ กับ Apps Script Web App
 *
 * ทำไมต้องมี:
 *   1. URL ของ Apps Script + token อยู่ใน environment variable ฝั่ง Cloudflare
 *      ไม่หลุดออกไปในหน้าเว็บ (View Source ไม่เจอ)
 *   2. หน้าเว็บเรียก /api ซึ่งเป็น origin เดียวกัน → ไม่มีปัญหา CORS
 *   3. แคชที่ขอบ Cloudflare อีกชั้น → เปิดเว็บเร็วขึ้นมาก และลดโควต้า Apps Script
 *
 * Environment variables ที่ต้องตั้งใน Cloudflare Pages > Settings > Variables:
 *   GAS_URL    = https://script.google.com/macros/s/xxxxx/exec   (ต้องมี)
 *   GAS_TOKEN  = ค่าเดียวกับ API_TOKEN ใน .gs                     (ไม่มีก็ได้ ถ้าไม่ได้ตั้ง)
 */

const ALLOWED = ['months', 'month', 'history'];

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.GAS_URL) {
    return json({ ok: false, error: 'ยังไม่ได้ตั้ง environment variable GAS_URL ใน Cloudflare Pages' }, 500);
  }

  const src = new URL(request.url);
  const action = src.searchParams.get('action') || 'month';
  if (!ALLOWED.includes(action)) {
    return json({ ok: false, error: 'action ไม่ถูกต้อง' }, 400);
  }

  // ประกอบ URL ปลายทาง — ส่งต่อเฉพาะพารามิเตอร์ที่อนุญาต
  const target = new URL(env.GAS_URL);
  target.searchParams.set('action', action);
  for (const k of ['month', 'code', 'fresh']) {
    const v = src.searchParams.get(k);
    if (v) target.searchParams.set(k, v);
  }
  if (env.GAS_TOKEN) target.searchParams.set('key', env.GAS_TOKEN);

  const fresh = src.searchParams.get('fresh') === '1';
  const cache = caches.default;
  const cacheKey = new Request(new URL(src.pathname + src.search.replace(/&?fresh=1/, ''), src.origin), request);

  if (!fresh) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set('x-cache', 'HIT');
      return r;
    }
  }

  try {
    // Apps Script จะ redirect ไป script.googleusercontent.com — fetch ตามให้เอง
    const up = await fetch(target.toString(), {
      redirect: 'follow',
      headers: { 'accept': 'application/json' },
    });
    const body = await up.text();

    // เดือนที่จบแล้วข้อมูลนิ่ง แคชได้ยาว / เดือนปัจจุบันแคช 10 นาที (รอบเช็ควันละ 2 ครั้ง)
    const cur = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok' }).slice(3).replace('/', '-');
    const isCur = (src.searchParams.get('month') || cur) === cur;
    const ttl = action === 'history' ? 1800 : (isCur ? 600 : 21600);

    const res = new Response(body, {
      status: up.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=60, s-maxage=${ttl}`,
        'x-cache': 'MISS',
      },
    });

    if (up.ok) context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return json({ ok: false, error: 'ต่อ Apps Script ไม่ได้: ' + err.message }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
