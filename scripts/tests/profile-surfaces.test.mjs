import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createRevolvedShell, createPerforatedPlate } from '../../assets/geometry/profile-surfaces.mjs';
const THREE = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');
const cylinder = {outer:[{r:2,y:0},{r:2,y:3}],inner:[{r:1,y:0},{r:1,y:3}],radialSegments:32};
const square = [[-3,-2],[3,-2],[3,2],[-3,2]];
const hole = [[-.6,-.6],[.6,-.6],[.6,.6],[-.6,.6]];
const vector=(g,a,i)=>new THREE.Vector3().fromBufferAttribute(g.getAttribute(a),i);
function triangles(g,fn) {const p=g.getAttribute('position'), n=g.index?.count??p.count;for(let k=0;k<n;k+=3){const ids=[0,1,2].map(o=>g.index?g.index.getX(k+o):k+o);fn(ids.map(i=>vector(g,'position',i)),ids,k);}}
function sound(g) {for(const attr of Object.values(g.attributes))for(const v of attr.array)assert.ok(Number.isFinite(v));triangles(g,([a,b,c],ids)=>{const normal=b.clone().sub(a).cross(c.clone().sub(a));assert.ok(normal.length()>1e-8,'nonzero triangle');const shading=ids.map(i=>vector(g,'normal',i)).reduce((a,b)=>a.add(b),new THREE.Vector3());assert.ok(normal.dot(shading)>0,'winding agrees with outward shading');});}
function hits(g,origin,direction,side=THREE.FrontSide) {const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side}));mesh.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize()).intersectObject(mesh);}
function approx(a,b,e=1e-6){assert.ok(Math.abs(a-b)<e,`${a} ≈ ${b}`);}

test('shell has outward exterior, inward bore, connected end annuli, finite positive triangles and full dimensions',()=>{const g=createRevolvedShell(THREE,cylinder);sound(g);g.computeBoundingBox();assert.deepEqual(g.boundingBox.min.toArray(),[-2,0,-2]);assert.deepEqual(g.boundingBox.max.toArray(),[2,3,2]);approx(hits(g,[3,1.5,0],[-1,0,0])[0].distance,1);approx(hits(g,[0,1.5,0],[1,0,0])[0].distance,1);assert.equal(hits(g,[0,4,0],[0,-1,0]).length,0,'bore must remain open');approx(hits(g,[1.5,4,0],[0,-1,0])[0].distance,1);approx(hits(g,[1.5,-1,0],[0,1,0])[0].distance,1);});

test('shell angular UV duplicates have matching normals while a flagged profile fold stays sharp',()=>{const g=createRevolvedShell(THREE,{outer:[{r:2,y:0},{r:2,y:1,crease:true},{r:3,y:2}],inner:[{r:1,y:0},{r:1,y:2}],radialSegments:16});sound(g);const p=g.getAttribute('position'),uv=g.getAttribute('uv');let seams=0;for(let i=0;i<p.count;i++)if(uv.getX(i)===0){const j=i+16;if(j<p.count&&uv.getX(j)===1&&vector(g,'position',i).distanceTo(vector(g,'position',j))<1e-6){assert.ok(vector(g,'normal',i).distanceTo(vector(g,'normal',j))<1e-7);seams++;}}assert.ok(seams>=6);const fold=[];for(let i=0;i<p.count;i++)if(vector(g,'position',i).distanceTo(new THREE.Vector3(2,1,0))<1e-7)fold.push(vector(g,'normal',i));assert.ok(fold.some(a=>fold.some(b=>a.dot(b)<.8)),'crease must survive');const smooth=createRevolvedShell(THREE,{outer:[{r:2,y:0},{r:2,y:1},{r:3,y:2}],inner:[{r:1,y:0},{r:1,y:2}]});const ns=[];for(let i=0;i<smooth.attributes.position.count;i++)if(vector(smooth,'position',i).distanceTo(new THREE.Vector3(2,1,0))<1e-7)ns.push(vector(smooth,'normal',i));assert.ok(ns.every(n=>n.distanceTo(ns[0])<1e-7),'unflagged join smooth');});

test('shell supports radial shoulders and preserves distinct material regions and optional end openings',()=>{const g=createRevolvedShell(THREE,{...cylinder,outer:[{r:2,y:0},{r:2,y:1,crease:true},{r:2.5,y:1,crease:true},{r:2.5,y:3}],endConnections:{start:false,end:true},materialIndices:{outer:4,inner:5,start:6,end:7}});sound(g);assert.deepEqual(g.groups.map(x=>x.materialIndex),[4,5,7]);assert.equal(g.groups.reduce((s,x)=>s+x.count,0),g.index.count);assert.equal(hits(g,[1.5,-1,0],[0,1,0]).length,0);assert.ok(hits(g,[2.25,.5,0],[0,1,0]).length>0,'shoulder underside is real');});

