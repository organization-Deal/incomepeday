import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const original = execFileSync('git', ['show', 'a074f18:public/index.html'], { encoding: 'utf8' });
const months = ['09-2026', '08-2026', '07-2026'];
const data = month => ({ month, updated: '2026-09-16T00:00:00Z', ownerField: 'โซน',
  slots: ['01/09 22:00', '02/09 00:00', '02/09 22:00', '03/09 00:00'],
  rows: [1, 2].map(n => ({ code: 'LO_000' + n, name: month + ' ร้าน ' + n, owner: 'โซนกลาง',
    cells: [1, 2, 3, 4].map(x => ({ s: 'ONLINE', d: x * 100, m: x * 200 })) })) });
async function setup(page, { baseline = false, onApi } = {}) {
  await page.clock.install({ time: new Date('2026-09-16T12:00:00Z') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'dashboard.test') return route.abort();
    if (url.pathname === '/api' || url.pathname === '/api/perfume') {
      if (onApi && await onApi(route, url)) return;
      const action = url.searchParams.get('action');
      let value;
      if (route.request().method() === 'POST') value = {};
      else if (action === 'months') value = { months };
      else if (action === 'month') value = data(url.searchParams.get('month'));
      else if (action === 'notes') value = { notes: [{ note: url.searchParams.get('code'), by: 'test', at: '2026-09-16T12:00:00Z' }], statuses: ['รับเรื่องแล้ว'] };
      else value = { history: [] };
      return route.fulfill({ json: { ok: true, data: value } });
    }
    if (url.pathname === '/api-client.js') return route.fulfill({ contentType: 'text/javascript', body: readFileSync('public/api-client.js', 'utf8') });
    return route.fulfill({ contentType: 'text/html', body: baseline ? original : readFileSync('public/index.html', 'utf8') });
  });
  await page.goto('https://dashboard.test/');
  await expect(page.locator('#rows .row')).toHaveCount(2);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('latest selected month wins when old response arrives late', async ({ page }) => {
  await setup(page, { onApi: async (route, url) => {
    if (url.searchParams.get('action') !== 'month') return false;
    const month = url.searchParams.get('month');
    if (month === '08-2026') await delay(300);
    await route.fulfill({ json: { ok: true, data: data(month) } }); return true;
  } });
  await page.selectOption('#month', '08-2026');
  await page.selectOption('#month', '07-2026');
  await expect(page.locator('#rows')).toContainText('07-2026');
  await delay(500);
  await expect(page.locator('#rows')).toContainText('07-2026');
});

test('notes for previously opened machine cannot overwrite current drawer', async ({ page }) => {
  await setup(page, { onApi: async (route, url) => {
    if (url.searchParams.get('action') !== 'notes') return false;
    const code = url.searchParams.get('code');
    if (code === 'LO_0001') await delay(400);
    await route.fulfill({ json: { ok: true, data: { notes: [{ note: code, by: 'test', at: '2026-09-16T12:00:00Z' }] } } }); return true;
  } });
  await page.evaluate(() => { open('LO_0001'); open('LO_0002'); });
  await expect(page.locator('#tnow')).toContainText('LO_0002');
  await delay(600);
  await expect(page.locator('#tnow')).toContainText('LO_0002');
});

test('saving in an old drawer does not erase the current draft', async ({ page }) => {
  await setup(page, { onApi: async route => {
    if (route.request().method() !== 'POST') return false;
    await delay(400); await route.fulfill({ json: { ok: true, data: {} } }); return true;
  } });
  await page.evaluate(() => open('LO_0001'));
  await expect(page.locator('#tnow')).toContainText('LO_0001');
  await page.fill('#tnote', 'repair A'); await page.fill('#tby', 'tester');
  await page.click('#tsave');
  await page.evaluate(() => open('LO_0002'));
  await page.fill('#tnote', 'draft B');
  await delay(600);
  await expect(page.locator('#tnote')).toHaveValue('draft B');
});

test('refresh refetches history instead of reusing stale memoized history', async ({ page }) => {
  let history = 0;
  await setup(page, { onApi: async (route, url) => {
    if (url.searchParams.get('action') === 'history') history++;
    return false;
  } });
  await page.evaluate(() => open('LO_0001')); await expect(page.locator('#hist')).toContainText('ยังไม่มี');
  await page.evaluate(() => close());
  await page.click('#reload'); await expect(page.locator('#rows .row')).toHaveCount(2);
  await page.evaluate(() => open('LO_0001')); await expect(page.locator('#hist')).toContainText('ยังไม่มี');
  expect(history).toBe(2);
});

