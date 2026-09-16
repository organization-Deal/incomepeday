import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const original = execFileSync('git', ['show', 'a074f18:public/index.html'], { encoding: 'utf8' });
const months = ['09-2026', '08-2026', '07-2026'];
const data = month => ({ month, updated: '2026-09-16T00:00:00Z', ownerField: 'โซน',
  slots: ['01/09 22:00', '02/09 00:00', '02/09 22:00', '03/09 00:00'],
  rows: [1, 2].map(n => ({ code: 'LO_000' + n, name: month + ' ร้าน ' + n, owner: 'โซนกลาง',
    cells: [1, 2, 3, 4].map(x => ({ s: 'ONLINE', d: x * 100, m: x * 200 })) })) });
async function setup(page, { baseline = false, onApi, expectedRows=2, reducedMotion='reduce' } = {}) {
  await page.clock.install({ time: new Date('2026-09-16T12:00:00Z') });
  await page.emulateMedia({ reducedMotion });
  const dailyNotes=[];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'dashboard.test') return route.abort();
    if (['/api','/api/perfume','/api/cem','/api/daily-notes','/api/online-time'].includes(url.pathname)) {
      if (onApi && await onApi(route, url)) return;
      if(url.pathname==='/api/online-time')return route.fulfill({json:{ok:true,data:{onlineMs:0,offlineMs:0,unknownMs:0,elapsedMs:0,observations:0,collectorEnabled:false}}});
      if(url.pathname==='/api/daily-notes'){
        if(route.request().method()==='POST'){const note=route.request().postDataJSON();if(!dailyNotes.some(n=>n.id===note.id))dailyNotes.unshift({...note,at:'2026-09-16T12:00:00Z'});return route.fulfill({json:{ok:true,data:{saved:true,storage:'shared'}}});}
        return route.fulfill({json:{ok:true,data:{notes:dailyNotes.filter(n=>n.code===url.searchParams.get('code')&&n.date===url.searchParams.get('date')),storage:'shared'}}});
      }
      const action = url.searchParams.get('action');
      let value;
      if (route.request().method() === 'POST') value = {};
      else if (action === 'months') value = { months };
      else if (action === 'month') value = data(url.searchParams.get('month'));
      else if (action === 'notes') value = { notes: [{ note: url.searchParams.get('code'), by: 'test', at: '2026-09-16T12:00:00Z' }], statuses: ['รับเรื่องแล้ว'] };
      else value = { history: [] };
      return route.fulfill({ json: { ok: true, data: value } });
    }
    if(['/workspace.js','/workspace.css','/online-time.js'].includes(url.pathname))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync('public'+url.pathname,'utf8')});
    if(url.pathname==='/revenue-groups.js')return route.fulfill({contentType:'text/javascript',body:readFileSync('public/revenue-groups.js','utf8')});
    if (url.pathname === '/api-client.js') return route.fulfill({ contentType: 'text/javascript', body: readFileSync('public/api-client.js', 'utf8') });
    if (url.pathname === '/revenue-model.js') return route.fulfill({ contentType:'text/javascript',body:readFileSync('public/revenue-model.js','utf8') });
    return route.fulfill({ contentType: 'text/html', body: baseline ? original : readFileSync('public/index.html', 'utf8') });
  });
  await page.goto('https://dashboard.test/');
  await expect(page.locator('#rows .row')).toHaveCount(expectedRows);
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

