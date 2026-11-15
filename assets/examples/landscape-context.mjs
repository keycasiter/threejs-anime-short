import {FORMATION_ATTRIBUTE,writeFormationCoordinates} from '../geometry/formation-coordinates.mjs';
import {copyFormationGroup} from '../scene/formation-group.mjs';
import {buildRegionalArchitecture} from './region-programs.mjs';
import {createFractalHeightField,createHeightFieldGeometry} from '../environment/height-field.mjs';
import {createPlateauHeightField} from '../environment/constrained-height-field.mjs';
import {prepareTerrainRoadSupport,createTerrainRoadSource,samplePreparedTerrainSurface} from '../environment/terrain-roads.mjs';
import {compileWorldLayout} from '../scene/world-layout.mjs';
import {compileFrontageNeighborhood} from '../scene/frontage-neighborhood.mjs';
import {createAssetAssembly} from '../scene/asset-assembly.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';
import activityContextDesign from './activity-context-design.json' with {type:'json'};

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
  const activityBySide=new Map(activityContextDesign.distribution.map(([side,,activityRole])=>[side,activityRole]));
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
      const activityRole=activityBySide.get(side),activityMode=activityContextDesign.modes[`${id}/${side}`]??activityContextDesign.modes.default,activityFrame=activityContextDesign.frontageFrames[side];
      if(!activityRole||!activityMode||!activityFrame)throw Error(`Missing authored activity assignment/frame for ${regionId}`);
      regions.push({id:regionId,level:'context',outline:rectangle(...bounds),role,activityRole,activityMode,activitySide:side,activityFrame:{inward:[...activityFrame.inward]}});
      const pad=[Math.min(bounds[0],center[0]-2),Math.min(bounds[1],center[1]-2),Math.max(bounds[2],center[0]+2),Math.max(bounds[3],center[1]+2)];
      const district={id:regionId,tier:id,program,activityRole,activityMode,activitySide:side,activityFrame:{inward:[...activityFrame.inward]},bounds:pad,center};
      if(activityMode==='opposed-frontage'){
        const roadIndex={west:7,east:3,north:1,south:5}[side],road=edges.find(e=>e.id===`${id}/street/${roadIndex}`),start=nodes.find(n=>n.id===road?.from),end=nodes.find(n=>n.id===road?.to);
        if(!road||!start||!end)throw Error(`Missing real perimeter street for opposed district ${regionId}`);
        const inward=activityFrame.inward,tangent=[inward[1],-inward[0]],roadCenter=[(start.x+end.x)/2,(start.z+end.z)/2],boundary=roadCenter[0]*inward[0]+roadCenter[1]*inward[1]+road.width/2,depth=activityContextDesign.opposedApron.inwardDepth;
        let tangentMin=Infinity,tangentMax=-Infinity;for(const [x,z]of [[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]]){const t=x*tangent[0]+z*tangent[1];tangentMin=Math.min(tangentMin,t);tangentMax=Math.max(tangentMax,t);}
        const expansion=activityContextDesign.opposedApron.edgeExpansion,toWorld=([d,t])=>[inward[0]*d+tangent[0]*t,inward[1]*d+tangent[1]*t],apron=[[boundary-expansion,tangentMin-expansion],[boundary+depth+expansion,tangentMin-expansion],[boundary+depth+expansion,tangentMax+expansion],[boundary-expansion,tangentMax+expansion]].map(toWorld);
        const activityRegionId=`activity-apron/${regionId}`;
        regions.push({id:activityRegionId,level:'context',outline:apron,role:'activity-apron',sourceRegionId:regionId,activityRole,activityMode,activityFrame:{inward:[...inward]}});
        district.activityRegionId=activityRegionId;
      }
      districts.push(district);
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

function pointInRegion(point,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],cross=(point[0]-a[0])*dz-(point[1]-a[1])*dx;
  if(Math.abs(cross)<=1e-8&&point[0]>=Math.min(a[0],b[0])-1e-8&&point[0]<=Math.max(a[0],b[0])+1e-8&&point[1]>=Math.min(a[1],b[1])-1e-8&&point[1]<=Math.max(a[1],b[1])+1e-8)return true;
  if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
