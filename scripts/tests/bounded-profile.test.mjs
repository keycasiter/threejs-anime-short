import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { clipConvexPolygon, createBoundedProfileGeometry } from '../../assets/geometry/bounded-profile.mjs';
const THREE = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');
const square = [[-2,-2],[2,-2],[2,2],[-2,2]];
const approx = (a,b,e=2e-6) => assert.ok(Math.abs(a-b)<=e, `${a} ≈ ${b}`);
const area = ring => ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;
const canonical = ring => ring.map(p=>p.map(v=>Math.round(v*1e8)/1e8).join(',')).sort();
// Independent containment oracle: every vertex stays on the inward side of all original edges.
function inside(ring,[x,y],tolerance=3e-6) {
  const sign = Math.sign(area(ring));
  return ring.every((a,i)=>{const b=ring[(i+1)%ring.length];return sign*((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))>=-tolerance*Math.hypot(b[0]-a[0],b[1]-a[1]);});
}
function eachTriangle(g, fn) {
  const p=g.getAttribute('position'), count=g.index?.count??p.count;
  for(let i=0;i<count;i+=3) {
    const ids=[0,1,2].map(o=>g.index?g.index.getX(i+o):i+o);
    fn(ids.map(j=>new THREE.Vector3().fromBufferAttribute(p,j)),ids);
  }
}
// Removing a cap, reversing a face, or mismatching a boundary vertex must fail this oracle.
function meshFacts(g, footprint, boundary) {
  for(const a of Object.values(g.attributes)) for(const v of a.array) assert.ok(Number.isFinite(v),'finite attributes');
  const p=g.getAttribute('position'),uv=g.getAttribute('uv'),n=g.getAttribute('normal');
  assert.equal(uv.count,p.count); assert.equal(n.count,p.count);
  for(let i=0;i<p.count;i++) {
    assert.ok(inside(footprint,[p.getX(i),p.getY(i)]),'entire footprint inside subject');
    assert.ok(inside(boundary,[p.getX(i),p.getY(i)]),'entire footprint inside owner boundary');
    approx(new THREE.Vector3().fromBufferAttribute(n,i).length(),1);
    assert.ok(uv.getX(i)>=0&&uv.getX(i)<=1&&uv.getY(i)>=0&&uv.getY(i)<=1,'normalized UVs');
  }
  const edges=new Map(); let volume=0;
  const key=v=>v.toArray().map(x=>Object.is(x,-0)?0:x).join(',');
  eachTriangle(g,([a,b,c],ids)=>{
    const normal=b.clone().sub(a).cross(c.clone().sub(a));
    assert.ok(normal.length()>1e-10,'no degenerate triangles');
    assert.ok(ids.every(i=>normal.dot(new THREE.Vector3().fromBufferAttribute(n,i))>0),'normal matches outward winding');
    volume+=a.dot(b.clone().cross(c))/6;
    for(const [v,w] of [[a,b],[b,c],[c,a]]) {
      const aKey=key(v),bKey=key(w),edgeKey=[aKey,bKey].sort().join('|');
      const e=edges.get(edgeKey)??[0,0];e[0]++;e[1]+=aKey<bKey?1:-1;edges.set(edgeKey,e);
    }
  });
  assert.ok([...edges.values()].every(([count,orientation])=>count===2&&orientation===0),'welded mesh has exactly two opposite uses of each edge');
  assert.ok(volume>0,'positive outward volume');
  assert.ok(g.boundingBox&&g.boundingSphere,'bounding volumes calculated');
  for(let i=0;i<p.count;i++) {
    const v=new THREE.Vector3().fromBufferAttribute(p,i);
    assert.ok(g.boundingBox.containsPoint(v)); assert.ok(v.distanceTo(g.boundingSphere.center)<=g.boundingSphere.radius+1e-6);
  }
  return volume;
}
function zPairs(g, heightAt, thickness) {
  const p=g.getAttribute('position'),columns=new Map();
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),k=`${x},${y}`,z=p.getZ(i);
    const col=columns.get(k)??{y,z:[]}; col.z.push(z);columns.set(k,col);
  }
  for(const {y,z} of columns.values()) {approx(Math.max(...z),heightAt(y));approx(Math.min(...z),heightAt(y)-thickness);approx(Math.max(...z)-Math.min(...z),thickness);}
}

