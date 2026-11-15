import {buildLandscapeContext} from './landscape-context.mjs';
import {createProceduralPalette} from '../materials/procedural-palette.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';
import {createWaveSurface} from '../environment/wave-surface.mjs';

const CAMERA_CONTRACT=Object.freeze({horizontalDegrees:360,minPolarAngle:.18,maxPolarAngle:1.62,minDistance:18,maxDistance:300});
const finite=(v,n)=>{if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;};

function seeded(seed){let x=seed>>>0;return()=>{x=(x+0x6d2b79f5)>>>0;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function inPolygon(x,z,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>z)!==(ring[j][1]>z)&&x<(ring[j][0]-ring[i][0])*(z-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])inside=!inside;return inside;}
function localToWorld(x,y,z,site){const c=Math.cos(site.rotation),s=Math.sin(site.rotation);return [site.position[0]+x*c+z*s,site.baseY+y,site.position[2]-x*s+z*c];}

function buildSiteRoofs(T,{root,sites,wood,stone,scope,random}){
 const tileWidth=.42,tileRun=.64,tileGeometry=scope.own(new T.BoxGeometry(tileRun,.075,tileWidth)),tileRecords=[];
 const slabGeometry=scope.own(new T.BoxGeometry(1,.12,1));
 for(const site of sites){
  const {width,depth,height}=site.spec,half=width*.5+.6,span=depth+.9,rise=Math.max(.92,height*.24),pitch=Math.atan2(rise,half),rows=Math.ceil(half/(tileRun*.8)),columns=Math.ceil(span/(tileWidth*.88)),count=rows*columns*2;
  const roof=new T.Group();roof.name=`${site.id}/tiled-gable-roof`;roof.position.set(site.position[0],site.baseY+height+.12,site.position[2]);roof.rotation.y=site.rotation;root.add(roof);scope.defer(()=>roof.removeFromParent());
  const panelA=new T.Mesh(slabGeometry,stone),panelB=new T.Mesh(slabGeometry,stone);panelA.scale.set(Math.hypot(half,rise)+.22,.12,span);panelB.scale.copy(panelA.scale);panelA.rotation.z=pitch;panelB.rotation.z=-pitch;panelA.position.set(-half/2,rise/2,0);panelB.position.set(half/2,rise/2,0);roof.add(panelA,panelB);
  const tiles=new T.InstancedMesh(tileGeometry,stone,count);tiles.name=`${site.id}/individually-colored-roof-tiles`;tiles.castShadow=true;tiles.receiveShadow=true;
  const object=new T.Object3D(),color=new T.Color();let index=0;
  for(const side of [-1,1])for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
   const x=side*(-half+(row+.5)*tileRun*.8),y=rise*(1-Math.abs(x)/half)+.10,z=-span*.5+(col+.5)*tileWidth*.88;
   object.position.set(x,y,z);object.rotation.set(0,0,-side*pitch);const jitter=.94+random()*.12;object.scale.set(jitter,1,jitter);object.updateMatrix();tiles.setMatrixAt(index,object.matrix);
   const hue=.075+random()*.025,light=.27+random()*.09;color.setHSL(hue,.34,light);tiles.setColorAt(index,color);index++;
  }
  tiles.instanceMatrix.needsUpdate=true;if(tiles.instanceColor)tiles.instanceColor.needsUpdate=true;roof.add(tiles);
  const beam=(name,a,b,r,material)=>{const start=new T.Vector3(...a),end=new T.Vector3(...b),delta=end.clone().sub(start),mesh=new T.Mesh(new T.CylinderGeometry(r,r,delta.length(),8),material);scope.own(mesh.geometry);mesh.name=`${site.id}/${name}`;mesh.position.copy(start.add(end).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());mesh.castShadow=mesh.receiveShadow=true;roof.add(mesh);};
  for(const side of [-1,1]){beam('eave-beam',[side*half,0,-span*.54],[side*half,0,span*.54],.11,wood);beam('gable-rafter',[side*half,0,0],[0,rise,0],.09,wood);}
  beam('ridge-cap',[0,rise+.08,-span*.54],[0,rise+.08,span*.54],.13,wood);
  for(const z of [-span*.4,0,span*.4])for(const side of [-1,1])beam('visible-rafter',[side*half,0,z],[0,rise,z],.045,wood);
  tileRecords.push({siteId:site.id,count});
 }
 return tileRecords;
}

