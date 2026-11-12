import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const THREE=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const load=async p=>{try{return await import(p);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;}};
const loft=await load('../../assets/geometry/section-loft.mjs');
const layout=await load('../../assets/scene/corridor-layout.mjs');
const fields=await load('../../assets/environment/height-field.mjs');
function api(m,key){assert.equal(typeof m[key],'function',`${key} must be provided`);return m[key];}
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<=e,`${a} ≈ ${b}`);
const vertex=(g,i)=>new THREE.Vector3().fromBufferAttribute(g.attributes.position,i);
function sound(g){
 for(const a of Object.values(g.attributes))for(const v of a.array)assert.ok(Number.isFinite(v),'finite attribute');
 const idx=g.index.array;
 for(let i=0;i<idx.length;i+=3){const ids=[idx[i],idx[i+1],idx[i+2]],a=vertex(g,ids[0]),b=vertex(g,ids[1]),c=vertex(g,ids[2]);const n=b.sub(a).cross(c.sub(a));assert.ok(n.length()>1e-9,'nondegenerate');const sn=new THREE.Vector3();for(const k of ids)sn.add(new THREE.Vector3().fromBufferAttribute(g.attributes.normal,k));assert.ok(n.dot(sn)>0,'winding and shading agree');}
}
const straight=[{center:[0,0,0],width:4,depth:2},{center:[0,3,0],width:6,depth:1},{center:[0,6,0],width:2,depth:2}];

