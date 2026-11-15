import test from 'node:test';
import assert from 'node:assert/strict';
import {triangulateFloat32Ring} from '../../assets/geometry/float32-triangulation.mjs';

const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=ring=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
function outputArea(points,triangles){return triangles.reduce((sum,[a,b,c])=>sum+cross(points[a],points[b],points[c])/2,0);}

test('triangulates a simple concave Float32 polygon with deterministic positive faces and conserved signed area',()=>{
 const ring=[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]],result=triangulateFloat32Ring(ring);
 assert.equal(result.triangles.length,ring.length-2);assert.ok(result.triangles.every(([a,b,c])=>cross(result.points[a],result.points[b],result.points[c])>0));
 assert.ok(Math.abs(outputArea(result.points,result.triangles)-area(result.points))<1e-12);assert.deepEqual(result,triangulateFloat32Ring(ring));
});

test('keeps collinear boundary vertices so neighboring constrained cells can share every edge subdivision',()=>{
 const ring=[[0,0],[2,0],[4,0],[4,4],[2,4],[0,4],[0,2]],result=triangulateFloat32Ring(ring),used=new Set(result.triangles.flat());
 assert.equal(result.triangles.length,ring.length-2);assert.equal(used.size,ring.length);assert.deepEqual(result.points,ring);
 assert.equal(outputArea(result.points,result.triangles),area(result.points));
});

test('rounds coordinates once to represented Float32 values and reports the represented polygon area',()=>{
 const source=[[.1,.1],[2.1,.1],[2.1,2.1],[.1,2.1]],result=triangulateFloat32Ring(source);
 assert.deepEqual(result.points,source.map(([x,y])=>[Math.fround(x),Math.fround(y)]));assert.ok(Math.abs(result.area-area(result.points))<1e-12);
});

test('rejects Float32-collapsed vertices, repeated vertices, self-crossing rings and zero-area output',()=>{
 assert.throws(()=>triangulateFloat32Ring([[1,0],[1+1e-9,0],[2,1],[1,1]]),/collapsed|degenerate/i);
 assert.throws(()=>triangulateFloat32Ring([[0,0],[2,0],[2,2],[0,0],[0,2]]),/duplicate/i);
 assert.throws(()=>triangulateFloat32Ring([[0,0],[3,3],[0,3],[2,0]]),/self-intersect|simple/i);
 assert.throws(()=>triangulateFloat32Ring([[0,0],[1,0],[2,0]]),/area|degenerate/i);
});

test('rejects work before unbounded ear searches and fails clearly when Float32 topology has no simple ear',()=>{
 assert.throws(()=>triangulateFloat32Ring([[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]],{maxWorkUnits:1}),/maxWorkUnits/i);
 assert.throws(()=>triangulateFloat32Ring([[0,0],[1,1],[0,0],[2,0]]),/duplicate/i);
});
