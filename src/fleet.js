// Stable display identities are hashes, never credentials or machine command IDs.
export async function fleetCode(provider,device){
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(provider+':'+device));
 return provider+'_'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('').slice(0,12).toUpperCase();
}
export async function fleetMapping(provider,inventory,previous){
 const seen=new Set();
 return Promise.all(inventory.map(async row=>{
  if(seen.has(row.device))throw new Error('Duplicate fleet device');seen.add(row.device);
  const known=previous.find(m=>m.device===row.device&&(provider!=='CEM'||m.branch===row.branch));
  return {...row,code:known?.code||await fleetCode(provider,row.device),append:true};
 }));
}
export async function cemInventory(call){
 // CEM pages overlap under its default unstable ordering. Request one bounded snapshot.
 const data=await call('/api/restrict/machine/qrbox/branch_by_customer?page=1&limit=500');
 const total=data.total_record,branches=data.details;
 if(!Number.isInteger(total)||total<1||total>500||data.total_page!==1||data.page!==1||
   !Array.isArray(branches)||branches.length!==total)throw new Error('Incomplete CEM inventory');
 if(new Set(branches.map(b=>b.id)).size!==total)throw new Error('Duplicate CEM branch');
 const result=[];
 // Local inventory refresh only: concurrency two, bounded calls, no writes to machines.
 for(let i=0;i<branches.length;i+=2){
  const groups=await Promise.all(branches.slice(i,i+2).map(async branch=>{
   const info=await call('/api/restrict/machine/qrbox/branch_info?id='+branch.id);
   if(info.id!==branch.id||(info.qr_box_machine!==null&&!Array.isArray(info.qr_box_machine)))throw new Error('Invalid CEM branch');
   if(info.qr_box_machine===null)return [];
   return info.qr_box_machine.map(machine=>{
    if(!Number.isSafeInteger(machine.id)||machine.id<=0)throw new Error('Invalid CEM machine');
    return {branch:branch.id,device:machine.id,name:String(branch.name||machine.name||'CEM').slice(0,200),
     currency:String(machine.currency_type||info.currency_type||'UNKNOWN'),
     unavailable:info.qr_box_machine.length!==1?'รายงานรวมหลายตู้ในสาขา':
      info.currency_type!=='THB'||machine.currency_type!=='THB'?'สกุลเงินสาขา '+String(info.currency_type||'UNKNOWN')+' / ตู้ '+String(machine.currency_type||'UNKNOWN'):
      info.is_time_close!==false||machine.is_time_to_close!==false?'รอบปิดยอดพิเศษ':''};
   });
  }));result.push(...groups.flat());
 }
 if(result.length>500)throw new Error('CEM fleet exceeds configured limit');
 return {branches:total,machines:result};
}

// Each Worker secret is limited to 5 KB; use ordered, independently valid JSON chunks.
export function readMapping(env,key){
 const keys=Object.keys(env).filter(k=>k===key||new RegExp('^'+key+'_\\d+$').test(k))
  .sort((a,b)=>(a===key?1:Number(a.slice(key.length+1)))-(b===key?1:Number(b.slice(key.length+1))));
 if(!keys.length||keys.length>24)throw new Error('Invalid mapping chunks');
 return keys.flatMap((k,i)=>{
  if(k!==(i===0?key:key+'_'+(i+1)))throw new Error('Missing mapping chunk');
  const rows=JSON.parse(env[k]);if(!Array.isArray(rows))throw new Error('Invalid mapping chunk');return rows;
 });
}
export function mappingSecrets(key,mapping){
 const chunks=[[]],size=v=>new TextEncoder().encode(JSON.stringify(v)).length;
 for(const item of mapping){
  if(size([item])>4000)throw new Error('Mapping item too large');
  if(size([...chunks.at(-1),item])>4000)chunks.push([]);
  chunks.at(-1).push(item);
 }
 if(chunks.length>24)throw new Error('Mapping exceeds secret budget');
 return Object.fromEntries(chunks.map((rows,i)=>[i?key+'_'+(i+1):key,JSON.stringify(rows)]));
}