function buildForest(T,{root,context,scope,wood,stone,seed}){
 const random=seeded(seed),trees=[],rocks=[],bounds=[-108,108];
 const reserved=(x,z)=>{
  if(context.roads.query(x,z))return true;
  for(const site of context.sites){const ring=site.footprint?.outer??site.footprint;if(Array.isArray(ring)&&inPolygon(x,z,ring))return true;}
  return false;
 };
 for(let z=bounds[0];z<=bounds[1]&&trees.length<96;z+=10.5)for(let x=bounds[0];x<=bounds[1]&&trees.length<96;x+=10.5){
  const jx=(random()-.5)*5,jz=(random()-.5)*5,px=x+jx,pz=z+jz,r=Math.hypot(px,pz);
  if(r<58||r>109||random()>.57||reserved(px,pz))continue;
  const ground=context.sampleTerrainSurface(px,pz);if(!ground||ground.normal[1]<.70)continue;
  const nearSite=context.sites.some(site=>Math.hypot(site.position[0]-px,site.position[2]-pz)<7);if(nearSite)continue;
  trees.push({x:px,z:pz,y:ground.height,scale:.72+random()*.75,variant:Math.floor(random()*4)});
 }
 const trunkGeometry=scope.own(new T.CylinderGeometry(.14,.3,1,8,1)),leafGeometry=scope.own(new T.ConeGeometry(1,2.5,8,2));
 const trunk=new T.InstancedMesh(trunkGeometry,wood,trees.length);trunk.name='terrain-conforming-pine-trunks';trunk.castShadow=true;trunk.receiveShadow=true;
 const leaf=new T.InstancedMesh(leafGeometry,stone,trees.length*5);leaf.name='open-layered-pine-canopies';leaf.castShadow=true;leaf.receiveShadow=true;
 const temp=new T.Object3D(),color=new T.Color();let leafIndex=0;
 for(let i=0;i<trees.length;i++){
  const t=trees[i],h=6.2*t.scale;temp.position.set(t.x,t.y+h*.43,t.z);temp.scale.set(t.scale,h,t.scale);temp.rotation.y=t.variant*.7;temp.updateMatrix();trunk.setMatrixAt(i,temp.matrix);
  for(let layer=0;layer<5;layer++){
   const frac=layer/5,layerH=h*(.19+layer*.145),radius=(2.15-frac*.72)*t.scale;
   temp.position.set(t.x,t.y+layerH,t.z);temp.scale.set(radius,.92*t.scale,radius);temp.rotation.y=t.variant*.7+layer*.37;temp.updateMatrix();leaf.setMatrixAt(leafIndex,temp.matrix);
   color.setHSL(.285+random()*.035,.31,.19+random()*.08);leaf.setColorAt(leafIndex,color);leafIndex++;
  }
 }
 trunk.count=trees.length;leaf.count=leafIndex;trunk.instanceMatrix.needsUpdate=true;leaf.instanceMatrix.needsUpdate=true;if(leaf.instanceColor)leaf.instanceColor.needsUpdate=true;root.add(trunk,leaf);
 for(let z=-104;z<=104&&rocks.length<120;z+=13)for(let x=-104;x<=104&&rocks.length<120;x+=13){
  const px=x+(random()-.5)*6,pz=z+(random()-.5)*6,r=Math.hypot(px,pz);if(r<52||random()>.5||reserved(px,pz))continue;
  const ground=context.sampleTerrainSurface(px,pz);if(!ground||ground.normal[1]<.66)continue;
  rocks.push({x:px,z:pz,y:ground.height,scale:.35+random()*1.05,rot:random()*Math.PI*2});
 }
 const rockGeometry=scope.own(new T.IcosahedronGeometry(1,1)),rockMesh=new T.InstancedMesh(rockGeometry,stone,rocks.length);rockMesh.name='weathered-slope-boulders';rockMesh.castShadow=true;rockMesh.receiveShadow=true;
 for(let i=0;i<rocks.length;i++){const r=rocks[i];temp.position.set(r.x,r.y+r.scale*.28,r.z);temp.scale.set(r.scale*1.25,r.scale*.58,r.scale);temp.rotation.set(r.rot*.16,r.rot,r.rot*.07);temp.updateMatrix();rockMesh.setMatrixAt(i,temp.matrix);color.setHSL(.11+random()*.035,.12,.34+random()*.13);rockMesh.setColorAt(i,color);}
 rockMesh.instanceMatrix.needsUpdate=true;if(rockMesh.instanceColor)rockMesh.instanceColor.needsUpdate=true;root.add(rockMesh);
 return {treeCount:trees.length,rockCount:rocks.length,trees,rocks};
}