test('loft follows independently sized stations and real caps block axial rays',()=>{
 const g=api(loft,'createSectionLoftGeometry')(THREE,{stations:straight,radialSegments:24});sound(g);
 for(let s=0;s<3;s++){const ring=Array.from({length:25},(_,j)=>vertex(g,s*25+j));near(Math.max(...ring.map(v=>v.x))-Math.min(...ring.map(v=>v.x)),straight[s].width);near(Math.max(...ring.map(v=>v.z))-Math.min(...ring.map(v=>v.z)),straight[s].depth);}
 const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial());m.updateMatrixWorld(true);assert.ok(new THREE.Raycaster(new THREE.Vector3(0,8,0),new THREE.Vector3(0,-1,0)).intersectObject(m).length);
 const open=loft.createSectionLoftGeometry(THREE,{stations:straight,caps:false});const om=new THREE.Mesh(open,m.material);om.updateMatrixWorld(true);assert.equal(new THREE.Raycaster(new THREE.Vector3(0,8,0),new THREE.Vector3(0,-1,0)).intersectObject(om).length,0);
});
test('loft uses explicit roll, continuous transported frames and matching seam normals',()=>{
 const build=api(loft,'createSectionLoftGeometry');
 const rolled=build(THREE,{stations:[{center:[0,0,0],width:4,depth:1,rollRadians:Math.PI/2},{center:[0,5,0],width:4,depth:1,rollRadians:Math.PI/2}],radialSegments:16});sound(rolled);rolled.computeBoundingBox();near(rolled.boundingBox.max.x,.5);near(rolled.boundingBox.max.z,2);
 const curved=build(THREE,{stations:[{center:[0,0,0],width:1,depth:.7},{center:[0,2,0],width:1.2,depth:.8},{center:[.7,4,.3],width:.8,depth:.5},{center:[1.8,6,1],width:.5,depth:.3}],radialSegments:24});sound(curved);
 for(let k=0;k<4;k++){near(vertex(curved,k*25).distanceTo(vertex(curved,k*25+24)),0);const n=curved.attributes.normal;near(new THREE.Vector3().fromBufferAttribute(n,k*25).distanceTo(new THREE.Vector3().fromBufferAttribute(n,k*25+24)),0,1e-6);}
});
test('loft rejects zero thickness, duplicate centers and a reversing spine',()=>{
 const build=api(loft,'createSectionLoftGeometry');
 assert.throws(()=>build(THREE,{stations:[straight[0],{...straight[1],width:0}]}),/width|positive/);
 assert.throws(()=>build(THREE,{stations:[straight[0],straight[0]]}),/center|spine|distinct/);
 assert.throws(()=>build(THREE,{stations:[straight[0],straight[1],straight[0]]}),/cusp|revers|tangent/);
});
const graph={nodes:[{id:'a',x:0,z:0},{id:'b',x:30,z:0},{id:'c',x:30,z:30}],edges:[{id:'main',from:'a',to:'b',width:4},{id:'side',from:'b',to:'c',width:3}]};
test('corridor graph has real widths, components, junction positions and order-stable output',()=>{
 const build=api(layout,'compileCorridorGraph');const a=build(graph),b=build({nodes:[...graph.nodes].reverse(),edges:[...graph.edges].reverse()});assert.deepEqual(a,b);assert.equal(a.components.length,1);assert.equal(a.edges.length,2);const e=a.edges.find(e=>e.id==='main');near(e.length,30);near(Math.abs(e.quad[0][1]-e.quad[3][1]),4);assert.ok(a.junctions.some(j=>j.id==='b'&&j.radius===2));
 const split=build({nodes:[...graph.nodes,{id:'isolated',x:80,z:80}],edges:graph.edges});assert.equal(split.components.length,2);
});
test('frontage lots are real rectangles clear of roads, each other and full-footprint restrictions',()=>{
 const build=api(layout,'compileCorridorGraph'),lots=api(layout,'generateFrontageLots');const g=build(graph);
 const options={frontage:5,depth:6,gap:1,setback:1,endClearance:3,acceptFootprint:corners=>corners.every(([x,z])=>x>=0&&x<=35&&z>=-10&&z<=25)};
 const a=lots(g,options);assert.ok(a.length>=5);assert.deepEqual(a,lots(build({nodes:[...graph.nodes].reverse(),edges:[...graph.edges].reverse()}),options));
 const intersects=api(layout,'rectanglesOverlap');
 for(let i=0;i<a.length;i++){const lot=a[i];assert.equal(lot.corners.length,4);assert.ok(options.acceptFootprint(lot.corners));near(Math.hypot(lot.corners[1][0]-lot.corners[0][0],lot.corners[1][1]-lot.corners[0][1]),5);near(Math.hypot(lot.corners[2][0]-lot.corners[1][0],lot.corners[2][1]-lot.corners[1][1]),6);for(const e of g.edges)assert.equal(intersects(lot.corners,e.quad),false);for(let j=0;j<i;j++)assert.equal(intersects(lot.corners,a[j].corners),false);}
 const wider=lots(build({...graph,edges:graph.edges.map(e=>({...e,width:e.width+2}))}),options);assert.notDeepEqual(a.map(x=>x.center),wider.map(x=>x.center),'actual lot placement follows road widths');
});
test('graph rejects missing endpoints, duplicate identities and unsplit geometric crossings',()=>{
 const build=api(layout,'compileCorridorGraph');assert.throws(()=>build({...graph,edges:[{id:'bad',from:'a',to:'none',width:4}]}),/endpoint|node/);assert.throws(()=>build({...graph,nodes:[...graph.nodes,graph.nodes[0]]}),/duplicate/);
 assert.throws(()=>build({nodes:[{id:'a',x:-2,z:0},{id:'b',x:2,z:0},{id:'c',x:0,z:-2},{id:'d',x:0,z:2}],edges:[{id:'ab',from:'a',to:'b',width:1},{id:'cd',from:'c',to:'d',width:1}]}),/cross|split|intersection/);
});
test('shared graph nodes permit one junction but not overlapping edges or an unsplit interior endpoint',()=>{
 const build=api(layout,'compileCorridorGraph');
 assert.throws(()=>build({nodes:[{id:'a',x:0,z:0},{id:'b',x:10,z:0},{id:'c',x:5,z:0}],edges:[{id:'ab',from:'a',to:'b',width:1},{id:'ac',from:'a',to:'c',width:1}]}),/overlap|split|intersection/);
 const valid=build({nodes:[{id:'a',x:0,z:0},{id:'b',x:5,z:0},{id:'c',x:10,z:0}],edges:[{id:'ab',from:'a',to:'b',width:1},{id:'bc',from:'b',to:'c',width:1}]});assert.equal(valid.components.length,1);assert.equal(valid.junctions.find(n=>n.id==='b').degree,2);
});
test('actual lab cleanup disposes instance buffers as well as owned geometries',async()=>{
 const source=await readFile(new URL('../../assets/examples/algorithm-lab/main.mjs',import.meta.url),'utf8'),code=source.match(/function clear\(\)\{[^\n]+\}/)?.[0];assert.ok(code);
 const root=new THREE.Group(),geo=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),inst=new THREE.InstancedMesh(geo,material,2);root.add(inst);let meshDisposals=0,geometryDisposals=0;inst.addEventListener('dispose',()=>meshDisposals++);geo.addEventListener('dispose',()=>geometryDisposals++);
 vm.runInNewContext(`${code};clear()`,{root});assert.equal(meshDisposals,1,'WebGLObjects uses this event to remove instance attributes');assert.equal(geometryDisposals,1);assert.equal(root.children.length,0);material.dispose();
});
test('height field is deterministic, amplitude bounded, smooth and has correct world derivatives',()=>{
 const make=api(fields,'createFractalHeightField');const a=make({seed:71,amplitude:4,baseFrequency:.17,octaves:4,persistence:.55,lacunarity:2,baseHeight:3}),b=make({seed:71,amplitude:4,baseFrequency:.17,octaves:4,persistence:.55,lacunarity:2,baseHeight:3}),c=make({seed:72,amplitude:4,baseFrequency:.17,octaves:4,persistence:.55,lacunarity:2,baseHeight:3});
 let different=false;
 for(const [x,z] of [[.23,4.67],[-8.11,2.91],[10.31,-20.77],[0,0]]){const s=a.sample(x,z);assert.deepEqual(s,b.sample(x,z));assert.ok(s.height>=-1&&s.height<=7);const e=1e-5;near(s.dx,(a.heightAt(x+e,z)-a.heightAt(x-e,z))/(2*e),2e-5);near(s.dz,(a.heightAt(x,z+e)-a.heightAt(x,z-e))/(2*e),2e-5);const n=a.normalAt(x,z);near(Math.hypot(...n),1,1e-12);assert.ok(n[1]>0);if(s.height!==c.heightAt(x,z))different=true;}
 assert.ok(different);const low=make({seed:1,amplitude:0,baseHeight:2});assert.equal(low.heightAt(5,9),2);assert.deepEqual(low.normalAt(5,9),[0,1,0]);
});
test('height field geometry consumes the actual field and has world-scale UVs, normals and bounds',()=>{
 const f=api(fields,'createFractalHeightField')({seed:2,amplitude:3,baseFrequency:.1});const g=api(fields,'createHeightFieldGeometry')(THREE,f,{sizeX:12,sizeZ:8,segmentsX:12,segmentsZ:8,center:[2,-3]});sound(g);g.computeBoundingBox();near(g.boundingBox.min.x,-4);near(g.boundingBox.max.x,8);near(g.boundingBox.min.z,-7);near(g.boundingBox.max.z,1);
 const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
 for(let i=0;i<p.count;i++){near(p.getY(i),f.heightAt(p.getX(i),p.getZ(i)),1e-6);const normal=f.normalAt(p.getX(i),p.getZ(i));for(let j=0;j<3;j++)near(n.array[i*3+j],normal[j],1e-6);near(uv.getX(i),p.getX(i));near(uv.getY(i),p.getZ(i));}
});
test('field and mesh reject invalid scales and fractional topology settings',()=>{
 const make=api(fields,'createFractalHeightField');assert.throws(()=>make({baseFrequency:0}),/frequency/i);assert.throws(()=>make({octaves:2.5}),/octaves/i);assert.throws(()=>make({persistence:1.2}),/persistence/i);assert.throws(()=>api(fields,'createHeightFieldGeometry')(THREE,make(),{sizeX:10,sizeZ:10,segmentsX:3.5}),/segments/i);
});
