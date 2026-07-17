# DEAL! — สถานะตู้รายวัน

```
Lark Bitable  ←→  Apps Script  ──→  Cloudflare Worker  ──→  หน้าเว็บ
  ฐานข้อมูล        รันเช็ครายได้         โฮสต์ + ส่งต่อ /api        คนดู
                   + เสิร์ฟ API          (โค้ดมาจาก GitHub)
```

| ชั้น | ทำอะไร | อยู่ที่ไหน |
|---|---|---|
| **Lark** | ฐานข้อมูลจริง ตาราง `สถานะตู้ MM-YYYY` | Bitable |
| **Apps Script** | เช็คตู้ 292 ตัว วันละ 2 รอบ → เขียนลง Lark · เปิด API ให้เว็บอ่าน | `DEAL_MachineStatus_Daily.gs` + `DEAL_MachineStatus_API.gs` |
| **GitHub** | เก็บโค้ดหน้าเว็บ | repo นี้ |
| **Cloudflare** | โฮสต์หน้าเว็บ + ซ่อน URL ของ Apps Script + แคช | Worker `incomepeday` |

**ฟรีทั้งหมด** — ไม่มี KV ไม่มี Queue ไม่มี cron ฝั่ง Cloudflare
Lark เป็นแหล่งความจริงเดียว ไม่มีข้อมูลถูกก๊อปไปเก็บที่อื่น

---

## ทำไมต้องมี Worker คั่น ไม่ให้เว็บเรียก Apps Script ตรง ๆ

ถ้าใส่ URL ของ Apps Script ลงใน `index.html` ตรง ๆ → ใครกด **View Source** ก็ได้ URL ไป แล้วดึงรายได้ทุกตู้ได้
Worker ถือ URL + token ไว้ฝั่ง server เว็บเห็นแค่ `/api` ซึ่งเป็น origin เดียวกัน (ไม่ต้องยุ่ง CORS ด้วย)

---

## โครงไฟล์ (วางผิดที่ = พัง)

```
.
├── public/
│   └── index.html      หน้าเว็บทั้งหมด ไฟล์เดียวจบ ไม่มี build step
├── src/
│   └── index.js        Worker: /api = ส่งต่อไป Apps Script, ที่เหลือ = เสิร์ฟ public/
├── wrangler.jsonc
├── .gitignore
└── README.md
```

> ไฟล์ `.gs` **ไม่ต้องอยู่ใน repo นี้** — มันรันบน Apps Script ไม่ได้ deploy จาก Cloudflare
> (ถ้าจะเก็บเวอร์ชันไว้ ให้เปลี่ยน repo เป็น **Private** ก่อน เพราะในไฟล์มี `BASE_TOKEN` ของ Lark)

---

## ติดตั้ง

### 1. Apps Script — ตั้ง token แล้ว Deploy

เปิดโปรเจกต์ที่มี `DEAL_MachineStatus_Daily.gs` + `DEAL_MachineStatus_API.gs`

```js
const API_TOKEN = 'สุ่มยาว ๆ เช่น dl_9x2mKp7qR4vT';   // บรรทัดบนสุดของ API.gs
```

**Deploy > New deployment > Web app**
- Execute as: **Me**
- Who has access: **Anyone**
- ก๊อป URL ที่ลงท้าย `/exec`

**เช็คก่อนไปต่อ** — เอา URL เปิดในเบราว์เซอร์:
```
<URL>/exec?action=months&key=dl_9x2mKp7qR4vT
```
ต้องได้ `{"ok":true,"data":{"months":["07-2026",...]}}`

> ที่ต้องตั้ง Anyone เพราะ Cloudflare เรียกเข้ามาโดยไม่มีบัญชี Google
> ความปลอดภัยมาจาก `API_TOKEN` (URL เปล่า ๆ เปิดไม่ได้) + Cloudflare Access ในข้อ 4

### 2. GitHub

```bash
git add -A && git commit -m "dashboard" && git push
```

Build settings (Dashboard > Workers > incomepeday > Settings > Build):

| ช่อง | ค่า |
|---|---|
| Build command | *(ว่าง)* |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

### 3. Cloudflare — ใส่ Secret 2 ตัว

