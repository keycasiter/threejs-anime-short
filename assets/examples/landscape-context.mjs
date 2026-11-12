import {FORMATION_ATTRIBUTE,writeFormationCoordinates} from '../geometry/formation-coordinates.mjs';
import {copyFormationGroup} from '../scene/formation-group.mjs';
import {buildRegionalArchitecture} from './region-programs.mjs';
import {createFractalHeightField,createHeightFieldGeometry} from '../environment/height-field.mjs';
import {createPlateauHeightField} from '../environment/constrained-height-field.mjs';
import {prepareTerrainRoadSupport,createTerrainRoadSource} from '../environment/terrain-roads.mjs';
import {compileWorldLayout} from '../scene/world-layout.mjs';
import {compileFrontageNeighborhood} from '../scene/frontage-neighborhood.mjs';
import {createAssetAssembly} from '../scene/asset-assembly.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';

const rectangle=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
const MOUTH_LENGTH=4,TERRAIN_SIZE=240,TERRAIN_SEGMENTS=160;
const TIERS=[{id:'near',x:35,z:30,length:44,width:6.2,depth:4.8,height:3.2},{id:'regional',x:62,z:56,length:50,width:7.8,depth:5.8,height:3.8},{id:'distant',x:90,z:82,length:54,width:9.2,depth:6.6,height:4.5}];

/** Authored district graph, rather than authored building positions. Ring retains
 * enclosed public courts; the other configurations open alternating perimeter
 * segments into branches. Junction clearances and group gaps are public spaces.
 */
export function createLandscapeContextDesign({configuration='grid',gateways}={}){
  if(!['grid','ring','terraced'].includes(configuration))throw Error('Unknown context configuration');
  gateways??=[-1,1].map(side=>({id:`gateway/${side}`,center:[side*(configuration==='ring'?22:18),0,configuration==='ring'?-7:0],normal:[side,0,0],width:2.6}));
  if(!Array.isArray(gateways)||gateways.length!==2)throw Error('Two campus gateway ports required');
  const vec3=v=>Array.isArray(v)&&v.length===3&&[v[0],v[1],v[2]].every(Number.isFinite);
  for(const g of gateways){
    if(!vec3(g?.center)||g.center[1]!==0||!vec3(g.normal)||g.normal[1]!==0||Math.abs(Math.hypot(...g.normal)-1)>1e-10||!Number.isFinite(g.width)||g.width<1e-5)throw Error('Gateway requires a finite ground-level center, horizontal unit normal and positive representable width');
  }
  const nodes=[],edges=[],regions=[],districts=[],openEnds=[];
  const add=(id,from,to,width=3)=>edges.push({id,from,to,width});
  for(const tier of TIERS){
    const {id,x,z,length}=tier,points=[[-x,-z],[0,-z],[x,-z],[x,0],[x,z],[0,z],[-x,z],[-x,0]];
    points.forEach(([x,z],i)=>nodes.push({id:`${id}/${i}`,x,z}));
    for(let i=0;i<8;i++)if(configuration==='ring'||id==='near'||![0,4].includes(i))add(`${id}/street/${i}`,`${id}/${i}`,`${id}/${(i+1)%8}`,id==='near'?2.8:3.2);
    const halfRoad=id==='near'?1.4:1.6;
    const specs=[['west','workshop',[-x-13,-length/2,-x-halfRoad,length/2],[-x,0]],['east','courtyard',[x+halfRoad,-length/2,x+15,length/2],[x,0]],['north','gallery',[-length/2,-z-13,length/2,-z-halfRoad],[0,-z]],['south','courtyard',[-length/2,z+halfRoad,length/2,z+15],[0,z]]];
    for(const [side,program,bounds,center]of specs){
      const regionId=`${id}/${side}`,role=`${id}/${program}`;
      regions.push({id:regionId,level:'context',outline:rectangle(...bounds),role});
      const pad=[Math.min(bounds[0],center[0]-2),Math.min(bounds[1],center[1]-2),Math.max(bounds[2],center[0]+2),Math.max(bounds[3],center[1]+2)];
      districts.push({id:regionId,tier:id,program,bounds:pad,center});
    }
  }
  for(let i=1;i<TIERS.length;i++)for(const side of [3,7])add(`radial/${i}/${side}`,`${TIERS[i-1].id}/${side}`,`${TIERS[i].id}/${side}`,3.4);
  for(const [i,g]of gateways.entries()){
    const id=`campus/${i}`,[x,,z]=g.center,[nx,,nz]=g.normal,frame=TIERS[0];
    // Meet the near street on the side hit by the outward ray. Reserve room
    // for the full-width initial strip and the turn before the perimeter.
    const clear=Math.max(MOUTH_LENGTH,g.width/2+1.4);
    if(Math.abs(x)+Math.abs(nz)*g.width/2>=frame.x-1.4||Math.abs(z)+Math.abs(nx)*g.width/2>=frame.z-1.4)throw Error('Gateway face must fit inside the near street perimeter');
    const tx=nx===0?Infinity:(Math.sign(nx)*frame.x-x)/nx,tz=nz===0?Infinity:(Math.sign(nz)*frame.z-z)/nz;
    const xSide=tx<=tz,near=nodes.find(n=>n.id===`near/${xSide?(nx>0?3:7):(nz>0?5:1)}`);
    const travel=Math.min(tx,tz)-clear/Math.abs(xSide?nx:nz);
    if(travel<MOUTH_LENGTH)throw Error('Gateway lacks four units of straight mouth and clearance to turn inside the near street');
    nodes.push({id,x,z});openEnds.push(id);
    if((near.x-x)*nz===(near.z-z)*nx)add(`campus/${i}/mouth`,id,near.id,g.width);
    else{const elbow=`campus/${i}/elbow`;nodes.push({id:elbow,x:x+nx*travel,z:z+nz*travel});add(`campus/${i}/mouth`,id,elbow,g.width);add(`campus/${i}/join`,elbow,near.id,g.width);}
  }
  return {topology:configuration==='ring'?'enclosed-courts':'alternating-branches',levels:[{id:'context',y:0,nodes,edges,openEnds}],regions,districts,gateways};
}

