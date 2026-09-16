globalThis.DealOnlineTime=(()=>{
 const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const duration=ms=>{const minutes=Math.floor(ms/60000);return Math.floor(minutes/60)+' ชม. '+minutes%60+' นาที';};
 function mount(target,code){
  if(!target)return;
  target.innerHTML='<div class="ot-head"><div><h3>ชั่วโมงออนไลน์รายวัน</h3><small>00:00–23:59 น. · เวลาไทย</small></div><label>วันที่<input aria-label="วันที่ดูชั่วโมงออนไลน์" type="date" value="'+today()+'" max="'+today()+'"></label></div><div class="ot-result" aria-live="polite"></div>';
  const input=target.querySelector('input'),result=target.querySelector('.ot-result');let sequence=0;
  async function load(){
   const id=++sequence;result.textContent='กำลังอ่านชั่วโมงออนไลน์…';
   try{
    const {data:d}=await DealApi.request('/api/online-time?'+new URLSearchParams({code,date:input.value}));
    if(id!==sequence||!target.isConnected)return;
    if(!d||['onlineMs','offlineMs','unknownMs','elapsedMs','observations'].some(k=>!Number.isFinite(d[k])||d[k]<0))throw new Error('ข้อมูลชั่วโมงไม่ถูกต้อง');
    if(!d.observations){result.textContent=d.collectorEnabled?'ยังไม่มีประวัติช่วงเวลาของวันนี้ เริ่มนับเมื่อเก็บสถานะได้ต่อเนื่อง':'ยังไม่ได้เริ่มเก็บชั่วโมงออนไลน์ — ข้อมูลเดิมเป็นสถานะ ณ เวลาเช็ค ไม่สามารถแปลงเป็นชั่วโมงย้อนหลังได้';return;}
    result.innerHTML='<div class="ot-values"><div><span>ออนไลน์ ≈</span><b>'+duration(d.onlineMs)+'</b></div><div><span>ออฟไลน์ ≈</span><b>'+duration(d.offlineMs)+'</b></div><div><span>ข้อมูลขาดหาย</span><b>'+duration(d.unknownMs)+'</b></div></div><p class="ot-detail"></p>';
    result.querySelector('.ot-detail').textContent=(d.closed?'สิ้นสุดวันแล้ว':'วันนี้ยังไม่สิ้นสุด · นับถึงเวลาที่ตรวจได้')+' · ประมาณจากรอบเช็ค 5 นาที; ช่วงห่างเกิน 10 นาทีไม่นับเป็นออนไลน์หรือออฟไลน์'+(d.collectorEnabled?'':' · ปัจจุบันหยุดเก็บข้อมูล')+(d.lastObservedAt?' · เช็คล่าสุด '+new Date(d.lastObservedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}):'');
   }catch(error){if(id===sequence&&target.isConnected)result.textContent='ยังอ่านชั่วโมงไม่ได้: '+error.message;}
  }
  input.onchange=load;load();
 }
 return {mount};
})();
