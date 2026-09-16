import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cemConfig, readCemBatch, cemHistory, validateProviders } from '../src/cem.js';
const original=globalThis.fetch;
afterEach(()=>{globalThis.fetch=original;});
const env={CEM_REFRESH_TOKEN:'private-refresh',CEM_MAPPING:'[{"code":"LO_0001","branch":10,"device":100}]'};
const now=new Date('2026-09-03T03:00:00Z');
function mock(change=()=>{}){
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    const u=new URL(url);calls.push(u);
    assert.equal(u.origin,'https://cem.t-dev.app');assert.equal(init.redirect,'manual');
    let data;
    if(u.pathname.endsWith('/refresh_token'))data={bearer:'private-bearer',refresh_token:'do-not-publish'};
    else if(u.pathname.endsWith('/branch_info'))data={id:Number(u.searchParams.get('id')),currency_type:'THB',is_time_close:false,
      qr_box_machine:[{id:Number(u.searchParams.get('id'))*10,currency_type:'THB',status:'ONLINE',is_time_to_close:false}]};
    else if(u.pathname.includes('/daily_summary/'))data={details:[1,2].map(day=>({day,total_summary:day*100}))};
    else if(u.pathname.includes('/monthly_summary/'))data={details:[{year_num:2026,month_num:8,total_summary:300}]};
    else data={title:u.searchParams.get('date_type')==='month'?'September 2026':'3rd September 2026',total:20,is_time_to_close:false};
    change(data,u);return new Response(JSON.stringify(data));
  };return calls;
}
test('CEM mapping validates identities and refuses duplicate/provider-overlap codes',()=>{
  assert.equal(cemConfig({}),null);
  for(const m of ['[]','{}','[{"code":"LO_0001","branch":10,"device":100},{"code":"LO_0001","branch":11,"device":110}]',
    '[{"code":"LO_0001","branch":10,"device":100},{"code":"LO_0002","branch":10,"device":100}]']){
    assert.throws(()=>cemConfig({...env,CEM_MAPPING:m}),/CEM/);
  }
  assert.throws(()=>validateProviders({mapping:[{code:'LO_0001'}]},cemConfig(env)),/ซ้ำ/);
});
test('CEM combines closed daily report with today without leaking credentials or identities',async()=>{
  const calls=mock();const source=await readCemBatch(cemConfig(env),'09-2026',0,now);
  assert.deepEqual(source.totals.map(x=>x.LO_0001),[10000,20000,2000]);
  assert.equal(source.status.LO_0001,'ONLINE');assert.deepEqual(source.codes,['LO_0001']);
  assert.equal(calls.length,4);
  assert.doesNotMatch(JSON.stringify(source),/private-|do-not-publish|"branch"|"device"/);
});
test('CEM refuses wrong currency, closing, identity, incomplete dates, duplicate dates or old today summary',async()=>{
  for(const change of [
    (d,u)=>{if(d.qr_box_machine)d.currency_type='USD';},
    (d,u)=>{if(d.qr_box_machine)d.qr_box_machine[0].id=999;},
    (d,u)=>{if(d.qr_box_machine)d.qr_box_machine.push(d.qr_box_machine[0]);},
    (d,u)=>{if(d.qr_box_machine)d.is_time_close=true;},
    (d,u)=>{if(u.pathname.includes('/daily_summary/'))d.details.pop();},
    (d,u)=>{if(u.pathname.includes('/daily_summary/'))d.details[1].day=1;},
    (d,u)=>{if(u.pathname.includes('/daily_summary/'))d.details[0].total_summary=null;},
    (d,u)=>{if(d.title)d.title='2nd September 2026';},
    (d,u)=>{if(d.title)d.total=null;},
    (d,u)=>{if(d.bearer){delete d.bearer;d.error='private-refresh';}},
  ]){mock(change);await assert.rejects(readCemBatch(cemConfig(env),'09-2026',0,now),e=>/CEM/.test(e.message)&&!e.message.includes('private-refresh'));}
});
test('five machines per batch caps outbound reads at sixteen; invalid batches never fetch',async()=>{
  const mapping=Array.from({length:6},(_,i)=>({code:'LO_'+String(i+1).padStart(4,'0'),branch:10+i,device:(10+i)*10}));
  const c=cemConfig({...env,CEM_MAPPING:JSON.stringify(mapping)});const calls=mock();
  const source=await readCemBatch(c,'09-2026',0,now);assert.equal(source.codes.length,5);assert.equal(calls.length,16);
  await assert.rejects(readCemBatch(c,'09-2026',2,now),/CEM/);assert.equal(calls.length,16);
});
test('historical CEM report keeps GAS uptime and uses one report per year',async()=>{
  const calls=mock();const result=await cemHistory({history:[{month:'08-2026',total:999,uptime:80}]},'LO_0001',cemConfig(env),now);
  assert.deepEqual(result.history,[{month:'08-2026',total:300,uptime:80}]);assert.equal(calls.length,3);
});
test('current history rejects a summary from another month',async()=>{
  mock((d,u)=>{if(u.searchParams.get('date_type')==='month')d.title='August 2026';});
  await assert.rejects(cemHistory({history:[{month:'09-2026',total:0}]},'LO_0001',cemConfig(env),now),/CEM/);
});