test('plate hole transmits axial rays, nearby solid and hole walls hit, bevel reads as sloped normals',()=>{const g=createPerforatedPlate(THREE,{outline:square,holes:[hole],depth:1,bevel:{size:.15,thickness:.1,segments:3},materialIndices:{faces:3,edges:7}});sound(g);g.computeBoundingBox();approx(g.boundingBox.min.z,0);approx(g.boundingBox.max.z,1);approx(g.boundingBox.min.x,-3);approx(g.boundingBox.max.x,3);for(const xy of [[0,0],[.59,0],[-.59,.59]])assert.equal(hits(g,[...xy,2],[0,0,-1],THREE.DoubleSide).length,0,'through hole including near edge');assert.ok(hits(g,[.8,0,2],[0,0,-1]).length>0);approx(hits(g,[0,0,.5],[1,0,0])[0].distance,.6);assert.ok(Array.from({length:g.attributes.normal.count},(_,i)=>Math.abs(g.attributes.normal.getZ(i))).some(z=>z>.05&&z<.95));assert.deepEqual(g.groups.map(x=>x.materialIndex),[3,7]);assert.equal(g.groups.reduce((s,x)=>s+x.count,0),g.attributes.position.count);});

test('plate no-hole negative control blocks center ray, no-bevel plate has exact dimensions',()=>{const solid=createPerforatedPlate(THREE,{outline:square,depth:1,bevel:{enabled:false}});sound(solid);assert.ok(hits(solid,[0,0,2],[0,0,-1]).length>0);const perforated=createPerforatedPlate(THREE,{outline:square,holes:[hole],depth:1,bevel:{enabled:false}});sound(perforated);assert.equal(hits(perforated,[0,0,2],[0,0,-1],THREE.DoubleSide).length,0);approx(hits(perforated,[.61,0,2],[0,0,-1])[0].distance,1);});

test('rejects intersecting shells, malformed profiles, invalid polygon topology and destructive bevels',()=>{assert.throws(()=>createRevolvedShell(THREE,{...cylinder,inner:[{r:1,y:0},{r:3,y:3}]}),/inner|intersect|clearance/i);assert.throws(()=>createRevolvedShell(THREE,{...cylinder,outer:[{r:2,y:3},{r:2,y:0}]}),/profile|order|increasing/i);assert.throws(()=>createRevolvedShell(THREE,{...cylinder,radialSegments:2}),/segment/i);assert.throws(()=>createPerforatedPlate(THREE,{outline:square,holes:[[[2.8,0],[3.2,0],[3.2,1],[2.8,1]]],depth:1}),/hole|inside|intersect/i);assert.throws(()=>createPerforatedPlate(THREE,{outline:[[0,0],[2,2],[0,2],[2,0]],depth:1}),/polygon|intersect|convex/i);assert.throws(()=>createPerforatedPlate(THREE,{outline:square,holes:[hole,hole],depth:1}),/hole|intersect/i);assert.throws(()=>createPerforatedPlate(THREE,{outline:square,holes:[hole],depth:1,bevel:{size:2,thickness:.1}}),/bevel/i);assert.throws(()=>createPerforatedPlate(THREE,{outline:square,depth:1,bevel:{size:.1,thickness:.5}}),/bevel/i);});

// A removed cap or mismatched duplicated boundary vertex must break this check.
function closedVolume(g, requireManifold = true) {
  const edges = new Map(); let volume = 0;
  const key = p => p.toArray().map(x => Object.is(x, -0) ? 0 : x).join(',');
  triangles(g, ([a,b,c]) => {
    volume += a.dot(b.clone().cross(c)) / 6;
    for (const [p,q] of [[a,b],[b,c],[c,a]]) {const u=key(p),v=key(q),k=u<v?`${u}|${v}`:`${v}|${u}`,entry=edges.get(k)??[0,0];entry[0]++;entry[1]+=u<v?1:-1;edges.set(k,entry);}
  });
  if (requireManifold) assert.ok([...edges.values()].every(([count,direction])=>count===2&&direction===0),'every welded edge has two oppositely directed faces');
  assert.ok(volume>0,'closed geometry has positive signed volume');
  return volume;
}

