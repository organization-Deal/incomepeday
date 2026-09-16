import {HttpError,json} from './http.js';
const DAY=86400000,OFFSET=7*3600000,MAX_GAP=10*60000;
const validCode=code=>typeof code==='string'&&/^(?:LO_\d{4,10}|(?:CEM|EQ)_[A-F0-9]{12})$/.test(code);
const known=status=>status==='ONLINE'||status==='OFFLINE';
const dateOf=at=>new Date(at+OFFSET).toISOString().slice(0,10);
export function dayBounds(date){
 if(typeof date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(date))throw new HttpError('วันที่ไม่ถูกต้อง',400);
 const start=Date.parse(date+'T00:00:00+07:00');
 if(!Number.isFinite(start)||dateOf(start)!==date)throw new HttpError('วันที่ไม่ถูกต้อง',400);
 return [start,start+DAY];
}
// Independent of revenue and snapshot percentages. Only trusted server-side reads enter here.
export class OnlineTimeCore{
 constructor(storage){this.storage=storage;}
 async record(samples,now=Date.now()){
  if(!Array.isArray(samples)||samples.length>500||samples.some(s=>!validCode(s?.code)||!Number.isSafeInteger(s.at)||s.at<0||s.at>now||!['ONLINE','OFFLINE','UNKNOWN','ERROR'].includes(s.status)))throw new HttpError('ข้อมูลสถานะไม่ถูกต้อง',400);
  return this.storage.transaction(async tx=>{
   let accepted=0;
   for(const sample of samples){
    const lastKey='last:'+sample.code,last=await tx.get(lastKey);
    if(last&&sample.at<=last.at)continue;
    const entries=new Map();
    async function entry(date){if(!entries.has(date)){const key='day:'+date+':'+sample.code;entries.set(date,{key,value:await tx.get(key)||{onlineMs:0,offlineMs:0,observations:0}});}return entries.get(date).value;}
    if(last&&sample.at-last.at<=MAX_GAP&&known(last.status)&&known(sample.status)){
     for(let from=last.at;from<sample.at;){
      const date=dateOf(from),until=Math.min(dayBounds(date)[1],sample.at),value=await entry(date);
      value[last.status==='ONLINE'?'onlineMs':'offlineMs']+=until-from;from=until;
     }
    }
    const value=await entry(dateOf(sample.at));value.observations++;value.lastObservedAt=sample.at;
    for(const {key,value} of entries.values())await tx.put(key,value);
    await tx.put(lastKey,{at:sample.at,status:sample.status});accepted++;
   }
   return {accepted};
  });
 }
 async day(code,date,now=Date.now()){
  if(!validCode(code))throw new HttpError('รหัสตู้ไม่ถูกต้อง',400);
  const [start,end]=dayBounds(date);if(start>now)throw new HttpError('ยังไม่ถึงวันที่เลือก',400);
  const value=await this.storage.get('day:'+date+':'+code)||{onlineMs:0,offlineMs:0,observations:0};
  const elapsedMs=Math.min(now,end)-start;
  return {...value,code,date,elapsedMs,unknownMs:Math.max(0,elapsedMs-value.onlineMs-value.offlineMs),closed:now>=end,
   intervalMinutes:5,maxGapMinutes:10,estimated:true,timeZone:'Asia/Bangkok'};
 }
}
export async function handleOnlineTime(request,env){
 if(request.method!=='GET')return json({ok:false,error:'method not allowed'},405);
 const url=new URL(request.url),code=url.searchParams.get('code'),date=url.searchParams.get('date');
 if(!validCode(code))throw new HttpError('รหัสตู้ไม่ถูกต้อง',400);dayBounds(date);
 if(!env.ONLINE_TIME?.getByName)throw new HttpError('ยังไม่ได้เปิดเก็บชั่วโมงออนไลน์',503);
 const data=await env.ONLINE_TIME.getByName('fleet-v1').day(code,date);
 return json({ok:true,data:{...data,collectorEnabled:env.ONLINE_TIME_ENABLED==='true'}});
}
