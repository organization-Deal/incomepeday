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
