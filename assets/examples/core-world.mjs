import {createProfileLoftSource} from '../geometry/profile-loft.mjs';
import {createBezierPatchShell} from '../geometry/bezier-shell.mjs';
import {createImplicitSurfaceSource} from '../geometry/implicit-surface.mjs';
import {createRevolvedShell} from '../geometry/profile-surfaces.mjs';
import {compileWorldLayout} from '../scene/world-layout.mjs';
import {createAssetAssembly} from '../scene/asset-assembly.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';
import {selectObservationView} from '../scene/observation-view.mjs';
import {buildArchitecturalBay} from './procedural-bay.mjs';

const rect=(x,z,w,d)=>[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]];
const ROLE={stone:{color:0xc5c7b9},coating:{color:0xd2e1d8},metal:{color:0x9b7950,maps:false},wood:{color:0xa88e65}};
/** Complete, original context for the capability library, not a prescribed scene.
 * A single data-to-world chain supports three spatial topologies. Geometry stays
 * asset-local, layouts place it in metres, materials are borrowed via materialFor.
 * New geometry representations appear in real roofs/supports/joints, with edges,
 * neighboring buildings, fittings, paths, ground and a complete reverse side.
 */
export function buildCoreWorld(T,{mergeGeometries,MarchingCubes,materialFor,configuration='grid',roofLift=0}={}) {
  if(!['grid','ring','terraced'].includes(configuration))throw new Error('Unknown spatial configuration');
  if(!Number.isFinite(roofLift)||roofLift<0||roofLift>1)throw new RangeError('roofLift must be in 0..1 metres');
  if(typeof materialFor!=='function'||typeof mergeGeometries!=='function'||typeof MarchingCubes!=='function')throw new TypeError('Inject matching Three addons and materialFor');
  const scope=createResourceScope(),root=new T.Group(),materialBindings=[],parts={},anchors=new Map(),detailGroups=[],placements=[],entrances=[];
  root.name='core-capability-world';scope.defer(()=>root.removeFromParent());
  const materialOptions=(role,options)=>{
    const result={...ROLE[role],...options};
    if(result.maps===false&&result.baseColor===undefined){result.baseColor=result.color;result.color=0xffffff;}
    // Mapped consumers below emit one physical metre per UV unit. The bake must
    // use that metric, independently of the recipe's preferred default tile.
    if(result.maps!==false&&result.tileSizeMeters===undefined)result.tileSizeMeters=[1,1];
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
    const object=new T.Mesh(geometry,slots.length===1?mat(slots[0].role,slots[0].options):slots.map(s=>mat(s.role,s.options)));
    tangents(object);object.castShadow=object.receiveShadow=true;parent.add(object);bind(object,slots);return object;
  }
  const ownedMesh=(g,slots,parent=root)=>mesh(scope.own(g),slots,parent);
  const assembly=createAssetAssembly(T,{mergeGeometries}),buckets=new Map();
  function addStatic(g,role,position,rotation=[0,0,0],options={}){
    const m=mat(role,options);buckets.set(m.uuid,slot(role,options));const pose=new T.Object3D();pose.position.set(...position);pose.rotation.set(...rotation);pose.updateMatrix();
    try{assembly.add(g,m,{matrix:pose.matrix});}finally{g.dispose();}
  }
  function box(size,position,role='stone',options={}){
    const g=new T.BoxGeometry(...size),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i));uv.setXY(i,nx>.5?p.getZ(i):p.getX(i),ny>.5?p.getZ(i):p.getY(i));}
    addStatic(g,role,position,[0,0,0],options);
  }
  function beam(start,end,r=.045,role='metal'){
    const a=new T.Vector3(...start),b=new T.Vector3(...end),pose=new T.Object3D();pose.position.copy(a).add(b).multiplyScalar(.5);
    pose.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());pose.updateMatrix();
    const g=new T.CylinderGeometry(r,r,a.distanceTo(b),10),material=mat(role);buckets.set(material.uuid,slot(role));
    try{assembly.add(g,material,{matrix:pose.matrix});}finally{g.dispose();}
  }
  function plate(surface,top,depth,role,options={}){
    const shape=new T.Shape(surface.outer.map(p=>new T.Vector2(...p)));
    for(const hole of surface.holes??[])shape.holes.push(new T.Path(hole.map(p=>new T.Vector2(...p))));
    const g=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false,steps:1});g.rotateX(Math.PI/2);
    // Extrude's side-wall UVs project a dominant axis; unlike its planar caps,
    // oblique boundaries do not have the same orthogonal metric. Keep them scalar.
    return ownedMesh(g,[slot(role,options),slot(role,{...options,maps:false})]).position.set(0,top,0);
  }
  function data(){
    const gridNodes=[{id:'west',x:-14,z:0},{id:'center',x:0,z:0},{id:'east',x:14,z:0},{id:'north',x:0,z:-10},{id:'south',x:0,z:10}];
    let nodes=gridNodes,edges=[['wc','west','center',2.6],['ce','center','east',2.6],['nc','north','center',2],['cs','center','south',2]].map(([id,from,to,width])=>({id,from,to,width}));
    let levels=[{id:'ground',y:0,nodes,edges}],links=[],pavilion=[-5.6,-5.3],halls=[[-8,5.2,6,3.6],[7.2,-5.3,5.2,3.4],[7.6,5,6.2,3.6]];
    let regions=[{id:'northwest',level:'ground',outline:rect(-8.3,-6.1,13.4,7.8),role:'assembly'},
      {id:'southwest',level:'ground',outline:rect(-8.3,6.1,13.4,7.8),role:'gallery'},
      {id:'northeast',level:'ground',outline:rect(8.3,-6.1,13.4,7.8),role:'workshop'},
      {id:'southeast',level:'ground',outline:rect(8.3,6.1,13.4,7.8),role:'garden'}];
    if(configuration==='ring'){
      nodes=Array.from({length:6},(_,i)=>({id:`n${i}`,x:[0,12,12,0,-12,-12][i],z:[-10,-5,5,10,5,-5][i]}));nodes.push({id:'center',x:0,z:0});
      edges=Array.from({length:6},(_,i)=>({id:`ring-${i}`,from:`n${i}`,to:`n${(i+1)%6}`,width:2}));
      edges.push({id:'axis-north',from:'n0',to:'center',width:1.8},{id:'axis-south',from:'center',to:'n3',width:1.8});
      levels=[{id:'ground',y:0,nodes,edges}];pavilion=[-5.6,-1.7];halls=[[-5.6,3.5,5.4,3],[5.8,-3,5.2,3],[5.8,3.2,5.4,3]];
      regions=[{id:'west',level:'ground',outline:rect(-6.4,0,9.8,16),role:'assembly'},
        {id:'east-north',level:'ground',outline:rect(6.4,-4.2,9.8,7.2),role:'gallery'},
        {id:'east-south',level:'ground',outline:rect(6.4,4.2,9.8,7.2),role:'workshop'}];
    }else if(configuration==='terraced'){
      levels=[{id:'ground',y:0,nodes:gridNodes.filter(n=>n.id!=='north'),edges:edges.filter(e=>e.id!=='nc')},
        {id:'upper',y:2,nodes:[{id:'arrival',x:4.5,z:-3},{id:'end',x:13,z:-3}],edges:[{id:'upper-axis',from:'arrival',to:'end',width:1.8}]}];
      links=[{id:'level-link',fromLevel:'ground',fromNode:'center',toLevel:'upper',toNode:'arrival',width:1.7}];
      regions=regions.filter(r=>r.id!=='northeast');regions.push({id:'upper-court',level:'upper',outline:rect(8.4,-6.2,11.2,8.2),role:'workshop'});
      halls=[[-8,5.2,6,3.6],[8.2,-7,6,3.6],[7.6,5,6.2,3.6]];
    }
    regions.push({id:'perimeter',level:'ground',outline:rect(0,-14.5,35,4.6),role:'background'});
    return {levels,regions,links,pavilion,halls};
  }
  try{
    const design=data(),layout=compileWorldLayout(design),FLOOR=.16;
    function place(id,level,polygon){
      const region=layout.regions.find(r=>r.level===level&&r.role!=='forbidden'&&layout.footprintAllowed({level,polygon,regionId:r.id,clearance:.1}));
      if(!region)throw new Error(`Full footprint does not fit a region: ${id}`);
      placements.push({id,level,polygon,regionId:region.id});
    }
    place('pavilion','ground',rect(...design.pavilion,7.4,5.4));
    design.halls.forEach(([x,z,w,d],i)=>place(`hall/${i}`,configuration==='terraced'&&i===1?'upper':'ground',rect(x,z+(z>0?-.3:.3),w+.4,d+1)));
    box([36,.42,30],[0,-.23,-2.5],'stone',{color:0x9daa97});
    // Real finite terrain edges and a peripheral horizon layer remain visible behind the camera.
    box([33.6,.07,24.6],[0,.015,0],'stone',{color:0xb4bba8});
    if(configuration==='terraced')box([11.5,2,8.5],[8.4,1,-6.25],'stone',{color:0xafa995});
    for(const level of layout.levels)for(const surface of level.surfaces)plate(surface,level.y+FLOOR,.12,'stone',{color:0xcfc5aa});
    // Low kerbs, lamps and furniture are structural families with shared parameters.
    for(const x of [-15.6,15.6])box([.2,.34,23.5],[x,.18,0],'stone');
    for(const z of [-11.5,11.5])box([31.4,.34,.2],[0,.18,z],'stone');
    function bench(x,z,y=FLOOR){
      for(let i=0;i<5;i++)box([2.2,.065,.105],[x,y+.48,z+(i-2)*.12],'wood');
      for(const s of [-.8,.8]){box([.09,.46,.56],[x+s,y+.23,z],'metal');box([.09,.47,.07],[x+s,y+.72,z-.3],'metal');}
      for(let i=0;i<3;i++)box([2.2,.1,.06],[x,y+.65+i*.13,z-.3],'wood');
    }
    function lamp(x,z){
      beam([x,FLOOR,z],[x,2.8,z],.055);box([.3,.1,.3],[x,.2,z],'metal');box([.6,.08,.42],[x,2.85,z],'metal');
      box([.42,.1,.27],[x,2.76,z],'coating',{color:0xf0deab,maps:false});
      for(const side of [-1,1])beam([x+side*.22,2.78,z],[x,2.45,z],.02);
    }
    for(const [x,z]of [[-13,-7],[-13,7],[13,-8],[13,7],[-2,8],[2,-9]])lamp(x,z);
    for(const [x,z]of [[-11,-9],[9,9],[-9,9],[12,2]])bench(x,z);
    // Each hall is a closed perimeter of real perforated bays, with an interior.
    function hall(x,z,width,depth,index,y){
      const group=new T.Group();group.position.set(x,y,z);group.rotation.y=z>0?Math.PI:0;root.add(group);
      const wall=mat('coating',{color:index%2?0xd9ccb5:0xbcc8bd}),trim=mat('wood');
      const wallSlot=slot('coating',{color:index%2?0xd9ccb5:0xbcc8bd}),trimSlot=slot('wood');
      function localBox(size,position,binding){const object=ownedMesh(new T.BoxGeometry(...size),[binding],group);object.position.set(...position);return object;}
      function doorBay(span){
        const half=.52,h=2.75,doorHeight=2.05;
        const outline=[[-span/2,0],[-span/2,h],[span/2,h],[span/2,0],[half,0],[half,doorHeight],[-half,doorHeight],[-half,0]].map(p=>new T.Vector2(...p));
        const object=ownedMesh(new T.ExtrudeGeometry(new T.Shape(outline),{depth:.2,steps:1,bevelEnabled:false}),[wallSlot,wallSlot],group);object.position.z=depth/2-.1;
        for(const side of [-1,1])localBox([.09,doorHeight,.09],[side*(half+.045),doorHeight/2,depth/2+.04],trimSlot);
        localBox([1.22,.12,.1],[0,doorHeight+.05,depth/2+.04],trimSlot);
        localBox([1.8,.08,.55],[0,2.2,depth/2+.3],slot('metal'));
        for(const dx of [-.8,.8])localBox([.04,.5,.04],[dx,1.95,depth/2+.45],slot('metal'));
        localBox([1.8,.07,.6],[0,.035,depth/2+.3],slot('stone'));
        group.updateWorldMatrix(true,true);
        const point=group.localToWorld(new T.Vector3(0,.25,depth/2)),normal=new T.Vector3(0,0,1).transformDirection(group.matrixWorld);
        entrances.push({id:`hall/${index}/entrance`,point:point.toArray(),normal:normal.toArray(),width:1.04,height:doorHeight});
      }
      for(const side of [0,1,2,3]){
        const horizontal=side%2===0,span=horizontal?width:depth,count=horizontal?3:2,bayWidth=span/count;
        for(let i=0;i<count;i++){
          if(side===0&&i===1){doorBay(bayWidth);continue;}
          const bay=scope.own(buildArchitecturalBay(T,{width:bayWidth,height:2.75,depth:.2,openingWidth:Math.min(1.25,bayWidth-.45),openingHeight:1.65,sillHeight:.65,
            variant:(index+side)%2?'arch':'rect',frameWidth:.075,frameDepth:.06,materials:{wall,trim}}));
          const t=-span/2+bayWidth*(i+.5);bay.root.position.set(horizontal?t:(side===1?width/2:-width/2),0,horizontal?(side===0?depth/2:-depth/2):t);
          bay.root.rotation.y=[0,Math.PI/2,Math.PI,-Math.PI/2][side];group.add(bay.root);
          bay.root.traverse(o=>{if(o.isMesh)bind(o,Array.isArray(o.material)?o.material.map(m=>m===wall?wallSlot:trimSlot):[o.material===wall?wallSlot:trimSlot]);});
        }
      }
      const edge=width/2+.18,pitch=.72,roofBase=2.85;
      const roof=new T.Shape([[-edge,0],[0,pitch],[edge,0],[edge,-.14],[0,pitch-.14],[-edge,-.14]].map(p=>new T.Vector2(...p)));
      const g=scope.own(new T.ExtrudeGeometry(roof,{depth:depth+.4,steps:1,bevelEnabled:false}));
      const m=mesh(g,[slot('coating',{color:index%2?0x63837d:0x6b7974,maps:false}),slot('metal')],group);m.position.set(0,roofBase,-depth/2-.2);
      // Prototype parameters express different structural roles, while keeping
      // the same construction chain and complete perimeter on every side.
      if(index===1){
        const top=roofBase+pitch+.13;
        for(const dx of [-width*.25,width*.25]){const bottom=roofBase+pitch*(1-Math.abs(dx)/edge);localBox([.075,top-bottom,depth*.55],[dx,(top+bottom)/2,0],slot('metal'));}
        localBox([width*.6,.12,depth*.65],[0,top+.05,0],slot('coating',{color:0x93a89e,maps:false}));
        for(let i=0;i<7;i++)localBox([width*.58,.035,.045],[0,top-.12,-depth*.25+i*depth*.5/6],slot('wood'));
      }else{
        for(let i=0;i<5;i++)localBox([.07,.07,.55],[-width*.36+i*width*.18,2.58,depth/2+.2],slot('metal'));
      }
      box([width+.2,.14,depth+.2],[x,y-.07,z],'stone');
      for(const dx of [-width*.28,width*.28]){box([1,.08,.8],[x+dx,y+.72,z],'wood');for(const dz of [-.3,.3])box([.07,.72,.07],[x+dx-.4,y+.36,z+dz],'metal');}
    }
    design.halls.forEach(([x,z,w,d],i)=>hall(x,z,w,d,i,FLOOR+(configuration==='terraced'&&i===1?2:0)));
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
    const regionSamples=[],connectionSamples=[];
    for(const [x,z]of [[-2.8,-1.8],[2.8,-1.8],[-2.8,1.8],[2.8,1.8]]){
      const contact=roof.surfaceAt((x+3.5)/7,(2.5-z)/5,'inner');
      const source=scope.own(createProfileLoftSource(T,{stations:[{center:[x,.2,z],profile},{center:[x,.6,z],profile},{center:contact.point.toArray(),profile}],reference:[1,0,0],caps:true,uvMeters:1}));
      const column=mesh(source.geometry,[slot('metal'),slot('metal')],pavilion);parts.profileBeam??=column;
      for(const v of [.125,.625])regionSamples.push(source.surfaceAt(.05,v).point.add(pavilion.position),source.surfaceAt(.9,v).point.add(pavilion.position));
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
    for(const dx of [-1.6,1.6])bench(pavilion.position.x+dx,pavilion.position.z+.6,FLOOR);
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
    parts.levelConnections=new T.Group();root.add(parts.levelConnections);
    for(const link of layout.links){
      const a=new T.Vector3(...link.start),b=new T.Vector3(...link.end),rise=b.y-a.y,horizontal=Math.hypot(b.x-a.x,b.z-a.z),count=Math.max(1,Math.ceil(Math.abs(rise)/.16)),heading=Math.atan2(b.x-a.x,b.z-a.z);
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
    function bakeObject(object,roles){
      object.updateWorldMatrix(true,true);object.traverse(node=>{
        if(!node.isMesh)return;const g=node.geometry,ms=Array.isArray(node.material)?node.material:[node.material];
        const groups=g.groups.length?g.groups:[{start:0,count:g.index?.count??g.attributes.position.count,materialIndex:0}];
        for(const group of groups){
          const source=ms[group.materialIndex]??ms[0],binding=roles.get(source.uuid),copy=new T.BufferGeometry();
          if(!binding)throw Error('Static material group has no semantic owner');
          for(const key of ['position','normal','uv']){
            const attribute=g.attributes[key];if(!attribute)continue;const values=new Float32Array(group.count*attribute.itemSize);
            for(let i=0;i<group.count;i++){const v=g.index?g.index.getX(group.start+i):group.start+i;for(let c=0;c<attribute.itemSize;c++)values[i*attribute.itemSize+c]=attribute.getComponent(v,c);}
            copy.setAttribute(key,new T.BufferAttribute(values,attribute.itemSize));
          }
          buckets.set(source.uuid,binding);
          try{assembly.add(copy,source,{matrix:node.matrixWorld});}finally{copy.dispose();}
        }
      });
    }
    for(let i=0;i<9;i++){
      const x=-15+i*3.8,z=-13.8,h=2.05+(i%3)*.3,w=2.4,d=1.5,base=.04;
      place(`perimeter/${i}`,'ground',rect(x,z,w+.4,d+.4));
      box([w+.4,.08,d+.4],[x,0,z],'stone');
      const wallSlot=slot('coating',{color:0xaec0b5,maps:false}),trimSlot=slot('wood');
      const wall=mat(wallSlot.role,wallSlot.options),trim=mat(trimSlot.role,trimSlot.options);
      for(let side=0;side<4;side++){
        const horizontal=side%2===0,span=horizontal?w:d;
        const bay=buildArchitecturalBay(T,{width:span,height:h,depth:.14,openingWidth:horizontal?1.05:.65,openingHeight:1,sillHeight:.5,
          variant:i%2?'arch':'rect',frameWidth:.055,frameDepth:.035,materials:{wall,trim}});
        bay.root.position.set(x+(horizontal?0:side===1?w/2:-w/2),base,z+(horizontal?side===0?d/2:-d/2:0));bay.root.rotation.y=[0,Math.PI/2,Math.PI,-Math.PI/2][side];
        try{bakeObject(bay.root,new Map([[wall.uuid,wallSlot],[trim.uuid,trimSlot]]));}finally{bay.dispose();}
      }
      const roof=new T.Shape([[-w/2-.15,0],[0,.38],[w/2+.15,0],[w/2+.15,-.1],[0,.28],[-w/2-.15,-.1]].map(p=>new T.Vector2(...p)));
      addStatic(new T.ExtrudeGeometry(roof,{depth:d+.3,steps:1,bevelEnabled:false}),'coating',[x,base+h+.04,z-d/2-.15],[0,0,0],{color:0x778b80,maps:false});
      box([1,.07,.5],[x,base+.72,z],'wood');
    }
    const assembled=scope.own(assembly.finish());root.add(assembled.root);
    assembled.root.traverse(o=>{if(o.isMesh){tangents(o);bind(o,[buckets.get(o.material.uuid)]);}});
    const viewTasks=[{id:'overview',position:[27,23,31],target:[0,1,0]},
      {id:'region',position:[design.pavilion[0]+10,10,design.pavilion[1]+12],target:[...design.pavilion.slice(0,1),2.1,design.pavilion[1]]},
      {id:'connection',position:[pavilion.position.x+4,5.7,pavilion.position.z+5.8],target:[pavilion.position.x+.3,2.9+roofLift,pavilion.position.z]},
      {id:'reverse',position:[-25,18,-27],target:[0,1,0]}];
    // Rank a small authored candidate set by actual feature samples. This repairs
    // occlusion without hiding it behind proxy bounds or claiming an art score.
    root.updateWorldMatrix(true,true);
    for(const [id,radius,height,points]of [['region',13.5,8,regionSamples],['connection',7.5,3.35,connectionSamples]]){
      const target=[pavilion.position.x,2.1+roofLift*.35,pavilion.position.z];
      const candidates=[-Math.PI/2,-3*Math.PI/4,Math.PI,3*Math.PI/4,Math.PI/2,Math.PI/4,0,-Math.PI/4].map(angle=>({position:[target[0]+Math.cos(angle)*radius,height,target[2]+Math.sin(angle)*radius],target}));
      const selected=selectObservationView(T,{candidates,points,occluders:[root],viewport:{width:1280,height:720},fovDegrees:41,epsilon:1e-4});
      const task=viewTasks.find(t=>t.id===id);task.position=selected.position;task.target=selected.target;task.inspection=selected.inspection;
    }
    if(layout.links.length){const link=layout.links[0],p=link.start.map((v,i)=>(v+link.end[i])/2);viewTasks.push({id:'level-link',position:[p[0]+5,p[1]+4,p[2]+6],target:[p[0],p[1]+.7,p[2]]});}
    let disposed=false;
    const update=t=>{if(disposed)throw new Error('Core world disposed');if(!Number.isFinite(t))throw new TypeError('time must be finite');pivot.rotation.y=-.45+.3*Math.sin(t*.6);root.updateWorldMatrix(true,true);};
    update(0);
    return {root,layout,parts,anchors,materialBindings,detailGroups,placements,entrances,viewTasks,spec:Object.freeze({configuration,roofLift}),
      stats:{regionCount:layout.regions.length,buildingCount:design.halls.length+10,pathSurfaceCount:layout.levels.reduce((n,l)=>n+l.surfaces.length,0)},update,
      dispose(){if(disposed)return;disposed=true;scope.dispose();}};
  }catch(error){try{scope.dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'World build/cleanup failed');}throw error;}
}
