import { createPerforatedPlate } from '../geometry/profile-surfaces.mjs';
import {createContourProfileSource} from '../geometry/contour-profile.mjs';
import {writeFormationCoordinates} from '../geometry/formation-coordinates.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';

/** Original, renderer-independent architectural midstructure. Inject THREE r180.
 * Metres; local +Y is up, floor y=0, x=0 is the centerline; facade faces +Z.
 * Wall spans z=-depth/2..depth/2. Opening is centered in x, with its bottom at
 * sillHeight and top at sillHeight+openingHeight. No backing plane is generated.
 * 'arch' is a faceted semicircular head, radius openingWidth/2, above straight
 * jambs. Its spring line is openingTop-radius. No elliptical/Gothic profiles.
 *
 * Supported: width 1..12m, height 1..8m, depth .08..1m; openingWidth>=.3m,
 * openingHeight>=.5m; frameWidth .04.. .3m, frameDepth .02.. .2m. Remaining
 * masonry must clear the frame by .08m laterally and .18m at the head; sill
 * must clear the .18m plinth and .06m sill base. Arch jambs must be >=.2m.
 * archSegments is an even integer 8..64. The centered opening cannot be moved.
 *
 * materials.wall/trim are required borrowed THREE.Materials; interior defaults
 * to wall and covers all wall edge/reveal surfaces. Optional glass adds a real
 * .01m solid pane at z=±.005m. Transparency is the caller's material decision.
 * All generated geometry is owned; materials/textures are never disposed or
 * mutated. dispose() is idempotent, removes root from its parent and clears it.
 *
 * anchors is Map<string,Matrix4> in ROOT LOCAL coordinates, with local +Z as
 * outward normal on bay/reveal interfaces. opening.* anchors face +Z at z=0;
 * opening.left/right are halfway up the straight jamb (below an arch spring).
 * World interface = root.matrixWorld * anchors.get(name), after matrix update.
 * Nonuniform root scale stretches physical UV density: keep unit scale for metres.
 * On the legacy hole-plate / finish path only, front/back UVs share XY coordinates;
 * each planar side facet has an orthonormal physical projection and checked tangent
 * attribute (intentional arch-facet UV seams, no UV normalization or mirroring).
 * Explicit frameProfile instead retains its contour source: ring/profile arc UVs
 * may shear at miters and imply neither a metric chart nor a tangent attribute.
 * Current profile consumers borrow scalar maps:false materials with source-space
 * formation response. surfaceAt's geometric tangent is not a render tangent attribute.
 * profileSources and their geometry are borrowed until bay.dispose(); subsequent
 * source queries reject. The bay owns profile geometry; materials remain borrowed.
 */
