import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readCemStatuses} from '../src/cem.js';
import {collectOnlineTime} from '../src/online-collector.js';
import {handleOnlineTime} from '../src/online-time.js';
const realFetch=globalThis.fetch;afterEach(()=>{globalThis.fetch=realFetch;});
test('CEM status sampling includes foreign currencies and partial failures without revenue requests',async()=>{
 const mapping=[1,2,3].map(n=>({code:'LO_000'+n,branch:n,device:n}));let calls=0;
 globalThis.fetch=async url=>{calls++;assert.ok(url.includes('/branch_info?id='));const id=Number(new URL(url).searchParams.get('id'));if(id===3)throw new Error('offline API');
 return new Response(JSON.stringify({id,currency_type:'USD',qr_box_machine:[{id,status:id===1?'ONLINE':'OFFLINE',currency_type:'THB'}]}));};
 const values=await readCemStatuses({mapping},0,'test-bearer',Date.now()+45000);
 assert.deepEqual(values.map(v=>v.status),['ONLINE','OFFLINE','UNKNOWN']);assert.equal(calls,3);
});
test('collector supports disabling and saves failed status batches as unknown',async()=>{
 assert.deepEqual(await collectOnlineTime({}),{enabled:false});const recorded=[];
 const env={ONLINE_TIME_ENABLED:'true',CEM_REFRESH_TOKEN:'test',CEM_MAPPING:JSON.stringify([{code:'LO_0001',branch:1,device:1}]),
 CEM_SESSION:{getByName:()=>({statusBatch:async()=>{throw new Error('API unavailable');}})},
 ONLINE_TIME:{getByName:()=>({record:async samples=>{recorded.push(...samples);return {accepted:samples.length};}})}};
 const result=await collectOnlineTime(env);assert.equal(result.unknown,1);assert.equal(recorded[0].status,'UNKNOWN');
});
test('online-time API rejects client writes and invalid dates, exposes only calculated day',async()=>{
 const env={ONLINE_TIME_ENABLED:'true',ONLINE_TIME:{getByName:()=>({day:async(code,date)=>({code,date,onlineMs:300000})})}};
 const url='https://dashboard.test/api/online-time?code=LO_0001&date=2026-09-16';
 assert.equal((await handleOnlineTime(new Request(url,{method:'POST'}),env)).status,405);
 await assert.rejects(handleOnlineTime(new Request(url.replace('09-16','02-30')),env));
 const body=await (await handleOnlineTime(new Request(url),env)).json();assert.equal(body.data.onlineMs,300000);assert.equal(body.data.collectorEnabled,true);
});

test('collector rejects oversized fleets before any provider or ledger call',async()=>{
 const env={ONLINE_TIME_ENABLED:'true',CEM_REFRESH_TOKEN:'test',CEM_MAPPING:JSON.stringify(Array.from({length:201},(_,i)=>({code:'LO_'+String(i+1).padStart(4,'0'),branch:i+1,device:i+1})))};
 await assert.rejects(collectOnlineTime(env),/at most 200/);
});

test('fleet daily summary uses one ledger call and only configured machine identities',async()=>{
 let calls=0;
 const env={CEM_REFRESH_TOKEN:'test',CEM_MAPPING:JSON.stringify([{code:'LO_0001',branch:1,device:1}]),ONLINE_TIME:{getByName:()=>({days:async(codes,date)=>{calls++;assert.deepEqual(codes,['LO_0001']);return codes.map(code=>({code,date,seenOnline:true,onlineMs:60000}));}})}};
 const response=await handleOnlineTime(new Request('https://dashboard.test/api/online-time?date=2026-09-16'),env);
 const body=await response.json();assert.equal(body.data.rows[0].seenOnline,true);assert.equal(calls,1);
});

test('CEM resolves history by mapped device, reads older pages if necessary, and preserves status on history failure',async()=>{
 const mapping=[{code:'LO_0001',branch:1,device:1}];let calls=0;
 globalThis.fetch=async url=>{calls++;if(url.includes('branch_info'))return Response.json({id:1,qr_box_machine:[{id:1,mac_address:'test-mac',status:'ONLINE'}]});
 assert.ok(url.includes('/state-history/test-mac'));const page=Number(new URL(url).searchParams.get('page'));return Response.json({pagination:{page,total_page:2},result:page===1?[{state:'ONLINE',record_at:'2026-09-16T00:00:00Z'}]:[{state:'OFFLINE',record_at:'2026-09-15T00:00:00Z'}]});};
 const [sample]=await readCemStatuses({mapping},0,'test',Date.now()+45000);assert.equal(sample.status,'ONLINE');assert.equal(sample.sourceHistory.complete,true);assert.equal(sample.sourceHistory.latestOfflineAt,Date.parse('2026-09-15T00:00:00Z'));assert.equal(calls,3);
 globalThis.fetch=async url=>url.includes('branch_info')?Response.json({id:1,qr_box_machine:[{id:1,mac_address:'test-mac',status:'ONLINE'}]}):new Response('failed',{status:503});
 const [failed]=await readCemStatuses({mapping},0,'test',Date.now()+45000);assert.equal(failed.status,'ONLINE');assert.equal(failed.sourceHistoryError,true);
});

test('all current statuses are read before optional history begins',async()=>{
 const mapping=Array.from({length:5},(_,i)=>({code:'LO_000'+(i+1),branch:i+1,device:i+1}));let statuses=0;
 globalThis.fetch=async url=>{if(url.includes('branch_info')){statuses++;const id=Number(new URL(url).searchParams.get('id'));return Response.json({id,qr_box_machine:[{id,mac_address:'mac-'+id,status:'ONLINE'}]});}
 assert.equal(statuses,5);return new Response('unavailable',{status:503});};
 const result=await readCemStatuses({mapping},0,'test',Date.now()+45000);assert.equal(result.filter(r=>r.status==='ONLINE').length,5);
});

test('scheduled payment work is staggered and saved separately from status observations',async()=>{
 const payments=[];let selected;
 const env={ONLINE_TIME_ENABLED:'true',CEM_REFRESH_TOKEN:'test',CEM_MAPPING:JSON.stringify(Array.from({length:6},(_,i)=>({code:'LO_'+String(i+1).padStart(4,'0'),branch:i+1,device:i+1}))),
 CEM_SESSION:{getByName:()=>({statusBatch:async batch=>Array.from({length:batch?1:5},(_,i)=>({code:'LO_'+String(batch*5+i+1).padStart(4,'0'),at:Date.now(),status:'ONLINE'})),paymentBatch:async batch=>{selected=batch;return [{code:'LO_0006',payment:{provider:'cem',receivedAt:1,amountCents:2000,currency:'THB',method:'ONLINE',checkedAt:2}}];}})},
 ONLINE_TIME:{getByName:()=>({record:async rows=>({accepted:rows.length}),recordPayments:async rows=>{payments.push(...rows);return {accepted:rows.length};}})}};
 const result=await collectOnlineTime(env,{paymentSlot:3});assert.equal(selected,1);assert.equal(result.paymentAccepted,1);assert.equal(payments[0].code,'LO_0006');
});