// Evaluate the rectangular threshold plateau in (outward, across) coordinates.
// Rotate field derivatives as well as positions so the rendered shading follows it.
function gatewayPlateau(field,g,thickness){
  const [x,,z]=g.center,[nx,,nz]=g.normal,half=g.width/2,height=g.center[1]+.16-thickness;
  // An entire contributing grid cell must fit behind the mouth's support.
  const pad=Math.max(2,TERRAIN_SIZE/TERRAIN_SEGMENTS*(Math.abs(nx)+Math.abs(nz)));
  // Preserve the original axis-aligned plateau and its world-space config.
  if(nz===0){const end=x+nx*MOUTH_LENGTH;return createPlateauHeightField({field,bounds:[Math.min(x,end)-pad,z-half-pad,Math.max(x,end)+pad,z+half+pad],height,falloff:3});}
  const local=createPlateauHeightField({height,bounds:[-pad,-half-pad,MOUTH_LENGTH+pad,half+pad],falloff:3,
    field:{sample(t,u){const p=field.sample(x+nx*t+nz*u,z+nz*t-nx*u);return {height:p.height,dx:nx*p.dx+nz*p.dz,dz:nz*p.dx-nx*p.dz};}}});
  function sample(px,pz){const p=local.sample(nx*(px-x)+nz*(pz-z),nz*(px-x)-nx*(pz-z));return {height:p.height,dx:nx*p.dx+nz*p.dz,dz:nz*p.dx-nx*p.dz};}
  return Object.freeze({config:Object.freeze({localPlateau:local.config,origin:Object.freeze([x,z]),outward:Object.freeze([nx,nz])}),sample,heightAt:(x,z)=>sample(x,z).height,normalAt(x,z){const p=sample(x,z),l=Math.hypot(p.dx,1,p.dz);return [-p.dx/l,1/l,-p.dz/l];}});
}

/** Shared region→prototype→lot→host→road chain. All instances consume the exact
 * measured prototypes, and the final terrain is frozen before road tessellation.
 * Static assembly keys are semantic slots, even when every slot borrows one clay.
 */