export function buildArchitecturalBay(THREE, {
  width = 3, height = 3.3, depth = .24,
  openingWidth = 1.4, openingHeight = 1.9, sillHeight = .7,
  variant = 'rect', frameWidth = .1, frameDepth = .06, archSegments = 24,
  materials, frameProfile
} = {}) {
  const range = (name, n, lo, hi) => {
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`Bay ${name} must be finite in ${lo}..${hi} metres`);
  };
  range('width', width, 1, 12); range('height', height, 1, 8);
  range('depth', depth, .08, 1); range('openingWidth', openingWidth, .3, width);
  range('openingHeight', openingHeight, .5, height);
  range('sillHeight', sillHeight, 0, height);
  range('frameWidth', frameWidth, .04, .3); range('frameDepth', frameDepth, .02, .2);
  if (!['rect', 'arch'].includes(variant)) throw new Error('Bay variant must be rect or arch');
  if (!Number.isInteger(archSegments) || archSegments < 8 || archSegments > 64 || archSegments % 2) {
    throw new Error('Bay archSegments must be an even integer 8..64');
  }
  const radius = openingWidth / 2, top = sillHeight + openingHeight;
  const springY = variant === 'arch' ? top - radius : top;
  if ((width - openingWidth) / 2 < frameWidth + .08 || height - top < frameWidth + .18 ||
      sillHeight < frameWidth + .26 || (variant === 'arch' && openingHeight - radius < .2)) {
    throw new Error('Bay opening/frame clearance is insufficient for masonry, sill, header or arch jambs');
  }
  for (const key of ['wall', 'trim', 'interior', 'glass', 'frame']) {
    const m = materials?.[key];
    if ((key === 'wall' || key === 'trim' || m !== undefined) && !m?.isMaterial) {
      throw new Error(`Bay materials.${key} must be a borrowed THREE.Material`);
    }
  }

  // Both the bore and surrounding moulding derive from this one profile.
  // An outer arch adds frameWidth to its radius without moving the spring line.
  function contour(expand = 0) {
    const r = radius + expand, bottom = sillHeight - expand;
    if (variant === 'rect') return [[-r,bottom],[r,bottom],[r,top+expand],[-r,top+expand]];
    const ring = [[-r,bottom],[r,bottom],[r,springY]];
    for (let i = 1; i <= archSegments; i++) {
      const a = i * Math.PI / archSegments;
      ring.push([i === archSegments ? -r : r * Math.cos(a), springY + r * Math.sin(a)]);
    }
    return ring;
  }
  const bore = contour(), frameOutline = contour(frameWidth);
  const outline = [[-width/2,0],[width/2,0],[width/2,height],[-width/2,height]];
  const root = new THREE.Group(); root.name = 'architectural-bay';
  const parts = {}, anchors = new Map(), owned = new Set(), profileSources=[],scope=createResourceScope();
  scope.defer(()=>{const errors=[];for(const g of owned)try{g.dispose();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Bay geometry cleanup failed');});
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try{scope.dispose();}finally{owned.clear();root.removeFromParent();root.clear();}
  };

  // Faceted hard normals deliberately remain flat. Independent triangles let
  // each face carry the correct physical projection without smoothing UV seams.
  function finish(geometry) {
    owned.add(geometry);
    let g = geometry;
    if (g.index) {
      g = geometry.toNonIndexed();
      owned.delete(geometry); geometry.dispose(); owned.add(g);
    }
    const p = g.attributes.position, n = g.attributes.normal;
    const uv = new Float32Array(p.count * 2), order = [];
    for (let i = 0; i < p.count; i++) {
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      if (Math.abs(nz) > .99) {
        uv[2*i] = p.getX(i); uv[2*i+1] = p.getY(i);
      } else {
        const length = Math.hypot(nx, ny);
        uv[2*i] = (p.getX(i)*ny - p.getY(i)*nx) / length;
        uv[2*i+1] = p.getZ(i);
      }
      order.push(i);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(order); g.computeTangents();
    const tangent = g.attributes.tangent;
    for (let i = 0; i < p.count; i++) {
      const x = tangent.getX(i), y = tangent.getY(i), z = tangent.getZ(i), w = tangent.getW(i);
      if (![x,y,z,w].every(Number.isFinite) || Math.abs(Math.hypot(x,y,z)-1) > 1e-5 ||
          Math.abs(x*n.getX(i)+y*n.getY(i)+z*n.getZ(i)) > 1e-5 || Math.abs(w) !== 1) {
        throw new Error('Bay surface has an invalid physical UV tangent frame');
      }
    }
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  function add(name, geometry, material, z = 0) {
    const mesh = new THREE.Mesh(finish(geometry), material);
    mesh.name = `bay.${name}`; mesh.position.z = z;
    mesh.castShadow = true; mesh.receiveShadow = true;
    parts[name] = mesh; root.add(mesh);
    return mesh;
  }
  function plate(outside, inside, thickness) {
    return createPerforatedPlate(THREE, {
      outline: outside, holes: inside, depth: thickness,
      bevel: {enabled:false}, materialIndices: {faces:0,edges:1}
    });
  }
  function box(name, w, h, d, y, z) {
    const mesh = add(name, new THREE.BoxGeometry(w,h,d), materials.trim, z);
    mesh.position.y = y;
  }
  function anchor(name, x, y, z, rx = 0, ry = 0) {
    anchors.set(name, new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,0)), new THREE.Vector3(1,1,1)));
  }
  try {
    add('wall', plate(outline,[bore],depth), [materials.wall,materials.interior ?? materials.wall], -depth/2);
    // Five-millimetre overlap hides tolerance cracks at the masonry/frame joint.
    if(frameProfile===undefined){
      add('frame', plate(frameOutline,[bore],frameDepth+.005), [materials.trim,materials.trim], depth/2-.005);
    }else{
      // Physical dimensions and sill bearing remain those of this bay, while the
      // section may articulate its interior. Do not silently clip an oversized design.
      if(!Array.isArray(frameProfile)||Array.from(frameProfile).some(p=>!Array.isArray(p)||p.length!==2||!Array.from(p).every(Number.isFinite)||p[0]<0||p[0]>frameWidth||p[1]<0||p[1]>frameDepth))throw new RangeError('Bay frameProfile exceeds frame width/depth');
      const hasBand=predicate=>frameProfile.some((p,i)=>predicate(p,frameProfile[(i+1)%frameProfile.length]));
      const rearBearing=hasBand((a,b)=>a[1]===0&&b[1]===0&&Math.abs(a[0]-b[0])>1e-9);
      const sillBearing=hasBand((a,b)=>a[0]===frameWidth&&b[0]===frameWidth&&Math.abs(a[1]-b[1])>1e-9);
      if(!rearBearing||!sillBearing)throw new RangeError('Bay frameProfile requires finite wall and sill contact bearing bands');
      const source=scope.own(createContourProfileSource(THREE,{contour:bore,profile:frameProfile}));
      writeFormationCoordinates(THREE,source.geometry);
      const part=new THREE.Mesh(source.geometry,materials.frame??materials.trim);part.name='bay.frame';part.position.z=depth/2;part.castShadow=part.receiveShadow=true;parts.frame=part;root.add(part);
      profileSources.push({source,part,surfaceAt(u,v,space='root'){
        const sample=source.surfaceAt(u,v);if(space==='source'||space==='part')return sample;
        if(!['root','world'].includes(space))throw new RangeError('Unknown bay surface space');
        part.updateWorldMatrix(true,false);const matrix=space==='world'?part.matrixWorld:part.matrix;
        return {...sample,point:sample.point.clone().applyMatrix4(matrix),normal:sample.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix)),tangent:sample.tangent.clone().transformDirection(matrix),frame:new THREE.Matrix4().multiplyMatrices(matrix,sample.frame)};
      }});
    }
    box('sill', openingWidth+2*frameWidth+.12, .06, depth+frameDepth+.12,
      sillHeight-frameWidth-.03, (frameDepth+.12)/2);
    box('header', width, .12, .05, height-.06, depth/2+.025);
    box('plinth', width, .18, .04, .09, depth/2+.02);
    if (materials.glass) add('glass', plate(bore,[],.01), [materials.glass,materials.glass], -.005);

    const centerY = sillHeight + openingHeight/2;
    const jambY = (sillHeight + springY)/2;
    for (const [name,x,y] of [['center',0,centerY],['bottom',0,sillHeight],['top',0,top],
      ['left',-radius,jambY],['right',radius,jambY]]) anchor(`opening.${name}`,x,y,0);
    anchor('bay.left',-width/2,height/2,0,0,-Math.PI/2);
    anchor('bay.right',width/2,height/2,0,0,Math.PI/2);
    anchor('bay.bottom',0,0,0,Math.PI/2);
    anchor('bay.top',0,height,0,-Math.PI/2);
    anchor('reveal.front',0,centerY,depth/2);
    anchor('reveal.back',0,centerY,-depth/2,0,Math.PI);
    root.updateMatrixWorld(true);
    const spec = Object.freeze({width,height,depth,openingWidth,openingHeight,sillHeight,variant,
      frameWidth,frameDepth,archSegments,
      opening:Object.freeze({bottom:sillHeight,top,springY,contour:Object.freeze(bore.map(p=>Object.freeze([...p])))})});
    return {root,anchors,parts,spec,...(frameProfile===undefined?{}:{profileSources}),dispose};
  } catch (error) {try{dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Bay construction/cleanup failed');}throw error;}
}
