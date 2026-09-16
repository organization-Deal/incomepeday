// Read-only providers; local ignored ledger only. No deployment or production writes.
import fs from 'node:fs';
import {CemSessionCore} from '../src/cem-session-core.js';
import {readCemStatuses} from '../src/cem.js';
import {eqlinkConfig,readEqlinkStatuses} from '../src/eqlink.js';
import {OnlineTimeCore} from '../src/online-time.js';
process.loadEnvFile('.dev.vars');
const file='.local-data/online-time.json';fs.mkdirSync('.local-data',{recursive:true,mode:0o700});
const map=new Map(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[]);
const storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),transaction:async fn=>{const before=structuredClone([...map]);try{const r=await fn(storage);fs.writeFileSync(file+'.tmp',JSON.stringify([...map]),{mode:0o600});fs.renameSync(file+'.tmp',file);return r;}catch(e){map.clear();for(const [k,v]of before)map.set(k,v);throw e;}}};
const ledger=new OnlineTimeCore(storage),session=new Map();
const core=new CemSessionCore({get:async k=>session.get(k),put:async(k,v)=>{session.set(k,v);fs.writeFileSync('.dev.vars',fs.readFileSync('.dev.vars','utf8').replace(/^CEM_REFRESH_TOKEN=.*$/m,()=> 'CEM_REFRESH_TOKEN='+JSON.stringify(v.refresh)),{mode:0o600});}},process.env);
try{
 const config=await core.run(async c=>c);const samples=[];
 for(let b=0;b<Math.ceil(config.mapping.length/5);b++){
  const part=await core.statusBatch(b);await ledger.record(part);samples.push(...part);
  if((b+1)%5===0)console.log(JSON.stringify({cemChecked:samples.length}));
 }
 for(let i=0;i<samples.length;i++)if(samples[i].sourceHistoryError){
  const m=config.mapping.find(m=>m.code===samples[i].code);
  const retry=await core.run((c,bearer,deadline)=>readCemStatuses({...c,mapping:[m]},0,bearer,deadline));await ledger.record(retry);samples[i]=retry[0];
 }
 const eq=await readEqlinkStatuses(eqlinkConfig(process.env));await ledger.record(eq);
 const histories=samples.filter(s=>s.sourceHistory);
 console.log(JSON.stringify({cem:samples.length,cemHistory:histories.length,cemBothTimes:histories.filter(s=>s.sourceHistory.latestOnlineAt!==null&&s.sourceHistory.latestOfflineAt!==null).length,cemIncomplete:histories.filter(s=>!s.sourceHistory.complete).length,cemFailed:samples.filter(s=>!s.sourceHistory).length,eqObserved:eq.length,eqSourceHistoryVerified:false}));
}catch{console.error('Status sync incomplete; successful records retained locally. No provider credentials printed.');process.exitCode=1;}
