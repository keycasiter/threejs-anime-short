import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T = await import(process.env.THREE_MODULE ? pathToFileURL(resolve(process.env.THREE_MODULE)).href : 'three');
const paletteModule = await import('../../assets/materials/look-palette.mjs').catch(e => { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return {}; });
const lightingModule = await import('../../assets/rendering/lighting-rig.mjs').catch(e => { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return {}; });
function palette(options={}) {assert.equal(typeof paletteModule.createLookPalette,'function','look palette factory is implemented');return paletteModule.createLookPalette(T,options===null?null:{resolution:64,...options});}
function lighting(options={}) {assert.equal(typeof lightingModule.createLightingRig,'function','lighting rig factory is implemented');return lightingModule.createLightingRig(T,{bounds:new T.Box3(new T.Vector3(-6,-1,-4),new T.Vector3(8,7,3)),...options});}
const roles = ['stone','coating','metal','wood'];
function corners(bounds) {const out=[];for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])out.push(new T.Vector3(x,y,z));return out;}
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('PBR role identity uses real mapped channels rather than four flat aliases',()=>{
 const p=palette(), materials=roles.map(role=>p.get(role));
 assert.equal(new Set(materials).size,4);
 for(const m of materials){assert.equal(m.isMeshStandardMaterial,true);assert.equal(m.map.colorSpace,T.SRGBColorSpace);for(const map of [m.normalMap,m.roughnessMap,m.metalnessMap])assert.equal(map.colorSpace,T.NoColorSpace);assert.equal(m.roughness,1);assert.equal(m.metalness,1);}
 for(const role of ['stone','coating','wood'])assert.ok(Array.from(p.get(role).metalnessMap.image.data).every((v,i)=>i%4===3?v===255:v===0));
 assert.ok(Array.from(p.get('metal').metalnessMap.image.data).filter((_,i)=>i%4===2).every(v=>v>220));
 assert.notDeepEqual(materials[0].map.image.data,materials[3].map.image.data);p.dispose();
});

test('normalized options cache shared materials while color variants share owned field maps',()=>{
 const p=palette({seed:9}), a=p.get('wood');
 assert.equal(a,p.get('wood',{color:0xffffff,variant:0,wetness:0,tileSizeMeters:[.6,1.2]}));
 const tinted=p.get('wood',{color:0x8080ff});assert.notEqual(a,tinted);assert.equal(a.map,tinted.map);near(tinted.color.r,new T.Color(0x8080ff).r);
 for(const options of [{variant:1},{wetness:1},{tileSizeMeters:[.06,.12]}])assert.notEqual(a,p.get('wood',options));
 assert.notDeepEqual(a.map.image.data,p.get('wood',{variant:1}).map.image.data);
 assert.notDeepEqual(a.map.image.data,p.get('wood',{wetness:1}).map.image.data);
 assert.notDeepEqual(a.normalMap.image.data,p.get('wood',{tileSizeMeters:[.06,.12]}).normalMap.image.data);
 const state=p.inspect();state.entries.length=0;assert.equal(p.inspect().entries.length,5);p.dispose();
});

test('toon uses a real nearest-filter stepped light ramp and keeps reflective metal PBR',()=>{
 const p=palette({mode:'toon'});
 for(const role of ['stone','coating','wood']){const m=p.get(role);assert.equal(m.isMeshToonMaterial,true);assert.equal(m.gradientMap.isDataTexture,true);assert.equal(m.gradientMap.colorSpace,T.NoColorSpace);assert.equal(m.gradientMap.minFilter,T.NearestFilter);assert.equal(m.gradientMap.magFilter,T.NearestFilter);assert.equal(m.gradientMap.generateMipmaps,false);assert.ok(new Set(m.gradientMap.image.data).size>=3);assert.ok(m.map&&m.normalMap);}
 assert.equal(p.get('stone').gradientMap,p.get('wood').gradientMap);assert.equal(p.get('metal').isMeshStandardMaterial,true);assert.ok(p.get('metal').metalnessMap);p.dispose();
});

test('toon direct irradiance is zero behind the light and stepped only on its lit hemisphere',()=>{
 const p=palette({mode:'toon'}),ramp=p.get('coating',{maps:false}).gradientMap;
 // r180 getGradientIrradiance maps NdotL -1..1 to texture coordinate 0..1.
 const sample=dot=>ramp.image.data[Math.min(ramp.image.width-1,Math.floor((dot*.5+.5)*ramp.image.width))]/255;
 for(const dot of [-1,-.75,-.5,-.25,-.001])assert.equal(sample(dot),0,`back-facing direct light at ${dot}`);
 const lit=[.01,.3,.6,.9].map(sample);
 assert.ok(lit[0]>0&&lit[3]===1);
 assert.ok(lit.every((value,i)=>i===0||value>lit[i-1]));
 assert.equal(ramp.wrapS,T.ClampToEdgeWrapping);p.dispose();
});

