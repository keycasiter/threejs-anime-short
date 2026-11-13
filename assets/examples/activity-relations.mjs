import design from './activity-design.json' with {type:'json'};
import {buildRegionalArchitecture} from './region-programs.mjs';
import {buildActivityPrototype,scanActivityDraws,measureActivityPrototype,measureActivitySection,captureActivityTop,addActivityDraws,verifyActivityRanges,activityRectangle,triangleNormalY,createActivityMeasurementBudget,measureActivityFinalMember,createActivitySubmissionIndex,submitActivityQualification} from './activity-geometry.mjs';
import {compileWorldLayout} from '../scene/world-layout.mjs';
import {compileFrontageNeighborhood} from '../scene/frontage-neighborhood.mjs';
import {createHeightFieldGeometry} from '../environment/height-field.mjs';
import {prepareTerrainRoadSupport,createTerrainRoadSource} from '../environment/terrain-roads.mjs';
import {createAssetAssembly} from '../scene/asset-assembly.mjs';
import {FORMATION_ATTRIBUTE,writeFormationCoordinates} from '../geometry/formation-coordinates.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';
import {qualifyActivityCourt} from '../scene/activity-court.mjs';

const copy=x=>structuredClone(x),rect=activityRectangle;
const plainFacts=x=>JSON.parse(JSON.stringify(x,(k,v)=>['prototypeOwner','owner'].includes(k)?undefined:v));
const assert=(ok,message)=>{if(!ok)throw new Error('Activity relation: '+message);};
const yRange=faces=>[Math.min(...faces.flatMap(f=>f.p.map(p=>p[1]))),Math.max(...faces.flatMap(f=>f.p.map(p=>p[1])))];

/** Complete authored example, with the same pure court kernel and native
 * source/assembly/scope chain. All materialFor results remain caller-owned.
 * Changes construct real geometry before qualification; failure owns no slot. */