function nextRoadBoundary(origin,direction,surfaces){
 const hits=[];
 for(const surface of surfaces)for(const ring of [surface.outer,...surface.holes])for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],ex=b[0]-a[0],ez=b[1]-a[1],den=direction[0]*ez-direction[1]*ex;
  if(Math.abs(den)<1e-10)continue;
  const ax=a[0]-origin[0],az=a[1]-origin[1],t=(ax*ez-az*ex)/den,u=(ax*direction[1]-az*direction[0])/den;
  if(t>1e-5&&u>=-1e-8&&u<=1+1e-8)hits.push(t);
 }
 hits.sort((a,b)=>a-b);const t=hits.find((v,i)=>i===0||v-hits[i-1]>1e-7);return t===undefined?null:[origin[0]+direction[0]*t,origin[1]+direction[1]*t,t];
}

/** List finite, direction-compatible route candidates for opposed activity regions.
 * Door coordinates/normals remain authored port anchors; section dimensions are
 * measured from final sourceRanges. No activity geometry, apron support, conflict
 * or cross-street arrival has passed the activity-court qualifier yet. */
export function createOpposedActivityGateCandidates({design,layout,sites,roads,sampleTerrain}={}){
 if(!Array.isArray(design?.districts)||!Array.isArray(design?.regions)||!Array.isArray(layout?.levels)||!Array.isArray(sites)||typeof roads?.query!=='function'||typeof sampleTerrain!=='function')throw new TypeError('Authored context design, compiled road layout, actual sites, roads and final terrain sampler are required');
 const street=layout.levels.find(level=>level.id==='context');if(!street?.surfaces?.length)throw new Error('Compiled context road union is required');
 const apronById=new Map(design.regions.filter(r=>r.role==='activity-apron').map(r=>[r.id,r])),groups=[],unresolved=[];
 for(const district of [...design.districts].filter(d=>d.activityMode==='opposed-frontage').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
  const inward=district.activityFrame?.inward,apron=apronById.get(district.activityRegionId);if(!Array.isArray(inward)||inward.length!==2||!inward.every(Number.isFinite)||Math.abs(Math.hypot(...inward)-1)>1e-8||!apron){unresolved.push({districtId:district.id,reason:'missing-or-invalid-authored-frame-or-apron'});continue;}
  const tangent=[inward[1],-inward[0]],center=[district.center[0],district.center[1]];
  const sources=sites.filter(site=>site.regionId===district.id&&site.activityRole===district.activityRole&&site.activityMode==='opposed-frontage'&&site.entryMeasurement?.method==='final-sourceRanges-entry-section'&&Array.isArray(site.entrance?.normal)&&Math.hypot(site.entrance.normal[0]-inward[0],site.entrance.normal[2]-inward[1])<=1e-3)
    .map(site=>({site,tangentOffset:Math.abs((site.entrance.position[0]-center[0])*tangent[0]+(site.entrance.position[2]-center[1])*tangent[1])}))
    .sort((a,b)=>a.tangentOffset-b.tangentOffset||(a.site.id<b.site.id?-1:a.site.id>b.site.id?1:0)).slice(0,16);
  const candidates=[];
  for(const {site,tangentOffset}of sources){
   const boundary=nextRoadBoundary([site.route.end[0],site.route.end[2]],inward,street.surfaces);if(!boundary)continue;
   const [x,z,roadCrossingDistance]=boundary,gateInset=activityContextDesign.opposedApron.gateInset,gateXZ=[x+inward[0]*gateInset,z+inward[1]*gateInset];if(!pointInRegion(gateXZ,apron.outline))continue;
   const roadTopSample=[x-inward[0]*1e-4,z-inward[1]*1e-4],support=roads.query(...roadTopSample),ground=sampleTerrain(...gateXZ);if(!support||!Number.isFinite(support.topHeight)||!ground||!Number.isFinite(ground.height)||!Array.isArray(ground.normal)||ground.normal.length!==3||!ground.normal.every(Number.isFinite))continue;
   candidates.push({sourceSiteId:site.id,sourceRegionId:site.regionId,activityRole:district.activityRole,activityRegionId:district.activityRegionId,activitySide:district.activitySide,normal:[inward[0]||0,0,inward[1]||0],tangentOffset,roadCrossingDistance,nominalEntranceHint:{position:[...site.entrance.position],width:site.entrance.width,height:site.entrance.height},measuredEntrance:site.entryMeasurement,nominalConnectorHint:{start:[...site.route.start],streetFace:[...site.route.end],width:site.route.width},sourceMeasurementStatus:'entry-section-measured',requiresDoorSectionMeasurement:false,streetExit:{xz:[x,z],roadTopSample,roadTopHeight:support.topHeight},gate:{xz:gateXZ,groundY:ground.height,groundNormal:[...ground.normal],hostYSource:'final-rendered-terrain-triangle'}});
  }
  if(!candidates.length)unresolved.push({districtId:district.id,reason:sources.length?'no-qualified-road-boundary-in-apron':'no-compatible-real-building-mouth'});
  groups.push({districtId:district.id,activityRegionId:district.activityRegionId,candidates});
 }
 const deferredSameSideRegionIds=design.districts.filter(d=>d.activityMode==='same-side-free-frontage').map(d=>d.id).sort();
 return {status:unresolved.length?'unsatisfied':'route-candidates-ready',groups:unresolved.length?[]:groups,unresolved,deferredSameSideRegionIds,candidateLimit:16};
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
export function buildLandscapeContext(T,{mergeGeometries,materialFor,siteBounds=[-25,-25,25,25],configuration='grid',gateways,coordinateOrigin=[0,0]}={}){
  if(typeof materialFor!=='function'||typeof mergeGeometries!=='function')throw TypeError('Inject materialFor and mergeGeometries');
  const scope=createResourceScope(),sourceScope=createResourceScope(),assets=new Map(),root=new T.Group(),sites=[],materialBindings=[],prototypes=[],bakedBoundarySources=[];
  root.name='landscape-context';scope.defer(()=>root.removeFromParent());
  const buckets=new Map(),canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):v;
  function staticAdd(g,material,binding,settings){const key=JSON.stringify(canonical(binding));if(!buckets.has(key))buckets.set(key,{binding,assembly:scope.own(createAssetAssembly(T,{mergeGeometries,invariantAttributes:{[FORMATION_ATTRIBUTE]:3}}))});buckets.get(key).assembly.add(g,material,settings);}
  function bake(asset,lot){
    const semantics=new Map(asset.materialBindings.map(b=>[b.object,b.slots]));asset.root.updateWorldMatrix(true,true);
    const sourceIds=new Map();
    for(const [index,{source,part}]of asset.boundarySources.entries()){
      const id=`${lot.id}/boundary/${index}`,g=source.geometry;
      sourceIds.set(part,id);
      bakedBoundarySources.push({id,siteId:lot.id,prototypeId:lot.prototypeId,metadata:structuredClone(source.metadata),sourceGeometryId:g.uuid,sourceSpace:'context-root-local',sourceMatrix:part.matrixWorld.toArray(),semantic:structuredClone(semantics.get(part)[0]),triangleCount:g.index.count/3,disposed:true,sourceRanges:[]});
    }
    const entryParts={reveals:asset.entryBinding.reveals,jambs:asset.entryBinding.jambs,header:[asset.entryBinding.header],lintel:[asset.entryBinding.lintel],deck:[asset.entryBinding.deck]},entryRangeIds={};
    for(const [kind,parts]of Object.entries(entryParts))entryRangeIds[kind]=parts.map((part,index)=>{
      const id=kind==='reveals'?`${lot.id}/entry/reveal/${index}`:`${lot.id}/entry/${kind}/${index}`,g=part.geometry;sourceIds.set(part,id);
      bakedBoundarySources.push({id,siteId:lot.id,prototypeId:lot.prototypeId,metadata:{kind:kind==='reveals'?'entry-reveal-inner-face':`entry-${kind}`,side:kind==='reveals'?(index===0?'left':'right'):undefined},sourceGeometryId:g.uuid,sourceSpace:'context-root-local',sourceMatrix:part.matrixWorld.toArray(),semantic:structuredClone(semantics.get(part)[0]),triangleCount:(g.index?.count??g.attributes.position.count)/3,disposed:true,sourceRanges:[]});
      return id;
    });
    asset.root.traverse(object=>{if(!object.isMesh)return;const slots=semantics.get(object),materials=Array.isArray(object.material)?object.material:[object.material],g=object.geometry;
      for(const group of g.groups.length?g.groups:[{start:0,count:g.index?.count??g.attributes.position.count,materialIndex:0}]){
        const copy=copyFormationGroup(T,g,group);try{staticAdd(copy,materials[group.materialIndex]??materials[0],slots[group.materialIndex]??slots[0],{matrix:object.matrixWorld,castShadow:false,receiveShadow:false,layers:object.layers.mask,sourceId:sourceIds.get(object)});}finally{copy.dispose();}
      }
    });
    return entryRangeIds;
  }
  function releaseSources(){try{sourceScope.dispose();}finally{assets.clear();}}
  try{
    const design=createLandscapeContextDesign({configuration,gateways}),layout=compileWorldLayout(design),familiesByRole={};
    for(const tier of TIERS)for(const program of ['gallery','workshop','courtyard'])for(const variant of ['compact','long']){
      const role=`${tier.id}/${program}`,id=`${role}/${variant}`,asset=sourceScope.own(buildRegionalArchitecture(T,{program,width:tier.width*(variant==='long'?1.12:1),depth:tier.depth,height:tier.height,courtyardRatio:variant==='long'?.5:.44,frameStock:{mode:program==='courtyard'?'continuous-bow-with-sill':'independent-rails'},materialFor}));
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
    const terrainSupport=scope.own(prepareTerrainRoadSupport({terrainGeometry,coordinateOrigin}));
    const roads=scope.own(createTerrainRoadSource(T,{surfaces:layout.levels[0].surfaces,terrainSupport,thickness,maxCandidatePairs:4000000,maxValidationPairs:8000000}));
    writeFormationCoordinates(T,roads.geometry);
    const roadSlot={role:'stone',options:{maps:false,baseColor:0xbcb49d,color:0xffffff}},road=new T.Mesh(roads.geometry,materialFor(roadSlot.role,roadSlot.options));road.position.fromArray(roads.position);road.name='context-street-network';road.receiveShadow=true;root.add(road);materialBindings.push({object:road,slots:[roadSlot,roadSlot,roadSlot]});
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
      const connectorMesh=new T.Mesh(connector.geometry,materialFor(roadSlot.role,roadSlot.options));connectorMesh.position.fromArray(connector.position);connectorMesh.name=`${lot.id}/arrival`;connectorMesh.receiveShadow=true;root.add(connectorMesh);materialBindings.push({object:connectorMesh,slots:[roadSlot,roadSlot,roadSlot]});
      const entryRangeIds=bake(asset,lot);
      const district=design.districts.find(d=>d.id===lot.regionId);if(!district)throw Error(`Accepted lot references an unknown authored district: ${lot.regionId}`);
      sites.push({id:lot.id,prototypeId:lot.prototypeId,regionId:lot.regionId,edgeId:lot.edgeId,groupId:lot.groupId,tier:lot.regionId.split('/')[0],program:asset.spec.program,activityRole:district.activityRole,activityMode:district.activityMode,activityRegionId:district.activityRegionId??district.id,footprint:lot.footprint,groundY,baseY,position:asset.root.position.toArray(),rotation:lot.pose.rotationY,spec:asset.spec,measuredBounds:prototype.measuredBounds,entrance:{position:asset.root.localToWorld(new T.Vector3(...prototype.entrance.position)).toArray(),normal:normal.toArray(),width:prototype.entrance.width,height:prototype.entrance.height},entryRangeIds,partCounts:Object.fromEntries(Object.entries(asset.parts).map(([k,v])=>[k,v.length])),route:{surface,roadCenter,start:start.toArray(),end:leftEnd.clone().add(rightEnd).multiplyScalar(.5).toArray(),width,mesh:connectorMesh}});
    }
    // Source prototypes have finished serving measurement and baking consumers.
    releaseSources();
    const settlement=new T.Group(),stats={staticInputs:0,staticMeshes:0,staticTriangles:0,dynamicRoots:0};settlement.name='merged-settlement';root.add(settlement);
    const boundaryById=new Map(bakedBoundarySources.map(record=>[record.id,record])),sourceRangeById=new Map();
    for(const {assembly,binding}of buckets.values()){const merged=assembly.finish();settlement.add(merged.root);for(const key of Object.keys(stats))stats[key]+=merged.stats[key];
      for(const range of merged.sourceRanges){const {sourceId,object,geometry,vertexStart,vertexCount}=range;if(!sourceRangeById.has(sourceId))sourceRangeById.set(sourceId,[]);sourceRangeById.get(sourceId).push(range);const record=boundaryById.get(sourceId);if(record)record.sourceRanges.push({sourceId,objectId:object.uuid,geometryId:geometry.uuid,vertexStart,vertexCount});}
      merged.root.traverse(o=>{if(o.isMesh)materialBindings.push({object:o,slots:[binding]});});}
    for(const site of sites){
      const rangesFor=ids=>ids.map(id=>sourceRangeById.get(id)),revealRanges=rangesFor(site.entryRangeIds.reveals),jambRanges=rangesFor(site.entryRangeIds.jambs),headerRanges=rangesFor(site.entryRangeIds.header).flat(),lintelRanges=rangesFor(site.entryRangeIds.lintel).flat(),deckRanges=rangesFor(site.entryRangeIds.deck).flat();
      if(revealRanges.length!==2||[...revealRanges,...jambRanges].some(r=>!r?.length)||!headerRanges.length||!lintelRanges.length||!deckRanges.length)throw new Error(`Final entry section source ranges missing for ${site.id}`);
      const normal=[site.entrance.normal[0],site.entrance.normal[2]],axis=[site.entrance.normal[2],-site.entrance.normal[0]],extents=(ranges,direction)=>{let lo=Infinity,hi=-Infinity,minY=Infinity,maxY=-Infinity;for(const range of ranges){const p=range.geometry.getAttribute('position');for(let i=range.vertexStart;i<range.vertexStart+range.vertexCount;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),v=x*direction[0]+z*direction[1];lo=Math.min(lo,v);hi=Math.max(hi,v);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}return {lo,hi,minY,maxY,center:(lo+hi)/2};};
      const reveals=revealRanges.map(ranges=>extents(ranges,axis)).sort((a,b)=>a.center-b.center),clearWidth=reveals[1].lo-reveals[0].hi,header=extents(headerRanges,axis),lintel=extents(lintelRanges,axis),deckSide=extents(deckRanges,axis),deckNormal=extents(deckRanges,normal),deckFront=deckNormal.hi;
      const clearHeight=Math.min(header.minY,lintel.minY)-deckSide.maxY,thresholdHeight=deckSide.maxY;if(![clearWidth,clearHeight,thresholdHeight,deckFront].every(Number.isFinite)||clearWidth<=0||clearHeight<=0)throw new Error(`Final entry section does not bound an open doorway for ${site.id}`);
      site.entryMeasurement={method:'final-sourceRanges-entry-section',sourceRangeIds:Object.values(site.entryRangeIds).flat(),revealSourceRangeIds:[...site.entryRangeIds.reveals],clearWidth,clearHeight,thresholdHeight,deckOuterEdge:deckFront,deckInnerEdge:deckNormal.lo,deckWidth:deckSide.hi-deckSide.lo,sourceRangeCount:Object.values(site.entryRangeIds).flat().reduce((count,id)=>count+(sourceRangeById.get(id)?.length??0),0),sourceGeometryIds:[...new Set(Object.values(site.entryRangeIds).flat().flatMap(id=>(sourceRangeById.get(id)??[]).map(r=>r.geometry.uuid)))]};
    }
    let disposed=false;return {root,terrain,field,sites,materialBindings,bakedBoundarySources,layout,design,neighborhood,prototypes,roads,sampleTerrainSurface:(x,z)=>samplePreparedTerrainSurface(terrainSupport,x,z),gateways:design.gateways,stats:Object.freeze(stats),dispose(){if(disposed)return;disposed=true;scope.dispose();root.clear();}};
  }catch(error){
    const errors=[error];try{releaseSources();}catch(cleanupError){errors.push(cleanupError);}try{scope.dispose();}catch(cleanupError){errors.push(cleanupError);}
    if(errors.length>1)throw new AggregateError(errors,'Context build/cleanup failed');throw error;
  }
}