test('seed is deterministic across mode and call order; metal parameters actually affect fields',()=>{
 const a=palette({seed:7}),b=palette({seed:7,mode:'toon'}),c=palette({seed:8});
 for(const role of roles){b.get(role,{variant:2});assert.deepEqual(a.get(role).map.image.data,b.get(role).map.image.data);assert.notDeepEqual(a.get(role).map.image.data,c.get(role).map.image.data);}
 for(const options of [{variant:1},{wetness:1},{tileSizeMeters:[.02,.02]}])assert.notDeepEqual(a.get('metal').normalMap.image.data,a.get('metal',options).normalMap.image.data);
 const dry=a.get('metal'),wet=a.get('metal',{wetness:1});assert.ok(wet.roughnessMap.image.data[1]<dry.roughnessMap.image.data[1]);a.dispose();b.dispose();c.dispose();
});

test('palette owns shared maps and ramp once and rejects use after idempotent disposal',()=>{
 for(const mode of ['pbr','toon']){const p=palette({mode}),resources=new Set();for(const role of roles)for(const m of [p.get(role),p.get(role,{color:0xffccaa})])for(const r of [m,m.map,m.normalMap,m.roughnessMap,m.metalnessMap,m.gradientMap].filter(Boolean))resources.add(r);
 const events=new Map([...resources].map(r=>[r,0]));for(const r of resources)r.addEventListener('dispose',()=>events.set(r,events.get(r)+1));p.dispose();p.dispose();assert.ok([...events.values()].every(n=>n===1));assert.equal(p.inspect().disposed,true);assert.equal(p.inspect().entries.length,0);assert.throws(()=>p.get('wood'),/disposed/);}
});

test('invalid look inputs fail before changing cache',()=>{
 for(const o of [{mode:'flat'},{resolution:63},{seed:-1},{renderer:{}},null])assert.throws(()=>palette(o));
 const p=palette();for(const role of ['glass','__proto__',''])assert.throws(()=>p.get(role));for(const o of [{wear:.2},{color:'#ffffff'},{color:-1},{color:0x1000000},{variant:.5},{wetness:NaN},{wetness:2},{tileSizeMeters:[0,1]},{tileSizeMeters:[1,Infinity]},null])assert.throws(()=>p.get('wood',o));assert.equal(p.inspect().entries.length,0);p.dispose();
});

test('key world direction and target derive from detached bounds and normalized direction',()=>{
 const bounds=new T.Box3(new T.Vector3(100,3,-20),new T.Vector3(112,9,-10));const r=lighting({bounds,keyDirection:[-2,4,1]});r.root.updateMatrixWorld(true);
 assert.deepEqual(r.key.target.getWorldPosition(new T.Vector3()).toArray(),[106,6,-15]);
 const direction=r.key.getWorldPosition(new T.Vector3()).sub(r.key.target.getWorldPosition(new T.Vector3())).normalize();near(direction.dot(new T.Vector3(-2,4,1).normalize()),1);
 bounds.min.set(-999,-999,-999);assert.deepEqual(r.readState().bounds.min,[100,3,-20]);const state=r.readState();state.keyDirection[0]=999;assert.notEqual(r.readState().keyDirection[0],999);r.dispose();
});

test('fitted shadow includes all receiver corners for oblique, vertical, flat and translated bounds',()=>{
 for(const keyDirection of [[-2,4,1],[0,1,0],[1,0,0],[0,-1,0]])for(const bounds of [new T.Box3(new T.Vector3(-6,-1,-4),new T.Vector3(8,7,3)),new T.Box3(new T.Vector3(100,0,30),new T.Vector3(120,0,40))]){
 const r=lighting({bounds,keyDirection,shadowMapSize:1024});r.root.updateMatrixWorld(true);r.key.shadow.updateMatrices(r.key);const camera=r.key.shadow.camera;
 for(const point of corners(bounds)){const projected=point.clone().project(camera);assert.ok(projected.toArray().every(Number.isFinite));for(const v of projected.toArray())assert.ok(v>=-1-1e-9&&v<=1+1e-9,`receiver corner ${projected.toArray()} clipped`);}
 const state=r.readState();near(state.shadow.texelSize[0],(camera.right-camera.left)/1024);near(state.shadow.texelSize[1],(camera.top-camera.bottom)/1024);assert.ok(camera.near>0&&camera.far>camera.near);r.dispose();}
});