const cemCodes=Array.from({length:6},(_,i)=>'LO_'+String(i+1).padStart(4,'0'));
function cemPart(batch){
  const codes=cemCodes.slice(batch*5,(batch+1)*5);
  return {batch,version:'test-version',codes,dates:['2026-09-01','2026-09-02'],today:'2026-09-02',current:true,
    status:Object.fromEntries(codes.map(code=>[code,'ONLINE'])),
    totals:[10000,2000].map(amount=>Object.fromEntries(codes.map(code=>[code,amount])))};
}
test('CEM batches merge atomically into existing rows and fresh propagates to every batch',async({page})=>{
  const requests=[];
  await setup(page,{onApi:async(route,url)=>{
    if(url.searchParams.get('action')==='month'){
      const d=data('09-2026');d.cem={batches:2,version:'test-version',codes:cemCodes};
      await route.fulfill({json:{ok:true,data:d}});return true;
    }
    if(url.pathname==='/api/cem'){
      requests.push(url.searchParams.get('fresh'));
      const batch=Number(url.searchParams.get('batch'));if(batch===1)await delay(100);
      await route.fulfill({json:{ok:true,data:cemPart(batch)}});return true;
    }return false;
  }});
  const state=await page.evaluate(()=>({rows:DATA.rows.length,month:M.LO_0001.month,source:DATA.rows[0].revenueSource}));
  expect(state).toEqual({rows:2,month:120,source:'cem'});
  await page.click('#reload');await expect(page.locator('#rows .row')).toHaveCount(2);
  expect(requests).toEqual([null,null,'1','1']);
  await page.evaluate(()=>setMode('round'));
  await expect(page.locator('#k-mon')).toHaveText('240บาท สะสมเดือนนี้');
});
test('failed CEM batch cannot publish partial totals or overwrite the displayed data model',async({page})=>{
  let enabled=false;
  await setup(page,{onApi:async(route,url)=>{
    if(!enabled)return false;
    if(url.searchParams.get('action')==='month'){
      const d=data('09-2026');d.cem={batches:2,version:'test-version',codes:cemCodes};
      await route.fulfill({json:{ok:true,data:d}});return true;
    }
    if(url.pathname==='/api/cem'){
      if(url.searchParams.get('batch')==='1')await route.fulfill({status:502,json:{ok:false,error:'CEM session expired'}});
      else await route.fulfill({json:{ok:true,data:cemPart(0)}});
      return true;
    }return false;
  }});
  enabled=true;await page.click('#reload');
  await expect(page.locator('#rows')).toContainText('CEM session expired');
  expect(await page.evaluate(()=>DATA.rows[0].revenueSource)).toBeUndefined();
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

for(const width of [1440,390])test('redesigned workspace and popup render at width '+width,async({browser},testInfo)=>{
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();await setup(page);
 await expect(page.locator('.workspace-links')).toContainText('บันทึกงานรายวัน');
 for(const theme of ['light','dark']){
  await page.evaluate(t=>setTheme(t),theme);await page.clock.runFor(1000);
  await page.screenshot({path:testInfo.outputPath('workspace-'+theme+'.png'),animations:'disabled'});
 }
 await page.click('#workspace-notes');await expect(page.locator('#fleet-popup')).toBeVisible();
 await page.locator('.fp-machine').first().click();await expect(page.locator('#fp-form')).toBeVisible();
 expect(await page.locator('#fleet-popup').evaluate(el=>el.getBoundingClientRect().right<=innerWidth&&el.getBoundingClientRect().left>=0)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('popup.png'),animations:'disabled'});
 await page.keyboard.press('Escape');await expect(page.locator('#fleet-popup')).not.toBeVisible();await context.close();
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
  expect(metrics.m.dayRev).toBe(0); // Today is a real zero, not the previous closed day.
  expect(metrics.m.last.s).toBe('ONLINE');
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

test('full fleet displays 186 machines across 26 CEM batches and unavailable revenue is not zero',async({page})=>{
 const codes=Array.from({length:126},(_,i)=>'CEM_'+i.toString(16).toUpperCase().padStart(12,'0'));
 await setup(page,{expectedRows:186,onApi:async(route,url)=>{
  if(url.searchParams.get('action')==='month'){
   const d={month:'09-2026',slots:['02/09 00:00'],rows:Array.from({length:60},(_,i)=>({code:'EQ_'+i.toString(16).toUpperCase().padStart(12,'0'),name:'EQ '+i,cells:[]})),cem:{batches:26,version:'fleet',codes}};
   await route.fulfill({json:{ok:true,data:d}});return true;
  }
  if(url.pathname==='/api/cem'){
   const batch=Number(url.searchParams.get('batch')),partCodes=codes.slice(batch*5,(batch+1)*5);
   const part={batch,version:'fleet',codes:partCodes,dates:['2026-09-01'],today:'2026-09-16',current:true,
    status:Object.fromEntries(partCodes.map(c=>[c,'ONLINE'])),totals:[Object.fromEntries(partCodes.map(c=>[c,c===codes[0]?null:10000]))],
    machines:partCodes.map(c=>({code:c,name:'CEM test',append:true,currency:c===codes[0]?'USD':'THB',unavailable:c===codes[0]?'สกุลเงิน USD':''}))};
   await route.fulfill({json:{ok:true,data:part}});return true;
  }return false;
 }});
 await expect(page.locator('#count')).toHaveText('186 / 186 ตู้');
 const foreign=page.locator('[data-code="'+codes[0]+'"].row');await expect(foreign).toContainText('USD');
 expect(await foreign.locator('.num').allTextContents()).toEqual(['–','–','–']);
 await expect(page.locator('#k-mon small')).toContainText('ไม่รวม 1 ตู้');
 expect(await page.evaluate(code=>M[code].month,codes[1])).toBe(100);
 await foreign.click();await expect(page.locator('#dbody')).toContainText('CEM test');
});

test('provider dashboard distinguishes absent history, current offline state and today revenue',async({page})=>{
 await setup(page,{onApi:async(route,url)=>{
  if(url.searchParams.get('action')!=='month')return false;
  const d=data('09-2026');d.slots=['15/09 22:00','16/09 00:00','16/09 22:00','17/09 00:00'];d.dailyLabels=['15/09','16/09'];
  d.rows=d.rows.map(r=>({...r,revenueSource:'cem',currentStatus:'OFFLINE',cells:d.slots.map(()=>null),daily:{
   '15/09':{s:'UNKNOWN',d:100,m:100,closed:true},'16/09':{s:'UNKNOWN',d:20,m:120,closed:false}}}));
  await route.fulfill({json:{ok:true,data:d}});return true;
 }});
 await expect(page.locator('#headline')).not.toContainText('ปกติดี');
 await expect(page.locator('#headline')).toContainText('ออฟไลน์');
 await expect(page.locator('#k-up')).toContainText('–');
 await expect(page.locator('#on-d1')).toHaveText('เมื่อวาน —');
 const state=await page.evaluate(()=>({labels:DAY.labels,last:M.LO_0001.dayRev,series:fleetSeries(),spark:SERIES}));
 expect(state.labels).toEqual(['15/09','16/09']);expect(state.last).toBe(20);
 expect(state.series.every(d=>d.onPct===null&&d.offPct===null)).toBe(true);
 expect(state.spark).toEqual([200,40]);
 await expect(page.locator('#k-delta')).not.toContainText('-80%');
 await expect(page.locator('#k-delta')).toContainText('ยังไม่ปิด');
 await expect(page.locator('#k-mon')).toContainText('240');
});

test('status comparisons do not compare different known-status coverage',async({page})=>{
 await setup(page,{onApi:async(route,url)=>{
  if(url.searchParams.get('action')!=='month')return false;
  const d=data('09-2026');d.dailyLabels=['01/09','02/09'];
  d.rows[1].cells=d.rows[1].cells.map(c=>({...c,s:'UNKNOWN'}));
  await route.fulfill({json:{ok:true,data:d}});return true;
 }});
 await expect(page.locator('#on-d1')).toHaveText('เมื่อวาน —');
 await expect(page.locator('#on-dm')).toHaveText('เดือน —');
});

test('unavailable KPI cancels an older numeric animation',async({page})=>{
 await setup(page,{reducedMotion:'no-preference'});
 await page.evaluate(()=>setNum('#k-up',100));await page.clock.runFor(100);
 await page.evaluate(()=>setNum('#k-up',null));await page.clock.runFor(1500);
 await expect(page.locator('#k-up')).toContainText('–');
});

test('revenue groups partition machines and filter the original table on desktop and mobile',async({page})=>{
 await setup(page,{expectedRows:5,onApi:async(route,url)=>{
  if(url.searchParams.get('action')!=='month')return false;
  const d=data('09-2026');d.updated='2026-09-16T09:00:00Z';d.dailyLabels=['13/09','14/09','15/09'];d.slots=[];
  d.rows=['OFFLINE','OFFLINE','ONLINE','ONLINE','ONLINE'].map((status,i)=>({code:'LO_000'+(i+1),name:'Group '+i,cells:[],revenueSource:'cem',currentStatus:status,
   daily:Object.fromEntries(d.dailyLabels.map(day=>[day,{s:'UNKNOWN',d:i===4?null:(i===1||i===3?10:0),m:0,closed:true}]))}));
  await route.fulfill({json:{ok:true,data:d}});return true;
 }});
 for(const key of ['offline-zero','offline-money','online-zero','online-money','unknown']){
  await expect(page.locator('[data-group-count="'+key+'"]')).toHaveText('1');
  await page.locator('[data-revenue-group="'+key+'"]').click();await expect(page.locator('.fp-machine')).toHaveCount(1);await page.click('#fp-table');await expect(page.locator('#rows .row')).toHaveCount(1);
  expect(await page.evaluate(()=>GROUPS[LIST[0].code])).toBe(key);
 }
 await page.locator('[data-revenue-group=""]').click();await page.click('#fp-table');await expect(page.locator('#rows .row')).toHaveCount(5);
 await page.locator('[data-revenue-group="offline-zero"]').click();await page.click('#fp-table');
 await page.evaluate(()=>setFilter('ONLINE'));await expect(page.locator('#rows .row')).toHaveCount(3);
 await page.setViewportSize({width:390,height:844});await page.locator('#revenue-groups').scrollIntoViewIfNeeded();
 expect(await page.locator('#revenue-groups').evaluate(el=>Array.from(el.querySelectorAll('*')).every(n=>n.getBoundingClientRect().right<=innerWidth+1&&n.getBoundingClientRect().left>=0))).toBe(true);
 await page.locator('[data-revenue-group="online-money"]').click();await page.click('#fp-table');await expect(page.locator('#rows .row')).toHaveCount(1);
 await page.locator('#rows .row').click();await expect(page.locator('#dname')).toContainText('Group 3');
});

test('daily-note popup searches locations, preserves drafts and saves by machine and date',async({page})=>{
 await setup(page);await page.click('#workspace-notes');
 await page.fill('#fp-search','ร้าน 1');await expect(page.locator('.fp-machine')).toHaveCount(1);
 await page.locator('.fp-machine').first().click();await page.fill('#fp-author','Test team');await page.fill('#fp-text','Draft for first machine');
 await page.fill('#fp-search','');await page.locator('[data-machine="LO_0002"]').click();await expect(page.locator('#fp-text')).toHaveValue('');
 await page.locator('[data-machine="LO_0001"]').click();await expect(page.locator('#fp-text')).toHaveValue('Draft for first machine');
 await page.fill('#fp-date','2026-09-15');await expect(page.locator('#fp-text')).toHaveValue('');
 await page.fill('#fp-author','Test team');await page.fill('#fp-text','Checked yesterday');await page.click('#fp-save');
 await expect(page.locator('#fp-history')).toContainText('Checked yesterday');await expect(page.locator('#fp-text')).toHaveValue('');
 await page.fill('#fp-date','2026-09-16');await expect(page.locator('#fp-text')).toHaveValue('Draft for first machine');
 await expect(page.locator('#fp-history')).not.toContainText('Checked yesterday');
 await page.click('#fp-close');await page.click('#workspace-notes');await page.locator('[data-machine="LO_0001"]').click();
 await expect(page.locator('#fp-text')).toHaveValue('Draft for first machine');
 await page.fill('#fp-date','2026-09-15');await expect(page.locator('#fp-history')).toContainText('Checked yesterday');
});

test('closing a pending note save cannot resurrect the saved text as a new draft',async({page})=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 await setup(page,{onApi:async(route,url)=>{
  if(url.pathname==='/api/daily-notes'&&route.request().method()==='POST'){
   await gate;await route.fulfill({json:{ok:true,data:{saved:true,storage:'shared'}}});return true;
  }return false;
 }});
 await page.click('#workspace-notes');await page.locator('.fp-machine').first().click();
 await page.fill('#fp-author','Team');await page.fill('#fp-text','Saved while closed');await page.click('#fp-save');
 await page.click('#fp-close');release();await expect(page.locator('#fp-text')).toHaveValue('');
 await page.click('#workspace-notes');await page.locator('.fp-machine').first().click();await expect(page.locator('#fp-text')).toHaveValue('');
});


test('daily online hours show Bangkok date, unknown gaps and ignore late date responses',async({page})=>{
 await setup(page,{onApi:async(route,url)=>{
  if(url.pathname!=='/api/online-time')return false;
  const old=url.searchParams.get('date')==='2026-09-15';if(old)await delay(250);
  await route.fulfill({json:{ok:true,data:{onlineMs:old?3600000:7200000,offlineMs:3600000,unknownMs:600000,elapsedMs:11400000,observations:5,closed:true,collectorEnabled:true}}});return true;
 }});
 await page.evaluate(()=>Workspace.openMachine('LO_0001'));
 const target=page.locator('#fp-online-time');await expect(target).toContainText('2 ชม. 0 นาที');
 await expect(target).toContainText('ข้อมูลขาดหาย');await expect(target).toContainText('00:00–23:59');
 await target.locator('input').fill('2026-09-15');await target.locator('input').fill('2026-09-16');
 await page.waitForTimeout(350);await expect(target.locator('.ot-values>div').first()).toContainText('2 ชม. 0 นาที');
});
