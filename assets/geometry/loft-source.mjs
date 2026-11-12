import {createSectionLoftGeometry} from './section-loft.mjs';

/**
 * Side-surface attachment source in geometry-local coordinates. Inject the same THREE
 * runtime used by the caller. Geometry/UV generation is delegated to section-loft.
 *
 * u in [0,1]: normalized distance along the authored station-center polyline.
 * v in [0,1]: normalized radial vertex parameter, NOT ellipse perimeter distance.
 * v=1 wraps to v=0; at internal u joints the outgoing segment wins.
 * The square cell uses precisely the loft's (a,b,d), (a,d,c) diagonal.
 * normal is the selected triangle's winding normal, not its smooth shading normal.
 * frame +Z follows normal; +Y projects the segment axis into its triangle plane.
 * triangleIndex is the zero-based triangle ordinal in geometry.index (not an offset).
 *
 * Only the emitted side triangles are sampled, including side edges at u=0/1.
 * Caps, branch fusion, self-intersection detection and world transforms are excluded.
 * Sharp bends/large radii can fold or intersect: inspect/revise stations before use;
 * an intersecting mesh has no globally meaningful "outside" despite local winding.
 * Preserve the returned geometry's topology/positions until dispose. After assembly
 * transforms, transform points and use a normal matrix for normals in caller code.
 * dispose() releases this generated geometry once; materials remain caller-owned.
 */
export function createSectionLoftSource(T, options = {}) {
  const geometry = createSectionLoftGeometry(T, options);
  const {stations, radialSegments = 24} = options;
  // Snapshot station data: edits to caller options cannot move attachment coordinates.
  const centers = stations.map(s => new T.Vector3(...s.center));
  const arcs = [0];
  for (let i=1; i<centers.length; i++) arcs.push(arcs[i-1]+centers[i].distanceTo(centers[i-1]));
  const total = arcs.at(-1);
  let disposed = false;

  function surfaceAt(u, v) {
    if (disposed) throw new Error('Loft source is disposed');
    for (const [name,value] of [['u',u],['v',v]]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be finite in [0,1]`);
    }
    const distance = u*total;
    // Upper-bound search keeps exact station joints on their outgoing segment.
    let low=0, high=arcs.length-1;
    while (low+1<high) {
      const middle=(low+high)>>>1;
      if (arcs[middle]<=distance) low=middle; else high=middle;
    }
    const segmentIndex=low;
    const s=(distance-arcs[low])/(arcs[low+1]-arcs[low]);
    const around=(v===1 ? 0 : v)*radialSegments;
    const cell=Math.min(Math.floor(around),radialSegments-1), t=around-cell;
    const first=t<=s;
    const triangleIndex=(segmentIndex*radialSegments+cell)*2+(first?0:1);
    const vertices=[0,1,2].map(k => new T.Vector3().fromBufferAttribute(
      geometry.attributes.position, geometry.index.getX(triangleIndex*3+k)));
    const [a,b,c]=vertices;
    const ab=b.clone().sub(a), ac=c.clone().sub(a), normal=ab.clone().cross(ac);
    const areaSq=normal.lengthSq(), scale=ab.lengthSq()*ac.lengthSq();
    if (!(Number.isFinite(areaSq) && Number.isFinite(scale)) || scale===0 || areaSq<=scale*1e-24) {
      throw new RangeError(`Degenerate or Float32-collapsed side triangle ${triangleIndex}; revise station spacing, size or coordinates`);
    }
    normal.normalize();
    // Barycentric weights on the emitted diagonal, never bilinear/smooth evaluation.
    const point=first
      ? a.clone().multiplyScalar(1-s).addScaledVector(b,s-t).addScaledVector(c,t)
      : a.clone().multiplyScalar(1-t).addScaledVector(b,s).addScaledVector(c,t-s);
    const axis=centers[low+1].clone().sub(centers[low]).normalize();
    const tangent=axis.clone().addScaledVector(normal,-axis.dot(normal));
    if (tangent.lengthSq()<1e-20) {
      // At a folded face perpendicular to the axis, use its +u generatrix edge.
      const row=radialSegments+1, bottom=low*row+cell+(first?0:1);
      tangent.fromBufferAttribute(geometry.attributes.position,bottom+row)
        .sub(new T.Vector3().fromBufferAttribute(geometry.attributes.position,bottom));
      tangent.addScaledVector(normal,-tangent.dot(normal));
      if (tangent.lengthSq()<1e-24) throw new RangeError(`Degenerate side tangent at triangle ${triangleIndex}`);
    }
    tangent.normalize();
    const x=tangent.clone().cross(normal).normalize();
    // Re-orthogonalize after Float32 mesh evaluation; maintain a right-handed frame.
    tangent.copy(normal).cross(x).normalize();
    const frame=new T.Matrix4().makeBasis(x,tangent,normal).setPosition(point);
    return {point,normal,tangent,frame,segmentIndex,triangleIndex};
  }

  return {
    geometry, surfaceAt,
    dispose() { if (!disposed) { disposed=true; geometry.dispose(); } },
  };
}