Settings > **Variables and Secrets** > Add > ชนิด **Secret** (ไม่ใช่ Text)

| ชื่อ | ค่า |
|---|---|
| `GAS_URL` | URL `/exec` จากข้อ 1 |
| `GAS_TOKEN` | ค่าเดียวกับ `API_TOKEN` |

**ใส่แล้วต้อง deploy ใหม่อีกครั้ง** (Deployments > Retry deployment) — secret ใหม่มีผลกับ build รอบถัดไปเท่านั้น

### 4. ล็อกก่อนแจกลิงก์

`*.workers.dev` เปิดสาธารณะ ใครเดา URL เจอเห็นรายได้ทั้งกอง

Zero Trust > **Access > Applications > Add > Self-hosted** > ใส่โดเมนของ Worker
Policy: `Allow` → `Include > Emails ending in` → `@โดเมนบริษัท` — ฟรีถึง 50 คน

### 5. เช็คว่าใช้ได้

| เปิด | ต้องได้ |
|---|---|
| `/` | หน้าเว็บ + **ชื่อร้านจริง** |
| `/api?action=months` | JSON รายชื่อเดือน |
| `/.git/config` | **404** |

> เห็น "Say Yes Bkk / Claro นิมมาน" ครบ 20 ตู้เป๊ะ = ยังเป็นข้อมูลตัวอย่าง แปลว่า `/api` ไม่ทำงาน

---

## แคช

| ชั้น | อายุ | ล้างยังไง |
|---|---|---|
| Apps Script (`CacheService`) | 30 นาที (เดือนปัจจุบัน) / 6 ชม. (เดือนเก่า) | `clearApiCache()` |
| Cloudflare edge | 10 นาที / 6 ชม. | ปุ่ม ↻ ในเว็บ (`?fresh=1` ทะลุทุกชั้น) |

ให้เว็บเห็นข้อมูลใหม่ทันทีหลังรอบเช็ค — เติมท้าย `runCheck_()` ใน `DEAL_MachineStatus_Daily.gs`:

```js
try { clearApiCache(); notifyOffline(); } catch(e) { Logger.log(e); }
```

---

## แก้ปัญหา

| อาการ | สาเหตุ |
|---|---|
| `ยังไม่ได้ตั้ง secret GAS_URL` | ใส่ secret แล้วลืม deploy ใหม่ |
| `unauthorized` | `GAS_TOKEN` ≠ `API_TOKEN` ใน `.gs` |
| `ไม่พบตาราง สถานะตู้ MM-YYYY` | เดือนนี้ยังไม่มีตารางใน Lark — รัน `runCheck2200()` หนึ่งครั้ง |
| 502 `ต่อ Apps Script ไม่ได้` | URL ผิด หรือ Web App ตั้ง Access ไม่ใช่ Anyone |
| หน้าเว็บโชว์ข้อมูลตัวอย่าง | เปิดจาก `file://` หรือ `/api` ตอบ error — เปิด Console (F12) ดู |
| แก้ `.gs` แล้วเว็บเหมือนเดิม | Apps Script ต้อง **Manage deployments > แก้ > Version: New version** ทุกครั้ง |
| ข้อมูลไม่อัปเดตหลัง 22:00 | ตัวเช็คคือ Apps Script — ดู Triggers ที่นั่น ไม่ใช่ที่ Cloudflare |
| `/.git/config` โหลดได้ | `assets.directory` ต้องเป็น `./public` |

ดู log สด: `npx wrangler tail` หรือ Dashboard > Workers > incomepeday > Logs

---

## เกณฑ์ที่ปรับได้

`public/index.html` — `RULE` บนสุดของ `<script>`:

```js
DEAD_DAYS: 2,     // ดับกี่วันติด = ขึ้น watchlist
GRACE_DAYS: 1,    // ดับไม่เกินกี่วัน = ถือว่าร้านปิดปกติ ไม่ใช่ความผิดทีม
DROP_PCT: 0.6,    // รายได้ร่วงกี่ % = ผิดสังเกต
```

`DEAL_MachineStatus_API.gs` — `ALERT` = เกณฑ์ยิงแจ้งเตือนตู้ดับเข้ากลุ่ม Lark (`notifyOffline`)
