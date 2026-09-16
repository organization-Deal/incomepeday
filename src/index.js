import { HttpError, json, requestJson, requestBody } from './http.js';
import { handlePerfume } from './perfume.js';
import { eqlinkConfig, configFingerprint, readMonth, mergeMonth, replaceHistory } from './eqlink.js';
import { cemConfig, cemManifest, validateProviders, handleCem, cemCoordinator } from './cem.js';

const ALLOWED = ['months', 'month', 'history', 'notes'];
const WRITE = ['note', 'rename'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api' || url.pathname === '/api/') {
        if (request.method === 'GET') return await handleApi(url, env, ctx);
        if (request.method === 'POST') return await handleWrite(request, env);
        return json({ ok: false, error: 'method not allowed' }, 405);
      }
      if (url.pathname === '/api/perfume') {
        if (request.method === 'POST') return await handlePerfume(request);
        if (request.method === 'GET') return json({ ok: true, msg: 'perfume proxy พร้อม — ใช้ POST {token,time,ids}' });
        return json({ ok: false, error: 'method not allowed' }, 405);
      }
      if (url.pathname === '/api/cem') {
        if(request.method!=='GET') return json({ok:false,error:'method not allowed'},405);
        validateProviders(eqlinkConfig(env),cemConfig(env));
        return await handleCem(url,env,ctx);
      }
      if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'ไม่พบ API' }, 404);
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ ok: false, error: err instanceof HttpError ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ' },
        err instanceof HttpError ? err.status : 500);
    }
  },
};

function gasUrl(env) {
  if (!env.GAS_URL) throw new HttpError('ยังไม่ได้ตั้ง secret GAS_URL ใน Worker', 500);
  let url;
  try { url = new URL(env.GAS_URL); }
  catch { throw new HttpError('secret GAS_URL ไม่ใช่ URL ที่ถูกต้อง', 500); }
  if (url.protocol !== 'https:') throw new HttpError('GAS_URL ต้องใช้ HTTPS', 500);
  return url;
}

async function gasRequest(url, env, retry) {
  const data = await requestJson(url.toString(), {
    redirect: 'follow', headers: { accept: 'application/json' },
  }, { retry });
  if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean' ||
      (data.ok && retry && !Object.hasOwn(data, 'data'))) {
    throw new HttpError('รูปแบบข้อมูลจาก Apps Script ไม่ถูกต้อง');
  }
  if (!data.ok) {
    let message = typeof data.error === 'string' ? data.error : 'Apps Script ทำรายการไม่สำเร็จ';
    for (const secret of [env.GAS_URL, env.GAS_TOKEN]) if (secret) message = message.split(secret).join('[redacted]');
    throw new HttpError(message.slice(0, 500));
  }
  return data;
}

