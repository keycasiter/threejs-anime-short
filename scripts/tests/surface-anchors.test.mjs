import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSurfaceSampler, surfaceFrame} from '../../assets/scene/surface-anchors.mjs';
const THREE = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');
const v = (...a) => new THREE.Vector3(...a);
const close = (a,b,e=1e-6) => assert.ok(a.distanceTo(b)<e, `${a.toArray()} ≈ ${b.toArray()}`);
const mesh = () => new THREE.Mesh(new THREE.PlaneGeometry(4,4), new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));

test('actual transformed support is hit and a miss stays null, without a fabricated zero floor',()=>{
  const floor=mesh();floor.rotation.x=-Math.PI/2;floor.position.y=3;
  const sample=createSurfaceSampler(THREE,floor);
  close(sample(v(0,9,0),v(0,-3,0)).point,v(0,3,0));
  close(sample(v(0,9,0),v(0,-1,0)).normal,v(0,1,0));
  assert.equal(sample(v(8,9,0),v(0,-1,0)),null);
  assert.equal(sample(v(0,9,0),v(0,-1,0),{far:5}),null);
  floor.position.y=4;close(sample(v(0,9,0),v(0,-1,0)).point,v(0,4,0));
});

test('nested nonuniform transforms preserve the geometric world normal and exact contact point',()=>{
  const parent=new THREE.Group();parent.rotation.z=.35;parent.scale.set(2,1,3);parent.position.set(3,2,-1);
  const floor=mesh();floor.rotation.x=-.8;parent.add(floor);parent.updateMatrixWorld(true);
  const a=floor.localToWorld(v(-1,-1,0)),b=floor.localToWorld(v(1,-1,0)),c=floor.localToWorld(v(-1,1,0));
  const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize(),p=floor.localToWorld(v(.3,.2,0));
  const hit=createSurfaceSampler(THREE,parent)(p.clone().addScaledVector(n,5),n.clone().negate());
  close(hit.point,p);close(hit.normal,n);assert.ok(Math.abs(hit.distance-5)<1e-6);
});

test('instance-local orientation is included in support normals',()=>{
  const source=mesh();const floor=new THREE.InstancedMesh(source.geometry,source.material,1);
  const transform=new THREE.Matrix4().makeRotationX(-Math.PI/3).setPosition(0,2,0);floor.setMatrixAt(0,transform);
  const n=v(0,Math.sqrt(3)/2,.5),p=v(0,2,0);
  const hit=createSurfaceSampler(THREE,floor)(p.clone().addScaledVector(n,4),n.clone().negate());
  assert.equal(hit.instanceId,0);close(hit.point,p);close(hit.normal,n);
});

test('surface-following and gravity-upright frames preserve point and functional forward separately',()=>{
  const hit={point:v(2,3,4),normal:v(0,1,1).normalize()};
  const conformed=surfaceFrame(THREE,hit,{forward:v(1,0,0),offset:.2});
  close(v(0,1,0).transformDirection(conformed),hit.normal);
  close(v(0,0,1).transformDirection(conformed),v(1,0,0));
  close(v().setFromMatrixPosition(conformed),hit.point.clone().addScaledVector(hit.normal,.2));
  const upright=surfaceFrame(THREE,hit,{up:v(0,1,0),forward:v(1,0,1)});
  close(v(0,1,0).transformDirection(upright),v(0,1,0));
  close(v(0,0,1).transformDirection(upright),v(1,0,1).normalize());
  assert.ok(Math.abs(conformed.determinant()-1)<1e-6);
});

test('parent conversion retains the exact world attachment even when its local matrix has shear',()=>{
  const parent=new THREE.Group();parent.rotation.y=.7;parent.scale.set(2,1,3);parent.position.set(5,2,-1);parent.updateMatrixWorld(true);
  const target=surfaceFrame(THREE,{point:v(1,2,3),normal:v(1,1,.2).normalize()});
  const root=new THREE.Group();parent.add(root);root.matrixAutoUpdate=false;
  root.matrix.copy(parent.matrixWorld).invert().multiply(target);parent.updateMatrixWorld(true);
  assert.ok(root.matrixWorld.elements.every((x,i)=>Math.abs(x-target.elements[i])<1e-6));
});

test('parallel forward stays finite/right-handed and invalid rays are rejected',()=>{
  const frame=surfaceFrame(THREE,{point:v(),normal:v(0,1,0)},{forward:v(0,1,0)});
  assert.ok(frame.elements.every(Number.isFinite));assert.ok(Math.abs(frame.determinant()-1)<1e-6);
  const sample=createSurfaceSampler(THREE,mesh());
  assert.throws(()=>sample(v(),v()),/nonzero/);
  assert.throws(()=>sample(v(),v(0,0,1),{near:3,far:2}),/interval/);
});
