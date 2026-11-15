import test from 'node:test';
import assert from 'node:assert/strict';
import {createFloat32LineEventTable,clipConvexPolygonWithFloat32Events,nodeAndCancelFloat32Ring,nodeFloat32Rings,nodeTaggedFloat32Rings,float32TriangleInteriorsOverlap} from '../../assets/geometry/float32-line-events.mjs';

test('reversed and differently sized collinear Float32 segments share one exact line identity',()=>{
 const table=createFloat32LineEventTable(),a=table.add([0,.5],[1,.5]),b=table.add([.75,.5],[.25,.5]);
 assert.equal(a,b);assert.equal(table.stats.lineCount,1);
 const vertical=table.add([.375,0],[.375,1]);
 assert.deepEqual(table.intersect(a,vertical),[.375,.5]);
 assert.equal(table.intersect(vertical,b),table.intersect(a,vertical));
 assert.deepEqual(table.stats,{lineCount:2,eventCount:1});
});
test('oblique intersections are independent of line order and remain stable after translation',()=>{
 const table=createFloat32LineEventTable(),rising=table.add([60,-4],[64,0]),falling=table.add([60,0],[64,-4]);
 assert.deepEqual(table.intersect(rising,falling),[62,-2]);
 assert.deepEqual(table.intersect(falling,rising),[62,-2]);
 assert.equal(table.stats.eventCount,1);
});

test('parallel lines have no event and collapsed or over-budget lines reject',()=>{
 const table=createFloat32LineEventTable({maxLines:2,maxEvents:1}),a=table.add([0,0],[1,0]),parallel=table.add([0,1],[1,1]);
 assert.equal(table.intersect(a,parallel),null);
 assert.throws(()=>table.add([0,0],[0,1]),/maxLines/);
 assert.throws(()=>createFloat32LineEventTable().add([65536,65536],[65536.001,65536]),/collapses/);
 const budget=createFloat32LineEventTable({maxEvents:1}),h=budget.add([0,0],[1,0]),v=budget.add([0,0],[0,1]);
 budget.intersect(h,v);const other=budget.add([0,1],[1,1]);assert.throws(()=>budget.intersect(v,other),/maxEvents/);
});

test('exact Float32 triangle predicate detects sub-micro positive overlaps and allows shared boundaries',()=>{
 const a=[[0,0],[1,0],[0,1]],near=1-2**-22,b=[[Math.fround(near),0],[2,0],[2,1]],adjacent=[[1,0],[2,0],[1,1]],contained=[[.125,.125],[.25,.125],[.125,.25]].map(p=>p.map(Math.fround)),boundaryContained=[[.5,0],[0,.5],[.5,.5]];
 assert.ok(float32TriangleInteriorsOverlap(a,b),'positive overlap must not be hidden by a whole-domain area tolerance');
 assert.equal(float32TriangleInteriorsOverlap(a,adjacent),false,'an exact shared edge has zero positive area');
 assert.equal(float32TriangleInteriorsOverlap(a,contained),true);
 assert.equal(float32TriangleInteriorsOverlap(a,boundaryContained),true,'the centroid detects positive area even when all inner vertices lie on the boundary');
 assert.throws(()=>float32TriangleInteriorsOverlap([[0,0],[1.00000001,0],[0,1]],a),/Float32-represented/);
});

test('convex polygon clipping preserves support identity through reversed and rotated rings',()=>{
 const subject=[[-1,-1],[2,-1],[2,2],[-1,2]],boundary=[[0,0],[2,0],[0,2]];
 const variants=[];
 for(const s of [subject,[...subject].reverse(),[...subject.slice(2),...subject.slice(0,2)]])for(const b of [boundary,[...boundary].reverse(),[...boundary.slice(1),boundary[0]]])variants.push(clipConvexPolygonWithFloat32Events(s,b,createFloat32LineEventTable()).map(p=>p.map(v=>Object.is(v,-0)?0:v)));
 const canonical=ring=>ring.map(p=>p.join(',')).sort();
 for(const ring of variants){assert.equal(ring.length,3);assert.deepEqual(canonical(ring),['0,0','0,2','2,0']);}
});

test('convex polygon clipping keeps collinear boundary vertices and containment semantics',()=>{
 const table=createFloat32LineEventTable();
 const contained=clipConvexPolygonWithFloat32Events([[.25,.25],[.75,.25],[.75,.75],[.25,.75]],[[0,0],[1,0],[1,1],[0,1]],table);
 const edgeTouch=clipConvexPolygonWithFloat32Events([[0,0],[1,0],[1,1],[0,1]],[[1,0],[2,0],[2,1],[1,1]],table);
 assert.equal(contained.length,4);assert.equal(edgeTouch.length,0);
});

test('Float32 ring noding cancels a quantization-created zero-area backtrack without area loss',()=>{
 const ring=[[62.9832878112793,10.792468070983887],[63,10.500001907348633],[63,10.5],[63,10.767999649047852]],area=points=>points.slice(1,-1).reduce((sum,p,i)=>sum+(points[0][0]*p[1]-p[0]*points[0][1]+p[0]*points[i+2][1]-points[i+2][0]*p[1]+points[i+2][0]*points[0][1]-points[0][0]*points[i+2][1])/2,0);
 const output=nodeAndCancelFloat32Ring(ring,createFloat32LineEventTable());
 assert.equal(output.length,1);assert.equal(output[0].length,3);assert.ok(Math.abs(area(output[0])-area(ring))<1e-12);
 assert.deepEqual(output[0].map(p=>p.join(',')),['62.9832878112793,10.792468070983887','63,10.500001907348633','63,10.767999649047852']);
});

test('neighboring Float32 rings receive the same shared-edge subdivisions',()=>{
 const left=[[0,0],[1,0],[1,2],[0,2]],right=[[1,0],[2,0],[2,2],[1,2],[1,1]],noded=nodeFloat32Rings([left,right],createFloat32LineEventTable());
 assert.deepEqual(noded[0],[[0,0],[1,0],[1,1],[1,2],[0,2]]);
 assert.deepEqual(noded[1],[[1,0],[2,0],[2,2],[1,2],[1,1]]);
});

test('shared support provenance nodes a pre-quantized T junction before Float32 rounding',()=>{
 const support={key:'shared-diagonal'},a=[-1000,.1],b=[-999,1.1],t=.37,f=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
 assert.notEqual((b[0]-a[0])*(Math.fround(f[1])-Math.fround(a[1]))-(b[1]-a[1])*(Math.fround(f[0])-Math.fround(a[0])),0,'fixture must move the T vertex off the represented long edge');
 const noded=nodeTaggedFloat32Rings([
  {points:[a,b,[b[0]+1,b[1]],[a[0]+1,a[1]]],edgeLines:[support,{key:'long:1'},{key:'long:2'},{key:'long:3'}]},
  {points:[a,[a[0]-1,a[1]-1],[f[0]-1,f[1]-1],f],edgeLines:[{key:'short:1'},{key:'short:2'},{key:'short:3'},support]},
 ]),long=noded[0].points.map(p=>p.map(Math.fround)),short=noded[1].points.map(p=>p.map(Math.fround));
 assert.deepEqual(long.slice(0,3),[a,f,b].map(p=>p.map(Math.fround)));
 assert.deepEqual([short.at(-1),short[0]],long.slice(0,2).reverse());
});
