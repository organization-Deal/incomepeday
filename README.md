# DEAL! — สถานะตู้รายวัน

หน้าเว็บดูสถานะ + รายได้ตู้ อ่านจาก **Lark Bitable** (ตาราง `สถานะตู้ MM-YYYY` ที่ `DEAL_MachineStatus_Daily.gs` เขียนวันละ 2 รอบ)

```
Lark Bitable  →  Apps Script (API + cache)  →  Cloudflare Worker (/api + แคชขอบ)  →  public/index.html
   ฐานข้อมูล           ตัวอ่าน/แปลงข้อมูล            ซ่อน URL+token, แคช                    หน้าจอ
```

Lark ยังเป็นแหล่งความจริงเดียว ไม่มีข้อมูลถูกก๊อปไปเก็บที่อื่น

---

## โครงไฟล์ (สำคัญ — วางผิดที่ = พัง)

```
.
├── public/
│   └── index.html      ← หน้าเว็บทั้งหมด ไฟล์เดียวจบ
├── src/
│   └── index.js        ← Worker: /api = proxy, ที่เหลือ = เสิร์ฟไฟล์ใน public/
├── wrangler.jsonc      ← config
├── .gitignore
└── README.md
```

> **ห้าม** ตั้ง assets directory เป็น `.` หรือ `/`
> ไม่งั้น `.git/` ทั้งโฟลเดอร์จะโดนอัปขึ้นเป็นไฟล์สาธารณะ ใครก็โหลด source ทั้ง repo ไปได้ที่ `/.git/config`
> ใน `wrangler.jsonc` ตั้งไว้เป็น `./public` แล้ว

---

## Deploy

### 1. GitHub

```bash
git add .
git commit -m "restructure: worker + static assets"
git push
```

Workers Builds จะ build ใหม่เองทุก push เข้า `main`

### 2. Build settings (Dashboard > Workers > incomepeday > Settings > Build)

| ช่อง | ค่า |
|---|---|
| Build command | *(ว่าง)* |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

### 3. Apps Script

1. ตั้ง token ใน `DEAL_MachineStatus_API.gs`:
   ```js
   const API_TOKEN = 'สุ่มอะไรก็ได้ยาว ๆ';
   ```
2. **Deploy > New deployment > Web app** — Execute as **Me**, Access **Anyone**
3. ก๊อป URL ที่ลงท้าย `/exec`

> Access ต้องเป็น Anyone เพราะ Cloudflare เรียกเข้ามาแบบไม่มีบัญชี Google
> ความปลอดภัยมาจาก `API_TOKEN` + Cloudflare Access ในข้อ 5

### 4. ใส่ Secret

Dashboard > Workers > **incomepeday > Settings > Variables and Secrets** > Add — ประเภท **Secret**:

| ชื่อ | ค่า |
|---|---|
| `GAS_URL` | URL `/exec` จากข้อ 3 |
| `GAS_TOKEN` | ค่าเดียวกับ `API_TOKEN` |

หรือจากเครื่อง:
```bash
npx wrangler secret put GAS_URL
npx wrangler secret put GAS_TOKEN
```

> ใส่แล้วต้อง **deploy ใหม่อีกครั้ง** ถึงจะมีผล

### 5. ล็อกไม่ให้คนนอกเข้า — ทำก่อนแจกลิงก์

`*.workers.dev` เปิดสาธารณะ ใครเดา URL เจอก็เห็นรายได้ทั้งกอง

**Cloudflare Access** (Zero Trust) — ฟรีถึง 50 คน:

1. Zero Trust > **Access > Applications > Add an application > Self-hosted**
2. ใส่โดเมนของ Worker
3. Policy: `Allow` → `Include > Emails ending in` → `@โดเมนบริษัท`
4. Save

`wrangler.jsonc` ปิด `preview_urls` ไว้แล้ว — กัน URL ของ build เก่าหลุดออกไปโดยไม่มีใครล็อก

---

## เรื่องแคช

| ชั้น | อายุ | ล้างยังไง |
|---|---|---|
| Apps Script | 30 นาที (เดือนปัจจุบัน) / 6 ชม. (เดือนเก่า) | `clearApiCache()` |
| Cloudflare edge | 10 นาที (เดือนปัจจุบัน) / 6 ชม. (เดือนเก่า) | ปุ่ม ↻ ในเว็บ (ส่ง `?fresh=1` ทะลุทุกชั้น) |

ให้เว็บเห็นข้อมูลใหม่ทันทีหลังรอบเช็ค — เติมท้าย `runCheck_()` ใน `DEAL_MachineStatus_Daily.gs`:

```js
try { clearApiCache(); notifyOffline(); } catch(e) { Logger.log(e); }
```

---

## แก้ปัญหา

| อาการ | สาเหตุ |
|---|---|
| `ยังไม่ได้ตั้ง secret GAS_URL` | ยังไม่ได้ใส่ secret หรือใส่แล้วไม่ได้ deploy ใหม่ |
| `unauthorized` | `GAS_TOKEN` ไม่ตรงกับ `API_TOKEN` ใน `.gs` |
| `ไม่พบตาราง สถานะตู้ MM-YYYY` | เดือนนั้นยังไม่มีตารางใน Lark — รัน `runCheck2200()` หนึ่งครั้ง |
| หน้าเว็บขึ้นข้อมูลตัวอย่าง | เปิดไฟล์จากเครื่อง (`file://`) — ต้องเปิดผ่าน URL ของ Worker |
| แก้ `.gs` แล้วเว็บเหมือนเดิม | Apps Script ต้อง **Manage deployments > แก้ > Version: New version** ทุกครั้ง |
| `/.git/config` โหลดได้ | assets directory ชี้ผิดที่ — ต้องเป็น `./public` |

ดู log สด: `npx wrangler tail` หรือ Dashboard > Workers > incomepeday > Logs

---

## เกณฑ์ที่ปรับได้

`public/index.html` — ตัวแปร `RULE` บนสุดของ `<script>`:

```js
DEAD_DAYS: 2,     // ดับกี่วันติด = ขึ้น watchlist
GRACE_DAYS: 1,    // ดับไม่เกินกี่วัน = ถือว่าร้านปิดปกติ ไม่ใช่ความผิดทีม
DROP_PCT: 0.6,    // รายได้ร่วงกี่ % = ผิดสังเกต
```

`DEAL_MachineStatus_API.gs` — ตัวแปร `ALERT` = เกณฑ์ยิงแจ้งเตือนเข้ากลุ่ม Lark
