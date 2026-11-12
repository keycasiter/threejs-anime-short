/** Conservative perspective sphere-size estimate for selecting authored detail.
 * viewDepth is positive camera-space depth, not Euclidean distance. This is not
 * an occlusion/visibility measurement or a general projected-error proof.
 * Pass previousLevel per stable object identity; there is no hidden global cache.
 */
export function selectProjectedDetail({diameter,viewDepth,viewportHeight,fovDegrees,
  thresholds=[160,55],hysteresis=.12,previousLevel=null}={}) {
  for(const [name,value] of Object.entries({diameter,viewportHeight}))if(!Number.isFinite(value)||value<=0)throw new RangeError(`${name} must be positive`);
  if(!Number.isFinite(viewDepth))throw new RangeError('viewDepth must be finite');
  if(!Number.isFinite(fovDegrees)||fovDegrees<=0||fovDegrees>=180)throw new RangeError('fovDegrees must be in 0..180');
  if(!Array.isArray(thresholds)||!thresholds.length||thresholds.some((v,i)=>!Number.isFinite(v)||v<=0||(i&&v>=thresholds[i-1])))throw new RangeError('thresholds must be positive and strictly descending');
  if(!Number.isFinite(hysteresis)||hysteresis<0||hysteresis>=1)throw new RangeError('hysteresis must be in [0,1)');
  if(previousLevel!==null&&(!Number.isInteger(previousLevel)||previousLevel<0||previousLevel>thresholds.length))throw new RangeError('Invalid previousLevel');
  const front=viewDepth-diameter/2;
  const pixels=front<=0?Infinity:diameter*viewportHeight/(2*front*Math.tan(fovDegrees*Math.PI/360));
  let level=previousLevel??thresholds.length;
  if(previousLevel===null){for(let i=0;i<thresholds.length;i++)if(pixels>=thresholds[i]){level=i;break;}}
  else{
    while(level>0&&pixels>=thresholds[level-1]*(1+hysteresis))level--;
    while(level<thresholds.length&&pixels<thresholds[level]*(1-hysteresis))level++;
  }
  return {level,pixels};
}