test('receiver shadow projection lies opposite horizontal light source and at identical depth plane',()=>{
 const r=lighting({keyDirection:[2,4,1]});const source=r.key.position.clone().sub(r.key.target.position).normalize();const caster=new T.Vector3(0,2,0),hit=caster.clone().addScaledVector(source,-2/source.y);near(hit.y,0);assert.ok(hit.x<caster.x&&hit.z<caster.z);r.key.shadow.updateMatrices(r.key);
 // Along a light ray, UV stays fixed while depth advances: required for actual shadow lookup.
 const a=caster.clone().applyMatrix4(r.key.shadow.matrix),b=hit.clone().applyMatrix4(r.key.shadow.matrix);near(a.x,b.x);near(a.y,b.y);assert.ok(b.z>a.z);r.dispose();
});

test('light configuration reaches actual lights; owned shadow targets release once without touching borrowed meshes',()=>{
 const r=lighting({keyColor:0xffaa66,keyIntensity:3,fillColor:0x88bbff,fillIntensity:.7,ambientIntensity:.1});assert.equal(r.key.intensity,3);assert.equal(r.fill.intensity,.7);assert.equal(r.ambient.intensity,.1);assert.equal(r.key.color.getHex(),0xffaa66);assert.equal(r.fill.color.getHex(),0x88bbff);assert.equal(r.key.castShadow,true);assert.equal(r.fill.castShadow,false);
 const scene=new T.Scene(),material=new T.MeshStandardMaterial(),geometry=new T.BoxGeometry();scene.add(r.root,new T.Mesh(geometry,material));let materials=0,geometries=0,maps=0;material.addEventListener('dispose',()=>materials++);geometry.addEventListener('dispose',()=>geometries++);const target=new T.WebGLRenderTarget(16,16);target.addEventListener('dispose',()=>maps++);r.key.shadow.map=target;r.dispose();r.dispose();assert.equal(maps,1);assert.equal(materials,0);assert.equal(geometries,0);assert.equal(r.root.parent,null);assert.equal(r.readState().disposed,true);material.dispose();geometry.dispose();
});

test('lighting rejects ambiguous keys, invalid bounds, zero direction and unsupported shadow dimensions',()=>{
 assert.equal(typeof lightingModule.createLightingRig,'function');
 for(const options of [{bounds:null},{bounds:{min:[0,0,0],max:[1,1,1]}},{bounds:new T.Box3()},{bounds:new T.Box3(new T.Vector3(),new T.Vector3())},{keyDirection:[0,0,0]},{keyDirection:[1,Infinity,0]},{keyIntensity:-1},{fillIntensity:NaN},{ambientIntensity:-1},{shadowMapSize:1000},{shadowMapSize:8192},{renderer:{}}])assert.throws(()=>lighting(options));
});

test('sky and ground indirect light reaches an owned hemisphere source and mutable source state',()=>{
 const r=lighting({hemisphereIntensity:.6,skyColor:0xaabbff,groundColor:'#685746',ambientIntensity:.07});
 assert.equal(r.hemisphere.isHemisphereLight,true);assert.equal(r.hemisphere.parent,r.root);assert.equal(r.hemisphere.intensity,.6);
 assert.equal(r.hemisphere.color.getHex(),0xaabbff);assert.equal(r.hemisphere.groundColor.getHex(),0x685746);assert.equal(r.ambient.intensity,.07);
 r.hemisphere.intensity=.9;r.hemisphere.color.set(0xffeecc);r.hemisphere.groundColor.set(0x332211);
 assert.deepEqual(r.readState().hemisphere,{skyColor:0xffeecc,groundColor:0x332211,intensity:.9});
 // r180 Light.dispose is a no-op for lights without shadows; it emits no event.
 const scene=new T.Scene();scene.add(r.root);let releases=0;const dispose=r.hemisphere.dispose;
 r.hemisphere.dispose=function(){releases++;return dispose.call(this);};
 r.dispose();r.dispose();assert.equal(releases,1);assert.equal(r.hemisphere.parent,null);
 const legacy=lighting();assert.equal(legacy.hemisphere.intensity,0);assert.equal(legacy.ambient.intensity,.12);legacy.dispose();
});

test('hemisphere validates intensity and both colors before constructing owned sources',()=>{
 for(const options of [{hemisphereIntensity:-1},{hemisphereIntensity:Infinity},{skyColor:'bad'},{groundColor:-1},{groundColor:new T.Color(NaN,0,0)}])assert.throws(()=>lighting(options));
 const skyColor=new T.Color(.2,.3,.4),groundColor=new T.Color(.1,.2,.3),r=lighting({hemisphereIntensity:1,skyColor,groundColor});
 skyColor.set(0);groundColor.set(0);near(r.hemisphere.color.r,.2);near(r.hemisphere.groundColor.b,.3);r.dispose();
});

