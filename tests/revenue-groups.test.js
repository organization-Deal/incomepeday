import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../public/revenue-groups.js';
const {classify,windowDays}=globalThis.DealRevenueGroups;
const now='2026-09-16T09:00:00Z';
const cells=values=>Object.fromEntries(['13/09','14/09','15/09'].map((d,i)=>[d,{d:values[i],closed:true}]));
test('four categories are exclusive and use three closed Bangkok days',()=>{
 assert.deepEqual(windowDays(now),['2026-09-13','2026-09-14','2026-09-15']);
 for(const [status,values,want] of [['OFFLINE',[0,0,0],'offline-zero'],['OFFLINE',[0,10,0],'offline-money'],['ONLINE',[0,0,0],'online-zero'],['ONLINE',[0,0,10],'online-money']]){
  assert.equal(classify({month:'09-2026',status,daily:cells(values),asOf:now}),want);
 }
});
test('missing, negative, partial, foreign and unknown-status data never mean no revenue',()=>{
 for(const values of [[0,null,0],[0,undefined,0],[0,-1,0]])assert.equal(classify({month:'09-2026',status:'OFFLINE',daily:cells(values),asOf:now}),'unknown');
 const daily=cells([0,0,0]);daily['15/09'].closed=false;
 assert.equal(classify({month:'09-2026',status:'ONLINE',daily,asOf:now}),'unknown');
 assert.equal(classify({month:'09-2026',status:'UNKNOWN',daily:cells([1,1,1]),asOf:now}),'unknown');
 assert.equal(classify({month:'09-2026',status:'ONLINE',daily:cells([0,0,0]),unavailable:true,asOf:now}),'unknown');
});
test('today is excluded and month boundaries require actual preceding-month data',()=>{
 const daily=cells([0,0,0]);daily['16/09']={d:999,closed:false};
 assert.equal(classify({month:'09-2026',status:'ONLINE',daily,asOf:now}),'online-zero');
 assert.deepEqual(windowDays('2026-09-30T18:00:00Z'),['2026-09-28','2026-09-29','2026-09-30']);
 assert.equal(classify({month:'10-2026',status:'ONLINE',daily:{},asOf:'2026-09-30T18:00:00Z'}),'unknown');
 assert.equal(classify({month:'08-2026',status:'ONLINE',daily:cells([0,0,0]),asOf:now}),'unknown');
});
