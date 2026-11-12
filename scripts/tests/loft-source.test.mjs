import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSectionLoftGeometry} from '../../assets/geometry/section-loft.mjs';

const T = await import(process.env.THREE_MODULE
  ? pathToFileURL(resolve(process.env.THREE_MODULE)).href : import.meta.resolve('three'));
const module = await import('../../assets/geometry/loft-source.mjs').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e;
});
const create = options => {
  assert.equal(typeof module.createSectionLoftSource, 'function', 'createSectionLoftSource API is missing');
  return module.createSectionLoftSource(T, options);
};
const stations = () => [
  {center:[0,0,0],width:2,depth:1},
  {center:[0,2,0],width:3,depth:1.5,rollRadians:0.4},
  {center:[1,5,0.8],width:1,depth:2,rollRadians:-0.2},
];
const options = () => ({stations:stations(),radialSegments:9,uvMeters:0.3});
const near = (a,b,tol=1e-8) => assert.ok(a.distanceTo(b)<tol, `${a.toArray()} != ${b.toArray()}`);
function triangle(g,id) {
  return [0,1,2].map(k => new T.Vector3().fromBufferAttribute(g.attributes.position,g.index.getX(id*3+k)));
}
function assertAttachment(source,u,v) {
  const hit=source.surfaceAt(u,v), g=source.geometry;
  assert.ok(Number.isInteger(hit.segmentIndex));
  assert.ok(Number.isInteger(hit.triangleIndex));
  assert.ok(hit.triangleIndex >= 0 && hit.triangleIndex < (stations().length-1)*9*2);
  const [a,b,c]=triangle(g,hit.triangleIndex), tri=new T.Triangle(a,b,c);
  near(tri.closestPointToPoint(hit.point,new T.Vector3()),hit.point);
  const face=tri.getNormal(new T.Vector3());
  near(hit.normal,face);
  assert.ok(Math.abs(hit.tangent.dot(face))<1e-10);
  assert.ok(Math.abs(hit.tangent.length()-1)<1e-10);
  const x=new T.Vector3(),y=new T.Vector3(),z=new T.Vector3();
  hit.frame.extractBasis(x,y,z);
  near(y,hit.tangent);near(z,hit.normal);
  near(new T.Vector3().setFromMatrixPosition(hit.frame),hit.point);
  near(x.clone().cross(y),z);
  assert.ok(Math.abs(hit.frame.determinant()-1)<1e-9);
  return hit;
}

test('source reuses the existing loft positions, normals, index and UVs without mutating options',()=>{
  const opts=options(), snapshot=structuredClone(opts), source=create(opts), expected=createSectionLoftGeometry(T,opts);
  for (const key of ['position','normal','uv']) assert.deepEqual(source.geometry.attributes[key].array,expected.attributes[key].array);
  assert.deepEqual(source.geometry.index.array,expected.index.array);
  assert.deepEqual(opts,snapshot);
  const uv=source.geometry.attributes.uv.array.slice();
  source.surfaceAt(.37,.63);assert.deepEqual(source.geometry.attributes.uv.array,uv);
  source.dispose();expected.dispose();
});

test('samples lie on emitted triangles across both diagonal halves, joints and the seam',()=>{
  const source=create(options());
  for(const u of [0,.01,.13,.29,.5,.73,.99,1]) for(const v of [0,.01,.12,.17,.43,.61,.99,1]) assertAttachment(source,u,v);
  source.dispose();
});

test('u follows centerline chord length rather than station number or smooth curve length',()=>{
  const source=create({stations:[{center:[0,0,0],width:2,depth:2},{center:[0,1,0],width:2,depth:2},{center:[0,4,0],width:2,depth:2}],radialSegments:8});
  assert.equal(source.surfaceAt(.2,.1).segmentIndex,0);
  assert.equal(source.surfaceAt(.3,.1).segmentIndex,1);
  near(source.surfaceAt(.5,0).point,new T.Vector3(1,2,0));
  source.dispose();
});