test('clips full footprint against a slanted domain, creating the hand-derived CCW intersection',()=>{
  const boundary=[[-3,-3],[3,-3],[-3,3]],input=structuredClone(square),saved=structuredClone(boundary);
  const result=clipConvexPolygon(input,boundary);
  assert.deepEqual(canonical(result),canonical([[-2,-2],[2,-2],[-2,2]])); approx(area(result),8);
  assert.deepEqual(input,square);assert.deepEqual(boundary,saved);assert.notEqual(result,input);assert.ok(result.every(p=>!input.includes(p)));
});

test('CW inputs produce the same intersection and returned points are not caller-owned',()=>{
  const boundary=[[-1,-3],[3,-3],[3,3],[-1,3]];
  const a=clipConvexPolygon(square,boundary),b=clipConvexPolygon([...square].reverse(),[...boundary].reverse());
  assert.deepEqual(canonical(a),canonical(b));assert.ok(area(a)>0&&area(b)>0);a[0][0]=99;assert.equal(square[0][0],-2);
});

test('disjoint, vertex-tangent and edge-tangent domains have no area or manufactured mesh',()=>{
  for(const boundary of [square.map(([x,y])=>[x+5,y]),square.map(([x,y])=>[x+4,y+4]),square.map(([x,y])=>[x+4,y])]) {
    assert.deepEqual(clipConvexPolygon(square,boundary),[]);
    assert.equal(createBoundedProfileGeometry(THREE,{footprint:square,boundary}),null);
  }
});

test('closed slanted triangular cap has true boundary interpolation, thickness and expected volume',()=>{
  const boundary=[[-3,-3],[3,-3],[-3,3]],heightAt=v=>1+.25*v;
  const {geometry:g,outline}=createBoundedProfileGeometry(THREE,{footprint:square,boundary,heightAt,thickness:.2,segments:4});
  assert.deepEqual(canonical(outline),canonical([[-2,-2],[2,-2],[-2,2]]));
  approx(meshFacts(g,square,boundary),1.6);zPairs(g,heightAt,.2);
  const p=g.getAttribute('position');
  assert.ok(Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i)]).some(([x,y])=>Math.abs(x)<1e-7&&Math.abs(y)<1e-7),'diagonal edge crosses x=0 at y=0');
  assert.ok(Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i)]).every(([x,y])=>x+y<3e-6),'all vertices, not just centers, obey slanted edge');
});

test('nonrectangular convex domain preserves corner levels between uniform samples and closes both wide ends',()=>{
  const footprint=[[-3,-1],[2,-1],[3,.2],[1,2],[-2,1.3]],boundary=[[-10,-10],[10,-10],[10,10],[-10,10]],heightAt=v=>.7+.15*v*v;
  const {geometry:g,outline}=createBoundedProfileGeometry(THREE,{footprint,boundary,heightAt,thickness:.15,segments:3});
  approx(meshFacts(g,footprint,boundary),area(footprint)*.15);zPairs(g,heightAt,.15);
  const p=g.getAttribute('position');
  for(const [x,y] of footprint)assert.ok(Array.from({length:p.count},(_,i)=>i).some(i=>Math.abs(p.getX(i)-x)<1e-6&&Math.abs(p.getY(i)-y)<1e-6),'every silhouette corner is retained');
  assert.deepEqual(canonical(outline),canonical(footprint));
});

test('curved one-dimensional profile follows sampled height and finer segments reduce chord error',()=>{
  const heightAt=v=>1-v*v/4,footprint=[[-1,-1],[1,-1],[1,1],[-1,1]];
  const coarse=createBoundedProfileGeometry(THREE,{footprint,boundary:square,heightAt,thickness:.1,segments:2});
  const fine=createBoundedProfileGeometry(THREE,{footprint,boundary:square,heightAt,thickness:.1,segments:16});
  for(const {geometry:g} of [coarse,fine]) {approx(meshFacts(g,footprint,square),.4);zPairs(g,heightAt,.1);}
  const hitAt=(g,y)=>{const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial());mesh.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(0,y,3),new THREE.Vector3(0,0,-1)).intersectObject(mesh)[0].point.z;};
  const coarseError=Math.abs(hitAt(coarse.geometry,.3)-heightAt(.3)),fineError=Math.abs(hitAt(fine.geometry,.3)-heightAt(.3));
  assert.ok(coarseError>.01&&fineError<coarseError/10,'segments control actual chord approximation');
});

