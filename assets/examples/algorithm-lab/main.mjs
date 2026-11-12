import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {compileCorridorGraph,generateFrontageLots} from '../../scene/corridor-layout.mjs';
import {createSectionLoftGeometry} from '../../geometry/section-loft.mjs';
import {createFractalHeightField,createHeightFieldGeometry} from '../../environment/height-field.mjs';

const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;document.body.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color(0xe7e8e1);scene.add(new T.HemisphereLight(0xeaf3ff,0x6b7355,2));
const sun=new T.DirectionalLight(0xfff5df,3);sun.position.set(-25,40,18);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-45,right:45,top:45,bottom:-45,near:1,far:100});sun.shadow.normalBias=.035;scene.add(sun);
const camera=new T.PerspectiveCamera(38,innerWidth/innerHeight,.1,300),controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=15;controls.maxDistance=115;controls.maxPolarAngle=Math.PI*.46;controls.enableDamping=true;
const palette={ground:new T.MeshStandardMaterial({color:0xc4ceb7,roughness:.95}),road:new T.MeshStandardMaterial({color:0x526b5d,roughness:.85}),lot:new T.MeshStandardMaterial({color:0xd3c2a1,roughness:.75}),loft:new T.MeshStandardMaterial({color:0x759d88,roughness:.42,metalness:.08}),markers:new T.MeshStandardMaterial({color:0xe1b26c,roughness:.7}),field:new T.MeshStandardMaterial({vertexColors:true,roughness:.9})};
const root=new T.Group();scene.add(root);let mode='layout',value=4,stats={},build=0;
const descriptions={layout:'改变路宽，路带和沿边地块共同重建；交点在图中有共享ID。',loft:'只改变中段全宽；深度、两端截面和中心路径保持不变。',field:'改变基础频率；顶点、解析法线、坡度颜色和落点共同重建。'};
const settings={layout:{min:2,max:8,step:.5,value:4,label:'主路宽度（米）'},loft:{min:2,max:7,step:.25,value:4.5,label:'中段全宽（米）'},field:{min:.02,max:.16,step:.01,value:.06,label:'基础频率（每米）'}};
function add(g,m,pos=[0,0,0]){const mesh=new T.Mesh(g,m);mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;}
function clear(){root.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.geometry)o.geometry.dispose();});root.clear();}
function road(e){const p=[];for(const [x,z] of e.quad)p.push(x,.055,z);const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();add(g,palette.road);}
function rebuild(){
 clear();build++;
 if(mode==='layout'){
  add(new T.BoxGeometry(64,.35,56),palette.ground,[0,-.2,0]);
  const graph=compileCorridorGraph({nodes:[{id:'a',x:-23,z:-14},{id:'b',x:0,z:-14},{id:'c',x:23,z:-14},{id:'d',x:23,z:14},{id:'e',x:0,z:14},{id:'f',x:-23,z:14}],edges:[{id:'ab',from:'a',to:'b',width:value},{id:'bc',from:'b',to:'c',width:value},{id:'cd',from:'c',to:'d',width:3},{id:'de',from:'d',to:'e',width:3},{id:'ef',from:'e',to:'f',width:3},{id:'fa',from:'f',to:'a',width:3},{id:'be',from:'b',to:'e',width:3}]});
  graph.edges.forEach(road);
  for(const j of graph.junctions)add(new T.CylinderGeometry(j.radius,j.radius,.06,24),palette.road,[j.x,.06,j.z]);
  const lots=generateFrontageLots(graph,{frontage:4,depth:5,gap:.9,setback:1,endClearance:3,acceptFootprint:corners=>corners.every(([x,z])=>Math.abs(x)<31&&Math.abs(z)<27)});
  for(const lot of lots){const h=1.4+(lot.slot%3)*.8,m=add(new T.BoxGeometry(lot.frontage,h,lot.depth),palette.lot,[lot.center[0],h/2+.03,lot.center[1]]);m.rotation.y=-lot.headingRadians;}
  stats={mode,build,value,edges:graph.edges.length,components:graph.components.length,lots:lots.length,consumer:lots.map(l=>[l.id,...l.center])};
 }else if(mode==='loft'){
  add(new T.CylinderGeometry(12,12,.4,64),palette.ground,[0,-.25,0]);
  const stations=[{center:[0,0,0],width:3,depth:2},{center:[0,2,0],width:3.2,depth:2},{center:[0,4,.3],width:value,depth:1.3},{center:[.8,6,.6],width:3,depth:1.8},{center:[1.6,8,.8],width:1.4,depth:.8}];
  const g=createSectionLoftGeometry(T,{stations,radialSegments:48});add(g,palette.loft);
  for(const s of stations)add(new T.SphereGeometry(.09,12,8),palette.markers,s.center);
  stats={mode,build,value,stations:stations.length,vertices:g.attributes.position.count,consumer:[...g.attributes.position.array.slice(2*49*3,3*49*3)]};
 }else{
  const field=createFractalHeightField({seed:71,amplitude:3.5,baseFrequency:value,octaves:4,persistence:.5,lacunarity:2}),g=createHeightFieldGeometry(T,field,{sizeX:48,sizeZ:42,segmentsX:144,segmentsZ:126});
  const p=g.attributes.position,colors=[],low=new T.Color(0x6a876f),high=new T.Color(0xc1c5ab);
  for(let i=0;i<p.count;i++){const s=field.sample(p.getX(i),p.getZ(i)),slope=Math.atan(Math.hypot(s.dx,s.dz)),c=low.clone().lerp(high,T.MathUtils.clamp(slope/1.1,0,1));colors.push(c.r,c.g,c.b);}
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));const ground=add(g,palette.field);ground.updateMatrixWorld(true);
  const points=[],ray=new T.Raycaster(),down=new T.Vector3(0,-1,0);
  for(let z=-18;z<=18;z+=3)for(let x=-21;x<=21;x+=3){const s=field.sample(x,z);if(s.height<.2||Math.atan(Math.hypot(s.dx,s.dz))>.55)continue;ray.set(new T.Vector3(x,10,z),down);const hit=ray.intersectObject(ground)[0];if(hit)points.push(hit.point);}
  const inst=new T.InstancedMesh(new T.CylinderGeometry(.05,.05,.65,6),palette.markers,points.length),pose=new T.Object3D();
  points.forEach((p,i)=>{pose.position.copy(p).y+=.325;pose.updateMatrix();inst.setMatrixAt(i,pose.matrix);});inst.instanceMatrix.needsUpdate=true;inst.computeBoundingSphere();inst.castShadow=true;root.add(inst);
  stats={mode,build,value,vertices:g.attributes.position.count,markers:points.length,consumer:points.map(p=>p.toArray()),sample:field.sample(3.2,4.1)};
 }
 document.querySelector('#description').textContent=descriptions[mode];document.querySelector('#value').value=String(value);
 document.querySelector('#stats').textContent=Object.entries(stats).filter(([k])=>!['consumer','sample'].includes(k)).map(([k,v])=>`${k}: ${v}`).join('\n');
}
function resetView(){controls.enableDamping=false;controls.reset();controls.target.set(0,mode==='loft'?4:0,0);camera.position.set(mode==='loft'?17:52,mode==='loft'?11:45,mode==='loft'?23:60);controls.update();controls.saveState();controls.enableDamping=true;}
function setMode(next){if(!(next in settings))throw new Error('unknown mode');mode=next;const s=settings[mode],input=document.querySelector('#parameter');for(const key of ['min','max','step'])input[key]=String(s[key]);value=s.value;input.value=String(value);document.querySelector('#mode').value=mode;document.querySelector('#parameter-label').textContent=s.label;rebuild();resetView();}
function setParameter(next){const s=settings[mode];if(!Number.isFinite(next)||next<s.min||next>s.max)throw new Error('parameter outside range');value=next;document.querySelector('#parameter').value=String(value);rebuild();}
document.querySelector('#mode').addEventListener('change',e=>setMode(e.target.value));document.querySelector('#parameter').addEventListener('change',e=>setParameter(Number(e.target.value)));document.querySelector('#reset').addEventListener('click',resetView);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});setMode('layout');
window.__ALGORITHM_LAB__={ready:true,setMode,setParameter,getState:()=>({...stats,camera:camera.position.toArray(),target:controls.target.toArray(),azimuth:controls.getAzimuthalAngle()}),resetView};
