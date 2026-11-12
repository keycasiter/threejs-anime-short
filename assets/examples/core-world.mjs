import {FORMATION_ATTRIBUTE,writeFormationCoordinates} from '../geometry/formation-coordinates.mjs';
import {copyFormationGroup} from '../scene/formation-group.mjs';
import {assignMaterialRegions} from '../materials/material-regions.mjs';
import {createProfileLoftSource} from '../geometry/profile-loft.mjs';
import {createBezierPatchShell} from '../geometry/bezier-shell.mjs';
import {createImplicitSurfaceSource} from '../geometry/implicit-surface.mjs';
import {createRevolvedShell} from '../geometry/profile-surfaces.mjs';
import {compileWorldLayout} from '../scene/world-layout.mjs';
import {createAssetAssembly} from '../scene/asset-assembly.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';
import {inspectFeatureVisibility} from '../scene/view-readability.mjs';
import {selectObservationView} from '../scene/observation-view.mjs';
import {buildArchitecturalBay} from './procedural-bay.mjs';
import {frameBoundaryProfile} from './boundary-profile-design.mjs';
import {buildRegionalArchitecture} from './region-programs.mjs';
import {buildLandscapeContext} from './landscape-context.mjs';

const rect=(x,z,w,d)=>[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]];
const ROLE={stone:{color:0xc5c7b9},coating:{color:0xd2e1d8},metal:{color:0x9b7950,maps:false},wood:{color:0xa88e65}};
export function createCoreWorldDesign(configuration='grid'){
    const gridNodes=[{id:'west',x:-14,z:0},{id:'center',x:0,z:0},{id:'east',x:14,z:0},{id:'north',x:0,z:-10},{id:'south',x:0,z:10}];
    let nodes=gridNodes,edges=[['wc','west','center',2.6],['ce','center','east',2.6],['nc','north','center',2],['cs','center','south',2]].map(([id,from,to,width])=>({id,from,to,width}));
    let levels=[{id:'ground',y:0,nodes,edges}],links=[],pavilion=[-5.6,-5.3],halls=[{id:'hall/0',regionId:'southwest',x:-8,z:6.2,width:7,depth:4.4,approachEdge:'wc'},{id:'hall/1',regionId:'northeast',x:8,z:-6.3,width:7,depth:4.8,approachEdge:'ce'},{id:'hall/2',regionId:'southeast',x:8,z:6.3,width:7.2,depth:5.2,approachEdge:'ce'}];
    let regions=[{id:'northwest',level:'ground',outline:rect(-8.3,-6.1,13.4,7.8),role:'assembly'},
      {id:'southwest',level:'ground',outline:rect(-8.3,6.1,13.4,7.8),role:'gallery'},
      {id:'northeast',level:'ground',outline:rect(8.3,-6.1,13.4,7.8),role:'workshop'},
      {id:'southeast',level:'ground',outline:rect(8.3,6.1,13.4,7.8),role:'courtyard'}];
    if(configuration==='ring'){
      nodes=Array.from({length:6},(_,i)=>({id:`n${i}`,x:[0,18,18,0,-18,-18][i],z:[-14,-7,7,14,7,-7][i]}));nodes.push({id:'center',x:0,z:0});
      edges=Array.from({length:6},(_,i)=>({id:`ring-${i}`,from:`n${i}`,to:`n${(i+1)%6}`,width:2}));
      edges.push({id:'axis-north',from:'n0',to:'center',width:1.8},{id:'axis-south',from:'center',to:'n3',width:1.8});
      levels=[{id:'ground',y:0,nodes,edges}];pavilion=[-8,-5.5];halls=[{id:'hall/0',regionId:'west-south',x:-8,z:4.8,width:7,depth:4.4,approachEdge:'axis-south'},{id:'hall/1',regionId:'east-north',x:8.2,z:-4.4,width:7,depth:4.8,approachEdge:'axis-north'},{id:'hall/2',regionId:'east-south',x:8.2,z:4.6,width:7.2,depth:5.2,approachEdge:'axis-south',placementTolerance:.5}];
      regions=[{id:'west',level:'ground',outline:rect(-9,-5.25,13,10.5),role:'assembly'},
        {id:'west-south',level:'ground',outline:rect(-9,5.25,13,10.5),role:'courtyard'},
        {id:'east-north',level:'ground',outline:rect(9,-5.2,13,10.2),role:'gallery'},
        {id:'east-south',level:'ground',outline:rect(9,5.2,13,10.2),role:'workshop'}];
    }else if(configuration==='terraced'){
      // Both mouths are degree-one ends with collinear approach tangents. The
      // low branch leaves the road before climbing, rather than starting at a junction.
      levels=[{id:'ground',y:0,nodes:[...gridNodes.filter(n=>n.id!=='north'),{id:'stair-low',x:0,z:-3}],edges:[...edges.filter(e=>e.id!=='nc'),{id:'stair-approach',from:'center',to:'stair-low',width:1.8}],openEnds:['stair-low']},
        {id:'upper',y:2,nodes:[{id:'stair-high',x:0,z:-8},{id:'arrival',x:0,z:-11},{id:'end',x:14,z:-11}],edges:[{id:'upper-approach',from:'stair-high',to:'arrival',width:1.8},{id:'upper-axis',from:'arrival',to:'end',width:1.8}],openEnds:['stair-high']}];
      links=[{id:'level-link',fromLevel:'ground',fromNode:'stair-low',toLevel:'upper',toNode:'stair-high',width:1.8}];
      regions=regions.filter(r=>r.id!=='northeast');regions.push({id:'upper-court',level:'upper',outline:rect(8.4,-6,12.6,7),role:'workshop'});
      halls=[{id:'hall/0',regionId:'southwest',x:-8,z:6.2,width:7,depth:4.4,approachEdge:'wc'},{id:'hall/1',regionId:'upper-court',x:8,z:-6,width:7,depth:4.8,approachEdge:'upper-axis'},{id:'hall/2',regionId:'southeast',x:8,z:6.3,width:7.2,depth:5.2,approachEdge:'ce'}];
    }
    regions.push({id:'perimeter',level:'ground',outline:rect(0,configuration==='ring'?-20.5:-14.5,35,4.6),role:'background'});
    const ground=levels.find(l=>l.id==='ground'),gatewayX=configuration==='ring'?22:18,gatewayNodes=configuration==='ring'?['n5','n1']:['west','east'];
    const gateways=gatewayNodes.map((from,i)=>{const node=ground.nodes.find(n=>n.id===from),id=`gateway/${i}`,x=i===0?-gatewayX:gatewayX;ground.nodes.push({id,x,z:node.z});ground.edges.push({id:`gateway-road/${i}`,from,to:id,width:2.6});return id;});
    ground.openEnds=[...(ground.openEnds??[]),...gateways];
    return {levels,regions,links,pavilion,halls,gateways};
}

