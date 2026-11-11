import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildArchitecturalBay } from '../../assets/examples/procedural-bay.mjs';
const THREE = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');
const materials = () => ({wall:new THREE.MeshStandardMaterial(),trim:new THREE.MeshStandardMaterial(),interior:new THREE.MeshStandardMaterial()});
const approx=(a,b,e=2e-6)=>assert.ok(Math.abs(a-b)<e,`${a} ≈ ${b}`);
function hits(bay,origin,direction=[0,0,-1]) {
  bay.root.updateWorldMatrix(true,true);
  return new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction)).intersectObject(bay.root,true);
}
function point(bay,name) {return new THREE.Vector3().setFromMatrixPosition(bay.anchors.get(name));}

// Closing the bore, omitting the reveal or using planes instead of a thick wall breaks these rays.
test('rect bay has an open ray path, a solid surround and the full wall-thickness reveal',()=>{
  const m=materials(),bay=buildArchitecturalBay(THREE,{materials:m});
  assert.equal(hits(bay,[0,1.5,2]).length,0);
  assert.ok(hits(bay,[1.1,1.5,2]).some(h=>h.object===bay.parts.wall));
  const reveal=hits(bay,[0,1.5,0],[1,0,0])[0];
  assert.equal(reveal.object,bay.parts.wall);approx(reveal.distance,.7);
  const wallBox=new THREE.Box3().setFromObject(bay.parts.wall);
  approx(wallBox.min.z,-.12);approx(wallBox.max.z,.12);
  approx(wallBox.min.y,0);approx(wallBox.max.y,3.3);
  for(const name of ['wall','frame','sill','header','plinth'])assert.ok(bay.parts[name]?.isMesh);
  for(const [name,y] of [['sill',.56],['header',3.24],['plinth',.09]]) {
    assert.equal(hits(bay,[0,y,2])[0].object,bay.parts[name],`${name} is a real projecting layer`);
  }
  assert.equal(bay.parts.wall.material[0],m.wall);assert.equal(bay.parts.wall.material[1],m.interior);
  assert.equal(bay.parts.glass,undefined);bay.dispose();
});

// An arch painted onto a rectangle would leave this upper-corner ray clear.
test('arch alters the actual bore and frame contours while retaining a clear apex and center',()=>{
  const rect=buildArchitecturalBay(THREE,{materials:materials()});
  const arch=buildArchitecturalBay(THREE,{variant:'arch',materials:materials()});
  assert.equal(hits(rect,[.58,2.5,2]).length,0);
  assert.ok(hits(arch,[.58,2.5,2]).length>0);
  assert.equal(hits(arch,[0,2.5,2]).length,0);
  assert.equal(hits(arch,[0,1.1,2]).length,0);
  assert.equal(hits(rect,[.5,2.45,2]).length,0);
  assert.equal(hits(arch,[.5,2.45,2])[0].object,arch.parts.frame,'moulding follows the arch, not a rectangular overlay');
  assert.ok(arch.spec.opening.contour.length>4);
  approx(arch.spec.opening.springY,1.9);rect.dispose();arch.dispose();
});

// Stale hard-coded dimensions or anchors fail this independently hand-derived fixture.
test('changed dimensions control geometry and root-local interface anchors, including transformed roots',()=>{
  const bay=buildArchitecturalBay(THREE,{width:4,height:4,depth:.4,openingWidth:2,openingHeight:2.2,sillHeight:.8,variant:'arch',materials:materials()});
  assert.deepEqual(point(bay,'opening.top').toArray(),[0,3,0]);
  const left=point(bay,'opening.left');approx(left.x,-1);approx(left.y,1.4);approx(left.z,0);
  assert.deepEqual(point(bay,'bay.right').toArray(),[2,2,0]);
  approx(point(bay,'reveal.front').z,.2);approx(point(bay,'reveal.back').z,-.2);
  const wallBox=new THREE.Box3().setFromObject(bay.parts.wall),size=wallBox.getSize(new THREE.Vector3());
  approx(size.x,4);approx(size.y,4);approx(size.z,.4);
  assert.equal(hits(bay,[0,2.9,3]).length,0);assert.ok(hits(bay,[1.1,2,3]).length>0);
  bay.root.position.set(5,2,-3);bay.root.rotation.y=Math.PI/2;bay.root.scale.setScalar(2);bay.root.updateWorldMatrix(true,true);
  const world=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(bay.root.matrixWorld,bay.anchors.get('reveal.front')));
  approx(world.x,5.4);approx(world.y,5.8);approx(world.z,-3);
  const frontWorld=new THREE.Vector3(0,1.9,3).applyMatrix4(bay.root.matrixWorld);
  assert.equal(hits(bay,frontWorld.toArray(),[-1,0,0]).length,0);bay.dispose();
});

