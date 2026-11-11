import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {dirname,resolve} from 'node:path';
import {buildHingedCabinet} from '../../assets/examples/hinged-cabinet.mjs';
const moduleURL=process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:import.meta.resolve('three');
const THREE=await import(moduleURL);
const utilsURL=process.env.THREE_MODULE?pathToFileURL(resolve(dirname(resolve(process.env.THREE_MODULE)),'../examples/jsm/utils/BufferGeometryUtils.js')).href:import.meta.resolve('three/addons/utils/BufferGeometryUtils.js');
const {mergeGeometries}=await import(utilsURL);
const materials=()=>Object.fromEntries(['shell','trim','interior'].map(name=>[name,new THREE.MeshStandardMaterial()]));
const build=options=>buildHingedCabinet(THREE,{mergeGeometries,materials:materials(),...options});
function near(a,b){assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);}
function rayAt(object,x,y,z=2){return new THREE.Raycaster(new THREE.Vector3(x,y,z),new THREE.Vector3(0,0,-1)).intersectObject(object,true);}

test('the door contains actual through vents while adjacent panel and the cabinet rear block rays',()=>{
  const r=build(), door=r.root.getObjectByName('service-door');r.root.updateMatrixWorld(true);
  assert.ok(door?.isMesh);assert.equal(door.parent,r.parts.doorPivot);
  const bounds=new THREE.Box3().setFromObject(door), size=bounds.getSize(new THREE.Vector3());
  const hole=door.localToWorld(new THREE.Vector3(size.x*.5,size.y*.72,0));
  assert.equal(rayAt(door,hole.x,hole.y).length,0,'isolated door vent transmits the ray');
  const solid=door.localToWorld(new THREE.Vector3(size.x*.12,size.y*.72,0));
  assert.ok(rayAt(door,solid.x,solid.y).length>0,'nearby plate remains solid');
  assert.ok(rayAt(r.root,hole.x,hole.y).length>0,'vent does not erase the physical rear wall');
  r.dispose();
});

test('static walls, shelf, frame and base form real geometry surrounding an accessible interior',()=>{
  const r=build({open:1});r.root.updateMatrixWorld(true);
  assert.ok(r.stats.staticInputs>=12);assert.equal(r.stats.staticMeshes,3);
  const staticRoot=new THREE.Group();
  for(const mesh of r.root.children.filter(n=>n!==r.parts.doorPivot)) staticRoot.add(mesh.clone());
  staticRoot.updateMatrixWorld(true);
  const front=new THREE.Raycaster(new THREE.Vector3(0,1,2),new THREE.Vector3(0,0,-1)).intersectObject(staticRoot,true);
  assert.ok(front.length>0);assert.ok(front[0].point.z<0,'open center reaches back, not an enclosing solid block');
  const shelf=new THREE.Raycaster(new THREE.Vector3(0,1.2,0),new THREE.Vector3(0,-1,0)).intersectObject(staticRoot,true);
  assert.ok(shelf.length>0);assert.ok(shelf[0].point.y>.5&&shelf[0].point.y<1.1);
  r.dispose();
});

test('absolute door opening retains hinge hierarchy and local anchors under a transformed asset root',()=>{
  const r=build({open:.25}), pivot=r.parts.doorPivot, door=r.root.getObjectByName('service-door');
  assert.equal(pivot.parent,r.root);assert.equal(pivot.userData.noMerge,true);assert.equal(door.userData.noMerge,true);
  r.setOpen(1);near(pivot.rotation.y,-110*Math.PI/180);
  r.setOpen(.5);r.setOpen(.5);near(pivot.rotation.y,-55*Math.PI/180);
  r.setOpen(0);near(pivot.rotation.y,0);
  for(const name of ['base','hinge','serviceClosed']) assert.ok(r.anchors.has(name));
  near(new THREE.Vector3().setFromMatrixPosition(r.anchors.get('hinge')).distanceTo(pivot.position),0);
  const before=r.anchors.get('hinge').elements.slice();
  r.root.position.set(3,2,1);r.root.rotation.y=.7;r.root.updateMatrixWorld(true);
  const anchorWorld=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(r.root.matrixWorld,r.anchors.get('hinge')));
  near(anchorWorld.distanceTo(pivot.getWorldPosition(new THREE.Vector3())),0);
  assert.deepEqual(r.anchors.get('hinge').elements,before);r.dispose();
});

