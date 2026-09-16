import {test} from 'node:test';import assert from 'node:assert/strict';import {latestCemEvents} from '../src/source-status.js';
test('provider history selects latest transition of each state, retaining original UTC timestamps',()=>{
 const rows=[['ONLINE','2026-09-16T11:00:39.373257Z'],['OFFLINE','2026-09-15T15:30:18.618009Z'],['ONLINE','2026-09-15T11:34:47Z']];
 const r=latestCemEvents({result:rows.map(([state,record_at])=>({state,record_at})),pagination:{total_page:1}},Date.parse('2026-09-17T00:00:00Z'));
 assert.equal(r.latestOnlineAt,Date.parse(rows[0][1]));assert.equal(r.latestOfflineAt,Date.parse(rows[1][1]));
});
test('source history rejects missing timezone, reversed order and malformed pages',()=>{
 assert.throws(()=>latestCemEvents({result:[{state:'ONLINE',record_at:'2026-09-16 12:00:00'}],pagination:{total_page:1}}));
 assert.throws(()=>latestCemEvents({result:[],pagination:{}}));
 const result=[{state:'OFFLINE',record_at:'2026-09-14T00:00:00Z'},{state:'ONLINE',record_at:'2026-09-15T00:00:00Z'}];assert.throws(()=>latestCemEvents({result,pagination:{total_page:1}}));
});