test('closed shell has manifold welded edges and the hand-derived faceted annular volume',()=>{
  const g=createRevolvedShell(THREE,cylinder),volume=closedVolume(g);
  approx(volume,32/2*Math.sin(2*Math.PI/32)*9,2e-6);
  assert.throws(()=>closedVolume(createRevolvedShell(THREE,{...cylinder,endConnections:{end:false}})),/two oppositely/,'missing-end negative control must fail closedness');
});

test('plate accepts reversed ring winding, multiple bores and simple concavity without bevel',()=>{
  const left=hole.map(([x,y])=>[x-1.5,y]),right=hole.map(([x,y])=>[x+1.5,y]);
  const g=createPerforatedPlate(THREE,{outline:[...square].reverse(),holes:[left,[...right].reverse()],depth:1,bevel:{enabled:false}});
  sound(g);approx(closedVolume(g, false),24-2*1.44,2e-6);
  assert.equal(hits(g,[-1.5,0,2],[0,0,-1],THREE.DoubleSide).length,0);
  assert.equal(hits(g,[1.5,0,2],[0,0,-1],THREE.DoubleSide).length,0);
  assert.ok(hits(g,[0,0,2],[0,0,-1]).length>0);
  const l=createPerforatedPlate(THREE,{outline:[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]],depth:.5,bevel:{enabled:false}});
  sound(l);approx(closedVolume(l),2.5);assert.equal(hits(l,[2,2,2],[0,0,-1]).length,0);assert.ok(hits(l,[.5,2,2],[0,0,-1]).length>0);
});


test('16 and 64 segment circular holes accept the same world bevel, while true collapse and touching mouths reject',()=>{
  const circle=(n,cx=0,r=1)=>Array.from({length:n},(_,i)=>[cx+r*Math.cos(i*2*Math.PI/n),r*Math.sin(i*2*Math.PI/n)]);
  for(const n of [16,64]) {
    const g=createPerforatedPlate(THREE,{outline:square,holes:[circle(n)],depth:1,bevel:{size:.25,thickness:.12,segments:4}});
    sound(g);assert.equal(hits(g,[0,0,2],[0,0,-1],THREE.DoubleSide).length,0);assert.ok(hits(g,[1.3,0,2],[0,0,-1]).length>0);approx(hits(g,[0,0,.5],[1,0,0])[0].distance,1);
    const p=g.attributes.position,mouth=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getZ(i))<1e-7&&Math.abs(p.getY(i))<1e-7&&p.getX(i)>1&&p.getX(i)<2)mouth.push(p.getX(i));
    assert.ok(mouth.length>0);for(const x of mouth)approx(x,1+.25/Math.cos(Math.PI/n));
  }
  assert.throws(()=>createPerforatedPlate(THREE,{outline:square,holes:[circle(64,-.8,.6),circle(64,.8,.6)],depth:1,bevel:{size:.25,thickness:.1}}),/bevel/i,'actual expanded hole mouths touch/overlap');
  assert.throws(()=>createPerforatedPlate(THREE,{outline:[[0,0],[4,0],[4,.3],[0,.3]],depth:1,bevel:{size:.2,thickness:.1}}),/bevel/i,'inset outline collapses');
});

test('connected end rings reject overlapping return shoulders but allow outward adjoining shoulders and open ends',()=>{
  const cases=[
    {key:'start',invalid:{outer:[{r:3,y:0},{r:2,y:0,crease:true},{r:2,y:3}]},valid:{outer:[{r:2,y:0},{r:3,y:0,crease:true},{r:3,y:3}]}},
    {key:'end',invalid:{outer:[{r:2,y:0},{r:2,y:3,crease:true},{r:3,y:3}]},valid:{outer:[{r:3,y:0},{r:3,y:3,crease:true},{r:2,y:3}]}},
    {key:'start',invalid:{inner:[{r:.5,y:0},{r:1,y:0,crease:true},{r:1,y:3}]},valid:{inner:[{r:1,y:0},{r:.5,y:0,crease:true},{r:.5,y:3}]}},
    {key:'end',invalid:{inner:[{r:1,y:0},{r:1,y:3,crease:true},{r:.5,y:3}]},valid:{inner:[{r:.5,y:0},{r:.5,y:3,crease:true},{r:1,y:3}]}}
  ];
  for(const {key,invalid,valid} of cases){
    assert.throws(()=>createRevolvedShell(THREE,{...cylinder,...invalid}),/end|shoulder|overlap/i);
    const open=createRevolvedShell(THREE,{...cylinder,...invalid,endConnections:{[key]:false}});sound(open);
    const connected=createRevolvedShell(THREE,{...cylinder,...valid});sound(connected);closedVolume(connected);
  }
});
