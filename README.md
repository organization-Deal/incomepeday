# DEAL! — สถานะตู้รายวัน

หน้าเว็บดูสถานะ + รายได้ตู้ อ่านข้อมูลจาก **Lark Bitable** (ตาราง `สถานะตู้ MM-YYYY` ที่ `DEAL_MachineStatus_Daily.gs` เขียนไว้วันละ 2 รอบ)

```
Lark Bitable  →  Apps Script (API + cache)  →  Cloudflare Pages Function (/api)  →  index.html
   ฐานข้อมูล            ตัวอ่าน/แปลงข้อมูล            ตัวกลาง ซ่อน URL + แคชขอบ           หน้าจอ
```

ไม่มีข้อมูลถูกก๊อปไปเก็บที่ไหนเพิ่ม — Lark ยังเป็นแหล่งความจริงเดียว

---

## โครงไฟล์

```
.
├── index.html          หน้าเว็บทั้งหมด (ไฟล์เดียวจบ ไม่มี build step)
├── functions/
│   └── api.js          Cloudflare Pages Function — proxy ไป Apps Script
└── README.md
```

---

## Deploy ครั้งแรก

### 1. เอาโค้ดขึ้น GitHub

```bash
git init
git add .
git commit -m "DEAL machine status dashboard"
git branch -M main
git remote add origin https://github.com/<org>/<repo>.git
git push -u origin main
```

> repo ตั้งเป็น **Private** ได้ ไม่กระทบ Cloudflare Pages

### 2. Apps Script — เอา URL มา

1. เปิดโปรเจกต์ที่มี `DEAL_MachineStatus_Daily.gs` + `DEAL_MachineStatus_API.gs`
2. ตั้ง token ในไฟล์ `.gs` (แนะนำ) — บรรทัดบนสุด:
   ```js
   const API_TOKEN = 'สุ่มอะไรก็ได้ยาว ๆ';
   ```
3. **Deploy > New deployment > Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - ก๊อป URL ที่ลงท้าย `/exec`

> ที่ต้องตั้ง Anyone เพราะ Cloudflare เรียกเข้ามาแบบไม่มีบัญชี Google
> ความปลอดภัยมาจาก `API_TOKEN` (URL อย่างเดียวเปิดไม่ได้) + Cloudflare Access ในข้อ 4

### 3. Cloudflare Pages

1. Cloudflare Dashboard > **Workers & Pages > Create > Pages > Connect to Git**
2. เลือก repo นี้
3. Build settings — **ปล่อยว่างทั้งหมด**:
   - Framework preset: `None`
   - Build command: *(ว่าง)*
   - Build output directory: `/`
4. **Settings > Variables and Secrets** — เพิ่ม 2 ตัว (ทั้ง Production และ Preview):

   | ชื่อ | ค่า | ประเภท |
   |---|---|---|
   | `GAS_URL` | `https://script.google.com/macros/s/xxxx/exec` | Secret |
   | `GAS_TOKEN` | ค่าเดียวกับ `API_TOKEN` ใน `.gs` | Secret |

5. **Retry deployment** หลังใส่ตัวแปร (ตัวแปรใหม่มีผลกับ deploy รอบถัดไปเท่านั้น)

ได้ URL: `https://<project>.pages.dev`

### 4. ล็อกไม่ให้คนนอกเข้า (สำคัญ — ทำก่อนแจกลิงก์)

`.pages.dev` เปิดสาธารณะโดยดีฟอลต์ ใครเดา URL เจอก็เห็นรายได้ทั้งกอง

**Cloudflare Access** (Zero Trust) — ฟรีถึง 50 คน:

1. Zero Trust > **Access > Applications > Add an application > Self-hosted**
2. Application domain: โดเมนของ Pages
3. Policy: `Action = Allow` → `Include > Emails ending in` → `@dealinvest.co.th` (โดเมนบริษัท)
4. Save

จากนี้เปิดเว็บต้องยืนยันอีเมลบริษัทก่อน — ไม่ต้องทำรหัสผ่านเอง ไม่ต้องแก้โค้ด

### 5. โดเมนตัวเอง (ถ้าอยากได้)

Pages > **Custom domains > Set up a domain** → เช่น `status.dealinvest.co.th`

---

## อัปเดตหลังจากนี้

```bash
git add . && git commit -m "..." && git push
```

Cloudflare build ใหม่อัตโนมัติภายใน ~30 วิ ทุก push ที่เข้า `main`
push ไป branch อื่น = ได้ Preview URL แยก ไม่กระทบตัวจริง

---

## เรื่องแคช

| ชั้น | อายุ | ล้างยังไง |
|---|---|---|
| Apps Script (`CacheService`) | 30 นาที (เดือนปัจจุบัน) / 6 ชม. (เดือนเก่า) | `clearApiCache()` |
| Cloudflare edge | 10 นาที (เดือนปัจจุบัน) / 6 ชม. (เดือนเก่า) | ปุ่ม ↻ ในเว็บ (ส่ง `?fresh=1` ทะลุทุกชั้น) |

ให้เว็บเห็นข้อมูลใหม่ทันทีหลังรอบเช็ค — เติมท้าย `runCheck_()` ใน `DEAL_MachineStatus_Daily.gs`:

```js
try { clearApiCache(); notifyOffline(); } catch(e) { Logger.log(e); }
```

---

## แก้ปัญหา

| อาการ | สาเหตุที่เจอบ่อย |
|---|---|
| `ยังไม่ได้ตั้ง environment variable GAS_URL` | ลืมใส่ตัวแปร หรือใส่แล้วไม่ได้ retry deployment |
| `unauthorized` | `GAS_TOKEN` ใน Cloudflare ไม่ตรงกับ `API_TOKEN` ใน `.gs` |
| `ไม่พบตาราง สถานะตู้ MM-YYYY` | เดือนนั้นยังไม่มีตารางใน Lark (รัน `runCheck2200()` หนึ่งครั้ง) |
| หน้าเว็บขึ้นข้อมูลตัวอย่าง | เปิดไฟล์จากเครื่อง (`file://`) — ต้องเปิดผ่าน URL ของ Pages |
| แก้ `.gs` แล้วเว็บยังเหมือนเดิม | ต้อง **Deploy > Manage deployments > แก้ไข > Version: New version** ทุกครั้ง |

---

## เกณฑ์ที่ปรับได้

ใน `index.html` ตัวแปร `RULE` บนสุดของ `<script>`:

```js
DEAD_DAYS: 2,     // ดับกี่วันติด = ขึ้น watchlist
GRACE_DAYS: 1,    // ดับไม่เกินกี่วัน = ถือว่าร้านปิดปกติ ไม่ใช่ความผิดทีม
DROP_PCT: 0.6,    // รายได้ร่วงกี่ % = ผิดสังเกต
```

ใน `.gs` ตัวแปร `ALERT` = เกณฑ์ยิงแจ้งเตือนเข้ากลุ่ม Lark