test('service attachment follows the real door parameter point through unordered opening and transformed roots',()=>{
  for(const dimensions of [{width:1.2,height:1.8,depth:.6},{width:1.7,height:2.2,depth:.8}]) {
    const r=build(dimensions),door=r.root.getObjectByName('service-door'),service=r.parts.serviceAnchor;
    assert.ok(service?.isObject3D,'service attachment must expose an actual dynamic Object3D');
    assert.equal(service.parent,r.parts.doorPivot);assert.equal(service.userData.noMerge,true);
    door.geometry.computeBoundingBox();
    const size=door.geometry.boundingBox.getSize(new THREE.Vector3());
    const parameterPoint=new THREE.Vector3(size.x*.86,size.y*.45,size.z*5);
    const closed=r.anchors.get('serviceClosed');assert.ok(closed?.isMatrix4);
    const snapshot=closed.elements.slice();
    for(const transformed of [false,true]) {
      if(transformed){r.root.position.set(3,2,1);r.root.rotation.set(.2,.7,-.3);r.root.scale.set(1.5,.7,2);}
      for(const open of [0,.5,1,.25,1,0,.8,.5]) {
        r.setOpen(open);
        const expected=door.localToWorld(parameterPoint.clone()),world=service.getWorldPosition(new THREE.Vector3());
        near(world.distanceTo(expected),0);
        near(new THREE.Vector3().setFromMatrixPosition(service.matrixWorld).distanceTo(expected),0);
        assert.deepEqual(closed.elements,snapshot,'closed-layout snapshot remains asset-local and unchanged');
        const closedWorld=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(r.root.matrixWorld,closed));
        if(open===0)near(closedWorld.distanceTo(expected),0);
        else assert.ok(closedWorld.distanceTo(expected)>.1,'static closed layout is distinct from the moving attachment');
      }
    }
    r.dispose();
  }
});

test('width height depth change the actual shell and door dimensions and box UVs retain metre scale',()=>{
  for(const dimensions of [{width:1.2,height:1.8,depth:.6},{width:1.7,height:2.2,depth:.8}]) {
    const m=materials(),r=build({...dimensions,materials:m}), shell=r.root.children.find(n=>n.material===m.shell),g=shell.geometry;
    g.computeBoundingBox();const size=g.boundingBox.getSize(new THREE.Vector3());
    near(size.x,dimensions.width);near(size.y,dimensions.height-.05*dimensions.height);near(size.z,dimensions.depth);
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i+=3){
      if(Math.abs(n.getZ(i))<.99)continue;
      for(let j=1;j<3;j++){
        near(Math.abs(uv.getX(i+j)-uv.getX(i)),Math.abs(p.getX(i+j)-p.getX(i)));
        near(Math.abs(uv.getY(i+j)-uv.getY(i)),Math.abs(p.getY(i+j)-p.getY(i)));
      }
    }
    const door=r.root.getObjectByName('service-door');door.geometry.computeBoundingBox();
    assert.ok(door.geometry.boundingBox.max.x>dimensions.width*.8);
    r.dispose();
  }
});

test('example disposal owns all generated static and door geometry but preserves supplied materials',()=>{
  const m=materials(),r=build({materials:m}),geometries=new Set();let released=0,materialsReleased=0;
  r.root.traverse(n=>{if(n.geometry)geometries.add(n.geometry);});
  for(const g of geometries)g.addEventListener('dispose',()=>released++);
  for(const material of Object.values(m))material.addEventListener('dispose',()=>materialsReleased++);
  r.dispose();r.dispose();assert.equal(released,geometries.size);assert.equal(materialsReleased,0);
  assert.throws(()=>r.setOpen(.5),/disposed/i);
});

test('invalid dimensions, material contracts and opening values fail explicitly without changing current door angle',()=>{
  for(const options of [{width:0},{height:NaN},{depth:-1},{width:.01},{width:8,height:.3,depth:.3},{open:1.1},{materials:{}}])
    assert.throws(()=>build(options));
  const r=build({open:.3}),angle=r.parts.doorPivot.rotation.y;
  for(const open of [-1,2,NaN,'0.5']){assert.throws(()=>r.setOpen(open));assert.equal(r.parts.doorPivot.rotation.y,angle);}
  r.dispose();
});
