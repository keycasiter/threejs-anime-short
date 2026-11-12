import {createProceduralPalette} from './procedural-palette.mjs';
import {createRegionMaterial,disposeMaterialResources} from './surface-fields.mjs';

const DEFAULTS = {stone:[1,1],coating:[.8,.8],metal:[.5,.5],wood:[.6,1.2]};
function keys(options, allowed) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw Error('options must be an object');
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw Error(`Unknown option: ${key}`);
}
function uint(value, limit, name) {if (!Number.isInteger(value) || value < 0 || value > limit) throw Error(`${name} must be an integer in [0,${limit}]`);}
function hash(n) {n=Math.imul(n^n>>>16,0x21f0aaad);n=Math.imul(n^n>>>15,0x735a2d97);return (n^n>>>15)>>>0;}

/** Shared role materials, with one owner for all returned materials and maps.
 * Options: variant:uint32, wetness:0..1, color:uint24 sRGB multiplier,
 * baseColor:uint24|null for maps:false only (null keeps the role recipe),
 * tileSizeMeters:[uLength,vLength], maps:boolean=true. maps:false uses scalar
 * role responses without UV textures; Toon still owns its lighting ramp. Physical UV/TBN requirements are inherited
 * from procedural-palette. Toon has stepped direct diffuse light; reflective
 * metal deliberately remains PBR. No renderer, geometry or environment is owned.
 */