test('diagonal interpolation uses the actual emitted triangle, including twisted unequal rings',()=>{
  const source=create(options()), localU=.2, localV=.7, circumferenceCell=2;
  const span=2+new T.Vector3(1,3,.8).length(), u=localU*2/span, v=(circumferenceCell+localV)/9;
  const hit=source.surfaceAt(u,v);
  assert.equal(hit.triangleIndex,circumferenceCell*2+1);
  const [a,b,c]=triangle(source.geometry,hit.triangleIndex);
  near(hit.point,a.multiplyScalar(1-localV).addScaledVector(b,localU).addScaledVector(c,localV-localU));
  const second=source.surfaceAt(.8*2/span,(circumferenceCell+.1)/9);
  assert.equal(second.triangleIndex,circumferenceCell*2);
  source.dispose();
});

test('face normal points outside and frame +Y follows the axis on a straight loft',()=>{
  const source=create({stations:[{center:[0,0,0],width:2,depth:2},{center:[0,4,0],width:2,depth:2}],radialSegments:8});
  for(let j=0;j<32;j++) {
    const hit=source.surfaceAt(.45,j/32), radial=new T.Vector3(hit.point.x,0,hit.point.z);
    assert.ok(hit.normal.dot(radial)>0);assert.ok(hit.tangent.dot(new T.Vector3(0,1,0))>.999999);
    near(new T.Vector3(0,0,1).transformDirection(hit.frame),hit.normal);
  }
  source.dispose();
});

test('v endpoint wraps exactly; endpoint samples stay on side triangles rather than caps',()=>{
  const source=create(options());
  for(const u of [0,.3,1]) {
    const a=source.surfaceAt(u,0), b=source.surfaceAt(u,1);
    near(a.point,b.point);near(a.normal,b.normal);near(a.tangent,b.tangent);
    assert.equal(a.triangleIndex,b.triangleIndex);
  }
  assert.equal(source.surfaceAt(0,0).segmentIndex,0);
  assert.equal(source.surfaceAt(1,0).segmentIndex,1);
  source.dispose();
});

test('a sharp non-reversing bend still attaches to its actual mesh; it does not guarantee collision-free lofts',()=>{
  const source=create({stations:[{center:[0,0,0],width:.02,depth:.02},{center:[0,1,0],width:.02,depth:.02},{center:[.6,.5,0],width:.02,depth:.02}],radialSegments:9});
  for(const u of [.1,.45,.65,.9]) for(const v of [.04,.27,.62,.98]) assertAttachment(source,u,v);
  source.dispose();
});

test('input mutation and returned hit mutation do not change subsequent samples',()=>{
  const opts=options(),source=create(opts), before=source.surfaceAt(.4,.2);
  opts.stations[1].center[1]=100;opts.stations[1].width=100;
  const point=before.point.clone(),normal=before.normal.clone();
  before.point.set(9,9,9);before.normal.set(0,0,0);before.frame.identity();
  const after=source.surfaceAt(.4,.2);near(after.point,point);near(after.normal,normal);
  source.dispose();
});

test('invalid coordinates fail explicitly without clamping or wrapping arbitrary values',()=>{
  const source=create(options());
  for(const n of [-.01,1.01,NaN,Infinity,'0.5',null,undefined]) {
    assert.throws(()=>source.surfaceAt(n,.2),/u|finite|range/i);
    assert.throws(()=>source.surfaceAt(.2,n),/v|finite|range/i);
  }
  source.dispose();
});

test('invalid lofts preserve existing validation including reversing cusps',()=>{
  assert.throws(()=>create({stations:[]}),/station/i);
  assert.throws(()=>create({...options(),radialSegments:2}),/radial/i);
  assert.throws(()=>create({...options(),uvMeters:0}),/uvMeters/i);
  assert.throws(()=>create({stations:[{center:[0,0,0],width:1,depth:1},{center:[0,1,0],width:1,depth:1},{center:[0,0,0],width:1,depth:1}]}),/cusp|revers/i);
});

test('dispose owns generated geometry exactly once and prevents later samples',()=>{
  const source=create(options());let count=0;
  source.geometry.addEventListener('dispose',()=>count++);
  source.dispose();source.dispose();assert.equal(count,1);
  assert.throws(()=>source.surfaceAt(.5,.5),/dispos/i);
});

test('Float32-collapsed side triangles fail clearly instead of returning invalid frames',()=>{
  const source=create({stations:[{center:[1e9,0,1e9],width:1,depth:1},{center:[1e9,2,1e9],width:1,depth:1}],radialSegments:8});
  assert.throws(()=>source.surfaceAt(.5,.1),/degenerate|collapsed/i);
  source.dispose();
});
