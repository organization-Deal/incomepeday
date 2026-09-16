// Authorized read-only inventory sync. Writes only ignored local .dev.vars.
import fs from 'node:fs';
import {requestJson} from '../src/http.js';
import {CemSessionCore} from '../src/cem-session-core.js';
import {eqlinkConfig,eqlinkInventory} from '../src/eqlink.js';
import {cemInventory,fleetMapping,readMapping,mappingSecrets} from '../src/fleet.js';
const path=new URL('../.dev.vars',import.meta.url);
let stage='session';
try{
 process.loadEnvFile(path);const env=process.env,stored=new Map();
 const core=new CemSessionCore({get:async k=>stored.get(k),put:async(k,v)=>{stored.set(k,v);const content=fs.readFileSync(path,'utf8').replace(/^CEM_REFRESH_TOKEN=.*$/m,()=> 'CEM_REFRESH_TOKEN='+JSON.stringify(v.refresh));fs.writeFileSync(path,content,{mode:0o600});}},env);
 const cem=await core.run(async(config,bearer)=>{stage='CEM inventory';return cemInventory(p=>requestJson('https://cem.t-dev.app'+p,
  {redirect:'manual',headers:{Authorization:'Bearer '+bearer}},{timeout:12000}));});
 stage='EQLink inventory';
 const eq=await eqlinkInventory(eqlinkConfig(env));
 const mapping=await fleetMapping('CEM',cem.machines,readMapping(env,'CEM_MAPPING'));
 const eqMapping=await fleetMapping('EQ',eq,readMapping(env,'EQLINK_MAPPING'));
 let content=fs.readFileSync(path,'utf8').replace(/^(?:CEM|EQLINK)_MAPPING(?:_\d+)?=.*\n?/gm,'');
 for(const [key,value] of Object.entries({...mappingSecrets('CEM_MAPPING',mapping),...mappingSecrets('EQLINK_MAPPING',eqMapping),CEM_REFRESH_TOKEN:stored.get('session').refresh})){
  const line=key+'='+ (key.includes('_MAPPING')?"'"+value.replaceAll("'",'\\u0027')+"'":JSON.stringify(value)),re=new RegExp('^'+key+'=.*$','m');
  content=re.test(content)?content.replace(re,()=>line):content+'\n'+line+'\n';
 }
 fs.writeFileSync(path,content,{mode:0o600});fs.chmodSync(path,0o600);
 console.log(JSON.stringify({cemBranches:cem.branches,cemMachines:mapping.length,cemRevenueSupported:mapping.filter(m=>!m.unavailable).length,eqMachines:eqMapping.length,total:mapping.length+eqMapping.length}));
}catch(error){console.error('Fleet sync failed at '+stage+' ('+(['Incomplete CEM inventory','Duplicate CEM branch','Invalid CEM branch','Invalid CEM machine','Duplicate fleet device'].includes(error.message)?error.message:error.name)+'); local mapping was not replaced. Check session and complete inventory.');process.exitCode=1;}
