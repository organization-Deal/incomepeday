/**
 * Cloudflare Worker — DEAL! สถานะตู้
 * ------------------------------------------------------------------
 *  /api?action=...  →  ต่อไป Apps Script (ซ่อน URL + token + แคชที่ขอบ)
 *  ที่เหลือ         →  เสิร์ฟไฟล์จาก public/ (index.html)
 *
 * Secrets ที่ต้องตั้ง (Dashboard > Settings > Variables and Secrets):
 *   GAS_URL    = https://script.google.com/macros/s/xxxxx/exec
 *   GAS_TOKEN  = ค่าเดียวกับ API_TOKEN ใน DEAL_MachineStatus_API.gs
 */

const ALLOWED = ['months', 'month', 'history'];
const PASS = ['month', 'code', 'fresh'];   // พารามิเตอร์ที่ยอมส่งต่อ นอกนั้นตัดทิ้ง

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname === '/api/') {
      if (request.method !== 'GET') return json({ ok: false, error: 'method not allowed' }, 405);
      return handleApi(request, url, env, ctx);
    }

    // ไฟล์หน้าเว็บ
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, url, env, ctx) {
  if (!env.GAS_URL) {
    return json({ ok: false, error: 'ยังไม่ได้ตั้ง secret GAS_URL ใน Worker' }, 500);
  }

  const action = url.searchParams.get('action') || 'month';
  if (!ALLOWED.includes(action)) return json({ ok: false, error: 'action ไม่ถูกต้อง' }, 400);

  const target = new URL(env.GAS_URL);
  target.searchParams.set('action', action);
  for (const k of PASS) {
    const v = url.searchParams.get(k);
    if (v) target.searchParams.set(k, v);
  }
  if (env.GAS_TOKEN) target.searchParams.set('key', env.GAS_TOKEN);

  const fresh = url.searchParams.get('fresh') === '1';
  const cache = caches.default;
  const keyUrl = new URL(url.pathname + url.search.replace(/[?&]fresh=1/, ''), url.origin);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });

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
      headers: { accept: 'application/json' },
    });
    const body = await up.text();

    // เดือนปัจจุบันแคช 10 นาที (รอบเช็ควันละ 2 ครั้ง) / เดือนที่จบแล้วแคชยาว
    const cur = bkkMonth();
    const isCur = (url.searchParams.get('month') || cur) === cur;
    const ttl = action === 'history' ? 1800 : (isCur ? 600 : 21600);

    const res = new Response(body, {
      status: up.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=60, s-maxage=${ttl}`,
        'x-cache': 'MISS',
      },
    });

    if (up.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return json({ ok: false, error: 'ต่อ Apps Script ไม่ได้: ' + err.message }, 502);
  }
}

/** "MM-YYYY" ตามเวลาไทย — ให้ตรงกับชื่อตารางใน Lark */
function bkkMonth() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return g('month') + '-' + g('year');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
