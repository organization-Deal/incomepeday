import {test} from 'node:test';import assert from 'node:assert/strict';
import {DailyNotesCore,validateDailyNote} from '../src/daily-notes.js';
const note={id:'00000000-0000-4000-8000-000000000001',date:'2026-09-16',by:'Team',text:'Check machine'};
function store(){const map=new Map();const s={get:async k=>map.get(k),put:async values=>Object.entries(values).forEach(([k,v])=>map.set(k,v)),transaction:async fn=>fn(s),list:async({prefix,limit,end})=>new Map([...map].filter(([k])=>k.startsWith(prefix)&&(!end||k<end)).sort(([a],[b])=>b.localeCompare(a)).slice(0,limit))};return s;}
test('daily notes persist and idempotent retries cannot create or change duplicate notes',async()=>{
 const s=store(),core=new DailyNotesCore(s);await core.save(note);await core.save(note);
 const result=await new DailyNotesCore(s).list('2026-09-16');assert.equal(result.notes.length,1);assert.equal(result.notes[0].text,note.text);
 await assert.rejects(core.save({...note,text:'changed'}),e=>e.status===409);
 assert.equal((await core.list('2026-09-15')).notes.length,0);
});
test('daily notes validate real dates, body length, author and retry identity',()=>{
 for(const patch of [{date:'2026-02-30'},{text:''},{text:'x'.repeat(3001)},{by:''},{id:'bad'}])assert.throws(()=>validateDailyNote({...note,...patch}));
});

test('daily notes endpoint isolates machines, rejects cross-origin writes and uses trusted author',async()=>{
 const {handleDailyNotes}=await import('../src/daily-notes.js');const machines=new Map();
 const env={DAILY_NOTES:{getByName:code=>{if(!machines.has(code))machines.set(code,new DailyNotesCore(store()));return machines.get(code);}}};
 const send=(code,origin='https://dashboard.test')=>handleDailyNotes(new Request('https://dashboard.test/api/daily-notes',{method:'POST',headers:{'content-type':'application/json',origin,'Cf-Access-Authenticated-User-Email':'trusted@example.test'},body:JSON.stringify({...note,code})}),env);
 await send('CEM_ABCDEF123456');await assert.rejects(send('CEM_ABCDEF123456','https://other.test'),e=>e.status===403);
 const first=await(await handleDailyNotes(new Request('https://dashboard.test/api/daily-notes?code=CEM_ABCDEF123456&date=2026-09-16'),env)).json();
 const second=await(await handleDailyNotes(new Request('https://dashboard.test/api/daily-notes?code=LO_0001&date=2026-09-16'),env)).json();
 assert.equal(first.data.notes[0].by,'trusted@example.test');assert.equal(second.data.notes.length,0);
});
