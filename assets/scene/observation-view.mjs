import {inspectFeatureVisibility} from './view-readability.mjs';

/** Rank authored views using actual surface samples. This addresses geometric
 * occlusion and framing only; it cannot select a good composition or infer which
 * feature matters. Keep complementary views and inspect the resulting image.
 * requiredFeatures assigns each relation its own visible fraction, excluding
 * overlays; abundant body samples cannot compensate for a missing interface.
 * frameBounds is a caller-supplied world envelope used ONLY to reject cropping,
 * never as an opaque visibility proxy. Constraints rank candidates, not certify
 * coverage: inspect the returned flags when none of the authored views suffice.
 * O(candidates * samples * raycast cost); use while building/setting a view, not per frame.
 */
export function selectObservationView(T,{candidates,points,occluders=[],ignore=[],viewport,overlays=[],
  fovDegrees=41,near=.1,far=250,epsilon=1e-5,requiredFeatures=[],frameBounds=null,marginPixels=0}={}) {
  if(!Array.isArray(candidates)||!candidates.length||candidates.length>64)throw new Error('Supply 1..64 authored camera candidates');
  if(!Array.isArray(points)||!points.length)throw new Error('Actual feature surface samples are required');
  if(!Number.isFinite(fovDegrees)||fovDegrees<=0||fovDegrees>=180||!Number.isFinite(near)||near<=0||!Number.isFinite(far)||far<=near)throw new Error('Invalid perspective projection');
  if(!viewport||!Number.isFinite(viewport.width)||viewport.width<=0||!Number.isFinite(viewport.height)||viewport.height<=0)throw new Error('Positive viewport required');
  if(!Number.isFinite(marginPixels)||marginPixels<0||marginPixels*2>=Math.min(viewport.width,viewport.height))throw new Error('marginPixels must leave a positive frame');
  if(!Array.isArray(requiredFeatures)||requiredFeatures.length>32)throw new Error('requiredFeatures must contain at most 32 feature groups');
  const ids=new Set(),features=Array.from(requiredFeatures,feature=>{
    if(typeof feature?.id!=='string'||!feature.id.length||ids.has(feature.id)||!Array.isArray(feature.points)||!feature.points.length)throw new Error('Features need unique IDs and actual surface points');
    const minVisibleFraction=feature.minVisibleFraction??1;
    if(!Number.isFinite(minVisibleFraction)||minVisibleFraction<=0||minVisibleFraction>1)throw new Error('Feature minVisibleFraction must be in (0,1]');
    ids.add(feature.id);return {id:feature.id,points:feature.points,minVisibleFraction};
  });
  let envelope=null;
  if(frameBounds!==null){
    if(!frameBounds?.isBox3||frameBounds.isEmpty()||![...frameBounds.min.toArray(),...frameBounds.max.toArray()].every(Number.isFinite))throw new Error('frameBounds must be a finite nonempty world Box3');
    envelope=frameBounds.clone();
  }
  const camera=new T.PerspectiveCamera(fovDegrees,viewport.width/viewport.height,near,far),results=[];
  for(let index=0;index<candidates.length;index++){
    const view=candidates[index];
    for(const k of ['position','target'])if(!Array.isArray(view?.[k])||view[k].length!==3||!view[k].every(Number.isFinite))throw new Error('Candidate position/target need finite xyz');
    const target=new T.Vector3(...view.target);camera.position.fromArray(view.position);
    if(camera.position.distanceToSquared(target)<1e-16)throw new Error('Camera and target must be distinct');
    camera.lookAt(target);camera.updateMatrixWorld();
    const inspection=inspectFeatureVisibility(T,{camera,points,occluders,ignore,viewport,overlays,epsilon});
    const featureResults=features.map(feature=>{
      const result=inspectFeatureVisibility(T,{camera,points:feature.points,occluders,ignore,viewport,overlays,epsilon});
      const visibleFraction=result.samples.filter(s=>s.status==='visible'&&s.overlays.length===0).length/result.totalSampleCount;
      return {id:feature.id,visibleFraction,minVisibleFraction:feature.minVisibleFraction,satisfied:visibleFraction>=feature.minVisibleFraction,overlaySampleCount:result.overlaySampleCount};
    });
    let envelopeInside=true;
    if(envelope)for(const x of [envelope.min.x,envelope.max.x])for(const y of [envelope.min.y,envelope.max.y])for(const z of [envelope.min.z,envelope.max.z]){
      const point=new T.Vector3(x,y,z),depth=-point.clone().applyMatrix4(camera.matrixWorldInverse).z,ndc=point.project(camera);
      if(depth<near||depth>far||!ndc.toArray().every(Number.isFinite)||Math.abs(ndc.x)>1-2*marginPixels/viewport.width||Math.abs(ndc.y)>1-2*marginPixels/viewport.height)envelopeInside=false;
    }
    results.push({index,position:[...view.position],target:[...view.target],fovDegrees,
      visibleSampleCount:inspection.visibleSampleCount,onscreenSampleCount:inspection.onscreenSampleCount,
      overlaySampleCount:inspection.overlaySampleCount,totalSampleCount:inspection.totalSampleCount,
      visibleSampleIndices:inspection.samples.flatMap((sample,i)=>sample.status==='visible'&&sample.overlays.length===0?[i]:[]),
      envelopeInside,features:featureResults,satisfiedFeatureCount:featureResults.filter(f=>f.satisfied).length,
      worstFeatureFraction:featureResults.length?Math.min(...featureResults.map(f=>f.visibleFraction)):1});
  }
  const sorted=[...results].sort((a,b)=>Number(b.envelopeInside)-Number(a.envelopeInside)||b.satisfiedFeatureCount-a.satisfiedFeatureCount||b.worstFeatureFraction-a.worstFeatureFraction||b.visibleSampleCount-a.visibleSampleCount||b.onscreenSampleCount-a.onscreenSampleCount||a.overlaySampleCount-b.overlaySampleCount||a.index-b.index);
  const best=sorted[0];return {index:best.index,position:best.position,target:best.target,fovDegrees,
    inspection:{visibleSampleCount:best.visibleSampleCount,onscreenSampleCount:best.onscreenSampleCount,overlaySampleCount:best.overlaySampleCount,totalSampleCount:best.totalSampleCount,
      envelopeInside:best.envelopeInside,satisfiedFeatureCount:best.satisfiedFeatureCount,worstFeatureFraction:best.worstFeatureFraction,features:best.features},candidates:results};
}