async function handleApi(url, env, ctx) {
  const action = url.searchParams.get('action') || 'month';
  if (!ALLOWED.includes(action)) throw new HttpError('action ไม่ถูกต้อง', 400);
  const code=url.searchParams.get('code');
  const providerOnly=/^(?:CEM|EQ)_[A-F0-9]{12}$/.test(code||'');
  if(providerOnly&&action==='notes')return json({ok:true,data:{notes:[],statuses:[]}});
  if(providerOnly&&action==='history'){
    const cem=cemConfig(env),boxing=eqlinkConfig(env);
    const now=Date.now();
    const history=Array.from({length:12},(_,i)=>{const d=new Date(now+7*3600000);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-i);return {month:String(d.getUTCMonth()+1).padStart(2,'0')+'-'+d.getUTCFullYear(),total:null,uptime:null};});
    let data={history};
    if(cem?.mapping.some(m=>m.code===code))data=await (await cemCoordinator(env,cem)).history(data,code);
    else if(boxing?.mapping.some(m=>m.code===code))data=await replaceHistory(data,code,boxing);
    else throw new HttpError('ไม่พบตู้',404);
    return json({ok:true,data});
  }
  const target = gasUrl(env);
  const params = new URLSearchParams({ action });
  for (const key of ['month', 'code']) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  // Explicit month prevents the previous month's default response persisting.
  if (action === 'month' && !params.has('month')) params.set('month', bkkMonth());
  for (const [key, value] of params) target.searchParams.set(key, value);
  if (env.GAS_TOKEN) target.searchParams.set('key', env.GAS_TOKEN);
  const live = action === 'notes';
  const fresh = live || url.searchParams.get('fresh') === '1';
  if (fresh) target.searchParams.set('fresh', '1');

  const keyUrl = new URL('/api', url.origin);
  keyUrl.search = params.toString();
  const boxing = ['month', 'history'].includes(action) ? eqlinkConfig(env) : null;
  const cem = ['month', 'history'].includes(action) ? cemConfig(env) : null;
  validateProviders(boxing,cem);
  keyUrl.searchParams.set('_cache', 'v5-' + await configFingerprint(boxing||cem?{boxing,cem}:null));
  const cacheKey = new Request(keyUrl);
  const cache = globalThis.caches?.default;
  if (cache && !fresh) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set('cache-control', 'no-store');
        res.headers.set('x-cache', 'HIT');
        return res;
      }
    } catch { /* Cache failure must not prevent an origin read. */ }
  }
  const [data, source] = await Promise.all([
    gasRequest(target, env, true),
    boxing && action === 'month' ? readMonth(boxing, params.get('month')) : null,
  ]);
  if (source) data.data = mergeMonth(data.data, source, boxing);
  if (boxing && action === 'history') data.data = await replaceHistory(data.data, params.get('code'), boxing);
  if (cem && action === 'history' && cem.mapping.some(m=>m.code===params.get('code'))) {
    const stub=await cemCoordinator(env,cem);
    try{data.data=await stub.history(data.data,params.get('code'));}
    catch{throw new HttpError('อ่านประวัติ CEM ไม่สำเร็จ — ตรวจ session และช่วงเวลารายงาน');}
  }
  if (cem && action === 'month') data.data.cem = await cemManifest(cem);
  const res = json(data);
  res.headers.set('x-cache', live ? 'BYPASS' : 'MISS');
  if (cache && !live) {
    const current = (params.get('month') || bkkMonth()) === bkkMonth();
    const ttl = action === 'history' ? 1800 : (current ? 600 : 21600);
    const stored = res.clone();
    stored.headers.set('cache-control', `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(cacheKey, stored).catch(() => {}));
  }
  return res;
}
function bkkMonth() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return get('month') + '-' + get('year');
}

async function handleWrite(request, env) {
  const body = await requestBody(request);
  if(/^(?:CEM|EQ)_/.test(typeof body.code==='string'?body.code.trim():''))throw new HttpError('ตู้นี้ยังไม่มีรหัส LO สำหรับบันทึกหรือเปลี่ยนชื่อ กรุณาจับคู่ทะเบียนก่อน',400);
  const url = gasUrl(env);
  if (!WRITE.includes(body.action)) throw new HttpError('action ไม่ถูกต้อง', 400);
  if (typeof body.code !== 'string' || !body.code.trim() || body.code.length > 40) {
    throw new HttpError('รหัสตู้ไม่ถูกต้อง', 400);
  }
  const limits = { name: 200, status: 60, note: 2000, by: 100 };
  for (const [key, max] of Object.entries(limits)) {
    if (body[key] != null && (typeof body[key] !== 'string' || body[key].length > max)) {
      throw new HttpError('ข้อมูล ' + key + ' ไม่ถูกต้องหรือยาวเกินกำหนด', 400);
    }
  }
  if (body.action === 'rename' && !body.name?.trim()) throw new HttpError('ไม่มีชื่อตู้', 400);
  if (body.action === 'note' && !body.note?.trim() && !body.status?.trim()) throw new HttpError('ไม่มีบันทึกหรือสถานะ', 400);
  // Cloudflare Access must protect this origin; the header alone is not authentication.
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  const payload = {
    action: body.action, code: body.code.trim(), name: body.name || '', status: body.status || '',
    note: body.note || '', by: (email || body.by || 'ไม่ระบุ').slice(0, 100), key: env.GAS_TOKEN || '',
  };
  // Preserve deployed GAS doGet contract. Never retry this GET: it mutates data.
  for (const [key, value] of Object.entries(payload)) if (value) url.searchParams.set(key, value);
  try { return json(await gasRequest(url, env, false)); }
  catch (err) {
    if (err instanceof HttpError) err.message += ' — หากส่งแล้ว กรุณาตรวจบันทึกก่อนส่งซ้ำ';
    throw err;
  }
}
