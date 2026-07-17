/****************************************************************************************
 * DEAL_MachineStatus_API.gs   (v3)
 * ------------------------------------------------------------------------------------
 * วางเป็นไฟล์ที่ 2 ในโปรเจกต์เดียวกับ DEAL_MachineStatus_Daily.gs
 * (ใช้ CFG / larkGet_ / larkPost_ / listAll_ / textOf_ ร่วมกัน — ห้ามประกาศซ้ำ)
 *
 * มีอะไรบ้าง:
 *   1) doGet    → JSON ให้หน้าเว็บ HTML (มี cache, ประวัติข้ามเดือน, ผู้ดูแล)
 *   2) notifyOffline() → ยิงการ์ดแจ้งเตือนตู้ดับเข้ากลุ่ม Lark (กันสแปมด้วย)
 *
 * ── ติดตั้ง ──────────────────────────────────────────────────────────────────────
 * A) Web App:  Deploy > New deployment > Web app > Execute as Me / Access Anyone
 *              เอา URL .../exec ไปวางในตัวแปร API ของไฟล์ HTML
 *
 * B) แจ้งเตือน (ถ้าจะใช้):
 *    1. ในกลุ่ม Lark ช่าง → ตั้งค่า > Bots > Add Bot > Custom Bot > ก๊อป Webhook URL
 *    2. รัน  saveWebhook('https://open.larksuite.com/open-apis/bot/v2/hook/xxxx')
 *    3. เติมบรรทัดนี้ท้ายฟังก์ชัน runCheck_() ในไฟล์ DEAL_MachineStatus_Daily.gs:
 *          try { clearApiCache(); notifyOffline(); } catch(e) { Logger.log(e); }
 *
 * C) ผู้ดูแล / Leaderboard:
 *    เพิ่มคอลัมน์ในตาราง 02 ชื่ออันใดอันหนึ่ง: "ผู้ดูแล" | "ผู้รับผิดชอบ" | "โซน" | "ทีม"
 *    ระบบจะเจอเอง แล้วหน้าเว็บจะโชว์ Leaderboard ให้อัตโนมัติ (ไม่มีคอลัมน์ = ซ่อนไว้)
 ****************************************************************************************/

const API_TOKEN = '';       // ล็อกเว็บ: ใส่เช่น 'deal2026' แล้วเรียก ?key=deal2026
const CACHE_MIN = 30;       // นาที — เดือนปัจจุบัน
const CACHE_OLD = 360;      // นาที — เดือนที่จบแล้ว

/* เกณฑ์แจ้งเตือน — ให้ตรงกับ RULE ในไฟล์ HTML */
const ALERT = {
  DEAD_ROUNDS: 4,     // ดับติดกันกี่รอบถึงเตือน (4 รอบ = ~2 วัน)
  REMIND_DAYS: 3,     // ถ้ายังไม่ซ่อม เตือนซ้ำทุกกี่วัน
  MAX_LIST:    15,    // ใส่ในการ์ดสูงสุดกี่ตู้
};

/* ชื่อคอลัมน์ผู้ดูแลที่ระบบจะลองหาในตาราง 02 (เจออันไหนก่อนใช้อันนั้น) */
const OWNER_FIELDS = ['ผู้ดูแล', 'ผู้รับผิดชอบ', 'ทีมดูแล', 'โซน', 'ทีม', 'Zone', 'Owner'];

/* ========================= WEB APP ========================= */

/**
 * ── โหมดที่ 1: เสิร์ฟหน้าเว็บเอง (แนะนำ) ──
 *   เปิด URL .../exec เปล่า ๆ  → ได้หน้า dashboard เลย
 *   ต้องมีไฟล์ชื่อ "index" (HTML) ในโปรเจกต์นี้ — ดูวิธีในหัวข้อ DEPLOY ด้านล่าง
 *
 * ── โหมดที่ 2: เป็น JSON API ให้เว็บที่ host ที่อื่น (Cloudflare Pages ฯลฯ) ──
 *   .../exec?action=month&month=07-2026
 */