test('geometry is winding-independent, uses injected THREE and disposes only its owned resource once',()=>{
  const options={footprint:square,boundary:[[-1,-3],[3,-3],[3,3],[-1,3]],segments:2};
  const saved=structuredClone(options),a=createBoundedProfileGeometry(THREE,options),b=createBoundedProfileGeometry(THREE,{...options,footprint:[...square].reverse(),boundary:[...options.boundary].reverse()});
  assert.ok(a.geometry instanceof THREE.BufferGeometry);assert.deepEqual(options,saved);
  approx(meshFacts(a.geometry,options.footprint,options.boundary),meshFacts(b.geometry,options.footprint,options.boundary));
  assert.deepEqual(canonical(a.outline),canonical(b.outline));let disposed=0;a.geometry.addEventListener('dispose',()=>disposed++);a.dispose();a.dispose();assert.equal(disposed,1);
});

test('collinear forward corners remain a valid convex polygon',()=>{
  const footprint=[[-2,-2],[0,-2],[2,-2],[2,2],[-2,2]];
  approx(area(clipConvexPolygon(footprint,square)),16);
  const r=createBoundedProfileGeometry(THREE,{footprint,boundary:square});approx(meshFacts(r.geometry,footprint,square),.8);
});

test('rejects malformed, concave, self-crossing and zero-area polygons rather than producing partial solids',()=>{
  const pentagram=Array.from({length:5},(_,i)=>{const a=i*4*Math.PI/5;return [Math.cos(a),Math.sin(a)];});
  const invalid=[null,[],[[0,0],[1,0]],[[0,0],[1,0],[0,NaN]],[[0,0],[1,0],[0,Infinity]],[[0,0],[1,0],[0,1,2]],[[0,0],[0,0],[1,1]],[[0,0],[1,0],[2,0]],[[0,0],[2,2],[0,2],[2,0]],[[0,0],[3,0],[1,1],[3,3],[0,3]],pentagram];
  for(const ring of invalid){assert.throws(()=>clipConvexPolygon(ring,square),/polygon|finite|convex|area|duplicate|intersect/i);assert.throws(()=>clipConvexPolygon(square,ring),/polygon|finite|convex|area|duplicate|intersect/i);assert.throws(()=>createBoundedProfileGeometry(THREE,{footprint:ring,boundary:square}));}
  for(const epsilon of [0,-1,NaN,Infinity,'1e-9'])assert.throws(()=>clipConvexPolygon(square,square,{epsilon}),/epsilon/i);
});

test('rejects invalid profile parameters and nonfinite sampled heights',()=>{
  const base={footprint:square,boundary:square};
  for(const thickness of [0,-1,NaN,Infinity,'0.1'])assert.throws(()=>createBoundedProfileGeometry(THREE,{...base,thickness}),/thickness/i);
  for(const segments of [0,-1,1.5,NaN,Infinity,'16'])assert.throws(()=>createBoundedProfileGeometry(THREE,{...base,segments}),/segments/i);
  for(const heightAt of [3,null,()=>NaN,()=>Infinity])assert.throws(()=>createBoundedProfileGeometry(THREE,{...base,heightAt}),/height|profile/i);
  assert.throws(()=>createBoundedProfileGeometry(THREE,{...base,epsilon:-1}),/epsilon/i);
  assert.throws(()=>createBoundedProfileGeometry(null,base),/THREE/i);
});

