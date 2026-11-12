import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const moduleURL=new URL('../../assets/examples/region-programs.mjs',import.meta.url);
let buildRegionalArchitecture;
try { ({buildRegionalArchitecture}=await import(moduleURL)); } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
const material=new T.MeshStandardMaterial();
const create=options=>{assert.equal(typeof buildRegionalArchitecture,'function','regional architectural factory exists');return buildRegionalArchitecture(T,{materialFor:()=>material,...options});};
function ray(asset,position,direction,far=Infinity,objects=asset.root.children){asset.root.updateMatrixWorld(true);return new T.Raycaster(new T.Vector3(...position),new T.Vector3(...direction),0,far).intersectObjects(objects,true);}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} ~= ${b}`);

for(const program of ['gallery','workshop','courtyard'])test(`${program}: actual floor-level entry and thick window reveals on four sides`,()=>{
  const a=create({program});assert.deepEqual(a.root.scale.toArray(),[1,1,1]);
  const e=a.entrances[0];assert.deepEqual(e.normal,[0,0,1]);assert.equal(e.position[1],0);
  assert.equal(ray(a,[0,.12,e.position[2]+.6],[0,0,-1],.9,a.parts.walls).length,0,'doorway is open to finished floor');
  assert.ok(ray(a,[e.width/2+.25,1,e.position[2]+.6],[0,0,-1],.9,a.parts.walls).length,'door jamb is solid');
  assert.equal(a.spec.windows.length>=4,true);
  const normals=new Set();
  for(const w of a.spec.windows){
    const normal=new T.Vector3(...w.normal),center=new T.Vector3(...w.center);
    normals.add(w.normal.join(','));
    assert.equal(ray(a,center.clone().addScaledVector(normal,.7).toArray(),normal.clone().negate().toArray(),1,a.parts.walls).length,0,'window hole');
    const side=new T.Vector3(normal.z,0,-normal.x);
    const reveal=ray(a,center.toArray(),side.toArray(),w.width,a.parts.walls);
    assert.ok(reveal.length,'finite reveal belongs to the wall');close(reveal[0].distance,w.width/2);
  }
  assert.equal(normals.size,4);a.dispose();
});

test('programs have distinct actual roof topology and purpose-built interiors',()=>{
  const gallery=create({program:'gallery'}),workshop=create({program:'workshop'}),court=create({program:'courtyard'});
  assert.ok(gallery.parts.furniture.some(m=>m.name.includes('display')));
  assert.ok(workshop.parts.furniture.some(m=>m.name.includes('worktable')));
  assert.ok(workshop.parts.floors.some(m=>m.name.includes('mezzanine')));
  assert.ok(workshop.parts.roofs.some(m=>m.name.includes('vent')));
  assert.ok(gallery.parts.roofs.some(m=>m.name.includes('lantern')));
  assert.ok(court.parts.structure.filter(m=>m.name.includes('colonnade')).length>=8);
  assert.equal(ray(court,[0,12,0],[0,-1,0],20,court.parts.roofs).length,0,'courtyard open to sky');
  assert.ok(ray(gallery,[0,12,0],[0,-1,0],20,gallery.parts.roofs).length);
  assert.ok(ray(workshop,[0,12,0],[0,-1,0],20,workshop.parts.roofs).length);
  for(const a of [gallery,workshop,court])a.dispose();
});

const workshopCases=[{},
  {width:4.8,depth:3.4,height:3,wallThickness:.12,roofOverhang:.1},
  {width:4.8,depth:18,height:7,wallThickness:.45,roofOverhang:.8},
  {width:18,depth:3.4,height:3,wallThickness:.45,roofOverhang:.8},
  {width:18,depth:18,height:7,wallThickness:.12,roofOverhang:.1}];

test('workshop stair arrival is clear across tread width while the remaining edge stays guarded',()=>{
  for(const dimensions of workshopCases){
    const a=create({program:'workshop',...dimensions}),{width,depth,height,wallThickness}=a.spec;
    const x=-width*.38,y=height*.52,z=-depth/2+depth*.23+wallThickness;
    for(const dx of [-.33,0,.33])for(const dy of [.25,.55,.84]){
      assert.equal(ray(a,[x+dx,y+dy,z+.32],[0,0,-1],.64,a.parts.structure).length,0,
        `clear stair arrival at ${JSON.stringify(dimensions)} x=${dx} y=${dy}`);
    }
    for(const guardX of [0,width*.35]){
      assert.ok(ray(a,[guardX,y+.84,z+.2],[0,0,-1],.4,a.parts.structure)
        .some(h=>h.object.name==='workshop.mezzanine.rail'),'guard retained away from arrival');
    }
    a.dispose();
  }
});

test('workshop truss feet bear in real walls and rafters intersect the real roof underside',()=>{
  for(const dimensions of workshopCases){
    const a=create({program:'workshop',...dimensions}),{width,height}=a.spec;
    const trusses=a.parts.structure.filter(o=>o.name.includes('roof-truss'));
    const ties=trusses.filter(o=>o.name.endsWith('.tie'));
    assert.equal(ties.length,2);
    for(const tie of ties){
      const p=tie.geometry.attributes.position;
      for(const sign of [-1,1]){
        const vertices=Array.from({length:p.count},(_,i)=>new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(tie.matrixWorld));
        const end=vertices.filter(v=>sign*v.x>width/2-.02);
        assert.ok(end.length,'tie reaches wall bearing');
        assert.ok(end.some(v=>ray(a,[v.x,height+.1,v.z],[0,-1,0],.2,a.parts.walls).length),'actual wall at tie end');
      }
    }
    for(const rafter of trusses.filter(o=>/\.(left|right)$/.test(o.name))){
      const p=rafter.geometry.attributes.position;let above=false,below=false;
      for(let i=0;i<p.count;i++){
        // Inspect a real radial cross-section halfway along the cylinder.
        const v=new T.Vector3().fromBufferAttribute(p,i);v.y=0;v.applyMatrix4(rafter.matrixWorld);
        const roof=ray(a,[v.x,height-.5,v.z],[0,1,0],Infinity,a.parts.roofs)[0];
        assert.ok(roof,'real roof above rafter');
        above ||= v.y>roof.point.y+1e-4;below ||= v.y<roof.point.y-1e-4;
      }
      assert.ok(above&&below,'rafter thickness intersects actual roof underside');
      // The eave end connects to a vertical bearing, itself meeting the wall tie.
      const sign=rafter.name.endsWith('.left')?-1:1,z=rafter.position.z;
      const bearingHit=ray(a,[sign*width/2,height-.2,z],[0,1,0],.5,trusses)
        .find(h=>h.object.name==='workshop.roof-truss.bearing');
      assert.ok(bearingHit,'bearing joins wall-level foot');close(bearingHit.point.y,height-.055);
      const bearingBox=new T.Box3().setFromObject(bearingHit.object);
      const tie=ties.find(o=>Math.abs(o.position.z-z)<1e-5),tieBox=new T.Box3().setFromObject(tie);
      assert.ok(bearingBox.intersectsBox(tieBox),'bearing intersects the supported wall tie');
    }
    a.dispose();
  }
});

test('courtyard planter bottoms touch gravel and each complete assembly shares that datum',()=>{
  for(const dimensions of [{},{width:4.8,depth:3.4,courtyardRatio:.3},{width:4.8,depth:18,courtyardRatio:.55},{width:18,depth:3.4,courtyardRatio:.55},{width:18,depth:18,courtyardRatio:.3}]){
    const a=create({program:'courtyard',...dimensions});
    const bottoms=a.parts.planting.filter(o=>o.name==='courtyard.planter.bottom');assert.equal(bottoms.length,2);
    for(const bottom of bottoms){
      const b=new T.Box3().setFromObject(bottom),center=b.getCenter(new T.Vector3());
      const ground=ray(a,[center.x,b.min.y+.001,center.z],[0,-1,0],.2,a.parts.floors)[0];
      assert.equal(ground?.object.name,'courtyard.courtyard.gravel');close(b.min.y,ground.point.y);
      const cluster=a.parts.planting.filter(o=>Math.sign(o.position.x)===Math.sign(center.x));
      const soil=cluster.find(o=>o.name==='courtyard.planter.soil'),soilBox=new T.Box3().setFromObject(soil);
      close(soilBox.min.y,b.min.y+.21);
      for(const rim of cluster.filter(o=>o.name==='courtyard.planter.rim')){
        const r=new T.Box3().setFromObject(rim);assert.ok(r.min.y<=b.max.y&&r.max.y>=soilBox.max.y,'rims meet bottom and contain soil');
      }
      for(const stem of cluster.filter(o=>o.name==='courtyard.planting.stem')){
        const s=new T.Box3().setFromObject(stem);assert.ok(s.min.y<=soilBox.max.y&&s.max.y>=soilBox.max.y,'stems rooted in soil');
      }
    }
    a.dispose();
  }
});

test('dimensions change walls, entry, interior and complete envelope without root scaling',()=>{
  for(const program of ['gallery','workshop','courtyard']){
    const small=create({program}),large=create({program,width:12,depth:10,height:5.5});
    for(const a of [small,large]){
      const box=new T.Box3().setFromObject(a.root),f=a.footprint;
      assert.ok(box.min.x>=f.minX-1e-5&&box.max.x<=f.maxX+1e-5&&box.min.z>=f.minZ-1e-5&&box.max.z<=f.maxZ+1e-5);
      close(f.width,f.maxX-f.minX);close(f.depth,f.maxZ-f.minZ);
    }
    assert.ok(large.footprint.width>small.footprint.width);assert.ok(large.entrances[0].position[2]>small.entrances[0].position[2]);
    assert.ok(new T.Box3().setFromObject(large.parts.furniture[0]).getSize(new T.Vector3()).length()>new T.Box3().setFromObject(small.parts.furniture[0]).getSize(new T.Vector3()).length());
    small.dispose();large.dispose();
  }
});

test('every mesh has actual borrowed semantic slots; dispose owns all and only geometry',()=>{
  let borrowed=0;material.addEventListener('dispose',()=>borrowed++);
  const a=create({program:'gallery'}),meshes=[];a.root.traverse(o=>{if(o.isMesh)meshes.push(o);});
  assert.equal(a.materialBindings.length,meshes.length);
  for(const mesh of meshes){const b=a.materialBindings.find(b=>b.object===mesh);assert.ok(b);assert.equal(b.slots.length,Array.isArray(mesh.material)?mesh.material.length:1);for(const slot of b.slots){assert.ok(['stone','coating','wood','metal'].includes(slot.role));assert.equal(slot.options.maps,false);}}
  const owned=new Set(meshes.map(m=>m.geometry));let disposed=0;for(const g of owned)g.addEventListener('dispose',()=>disposed++);
  a.dispose();a.dispose();assert.equal(disposed,owned.size);assert.equal(borrowed,0);assert.equal(a.root.children.length,0);
});

test('failed material allocation releases earlier generated geometry and preserves borrowed materials',()=>{
  const geometries=[];let calls=0,disposed=0;
  class TrackingBox extends T.BoxGeometry{constructor(...args){super(...args);geometries.push(this);this.addEventListener('dispose',()=>disposed++);}}
  assert.equal(typeof buildRegionalArchitecture,'function');
  assert.throws(()=>buildRegionalArchitecture({...T,BoxGeometry:TrackingBox},{materialFor:()=>{if(++calls===12)throw new Error('allocation failure');return material;}}),/allocation failure/);
  assert.ok(geometries.length>0);assert.equal(disposed,geometries.length);
});

test('invalid parameters reject before allocating geometry',()=>{
  assert.equal(typeof buildRegionalArchitecture,'function');
  for(const options of [{program:'tower'},{width:0},{depth:NaN},{height:2},{wallThickness:2},{roofOverhang:-1},{courtyardRatio:.9},{materialFor:()=>({})}])assert.throws(()=>buildRegionalArchitecture(T,{materialFor:()=>material,...options}),/program|width|depth|height|thickness|overhang|courtyard|material/i);
});