for (const width of [1440, 390]) test('unchanged dashboard and drawer appearance at width ' + width, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
  const before = await context.newPage(), after = await context.newPage();
  await setup(before, { baseline: true }); await setup(after);
  for (const theme of ['light', 'dark']) {
    for (const page of [before, after]) {
      await page.evaluate(t => setTheme(t), theme); await page.clock.runFor(2000);
    }
    const actual = await after.screenshot({ animations: 'disabled' });
    const expected = await before.screenshot({ animations: 'disabled' });
    writeFileSync(testInfo.outputPath('after-'+theme+'.png'), actual);
    writeFileSync(testInfo.outputPath('before-'+theme+'.png'), expected);
    expect(actual.equals(expected), 'dashboard pixels match baseline '+theme).toBe(true);
  }
  for (const page of [before, after]) {
    await page.evaluate(() => open('LO_0001'));
    await expect(page.locator('#tnow')).toContainText('LO_0001');
    await page.clock.runFor(2000);
  }
  expect((await after.screenshot({ animations: 'disabled' })).equals(await before.screenshot({ animations: 'disabled' })), 'drawer pixels match baseline').toBe(true);
  await context.close();
});

test('save before initial notes load still resolves history and status buttons', async ({ page }) => {
  let reads = 0;
  await setup(page, { onApi: async (route, url) => {
    if (url.searchParams.get('action') !== 'notes') return false;
    reads++; if (reads === 1) await delay(500);
    await route.fulfill({ json: { ok: true, data: {
      notes: [{ note: 'saved history', by: 'test', at: '2026-09-16T12:00:00Z' }], statuses: ['รับเรื่องแล้ว'],
    } } }); return true;
  } });
  await page.evaluate(() => open('LO_0001'));
  await page.fill('#tnote', 'repair'); await page.fill('#tby', 'test'); await page.click('#tsave');
  await expect(page.locator('#stbtns button')).toHaveCount(1);
  await expect(page.locator('#tlog')).toContainText('saved history');
});

test('rename forces fresh monthly reads across page reload in the same tab', async ({ page }) => {
  const monthly = [];
  await setup(page, { onApi: async (route, url) => {
    if (url.searchParams.get('action') === 'month') monthly.push(url.searchParams.get('fresh'));
    return false;
  } });
  await page.evaluate(() => open('LO_0001'));
  page.once('dialog', dialog => dialog.accept('New name'));
  await page.click('#rename');
  await expect(page.locator('#dname')).toContainText('New name');
  await page.reload(); await expect(page.locator('#rows .row')).toHaveCount(2);
  expect(monthly).toEqual([null, '1']);
});

test('failed early save still lets pending notes finish and retains input', async ({ page }) => {
  await setup(page, { onApi: async (route, url) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 502, json: { ok: false, error: 'Unavailable' } }); return true;
    }
    if (url.searchParams.get('action') === 'notes') await delay(400);
    return false;
  } });
  await page.evaluate(() => open('LO_0001'));
  await page.fill('#tnote', 'keep this'); await page.fill('#tby', 'test'); await page.click('#tsave');
  await expect(page.locator('#stbtns button')).toHaveCount(1);
  await expect(page.locator('#tnow')).toContainText('LO_0001');
  await expect(page.locator('#tnote')).toHaveValue('keep this');
  await expect(page.locator('#tsave')).toBeEnabled();
});

test('EQLink daily totals replace old revenues, preserve rows and use current status without inventing uptime', async ({ page }) => {
  await setup(page, { onApi: async (route, url) => {
    if(url.searchParams.get('action')!=='month') return false;
    const d=data('09-2026');
    d.dailyLabels=['01/09','02/09','03/09'];
    Object.assign(d.rows[0], { revenueSource:'eqlink', currentStatus:'ONLINE',
      daily:{'01/09':{s:'UNKNOWN',d:320,m:320,closed:true},
        '02/09':{s:'OFFLINE',d:20,m:340,closed:true},
        '03/09':{s:'UNKNOWN',d:0,m:340,closed:false}},
      cells:[{s:'UNKNOWN',d:null,m:null},{s:'UNKNOWN',d:320,m:320},
        {s:'OFFLINE',d:null,m:null},{s:'OFFLINE',d:20,m:340}] });
    await route.fulfill({json:{ok:true,data:d}}); return true;
  } });
  const metrics=await page.evaluate(()=>({m:M.LO_0001,days:DAY.labels,rows:DATA.rows.length}));
  expect(metrics.rows).toBe(2); expect(metrics.m.month).toBe(340); expect(metrics.m.week).toBe(340);
  expect(metrics.m.dayRev).toBe(20); expect(metrics.m.last.s).toBe('ONLINE');
  expect(metrics.m.down).toBe(0); expect(metrics.m.uptime).toBe(0); expect(metrics.m.days).toBe(1);
  // A new EQLink day must not erase the other fleet's most recent observed status.
  await page.evaluate(()=>{ DATA.dailyLabels.push('04/09'); build(); });
  await expect(page.locator('#ops-online')).toHaveText('2');
  await page.evaluate(()=>setFilter('ONLINE'));
  await expect(page.locator('#rows .row[data-code="LO_0001"]')).toHaveCount(1);
  await page.evaluate(()=>open('LO_0001'));
  await expect(page.locator('.dtable')).toContainText('320');
  const closed=page.locator('.dtable tbody tr').filter({hasText:'02/09'});
  await expect(closed).not.toContainText('ยังไม่ปิด');
  await page.evaluate(()=>{close();setMode('round');});
  await expect(page.locator('#rows .row[data-code="LO_0001"]')).toContainText('340');
  await expect(page.locator('#k-mon')).toHaveText('1,140บาท สะสมเดือนนี้');
});
