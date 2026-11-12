/** Convex-domain geometry helpers. Inject the SAME THREE namespace as the caller.
 * Local XY belongs to the owner; Z is its normal axis. No renderer or assets.
 */
const finite = Number.isFinite;
const orient = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function area(ring) {
  // Triangulate relative to a local origin to avoid cancellation after translation.
  let sum=0;
  for(let i=1;i<ring.length-1;i++)sum+=orient(ring[0],ring[i],ring[i+1]);
  return sum/2;
}
function validEpsilon(epsilon) {
  if(!finite(epsilon)||epsilon<=0)throw new Error('epsilon must be a positive finite number');
}
function convex(ring,epsilon,name) {
  if(!Array.isArray(ring)||ring.length<3||ring.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite)))throw new Error(`${name} polygon needs at least three finite [u,v] vertices`);
  const result=ring.map(p=>[...p]);
  for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++) {
    if(Math.hypot(result[i][0]-result[j][0],result[i][1]-result[j][1])<=epsilon)throw new Error(`${name} polygon has duplicate vertices; omit a repeated closing vertex`);
  }
  const a=area(result);
  if(!finite(a)||Math.abs(a)<=epsilon*epsilon)throw new Error(`${name} polygon has zero area or exceeds numeric range`);
  if(a<0)result.reverse();
  // Testing every vertex against every edge also rejects self-crossing stars,
  // which a same-sign consecutive-turn test alone would incorrectly accept.
  for(let i=0;i<result.length;i++) {
    const a=result[i],b=result[(i+1)%result.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    for(const p of result) {
      const d=orient(a,b,p)/len;
      if(!finite(d)||d < -epsilon)throw new Error(`${name} polygon must be convex and cannot self-intersect`);
    }
  }
  return result;
}
function compact(ring,epsilon) {
  const result=[];
  for(const p of ring)if(!result.length||Math.hypot(p[0]-result.at(-1)[0],p[1]-result.at(-1)[1])>epsilon)result.push(p);
  if(result.length>1&&Math.hypot(result[0][0]-result.at(-1)[0],result[0][1]-result.at(-1)[1])<=epsilon)result.pop();
  return result;
}

/** Sutherland–Hodgman intersection of two finite convex 2D polygons.
 * Unclosed arrays of [u,v]; clockwise inputs are accepted. Returns new CCW points.
 * epsilon > 0 is a local length tolerance for duplicate/near-zero features, not
 * an outward expansion. Line/point contacts return []. Concavity/CSG unsupported.
 */
export function clipConvexPolygon(subject,boundary,{epsilon=1e-9}={}) {
  validEpsilon(epsilon);
  let output=convex(subject,epsilon,'Subject');
  const owner=convex(boundary,epsilon,'Boundary');
  for(let i=0;i<owner.length&&output.length;i++) {
    const a=owner[i],b=owner[(i+1)%owner.length];
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/len,ny=(b[0]-a[0])/len;
    const distance=p=>nx*(p[0]-a[0])+ny*(p[1]-a[1]);
    const input=output;output=[];
    let previous=input.at(-1),dPrevious=distance(previous);
    for(const current of input) {
      const dCurrent=distance(current),previousInside=dPrevious>=0,currentInside=dCurrent>=0;
      if(previousInside!==currentInside) {
        const t=dPrevious/(dPrevious-dCurrent);
        const point=[previous[0]+t*(current[0]-previous[0]),previous[1]+t*(current[1]-previous[1])];
        if(!point.every(finite))throw new Error('Polygon intersection exceeds numeric range');
        output.push(point);
      }
      if(currentInside)output.push([...current]);
      previous=current;dPrevious=dCurrent;
    }
    output=compact(output,epsilon);
  }
  if(output.length<3||Math.abs(area(output))<=epsilon*epsilon)return [];
  return area(output)>0?output:output.reverse();
}

function sectionAt(outline,v) {
  const intersections=[];
  for(let i=0;i<outline.length;i++) {
    const a=outline[i],b=outline[(i+1)%outline.length];
    if(v<Math.min(a[1],b[1])||v>Math.max(a[1],b[1]))continue;
    if(a[1]===b[1])intersections.push(a[0],b[0]);
    else if(v===a[1])intersections.push(a[0]);
    else if(v===b[1])intersections.push(b[0]);
    else intersections.push(a[0]+(b[0]-a[0])*(v-a[1])/(b[1]-a[1]));
  }
  return [Math.min(...intersections),Math.max(...intersections)];
}

/** Clip the ENTIRE footprint before building a closed solid, never just centers.
 * Top z=heightAt(v); bottom z=heightAt(v)-thickness. Thickness is vertical along
 * local +Z, NOT a constant normal offset. Profile depends ONLY on local v (Y).
 * segments (integer 1..4096) controls uniform piecewise-linear profile sampling;
 * every outline corner's v is also retained within epsilon (near-equal levels
 * share a section), so variable-width sections preserve the clipped silhouette. Tip sections produce triangles instead of zero faces.
 *
 * Limits: convex domains, one-dimensional height profiles, Float32 geometry.
 * No CSG, adaptive sampling or general curved-surface fitting. Unsampled height
 * extrema are not captured. Transform/place the result in the owner's frame.
 * This topology helper supplies no final visual guarantee; inspect the scene.
 * dispose() releases only this function's geometry and is idempotent.
 */
