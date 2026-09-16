import {latestCemEvents} from './source-status.js';
import { readMapping } from './fleet.js';
import { HttpError, requestJson, json } from './http.js';
import { monthDates, configFingerprint } from './eqlink.js';

const HOST='https://cem.t-dev.app';
const SIZE=5;
const fail=()=>new HttpError('อ่านข้อมูล CEM ไม่สำเร็จ — ตรวจอายุ session การจับคู่ตู้ สกุลเงิน และรายงาน');
export function cemConfig(env){
  if(!env.CEM_REFRESH_TOKEN && !env.CEM_MAPPING)return null;
  if(typeof env.CEM_REFRESH_TOKEN!=='string'||!env.CEM_REFRESH_TOKEN.trim())throw fail();
  let mapping;try{mapping=readMapping(env,'CEM_MAPPING');}catch{throw fail();}
  if(!Array.isArray(mapping)||!mapping.length||mapping.length>500)throw fail();
  const codes=new Set(),branches=new Set(),devices=new Set();
  for(const m of mapping){
    if(!m||!/^(?:LO_\d{4,10}|CEM_[A-F0-9]{12})$/.test(m.code)||!Number.isSafeInteger(m.branch)||m.branch<=0||
      !Number.isSafeInteger(m.device)||m.device<=0||codes.has(m.code)||devices.has(m.device))throw fail();
    codes.add(m.code);branches.add(m.branch);devices.add(m.device);
  }
  return {refresh:env.CEM_REFRESH_TOKEN,mapping};
}
export function validateProviders(boxing,cem){
  const codes=new Set(boxing?.mapping.map(m=>m.code));
  if(cem?.mapping.some(m=>codes.has(m.code)))throw new HttpError('รหัส LO ซ้ำระหว่าง CEM และ EQLink — เลือกแหล่งรายได้เดียวต่อตู้',500);
}
export async function cemManifest(config){
  if(!config)return null;
  return {batches:Math.ceil(config.mapping.length/SIZE),version:await configFingerprint(config),
    codes:config.mapping.map(m=>m.code)};
}
function datesFor(month,now){try{return monthDates(month,now);}catch{throw new HttpError('เดือน CEM ไม่ถูกต้อง',400);}}
function today(now){return new Date(now.getTime()+7*3600000).toISOString().slice(0,10);}
function cents(value){
  if(!['string','number'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value))||
    Number(value)<0||!Number.isSafeInteger(Math.round(Number(value)*100)))throw fail();
  return Math.round(Number(value)*100);
}
async function session(config,accessToken,deadline=Date.now()+45000){
  let bearer=accessToken;
  async function call(path,body){
    const remaining=deadline-Date.now();if(remaining<=0)throw fail();
    try{return await requestJson(HOST+path,{method:body?'POST':'GET',redirect:'manual',
      headers:{accept:'application/json','content-type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},
      ...(body?{body:JSON.stringify(body)}:{})},{timeout:Math.min(12000,remaining)});
    }catch{throw fail();}
  }
  if(!bearer){
    const token=await call('/api/authenticate/refresh_token',{refresh_token:config.refresh});
    if(typeof token?.bearer!=='string'||!token.bearer)throw fail();
    bearer=token.bearer;
  }
  return call;
}
async function machine(call,m){
  const data=await call('/api/restrict/machine/qrbox/branch_info?id='+m.branch);
  const row=data?.qr_box_machine?.find(r=>r.id===m.device);
  if(m.append){
    if(data?.id!==m.branch||!row)throw fail();
    const unavailable=data.qr_box_machine.length!==1?'รายงานรวมหลายตู้ในสาขา':
      data.currency_type!=='THB'||row.currency_type!=='THB'?'สกุลเงินสาขา '+String(data.currency_type||'UNKNOWN')+' / ตู้ '+String(row.currency_type||'UNKNOWN'):
      data.is_time_close!==false||row.is_time_to_close!==false?'รอบปิดยอดพิเศษ':'';
    return {status:['ONLINE','OFFLINE'].includes(row.status)?row.status:'UNKNOWN',unavailable,currency:String(row.currency_type||data.currency_type)};
  }
  if(data?.id!==m.branch||data.currency_type!=='THB'||data.is_time_close!==false||
    !Array.isArray(data.qr_box_machine)||data.qr_box_machine.length!==1||!row||row.id!==m.device||
    row.currency_type!=='THB'||row.is_time_to_close!==false)throw fail();
  return {status:['ONLINE','OFFLINE'].includes(row.status)?row.status:'UNKNOWN'};
}
function daily(data,closed){
  if(!Array.isArray(data?.details)||data.details.length!==closed.length)throw fail();
  const amounts=new Map();
  for(const row of data.details){
    if(!row||!Number.isInteger(row.day)||!closed.some(date=>Number(date.slice(8))===row.day)||amounts.has(row.day))throw fail();
    amounts.set(row.day,cents(row.total_summary));
  }
  return closed.map(date=>amounts.get(Number(date.slice(8))));
}
function current(data,date){
  if(typeof data?.title!=='string'||data.is_time_to_close!==false)throw fail();
  const timestamp=Date.parse(data.title.replace(/(\d+)(st|nd|rd|th)/,'$1')+' 00:00:00 GMT');
  if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==date)throw fail();
  return cents(data.total);
}
async function bounded(items,fn){
  let next=0,error;const result=new Array(items.length);
  await Promise.all(Array.from({length:Math.min(2,items.length)},async()=>{
    while(next<items.length&&!error){const i=next++;try{result[i]=await fn(items[i]);}catch(e){error=e;}}
  }));
  if(error)throw error;return result;
}
export async function readCemBatch(config,month,batch,now=new Date(),accessToken,deadline){
  if(!config||!Number.isInteger(batch)||batch<0||batch>=Math.ceil(config.mapping.length/SIZE))throw new HttpError('ชุดข้อมูล CEM ไม่ถูกต้อง',400);
  const mapping=config.mapping.slice(batch*SIZE,(batch+1)*SIZE),dates=datesFor(month,now),day=today(now);
  const source={dates,totals:dates.map(()=>({})),status:{},today:day,current:dates.includes(day),codes:mapping.map(m=>m.code),machines:mapping.filter(m=>m.append).map(({code,name,append,currency,unavailable})=>({code,name,append,currency,unavailable}))};
  if(!dates.length)return source;
  const call=await session(config,accessToken,deadline),closed=dates.filter(date=>date<day),[mm,year]=month.split('-');
  const result=await bounded(mapping,async m=>{
    let status='UNKNOWN',metadata=m.append?{code:m.code,name:m.name,append:true,currency:m.currency}:null;
    try{
    const info=await machine(call,m);
    status=info.status;
    metadata=m.append?{code:m.code,name:m.name,append:true,currency:info.currency,unavailable:info.unavailable}:null;
    if(info.unavailable)return {m,status,amounts:dates.map(()=>null),metadata};
    const amounts=daily(await call(`/api/restrict/machine/qrbox/daily_summary/${year}/${Number(mm)}/${m.branch}`),closed);
    if(source.current)amounts.push(current(await call(`/api/restrict/machine/qrbox/summary_report?id=${m.branch}&date_type=day&is_toggle_summary_card=false`),day));
    return {m,status,amounts,metadata};
    }catch(error){
      if(!m.append)throw error;
      return {m,status,amounts:dates.map(()=>null),metadata:{...metadata,unavailable:'อ่านรายงานไม่สำเร็จ'},transient:true};
    }
  });
  source.partial=result.some(r=>r.transient);
  source.machines=result.map(r=>r.metadata).filter(Boolean);
  for(const {m,status,amounts} of result){source.status[m.code]=status;amounts.forEach((value,i)=>{source.totals[i][m.code]=value;});}
  return source;
}
export async function handleCem(url,env,ctx){
  const config=cemConfig(env);if(!config)throw new HttpError('ยังไม่ได้ตั้งค่า CEM',503);
  const manifest=await cemManifest(config),month=url.searchParams.get('month'),batch=Number(url.searchParams.get('batch'));
  datesFor(month,new Date());
  if(!url.searchParams.has('batch')||!Number.isInteger(batch)||batch<0||batch>=manifest.batches)throw new HttpError('ชุดข้อมูล CEM ไม่ถูกต้อง',400);
  if(url.searchParams.get('version')!==manifest.version)throw new HttpError('การตั้งค่า CEM เปลี่ยนแล้ว กรุณารีเฟรชหน้า',409);
  const keyUrl=new URL('/api/cem',url.origin);
  keyUrl.search=new URLSearchParams({month,batch:String(batch),version:manifest.version,day:today(new Date())}).toString();
  const key=new Request(keyUrl),cache=globalThis.caches?.default;
  if(cache&&url.searchParams.get('fresh')!=='1'){
    try{const hit=await cache.match(key);if(hit){const res=new Response(hit.body,hit);res.headers.set('cache-control','no-store');return res;}}catch{}
  }
  const stub=await cemCoordinator(env,config);
  let source;try{source=await stub.readBatch(month,batch);}catch{throw fail();}
  const res=json({ok:true,data:{...source,version:manifest.version,batch}});
  if(cache&&!source.partial){const stored=res.clone();stored.headers.set('cache-control',`public, max-age=${source.current?600:21600}`);ctx.waitUntil(cache.put(key,stored).catch(()=>{}));}
  return res;
}
export async function cemHistory(data,code,config,now=new Date(),accessToken,deadline){
  const m=config?.mapping.find(m=>m.code===code);if(!m)return data;
  if(!Array.isArray(data.history)||data.history.length>36)throw fail();
  for(const h of data.history)datesFor(h.month,now);
  if(!data.history.length)return data;
  const call=await session(config,accessToken,deadline);const info=await machine(call,m);
  if(info.unavailable)return {...data,history:data.history.map(h=>({...h,total:null}))};
  const years=[...new Set(data.history.map(h=>h.month.split('-')[1]))];
  const reports=await bounded(years,async year=>{
    const j=await call(`/api/restrict/machine/qrbox/monthly_summary/${year}/${m.branch}`);
    if(!Array.isArray(j?.details)||j.details.length>12)throw fail();
    const totals=new Map();for(const row of j.details){
      if(row.year_num!==Number(year)||!Number.isInteger(row.month_num)||row.month_num<1||row.month_num>12||totals.has(row.month_num))throw fail();
      totals.set(row.month_num,cents(row.total_summary));
    }
    return [year,totals];
  });
  const byYear=new Map(reports);
  // Yearly summary excludes the current month. Use its explicit month summary.
  const currentMonth=dayMonth(now);let currentTotal;
  if(data.history.some(h=>h.month===currentMonth)){
    const j=await call(`/api/restrict/machine/qrbox/summary_report?id=${m.branch}&date_type=month&is_toggle_summary_card=false`);
    const title=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})
      .format(new Date(today(now)+'T00:00:00Z'));
    if(j?.is_time_to_close!==false||j.title!==title)throw fail();currentTotal=cents(j.total);
  }
  return {...data,history:data.history.map(h=>{
    const [mm,year]=h.month.split('-');const total=h.month===currentMonth?currentTotal:byYear.get(year).get(Number(mm));
    if(total===undefined)throw fail();return {...h,total:total/100};
  })};
}
function dayMonth(now){const d=today(now);return d.slice(5,7)+'-'+d.slice(0,4);}