function buildSpringCourt(T,{root,scope,context,stone,wood,random}){
 const y=context.sampleTerrainSurface(0,0)?.height??-.4,basin=new T.Group();basin.name='central-spring-court';basin.position.y=y;root.add(basin);scope.defer(()=>basin.removeFromParent());
 const ownMesh=(name,geometry,material,pos,rotation=[0,0,0])=>{scope.own(geometry);const mesh=new T.Mesh(geometry,material);mesh.name=name;mesh.position.set(...pos);mesh.rotation.set(...rotation);mesh.castShadow=mesh.receiveShadow=true;basin.add(mesh);return mesh;};
 ownMesh('spring-foundation',new T.BoxGeometry(25,.42,16),stone,[0,-.08,0]);
 ownMesh('spring-interior-liner',new T.BoxGeometry(21,.16,12),stone,[0,.04,0]);
 for(const x of [-11,11])ownMesh('carved-long-rim',new T.BoxGeometry(1,.72,16),stone,[x,.33,0]);
 for(const z of [-7.5,7.5])ownMesh('carved-end-rim',new T.BoxGeometry(23,.72,1),stone,[0,.33,z]);
 for(const z of [-5.5,5.5])for(let x=-9.5;x<=9.5;x+=1.9){const block=ownMesh('coping-stone-joint',new T.BoxGeometry(1.72,.16,.32),stone,[x,.76,z]);block.rotation.y=(Math.round(x*10)%2)*.025;}
 for(const z of [-9.5,9.5])for(let x=-10;x<=10;x+=2){ownMesh('approach-paver',new T.BoxGeometry(1.7,.16,1.1),stone,[x,.01,z]);}
 const waterMaterial=scope.own(new T.MeshPhysicalMaterial({color:'#85aeb0',roughness:.15,metalness:.12,transmission:.14,thickness:.7,ior:1.333,clearcoat:.65,clearcoatRoughness:.12,envMapIntensity:1.1}));
 const water=scope.own(createWaveSurface(T,{width:20.4,depth:11.3,segmentsX:64,segmentsZ:36,waterLevel:.43,material:waterMaterial,waves:[{direction:[1,.18],amplitude:.055,wavelength:4.8,q:.12,omega:1.05},{direction:[-.28,1],amplitude:.028,wavelength:2.7,q:.08,omega:1.45,phase:.65}]}));water.root.name='geometrically-animated-hot-spring';water.root.position.set(0,0,0);basin.add(water.root);water.mesh.receiveShadow=true;
 // A shallow arched footbridge is assembled from distinct boards and rails.
 for(let i=0;i<19;i++){
  const x=-9+i,deckY=.66+.72*(1-(x/9)**2);ownMesh('bridge-plank',new T.BoxGeometry(.9,.16,1.52),wood,[x,deckY,0],[0,0,-Math.atan(-.16*x/9)]);
  if(i%3===0)for(const z of [-.82,.82])ownMesh('bridge-baluster',new T.CylinderGeometry(.055,.075,1.0,8),wood,[x,deckY+.52,z]);
 }
 for(const z of [-.82,.82]){
  const points=[];for(let i=0;i<=16;i++){const x=-8+i,yy=.66+.72*(1-(x/9)**2)+1.02;points.push(new T.Vector3(x,yy,z));}
  const railGeometry=new T.TubeGeometry(new T.CatmullRomCurve3(points),64,.07,8,false);ownMesh('arched-wood-handrail',railGeometry,wood,[0,0,0]);
 }
 // Open-sided bath pavilion on the far bank: structure remains visible below the roof.
 const post=(x,z,h=3.2)=>ownMesh('pavilion-post',new T.CylinderGeometry(.13,.18,h,10),wood,[x,y+h/2,z-10.7]);
 for(const x of [-3.3,3.3])for(const z of [-2.1,2.1])post(x,z);
 for(const z of [-2.1,2.1])ownMesh('pavilion-beam',new T.BoxGeometry(6.9,.18,.22),wood,[0,3.15,z-10.7]);
 for(const x of [-3.3,3.3])ownMesh('pavilion-side-beam',new T.BoxGeometry(.22,.18,4.4),wood,[x,3.15,-10.7]);
 const roofBase=3.28,half=4.1,rise=1.35,depth=5.3,pitch=Math.atan2(rise,half);
 for(const side of [-1,1]){ownMesh('pavilion-roof-plane',new T.BoxGeometry(Math.hypot(half,rise),.22,depth),stone,[side*half/2,roofBase+rise/2,-10.7],[0,0,-side*pitch]);
  for(let row=0;row<9;row++)for(let col=0;col<12;col++){const x=side*(half-(row+.5)*.43),yy=roofBase+rise*(1-Math.abs(x)/half)+.16,z=-10.7-depth/2+(col+.5)*.44;const tile=ownMesh('pavilion-individual-roof-tile',new T.BoxGeometry(.57,.075,.4),stone,[x,yy,z],[0,0,-side*pitch]);tile.material=stone;tile.userData.tileVariation=Number(random().toFixed(4));}}
 for(const x of [-3.3,3.3])ownMesh('pavilion-eave-fascia',new T.BoxGeometry(.18,.28,depth+.24),wood,[x,roofBase,-10.7]);
 return {basin,water,waterMesh:water.mesh,y};
}

