import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {CemSessionCore} from '../src/cem-session-core.js';
const realFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=realFetch;});
const env={CEM_REFRESH_TOKEN:'seed-refresh',CEM_MAPPING:'[{"code":"LO_0001","branch":10,"device":100}]'};
const jwt=n=>'header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+900,n})).toString('base64url')+'.signature';
function storage(){const map=new Map();return {get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v))};}
test('one coordinated refresh serves concurrent reads and survives object eviction',async()=>{
  const store=storage(),core=new CemSessionCore(store,env);let refreshes=0,active=0,peak=0;const bearer=jwt(1);
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://cem.t-dev.app/api/authenticate/refresh_token');
    refreshes++;return new Response(JSON.stringify({bearer,refresh_token:'rotated-'+refreshes}));
  };
  const read=async(config,bearer)=>{active++;peak=Math.max(peak,active);assert.equal(bearer,(await store.get('session')).bearer);
    await new Promise(resolve=>setTimeout(resolve,10));active--;return 'ok';};
  assert.deepEqual(await Promise.all([core.run(read),core.run(read),core.run(read)]),['ok','ok','ok']);
  assert.equal(refreshes,1);assert.equal(peak,1);
  await new CemSessionCore(store,env).run(read);assert.equal(refreshes,1);
});
test('rotation uses durable refresh token, persists it and never starts a password login',async()=>{
  const store=storage();await store.put('session',{bearer:'expired',expires:0,refresh:'rotated-previous'});
  globalThis.fetch=async(url,init)=>{
    assert.equal(JSON.parse(init.body).refresh_token,'rotated-previous');
    assert.ok(url.endsWith('/refresh_token'));
    return new Response(JSON.stringify({bearer:jwt(2),refresh_token:'rotated-next'}));
  };
  await new CemSessionCore(store,env).run(async()=>true);
  assert.equal((await store.get('session')).refresh,'rotated-next');
});
test('failed refresh does not overwrite durable state or expose provider messages',async()=>{
  const store=storage(),core=new CemSessionCore(store,env);
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'seed-refresh secret-token'}),{status:401});
  await assert.rejects(core.run(async()=>{throw new Error('must not read');}),e=>!e.message.includes('seed-refresh')&&!e.message.includes('secret-token'));
  assert.equal(await store.get('session'),undefined);
});

test('refresh redirects are rejected without forwarding credentials',async()=>{
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    calls++;assert.equal(init.redirect,'manual');
    return new Response(null,{status:302,headers:{location:'https://example.org/collect'}});
  };
  await assert.rejects(new CemSessionCore(storage(),env).run(async()=>true),/CEM/);
  assert.equal(calls,1);
});

test('background status sampling has a ten-second total budget including token refresh',async()=>{
 const core=new CemSessionCore(storage(),env);let remaining;
 core.accessToken=async(config,deadline)=>{remaining=deadline-Date.now();return 'cached-test';};
 globalThis.fetch=async()=>new Response(JSON.stringify({id:10,qr_box_machine:[{id:100,status:'ONLINE'}]}));
 const values=await core.statusBatch(0);assert.equal(values[0].status,'ONLINE');assert.ok(remaining>0&&remaining<=10000);
});