/** Reader-facing task labels follow semantic program and viewing responsibility. */
export function coreViewLabel(task){
  const programs={gallery:{front:'展廊与天窗',reverse:'展廊背面'},workshop:{front:'工坊与夹层',reverse:'工坊背面'},courtyard:{front:'庭院与柱廊',reverse:'庭院背面'}};
  if(task.program)return programs[task.program]?.[task.direction]??task.id;
  const labels={overview:'全貌',region:'代表区域',connection:'结构与接点',reverse:'互补背面','level-link':'层间接口','region/reverse':'代表区域互补面'};
  return labels[task.id]??(task.id.startsWith('region/complement-')?'柱面补充观察 '+task.id.slice('region/complement-'.length):task.id);
}

/** Complete, original context for the capability library, not a prescribed scene.
 * A single data-to-world chain supports three spatial topologies. Geometry stays
 * asset-local, layouts place it in metres, materials are borrowed via materialFor.
 * New geometry representations appear in real roofs/supports/joints, with edges,
 * neighboring buildings, fittings, paths, ground and a complete reverse side.
 */
export function buildCoreWorld(T,{mergeGeometries,MarchingCubes,materialFor,configuration='grid',roofLift=0,design=createCoreWorldDesign(configuration)}={}) {
  if(!['grid','ring','terraced'].includes(configuration))throw new Error('Unknown spatial configuration');
  if(!Number.isFinite(roofLift)||roofLift<0||roofLift>1)throw new RangeError('roofLift must be in 0..1 metres');
  if(typeof materialFor!=='function'||typeof mergeGeometries!=='function'||typeof MarchingCubes!=='function')throw new TypeError('Inject matching Three addons and materialFor');
  // Public placement freedom is local and finite: at most 21 offset candidates.
  if(!Array.isArray(design?.halls))throw new TypeError('Authored halls are required');
  const placementTolerances=new Map();
  for(const hall of design.halls){
    const tolerance=hall.placementTolerance??0;
    if(!Number.isFinite(tolerance)||tolerance<0||tolerance>1)throw new RangeError('Regional placement tolerance must be finite and in 0..1 metres');
    placementTolerances.set(hall,tolerance);
  }
  const scope=createResourceScope(),root=new T.Group(),materialBindings=[],parts={},anchors=new Map(),detailGroups=[],placements=[],entrances=[],regionalAssets=[],materialRegionStats=[],supportHosts=[],standingPlacements=[],boundarySources=[],bakedBoundarySources=[];
  root.name='core-capability-world';scope.defer(()=>root.removeFromParent());
  const materialOptions=(role,options)=>{
    const result={...ROLE[role],...options};
    if(result.maps===false&&result.baseColor===undefined){result.baseColor=result.color;result.color=0xffffff;}
    // Mapped consumers below emit one physical metre per UV unit. The bake must
    // use that metric, independently of the recipe's preferred default tile.
    if(result.maps!==false){result.color=0xffffff;if(result.tileSizeMeters===undefined)result.tileSizeMeters=[1,1];}
    return result;
  };
  const mat=(role,options={})=>materialFor(role,materialOptions(role,options));
  const slot=(role,options={})=>({role,options:materialOptions(role,options)});
  function bind(object,slots){materialBindings.push({object,slots});return object;}
  function tangents(object){
    const g=object.geometry,ms=Array.isArray(object.material)?object.material:[object.material];
    if(ms.some(m=>m.normalMap)&&g.attributes.uv){
      if(!g.index)g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));
      g.computeTangents();
    }
  }
  function mesh(geometry,slots,parent=root){
    if(!geometry.hasAttribute(FORMATION_ATTRIBUTE))writeFormationCoordinates(T,geometry);
    const object=new T.Mesh(geometry,slots.length===1?mat(slots[0].role,slots[0].options):slots.map(s=>mat(s.role,s.options)));
    tangents(object);object.castShadow=object.receiveShadow=true;parent.add(object);bind(object,slots);return object;
  }
  const ownedMesh=(g,slots,parent=root)=>mesh(scope.own(g),slots,parent);
  // A material is borrowed rendering state, never the identity of a semantic slot.
  const buckets=new Map(),canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
  function staticAdd(g,material,binding,settings){
    const key=JSON.stringify(canonical(binding));
    if(!buckets.has(key))buckets.set(key,{binding,assembly:scope.own(createAssetAssembly(T,{mergeGeometries,invariantAttributes:{[FORMATION_ATTRIBUTE]:3}}))});
    buckets.get(key).assembly.add(g,material,settings);
  }
  function addStatic(g,role,position,rotation=[0,0,0],options={}){
    try{
      const m=mat(role,options);const pose=new T.Object3D();pose.position.set(...position);pose.rotation.set(...rotation);pose.updateMatrix();
      writeFormationCoordinates(T,g);staticAdd(g,m,slot(role,options),{matrix:pose.matrix});
    }finally{g.dispose();}
  }
  function box(size,position,role='stone',options={}){
    const g=new T.BoxGeometry(...size),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i));uv.setXY(i,nx>.5?p.getZ(i):p.getX(i),ny>.5?p.getZ(i):p.getY(i));}
    addStatic(g,role,position,[0,0,0],options);
  }
  function beam(start,end,r=.045,role='metal'){
    const a=new T.Vector3(...start),b=new T.Vector3(...end),pose=new T.Object3D();pose.position.copy(a).add(b).multiplyScalar(.5);
    pose.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());pose.updateMatrix();
    const g=new T.CylinderGeometry(r,r,a.distanceTo(b),10);
    try{const material=mat(role);writeFormationCoordinates(T,g);staticAdd(g,material,slot(role),{matrix:pose.matrix});}finally{g.dispose();}
  }
  function plate(surface,top,depth,role,options={}){
    const shape=new T.Shape(surface.outer.map(p=>new T.Vector2(...p)));
    for(const hole of surface.holes??[])shape.holes.push(new T.Path(hole.map(p=>new T.Vector2(...p))));
    const g=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false,steps:1});g.rotateX(Math.PI/2);
    // Extrude's side-wall UVs project a dominant axis; unlike its planar caps,
    // oblique boundaries do not have the same orthogonal metric. Keep them scalar.
    return ownedMesh(g,[slot(role,options),slot(role,{...options,maps:false})]).position.set(0,top,0);
  }

  try{
    const layout=compileWorldLayout(design),FLOOR=.16;
    function place(id,level,polygon,regionId){
      const region=layout.regions.find(r=>r.level===level&&(!regionId||r.id===regionId)&&r.role!=='forbidden'&&layout.footprintAllowed({level,polygon,regionId:r.id,clearance:.1}));
      if(!region)throw new Error(`Full footprint does not fit a region: ${id}`);
      placements.push({id,level,polygon,regionId:region.id});
    }
    place('pavilion','ground',rect(...design.pavilion,7.4,5.4));
    // Zone purpose owns construction; stable authored IDs survive record reordering.
    function roadArrival(hall,level){
      const edge=level.edges.find(e=>e.id===hall.approachEdge);
      if(!edge)throw Error(`Unknown approach road: ${hall.id}`);
      const a=level.nodes.find(n=>n.id===edge.from),b=level.nodes.find(n=>n.id===edge.to),v=new T.Vector3(b.x-a.x,0,b.z-a.z),center=new T.Vector3(hall.x,level.y+FLOOR,hall.z);
      const t=T.MathUtils.clamp(center.clone().sub(new T.Vector3(a.x,center.y,a.z)).dot(v)/v.lengthSq(),0,1);
      return {point:new T.Vector3(a.x,center.y,a.z).addScaledVector(v,t),edge};
    }
    const approaches=[];
    for(const hall of design.halls){
      const {id,x,z,width,depth}=hall,zone=layout.regions.find(r=>r.id===hall.regionId);
      if(!zone||!['gallery','workshop','courtyard'].includes(zone.role))throw Error(`Regional purpose required: ${id}`);
      const program=zone.role,level=layout.levels.find(l=>l.id===zone.level),arrival=roadArrival(hall,level),normal=arrival.point.clone().sub(new T.Vector3(x,arrival.point.y,z)).normalize();
      const asset=scope.own(buildRegionalArchitecture(T,{program,width,depth,height:program==='workshop'?3.8:3.2,materialFor:mat}));
      for(const {object} of asset.materialBindings)if(!object.geometry.hasAttribute(FORMATION_ATTRIBUTE))writeFormationCoordinates(T,object.geometry);
      asset.root.position.set(x,level.y+FLOOR,z);asset.root.rotation.y=Math.atan2(normal.x,normal.z);root.add(asset.root);
      const f=asset.footprint,localPolygon=[[f.minX,f.minZ],[f.maxX,f.minZ],[f.maxX,f.maxZ],[f.minX,f.maxZ]],clearance=.1;
      const worldPolygon=()=>{asset.root.updateWorldMatrix(true,true);return localPolygon.map(([a,b])=>{const p=asset.root.localToWorld(new T.Vector3(a,0,b));return [p.x,p.z];});};
      // Optional authored placement tolerance slides along the approach road only;
      // eligibility always uses the unchanged full mesh envelope and exact zone.
      const roadDirection=new T.Vector3(normal.z,0,-normal.x),offsets=[0];
      const steps=Math.min(10,Math.floor(placementTolerances.get(hall)/clearance+1e-8));
      for(let i=1;i<=steps;i++)offsets.push(-i*clearance,i*clearance);
      let polygon;
      for(const offset of offsets){asset.root.position.set(x+roadDirection.x*offset,level.y+FLOOR,z+roadDirection.z*offset);const candidate=worldPolygon();
        if(layout.footprintAllowed({level:level.id,polygon:candidate,regionId:zone.id,clearance})){polygon=candidate;break;}}
      if(!polygon)throw Error(`Full footprint does not fit authored purpose zone: ${id}`);
      arrival.point.copy(roadArrival({...hall,x:asset.root.position.x,z:asset.root.position.z},level).point);
      place(id,level.id,polygon,zone.id);materialBindings.push(...asset.materialBindings);boundarySources.push(...asset.boundarySources.map(b=>({...b,assetId:id})));regionalAssets.push({id,program,regionId:zone.id,asset});
      for(const port of asset.entrances){const threshold=asset.root.localToWorld(new T.Vector3(...port.position)),point=threshold.clone().add(new T.Vector3(0,.25,0)),normal=new T.Vector3(...port.normal).transformDirection(asset.root.matrixWorld);
        entrances.push({id:id+'/entrance',point:point.toArray(),normal:normal.toArray(),width:port.width,height:port.height});
        const deck=asset.parts.floors.find(o=>o.name.endsWith('entry.deck'));
        if(!deck)throw Error(`Actual entry deck required: ${id}`);
        const vertices=deck.geometry.attributes.position,side=new T.Vector3(normal.z,0,-normal.x),width=port.width+.5;
        let front=-Infinity,minSide=Infinity,maxSide=-Infinity;
        for(let i=0;i<vertices.count;i++){const p=new T.Vector3().fromBufferAttribute(vertices,i).applyMatrix4(deck.matrixWorld);front=Math.max(front,p.dot(normal));minSide=Math.min(minSide,p.dot(side));maxSide=Math.max(maxSide,p.dot(side));}
        if(threshold.dot(side)-width/2<minSide-1e-6||threshold.dot(side)+width/2>maxSide+1e-6)throw Error(`Approach exceeds actual entry deck: ${id}`);
        const start=threshold.clone().addScaledVector(normal,front-threshold.dot(normal));
        function roadBoundary(origin){
          const delta=arrival.point.clone().sub(threshold),finish=origin.clone().add(delta),d=finish.clone().sub(origin);let first=null;
          for(const [surfaceIndex,surface] of level.surfaces.entries())for(const [ringIndex,ring] of [surface.outer,...surface.holes].entries())for(let i=0;i<ring.length;i++){
            const a=ring[i],b=ring[(i+1)%ring.length],ex=b[0]-a[0],ez=b[1]-a[1],den=d.x*ez-d.z*ex;
            if(Math.abs(den)<1e-10)continue;
            const ax=a[0]-origin.x,az=a[1]-origin.z,t=(ax*ez-az*ex)/den,u=(ax*d.z-az*d.x)/den;
            if(t>=0&&t<=1&&u>=-1e-8&&u<=1+1e-8&&(!first||t<first.t))first={t,edge:`${surfaceIndex}/${ringIndex}/${i}`,point:origin.clone().addScaledVector(d,t)};
          }
          if(!first)throw Error(`Approach has no actual road boundary: ${id}`);return first;
        }
        const left=start.clone().addScaledVector(side,-width/2),right=start.clone().addScaledVector(side,width/2),leftRoad=roadBoundary(left),rightRoad=roadBoundary(right);
        if(leftRoad.edge!==rightRoad.edge)throw Error(`Approach needs a single full-width road boundary: ${id}`);
        const end=leftRoad.point.clone().add(rightRoad.point).multiplyScalar(.5),outer=[left,right,rightRoad.point,leftRoad.point].map(p=>[p.x,p.z]);
        approaches.push({id:id+'/approach',level:level.id,roadEdge:arrival.edge.id,threshold:threshold.toArray(),roadCenter:arrival.point.toArray(),start:start.toArray(),end:end.toArray(),width,surface:{outer}});
      }
    }
    const siteWidth=configuration==='ring'?44:36,siteDepth=configuration==='ring'?39:30;
    function hostBox(id,size,position,options){box(size,position,'stone',options);supportHosts.push({id,outline:rect(position[0],position[2],size[0],size[2]),top:position[1]+size[1]/2});}
    hostBox('site-base',[siteWidth,.42,siteDepth],[0,-.23,-2.5],{color:0x9daa97});
    hostBox('ground-plaza',[siteWidth-2.4,.07,siteDepth-5.4],[0,.015,0],{color:0xb4bba8});
    for(const port of layout.ports.filter(p=>design.gateways?.includes(p.nodeId))){
      const from=Math.sign(port.center[0])*(siteWidth/2-1.2),to=port.center[0],base=supportHosts.find(h=>h.id==='site-base').top,top=supportHosts.find(h=>h.id==='ground-plaza').top;
      hostBox(`${port.nodeId}/foundation`,[Math.abs(to-from),top-base,port.width],[(from+to)/2,(top+base)/2,port.center[2]],{color:0xb4bba8});
    }
    if(configuration==='terraced'){const top=layout.levels.find(l=>l.id==='upper').y+.08,height=top+.08,y=(top-.08)/2;hostBox('upper-plaza',[14,height,9.7],[8.2,y,-7.3],{color:0xafa995});hostBox('upper-arrival',[2.6,height,4.4],[0,y,-10.1],{color:0xafa995});}
    for(const level of layout.levels)for(const surface of level.surfaces)plate(surface,level.y+FLOOR,.12,'stone',{color:0xcfc5aa});
    for(const level of layout.levels)for(const [i,surface]of level.surfaces.entries())supportHosts.push({id:`road/${level.id}/${i}`,outline:surface.outer,holes:surface.holes,top:level.y+FLOOR});
    // Actual entry-deck and road edges bound the supported connector. Shared
    // edges have no coplanar top-area overlap; its arbitrary chart stays scalar.
    for(const approach of approaches)plate(approach.surface,approach.start[1],approach.start[1]-.02,'stone',{maps:false});
    // Low kerbs, lamps and furniture are structural families with shared parameters.
    for(const x of [-(siteWidth/2-1),siteWidth/2-1]){
      const port=layout.ports.find(p=>design.gateways?.includes(p.nodeId)&&Math.sign(p.center[0])===Math.sign(x)),min=-2-(siteDepth-3)/2,max=-2+(siteDepth-3)/2;
      if(!port)box([.2,.34,siteDepth-3],[x,.18,-2],'stone');
      else for(const [a,b]of [[min,port.center[2]-port.width/2-.15],[port.center[2]+port.width/2+.15,max]])if(b>a)box([.2,.34,b-a],[x,.18,(a+b)/2],'stone');
    }
    for(const z of [-(siteDepth/2+1),siteDepth/2-4])box([siteWidth-2,.34,.2],[0,.18,z],'stone');
    const inside=(x,z,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
    function supportAt(x,z){const host=supportHosts.filter(h=>inside(x,z,h.outline)&&!(h.holes??[]).some(r=>inside(x,z,r))).sort((a,b)=>b.top-a.top)[0];if(!host)throw Error('Standing asset requires an actual host');return host;}
    function bench(x,z,y,id){
      const host=y===undefined?supportAt(x,z):supportHosts.find(h=>h.id==='pavilion-floor');y??=host.top;standingPlacements.push({id,role:'bench',position:[x,y,z],baseY:y,hostId:host.id});
      for(let i=0;i<5;i++)box([2.2,.065,.105],[x,y+.48,z+(i-2)*.12],'wood');
      for(const s of [-.8,.8]){box([.09,.46,.56],[x+s,y+.23,z],'metal');box([.09,.47,.07],[x+s,y+.72,z-.3],'metal');}
      for(let i=0;i<3;i++)box([2.2,.1,.06],[x,y+.65+i*.13,z-.3],'wood');
    }
    function lamp(x,z,id){
      const host=supportAt(x,z),y=host.top;standingPlacements.push({id,role:'lamp',position:[x,y,z],baseY:y,hostId:host.id});
      beam([x,y,z],[x,y+2.64,z],.055);box([.3,.1,.3],[x,y+.04,z],'metal');box([.6,.08,.42],[x,y+2.69,z],'metal');
      box([.42,.1,.27],[x,y+2.6,z],'coating',{color:0xf0deab,maps:false});
      for(const side of [-1,1])beam([x+side*.22,y+2.62,z],[x,y+2.29,z],.02);
    }
    for(const [i,[x,z]]of [[-13,-7],[-13,7],[13,-8],[13,7],[-2,8],[2,-9]].entries())lamp(x,z,`lamp/${i}`);
    for(const [i,[x,z]]of [[-11,-9],[9,9],[-9,9],[12,2]].entries())bench(x,z,undefined,`bench/plaza/${i}`);
    const pavilion=new T.Group();pavilion.position.set(design.pavilion[0],FLOOR,design.pavilion[1]);root.add(pavilion);
    const controlPoints=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>[-3.5+i*7/3,3.6+roofLift+.8*((i-1.5)/1.5)**2+.3*((j-1.5)/1.5)**2,2.5-j*5/3]));
    const roof=scope.own(createBezierPatchShell(T,{controlPoints,thickness:.14,segmentsU:32,segmentsV:24,uvMeters:1}));
    parts.curvedRoof=mesh(roof.geometry,[slot('coating',{color:0xd8d5bf,maps:false}),slot('wood',{maps:false}),slot('metal')],pavilion);
    // Border samples come from the emitted surface and turn into actual fascia beams.
    for(const fixedU of [0,1])for(let j=0;j<24;j++){
      const a=roof.surfaceAt(fixedU,j/24).point.clone().add(pavilion.position),b=roof.surfaceAt(fixedU,(j+1)/24).point.clone().add(pavilion.position);
      beam(a.toArray(),b.toArray(),.045);
    }
    for(const fixedV of [0,1])for(let j=0;j<32;j++){
      const a=roof.surfaceAt(j/32,fixedV).point.clone().add(pavilion.position),b=roof.surfaceAt((j+1)/32,fixedV).point.clone().add(pavilion.position);
      beam(a.toArray(),b.toArray(),.045);
    }
    const profile=[[-.16,-.13],[.16,-.13],[.16,-.075],[.055,-.075],[.055,.075],[.16,.075],[.16,.13],[-.16,.13],[-.16,.075],[-.055,.075],[-.055,-.075],[-.16,-.075]];
    const regionSamples=[],connectionSamples=[],observationSets=[];
    for(const [x,z]of [[-2.8,-1.8],[2.8,-1.8],[-2.8,1.8],[2.8,1.8]]){
      const contact=roof.surfaceAt((x+3.5)/7,(2.5-z)/5,'inner');
      const source=scope.own(createProfileLoftSource(T,{stations:[{center:[x,.2,z],profile},{center:[x,.6,z],profile},{center:contact.point.toArray(),profile}],reference:[1,0,0],caps:true,uvMeters:1}));
      const column=mesh(source.geometry,[slot('metal'),slot('metal')],pavilion);parts.profileBeam??=column;
      for(const [face,v] of [['positive',.125],['negative',.625]])for(const [end,u] of [['lower',.05],['upper',.9]]){
        const sample=source.surfaceAt(u,v),columnId=`column/${x}/${z}`;
        regionSamples.push({id:`${columnId}/${face}/${end}`,columnId,face,end,point:sample.point.add(pavilion.position).toArray(),normal:sample.normal.toArray()});
      }
      box([.6,.2,.6],[x+pavilion.position.x,FLOOR+.1,z+pavilion.position.z],'stone');
    }
    const roofY=roof.surfaceAt(.5,.5,'inner').point.y,branchY=roofY-.16;
    const ends=[-.85,.85].map(x=>{const hit=roof.surfaceAt((x+3.5)/7,.5,'inner');return hit.point.addScaledVector(hit.normal,.09).toArray();});
    const capsule=(p,a,b,r)=>{const q=p.map((v,i)=>v-a[i]),v=b.map((x,i)=>x-a[i]);const t=Math.max(0,Math.min(1,q.reduce((s,x,i)=>s+x*v[i],0)/v.reduce((s,x)=>s+x*x,0)));return Math.hypot(...q.map((x,i)=>x-v[i]*t))-r;};
    const smin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
    const field=(x,y,z)=>{const p=[x,y,z];let f=capsule(p,[0,.45,0],[0,branchY*.58,0],.23);for(const end of ends)f=smin(f,capsule(p,[0,branchY*.5,0],end,.17),.25);return f;};
    const joint=scope.own(createImplicitSurfaceSource(T,{MarchingCubes},{field,bounds:{min:[-1.5,.06,-.8],max:[1.5,roofY+.5,.8]},resolution:32,maxTriangles:30000}));
    parts.implicitJoint=mesh(joint.geometry,[slot('metal')],pavilion);
    for(const target of [[0,branchY*.55,.22],...ends.map(p=>[p[0],p[1],p[2]+.17])]){
      let nearest=null,best=Infinity;const position=joint.geometry.attributes.position;
      for(let i=0;i<position.count;i++){const p=new T.Vector3().fromBufferAttribute(position,i),distance=p.distanceToSquared(new T.Vector3(...target));if(distance<best){nearest=p;best=distance;}}
      connectionSamples.push(nearest.add(pavilion.position));
    }
    // Explicit manufactured interfaces and a sampled continuous body have
    // different representation needs. The collar supplies a finite bearing
    // annulus and overlaps the shaft; a sampled minimum is not a contact face.
    const collar=scope.own(createRevolvedShell(T,{
      outer:[{r:.36,y:.18,crease:true},{r:.36,y:.28,crease:true},{r:.28,y:.34},{r:.28,y:.68}],
      inner:[{r:.2,y:.18},{r:.22,y:.68}],radialSegments:48
    }));
    parts.bearingInterface=mesh(collar,[slot('metal')],pavilion);
    collar.computeBoundingBox();const bearingTop=collar.boundingBox.min.y+.02;
    parts.foundation=ownedMesh(new T.BoxGeometry(.8,bearingTop,.65),[slot('stone')],pavilion);parts.foundation.position.y=bearingTop/2;
    box([7.2,.12,5.2],[pavilion.position.x,FLOOR-.06,pavilion.position.z],'stone',{color:0xcbc5b1});
    supportHosts.push({id:'pavilion-floor',outline:rect(pavilion.position.x,pavilion.position.z,7.2,5.2),top:FLOOR});
    for(const [i,dx]of [-1.6,1.6].entries())bench(pavilion.position.x+dx,pavilion.position.z+.6,FLOOR,`bench/pavilion/${i}`);
    const service=roof.surfaceAt(.62,.15,'inner'),mount=new T.Group();service.frame.decompose(mount.position,mount.quaternion,mount.scale);pavilion.add(mount);
    anchors.set('roof-service',new T.Matrix4().makeTranslation(...pavilion.position.toArray()).multiply(service.frame));
    const pivot=new T.Group();mount.add(pivot);
    // Guest lies in port XY, +Z points out of the host. Opening toward +Z keeps
    // the complete panel volume outside, rather than checking only its origin.
    parts.panel=ownedMesh(new T.BoxGeometry(.9,.6,.035),[slot('wood',{maps:false})],pivot);parts.panel.position.set(.45,0,.05);
    // Detail visibility changes only secondary bolts; main structure is retained.
    const fasteners=new T.Group();pavilion.add(fasteners);fasteners.name='secondary-fasteners';
    for(const x of [-2.8,2.8])for(const z of [-1.8,1.8])for(const dx of [-.22,.22])for(const dz of [-.22,.22]){
      const bolt=ownedMesh(new T.CylinderGeometry(.025,.025,.055,6),[slot('metal')],fasteners);bolt.position.set(x+dx,.22,z+dz);
    }
    detailGroups.push({id:'pavilion-fasteners',root:fasteners,center:new T.Vector3(pavilion.position.x,.4,pavilion.position.z),diameter:1,level:0});
    parts.levelConnections=new T.Group();parts.levelConnections.userData.portPairs=[];root.add(parts.levelConnections);
    for(const link of layout.links){
      const from=layout.ports.find(p=>p.level===link.fromLevel&&p.nodeId===link.fromNode),to=layout.ports.find(p=>p.level===link.toLevel&&p.nodeId===link.toNode);
      if(!from||!to||Math.abs(from.width-link.width)>1e-8||Math.abs(to.width-link.width)>1e-8)throw Error('Level connection requires equal-width exposed ports');
      parts.levelConnections.userData.portPairs.push({linkId:link.id,from,to});
      const a=new T.Vector3(...from.center),b=new T.Vector3(...to.center),rise=b.y-a.y,horizontal=Math.hypot(b.x-a.x,b.z-a.z),count=Math.max(1,Math.ceil(Math.abs(rise)/.16)),heading=Math.atan2(b.x-a.x,b.z-a.z);
      for(let i=0;i<count;i++){
        const t=(i+.5)/count,top=a.y+FLOOR+rise*(i+1)/count,base=Math.min(a.y,b.y)+.02;
        const g=scope.own(new T.BoxGeometry(link.width,Math.max(.08,top-base),horizontal/count+.01));
        const step=mesh(g,[slot('stone')],parts.levelConnections);step.position.set(a.x+(b.x-a.x)*t,(top+base)/2,a.z+(b.z-a.z)*t);step.rotation.y=heading;
      }
      const side=new T.Vector3(b.z-a.z,0,-(b.x-a.x)).normalize().multiplyScalar(link.width*.5);
      for(const sign of [-1,1]){const aa=a.clone().addScaledVector(side,sign),bb=b.clone().addScaledVector(side,sign);aa.y+=FLOOR+.9;bb.y+=FLOOR+.9;beam(aa.toArray(),bb.toArray(),.03);for(const p of [aa,bb])beam([p.x,p.y-.9,p.z],p.toArray(),.03);}
    }
    // The same perforated construction family remains complete in reverse views.
    // Bake material groups explicitly; preserve UV/normal seams rather than welding.
    function bakeObject(object,semantics,sourceIds=new Map()){
      object.updateWorldMatrix(true,true);object.traverse(node=>{
        if(!node.isMesh)return;const g=node.geometry,ms=Array.isArray(node.material)?node.material:[node.material];
        if(!g.hasAttribute(FORMATION_ATTRIBUTE))writeFormationCoordinates(T,g);
        const groups=g.groups.length?g.groups:[{start:0,count:g.index?.count??g.attributes.position.count,materialIndex:0}];
        for(const group of groups){
          const source=ms[group.materialIndex]??ms[0],slots=semantics.get(node),binding=slots?.[group.materialIndex]??slots?.[0];
          if(!binding)throw Error('Static material group has no semantic owner');
          const copy=copyFormationGroup(T,g,group);
          try{staticAdd(copy,source,binding,{matrix:node.matrixWorld,castShadow:node.castShadow,receiveShadow:node.receiveShadow,layers:node.layers.mask,sourceId:sourceIds.get(node)});}finally{copy.dispose();}
        }
      });
    }
    for(let i=0;i<9;i++){
      const x=-15+i*3.8,z=configuration==='ring'?-20.8:-13.8,h=2.05+(i%3)*.3,w=2.4,d=1.5,base=.04;
      place(`perimeter/${i}`,'ground',rect(x,z,w+.4,d+.4));
      box([w+.4,.08,d+.4],[x,0,z],'stone');
      const wallSlot=slot('coating',{color:0xaec0b5,maps:false}),trimSlot=slot('wood'),frameSlot=slot('wood',{maps:false});
      const wall=mat(wallSlot.role,wallSlot.options),trim=mat(trimSlot.role,trimSlot.options),frame=mat(frameSlot.role,frameSlot.options);
      for(let side=0;side<4;side++){
        const horizontal=side%2===0,span=horizontal?w:d;
        const bay=buildArchitecturalBay(T,{width:span,height:h,depth:.14,openingWidth:horizontal?1.05:.65,openingHeight:1,sillHeight:.5,
          variant:i%2?'arch':'rect',frameWidth:.055,frameDepth:.035,frameProfile:frameBoundaryProfile(.055,.035),materials:{wall,trim,frame}});
        bay.root.position.set(x+(horizontal?0:side===1?w/2:-w/2),base,z+(horizontal?side===0?d/2:-d/2:0));bay.root.rotation.y=[0,Math.PI/2,Math.PI,-Math.PI/2][side];
        try{
          bay.root.updateWorldMatrix(true,true);
          const sourceIds=new Map();
          for(const {source,part} of bay.profileSources){
            const id=`perimeter/${i}/${side}/frame`,g=source.geometry;sourceIds.set(part,id);
            bakedBoundarySources.push({id,metadata:structuredClone(source.metadata),sourceGeometryId:g.uuid,sourceSpace:'world-root-local',sourceMatrix:part.matrixWorld.toArray(),semantic:structuredClone(frameSlot),triangleCount:g.index.count/3,disposed:true,sourceRanges:[]});
          }
          bakeObject(bay.root,new Map(Object.values(bay.parts).map(node=>[node,(Array.isArray(node.material)?node.material:[node.material]).map(()=>node===bay.parts.wall?wallSlot:node===bay.parts.frame?frameSlot:trimSlot)])),sourceIds);
        }finally{bay.dispose();}
      }
      const roof=new T.Shape([[-w/2-.15,0],[0,.38],[w/2+.15,0],[w/2+.15,-.1],[0,.28],[-w/2-.15,-.1]].map(p=>new T.Vector2(...p)));
      const roofGeometry=new T.ExtrudeGeometry(roof,{depth:d+.3,steps:1,bevelEnabled:false});
      try{
        const regionStats=assignMaterialRegions(T,{geometry:roofGeometry,regions:[{id:'weather-face',match:({normal})=>normal.y>.2},{id:'soffit',match:({normal})=>normal.y<-.2}],fallback:'cut-edge'});
        materialRegionStats.push({id:`perimeter/${i}/roof`,...regionStats});
        const slots=[slot('coating',{baseColor:0x778b80,maps:false}),slot('wood',{baseColor:0x9c825d,maps:false}),slot('metal',{baseColor:0x65756c,maps:false})],materials=slots.map(s=>mat(s.role,s.options));
        const roofObject=new T.Mesh(roofGeometry,materials);roofObject.castShadow=roofObject.receiveShadow=true;roofObject.position.set(x,base+h+.04,z-d/2-.15);
        bakeObject(roofObject,new Map([[roofObject,slots]]));
      }finally{roofGeometry.dispose();}
      box([1,.07,.5],[x,base+.72,z],'wood');
    }
    const boundaryById=new Map(bakedBoundarySources.map(record=>[record.id,record]));
    for(const {assembly,binding} of buckets.values()){const assembled=assembly.finish();root.add(assembled.root);
      for(const {sourceId,object,geometry,vertexStart,vertexCount} of assembled.sourceRanges){
        const record=boundaryById.get(sourceId);if(record)record.sourceRanges.push({sourceId,objectId:object.uuid,geometryId:geometry.uuid,vertexStart,vertexCount});
      }
      assembled.root.traverse(o=>{if(o.isMesh){tangents(o);bind(o,[binding]);}});
    }
    root.updateWorldMatrix(true,true);const shadowBounds=new T.Box3().setFromObject(root);
    const context=scope.own(buildLandscapeContext(T,{mergeGeometries,materialFor:mat,configuration,gateways:layout.ports.filter(p=>design.gateways?.includes(p.nodeId)),siteBounds:configuration==='ring'?[-25,-25,25,25]:[-21,-20,21,19]}));root.add(context.root);materialBindings.push(...context.materialBindings);
    const viewTasks=[{id:'overview',position:[32,27,37],target:[0,1,0]},
      {id:'region',position:[design.pavilion[0]+10,10,design.pavilion[1]+12],target:[...design.pavilion.slice(0,1),2.1,design.pavilion[1]]},
      {id:'connection',position:[pavilion.position.x+4,5.7,pavilion.position.z+5.8],target:[pavilion.position.x+.3,2.9+roofLift,pavilion.position.z]},
      {id:'reverse',position:[-25,18,-27],target:[0,1,0]}];
    for(const region of regionalAssets){
      const bounds=new T.Box3().setFromObject(region.asset.root),target=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),normal=new T.Vector3(...entrances.find(e=>e.id===region.id+'/entrance').normal),distance=Math.max(size.x,size.z,size.y)*1.8;
      for(const reverse of [false,true]){
        const sign=reverse?-1:1,position=target.clone().addScaledVector(normal,distance*sign).addScaledVector(new T.Vector3(normal.z,0,-normal.x),distance*.55).add(new T.Vector3(0,distance*.68,0));
        viewTasks.push({id:region.id+(reverse?'/reverse':''),program:region.program,regionId:region.regionId,direction:reverse?'reverse':'front',position:position.toArray(),target:target.toArray()});
      }
    }
    // Rank a small authored candidate set by actual feature samples. This repairs
    // occlusion without hiding it behind proxy bounds or claiming an art score.
    root.updateWorldMatrix(true,true);
    // Opposing section faces need a set of observations. Allocate every stable
    // sample to a genuinely visible view, then require 100% of that responsibility.
    const target=[pavilion.position.x,2.1+roofLift*.35,pavilion.position.z],radius=13.5;
    const candidates=[2.5,3.35,5,8].flatMap(height=>[-Math.PI/2,-3*Math.PI/4,Math.PI,3*Math.PI/4,Math.PI/2,Math.PI/4,0,-Math.PI/4].map(angle=>({position:[target[0]+Math.cos(angle)*radius,height,target[2]+Math.sin(angle)*radius],target})));
    const frameBounds=new T.Box3().setFromObject(pavilion),points=regionSamples.map(s=>s.point),viewport={width:1280,height:720};
    // Use the selector here only for envelope/projection qualification. Cache the
    // full-scene per-sample visibility exactly once below; final tasks are checked again.
    const ranked=selectObservationView(T,{candidates,points,frameBounds,marginPixels:34,occluders:[],viewport,fovDegrees:41,epsilon:1e-4});
    const visibility=ranked.candidates.map(candidate=>{
      const camera=new T.PerspectiveCamera(41,1280/720,.1,250);camera.position.fromArray(candidate.position);camera.lookAt(new T.Vector3(...target));camera.updateMatrixWorld();
      const result=inspectFeatureVisibility(T,{camera,points,occluders:[root],viewport,epsilon:1e-4});
      return {candidate,ids:regionSamples.filter((s,i)=>result.samples[i].status==='visible'&&!result.samples[i].overlays.length).map(s=>s.id)};
    }).filter(v=>v.candidate.envelopeInside);
    const remaining=new Set(regionSamples.map(s=>s.id)),viewIds=[];
    while(remaining.size){
      const best=[...visibility].sort((a,b)=>b.ids.filter(id=>remaining.has(id)).length-a.ids.filter(id=>remaining.has(id)).length)[0];
      const sampleIds=best?.ids.filter(id=>remaining.has(id))??[];
      if(!sampleIds.length)break;
      const id=viewIds.length===0?'region':viewIds.length===1?'region/reverse':`region/complement-${viewIds.length}`;
      const assigned=regionSamples.filter(s=>sampleIds.includes(s.id)),requiredFeatures=assigned.map(s=>({id:s.id,points:[s.point],minVisibleFraction:1}));
      const selected=selectObservationView(T,{candidates:[best.candidate],points:assigned.map(s=>s.point),requiredFeatures,frameBounds,marginPixels:34,occluders:[root],viewport,fovDegrees:41,epsilon:1e-4});
      const task={id,position:selected.position,target:selected.target,sampleIds,inspection:selected.inspection};
      if(id==='region')Object.assign(viewTasks.find(v=>v.id===id),task);else viewTasks.push(task);
      viewIds.push(id);for(const sampleId of sampleIds)remaining.delete(sampleId);
    }
    observationSets.push({id:'profile-sections',samples:regionSamples,viewIds,coverage:{complete:remaining.size===0,coveredSampleIds:regionSamples.filter(s=>!remaining.has(s.id)).map(s=>s.id),uncoveredSampleIds:[...remaining]}});
    for(const [id,radius,height,points]of [['connection',7.5,3.35,connectionSamples]]){
      const target=[pavilion.position.x,2.1+roofLift*.35,pavilion.position.z];
      const candidates=[-Math.PI/2,-3*Math.PI/4,Math.PI,3*Math.PI/4,Math.PI/2,Math.PI/4,0,-Math.PI/4].map(angle=>({position:[target[0]+Math.cos(angle)*radius,height,target[2]+Math.sin(angle)*radius],target}));
      const frameBounds=new T.Box3().setFromObject(parts.implicitJoint).union(new T.Box3().setFromObject(parts.bearingInterface)).union(new T.Box3().setFromObject(parts.foundation));
      const requiredFeatures=[{id:'shaft',points:points.slice(0,1),minVisibleFraction:1},{id:'left-fork-contact',points:points.slice(1,2),minVisibleFraction:1},{id:'right-fork-contact',points:points.slice(2,3),minVisibleFraction:1}];
      const selected=selectObservationView(T,{candidates,points,frameBounds,marginPixels:34,requiredFeatures,occluders:[root],viewport:{width:1280,height:720},fovDegrees:41,epsilon:1e-4});
      const task=viewTasks.find(t=>t.id===id);task.position=selected.position;task.target=selected.target;task.inspection=selected.inspection;
    }
    if(layout.links.length){const link=layout.links[0],p=link.start.map((v,i)=>(v+link.end[i])/2);viewTasks.push({id:'level-link',position:[p[0]+5,p[1]+4,p[2]+6],target:[p[0],p[1]+.7,p[2]]});}
    let disposed=false;
    const update=t=>{if(disposed)throw new Error('Core world disposed');if(!Number.isFinite(t))throw new TypeError('time must be finite');pivot.rotation.y=-.45+.3*Math.sin(t*.6);root.updateWorldMatrix(true,true);};
    update(0);
    return {root,layout,parts,anchors,materialBindings,detailGroups,placements,entrances,approaches,regionalAssets,boundarySources,bakedBoundarySources,materialRegionStats,supportHosts,standingPlacements,context,shadowBounds,viewTasks,observationSets,spec:Object.freeze({configuration,roofLift}),
      stats:{regionCount:layout.regions.length,buildingCount:design.halls.length+10+context.sites.length,pathSurfaceCount:layout.levels.reduce((n,l)=>n+l.surfaces.length,0)},update,
      dispose(){if(disposed)return;disposed=true;scope.dispose();}};
  }catch(error){try{scope.dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'World build/cleanup failed');}throw error;}
}
