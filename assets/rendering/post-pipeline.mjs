/** Explicit official-addon render chain. Inject constructors from the scene's
 * locked revision. Linear half-float scene -> optional GTAO -> optional Bloom
 * -> ONE OutputPass -> optional display-space SMAA. No volume light, temporal
 * exposure or motion blur. Owns passes/targets, borrows renderer/scene/camera.
 */
import {captureRendererState,restoreRendererState} from './renderer-state.mjs';
export function createPostPipeline(T,addons,{renderer,scene,camera,width=800,height=600,pixelRatio=1,
  ao=false,bloom=false,outline=false,smaa=true,exposure=1,bloomStrength=.18,bloomThreshold=1.2,bloomRadius=.35,
  outlineStrength=3,outlineGlow=0.15,outlineThickness=1}={}) {
  if(!renderer?.isWebGLRenderer||!scene?.isScene||!camera?.isCamera)throw Error('renderer, scene and camera required');
  const {EffectComposer,RenderPass,OutputPass,GTAOPass,UnrealBloomPass,OutlinePass,SMAAPass}=addons;
  if(![EffectComposer,RenderPass,OutputPass].every(x=>typeof x==='function'))throw Error('core post addons required');
  if(ao&&typeof GTAOPass!=='function')throw Error('GTAOPass required');
  if(bloom&&typeof UnrealBloomPass!=='function')throw Error('UnrealBloomPass required');
  if(outline&&typeof OutlinePass!=='function')throw Error('OutlinePass required');
  if(smaa&&typeof SMAAPass!=='function')throw Error('SMAAPass required');
  if(!Number.isFinite(exposure)||exposure<=0)throw Error('positive exposure required');
  if(![bloomStrength,bloomThreshold,bloomRadius].every(n=>Number.isFinite(n)&&n>=0))throw Error('nonnegative bloom parameters required');
  if(![outlineStrength,outlineGlow,outlineThickness].every(Number.isFinite)||outlineStrength<0||outlineGlow<0||outlineThickness<=0)throw Error('outline strength/glow must be nonnegative and thickness positive');
  function size(w,h,dpr){if(![w,h].every(n=>Number.isInteger(n)&&n>0)||!Number.isFinite(dpr)||dpr<=0||dpr>4)throw Error('positive integer size and pixelRatio in (0,4] required');}
  size(width,height,pixelRatio);
  const old={tone:renderer.toneMapping,output:renderer.outputColorSpace,exposure:renderer.toneMappingExposure};
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMappingExposure=exposure;
  const target=new T.WebGLRenderTarget(width,height,{type:T.HalfFloatType,depthBuffer:true,samples:0});
  target.texture.colorSpace=T.LinearSRGBColorSpace;
  const composer=new EffectComposer(renderer,target), passes={scene:new RenderPass(scene,camera)};
  composer.addPass(passes.scene);
  // Install optional constructors now so a workbench can toggle real passes.
  if(GTAOPass){passes.ao=new GTAOPass(scene,camera,width,height);passes.ao.enabled=ao;composer.addPass(passes.ao);}
  if(UnrealBloomPass){passes.bloom=new UnrealBloomPass(new T.Vector2(width,height),bloomStrength,bloomRadius,bloomThreshold);passes.bloom.enabled=bloom;composer.addPass(passes.bloom);}
  if(OutlinePass){passes.outline=new OutlinePass(new T.Vector2(width,height),scene,camera);passes.outline.enabled=outline;
    passes.outline.edgeStrength=outlineStrength;passes.outline.edgeGlow=outlineGlow;passes.outline.edgeThickness=outlineThickness;composer.addPass(passes.outline);}
  passes.output=new OutputPass();composer.addPass(passes.output);
  if(SMAAPass){passes.smaa=new SMAAPass();passes.smaa.enabled=smaa;composer.addPass(passes.smaa);}
  composer.setPixelRatio(pixelRatio);composer.setSize(width,height);
  let disposed=false,frames=0;
  function alive(){if(disposed)throw Error('post pipeline disposed');}
  return {composer,passes,
    render(dt=0){alive();if(!Number.isFinite(dt)||dt<0)throw Error('nonnegative dt required');
      const prior=captureRendererState(T,renderer),override=scene.overrideMaterial,visibility=[];
      if(passes.ao?.enabled)scene.traverse(o=>{if(o.isLine||o.isPoints||o.isLine2)visibility.push([o,o.visible]);});
      try{composer.render(dt);frames++;}finally{scene.overrideMaterial=override;for(const[o,v]of visibility)o.visible=v;restoreRendererState(renderer,prior);}
    },
    resize(w,h,dpr=pixelRatio){alive();size(w,h,dpr);width=w;height=h;pixelRatio=dpr;composer.setPixelRatio(dpr);composer.setSize(w,h);},
    setEnabled(name,value){alive();if(!['ao','bloom','outline','smaa'].includes(name)||!passes[name])throw Error('effect not installed');if(typeof value!=='boolean')throw Error('boolean required');passes[name].enabled=value;},
    setExposure(value){alive();if(!Number.isFinite(value)||value<=0)throw Error('positive exposure required');renderer.toneMappingExposure=value;},
    readState(){return {disposed,frames,width,height,pixelRatio,exposure:renderer.toneMappingExposure,
      order:Object.keys(passes).filter(k=>passes[k].enabled),effects:Object.fromEntries(['ao','bloom','outline','smaa'].filter(k=>passes[k]).map(k=>[k,passes[k].enabled])),
      outputConversions:1,type:'HDR + optional AO/Bloom + Output + display AA'};},
    dispose(){if(disposed)return;disposed=true;for(const p of Object.values(passes))p.dispose?.();composer.dispose();
      renderer.toneMapping=old.tone;renderer.outputColorSpace=old.output;renderer.toneMappingExposure=old.exposure;}
  };
}
