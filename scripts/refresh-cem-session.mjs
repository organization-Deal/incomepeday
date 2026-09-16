// Run locally after an authorized CEM login renewal. Never prints tokens.
import fs from 'node:fs';
import { requestJson } from '../src/http.js';
try {
  const path=new URL('../.dev.vars',import.meta.url);
  process.loadEnvFile(path);
  if(!process.env.CEM_USERNAME||!process.env.CEM_PASSWORD)throw new Error();
  const session=await requestJson('https://cem.t-dev.app/api/authenticate/login',{
    method:'POST',redirect:'manual',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:process.env.CEM_USERNAME,password:process.env.CEM_PASSWORD}),
  },{timeout:15000});
  if(typeof session?.refresh_token!=='string'||!session.refresh_token||
    !/^[A-Za-z0-9._-]+$/.test(session.refresh_token))throw new Error();
  let content=fs.readFileSync(path,'utf8');
  const line='CEM_REFRESH_TOKEN='+JSON.stringify(session.refresh_token);
  content=/^CEM_REFRESH_TOKEN=.*$/m.test(content)?content.replace(/^CEM_REFRESH_TOKEN=.*$/m,()=>line):content+'\n'+line+'\n';
  fs.writeFileSync(path,content,{mode:0o600});fs.chmodSync(path,0o600);
  console.log('Updated CEM_REFRESH_TOKEN in ignored .dev.vars. Production secret is unchanged.');
} catch {
  console.error('CEM session renewal failed. Check local credentials and available login slots; no automatic retry.');
  process.exitCode=1;
}
