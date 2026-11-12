import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const {FORMATION_ATTRIBUTE:name,writeFormationCoordinates:write}=await import('../../assets/geometry/formation-coordinates.mjs');
const {copyFormationGroup}=await import('../../assets/scene/formation-group.mjs');

test('source metres exclude lot pose, support nested asset frames, and preserve geometry and buffers',()=>{
  const g=new T.BoxGeometry(2,4,6), root=new T.Group(),bay=new T.Group(),mesh=new T.Mesh(g);
  root.add(bay);bay.add(mesh);bay.position.set(2,3,-4);bay.rotation.y=Math.PI/2;mesh.position.set(0,.5,1);
  g.computeBoundingBox();g.computeBoundingSphere();
  const before=Object.entries(g.attributes).map(([k,a])=>[k,a,a.array.slice()]),index=g.index,indices=index.array.slice(),groups=structuredClone(g.groups),box=g.boundingBox.clone(),sphere=g.boundingSphere.clone();
  assert.equal(name,'aFormationPosition');
  const a=write(T,g),array=a.array;
  assert.deepEqual(array,g.attributes.position.array);assert.notEqual(array.buffer,g.attributes.position.array.buffer);
  for(const [i,angle] of [.27,1.4].entries()){
    root.position.set(-50*i,6*i,28*i);root.rotation.y=angle;root.updateMatrixWorld(true);
    const geometryToFormation=root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const version=a.version;
    assert.equal(write(T,g,{geometryToFormation}),a);assert.equal(a.array,array);assert.equal(a.version,version+1);
    for(let j=0;j<a.count;j++){
      const expected=new T.Vector3().fromBufferAttribute(g.attributes.position,j).applyMatrix4(mesh.matrix).applyMatrix4(bay.matrix);
      assert.ok(expected.distanceTo(new T.Vector3().fromBufferAttribute(a,j))<1e-6);
    }
  }
  for(const [k,a,values] of before){assert.equal(a,g.attributes[k]);assert.deepEqual(a.array,values);}
  assert.equal(g.index,index);assert.deepEqual(index.array,indices);assert.deepEqual(g.groups,groups);assert.deepEqual(g.boundingBox,box);assert.deepEqual(g.boundingSphere,sphere);
  g.dispose();mesh.material.dispose();
});

test('formation reads decoded position components and options once, then validates Float32 before writing',()=>{
  const g=new T.BufferGeometry(),p=new T.InterleavedBufferAttribute(new T.InterleavedBuffer(new Int16Array([0,32767,0,1, 32767,0,32767,2]),4),3,0,true);
  g.setAttribute('position',p);
  let aReads=0,mReads=0;const a=write(T,g,{get attributeName(){assert.equal(++aReads,1);return 'aMetres';},get geometryToFormation(){assert.equal(++mReads,1);return new T.Matrix4().makeScale(.01,.01,.01);}});
  assert.deepEqual(a.array,new Float32Array([0,.01,0,.01,0,.01]));
  const old=a.array.slice(),version=a.version;
  for(const matrix of [new T.Matrix4().makeScale(1e100,1,1),new T.Matrix4().makePerspective(-1,1,1,-1,.1,10),new T.Matrix4().makeTranslation(NaN,0,0)]) {
    assert.throws(()=>write(T,g,{attributeName:'aMetres',geometryToFormation:matrix}));assert.deepEqual(a.array,old);assert.equal(a.version,version);
  }
  g.dispose();
});

test('formation refuses invalid layout, alias and budget without changing existing/standard attributes',()=>{
  const g=new T.PlaneGeometry(),p=g.attributes.position,backup=p.array.slice();
  for(const key of ['position','normal','uv2','tangent','skinWeight','instanceColor','__proto__','x-y','a'.repeat(129)])assert.throws(()=>write(T,g,{attributeName:key}));
  for(const a of [new T.BufferAttribute(p.array,3),new T.BufferAttribute(new Float32Array(g.attributes.normal.array.buffer),3),
    new T.Float32BufferAttribute(new Array(p.count*3).fill(0),3,true),new T.InstancedBufferAttribute(new Float32Array(p.count*3),3),
    new T.BufferAttribute(new Float32Array(3),3),Object.assign(p.clone(),{gpuType:T.IntType})]){
    g.setAttribute(name,a);assert.throws(()=>write(T,g));assert.equal(g.attributes[name],a);
  }
  g.deleteAttribute(name);let calls=0;p.getX=()=>{calls++;return 0;};
  for(const n of [0,-1,.5,Infinity,1048577]){p.count=n;assert.throws(()=>write(T,g));assert.equal(calls,0);assert.ok(!g.hasAttribute(name));}
  assert.deepEqual(p.array,backup);g.dispose();
});

test('group extraction uses the same source vertex for position, UV, normal and declared formation coordinates',()=>{
  const g=new T.BoxGeometry(),group=g.groups[3],p=g.attributes.position;
  const formation=write(T,g,{geometryToFormation:new T.Matrix4().makeTranslation(4,5,6)});
  const copy=copyFormationGroup(T,g,group);
  try{
    assert.equal(copy.index,null);
    for(const key of ['position','normal','uv',name]){
      const a=g.attributes[key],b=copy.attributes[key];assert.equal(b.count,group.count);
      for(let i=0;i<b.count;i++)for(let c=0;c<b.itemSize;c++)assert.equal(b.getComponent(i,c),a.getComponent(g.index.getX(group.start+i),c));
    }
    assert.notDeepEqual(formation.array,p.array);
    g.deleteAttribute(name);assert.throws(()=>copyFormationGroup(T,g,group));
  }finally{g.dispose();copy.dispose();}
});

test('group extraction refuses unexpected vertex data instead of silently discarding it',()=>{
  const g=new T.BoxGeometry();write(T,g);
  g.setAttribute('aOther',new T.BufferAttribute(new Float32Array(g.attributes.position.count),1));
  try{assert.throws(()=>copyFormationGroup(T,g,g.groups[0]),/aOther/);}finally{g.dispose();}
});

test('invalid last coordinate cannot partially update earlier vertices or dirty upload ranges',()=>{
  const g=new T.PlaneGeometry(),p=g.attributes.position,a=write(T,g),before=a.array.slice(),version=a.version;
  a.addUpdateRange(2,1);p.setX(0,10);p.setZ(p.count-1,NaN);
  assert.throws(()=>write(T,g));assert.deepEqual(a.array,before);assert.equal(a.version,version);
  assert.deepEqual(a.updateRanges,[{start:2,count:1}]);p.setZ(p.count-1,0);
  assert.equal(write(T,g),a);assert.equal(a.getX(0),10);assert.deepEqual(a.updateRanges,[]);assert.equal(a.version,version+1);g.dispose();
});