function buildStreetLighting(T,{root,scope,context,metal,random}){
 const nodes=context.design.levels[0].nodes,selected=nodes.filter((_,i)=>i%3===0),lamps=[];
 for(const node of selected){const hit=context.roads.query(node.x,node.z);if(!hit)continue;const pos=[node.x,hit.topHeight,node.z],group=new T.Group();group.name=`street-lamp/${node.id}`;group.position.set(...pos);root.add(group);scope.defer(()=>group.removeFromParent());
  const post=new T.Mesh(new T.CylinderGeometry(.045,.09,3.6,10),metal);post.position.y=1.8;post.castShadow=true;group.add(post);scope.own(post.geometry);
  const arm=new T.Mesh(new T.CylinderGeometry(.035,.045,1.05,8),metal);arm.position.set(.42,3.43,0);arm.rotation.z=-.18;arm.castShadow=true;group.add(arm);scope.own(arm.geometry);
  const glow=new T.Mesh(new T.SphereGeometry(.19,12,8),new T.MeshBasicMaterial({color:'#ffd59a'}));scope.own(glow.geometry);scope.own(glow.material);glow.position.set(.82,3.28,0);group.add(glow);
  const light=new T.PointLight('#ffd39b',18,13,2);light.position.copy(glow.position);light.castShadow=false;group.add(light);lamps.push({group,glow,light,phase:random()*Math.PI*2});
 }
 return lamps;
}

/** Complete code-built environment example: connected settlement, layered forest,
 * water court, decorated roofs, terrain-conforming props and authored view tasks.
 * The landscape factory owns its geometry; this wrapper owns materials, the added
 * context assets and water. All colors/textures are local procedural resources.
 */
