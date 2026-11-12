import {inspectFeatureVisibility} from './view-readability.mjs';

/** Rank authored views using actual surface samples. This addresses geometric
 * occlusion and framing only; it cannot select a good composition or infer which
 * feature matters. Keep complementary views and inspect the resulting image.
 * O(candidates * samples * raycast cost); use while building/setting a view, not per frame.
 */
export function selectObservationView(T,{candidates,points,occluders=[],ignore=[],viewport,overlays=[],
  fovDegrees=41,near=.1,far=250,epsilon=1e-5}={}) {
  if(!Array.isArray(candidates)||!candidates.length||candidates.length>64)throw new Error('Supply 1..64 authored camera candidates');
  if(!Array.isArray(points)||!points.length)throw new Error('Actual feature surface samples are required');
  if(!Number.isFinite(fovDegrees)||fovDegrees<=0||fovDegrees>=180||!Number.isFinite(near)||near<=0||!Number.isFinite(far)||far<=near)throw new Error('Invalid perspective projection');
  if(!viewport||!Number.isFinite(viewport.width)||viewport.width<=0||!Number.isFinite(viewport.height)||viewport.height<=0)throw new Error('Positive viewport required');
  const camera=new T.PerspectiveCamera(fovDegrees,viewport.width/viewport.height,near,far),results=[];
  for(let index=0;index<candidates.length;index++){
    const view=candidates[index];
    for(const k of ['position','target'])if(!Array.isArray(view?.[k])||view[k].length!==3||!view[k].every(Number.isFinite))throw new Error('Candidate position/target need finite xyz');
    const target=new T.Vector3(...view.target);camera.position.fromArray(view.position);
    if(camera.position.distanceToSquared(target)<1e-16)throw new Error('Camera and target must be distinct');
    camera.lookAt(target);camera.updateMatrixWorld();
    const inspection=inspectFeatureVisibility(T,{camera,points,occluders,ignore,viewport,overlays,epsilon});
    results.push({index,position:[...view.position],target:[...view.target],fovDegrees,
      visibleSampleCount:inspection.visibleSampleCount,onscreenSampleCount:inspection.onscreenSampleCount,
      overlaySampleCount:inspection.overlaySampleCount,totalSampleCount:inspection.totalSampleCount});
  }
  const sorted=[...results].sort((a,b)=>b.visibleSampleCount-a.visibleSampleCount||b.onscreenSampleCount-a.onscreenSampleCount||a.overlaySampleCount-b.overlaySampleCount||a.index-b.index);
  const best=sorted[0];return {index:best.index,position:best.position,target:best.target,fovDegrees,
    inspection:{visibleSampleCount:best.visibleSampleCount,onscreenSampleCount:best.onscreenSampleCount,overlaySampleCount:best.overlaySampleCount,totalSampleCount:best.totalSampleCount},candidates:results};
}