test('Float32 collapse never silently becomes a zero-volume solid or nonfinite buffer',()=>{
  const thinAtLargeX=[[1e8,0],[1e8+1,0],[1e8+1,1],[1e8,1]];
  assert.throws(()=>createBoundedProfileGeometry(THREE,{footprint:thinAtLargeX,boundary:thinAtLargeX}),/Float32|precision/i);
  assert.throws(()=>createBoundedProfileGeometry(THREE,{footprint:square,boundary:square,heightAt:()=>1e8,thickness:.01}),/Float32|precision/i);
  assert.throws(()=>createBoundedProfileGeometry(THREE,{footprint:square,boundary:square,heightAt:()=>1e40}),/Float32|range/i);
});

test('empty valid domains do not evaluate a profile or allocate/dispose a geometry',()=>{
  let samples=0;
  const result=createBoundedProfileGeometry(THREE,{footprint:square,boundary:square.map(([x,y])=>[x+7,y]),heightAt:()=>{samples++;return NaN;}});
  assert.equal(result,null);assert.equal(samples,0);
});

test('intersection retains all eight genuine square/diamond corners and samples variable-width strips',()=>{
  const boundary=[[-3,0],[0,-3],[3,0],[0,3]],expected=[[-2,-1],[-1,-2],[1,-2],[2,-1],[2,1],[1,2],[-1,2],[-2,1]];
  const result=createBoundedProfileGeometry(THREE,{footprint:square,boundary,heightAt:v=>.4*Math.cos(v),thickness:.1,segments:4});
  assert.deepEqual(canonical(result.outline),canonical(expected));approx(area(result.outline),14);
  approx(meshFacts(result.geometry,square,boundary),1.4);zPairs(result.geometry,v=>.4*Math.cos(v),.1);
});

test('integer triangle clipping merges arithmetic-noise profile levels without losing corners or closure',()=>{
  const footprint=[[-4,-4],[-4,-2],[4,1]],boundary=[[-1,-1],[1,-1],[1,1],[-1,1]];
  const result=createBoundedProfileGeometry(THREE,{footprint,boundary});
  assert.deepEqual(canonical(result.outline),canonical([[-1,-1],[.8,-1],[1,-.875],[1,-.125],[-1,-.875]]));
  approx(meshFacts(result.geometry,footprint,boundary),.049375);
  const p=result.geometry.getAttribute('position');
  for(const [x,y] of result.outline)assert.ok(Array.from({length:p.count},(_,i)=>i).some(i=>Math.abs(p.getX(i)-x)<1e-6&&Math.abs(p.getY(i)-y)<1e-6),'real clipped corner retained');
});

test('affine convex-domain variants retain turning corners and closed finite profile solids',()=>{
  const source=[[-4,-4],[-4,-2],[4,1]],owner=[[-1,-1],[1,-1],[1,1],[-1,1]];
  const cases=[
    [1.2,.3,0,.8,.15,-.3],
    [.75,-.2,0,1.5,2.1,1.7],
    [1.1,.2,-.3,.9,.4,-.7],
    [-.8,.25,.2,1.2,1.3,-.6]
  ];
  for(const [a,b,c,d,tx,ty] of cases) {
    const transform=ring=>ring.map(([x,y])=>[a*x+b*y+tx,c*x+d*y+ty]);
    const footprint=transform(source),boundary=transform(owner),heightAt=v=>.15+.03*v*v;
    const result=createBoundedProfileGeometry(THREE,{footprint,boundary,heightAt});
    approx(meshFacts(result.geometry,footprint,boundary),.049375*Math.abs(a*d-b*c));zPairs(result.geometry,heightAt,.05);
    const p=result.geometry.getAttribute('position');
    for(const [x,y] of result.outline)assert.ok(Array.from({length:p.count},(_,i)=>i).some(i=>Math.abs(p.getX(i)-x)<2e-6&&Math.abs(p.getY(i)-y)<2e-6),'affine turning corner retained');
  }
});

test('real sample spacing below Float32 precision remains an explicit rejection',()=>{
  const footprint=[[-1,1e8],[1,1e8],[1,1e8+1],[-1,1e8+1]];
  assert.throws(()=>createBoundedProfileGeometry(THREE,{footprint,boundary:footprint}),/sample spacing.*Float32|Float32.*precision/i);
});