export function createLookPalette(T, options={}) {
  keys(options,['mode','seed','resolution']);
  const {mode='pbr',seed=1,resolution=256}=options;
  if (!['pbr','toon'].includes(mode)) throw Error('mode must be pbr or toon');
  // Delegate seed/resolution validation and the three established fields.
  const procedural=createProceduralPalette(T,{seed,resolution});
  const cache=new Map(),metals=new Map();let gradient=null,disposed=false;
  const alive=()=>{if(disposed)throw Error('look palette is disposed');};
  function normalize(role, opts) {
    alive();if(!Object.hasOwn(DEFAULTS,role))throw Error(`Unknown role: ${String(role)}`);
    keys(opts,['variant','wetness','tileSizeMeters','color','maps','baseColor']);
    const {variant=0,wetness=0,tileSizeMeters=DEFAULTS[role],color=0xffffff,maps=true,baseColor=null}=opts;
    if(typeof maps!=='boolean')throw Error('maps must be a boolean');
    if(maps&&Object.hasOwn(opts,'baseColor'))throw Error('baseColor requires maps:false');
    if(baseColor!==null)uint(baseColor,0xffffff,'baseColor');
    if(!maps&&Object.hasOwn(opts,'tileSizeMeters'))throw Error('tileSizeMeters requires maps:true');
    uint(variant,0xffffffff,'variant');uint(color,0xffffff,'color');
    if(!Number.isFinite(wetness)||wetness<0||wetness>1)throw Error('wetness must be in [0,1]');
    if(!Array.isArray(tileSizeMeters)||tileSizeMeters.length!==2||tileSizeMeters.some(n=>!Number.isFinite(n)||n<.001||n>1000))throw Error('tileSizeMeters must contain two lengths in [.001,1000] meters');
    return {role,variant,wetness,tileSizeMeters:[...tileSizeMeters],color,maps,baseColor};
  }
  function metal(config) {
    const {variant,wetness,tileSizeMeters}=config,key=JSON.stringify({variant,wetness,tileSizeMeters});
    if(!metals.has(key)){
      const salt=hash(seed^hash(variant)^17011),random=(i,j)=>hash(salt^hash(i+43*j))/4294967296;
      const noise=(u,v)=>{
        const x=u*13,y=v*17,i=Math.floor(x),j=Math.floor(y),fade=t=>t*t*(3-2*t),a=fade(x-i),b=fade(y-j);
        const value=(di,dj)=>random((i+di)%13,(j+dj)%17),mix=(a,b,t)=>a+(b-a)*t;
        return mix(mix(value(0,0),value(1,0),a),mix(value(0,1),value(1,1),a),b);
      };
      const baked=createRegionMaterial(T,{width:resolution,height:resolution,physicalSize:tileSizeMeters,wrapU:'repeat',wrapV:'repeat',regionAt:({u,v})=>{
        const n=noise(u,v);
        return {color:new T.Color().setRGB(.48,.51,.54).multiplyScalar((.96+.08*n)*(1-.2*wetness)),
          roughness:(.27+.12*n)*(1-.65*wetness),metalness:.96,height:(.00005+.0004*n)*(1-.7*wetness)};
      }});
      metals.set(key,baked);
    }
    return metals.get(key).material;
  }
  function ramp() {
    if(!gradient){
      // r180 maps NdotL -1..1 to texture coordinate 0..1 and does not
      // multiply by max(NdotL, 0) afterwards. Keep the unlit hemisphere
      // free of direct light; indirect/fill light supplies dark-side detail.
      // Raw radiance multipliers, not encoded display colors. Nearest sampling
      // makes constant intervals; linear filtering would erase the Toon bands.
      gradient=new T.DataTexture(new Uint8Array([0,0,0,0,62,130,198,255]),8,1,T.RedFormat,T.UnsignedByteType);
      gradient.colorSpace=T.NoColorSpace;gradient.minFilter=T.NearestFilter;gradient.magFilter=T.NearestFilter;
      gradient.generateMipmaps=false;gradient.flipY=false;gradient.unpackAlignment=1;gradient.needsUpdate=true;
    }
    return gradient;
  }
  return {
    get(role,opts={}) {
      const config=normalize(role,opts),key=JSON.stringify(config);
      if(!cache.has(key)){
        const {variant,wetness,tileSizeMeters,color,maps,baseColor}=config;
        let material;
        if(!maps){
          const presets={stone:[[.31,.32,.295],.8,0],coating:[[.035,.13,.16],.455,0],metal:[[.48,.51,.54],.33,.96],wood:[[.29,.14,.06],.65,0]};
          const [rgb,roughness,metalness]=presets[role];
          const variation=.98+.04*hash(seed^hash(variant)^17011)/4294967296;
          const surfaceColor=(baseColor===null?new T.Color().setRGB(...rgb):new T.Color(baseColor))
            .multiplyScalar(variation*(1-.3*wetness)).multiply(new T.Color(color));
          material=mode==='toon'&&role!=='metal'
            ?new T.MeshToonMaterial({color:surfaceColor,gradientMap:ramp()})
            :new T.MeshStandardMaterial({color:surfaceColor,roughness:roughness*(1-.65*wetness),metalness});
        }else{
          const base=role==='metal'?metal(config):procedural.get(role==='coating'?'coated-metal':role,{variant,wetness,tileSizeMeters});
          material=mode==='toon'&&role!=='metal'
            ?new T.MeshToonMaterial({map:base.map,normalMap:base.normalMap,gradientMap:ramp(),color})
            :base.clone();
          material.color.setHex(color);
        }
        material.name=`look:${mode}:${role}:${variant}`;
        material.userData.lookPalette={...structuredClone(config),mode,seed,resolution,
          shading:material.isMeshToonMaterial?'stepped diffuse':'PBR',units:'meters'};
        cache.set(key,{material,config});
      }
      return cache.get(key).material;
    },
    inspect() {return {disposed,mode,seed,resolution,roles:Object.keys(DEFAULTS),
      entries:[...cache.values()].map(({config,material})=>({...structuredClone(config),materialUuid:material.uuid,type:material.type})),
      style:mode==='toon'?'stepped dielectric diffuse with PBR metal reflections':'PBR for all roles',
      ownership:'palette owns shared materials, maps and gradient; callers borrow and must not mutate or dispose them'};},
    dispose() {
      if(disposed)return;disposed=true;
      const children=[...Array.from(cache.values(),entry=>entry.material),procedural,...metals.values()];
      if(gradient)children.push(gradient);
      cache.clear();metals.clear();gradient=null;
      disposeMaterialResources(children,'Look palette');
    }
  };
}
