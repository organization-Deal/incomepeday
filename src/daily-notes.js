import {HttpError,json,requestBody} from './http.js';
const validDate=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function validateDailyNote(value){
 if(!value||typeof value.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)||!validDate(value.date)||
  typeof value.text!=='string'||!value.text.trim()||value.text.length>3000||typeof value.by!=='string'||!value.by.trim()||value.by.length>100)throw new HttpError('กรุณาตรวจวันที่ ชื่อผู้บันทึก และข้อความ (ไม่เกิน 3,000 ตัวอักษร)',400);
 return {id:value.id,date:value.date,text:value.text.trim(),by:value.by.trim()};
}
export class DailyNotesCore{
 constructor(storage){this.storage=storage;}
 async save(value){
  const note=validateDailyNote(value);
  return this.storage.transaction(async tx=>{
   const old=await tx.get('id:'+note.id);
   if(old){if(['date','text','by'].some(k=>old[k]!==note[k]))throw new HttpError('รหัสบันทึกนี้ถูกใช้แล้ว กรุณาส่งเป็นบันทึกใหม่',409);return old;}
   const entry={...note,at:new Date().toISOString()};
   await tx.put({['id:'+note.id]:entry,['note:'+note.date+':'+entry.at+':'+note.id]:entry});return entry;
  });
 }
 async list(date,cursor){
  if(!validDate(date)||cursor&&(typeof cursor!=='string'||cursor.length>150||!cursor.startsWith('note:'+date+':')))throw new HttpError('วันที่หรือหน้าบันทึกไม่ถูกต้อง',400);
  const rows=[...await this.storage.list({prefix:'note:'+date+':',reverse:true,limit:51,...(cursor?{end:cursor}:{})})];
  return {notes:rows.slice(0,50).map(([,v])=>v),nextCursor:rows.length>50?rows[49][0]:null};
 }
}
export async function handleDailyNotes(request,env){
 const url=new URL(request.url);
 if(!['GET','POST'].includes(request.method))throw new HttpError('method not allowed',405);
 let body;if(request.method==='POST'){
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new HttpError('origin ไม่ถูกต้อง',403);
  body=await requestBody(request);
 }
 const code=body?.code||url.searchParams.get('code');
 if(typeof code!=='string'||!/^(?:LO_\d{4,10}|(?:CEM|EQ)_[A-F0-9]{12})$/.test(code))throw new HttpError('รหัสตู้ไม่ถูกต้อง',400);
 if(!env.DAILY_NOTES?.getByName)throw new HttpError('ยังไม่ได้ตั้งระบบบันทึกรายวัน',503);
 const store=env.DAILY_NOTES.getByName(code);
 if(body){const by=request.headers.get('Cf-Access-Authenticated-User-Email')||body.by;const value=validateDailyNote({...body,by});await store.save(value);return json({ok:true,data:{saved:true,storage:'shared'}});}
 const result=await store.list(url.searchParams.get('date'),url.searchParams.get('cursor'));
 return json({ok:true,data:{...result,storage:'shared'}});
}