export function buildActivityRelation(T,{
 kind='exchange',mergeGeometries,materialFor,pressFrontOffset=0,pressFootOffset=0,islandHoleExtra=0,failAfterBake=false,measurementLimit=2000000,qualificationLimits
}={}){
 assert(['exchange','exhibit'].includes(kind),'unknown relation');assert(String(T.REVISION)==='180','requires r180');
 assert(typeof mergeGeometries==='function'&&typeof materialFor==='function','inject matching mergeGeometries and materialFor');
 for(const [k,v]of Object.entries({pressFrontOffset,pressFootOffset,islandHoleExtra}))assert(Number.isFinite(v)&&v>=0&&v<=1.5,`invalid ${k}`);
 const scope=createResourceScope(),sources=createResourceScope(),root=new T.Group(),sourceRanges=[],materialBindings=[],provenance=[],members=[],allRows=[];
 const owner=Object.freeze({}),D=copy(design.relations[kind]),F=design.localFixture,slotMap=new Map();let disposed=false,state=null;
 const measurementBudget=createActivityMeasurementBudget(measurementLimit),revision=1,frame={owner,origin:[0,0],yawRadians:0},submissionMembers=[];let submission;
 const recipeNodes=Object.entries(D.nodes).map(([id,v])=>Array.isArray(v)?{id,uv:[...v]}:{id,memberId:v.split(':')[0],portId:v.split(':')[1]}),recipeEdges=D.edges.map(([a,b,width])=>({a,b,width,headroom:2.1,hostIds:['pad']}));
 root.name=`activity-${kind}`;scope.defer(()=>{root.removeFromParent();root.clear();});
 const roadSlot={role:'stone',options:{maps:false,baseColor:0xbcb49d,color:0xffffff}},earthSlot={role:'stone',options:{maps:false,baseColor:0x88957b,color:0xffffff}},fillSlot={role:'stone',options:{maps:false,baseColor:0x9c9279,color:0xffffff}};
 function alive(){assert(!disposed,'disposed relation');}
 function register(asset){for(const b of asset.materialBindings){slotMap.set(b.object,b.slots);if(!b.object.geometry.hasAttribute(FORMATION_ATTRIBUTE))writeFormationCoordinates(T,b.object.geometry);}return asset;}
 function sourceMesh(geometry,slot,name){writeFormationCoordinates(T,geometry);const material=materialFor(slot.role,slot.options);assert(material?.isMaterial,'material required');const object=new T.Mesh(geometry,material);object.name=name;object.receiveShadow=true;slotMap.set(object,[slot]);return object;}
 function bake(rows){
  const buckets=new Map();
  function assemblyFor(slot){const key=JSON.stringify(slot);if(!buckets.has(key))buckets.set(key,{slot,assembly:scope.own(createAssetAssembly(T,{mergeGeometries,invariantAttributes:{[FORMATION_ATTRIBUTE]:3}}))});return buckets.get(key).assembly;}
  const records=addActivityDraws(T,{rows,assemblyFor,slotsFor:(object,slot)=>slotMap.get(object)[slot]});const ranges=[];
  for(const {slot,assembly}of buckets.values()){const out=assembly.finish();root.add(out.root);for(const object of out.root.children)materialBindings.push({object,slots:[copy(slot)]});sourceRanges.push(...out.sourceRanges);ranges.push(...out.sourceRanges);}
  const verified=verifyActivityRanges(T,records,ranges);provenance.push(...verified.proof);allRows.push(...verified.rows);return verified.rows;
 }
 try{
  const source=register(sources.own(buildRegionalArchitecture(T,{program:F.sourceBuilding[kind],width:F.sourceBuilding.width,depth:F.sourceBuilding.depth,height:F.sourceBuilding.height,materialFor})));
  const local=scanActivityDraws(T,source.root,{space:'local',budget:measurementBudget}),minimumY=Math.min(...local.map(r=>r.box[1]));
  const layout=compileWorldLayout({levels:[{id:'street',y:0,nodes:F.graph.nodes.map(([x,z],i)=>({id:`end/${i}`,x,z})),edges:[{id:'street',from:'end/0',to:'end/1',width:F.graph.width}],openEnds:['end/0','end/1']}],regions:[{id:'outside',level:'street',role:'building',outline:rect(F.sourceBuilding.outerRegion)},{id:'inside',level:'street',role:'court',outline:rect(F.padRegion)}]});
  const neighborhood=compileFrontageNeighborhood({layout,level:'street',prototypes:[{id:'source',footprint:source.footprint,entrance:source.entrances[0]}],familiesByRole:{building:['source']},endClearance:(24-source.footprint.width)/2,setback:F.sourceBuilding.setback,gap:1.4});
  assert(neighborhood.lots.length===1,'one actual source lot required');const lot=neighborhood.lots[0];source.root.position.set(...lot.pose.position);source.root.rotation.y=lot.pose.rotationY;
  const buildingRows=bake(scanActivityDraws(T,source.root,{prefix:'building',budget:measurementBudget}));
  const byObject=o=>buildingRows.find(r=>r.object===o),binding=source.entryBinding,deck=byObject(binding.deck),jambs=binding.reveals.map(byObject).sort((a,b)=>a.box[0]-b.box[0]),header=byObject(binding.header),lintel=byObject(binding.lintel);
  assert(deck&&jambs.every(Boolean)&&header&&lintel,'actual entry references');const width=jambs[1].box[0]-jambs[0].box[3],doorZ=Math.fround(source.root.localToWorld(new T.Vector3(...binding.port.position)).z),deckZ=deck.box[5],deckTop=deck.box[4],headroom=Math.min(header.box[1],lintel.box[1])-deckTop;
  assert(width>=binding.port.width-2e-5&&width<=binding.port.width+2e-5,'source aperture metadata/actual mismatch');assert(headroom>2.1,'source actual headroom');
  const deckFaces=captureActivityTop(deck),sourceDoor={width,headroom,doorZ,deckZ,deckTop,declaredWidth:binding.port.width,sourceIds:{deck:deck.id,jambs:jambs.map(r=>r.id),header:header.id,lintel:lintel.id}};
  const ground=sources.own(createHeightFieldGeometry(T,{sample:()=>({height:F.terrain.baseHeight,dx:0,dz:0})},{sizeX:F.terrain.size[0],sizeZ:F.terrain.size[1],segmentsX:F.terrain.segments[0],segmentsZ:F.terrain.segments[1]}));
  const terrainSupport=sources.own(prepareTerrainRoadSupport({terrainGeometry:ground}));
  bake(scanActivityDraws(T,sourceMesh(ground,earthSlot,'terrain'),{prefix:'terrain',budget:measurementBudget}));
  const thickness=-minimumY;
  function road(id,surfaces,height=thickness,slot=roadSlot){const road=sources.own(createTerrainRoadSource(T,{surfaces,terrainSupport,thickness:height}));const rows=bake(scanActivityDraws(T,sourceMesh(road.geometry,slot,id),{prefix:id,budget:measurementBudget}));assert(rows.length===1,'single source surface');const row=rows[0],group=road.geometry.groups.find(g=>g.materialIndex===0);assert(group,'real top cap');const faces=row.triangles.filter(t=>t.e>=group.start&&t.e<group.start+group.count).map(t=>({id:`${row.id}/e${t.e}`,p:t.p.map(p=>[...p])}));assert(faces.length===group.count/3&&faces.every(f=>triangleNormalY(f.p)>0),'actual cap triangle coverage');return {id,owner,faces};}
  const street=road('street',layout.levels[0].surfaces),streetZ=street.faces.flatMap(f=>f.p.map(p=>p[2])),curb=Math.min(...streetZ),gateZ=Math.max(...streetZ),cw=width+.3;
  const connector=road('connector',[{outer:rect([-cw/2,deckZ,cw/2,curb])}]);
  const holes=D.pavedHoles.map(h=>[h[0]-islandHoleExtra,h[1],h[2]+islandHoleExtra,h[3]]);
  const pad=road('pad',[{outer:rect(D.pad),holes:holes.map(rect)}]),hosts=[{id:'deck',owner,faces:deckFaces},connector,street,pad];
  if(kind==='exhibit')hosts.push(road('fill',[{outer:rect(holes[0])}],thickness-D.islandFill.topBelowWalk,fillSlot));
  const padTop=yRange(pad.faces)[1],fillTop=kind==='exhibit'?yRange(hosts.find(h=>h.id==='fill').faces)[1]:null;
  const prototypes=[];
  for(const [memberId,prototypeId,x,z,deg]of D.members){
   const asset=register(sources.own(buildActivityPrototype(T,{id:prototypeId,materialFor,pressFrontOffset,pressFootOffset})));
   const initial=measureActivityPrototype(T,asset),host=kind==='exhibit'&&memberId==='object'?'fill':'pad',baseY=(host==='fill'?fillTop:padTop)-initial.envelope[1];
   asset.root.position.set(x,baseY,z);asset.root.rotation.y=deg*Math.PI/180;
   const finalWorld=bake(scanActivityDraws(T,asset.root,{prefix:`member/${memberId}`,budget:measurementBudget}));
   const authorPose={position:[x,baseY,z],rotationY:deg*Math.PI/180};
   const finalMeasurement=measureActivityFinalMember(T,{asset,rows:finalWorld,memberId,authorPose,frame,recipe:{nodes:recipeNodes,edges:recipeEdges},budget:measurementBudget}),measured=finalMeasurement.facts;
   prototypes.push(measured);submissionMembers.push({id:memberId,...finalMeasurement});
   members.push({id:memberId,prototypeId,pose:copy(authorPose),authorPose:copy(authorPose),measurementFrame:{translation:[x,baseY,z],yawRadians:0},bearingHost:host,drawTriangles:measured.measurement.drawTriangles,envelope:measured.envelope,parts:plainFacts(measured.parts),bearings:plainFacts(measured.bearings),ports:plainFacts(measured.ports),measurement:plainFacts(measured.measurement)});
  }
  function crossPort(host,z,normal,id,width){const section=measureActivitySection(host.faces,{value:z,lo:-width/2,hi:width/2}),Y=section.witness[0][1];assert(section.witness.every(p=>p[1]===Y),'flat actual cross sill');return {id,owner,kind:'cross',position:[0,Y,z],servicePosition:[0,Y,z],normal,width,witness:section.witness};}
  const padFront=pad.faces.flatMap(f=>f.p).filter(p=>p[2]===gateZ),gateWidth=2*Math.min(-Math.min(...padFront.map(p=>p[0])),Math.max(...padFront.map(p=>p[0])));
  const sourcePort=crossPort(hosts[0],doorZ,[0,0,1],'door',width),gatePort=crossPort(street,gateZ,[0,0,1],'gate',gateWidth);
  const recipe={gateId:'gate',hostScopes:hosts.map(h=>h.id),members:D.members.map(([id,prototypeId,x,z,deg])=>({id,prototypeId,uv:[x,z],yawRadians:deg*Math.PI/180,bearingHost:members.find(m=>m.id===id).bearingHost,regionId:'inside'})),nodes:copy(recipeNodes),edges:copy(recipeEdges),requiredNodeIds:[...D.require],reserves:[{id:D.negative[0],polygon:rect(D.negative[1]),hostIds:['pad']}]};
  const blocks=buildingRows.filter(r=>r!==deck).map(r=>({id:r.id,owner,polygon:rect([r.box[0],r.box[2],r.box[3],r.box[5]]),yMin:r.box[1],yMax:r.box[4]}));
  const qualificationRecipe={...recipe,members:recipe.members.map(m=>({...m,yawRadians:0}))};
  const input={id:kind,frame,prototypes,recipe:qualificationRecipe,site:{owner,layout,level:'street',groupId:lot.groupId,lotId:lot.id,edgeId:lot.edgeId,regionId:'inside',hostFaces:hosts,blocks,reservedSolids:[],arrival:{owner,startId:'door',sourcePort,gatePort,nodes:[{id:'deck-edge',position:[0,deckTop,deckZ]},{id:'old-curb',position:[0,gatePort.position[1],curb]}],edges:[['door','deck-edge','deck'],['deck-edge','old-curb','connector'],['old-curb','gate','street']].map(([a,b,h])=>({a,b,width:F.routeWidthFromEntry,headroom:2.1,hostIds:[h]}))}}};
  submission=createActivitySubmissionIndex(T,{root,ranges:sourceRanges,members:submissionMembers,owner,revision,budget:measurementBudget});scope.own(submission);
  const qualification=qualifyActivityCourt({...input,...(qualificationLimits===undefined?{}:{limits:qualificationLimits})});
  const submissionProof=qualification.status==='complete'?submitActivityQualification(T,{root,index:submission,qualification,owner,revision}):null;
  if(submissionProof)for(const m of members){const actual=submission.members.get(m.id);m.qualificationPose=copy(actual.qualificationPose);m.submittedCarrierDelta=[...actual.submittedCarrierDelta];}
  state={kind,designPatch:{pressFrontOffset,pressFootOffset,islandHoleExtra},qualification:plainFacts(qualification),snapshot:qualification.snapshot,recipe:copy(recipe),qualificationRecipe:copy(qualificationRecipe),submissionProof,measurementBudget:measurementBudget.inspect(),members,sourceDoor,hosts:hosts.map(h=>({id:h.id,faces:copy(h.faces),minY:yRange(h.faces)[0],maxY:yRange(h.faces)[1]})),sourceRanges:provenance.map(({finalVerified,...r})=>r),provenance:copy(provenance),sourceDraws:allRows.map(r=>({id:r.id,triangles:r.triangles.length,box:[...r.box]})),stats:{drawMeshes:materialBindings.length,triangles:sourceRanges.reduce((n,r)=>n+r.vertexCount/3,0)},lot:copy(lot)};
  // No source query/ref survives source retirement; final ranges remain live.
  const rejectionEvidence=qualification.status==='complete'?null:{input:plainFacts(input),finalDraws:allRows.map(r=>({id:r.id,box:[...r.box],triangles:r.triangles.map(({e,group,slot,p})=>({e,group,slot,p:copy(p)}))}))};
  sources.dispose();slotMap.clear();allRows.length=0;
  state.resources={source:sources.inspect(),final:scope.inspect()};
  if(qualification.status!=='complete'){const error=new Error('Activity relation unsatisfied: '+JSON.stringify(qualification.diagnostics));error.code='ACTIVITY_UNSATISFIED';error.evidence={...copy(state),physical:rejectionEvidence};throw error;}
  if(failAfterBake)throw new Error('Activity relation: injected failure after real bake');
  const viewTasks=Object.entries(F.complementaryCameras).filter(([id,v])=>v.eye).map(([id,v])=>({id,position:[...v.eye],target:[...v.target]}));
  const shadowBounds=new T.Box3().setFromObject(root);
  return {root,kind,sourceRanges,materialBindings,viewTasks,shadowBounds,
   readState(){return disposed?{disposed:true,resources:{source:sources.inspect(),final:scope.inspect()}}:copy({...state,resources:{source:sources.inspect(),final:scope.inspect()}});},
   getRuntime(){alive();return {root,sourceRanges,materialBindings,owner,revision,submission,qualification,qualificationInput:input};},
   dispose(){if(disposed)return;disposed=true;try{sources.dispose();}finally{scope.dispose();slotMap.clear();allRows.length=0;sourceRanges.length=0;materialBindings.length=0;}}
  };
 }catch(error){try{sources.dispose();}finally{scope.dispose();slotMap.clear();allRows.length=0;}throw error;}
}