export function buildLandscapeContext(T,{mergeGeometries,materialFor,siteBounds=[-25,-25,25,25],configuration='grid',gateways}={}){
  if(typeof materialFor!=='function'||typeof mergeGeometries!=='function')throw TypeError('Inject materialFor and mergeGeometries');
  const scope=createResourceScope(),sourceScope=createResourceScope(),assets=new Map(),root=new T.Group(),sites=[],materialBindings=[],prototypes=[];
  root.name='landscape-context';scope.defer(()=>root.removeFromParent());
  const buckets=new Map(),canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):v;
  function staticAdd(g,material,binding,settings){const key=JSON.stringify(canonical(binding));if(!buckets.has(key))buckets.set(key,{binding,assembly:scope.own(createAssetAssembly(T,{mergeGeometries,invariantAttributes:{[FORMATION_ATTRIBUTE]:3}}))});buckets.get(key).assembly.add(g,material,settings);}
  function bake(asset){
    const semantics=new Map(asset.materialBindings.map(b=>[b.object,b.slots]));asset.root.updateWorldMatrix(true,true);
    asset.root.traverse(object=>{if(!object.isMesh)return;const slots=semantics.get(object),materials=Array.isArray(object.material)?object.material:[object.material],g=object.geometry;
      for(const group of g.groups.length?g.groups:[{start:0,count:g.index?.count??g.attributes.position.count,materialIndex:0}]){
        const copy=copyFormationGroup(T,g,group);try{staticAdd(copy,materials[group.materialIndex]??materials[0],slots[group.materialIndex]??slots[0],{matrix:object.matrixWorld,castShadow:false,receiveShadow:false,layers:object.layers.mask});}finally{copy.dispose();}
      }
    });
  }
  function releaseSources(){try{sourceScope.dispose();}finally{assets.clear();}}
  try{
    const design=createLandscapeContextDesign({configuration,gateways}),layout=compileWorldLayout(design),familiesByRole={};
    for(const tier of TIERS)for(const program of ['gallery','workshop','courtyard'])for(const variant of ['compact','long']){
      const role=`${tier.id}/${program}`,id=`${role}/${variant}`,asset=sourceScope.own(buildRegionalArchitecture(T,{program,width:tier.width*(variant==='long'?1.12:1),depth:tier.depth,height:tier.height,courtyardRatio:variant==='long'?.5:.44,materialFor}));
      // Capture each owned prototype once, before any lot translation or rotation.
      for(const {object} of asset.materialBindings)if(!object.geometry.hasAttribute(FORMATION_ATTRIBUTE))writeFormationCoordinates(T,object.geometry);
      const bounds=new T.Box3().setFromObject(asset.root),deck=asset.parts.floors.find(p=>p.name.endsWith('entry.deck')),deckBounds=new T.Box3().setFromObject(deck);
      const prototype={id,footprint:asset.footprint,entrance:asset.entrances[0],spec:asset.spec,measuredBounds:{minY:bounds.min.y,maxY:bounds.max.y},deckFront:deckBounds.max.z};
      prototypes.push(prototype);assets.set(id,asset);(familiesByRole[role]??=[]).push(id);
    }
    const neighborhood=compileFrontageNeighborhood({layout,level:'context',prototypes,familiesByRole,seed:72,gap:1.4,setback:.8,endClearance:5,groupSizeRange:[2,3],groupGap:4,maxCandidates:16384});
    if(neighborhood.diagnostics.status!=='complete')throw Error('Context frontage budget exhausted');
    let field=createFractalHeightField({seed:71,baseHeight:-1.1,amplitude:10,baseFrequency:.013,octaves:3,persistence:.4});
    field=createPlateauHeightField({field,bounds:siteBounds,height:-.44,falloff:9});
    const hosts=new Map();
    for(const district of design.districts){const h=field.heightAt(...district.center),b=district.bounds;hosts.set(district.id,h);field=createPlateauHeightField({field,bounds:[b[0]-2,b[1]-2,b[2]+2,b[3]+2],height:h,falloff:3});}
    // The common road thickness comes from the measured floor depth, rather
    // than an assumed asset origin. This example supports one shared threshold
    // offset; incompatible prototype floors require a different host design.
    const thickness=-prototypes[0].measuredBounds.minY;
    if(!(thickness>0)||prototypes.some(p=>Math.abs(p.measuredBounds.minY+thickness)>1e-6))throw Error('Context prototypes require one measured floor-to-host datum');
    for(const g of design.gateways)field=gatewayPlateau(field,g,thickness);
    const terrainGeometry=scope.own(createHeightFieldGeometry(T,field,{sizeX:TERRAIN_SIZE,sizeZ:TERRAIN_SIZE,segmentsX:TERRAIN_SEGMENTS,segmentsZ:TERRAIN_SEGMENTS}));
    writeFormationCoordinates(T,terrainGeometry);
    const terrainSlot={role:'stone',options:{maps:false,baseColor:0x88957b,color:0xffffff}},terrain=new T.Mesh(terrainGeometry,materialFor(terrainSlot.role,terrainSlot.options));terrain.name='continuous-terrain';terrain.receiveShadow=true;root.add(terrain);materialBindings.push({object:terrain,slots:[terrainSlot]});
    const terrainSupport=scope.own(prepareTerrainRoadSupport({terrainGeometry}));
    const roads=scope.own(createTerrainRoadSource(T,{surfaces:layout.levels[0].surfaces,terrainSupport,thickness,maxCandidatePairs:4000000,maxValidationPairs:8000000}));
    writeFormationCoordinates(T,roads.geometry);
    const roadSlot={role:'stone',options:{maps:false,baseColor:0xbcb49d,color:0xffffff}},road=new T.Mesh(roads.geometry,materialFor(roadSlot.role,roadSlot.options));road.name='context-street-network';road.receiveShadow=true;root.add(road);materialBindings.push({object:road,slots:[roadSlot,roadSlot,roadSlot]});
    for(const lot of neighborhood.lots){
      const prototype=prototypes.find(p=>p.id===lot.prototypeId),asset=assets.get(lot.prototypeId),groundY=hosts.get(lot.regionId),baseY=groundY-prototype.measuredBounds.minY;
      asset.root.position.set(lot.pose.position[0],baseY,lot.pose.position[2]);asset.root.rotation.y=lot.pose.rotationY;asset.root.updateWorldMatrix(true,true);
      const start=asset.root.localToWorld(new T.Vector3(0,0,prototype.deckFront)),normal=new T.Vector3(...lot.entrance.normal),side=new T.Vector3(normal.z,0,-normal.x),width=prototype.entrance.width+.3;
      const roadCenter=[lot.entrance.roadPoint[0]+normal.x*.2,lot.entrance.roadPoint[2]+normal.z*.2],end=new T.Vector3(roadCenter[0],baseY,roadCenter[1]);
      // Intersect the actual road union boundary along both sides. Junctions
      // cannot be certified by the nominal edge width alone.
      function boundary(origin){const d=end.clone().sub(start);let best=null;for(const s of layout.levels[0].surfaces)for(const ring of [s.outer,...s.holes])for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],ex=b[0]-a[0],ez=b[1]-a[1],den=d.x*ez-d.z*ex;if(Math.abs(den)<1e-9)continue;const ax=a[0]-origin.x,az=a[1]-origin.z,t=(ax*ez-az*ex)/den,u=(ax*d.z-az*d.x)/den;if(t>=0&&t<=1+1e-7&&u>=0&&u<=1&&(!best||t<best.t))best={t,point:origin.clone().addScaledVector(d,t)};}if(!best)throw Error('Context entry lacks actual road boundary');return best.point;}
      const left=start.clone().addScaledVector(side,-width/2),right=start.clone().addScaledVector(side,width/2),leftEnd=boundary(left),rightEnd=boundary(right),surface={outer:[left,right,rightEnd,leftEnd].map(p=>[p.x,p.z])};
      const connector=scope.own(createTerrainRoadSource(T,{surfaces:[surface],terrainSupport,thickness}));
      writeFormationCoordinates(T,connector.geometry);
      const connectorMesh=new T.Mesh(connector.geometry,materialFor(roadSlot.role,roadSlot.options));connectorMesh.name=`${lot.id}/arrival`;connectorMesh.receiveShadow=true;root.add(connectorMesh);materialBindings.push({object:connectorMesh,slots:[roadSlot,roadSlot,roadSlot]});
      bake(asset);
      sites.push({id:lot.id,prototypeId:lot.prototypeId,regionId:lot.regionId,edgeId:lot.edgeId,groupId:lot.groupId,tier:lot.regionId.split('/')[0],program:asset.spec.program,footprint:lot.footprint,groundY,baseY,position:asset.root.position.toArray(),rotation:lot.pose.rotationY,spec:asset.spec,measuredBounds:prototype.measuredBounds,entrance:{position:asset.root.localToWorld(new T.Vector3(...prototype.entrance.position)).toArray(),normal:normal.toArray(),width:prototype.entrance.width},partCounts:Object.fromEntries(Object.entries(asset.parts).map(([k,v])=>[k,v.length])),route:{surface,roadCenter,start:start.toArray(),end:leftEnd.clone().add(rightEnd).multiplyScalar(.5).toArray(),width,mesh:connectorMesh}});
    }
    // Source prototypes have finished serving measurement and baking consumers.
    releaseSources();
    const settlement=new T.Group(),stats={staticInputs:0,staticMeshes:0,staticTriangles:0,dynamicRoots:0};settlement.name='merged-settlement';root.add(settlement);
    for(const {assembly,binding}of buckets.values()){const merged=assembly.finish();settlement.add(merged.root);for(const key of Object.keys(stats))stats[key]+=merged.stats[key];merged.root.traverse(o=>{if(o.isMesh)materialBindings.push({object:o,slots:[binding]});});}
    let disposed=false;return {root,terrain,field,sites,materialBindings,layout,design,neighborhood,prototypes,roads,gateways:design.gateways,stats:Object.freeze(stats),dispose(){if(disposed)return;disposed=true;scope.dispose();root.clear();}};
  }catch(error){
    const errors=[error];try{releaseSources();}catch(cleanupError){errors.push(cleanupError);}try{scope.dispose();}catch(cleanupError){errors.push(cleanupError);}
    if(errors.length>1)throw new AggregateError(errors,'Context build/cleanup failed');throw error;
  }
}
