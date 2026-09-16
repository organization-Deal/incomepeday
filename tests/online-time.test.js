import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OnlineTimeCore,dayBounds} from '../src/online-time.js';
const time=s=>Date.parse(s+'+07:00');
function store(){const m=new Map();let tail=Promise.resolve();const s={get:async k=>structuredClone(m.get(k)),put:async(k,v)=>m.set(k,structuredClone(v)),transaction:fn=>{const p=tail.then(()=>fn(s));tail=p.catch(()=>{});return p;}};return s;}
const sample=(at,status='ONLINE',code='LO_0001')=>({code,at:time(at),status});
test('Bangkok day includes entire 23:59 minute and excludes following midnight',()=>{
 const [start,end]=dayBounds('2026-09-16');assert.equal(start,time('2026-09-16T00:00:00'));assert.equal(end-start,86400000);
 assert.throws(()=>dayBounds('2026-02-30'));
});
test('online intervals split at midnight, duplicate and stale observations do not add hours',async()=>{
 const core=new OnlineTimeCore(store());const a=sample('2026-09-16T23:55:00'),b=sample('2026-09-17T00:05:00');
 await core.record([a],time("2026-09-18T00:00:00"));await core.record([b],time("2026-09-18T00:00:00"));await core.record([b,a],time("2026-09-18T00:00:00"));
 for(const date of ['2026-09-16','2026-09-17']){const d=await core.day('LO_0001',date,time('2026-09-18T00:00:00'));assert.equal(d.onlineMs,300000);assert.equal(d.offlineMs,0);assert.equal(d.unknownMs,86100000);}
});
test('flapping accumulates previous observed state, never a full day from one online check',async()=>{
 const core=new OnlineTimeCore(store());
 for(const [t,s] of [['12:00','ONLINE'],['12:05','OFFLINE'],['12:10','ONLINE'],['12:15','OFFLINE']])await core.record([sample('2026-09-16T'+t+':00',s)]);
 const d=await core.day('LO_0001','2026-09-16',time('2026-09-17T00:00:00'));
 assert.equal(d.onlineMs,600000);assert.equal(d.offlineMs,300000);assert.equal(d.unknownMs,85500000);
});
test('long gaps, read errors, and missing history stay unknown; future time is excluded',async()=>{
 const core=new OnlineTimeCore(store());
 for(const [t,s] of [['12:00','ONLINE'],['12:30','ONLINE'],['12:35','UNKNOWN'],['12:40','OFFLINE']])await core.record([sample('2026-09-16T'+t+':00',s)]);
 const d=await core.day('LO_0001','2026-09-16',time('2026-09-16T13:00:00'));
 assert.equal(d.onlineMs,0);assert.equal(d.offlineMs,0);assert.equal(d.unknownMs,13*3600000);assert.equal(d.closed,false);
 const other=await core.day('LO_0002','2026-09-16',time('2026-09-16T13:00:00'));assert.equal(other.observations,0);assert.equal(other.onlineMs,0);
});
test('invalid and future observations are rejected before storage',async()=>{
 const core=new OnlineTimeCore(store());await assert.rejects(core.record([{code:'../bad',at:Date.now(),status:'ONLINE'}]));
 await assert.rejects(core.record([{code:'LO_0001',at:Date.now()+600000,status:'ONLINE'}]));
});

test('concurrent retries do not double count and independent machines remain isolated',async()=>{
 const core=new OnlineTimeCore(store()),a=sample('2026-09-16T12:00:00'),b=sample('2026-09-16T12:05:00');
 await core.record([a]);await Promise.all([core.record([b]),core.record([b])]);
 assert.equal((await core.day(a.code,'2026-09-16')).onlineMs,300000);
 assert.equal((await core.day('LO_0002','2026-09-16')).onlineMs,0);
});

test('one online observation confirms online today without inventing a duration; offline later preserves it',async()=>{
 const core=new OnlineTimeCore(store());await core.record([sample('2026-09-16T12:00:00')]);
 let d=await core.day('LO_0001','2026-09-16');assert.equal(d.seenOnline,true);assert.equal(d.onlineMs,0);
 await core.record([sample('2026-09-16T12:05:00','OFFLINE')]);d=await core.day('LO_0001','2026-09-16');assert.equal(d.seenOnline,true);assert.equal(d.onlineMs,300000);
 assert.equal((await core.day('LO_0002','2026-09-16')).seenOnline,false);
});

test('latest online/offline observations survive unknown reads and day rollover',async()=>{
 const core=new OnlineTimeCore(store()),now=time('2026-09-18T00:00:00');
 const on=sample('2026-09-16T23:55:00'),off=sample('2026-09-17T00:00:00','OFFLINE'),unknown=sample('2026-09-17T00:05:00','UNKNOWN');
 await core.record([on,off,unknown],now);await core.record([on],now);
 const d=await core.day('LO_0001','2026-09-17',now);
 assert.equal(d.latestOnlineAt,on.at);assert.equal(d.latestOfflineAt,off.at);
 const other=await core.day('LO_0002','2026-09-17',now);assert.equal(other.latestOnlineAt,null);assert.equal(other.latestOfflineAt,null);
});
