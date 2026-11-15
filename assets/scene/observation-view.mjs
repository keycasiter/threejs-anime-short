import {inspectFeatureVisibility} from './view-readability.mjs';

function projectedBounds(points) {
  let count=0,left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const sample of points){
    if(sample.status!=='visible'||sample.overlays.length||!sample.pixel)continue;
    count++;left=Math.min(left,sample.pixel.x);top=Math.min(top,sample.pixel.y);
    right=Math.max(right,sample.pixel.x);bottom=Math.max(bottom,sample.pixel.y);
  }
  return count?{left,top,width:right-left,height:bottom-top}:null;
}

function normalizeProjectedBounds(bounds) {
  if(bounds===undefined)return null;
  if(!bounds||!Number.isFinite(bounds.width)||bounds.width<0||!Number.isFinite(bounds.height)||bounds.height<0||bounds.width===0&&bounds.height===0){
    throw new Error('minProjectedBoundsPx needs finite nonnegative width/height and at least one positive extent');
  }
  return {width:bounds.width,height:bounds.height};
}

/** Rank authored views using actual surface samples. This addresses geometric
 * occlusion and framing only; it cannot select a good composition or infer which
 * feature matters. Keep complementary views and inspect the resulting image.
 * requiredFeatures assigns each relation its own visible fraction, excluding
 * overlays; abundant body samples cannot compensate for a missing interface.
 * A feature may also declare minProjectedBoundsPx to reject a view where the
 * sampled readable surface is too small in the target viewport. It is an
 * authored task constraint, not a universal legibility threshold.
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
    const minProjectedBoundsPx=normalizeProjectedBounds(feature.minProjectedBoundsPx);
    ids.add(feature.id);return {id:feature.id,points:feature.points,minVisibleFraction,minProjectedBoundsPx};
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
      const projectedBoundsPx=projectedBounds(result.samples);
      const minBounds=feature.minProjectedBoundsPx;
      const projectedSizeSatisfied=!minBounds||(projectedBoundsPx!==null&&
        projectedBoundsPx.width>=minBounds.width&&projectedBoundsPx.height>=minBounds.height);
      return {id:feature.id,visibleFraction,minVisibleFraction:feature.minVisibleFraction,
        projectedBoundsPx,minProjectedBoundsPx:minBounds,projectedSizeSatisfied,
        satisfied:visibleFraction>=feature.minVisibleFraction&&projectedSizeSatisfied,
        overlaySampleCount:result.overlaySampleCount};
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

/** Audit authored complementary views against semantic surface samples.
 * Each feature sample is covered when visible outside overlays in at least one
 * view whose optional projected-size constraint is met. This unions samples;
 * it does not estimate surface area or judge composition. Register each
 * structural relationship (such as a support-to-platform connection) as its
 * own feature group so visible body samples cannot stand in for it.
 */
export function auditObservationSet(T,{views,features,occluders=[],ignore=[],viewport,overlays=[],
  fovDegrees=41,near=.1,far=250,epsilon=1e-5}={}) {
  if(!T?.PerspectiveCamera||!T?.Vector3)throw new TypeError('T must provide PerspectiveCamera and Vector3');
  if(!Array.isArray(views)||!views.length||views.length>64)throw new Error('Supply 1..64 authored views');
  if(!Array.isArray(features)||!features.length||features.length>32)throw new Error('Supply 1..32 semantic features');
  if(!Number.isFinite(fovDegrees)||fovDegrees<=0||fovDegrees>=180||!Number.isFinite(near)||near<=0||!Number.isFinite(far)||far<=near)throw new Error('Invalid perspective projection');
  if(!viewport||!Number.isFinite(viewport.width)||viewport.width<=0||!Number.isFinite(viewport.height)||viewport.height<=0)throw new Error('Positive viewport required');
  if(!Number.isFinite(epsilon)||epsilon<0)throw new Error('epsilon must be finite and nonnegative');

  const viewIds=new Set();
  for(const view of views){
    if(typeof view?.id!=='string'||!view.id||viewIds.has(view.id))throw new Error('Views need unique nonempty IDs');
    for(const key of ['position','target'])if(!Array.isArray(view[key])||view[key].length!==3||!view[key].every(Number.isFinite))throw new Error('View position/target need finite xyz');
    if(new T.Vector3(...view.position).distanceToSquared(new T.Vector3(...view.target))<1e-16)throw new Error('Camera and target must be distinct');
    viewIds.add(view.id);
  }
  const featureIds=new Set();
  const normalizedFeatures=features.map(feature=>{
    if(typeof feature?.id!=='string'||!feature.id||featureIds.has(feature.id)||!Array.isArray(feature.points)||!feature.points.length)throw new Error('Features need unique IDs and actual surface points');
    const minCoverageFraction=feature.minCoverageFraction??1;
    if(!Number.isFinite(minCoverageFraction)||minCoverageFraction<=0||minCoverageFraction>1)throw new Error('minCoverageFraction must be in (0,1]');
    featureIds.add(feature.id);
    return {id:feature.id,points:feature.points,minCoverageFraction,
      minProjectedBoundsPx:normalizeProjectedBounds(feature.minProjectedBoundsPx)};
  });

  const sampleViewCounts=normalizedFeatures.map(feature=>Array(feature.points.length).fill(0));
  const viewResults=[];
  for(const view of views){
    const camera=new T.PerspectiveCamera(fovDegrees,viewport.width/viewport.height,near,far);
    camera.position.fromArray(view.position);camera.lookAt(new T.Vector3(...view.target));camera.updateMatrixWorld();
    const viewFeatures=normalizedFeatures.map((feature,featureIndex)=>{
      const inspection=inspectFeatureVisibility(T,{camera,points:feature.points,occluders,ignore,viewport,overlays,epsilon});
      const bounds=projectedBounds(inspection.samples),minimum=feature.minProjectedBoundsPx;
      const projectedSizeSatisfied=!minimum||(bounds!==null&&bounds.width>=minimum.width&&bounds.height>=minimum.height);
      const visibleSampleIndices=inspection.samples.flatMap((sample,index)=>sample.status==='visible'&&!sample.overlays.length?[index]:[]);
      const creditedSampleIndices=projectedSizeSatisfied
        ?visibleSampleIndices:[];
      for(const index of creditedSampleIndices)sampleViewCounts[featureIndex][index]++;
      return {id:feature.id,visibleFraction:visibleSampleIndices.length/feature.points.length,
        visibleSampleIndices,creditedSampleIndices,overlaySampleCount:inspection.overlaySampleCount,
        projectedBoundsPx:bounds,minProjectedBoundsPx:minimum,projectedSizeSatisfied};
    });
    viewResults.push({id:view.id,features:viewFeatures});
  }
  const featureResults=normalizedFeatures.map((feature,index)=>{
    const perSampleViewCounts=sampleViewCounts[index];
    const coveredSampleIndices=perSampleViewCounts.flatMap((count,sampleIndex)=>count>0?[sampleIndex]:[]);
    const uncoveredSampleIndices=perSampleViewCounts.flatMap((count,sampleIndex)=>count===0?[sampleIndex]:[]);
    const coverageFraction=coveredSampleIndices.length/feature.points.length;
    return {id:feature.id,totalSampleCount:feature.points.length,minCoverageFraction:feature.minCoverageFraction,
      coverageFraction,coveredSampleIndices,uncoveredSampleIndices,perSampleViewCounts,
      satisfied:coverageFraction>=feature.minCoverageFraction};
  });
  return {complete:featureResults.every(feature=>feature.satisfied),features:featureResults,viewResults};
}
