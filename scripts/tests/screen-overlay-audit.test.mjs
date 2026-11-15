import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditScreenOverlays} from '../../assets/interaction/screen-overlay-audit.mjs';

const viewport={left:100,top:40,width:800,height:600};
const rect=(left,top,right,bottom)=>({left,top,right,bottom});

test('accepts separated labels fully inside the measured viewport',()=>{
 const result=auditScreenOverlays({viewport,items:[
  {id:'a',rect:rect(120,60,180,90)},
  {id:'b',rect:rect(300,120,380,150)}
 ]});
 assert.equal(result.status,'PASS');assert.equal(result.checked,2);assert.deepEqual(result.violations,[]);
});

test('reports viewport clipping and safe-area overflow in CSS pixels',()=>{
 const result=auditScreenOverlays({viewport,safeInsets:{left:24,top:18,right:24,bottom:18},items:[
  {id:'left',rect:rect(94,50,150,80)},
  {id:'top',rect:rect(200,42,260,72)}
 ]});
 assert.equal(result.status,'FAIL');
 assert.deepEqual(result.violations.filter(x=>x.type==='outside-viewport').map(x=>[x.id,x.overflow.left]),[['left',6]]);
 assert.deepEqual(result.violations.filter(x=>x.type==='outside-safe-area').map(x=>x.id),['left','top']);
});

test('reports actual intersection area for overlapping labels',()=>{
 const result=auditScreenOverlays({viewport,items:[
  {id:'a',rect:rect(120,60,200,100)},
  {id:'b',rect:rect(180,80,240,120)}
 ]});
 assert.deepEqual(result.violations,[{type:'label-overlap',a:'a',b:'b',area:400}]);
});

test('checks labels against reserved title and control rectangles',()=>{
 const result=auditScreenOverlays({viewport,items:[{id:'callout',rect:rect(120,60,200,100)}],reserved:[
  {id:'title',rect:rect(150,80,260,140)}
 ]});
 assert.deepEqual(result.violations,[{type:'reserved-overlap',id:'callout',reservedId:'title',area:1000}]);
});

test('allows only explicitly declared overlaps and leaves all other collisions visible',()=>{
 const result=auditScreenOverlays({viewport,items:[
  {id:'a',rect:rect(120,60,200,100)},
  {id:'b',rect:rect(180,80,240,120)},
  {id:'c',rect:rect(190,90,260,130)}
 ],allowOverlap:[['a','b']]});
 assert.deepEqual(result.violations.map(x=>[x.a,x.b]),[['a','c'],['b','c']]);
});

test('rejects ambiguous IDs and malformed rectangles',()=>{
 assert.throws(()=>auditScreenOverlays({viewport,items:[{id:'x',rect:rect(0,0,1,1)},{id:'x',rect:rect(2,2,3,3)}]}),/unique/i);
 assert.throws(()=>auditScreenOverlays({viewport,items:[{id:'bad',rect:rect(4,4,4,9)}]}),/positive/i);
});
