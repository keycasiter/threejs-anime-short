/** Adapter around caller-supplied official THREE Reflector. The addon owns
 * mirror camera / oblique clipping / projective sampling. This module adds
 * bounded resolution, explicit exclusions, recursion guard and try/finally
 * state recovery. It is a flat mirror, NOT rough PBR wet-ground reflection,
 * multilayer water or a curved reflector. Keep the official addon license.
 */
import {captureRendererState,restoreRendererState} from './renderer-state.mjs';
export function createPlanarReflection(T,{Reflector},{geometry,width=512,height=512,
  color=0x999999,clipBias=.003,exclude=[]}={}) {
  if(typeof Reflector!=='function'||!geometry?.isBufferGeometry)throw Error('Reflector and geometry required');
  if(![width,height].every(n=>Number.isInteger(n)&&n>=16&&n<=4096))throw Error('reflection size must be integer 16..4096');
  if(!Number.isFinite(clipBias)||clipBias<0)throw Error('clipBias must be nonnegative');
  if(!Array.isArray(exclude)||exclude.some(o=>!o?.isObject3D))throw Error('exclude must be Object3D[]');
  const root=new Reflector(geometry,{textureWidth:width,textureHeight:height,color,clipBias,multisample:0});
  root.name='planar-reflection';const capture=root.onBeforeRender;let busy=false,enabled=true,disposed=false,captures=0;
  root.onBeforeRender=function(renderer,scene,camera,...args){
    // Depth/normal override passes must not overwrite the lit mirror texture.
    if(!enabled||disposed||busy||scene.overrideMaterial)return;
    const old=captureRendererState(T,renderer),visible=root.visible;
    const hidden=new Map(exclude.map(o=>[o,o.visible]));
    scene.traverse(o=>{if(o!==root&&o.isReflector&&!hidden.has(o))hidden.set(o,o.visible);});
    busy=true;
    try {for(const[o]of hidden)o.visible=false;renderer.setScissorTest(false);
      capture.call(root,renderer,scene,camera,...args);captures++;
    } finally {busy=false;root.visible=visible;for(const[o,v]of hidden)o.visible=v;restoreRendererState(renderer,old);}
  };
  return {root,texture:root.getRenderTarget().texture,
    setEnabled(value){if(disposed)throw Error('reflection disposed');if(typeof value!=='boolean')throw Error('boolean required');enabled=value;root.visible=value;},
    resize(w,h){if(disposed)throw Error('reflection disposed');if(![w,h].every(n=>Number.isInteger(n)&&n>=16&&n<=4096))throw Error('reflection size must be integer 16..4096');root.getRenderTarget().setSize(w,h);width=w;height=h;},
    readState:()=>({enabled,disposed,captureAttempts:captures,width,height,type:'single-plane mirror; other reflectors excluded'}),
    dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.dispose();}
  };
}