test('maps:false keeps role BRDF identity on uncharted geometry and shares only its own scalar material',()=>{
 for(const mode of ['pbr','toon']){
 const p=palette({mode});
 for(const role of roles){const m=p.get(role,{maps:false});assert.equal(m,p.get(role,{maps:false}));assert.notEqual(m,p.get(role));for(const name of ['map','normalMap','roughnessMap','metalnessMap'])assert.ok(m[name]==null);assert.ok(m.color.r+m.color.g+m.color.b>0);assert.notEqual(m.color.getHex(),0xffffff);
 const wet=p.get(role,{maps:false,wetness:1}),variant=p.get(role,{maps:false,variant:1});assert.ok(wet.color.r<m.color.r);assert.notEqual(m.color.r,variant.color.r);
 const tinted=p.get(role,{maps:false,color:0xff0000});near(tinted.color.g,0);near(tinted.color.b,0);
 if(mode==='pbr'||role==='metal'){assert.ok(wet.roughness<m.roughness);assert.equal(m.metalness,role==='metal'?.96:0);}else assert.ok(m.gradientMap);
 }
 assert.throws(()=>p.get('stone',{maps:'false'}));
 assert.throws(()=>p.get('stone',{maps:false,tileSizeMeters:[1,1]}),/tileSizeMeters/);p.dispose();
 }
});

test('independent baseColor reaches a light sRGB target in linear space without the dark recipe multiplier',()=>{
 const target=new T.Color(0xf1eadb);
 for(const mode of ['pbr','toon']){
 const p=palette({mode,seed:17});
 const light=p.get('coating',{maps:false,baseColor:0xf1eadb});
 target.toArray().forEach((component,i)=>{
   const actual=light.color.toArray()[i];assert.ok(actual>=component*.98&&actual<=component*1.02,`light target channel ${i}: ${actual} versus ${component}`);
 });
 near(light.color.r/light.color.g,target.r/target.g);
 assert.ok(light.color.r>p.get('coating',{maps:false}).color.r*10);
 const wet=p.get('coating',{maps:false,baseColor:0xf1eadb,wetness:1});near(wet.color.r/light.color.r,.7);
 const variant=p.get('coating',{maps:false,baseColor:0xf1eadb,variant:1});assert.notEqual(variant.color.r,light.color.r);
 const tinted=p.get('coating',{maps:false,baseColor:0xf1eadb,color:0x8080ff});near(tinted.color.r/light.color.r,new T.Color(0x8080ff).r);near(tinted.color.b,light.color.b);
 assert.equal(light,p.get('coating',{maps:false,baseColor:0xf1eadb}));
 assert.notEqual(light,p.get('coating',{maps:false,baseColor:0xf1eadc}));
 assert.equal(p.get('coating',{maps:false}),p.get('coating',{maps:false,baseColor:null}));
 assert.equal(light.userData.lookPalette.baseColor,0xf1eadb);
 const state=p.inspect(),entry=state.entries.find(e=>e.materialUuid===light.uuid);assert.equal(entry.baseColor,0xf1eadb);entry.baseColor=0;assert.equal(p.inspect().entries.find(e=>e.materialUuid===light.uuid).baseColor,0xf1eadb);
 p.dispose();
 }
});

test('baseColor selection preserves material role BRDFs and rejects invalid or textured combinations',()=>{
 const p=palette();const materials=roles.map(role=>p.get(role,{maps:false,baseColor:0xffffff}));
 assert.equal(new Set(materials).size,4);assert.equal(new Set(materials.map(m=>m.roughness)).size,4);
 roles.forEach((role,i)=>{assert.equal(materials[i].metalness,role==='metal'?.96:0);assert.equal(materials[i].roughness,p.get(role,{maps:false}).roughness);});
 const count=p.inspect().entries.length;
 for(const baseColor of [-1,0x1000000,.5,NaN,'#ffffff',{},[],true])assert.throws(()=>p.get('stone',{maps:false,baseColor}),/baseColor/);
 for(const options of [{baseColor:0xffffff},{maps:true,baseColor:0xffffff},{maps:true,baseColor:null}])assert.throws(()=>p.get('stone',options),/baseColor/);
 assert.equal(p.inspect().entries.length,count);
 assert.equal(p.get('wood',{maps:false,baseColor:0}).color.getHex(),0);
 p.dispose();
});
