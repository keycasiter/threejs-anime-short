import { createPerforatedPlate } from '../geometry/profile-surfaces.mjs';

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
 * Front/back UVs share XY coordinates; each planar side facet uses an orthonormal
 * physical projection (UV seams between arch facets are intentional). Tangents
 * are computed and checked; no UV-size normalization or negative-scale mirroring.
 */
export function buildArchitecturalBay(THREE, {
  width = 3, height = 3.3, depth = .24,
  openingWidth = 1.4, openingHeight = 1.9, sillHeight = .7,
  variant = 'rect', frameWidth = .1, frameDepth = .06, archSegments = 24,
  materials
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
  for (const key of ['wall', 'trim', 'interior', 'glass']) {
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
  const parts = {}, anchors = new Map(), owned = new Set();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const g of owned) g.dispose();
    owned.clear(); root.removeFromParent(); root.clear();
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
    add('frame', plate(frameOutline,[bore],frameDepth+.005), [materials.trim,materials.trim], depth/2-.005);
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
    return {root,anchors,parts,spec,dispose};
  } catch (error) {dispose();throw error;}
}
