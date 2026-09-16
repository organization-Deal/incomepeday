import {cemConfig,cemCoordinator,validateProviders} from './cem.js';
import {eqlinkConfig,readEqlinkStatuses} from './eqlink.js';
export async function collectOnlineTime(env,{paymentSlot=null}={}){
 if(env.ONLINE_TIME_ENABLED!=='true')return {enabled:false};
 const started=Date.now(),cem=cemConfig(env),eq=eqlinkConfig(env);validateProviders(eq,cem);
 // At most 40 CEM status RPCs + 2 payment RPCs + 3 ledger RPCs + 3 direct EQLink status reads.
 if(cem&&cem.mapping.length>200)throw new Error('Online-time collector supports at most 200 CEM devices per invocation; shard collection before enabling a larger fleet');
 const ledger=env.ONLINE_TIME.getByName('fleet-v1');
 let accepted=0,unknown=0,sourceHistoryFailed=0;
 const save=async samples=>{const result=await ledger.record(samples);accepted+=result.accepted;sourceHistoryFailed+=samples.filter(s=>s.sourceHistoryError).length;unknown+=samples.filter(s=>s.status==='UNKNOWN'||s.status==='ERROR').length;};
 // Each CEM RPC makes at most 5 reads (concurrency 2), plus one coordinated refresh.
 // Whole run is bounded; failed/omitted observations remain unknown, never offline.
 if(cem){
  const coordinator=await cemCoordinator(env,cem),samples=[];
  for(let batch=0;batch<Math.ceil(cem.mapping.length/5);batch++){
   const mapping=cem.mapping.slice(batch*5,(batch+1)*5);
   try{if(Date.now()-started>240000)throw new Error('deadline');samples.push(...await coordinator.statusBatch(batch));}
   catch{samples.push(...mapping.map(m=>({code:m.code,at:Date.now(),status:'UNKNOWN'})));}
  }
  await save(samples);
 }
 if(eq){
  let samples;try{samples=await readEqlinkStatuses(eq);}catch{samples=eq.mapping.map(m=>({code:m.code,at:Date.now(),status:'UNKNOWN'}));}
  await save(samples);
 }
 let paymentAccepted=0,paymentFailed=0;
 if(Number.isSafeInteger(paymentSlot)){
  const payments=[];
  if(cem){
   try{const batches=Math.ceil(cem.mapping.length/5),coordinator=await cemCoordinator(env,cem);payments.push(...await coordinator.paymentBatch(paymentSlot%batches));}
   catch{paymentFailed+=Math.min(5,cem.mapping.length);}
  }
  if(eq){
   const batches=Math.ceil(eq.mapping.length/5),batch=paymentSlot%batches;
   try{payments.push(...await env.CEM_SESSION.getByName('eqlink-payments-v1').eqlinkPaymentBatch(batch));}catch{paymentFailed+=Math.min(5,eq.mapping.length-batch*5);}
  }
  paymentFailed+=payments.filter(row=>row.error).length;
  if(payments.length){try{paymentAccepted=(await ledger.recordPayments(payments)).accepted;}catch{paymentFailed+=payments.length;}}
 }
 const result={enabled:true,accepted,unknown,sourceHistoryFailed,paymentAccepted,paymentFailed,durationMs:Date.now()-started};
 console[unknown||sourceHistoryFailed||paymentFailed?'warn':'log'](JSON.stringify({event:'online-time-sample',...result}));
 return result;
}