export async function cemCoordinator(env,config){
  if(!env.CEM_SESSION?.getByName)throw new HttpError('ยังไม่ได้ตั้งค่า CEM_SESSION Durable Object',503);
  // One coordinator per seeded login session, not per edge location or viewer.
  return env.CEM_SESSION.getByName(await configFingerprint({refresh:config.refresh}));
}

// Status-only sampling: no revenue requests; currency/closing rules do not suppress connectivity.
export async function readCemStatuses(config,batch,accessToken,deadline){
 const size=5;if(!Number.isInteger(batch)||batch<0||batch>=Math.ceil(config.mapping.length/size))throw new HttpError('ชุดสถานะไม่ถูกต้อง',400);
 const call=await session(config,accessToken,deadline);
 // Prioritize all current observations; optional history must not starve later machines.
 const observations=await bounded(config.mapping.slice(batch*size,(batch+1)*size),async m=>{
  try{
   const data=await call('/api/restrict/machine/qrbox/branch_info?id='+m.branch);
   const row=data?.qr_box_machine?.find(r=>r.id===m.device);
   if(data?.id!==m.branch||!row)throw fail();
   return {mac:row.mac_address,sample:{code:m.code,at:Date.now(),status:['ONLINE','OFFLINE'].includes(row.status)?row.status:'UNKNOWN'}};
  }catch{return {sample:{code:m.code,at:Date.now(),status:'UNKNOWN'}};}
 });
 return bounded(observations,async({mac,sample})=>{
  try{
   if(typeof mac!=='string'||!mac)throw fail();
   const history={latestOnlineAt:null,latestOfflineAt:null,checkedAt:Date.now(),provider:'cem',complete:false};
   for(let page=1;page<=3;page++){
    const data=await call('/api/restrict/machine/state-history/'+encodeURIComponent(mac)+'?'+new URLSearchParams({page:String(page),limit:'100',project:'qrbox'}));
    if(data?.pagination?.page!==page)throw fail();
    const latest=latestCemEvents(data);history.latestOnlineAt??=latest.latestOnlineAt;history.latestOfflineAt??=latest.latestOfflineAt;
    if((history.latestOnlineAt!==null&&history.latestOfflineAt!==null)||page>=data.pagination.total_page){history.complete=true;break;}
   }
   sample.sourceHistory=history;
  }catch{sample.sourceHistoryError=true;}
  return sample;
 });
}