export function createBoundedProfileGeometry(T,{
  footprint,boundary,heightAt=()=>0,thickness=.05,segments=16,epsilon=1e-9
}={}) {
  if(!T?.BufferGeometry||!T?.Float32BufferAttribute)throw new Error('Inject a THREE namespace with BufferGeometry and Float32BufferAttribute');
  if(!finite(thickness)||thickness<=0)throw new Error('thickness must be positive and finite');
  if(!Number.isInteger(segments)||segments<1||segments>4096)throw new Error('segments must be an integer in 1..4096');
  if(typeof heightAt!=='function')throw new Error('heightAt must be a one-dimensional profile function');
  const outline=clipConvexPolygon(footprint,boundary,{epsilon});
  if(!outline.length)return null;
  const originalLevels=[...new Set(outline.map(p=>p[1]))].sort((a,b)=>a-b);
  const vMin=originalLevels[0],vMax=originalLevels.at(-1);
  const cornerLevels=[],canonicalLevel=new Map();
  // Clipping can calculate the same corner level by different edge equations
  // (e.g. -.875 and -.8749999999999999). Group by geometric tolerance BEFORE
  // Float32 conversion. Keep each corner's u; snap only its v within epsilon,
  // so both sides' turning points share an actual section, not a discarded row.
  // Keep true domain extrema; never collapse the entire v span into one level.
  for(let i=0;i<originalLevels.length;) {
    let end=i+1;
    while(end<originalLevels.length&&originalLevels[end]-originalLevels[i]<=epsilon)end++;
    const group=originalLevels.slice(i,end);
    if(group[0]===vMin&&group.at(-1)===vMax) {
      for(const v of group){cornerLevels.push(v);canonicalLevel.set(v,v);}
    } else {
      const v=group.at(-1)===vMax?vMax:group[0];
      cornerLevels.push(v);for(const original of group)canonicalLevel.set(original,v);
    }
    i=end;
  }
  const sectionOutline=outline.map(([u,v])=>[u,canonicalLevel.get(v)]);
  const levels=[...cornerLevels];
  for(let i=1;i<segments;i++) {
    const v=vMin+(vMax-vMin)*i/segments;
    if(!levels.some(c=>Math.abs(c-v)<=epsilon))levels.push(v);
  }
  levels.sort((a,b)=>a-b);
  const rows=levels.map(v=>{
    const [left,right]=sectionAt(sectionOutline,v),top=heightAt(v),bottom=top-thickness;
    if(!finite(top)||!finite(bottom))throw new Error('heightAt profile must return a finite height at every sample');
    // Convert once per shared row: duplicated face vertices must weld exactly.
    const point=(u,z)=>[u,v,z].map(Math.fround);
    const row={left:point(left,top),right:point(right,top),leftBottom:point(left,bottom),rightBottom:point(right,bottom)};
    if(Object.values(row).some(p=>!p.every(finite)))throw new Error('Profile geometry exceeds Float32 numeric range');
    if(right>left&&row.left[0]===row.right[0])throw new Error('Profile width is below Float32 position precision');
    if(row.left[2]===row.leftBottom[2])throw new Error('thickness is below Float32 position precision at this profile height');
    return row;
  });
  for(let i=1;i<rows.length;i++)if(rows[i].left[1]===rows[i-1].left[1])throw new Error('Profile sample spacing is below Float32 position precision');
  const uMin=Math.min(...outline.map(p=>p[0])),uMax=Math.max(...outline.map(p=>p[0]));
  const positions=[],normals=[],uvs=[];
  const same=(a,b)=>a.every((x,i)=>x===b[i]);
  function triangle(a,b,c,uvA,uvB,uvC) {
    // A zero-width endpoint is legal; skip only faces with repeated vertices.
    if(same(a,b)||same(b,c)||same(c,a))return;
    const ab=b.map((x,i)=>x-a[i]),ac=c.map((x,i)=>x-a[i]);
    const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],len=Math.hypot(...normal);
    if(!finite(len)||len===0)throw new Error('Profile triangle degenerates at Float32 precision');
    positions.push(...a,...b,...c);
    for(let i=0;i<3;i++)normals.push(...normal.map(x=>x/len));
    uvs.push(...uvA,...uvB,...uvC);
  }
  const topUV=p=>[Math.max(0,Math.min(1,(p[0]-uMin)/(uMax-uMin))),Math.max(0,Math.min(1,(p[1]-vMin)/(vMax-vMin)))];
  function face(a,b,c,reverse=false) {
    if(reverse)triangle(a,c,b,topUV(a),topUV(c),topUV(b));
    else triangle(a,b,c,topUV(a),topUV(b),topUV(c));
  }
  function wall(topA,topB,bottomA,bottomB) {
    triangle(topA,bottomA,bottomB,[0,1],[0,0],[1,0]);
    triangle(topA,bottomB,topB,[0,1],[1,0],[1,1]);
  }
  for(let i=0;i<rows.length-1;i++) {
    const a=rows[i],b=rows[i+1];
    face(a.left,a.right,b.right);face(a.left,b.right,b.left);
    face(a.leftBottom,a.rightBottom,b.rightBottom,true);face(a.leftBottom,b.rightBottom,b.leftBottom,true);
    wall(a.right,b.right,a.rightBottom,b.rightBottom);
    wall(b.left,a.left,b.leftBottom,a.leftBottom);
  }
  const first=rows[0],last=rows.at(-1);
  wall(first.left,first.right,first.leftBottom,first.rightBottom);
  wall(last.right,last.left,last.rightBottom,last.leftBottom);
  if(!positions.length)throw new Error('Profile area is below Float32 position precision');
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  let disposed=false;
  return {geometry,outline,dispose(){if(!disposed){disposed=true;geometry.dispose();}}};
}