export function buildEnvironmentWorld(T,{mergeGeometries,seed=381,configuration='grid'}={}){
 if(String(T?.REVISION)!=='187')throw new Error('environment-world example requires Three.js r187');
 if(typeof mergeGeometries!=='function')throw new TypeError('mergeGeometries is required from matching three/addons');
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('seed must be a uint32');
 const scope=createResourceScope(),root=new T.Group(),random=seeded(seed);root.name='environment-world';scope.defer(()=>root.clear());
 const palette=scope.own(createProceduralPalette(T,{seed,resolution:128})),materialCache=new Map();
 function materialFor(role,options={}){
  const baseColor=Number(options.baseColor??0xffffff),key=`${role}/${baseColor}`;if(materialCache.has(key))return materialCache.get(key);
  const recipe=role==='wood'?'wood':role==='metal'?'coated-metal':'stone',template=palette.get(recipe,{wetness:role==='stone'?.19:.08,wear:role==='metal'?.06:0,tileSizeMeters:role==='wood'?[.6,1.2]:[1,1]});
  const material=scope.own(template.clone());material.name=`world/${role}/${baseColor.toString(16)}`;material.color.setHex(baseColor);materialCache.set(key,material);return material;
 }
 const stone=materialFor('stone',{baseColor:0xc1bcad}),wood=materialFor('wood',{baseColor:0x89623e}),metal=materialFor('metal',{baseColor:0x536763}),landscape=scope.own(buildLandscapeContext(T,{mergeGeometries,materialFor,configuration,siteBounds:[-24,-24,24,24]}));
 landscape.root.name='connected-hamlet-settlement';root.add(landscape.root);
 const roofTiles=buildSiteRoofs(T,{root,sites:landscape.sites,wood,stone,scope,random});
 const forest=buildForest(T,{root,context:landscape,scope,wood,stone,seed:seed^0x74a19d3b});
 const spring=buildSpringCourt(T,{root,scope,context:landscape,stone,wood,random});
 const lamps=buildStreetLighting(T,{root,scope,context:landscape,metal,random});
 let disposed=false,time=0,steamStrength=.65;
 const smokeGeometry=scope.own(new T.SphereGeometry(.45,10,8)),smokeMaterial=scope.own(new T.MeshBasicMaterial({color:'#d8e2df',transparent:true,opacity:.13,depthWrite:false})),steam=[];
 for(let plume=0;plume<5;plume++){const group=new T.Group();group.name=`spring-steam/${plume}`;group.position.set(-6+plume*3,spring.y+.56,-1.8+(plume%2)*3);root.add(group);scope.defer(()=>group.removeFromParent());
  for(let p=0;p<7;p++){const puff=new T.Mesh(smokeGeometry,smokeMaterial);puff.name='animated-steam-puff';puff.userData={phase:random()*Math.PI*2,baseY:p*.58,spread:.18+random()*.42,size:.55+random()*.75};group.add(puff);steam.push({mesh:puff,group,plume,p});}
 }
 const observationTasks=Object.freeze({overview:{position:[154,154,188],target:[0,0,0]},courtyard:{position:[26,24,32],target:[0,0,0]},reverse:{position:[-165,116,-184],target:[0,1,0]}});
 function waterChecksum(){const a=spring.water.mesh.geometry.attributes.position.array;let sum=0;for(let i=0;i<a.length;i+=19)sum+=a[i]*.7+a[i+1]*1.3+a[i+2]*.11;return Number(sum.toFixed(6));}
 function update(nextTime){if(disposed)throw new Error('environment world is disposed');finite(nextTime,'time');time=nextTime;spring.water.update(time);
  for(const item of steam){const phase=time*.52+item.mesh.userData.phase,drift=Math.sin(phase+item.plume)*item.mesh.userData.spread;item.mesh.position.set(drift,item.mesh.userData.baseY+Math.max(0,Math.sin(phase))*.23,Math.cos(phase*.74+item.p)*item.mesh.userData.spread*.6);item.mesh.scale.setScalar(item.mesh.userData.size*(.62+.38*Math.sin(phase*.5))*steamStrength);}
  for(const lamp of lamps){const flicker=.96+.04*Math.sin(time*2.7+lamp.phase);lamp.glow.scale.setScalar(flicker);lamp.light.intensity=18*flicker;}
 }
 function setSteamStrength(value){if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('steamStrength must be in [0,1]');steamStrength=value;smokeMaterial.opacity=.11*steamStrength;update(time);}
 function readState(){if(disposed)return {disposed:true};return {seed,configuration,time,steamStrength,siteCount:landscape.sites.length,treeCount:forest.treeCount,rockCount:forest.rockCount,roofTileInstances:roofTiles.reduce((n,r)=>n+r.count,0),waterVertexChecksum:waterChecksum(),lampCount:lamps.length,scope:scope.inspect()};}
 return {root,context:landscape,water:spring.water,observationTasks,cameraContract:CAMERA_CONTRACT,
  stats:Object.freeze({roofTileInstances:roofTiles.reduce((n,r)=>n+r.count,0),treeCount:forest.treeCount,rockCount:forest.rockCount,springWaterMeshes:1,lampCount:lamps.length,siteCount:landscape.sites.length}),
  update,setSteamStrength,readState,dispose(){if(disposed)return;disposed=true;scope.dispose();}};
}