function doGet(e) {
  const p = (e && e.parameter) || {};

  // ไม่มี action = ขอหน้าเว็บ
  if (!p.action) {
    try {
      return HtmlService.createHtmlOutputFromFile('index')
        .setTitle('DEAL! — สถานะตู้')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)  // ให้ฝังใน Lark ได้
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    } catch (err) {
      return HtmlService.createHtmlOutput(
        '<p style="font-family:sans-serif;padding:40px">ยังไม่ได้เพิ่มไฟล์ <b>index.html</b> ในโปรเจกต์<br>' +
        'หรือใช้เป็น JSON API: <code>?action=month</code></p>');
    }
  }

  try {
    if (API_TOKEN && p.key !== API_TOKEN) throw new Error('unauthorized');
    const fresh = p.fresh === '1';
    let out;
    switch (p.action) {
      case 'months':  out = cached_('months', CACHE_OLD, fresh, apiListMonths_); break;
      case 'history': out = apiHistory_(p.code, fresh); break;
      default:        out = monthData_(p.month || Utilities.formatDate(new Date(), CFG.TZ, 'MM-yyyy'), fresh);
    }
    return json_({ ok: true, data: out });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ── RPC: หน้าเว็บที่ Apps Script เสิร์ฟเอง เรียกผ่าน google.script.run (ไม่ต้องยุ่งกับ CORS) ── */
function rpc(action, params) {
  params = params || {};
  try {
    let out;
    switch (action) {
      case 'months':  out = cached_('months', CACHE_OLD, !!params.fresh, apiListMonths_); break;
      case 'history': out = apiHistory_(params.code, !!params.fresh); break;
      default:        out = monthData_(params.month || Utilities.formatDate(new Date(), CFG.TZ, 'MM-yyyy'), !!params.fresh);
    }
    return JSON.stringify({ ok: true, data: out });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ========================= CACHE ========================= */

function cached_(key, minutes, fresh, producer) {
  const c = CacheService.getScriptCache(), k = 'MS_' + key;
  if (!fresh) {
    const raw = readChunks_(c, k);
    if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  }
  const val = producer();
  writeChunks_(c, k, JSON.stringify(val), minutes * 60);
  return val;
}

function writeChunks_(c, k, str, sec) {
  const SIZE = 90000, n = Math.ceil(str.length / SIZE), map = {};
  map['__n_' + k] = String(n);
  for (let i = 0; i < n; i++) map[k + '_' + i] = str.substr(i * SIZE, SIZE);
  try { c.putAll(map, sec); } catch (e) { Logger.log('cache write skip: ' + e); }
}

function readChunks_(c, k) {
  const n = Number(c.get('__n_' + k) || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(k + '_' + i);
  const got = c.getAll(keys);
  let s = '';
  for (let i = 0; i < n; i++) { if (got[k + '_' + i] == null) return null; s += got[k + '_' + i]; }
  return s;
}

/** ล้าง cache — เรียกท้ายรอบเช็ค ให้เว็บเห็นข้อมูลใหม่ทันที */
function clearApiCache() {
  const c = CacheService.getScriptCache();
  const cur = Utilities.formatDate(new Date(), CFG.TZ, 'MM-yyyy');
  const del = ['__n_MS_months'];
  for (let i = 0; i < 6; i++) { del.push('MS_months_' + i); del.push('MS_m_' + cur + '_' + i); }
  del.push('__n_MS_m_' + cur);
  for (let i = 0; i < 40; i++) del.push('MS_m_' + cur + '_' + i);
  try { c.removeAll(del); } catch (e) {}
  Logger.log('🧹 ล้าง cache แล้ว');
}

/* ========================= DATA ========================= */

function monthData_(month, fresh) {
  const cur = Utilities.formatDate(new Date(), CFG.TZ, 'MM-yyyy');
  return cached_('m_' + month, month === cur ? CACHE_MIN : CACHE_OLD, fresh, () => apiMonth_(month));
}

function apiListMonths_() {
  const j = larkGet_('/open-apis/bitable/v1/apps/' + CFG.BASE_TOKEN + '/tables?page_size=100');
  const months = ((j.data && j.data.items) || [])
    .filter(t => t.name.indexOf(CFG.TABLE_PREFIX) === 0)
    .map(t => t.name.replace(CFG.TABLE_PREFIX, '').trim())
    .sort((a, b) => monthKey_(b).localeCompare(monthKey_(a)));
  return { months: months };
}

function monthKey_(s) { const p = String(s).split('-'); return (p[1] || '') + (p[0] || ''); }

/** อ่านผู้ดูแลจากตาราง 02 → { LO_0001: 'วิษณุ', ... }  (ไม่มีคอลัมน์ = {}) */
function ownerMap_() {
  const fj = larkGet_('/open-apis/bitable/v1/apps/' + CFG.BASE_TOKEN + '/tables/' + CFG.SOURCE_TABLE_ID + '/fields?page_size=200');
  const names = ((fj.data && fj.data.items) || []).map(f => f.field_name);
  const field = OWNER_FIELDS.find(f => names.indexOf(f) >= 0);
  if (!field) return { field: null, map: {} };

  const map = {};
  listAll_(CFG.SOURCE_TABLE_ID).forEach(it => {
    const f = it.fields || {};
    const code = textOf_(f['รหัสโลเคชั่น']);
    const own  = textOf_(f[field]);
    if (code && own) map[code] = own;
  });
  return { field: field, map: map };
}

function apiMonth_(month) {
  const want = CFG.TABLE_PREFIX + month;
  const tj = larkGet_('/open-apis/bitable/v1/apps/' + CFG.BASE_TOKEN + '/tables?page_size=100');
  const t = ((tj.data && tj.data.items) || []).find(x => x.name === want);
  if (!t) throw new Error('ไม่พบตาราง ' + want);

  const fj = larkGet_('/open-apis/bitable/v1/apps/' + CFG.BASE_TOKEN + '/tables/' + t.table_id + '/fields?page_size=200');
  const slots = ((fj.data && fj.data.items) || [])
    .map(f => f.field_name)
    .filter(n => /^\d{2}\/\d{2}\s\d{2}:\d{2}$/.test(n))
    .sort(slotCmp_);

  const own = ownerMap_();
  const rows = listAll_(t.table_id).map(it => {
    const f = it.fields || {};
    const code = textOf_(f['รหัสโลเคชั่น']);
    return {
      code:  code,
      name:  textOf_(f['ชื่อโลเคชั่น']),
      owner: own.map[code] || '',
      cells: slots.map(s => parseCell_(textOf_(f[s]))),
    };
  }).filter(r => r.code);

  rows.sort((a, b) => a.code.localeCompare(b.code));
  return { month: month, slots: slots, rows: rows, ownerField: own.field, updated: new Date().toISOString() };
}

/** เรียงคอลัมน์ "dd/MM HH:mm" ตามเวลาจริง (กันกรณีคอลัมน์ถูกสลับตำแหน่งใน Lark) */
function slotCmp_(a, b) {
  const k = s => { const m = s.match(/^(\d{2})\/(\d{2})\s(\d{2}):(\d{2})$/);
    return m ? (m[2] + m[1] + m[3] + m[4]) : s; };
  const ka = k(a), kb = k(b);
  if (ka === kb) return 0;
  // 00:00 ของวันถัดไป ต้องอยู่หลัง 22:00 ของวันก่อน — เรียงตามวัน+เวลาตรง ๆ ได้เลย
  return ka < kb ? -1 : 1;
}

function apiHistory_(code, fresh) {
  if (!code) throw new Error('ต้องระบุ code');
  const months = cached_('months', CACHE_OLD, fresh, apiListMonths_).months;
  const out = [];
  months.slice(0, 12).forEach(m => {
    let d; try { d = monthData_(m, false); } catch (e) { return; }
    const r = d.rows.find(x => x.code === code);
    if (!r) return;
    const cells = r.cells.filter(Boolean);
    if (!cells.length) return;
    out.push({
      month:  m,
      total:  cells.reduce((s, c) => Math.max(s, c.m || 0), 0),
      uptime: Math.round(cells.filter(c => c.s === 'ONLINE').length / cells.length * 100),
      rounds: cells.length,
    });
  });
  out.reverse();
  return { code: code, history: out };
}

function parseCell_(txt) {
  if (!txt) return null;
  const st = /Online/i.test(txt)  ? 'ONLINE'
           : /Offline/i.test(txt) ? 'OFFLINE'
           : /Error/i.test(txt)   ? 'ERROR'
           : 'UNKNOWN';
  const m = txt.match(/([\d,\.\-]+)\s*\/\s*วัน\s*[l|｜|]?\s*([\d,\.\-]+)\s*\/\s*เดือน/);
  const num = v => (!v || v === '-') ? null : Number(String(v).replace(/,/g, ''));
  return { s: st, d: m ? num(m[1]) : null, m: m ? num(m[2]) : null };
}

/* ========================= แจ้งเตือนเข้ากลุ่ม LARK ========================= */

function saveWebhook(url) {
  if (!url) { Logger.log("ใส่ค่า เช่น saveWebhook('https://open.larksuite.com/open-apis/bot/v2/hook/xxxx')"); return; }
  PropertiesService.getScriptProperties().setProperty('LARK_WEBHOOK', url);
  Logger.log('✅ เก็บ webhook แล้ว — ลองยิงทดสอบด้วย notifyOffline()');
}

/**
 * ยิงการ์ดตู้ดับเข้ากลุ่ม — เรียกท้าย runCheck_() ทุกรอบได้เลย
 * กันสแปม: ตู้เดิมจะเตือนซ้ำก็ต่อเมื่อผ่านไป ALERT.REMIND_DAYS วัน
 *          และตู้ที่กลับมา Online แล้วจะถูกล้างสถานะ (ครั้งหน้าดับใหม่ = เตือนใหม่)
 */
function notifyOffline() {
  const hook = PropertiesService.getScriptProperties().getProperty('LARK_WEBHOOK');
  if (!hook) { Logger.log('ยังไม่ได้ตั้ง webhook — ข้ามการแจ้งเตือน'); return; }

  const month = Utilities.formatDate(new Date(), CFG.TZ, 'MM-yyyy');
  const d = apiMonth_(month);   // อ่านสด ไม่ผ่าน cache

  const props = PropertiesService.getScriptProperties();
  const sent = JSON.parse(props.getProperty('ALERT_SENT') || '{}');
  const now = Date.now();
  const alerts = [];

  d.rows.forEach(r => {
    const cells = r.cells.filter(c => c);
    if (!cells.length) return;

    // นับรอบที่ดับติดกันจากท้าย
    let down = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i].s === 'ONLINE') break;
      if (cells[i].s === 'ERROR')  return;    // Error = เข้าเช็คไม่ได้ ไม่ใช่ตู้ดับ ไม่ต้องปลุกช่าง
      down++;
    }
    if (down < ALERT.DEAD_ROUNDS) { delete sent[r.code]; return; }   // ปกติ → ล้างสถานะ

    const last = sent[r.code];
    if (last && now - last < ALERT.REMIND_DAYS * 864e5) return;      // เตือนไปแล้ว ยังไม่ถึงรอบเตือนซ้ำ

    const on = cells.filter(c => c.s === 'ONLINE');
    const avg = on.length ? on.reduce((s, c) => s + (c.d || 0), 0) / on.length : 0;
    alerts.push({
      code: r.code, name: r.name, owner: r.owner,
      days: Math.round(down / 2),
      lost: Math.round(avg * down / 2),
      repeat: !!last,
    });
    sent[r.code] = now;
  });

  if (!alerts.length) { props.setProperty('ALERT_SENT', JSON.stringify(sent)); Logger.log('✓ ไม่มีตู้ที่ต้องแจ้งเตือน'); return; }

  alerts.sort((a, b) => b.lost - a.lost);
  const totalLost = alerts.reduce((s, a) => s + a.lost, 0);

  const lines = alerts.slice(0, ALERT.MAX_LIST).map((a, i) =>
    '**' + (i + 1) + '. ' + a.name + '**  `' + a.code + '`\n' +
    '   ดับมา **' + a.days + ' วัน** · รายได้ที่หายไป ~**' + a.lost.toLocaleString('en-US') + '** บาท' +
    (a.owner ? ' · ผู้ดูแล: ' + a.owner : '') +
    (a.repeat ? '  ⏰ _เตือนซ้ำ — ยังไม่ได้แก้_' : '')
  ).join('\n');

  const more = alerts.length > ALERT.MAX_LIST ? '\n\n_และอีก ' + (alerts.length - ALERT.MAX_LIST) + ' ตู้_' : '';

  const card = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: 'red',
        title: { tag: 'plain_text', content: '🔴 ตู้ดับ ' + alerts.length + ' เครื่อง — ต้องเข้าแก้' },
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md',
          content: 'ประเมินรายได้ที่หายไปรวม **' + totalLost.toLocaleString('en-US') + ' บาท**\n' +
                   'เกณฑ์: ดับติดกัน ≥ ' + ALERT.DEAD_ROUNDS + ' รอบ (~' + Math.round(ALERT.DEAD_ROUNDS/2) + ' วัน)' } },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: lines + more } },
        { tag: 'note', elements: [{ tag: 'plain_text',
          content: 'อัปเดต ' + Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy HH:mm') + ' · เรียงตามเงินที่เสียไป' }] },
      ],
    },
  };

  const r = UrlFetchApp.fetch(hook, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(card), muteHttpExceptions: true,
  });
  Logger.log('📣 ส่งแจ้งเตือน ' + alerts.length + ' ตู้ → ' + r.getContentText().slice(0, 120));
  props.setProperty('ALERT_SENT', JSON.stringify(sent));
}

/** ล้างประวัติการแจ้งเตือน (ให้เตือนใหม่หมดในรอบถัดไป) */
function resetAlerts() {
  PropertiesService.getScriptProperties().deleteProperty('ALERT_SENT');
  Logger.log('✅ ล้างประวัติแจ้งเตือนแล้ว');
}

/* ========================= DEBUG ========================= */

function testOwnerField() {
  const o = ownerMap_();
  Logger.log(o.field ? '✅ เจอคอลัมน์ผู้ดูแล: "' + o.field + '" (' + Object.keys(o.map).length + ' ตู้)'
                     : '✗ ไม่เจอคอลัมน์ผู้ดูแลในตาราง 02 — ลองตั้งชื่อคอลัมน์เป็น: ' + OWNER_FIELDS.join(' / '));
}

function testApi() {
  const d = apiMonth_(Utilities.formatDate(new Date(), CFG.TZ, 'MM-yyyy'));
  Logger.log('ตู้ ' + d.rows.length + ' | คอลัมน์ ' + d.slots.length + ' | ผู้ดูแล: ' + (d.ownerField || '—'));
  Logger.log(JSON.stringify(d.rows[0]).slice(0, 300));
}
