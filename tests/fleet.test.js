import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeMonth} from '../public/revenue-model.js';
import {fleetCode, fleetMapping} from '../src/fleet.js';
test('fleet identifiers are stable, provider-scoped and retain only verified LO matches',async()=>{
 const a=await fleetCode('CEM',123),b=await fleetCode('CEM',123);
 assert.equal(a,b);assert.match(a,/^CEM_[A-F0-9]{12}$/);
 assert.notEqual(a,await fleetCode('EQ',123));
 const rows=await fleetMapping('CEM',[{device:123,branch:7,name:'Same name'},{device:456,branch:8,name:'Same name'}],[{code:'LO_0001',device:123,branch:7}]);
 assert.equal(rows[0].code,'LO_0001');assert.match(rows[1].code,/^CEM_/);assert.equal(rows[1].append,true);
});
test('full fleet inserts missing metadata rows once and preserves confirmed registry identities',()=>{
 const data={slots:['02/09 00:00'],rows:[{code:'LO_0001',name:'Registry',cells:[]}]};
 const source={dates:['2026-09-01'],totals:[{LO_0001:100,CEM_ABCDEF123456:250}],status:{},today:'2026-09-02',current:false,
  machines:[{code:'LO_0001',name:'Provider',append:true},{code:'CEM_ABCDEF123456',name:'New machine',append:true}]};
 const config={mapping:source.machines};
 const first=mergeMonth(data,source,config,'cem'),second=mergeMonth(first,source,config,'cem');
 assert.equal(first.rows.length,2);assert.equal(second.rows.length,2);assert.equal(first.rows[0].name,'Registry');
 assert.equal(first.rows[1].daily['01/09'].d,2.5);assert.equal(data.rows.length,1);
});
test('unsupported money stays unavailable, clears stale baht and retains current status',()=>{
 const source={dates:['2026-09-01'],totals:[{LO_0001:null}],status:{LO_0001:'ONLINE'},today:'2026-09-01',current:true,
 machines:[{code:'LO_0001',append:true,currency:'USD',unavailable:'สกุลเงิน USD'}]};
 const data={slots:['01/09 00:00'],rows:[{code:'LO_0001',cells:[{s:'OFFLINE',d:100,m:100}]}]};
 const row=mergeMonth(data,source,{mapping:source.machines},'cem').rows[0];
 assert.equal(row.daily['01/09'].d,null);assert.equal(row.daily['01/09'].m,null);
 assert.equal(row.currentStatus,'ONLINE');assert.equal(row.revenueUnavailable,'สกุลเงิน USD');assert.equal(row.cells[0].d,null);
});

test('complete CEM inventory over 100 branches uses a single bounded snapshot and refuses truncation',async()=>{
 const {cemInventory}=await import('../src/fleet.js');let lists=0;
 const call=async path=>{
  if(path.includes('branch_by_customer')){lists++;assert.ok(path.includes('limit=500'));return {page:1,total_page:1,total_record:126,details:Array.from({length:126},(_,i)=>({id:i+1,name:'Branch'}))};}
  const id=Number(new URL('https://example.org'+path).searchParams.get('id'));
  return {id,currency_type:'THB',is_time_close:false,qr_box_machine:[{id:id+1000,currency_type:'THB',is_time_to_close:false}]};
 };
 const result=await cemInventory(call);assert.equal(result.machines.length,126);assert.equal(lists,1);
 await assert.rejects(cemInventory(async()=>({page:1,total_page:2,total_record:126,details:[]})),/Incomplete/);
});
test('large mapping chunks fit Worker secrets and round-trip Unicode names without truncation',async()=>{
 const {readMapping,mappingSecrets}=await import('../src/fleet.js');
 const mapping=Array.from({length:184},(_,i)=>({code:'CEM_'+i,name:'ร้านตู้ชกมวย '.repeat(8)}));
 const env=mappingSecrets('CEM_MAPPING',mapping);
 assert.ok(Object.keys(env).length>1);for(const value of Object.values(env))assert.ok(Buffer.byteLength(value)<=4000);
 assert.deepEqual(readMapping(env,'CEM_MAPPING'),mapping);
 delete env.CEM_MAPPING_2;assert.throws(()=>readMapping(env,'CEM_MAPPING'),/Missing/);
});