// Normalized UVs, collapsed UV triangles or absent tangents break physical surface sampling.
test('every layer has metre UVs and finite orthonormal tangents on actual nondegenerate triangles',()=>{
  const bay=buildArchitecturalBay(THREE,{variant:'arch',materials:{...materials(),glass:new THREE.MeshStandardMaterial({transparent:true,opacity:.2})}});
  assert.ok(hits(bay,[0,1.5,2]).some(h=>h.object===bay.parts.glass));
  for(const mesh of Object.values(bay.parts)) {
    const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,t=g.attributes.tangent;
    assert.ok(g.index&&t?.itemSize===4);
    for(const attr of Object.values(g.attributes))for(const x of attr.array)assert.ok(Number.isFinite(x));
    for(let i=0;i<p.count;i++) {
      const normal=new THREE.Vector3().fromBufferAttribute(n,i), tangent=new THREE.Vector3(t.getX(i),t.getY(i),t.getZ(i));
      approx(tangent.length(),1);approx(tangent.dot(normal),0);approx(Math.abs(t.getW(i)),1);
    }
    for(let k=0;k<g.index.count;k+=3) {
      const ids=[0,1,2].map(o=>g.index.getX(k+o));
      const [a,b,c]=ids.map(i=>new THREE.Vector3().fromBufferAttribute(p,i));
      const area=b.clone().sub(a).cross(c.clone().sub(a)).length();assert.ok(area>1e-9);
      const [u,v,w]=ids.map(i=>new THREE.Vector2().fromBufferAttribute(uv,i));
      approx(Math.abs(v.clone().sub(u).cross(w.clone().sub(u))),area,3e-6);
    }
  }
  bay.dispose();
});

// Leaking generated geometries or disposing borrowed material breaks reuse by neighboring bays.
test('disposal releases each owned geometry once and never the borrowed materials',()=>{
  const m=materials(),bay=buildArchitecturalBay(THREE,{materials:m});let geometries=0,borrowed=0;
  const owned=new Set(Object.values(bay.parts).map(p=>p.geometry));
  for(const g of owned)g.addEventListener('dispose',()=>geometries++);
  for(const material of Object.values(m))material.addEventListener('dispose',()=>borrowed++);
  bay.dispose();bay.dispose();assert.equal(geometries,owned.size);assert.equal(borrowed,0);
  assert.equal(bay.root.children.length,0);
});

test('rejects nonphysical dimensions, clipping surrounds, unsupported profiles and invalid borrowed materials',()=>{
  for(const options of [{width:NaN},{depth:0},{depth:1.1},{openingWidth:2.9},{sillHeight:.15},{openingHeight:2.6},{variant:'gothic'},{variant:'arch',openingHeight:.6},{archSegments:3},{archSegments:9},{frameWidth:.5}]) {
    assert.throws(()=>buildArchitecturalBay(THREE,{materials:materials(),...options}),/bay|opening|depth|width|height|sill|variant|segment|frame|clearance/i);
  }
  assert.throws(()=>buildArchitecturalBay(THREE),/material/i);
  assert.throws(()=>buildArchitecturalBay(THREE,{materials:{wall:{},trim:{}}}),/material/i);
});
