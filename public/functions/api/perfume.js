// functions/api/perfume.js   ← วางในรีโป deal-dividend (Cloudflare Pages)
// Proxy → dkmvending.com (ตู้น้ำหอม DKM) เพื่อเลี่ยง CORS
// รับ POST {token, time:"YYYY-MM-DD~YYYY-MM-DD", ids:[machine_id,...]}
// คืน {ok:true, results:{machine_id: ยอดรวม(number)|null}}
const DKM = 'https://dkmvending.com';

function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function oneMachine(token, id, time) {
  try {
    const r = await fetch(DKM + '/system/data.index/singleMachineAnalysis', {
      method: 'POST',
      headers: { 'token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, time })
    });
    if (!r.ok) return [id, null];
    const j = await r.json();
    const d = j && j.data;
    if (!d) return [id, null];
    // allsales = ยอดสะสม lifetime (ไม่เอา) — รวม dateList[].salePrice = ยอดเฉพาะวันในช่วง time
    const dl = Array.isArray(d.dateList) ? d.dateList : [];
    const sum = dl.reduce((s, x) => s + (Number(x && x.salePrice) || 0), 0);
    return [id, Math.round(sum * 100) / 100];
  } catch (e) {
    return [id, null];
  }
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); }
  catch { return json({ ok: false, error: 'bad json' }, 400); }

  const token = (body.token || '').trim();
  const time = (body.time || '').trim();
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (!token) return json({ ok: false, error: 'ไม่มี token' }, 400);
  if (!time || !time.includes('~')) return json({ ok: false, error: 'time ต้องเป็น YYYY-MM-DD~YYYY-MM-DD' }, 400);
  if (!ids.length) return json({ ok: false, error: 'ไม่มี machine ids' }, 400);

  // ดึงทีละชุด 8 ตัว กัน rate-limit / timeout
  const results = {};
  const B = 8;
  for (let i = 0; i < ids.length; i += B) {
    const part = await Promise.all(ids.slice(i, i + B).map(id => oneMachine(token, id, time)));
    part.forEach(([id, v]) => { results[id] = v; });
  }
  return json({ ok: true, time, count: ids.length, results });
}

// GET ไว้เช็คว่าติดตั้งแล้ว
export async function onRequestGet() {
  return json({ ok: true, msg: 'perfume proxy พร้อม — ใช้ POST {token,time,ids}' });
}
