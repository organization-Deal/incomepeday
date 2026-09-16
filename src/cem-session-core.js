import { HttpError, requestJson } from './http.js';
import { cemConfig, readCemBatch, cemHistory, readCemStatuses } from './cem.js';

// Only a Durable Object owns this state. Never use an isolate-global token cache.
export class CemSessionCore {
  constructor(storage,env){this.storage=storage;this.env=env;this.tail=Promise.resolve();this.pending=0;}
  async accessToken(config,deadline=Date.now()+45000){
    const auth=await this.storage.get('session');
    if(auth?.expires>Date.now()+60000)return auth.bearer;
    let token,stage='upstream';
    try{
      token=await requestJson('https://cem.t-dev.app/api/authenticate/refresh_token',{
        method:'POST',redirect:'manual',headers:{'content-type':'application/json'},
        body:JSON.stringify({refresh_token:auth?.refresh||config.refresh}),
      },{timeout:Math.max(1,Math.min(12000,deadline-Date.now()))});
      stage='token';
      const payload=JSON.parse(atob(token.bearer.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      const expires=Number(payload.exp)*1000;
      if(!Number.isFinite(expires)||expires<Date.now()+60000||typeof token.refresh_token!=='string'||!token.refresh_token)throw new Error();
      // Persist the rotated refresh token before exposing its bearer to reads.
      stage='storage';
      await this.storage.put('session',{bearer:token.bearer,refresh:token.refresh_token,expires});
      return token.bearer;
    }catch(error){throw new HttpError('ต่ออายุ session CEM ไม่สำเร็จ ('+stage+
      (stage==='upstream'&&error instanceof HttpError?' — '+error.message:'')+') กรุณาตรวจหรือเปลี่ยน CEM_REFRESH_TOKEN');}
  }
  run(operation,budget=45000){
    if(this.pending>=8)return Promise.reject(new HttpError('CEM มีคำขอมากเกินไป กรุณาลองใหม่',503));
    this.pending++;const queued=Date.now();
    const task=this.tail.then(async()=>{
      if(Date.now()-queued>15000)throw new HttpError('CEM กำลังประมวลผล กรุณาลองใหม่',503);
      const config=cemConfig(this.env);if(!config)throw new HttpError('ยังไม่ได้ตั้งค่า CEM',503);
      const deadline=Date.now()+budget;
      const bearer=await this.accessToken(config,deadline);
      return operation(config,bearer,deadline);
    });
    // Serialize complete reads: rotating a token must not invalidate in-flight reads.
    this.tail=task.then(()=>{},()=>{}).finally(()=>{this.pending--;});
    return task;
  }
  readBatch(month,batch){return this.run((config,bearer,deadline)=>readCemBatch(config,month,batch,new Date(),bearer,deadline));}
  statusBatch(batch){return this.run((config,bearer,deadline)=>readCemStatuses(config,batch,bearer,deadline),10000);}
  history(data,code){return this.run((config,bearer,deadline)=>cemHistory(data,code,config,new Date(),bearer,deadline));}
}
