import {buildArchitecturalBay} from './procedural-bay.mjs';

/** Borrowed scalar materials; owned geometry. Metres, +Y up, +Z entry, floor y=0.
 * Program selects real roof/floor/interior topology, never a prescribed placement.
 * maps:false is deliberate on every slot: these curved/rotated procedural parts
 * have no common metric tangent chart. Material mode swaps may reuse all meshes.
 */
export function buildRegionalArchitecture(T,{
  program='gallery',width=8,depth=6,height=4,materialFor,
  wallThickness=.24,roofOverhang=.35,courtyardRatio=.44
}={}) {
  const range=(name,value,min,max)=>{if(!Number.isFinite(value)||value<min||value>max)throw new RangeError(`Regional ${name} must be ${min}..${max}`);};
  if(!['gallery','workshop','courtyard'].includes(program))throw new Error('Unknown regional program');
  range('width',width,4.8,18);range('depth',depth,3.4,18);range('height',height,3,7);
  range('wall thickness',wallThickness,.12,.45);range('roof overhang',roofOverhang,.1,.8);
  range('courtyard ratio',courtyardRatio,.3,.55);
  if(typeof materialFor!=='function')throw new TypeError('Regional materialFor is required');
  const root=new T.Group();root.name=`regional-${program}`;
  const parts=Object.fromEntries(['walls','windows','doors','floors','roofs','structure','furniture','planting'].map(k=>[k,[]]));
  const owned=new Set(),bays=[],materialBindings=[],windows=[];
  let disposed=false;
  function dispose(){if(disposed)return;disposed=true;for(const bay of bays)bay.dispose();for(const g of owned)g.dispose();owned.clear();root.removeFromParent();root.clear();}
  const colors={stone:0xc3beb0,coating:0xd9dfd2,wood:0xa68152,metal:0x596d68};
  const slot=(role,color=colors[role])=>({role,options:{maps:false,baseColor:color,color:0xffffff}});
  const stone=slot('stone'),wall=slot('coating'),wood=slot('wood'),metal=slot('metal');
  const roofSlot=slot('coating',0x66817a),darkWood=slot('wood',0x6b5741);
  function borrow(s){const m=materialFor(s.role,s.options);if(!m?.isMaterial)throw new TypeError('Regional materialFor must return borrowed THREE.Material');return m;}
  function mesh(category,name,geometry,slots,position=[0,0,0],rotation=[0,0,0]){
    owned.add(geometry);const object=new T.Mesh(geometry,slots.length===1?borrow(slots[0]):slots.map(borrow));
    object.name=`${program}.${name}`;object.position.set(...position);object.rotation.set(...rotation);
    object.castShadow=object.receiveShadow=true;root.add(object);parts[category].push(object);materialBindings.push({object,slots});return object;
  }
  const box=(category,name,size,position,s=stone,rotation)=>mesh(category,name,new T.BoxGeometry(...size),[s],position,rotation);
  function beam(name,a,b,r=.045,s=metal,category='structure'){
    const start=new T.Vector3(...a),end=new T.Vector3(...b),mid=start.clone().add(end).multiplyScalar(.5);
    const object=mesh(category,name,new T.CylinderGeometry(r,r,start.distanceTo(end),10),[s],mid.toArray());
    object.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.sub(start).normalize());return object;
  }
  // Four non-overlapping structural strips; the center remains an actual hole.
  function ring(category,name,w,d,h,y,holeW,holeD,s){
    box(category,`${name}.front`,[w,h,(d-holeD)/2],[0,y,(d+holeD)/4],s);
    box(category,`${name}.back`,[w,h,(d-holeD)/2],[0,y,-(d+holeD)/4],s);
    box(category,`${name}.left`,[(w-holeW)/2,h,holeD],[-(w+holeW)/4,y,0],s);
    box(category,`${name}.right`,[(w-holeW)/2,h,holeD],[(w+holeW)/4,y,0],s);
  }
  const entranceWidth=Math.min(width*.24,program==='workshop'?2.8:1.8);
  const entranceHeight=height*(program==='workshop'?.77:.65);
  const entrance={position:[0,0,depth/2+wallThickness/2],normal:[0,0,1],width:entranceWidth,height:entranceHeight};
  function doorway(span){
    const side=(span-entranceWidth)/2,z=depth/2;
    for(const sign of [-1,1]){
      box('walls',`entry.jamb.${sign}`,[side,height,wallThickness],[sign*(entranceWidth+side)/2,height/2,z],wall);
      box('doors',`entry.reveal.${sign}`,[.065,entranceHeight,wallThickness+.1],[sign*(entranceWidth/2+.0325),entranceHeight/2,z],wood);
    }
    box('walls','entry.header',[entranceWidth,height-entranceHeight,wallThickness],[0,(height+entranceHeight)/2,z],wall);
    box('doors','entry.lintel',[entranceWidth+.13,.09,wallThickness+.1],[0,entranceHeight+.045,z],wood);
    // Doors rest open against the inside jambs; no invisible solid across entry.
    for(const sign of [-1,1]){
      const leaf=entranceWidth*.46;
      box('doors',`entry.open-leaf.${sign}`,[.065,entranceHeight-.08,leaf],[sign*(entranceWidth/2+.1),entranceHeight/2,depth/2-leaf/2],darkWood);
      beam(`entry.handle.${sign}`,[sign*(entranceWidth/2+.055),.85,depth/2-leaf*.78],[sign*(entranceWidth/2+.055),1.13,depth/2-leaf*.78],.018,metal,'doors');
    }
  }
  function perimeter(){
    for(let side=0;side<4;side++){
      const span=side%2?depth:width,count=side===0?3:Math.max(1,Math.round(span/2.8)),bayWidth=span/count;
      const angle=[0,Math.PI/2,Math.PI,-Math.PI/2][side];
      for(let i=0;i<count;i++){
        if(side===0&&i===1){doorway(bayWidth);continue;}
        const offset=-span/2+(i+.5)*bayWidth;
        // Center front bay reserves a generous industrial opening when needed.
        const windowWidth=Math.min(bayWidth-.5,program==='workshop'?1.7:1.35);
        const sill=height*.23,windowHeight=height*.5;
        const wallMaterial=borrow(wall),trimMaterial=borrow(wood);
        const bay=buildArchitecturalBay(T,{width:bayWidth,height,depth:wallThickness,
          openingWidth:windowWidth,openingHeight:windowHeight,sillHeight:sill,
          variant:program==='courtyard'?'arch':'rect',frameWidth:.07,frameDepth:.045,
          materials:{wall:wallMaterial,trim:trimMaterial,interior:wallMaterial}});
        bays.push(bay);bay.root.name=`${program}.window-bay.${side}.${i}`;
        // The rear side reverses its tangent so all local outward normals agree.
        const x=side%2?(side===1?width/2:-width/2):(side===2?-offset:offset);
        const z=side%2?(side===1?-offset:offset):(side===0?depth/2:-depth/2);
        bay.root.position.set(x,0,z);bay.root.rotation.y=angle;root.add(bay.root);
        bay.root.traverse(object=>{if(!object.isMesh)return;
          const surface=object===bay.parts.wall?wall:wood;
          const slots=(Array.isArray(object.material)?object.material:[object.material]).map(()=>surface);
          materialBindings.push({object,slots});parts.walls.push(object);
        });
        parts.windows.push(bay.root);
        const normal=[Math.sin(angle),0,Math.cos(angle)].map(v=>Math.abs(v)<1e-10?0:v);
        windows.push({center:[x,sill+windowHeight/2,z],normal,width:windowWidth,height:windowHeight});
        // Thin mullions and projecting sill are geometry; empty lights stay empty.
        const mullion=box('structure',`window.mullion.${side}.${i}`,[.035,windowHeight,.045],[x,sill+windowHeight/2,z],wood,[0,angle,0]);
        mullion.userData.openingDetail=true;
      }
    }
    // Corner piers bridge wall ends. Roof caps and slabs close each wall head.
    for(const x of [-width/2,width/2])for(const z of [-depth/2,depth/2])box('structure','corner-pier',[wallThickness+.06,height,wallThickness+.06],[x,height/2,z],stone);
  }
  function entryDeck(){
    const deckWidth=Math.max(entranceWidth+.45,width*.34),reach=.85;
    box('floors','entry.deck',[deckWidth,.13,reach],[0,-.065,depth/2+reach/2],stone);
    box('roofs','entry.canopy',[deckWidth,.1,.8],[0,entranceHeight+.26,depth/2+.35],metal);
    for(const x of [-deckWidth*.42,deckWidth*.42])beam('entry.canopy-brace',[x,entranceHeight-.25,depth/2+.1],[x,entranceHeight+.21,depth/2+.65],.027);
  }
  function table(x,z,w,d,y=.83){
    box('furniture','worktable.top',[w,.09,d],[x,y,z],wood);
    for(const sx of [-1,1])for(const sz of [-1,1])box('furniture','worktable.leg',[.075,y-.045,.075],[x+sx*(w/2-.12),(y-.045)/2,z+sz*(d/2-.12)],metal);
    box('furniture','worktable.shelf',[w-.2,.05,d-.15],[x,.22,z],darkWood);
    box('furniture','worktable.tool-tray',[w*.32,.08,d*.28],[x+w*.2,y+.085,z],metal);
  }
  function gallery(){
    const lanternW=width*.34,lanternD=depth*.55,lanternY=height+.55;
    ring('roofs','roof',width+2*roofOverhang,depth+2*roofOverhang,.18,height+.09,lanternW,lanternD,roofSlot);
    // Raised light monitor: genuine open clerestory slots between solid piers.
    for(const x of [-lanternW/2,lanternW/2])for(const z of [-lanternD/2,lanternD/2])box('structure','lantern.pier',[.11,.8,.11],[x,lanternY,z],metal);
    for(const sign of [-1,1]){
      box('roofs','lantern.sill.side',[.1,.12,lanternD],[sign*lanternW/2,height+.23,0],wood);
      box('roofs','lantern.sill.end',[lanternW,.12,.1],[0,height+.23,sign*lanternD/2],wood);
      const count=Math.max(2,Math.round(lanternD/.65));
      for(let j=1;j<count;j++)box('structure','clerestory.mullion',[.045,.62,.045],[sign*lanternW/2,lanternY,-lanternD/2+j*lanternD/count],metal);
    }
    box('roofs','lantern.cap',[lanternW+.3,.16,lanternD+.3],[0,height+.99,0],roofSlot);
    for(const x of [-width*.33,width*.33]){
      box('furniture','display.partition',[.11,height*.53,depth*.43],[x,height*.265,-depth*.08],wall);
      for(const z of [-depth*.16,depth*.04]){
        // Relief objects sit on both sides of the freestanding display screens.
        for(const sign of [-1,1])box('furniture','display.relief',[.055,height*.18,depth*.14],[x+sign*.085,height*.36,z],stone);
      }
    }
    box('furniture','display.plinth',[width*.18,.52,depth*.16],[0,.26,-depth*.18],stone);
    mesh('furniture','display.sculpture',new T.DodecahedronGeometry(Math.min(width,depth)*.095,0),[metal],[0,.52+Math.min(width,depth)*.105,-depth*.18]);
    box('furniture','display.bench',[width*.25,.1,.42],[0,.46,depth*.22],wood);
    for(const x of [-width*.095,width*.095])box('furniture','display.bench-leg',[.09,.41,.32],[x,.205,depth*.22],metal);
    for(const x of [-width*.31,width*.31])box('structure','gallery.roof-joist',[.13,.22,depth-wallThickness],[x,height-.13,0],wood);
  }
  function workshop(){
    const rise=width*.145,half=width/2+roofOverhang,angle=Math.atan2(rise,half),length=Math.hypot(half,rise);
    for(const sign of [-1,1])box('roofs','pitched-roof',[length,.18,depth+roofOverhang*2],[sign*half/2,height+rise/2+.09,0],roofSlot,[0,0,-sign*angle]);
    // Solid extruded gable ends, avoiding the paper-thin triangular billboard.
    for(const z of [-depth/2,depth/2]){
      const edgeRise=rise*(1-width/(2*half));
      const shape=new T.Shape([new T.Vector2(-width/2,0),new T.Vector2(width/2,0),new T.Vector2(width/2,edgeRise),new T.Vector2(0,rise),new T.Vector2(-width/2,edgeRise)]);
      mesh('walls','gable',new T.ExtrudeGeometry(shape,{depth:wallThickness,bevelEnabled:false}),[wall,wall],[0,height,z-wallThickness/2]);
    }
    // The rotated .18 m roof has a vertical half-thickness of .09/cos(angle).
    // Rafter axes follow its underside; their finite radius embeds the joint.
    const roofUnderside=x=>height+.09+rise*(1-Math.abs(x)/half)-.09/Math.cos(angle);
    for(const z of [-depth*.32,depth*.28]){
      const footY=height-.055,eaveY=roofUnderside(width/2),apexY=roofUnderside(0);
      beam('roof-truss.tie',[-width/2,footY,z],[width/2,footY,z],.055,wood);
      for(const sign of [-1,1])beam('roof-truss.bearing',[sign*width/2,footY,z],[sign*width/2,eaveY,z],.055,wood);
      beam('roof-truss.left',[-width/2,eaveY,z],[0,apexY,z],.055,wood);
      beam('roof-truss.right',[0,apexY,z],[width/2,eaveY,z],.055,wood);
    }
    for(const z of [-depth*.24,depth*.24]){
      box('roofs','vent.upstand',[width*.17,.38,.58],[0,height+rise+.17,z],metal);
      for(let i=0;i<3;i++)box('roofs','vent.louvre',[width*.22,.045,.8],[0,height+rise+.25+i*.11,z],roofSlot);
    }
    for(const x of [-width*.26,width*.26])table(x,-depth*.07,width*.25,depth*.24);
    const mezzanineDepth=depth*.23,mezzanineY=height*.52;
    box('floors','mezzanine.deck',[width-wallThickness*2,.14,mezzanineDepth],[0,mezzanineY,-depth/2+mezzanineDepth/2+wallThickness],wood);
    for(const x of [-width*.39,width*.39])box('structure','mezzanine.post',[.15,mezzanineY,.15],[x,mezzanineY/2,-depth*.25],metal);
    const railZ=-depth/2+mezzanineDepth+wallThickness;
    // A real stair with closed treads, paired stringers and a handrail.
    const count=Math.ceil(mezzanineY/.2),run=Math.min(depth*.6,mezzanineY*.95),stairX=-width*.38;
    const openingMin=stairX-.4,openingMax=stairX+.4,railMin=-width*.44,railMax=width*.44;
    for(const [start,end] of [[railMin,openingMin],[openingMax,railMax]]){
      if(end<=start)continue;
      beam('mezzanine.rail',[start,mezzanineY+.84,railZ],[end,mezzanineY+.84,railZ],.035);
      const segments=Math.max(1,Math.ceil((end-start)/.65));
      for(let i=0;i<=segments;i++){
        const x=start+(end-start)*i/segments;
        beam('mezzanine.baluster',[x,mezzanineY,railZ],[x,mezzanineY+.84,railZ],.022);
      }
    }
    for(let i=0;i<count;i++)box('structure','stair.tread',[.66,.075,run/count+.02],[stairX,mezzanineY*(i+1)/count,railZ+run*(1-(i+.5)/count)],wood);
    for(const x of [stairX-.29,stairX+.29])beam('stair.stringer',[x,.03,railZ+run],[x,mezzanineY-.07,railZ],.055,metal);
    beam('stair.handrail',[openingMax,.85,railZ+run],[openingMax,mezzanineY+.84,railZ],.03);
    for(const z of [-depth*.3,-depth*.1,depth*.1])box('furniture','workshop.wall-storage',[.25,height*.42,depth*.14],[width/2-wallThickness-.16,height*.21,z],wood);
  }
  function courtyard(){
    const cw=width*courtyardRatio,cd=depth*courtyardRatio;
    ring('floors','arcade.floor',width+.12,depth+.12,.18,-.09,cw,cd,stone);
    ring('roofs','arcade.roof',width+roofOverhang*2,depth+roofOverhang*2,.18,height+.09,cw,cd,roofSlot);
    for(const sign of [-1,1]){
      box('structure','colonnade.front-beam',[cw+.28,.22,.18],[0,height-.13,sign*(cd/2+.1)],wood);
      box('structure','colonnade.side-beam',[.18,.22,cd],[sign*(cw/2+.1),height-.13,0],wood);
      const nx=Math.max(2,Math.ceil(cw/1.4)),nz=Math.max(2,Math.ceil(cd/1.4));
      for(let i=0;i<=nx;i++)column(-cw/2+i*cw/nx,sign*(cd/2+.1));
      for(let i=1;i<nz;i++)column(sign*(cw/2+.1),-cd/2+i*cd/nz);
    }
    function column(x,z){
      box('structure','colonnade.base',[.3,.16,.3],[x,.08,z],stone);
      beam('colonnade.column',[x,.16,z],[x,height-.24,z],.075,stone);
      box('structure','colonnade.capital',[.27,.15,.27],[x,height-.22,z],stone);
    }
    const gravelCenter=-.09,gravelThickness=.06,groundY=gravelCenter+gravelThickness/2;
    box('floors','courtyard.gravel',[cw-.06,gravelThickness,cd-.06],[0,gravelCenter,0],slot('stone',0xa9aa91));
    for(const sign of [-1,1]){
      const x=sign*cw*.3,z=-cd*.28,w=cw*.27,d=cd*.27;
      // Planter is an open container with bottom, soil and independent rims.
      box('planting','planter.bottom',[w,.08,d],[x,groundY+.04,z],stone);
      ringPlanter(x,z,w,d);
      box('planting','planter.soil',[w-.1,.06,d-.1],[x,groundY+.24,z],slot('stone',0x665e43));
      for(let i=0;i<3;i++){
        const px=x+(i-1)*w*.21;
        beam('planting.stem',[px,groundY+.26,z],[px,groundY+.55+i*.09,z],.012,wood,'planting');
        mesh('planting','planting.leaf-cluster',new T.IcosahedronGeometry(Math.min(w,d)*.19,0),[slot('coating',0x6d8060)],[px,groundY+.52+i*.09,z]);
      }
    }
    function ringPlanter(x,z,w,d){
      for(const s of [-1,1]){
        box('planting','planter.rim',[w,.3,.055],[x,groundY+.19,z+s*(d/2-.0275)],stone);
        box('planting','planter.rim',[.055,.3,d-.11],[x+s*(w/2-.0275),groundY+.19,z],stone);
      }
    }
    for(const sign of [-1,1]){
      box('furniture','courtyard.bench',[width*.23,.09,.38],[sign*width*.32,.46,depth*.28],wood);
      for(const dx of [-width*.075,width*.075])box('furniture','courtyard.bench-foot',[.12,.42,.3],[sign*width*.32+dx,.21,depth*.28],stone);
    }
  }
  try{
    if(program!=='courtyard')box('floors','ground.floor',[width+.12,.18,depth+.12],[0,-.09,0],stone);
    perimeter();entryDeck();
    ({gallery,workshop,courtyard})[program]();
    root.updateMatrixWorld(true);
    const bounds=new T.Box3().setFromObject(root);
    const footprint=Object.freeze({minX:bounds.min.x,maxX:bounds.max.x,minZ:bounds.min.z,maxZ:bounds.max.z,width:bounds.max.x-bounds.min.x,depth:bounds.max.z-bounds.min.z});
    const spec=Object.freeze({program,width,depth,height,wallThickness,roofOverhang,courtyardRatio,
      materialMapping:'scalar-only; maps:false',windows:Object.freeze(windows.map(w=>Object.freeze(w)))});
    return {root,spec,parts,footprint,entrances:[entrance],materialBindings,dispose};
  }catch(error){dispose();throw error;}
}
