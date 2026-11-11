import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {placeAtAnchor} from '../../assets/scene/anchor-connection.mjs';
import {buildArchitecturalBay} from '../../assets/examples/procedural-bay.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const materials={wall:new T.MeshStandardMaterial(),trim:new T.MeshStandardMaterial()};
function world(asset,key){asset.root.updateWorldMatrix(true,false);return asset.root.matrixWorld.clone().multiply(asset.anchors.get(key));}
function near(a,b){assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);}

test('real variable-width modules connect by position with opposed outward normals and matching front',()=>{
 for(const [aw,bw]of [[3,2.6],[4,3.4]]){
  const parent=new T.Group();parent.position.set(7,2,-4);parent.rotation.y=.5;
  const host=buildArchitecturalBay(T,{width:aw,materials}),guest=buildArchitecturalBay(T,{width:bw,variant:'arch',materials});parent.add(host.root);
  host.root.rotation.y=.3;host.root.position.set(1,.2,2);
  const input=guest.anchors.get('bay.left').elements.slice();
  const result=placeAtAnchor(T,{host,hostAnchor:'bay.right',guest,guestAnchor:'bay.left',parent});
  assert.equal(result,guest.root);assert.equal(guest.root.parent,parent);
  const a=world(host,'bay.right'),b=world(guest,'bay.left');
  near(new T.Vector3().setFromMatrixPosition(a).distanceTo(new T.Vector3().setFromMatrixPosition(b)),0);
  near(new T.Vector3(0,0,1).transformDirection(a).dot(new T.Vector3(0,0,1).transformDirection(b)),-1);
  near(new T.Vector3(0,0,1).transformDirection(host.root.matrixWorld).dot(new T.Vector3(0,0,1).transformDirection(guest.root.matrixWorld)),1);
  assert.deepEqual(guest.anchors.get('bay.left').elements,input);host.dispose();guest.dispose();
 }
});

test('invalid interface, scaled frame and cyclic parents fail before guest is moved',()=>{
 const parent=new T.Group(),host=buildArchitecturalBay(T,{materials}),guest=buildArchitecturalBay(T,{materials});parent.add(host.root);guest.root.position.set(8,9,10);
 const position=guest.root.position.toArray();
 for(const options of [{hostAnchor:'missing'},{parent:guest.root},{guest:host}])assert.throws(()=>placeAtAnchor(T,{host,hostAnchor:'bay.right',guest,guestAnchor:'bay.left',parent,...options}));
 host.root.scale.set(2,1,1);assert.throws(()=>placeAtAnchor(T,{host,hostAnchor:'bay.right',guest,guestAnchor:'bay.left',parent}),/rigid|scale/i);
 assert.equal(guest.root.parent,null);assert.deepEqual(guest.root.position.toArray(),position);host.dispose();guest.dispose();
});

test('manual world matrices are rejected before placement for the guest, children and host/parent chain',()=>{
 for(const mode of ['guest','child','host','parent']){
  const parent=new T.Group(),host=buildArchitecturalBay(T,{materials}),guest=buildArchitecturalBay(T,{materials});
  parent.add(host.root);guest.root.position.set(8,9,10);
  const object={guest:guest.root,child:guest.parts.wall,host:host.root,parent}[mode];object.matrixWorldAutoUpdate=false;
  assert.throws(()=>placeAtAnchor(T,{host,hostAnchor:'bay.right',guest,guestAnchor:'bay.left',parent}),/automatic world/i);
  assert.equal(guest.root.parent,null);assert.deepEqual(guest.root.position.toArray(),[8,9,10]);
  host.dispose();guest.dispose();
 }
});
