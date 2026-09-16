globalThis.DealOnlineTime=(()=>{
 const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const duration=ms=>{const minutes=Math.floor(ms/60000);return Math.floor(minutes/60)+' ชม. '+minutes%60+' นาที';};
 const stamp=at=>Number.isFinite(at)?new Date(at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'ยังไม่มีบันทึก';
 const latest=d=>{const h=d?.sourceHistory;return h?'ออนไลน์ล่าสุดจากต้นทาง: '+stamp(h.latestOnlineAt)+' · ออฟไลน์ล่าสุดจากต้นทาง: '+stamp(h.latestOfflineAt)+(h.complete?'':' · ประวัติยังไม่ครบ'):'พบออนไลน์ล่าสุด: '+stamp(d?.latestOnlineAt)+' · พบออฟไลน์ล่าสุด: '+stamp(d?.latestOfflineAt);};
 const latestRevenue=r=>{let best=null;for(const [date,cell] of Object.entries(r?.daily||{})){if(typeof cell?.d!=='number'||cell.d<=0||!/^(?:0[1-9]|[12]\d|3[01])\/(?:0[1-9]|1[0-2])$/.test(date))continue;const key=date.slice(3)+date.slice(0,2);if(!best||key>best.key)best={key,date,amountCents:Math.round(cell.d*100)};}return best;};
 const fallback=(code,element)=>{const el=element?.dataset?.lastRevenueCents?element:document.querySelector('[data-online-summary="'+CSS.escape(code)+'"][data-last-revenue-cents]');if(!el)return null;const cents=Number(el.dataset.lastRevenueCents);if(!Number.isSafeInteger(cents)||cents<=0)return null;return 'ยอดรายรับล่าสุด ฿'+(cents/100).toLocaleString('th-TH',{maximumFractionDigits:2})+' · วันที่ '+el.dataset.lastRevenueDate+' (ยอดรวมรายวัน)';};
 const payment=(d,code,element)=>{const p=d?.latestPayment;if(!p)return fallback(code,element)||'เงินเข้าล่าสุด: ยังไม่มีรายการจากต้นทาง';const amount=(p.amountCents/100).toLocaleString('th-TH',{minimumFractionDigits:p.amountCents%100?2:0,maximumFractionDigits:2});const methods={ONLINE:'ออนไลน์',CASH:'เงินสด',COIN:'เหรียญ'};return 'เงินเข้าล่าสุด ฿'+amount+' · '+stamp(p.receivedAt)+' · '+(methods[p.method]||p.method)+' ('+String(p.provider).toUpperCase()+')';};
 const headline=d=>d?.seenOnline||d?.onlineMs>0?'เคยออนไลน์แล้ว':d?.observations?'ยังไม่พบออนไลน์ในช่วงที่เก็บข้อมูล':'ยังไม่มีข้อมูลยืนยัน';
 const total=d=>d?.seenOnline||d?.onlineMs>0?(d.onlineMs>=60000?'รวม ≈ '+duration(d.onlineMs):d.onlineMs>0?'รวมประมาณน้อยกว่า 1 นาที':'พบออนไลน์แล้ว · รอข้อมูลเพื่อคำนวณเวลา'):d?.observations?'พบออนไลน์สะสม 0 ชม. 0 นาที':'เวลาสะสมยังไม่ทราบ';
 let fleetCache=null;
 async function fleet(){
  const date=today();if(!fleetCache||fleetCache.date!==date||Date.now()-fleetCache.at>30000){
   const promise=DealApi.request('/api/online-time?'+new URLSearchParams({date})).then(({data})=>{if(!Array.isArray(data?.rows))throw new Error('ข้อมูลไม่ครบ');return new Map(data.rows.map(d=>[d.code,d]));});
   fleetCache={date,at:Date.now(),promise};
  }return fleetCache.promise;
 }
 async function fillSummaries(root){
  const targets=[...root.querySelectorAll('[data-online-summary]')];if(!targets.length)return;
  try{const data=await fleet();for(const el of targets){if(!el.isConnected)continue;const d=data.get(el.dataset.onlineSummary),code=el.dataset.onlineSummary;el.replaceChildren();const b=document.createElement('b'),small=document.createElement('small');b.textContent='วันนี้ · '+headline(d);small.textContent=total(d);el.append(b,small);const times=document.createElement('small');times.className='ot-last-inline';times.textContent=latest(d);el.append(times);const money=document.createElement('small');money.className='ot-payment-inline';money.textContent=payment(d,code,el);el.append(money);}}
  catch{for(const el of targets)if(el.isConnected)el.textContent='วันนี้ · ยังอ่านเวลาสะสมไม่ได้';}
 }
 function mount(target,code){
  if(!target)return;
  target.innerHTML='<div class="ot-head"><div><h3>ชั่วโมงออนไลน์รายวัน</h3><small>00:00–23:59 น. · เวลาไทย</small></div><label>วันที่<input aria-label="วันที่ดูชั่วโมงออนไลน์" type="date" value="'+today()+'" max="'+today()+'"></label></div><div class="ot-result" aria-live="polite"></div><div class="ot-last" aria-live="polite"></div>';
  const input=target.querySelector('input'),result=target.querySelector('.ot-result'),last=target.querySelector('.ot-last');let sequence=0;
  async function load(){
   const id=++sequence;result.textContent='กำลังอ่านชั่วโมงออนไลน์…';last.textContent='';
   try{
    const {data:d}=await DealApi.request('/api/online-time?'+new URLSearchParams({code,date:input.value}));
    if(id!==sequence||!target.isConnected)return;
    if(!d||['onlineMs','offlineMs','unknownMs','elapsedMs','observations'].some(k=>!Number.isFinite(d[k])||d[k]<0))throw new Error('ข้อมูลชั่วโมงไม่ถูกต้อง');
    last.textContent='ประวัติล่าสุดของตู้ (ทุกวัน) · '+latest(d)+' · '+payment(d,code);
    if(!d.observations){result.textContent=d.collectorEnabled?'ยังไม่มีประวัติช่วงเวลาของวันนี้ เริ่มนับเมื่อเก็บสถานะได้ต่อเนื่อง':'ยังไม่ได้เริ่มเก็บชั่วโมงออนไลน์ — ข้อมูลเดิมเป็นสถานะ ณ เวลาเช็ค ไม่สามารถแปลงเป็นชั่วโมงย้อนหลังได้';return;}
    result.innerHTML='<p class="ot-verdict"></p><div class="ot-values"><div><span>ออนไลน์ ≈</span><b>'+duration(d.onlineMs)+'</b></div><div><span>ออฟไลน์ ≈</span><b>'+duration(d.offlineMs)+'</b></div><div><span>ข้อมูลขาดหาย</span><b>'+duration(d.unknownMs)+'</b></div></div><p class="ot-detail"></p>';
    result.querySelector('.ot-verdict').textContent=(input.value===today()?'วันนี้':'วันที่เลือก')+' · '+headline(d)+' — '+total(d);
    result.querySelector('.ot-detail').textContent=(d.closed?'สิ้นสุดวันแล้ว':'วันนี้ยังไม่สิ้นสุด · นับถึงเวลาที่ตรวจได้')+' · ประมาณจากรอบเช็ค 5 นาที; ช่วงห่างเกิน 10 นาทีไม่นับเป็นออนไลน์หรือออฟไลน์'+(d.collectorEnabled?'':' · ปัจจุบันหยุดเก็บข้อมูล')+(d.lastObservedAt?' · เช็คล่าสุด '+new Date(d.lastObservedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}):'');
   }catch(error){if(id===sequence&&target.isConnected)result.textContent='ยังอ่านชั่วโมงไม่ได้: '+error.message;}
  }
  input.onchange=load;load();
 }
 return {mount,fillSummaries,latestRevenue};
})();
