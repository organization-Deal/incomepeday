globalThis.Workspace=(()=>{
 const titles={'offline-zero':'ออฟไลน์ · ไม่มียอดเงิน 3 วัน','offline-money':'ออฟไลน์ · มียอดเงิน 3 วัน','online-zero':'ออนไลน์ · ไม่มียอดเกิน 2 วัน','online-money':'ออนไลน์ · มียอดเงิน 3 วัน',unknown:'ตู้ที่ข้อมูลยังไม่ครบ','':'ตู้ทั้งหมด · บันทึกงานรายวัน'};
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 let api,dialog,group='',selected=null,sequence=0,cursor=null,returnFocus=null;
 const drafts=new Map();const $=id=>dialog.querySelector('#'+id);
 const key=()=>selected?.code+':'+$('fp-date')?.value;
 function remember(){if(!selected||!$('fp-text'))return;const k=key(),prior=drafts.get(k);drafts.set(k,{text:$('fp-text').value,by:$('fp-author').value,id:prior?.id||crypto.randomUUID()});}
 function init(options){
  api=options;dialog=document.createElement('dialog');dialog.id='fleet-popup';dialog.className='fleet-popup';dialog.setAttribute('aria-labelledby','fp-title');
  dialog.innerHTML='<header class="fp-header"><div><h2 id="fp-title"></h2><p id="fp-caption"></p></div><button class="fp-close" id="fp-close" aria-label="ปิดหน้าต่าง">×</button></header><div class="fp-body"><section class="fp-browser" aria-label="รายชื่อตู้"><div class="fp-search"><label for="fp-search">ค้นหาสถานที่หรือรหัสตู้</label><input id="fp-search" placeholder="ค้นหาสถานที่ / รหัสตู้…" type="search"></div><div class="fp-list" id="fp-list"></div><div class="fp-list-footer"><span id="fp-count"></span><button class="gbtn" id="fp-table">ดูในตาราง</button></div></section><section class="fp-editor" id="fp-editor" aria-label="บันทึกงานรายวัน"></section></div>';
  document.body.append(dialog);$('fp-close').onclick=()=>dialog.close();dialog.addEventListener('cancel',remember);dialog.addEventListener('close',()=>{remember();sequence++;returnFocus?.focus();});
  $('fp-search').oninput=renderList;$('fp-table').onclick=()=>{dialog.close();api.onTable(group);};
  $('fp-list').onclick=e=>{const button=e.target.closest('[data-machine]');if(button)select(button.dataset.machine);};
 }
 function rows(){return (api.getData()?.rows||[]).filter(r=>!group||api.getGroups()[r.code]===group);}
 function renderList(){
  const query=$('fp-search').value.trim().toLowerCase(),all=rows(),list=all.filter(r=>(r.name+' '+r.code).toLowerCase().includes(query));
  $('fp-count').textContent=list.length+' / '+all.length+' ตู้';
  $('fp-list').innerHTML=list.length?list.map(r=>{
   const metric=api.getMetrics()[r.code],status=metric?.last?.s||'UNKNOWN';
   const dates=DealRevenueGroups.windowDays(api.getData().updated);
   const values=dates.map(d=>r.daily?.[d.slice(8,10)+'/'+d.slice(5,7)]?.d);
   const amount=!r.revenueUnavailable&&values.every(v=>typeof v==='number')?values.reduce((a,b)=>a+b,0).toLocaleString('th-TH')+' บาท':'ยังยืนยันยอดไม่ได้';
   const latest=DealOnlineTime.latestRevenue(r),revenue=latest?' data-last-revenue-cents="'+latest.amountCents+'" data-last-revenue-date="'+latest.date+'"':'';
   return '<button class="fp-machine" data-machine="'+escape(r.code)+'" aria-pressed="'+(r.code===selected?.code)+'"><b>'+escape(r.name||r.code)+'</b><small>'+escape(r.code)+' · '+escape(r.revenueSource?.toUpperCase()||'ทะเบียนเดิม')+'</small><span class="online-summary" data-online-summary="'+escape(r.code)+'"'+revenue+'>วันนี้ · กำลังอ่านเวลาสะสม…</span><span>ณ ตอนเช็ค: '+escape(status)+' · 3 วัน '+amount+'</span></button>';
  }).join(''):'<div class="fp-empty"><b>ไม่พบตู้</b>ลองเปลี่ยนคำค้นหรือเลือกหมวดอื่น</div>';
  DealOnlineTime.fillSummaries($('fp-list'));
 }
 function openGroup(value){
  if(!api.getData())return;
  remember();group=value;selected=null;sequence++;
  returnFocus=document.activeElement;$('fp-title').textContent=titles[value]||titles[''];
  $('fp-caption').textContent='เลือกสถานที่เพื่อดูรายละเอียดและบันทึกสิ่งที่ต้องติดตาม';$('fp-search').value='';
  $('fp-editor').innerHTML='<div class="fp-empty"><b>เลือกตู้ที่ต้องการติดตาม</b>ค้นหาหรือกดชื่อสถานที่ทางซ้าย<br>บันทึกโน้ตแยกตามตู้และวันที่ได้ที่นี่</div>';
  renderList();if(!dialog.open)dialog.showModal();$('fp-search').focus();
 }
 function select(code){
  remember();selected=api.getData().rows.find(r=>r.code===code);if(!selected)return;sequence++;
  const date=today();$('fp-editor').innerHTML='<div class="fp-machine-head"><div><h3>'+escape(selected.name||code)+'</h3><p>'+escape(code)+' · บันทึกงานรายวัน</p></div><button class="gbtn" id="fp-detail">รายละเอียด ↗</button></div><div class="online-time" id="fp-online-time"></div><form id="fp-form"><div class="fp-form-grid"><div><label for="fp-date">วันที่ของโน้ต</label><input id="fp-date" type="date" required value="'+date+'"></div><div><label for="fp-author">ผู้บันทึก</label><input id="fp-author" required maxlength="100" autocomplete="name" placeholder="ชื่อของคุณ"></div></div><label for="fp-text">รายละเอียด / สิ่งที่ต้องติดตาม</label><textarea id="fp-text" required maxlength="3000" placeholder="เช่น ติดต่อร้านแล้ว นัดช่างเข้าตรวจพรุ่งนี้…"></textarea><div class="fp-save-row"><span class="fp-message" id="fp-message" role="status" aria-live="polite"></span><button type="submit" class="fp-primary" id="fp-save">บันทึกโน้ต</button></div></form><div class="fp-history"><h4>บันทึกของวันที่เลือก</h4><div id="fp-history"></div><button class="gbtn" id="fp-more" hidden>โหลดเพิ่ม</button></div>';
  DealOnlineTime.mount($('fp-online-time'),code);
  let previousDate=date;
  $('fp-date').onchange=()=>{const newDate=$('fp-date').value;$('fp-date').value=previousDate;remember();$('fp-date').value=newDate;previousDate=newDate;restore();load();};
  $('fp-text').oninput=()=>{const prior=drafts.get(key());if(prior)prior.id=crypto.randomUUID();remember();};
  $('fp-author').oninput=$('fp-text').oninput;
  $('fp-form').onsubmit=save;$('fp-detail').onclick=()=>{const id=selected.code;dialog.close();api.onDetails(id);};
  $('fp-more').onclick=()=>load(true);restore();renderList();load();
 }
 function restore(){const draft=drafts.get(key());let author='';try{author=localStorage.dealWho||'';}catch{}
  $('fp-text').value=draft?.text||'';$('fp-author').value=draft?.by||author;$('fp-message').textContent='';}
 async function load(more=false){
  const id=++sequence,code=selected.code,date=$('fp-date').value,target=$('fp-history');target.classList.remove('fp-error');if(!more){target.textContent='กำลังโหลดบันทึก…';cursor=null;}$('fp-more').hidden=true;
  try{
   const result=await DealApi.request('/api/daily-notes?'+new URLSearchParams({code,date,...(more&&cursor?{cursor}:{})}));
   if(id!==sequence||!dialog.open)return;
   const data=result.data;if(!Array.isArray(data?.notes))throw new Error('รูปแบบบันทึกไม่ถูกต้อง');
   const html=data.notes.map(n=>'<article class="fp-entry"><p>'+escape(n.text)+'</p><small>'+escape(n.by)+' · '+escape(new Date(n.at).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}))+'</small></article>').join('');
   if(more)target.insertAdjacentHTML('beforeend',html);else target.innerHTML=html||'<p class="muted">ยังไม่มีโน้ตในวันนี้ เริ่มบันทึกได้ด้านบน</p>';
   cursor=data.nextCursor;$('fp-more').hidden=!cursor;
   $('fp-message').textContent=data.storage==='local'?'Preview: บันทึกเฉพาะเครื่องนี้ ยังไม่แชร์ให้ทีม':'บันทึกนี้แชร์ให้ทีมในระบบ';
  }catch(error){if(id===sequence&&dialog.open){target.textContent='โหลดบันทึกไม่สำเร็จ: '+error.message;target.classList.add('fp-error');}}
 }
 async function save(event){
  event.preventDefault();remember();const draftKey=key(),draft={...drafts.get(draftKey)},code=selected.code,date=$('fp-date').value,button=$('fp-save'),message=$('fp-message');
  if(!draft.text.trim()||!draft.by.trim())return;
  button.disabled=true;message.textContent='กำลังบันทึก…';
  try{
   const result=await DealApi.request('/api/daily-notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,date,...draft})});
   if(!result.data?.saved)throw new Error('ยังยืนยันการบันทึกไม่ได้');
   const unchanged=drafts.get(draftKey)?.id===draft.id;
   if(unchanged)drafts.delete(draftKey);
   if(unchanged&&key()===draftKey&&$('fp-text')?.value===draft.text)$('fp-text').value='';
   try{localStorage.dealWho=draft.by;}catch{}
   if(dialog.open&&key()===draftKey&&$('fp-save')===button){if($('fp-text').value===draft.text)$('fp-text').value='';await load();message.textContent=result.data.storage==='local'?'บันทึกแล้ว · เฉพาะ preview เครื่องนี้':'บันทึกแล้ว · แชร์ให้ทีมเรียบร้อย';}
  }catch(error){if($('fp-message')===message)message.textContent='บันทึกไม่สำเร็จ: '+error.message+' — กดบันทึกอีกครั้งได้โดยไม่สร้างซ้ำ';}
  finally{button.disabled=false;}
 }
 return {init,openGroup,openMachine:code=>{openGroup('');select(code);}};
})();
