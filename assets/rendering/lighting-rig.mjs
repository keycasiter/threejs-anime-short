/** A world-space direct-light rig fitted to a caller-supplied Box3 in meters.
 * keyDirection points FROM the target TOWARD the source (same as sky sunDirection).
 * Parent root under the scene without transformations. Geometry, materials,
 * environment and renderer are borrowed; this helper provides no GI or PMREM.
 */
export function createLightingRig(T, options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw Error('options must be an object');
  const allowed=['bounds','keyDirection','keyColor','keyIntensity','fillColor','fillIntensity','ambientIntensity','hemisphereIntensity','skyColor','groundColor','shadowMapSize'];
  for(const k of Object.keys(options))if(!allowed.includes(k))throw Error(`Unknown option: ${k}`);
  const {bounds,keyDirection=[-.6,.8,.35],keyColor=0xffe2ba,keyIntensity=3,
    fillColor=0xa8c6ee,fillIntensity=.65,ambientIntensity=.12,hemisphereIntensity=0,skyColor=0xffffff,groundColor=0xffffff,shadowMapSize=2048}=options;
  if(!bounds?.isBox3||!bounds.min?.isVector3||!bounds.max?.isVector3||bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite))throw Error('bounds must be a finite nonempty THREE.Box3');
  const box=bounds.clone(),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3()),diameter=size.length();
  if(!Number.isFinite(diameter)||diameter<1e-8||!center.toArray().every(Number.isFinite))throw Error('bounds must have numerically representable nonzero extent');
  const values=keyDirection?.isVector3?keyDirection.toArray():keyDirection;
  if(!Array.isArray(values)||values.length!==3||!values.every(Number.isFinite)||!Number.isFinite(Math.hypot(...values))||Math.hypot(...values)<1e-12)throw Error('keyDirection must be a finite nonzero xyz direction');
  for(const [name,n] of Object.entries({keyIntensity,fillIntensity,ambientIntensity,hemisphereIntensity}))if(!Number.isFinite(n)||n<0)throw Error(`${name} must be finite and nonnegative`);
  if(!Number.isInteger(shadowMapSize)||shadowMapSize<128||shadowMapSize>4096||(shadowMapSize&(shadowMapSize-1)))throw Error('shadowMapSize must be a power of two in [128,4096]');
  function color(value){
    if(value?.isColor){if(!value.toArray().every(n=>Number.isFinite(n)&&n>=0))throw Error('invalid light color');return value.clone();}
    if(!(Number.isInteger(value)&&value>=0&&value<=0xffffff)&&!(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)))throw Error('light colors must be uint24, #rrggbb or THREE.Color');
    return new T.Color(value);
  }
  const keyTint=color(keyColor),fillTint=color(fillColor),skyTint=color(skyColor),groundTint=color(groundColor),direction=new T.Vector3(...values).normalize();
  const root=new T.Group();root.name='lighting-rig';
  const key=new T.DirectionalLight(keyTint,keyIntensity),fill=new T.DirectionalLight(fillTint,fillIntensity),ambient=new T.AmbientLight(0xffffff,ambientIntensity);
  const hemisphere=new T.HemisphereLight(skyTint,groundTint,hemisphereIntensity);hemisphere.name='lighting-hemisphere';
  key.name='lighting-key';fill.name='lighting-fill';ambient.name='lighting-ambient';
  const distance=Math.max(diameter*1.5,.1),padding=Math.max(diameter*.04,.002);
  key.position.copy(center).addScaledVector(direction,distance);key.target.position.copy(center);key.castShadow=true;
  fill.position.copy(center).addScaledVector(new T.Vector3(-direction.x,Math.abs(direction.y)*.5+.3,-direction.z).normalize(),distance);fill.target.position.copy(center);
  root.add(key,key.target,fill,fill.target,ambient,hemisphere);root.updateMatrixWorld(true);
  const camera=key.shadow.camera;
  camera.up.set(Math.abs(direction.y)>.95?1:0,Math.abs(direction.y)>.95?0:1,0);
  key.shadow.updateMatrices(key);
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const p=new T.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse);
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);
  }
  camera.left=minX-padding;camera.right=maxX+padding;camera.bottom=minY-padding;camera.top=maxY+padding;
  camera.near=Math.max(.001,-maxZ-padding);camera.far=-minZ+padding;camera.updateProjectionMatrix();
  key.shadow.mapSize.set(shadowMapSize,shadowMapSize);key.shadow.normalBias=diameter*.00015;key.shadow.bias=-.0001;key.shadow.updateMatrices(key);
  let disposed=false;
  return {root,key,fill,ambient,hemisphere,
    readState(){return {disposed,bounds:{min:box.min.toArray(),max:box.max.toArray()},keyDirection:direction.toArray(),directionConvention:'target toward light source',
      key:{position:key.position.toArray(),target:key.target.position.toArray(),color:key.color.getHex(),intensity:key.intensity},
      fill:{position:fill.position.toArray(),target:fill.target.position.toArray(),color:fill.color.getHex(),intensity:fill.intensity},ambientIntensity:ambient.intensity,
      hemisphere:{skyColor:hemisphere.color.getHex(),groundColor:hemisphere.groundColor.getHex(),intensity:hemisphere.intensity},
      shadow:{mapSize:key.shadow.mapSize.toArray(),texelSize:[(camera.right-camera.left)/key.shadow.mapSize.x,(camera.top-camera.bottom)/key.shadow.mapSize.y],
        left:camera.left,right:camera.right,top:camera.top,bottom:camera.bottom,near:camera.near,far:camera.far},
      units:'meters',type:'direct key + nonshadowing fill + ambient + optional sky/ground hemisphere; no GI',ownership:'rig owns lights, targets and their shadow storage; renderer, environment, materials and geometry are borrowed'};},
    dispose(){if(disposed)return;disposed=true;root.removeFromParent();key.dispose();fill.dispose();ambient.dispose();hemisphere.dispose();root.clear();}
  };
}
