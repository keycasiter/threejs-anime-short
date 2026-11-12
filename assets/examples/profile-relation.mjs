import {createRevolvedShell} from '../geometry/profile-surfaces.mjs';
import {createSectionLoftSource} from '../geometry/loft-source.mjs';
import {createSurfaceSampler} from '../scene/surface-anchors.mjs';
import {placeAtAnchor} from '../scene/anchor-connection.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';

/** Representation/relay example, not a new universal shape generator.
 * Metres, Y-up, unit scale. Geometry/queries/ports are asset-local until placement.
 * Revolved shell requires symmetry and includes a bore; loft permits independent
 * width/depth and a bent spine but is capped/solid. They are different capabilities.
 * Materials are borrowed. Only emitted geometry is owned here; no prebuilt assets.
 */
export function buildProfileRelation(T, {spec, materials} = {}) {
  if (!spec || typeof spec.id !== 'string' || !spec.id.trim()) throw new TypeError('A stable design id is required');
  const {id, representation, height, width, depth, bend = 0, wallThickness = .12} = spec;
  if (!['revolved-shell', 'section-loft'].includes(representation)) throw new Error('Unsupported representation; select an implemented generator');
  // Example-specific input limits, not a general self-intersection/quality proof.
  for (const [name, value, min, max] of [['height',height,1,8],['width',width,.5,4],['depth',depth,.5,4],['bend',bend,0,1]]) {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} outside this example's input domain`);
  }
  if (representation === 'revolved-shell') {
    if (Math.abs(width-depth) > 1e-9 || bend !== 0) throw new Error('Revolved shell requires equal width/depth and zero bend');
    if (!Number.isFinite(wallThickness) || wallThickness <= 0 || wallThickness >= width*.2) throw new RangeError('wallThickness must leave a positive bore');
  }
  for (const role of ['body','metal','support']) if (!materials?.[role]?.isMaterial) throw new TypeError(`materials.${role} is required`);
  const snapshot = Object.freeze({id,representation,height,width,depth,bend,
    ...(representation === 'revolved-shell' ? {wallThickness} : {})});
  const scope = createResourceScope(), root = new T.Group(); root.name = id;
  scope.defer(() => root.removeFromParent());
  try {
    const ratios = [0,.25,.55,.85,1], radii = [.68,1,.94,.58,.62];
    // A level bearing interface requires the first segment to be vertical;
    // placing only the spine center on the base does not constrain the whole end ring.
    const spineX = t => bend * Math.max(0,(t-.25)/.75)**2;
    let geometry, source;
    if (representation === 'revolved-shell') {
      const outer = ratios.map((t,i) => ({r:width*.5*radii[i],y:.18+height*t}));
      const inner = outer.map(p => ({r:p.r-wallThickness,y:p.y}));
      geometry = scope.own(createRevolvedShell(T,{outer,inner,radialSegments:64}));
    } else {
      const stations = ratios.map((t,i) => ({center:[spineX(t),.18+height*t,0],width:width*radii[i],depth:depth*radii[i]}));
      source = scope.own(createSectionLoftSource(T,{stations,radialSegments:64,reference:[1,0,0],uvMeters:1}));
      geometry = source.geometry; // Source owns geometry; do not also scope.own(geometry).
    }
    geometry.computeBoundingBox();
    const body = new T.Mesh(geometry,materials.body); body.name = `${id}/body`;body.castShadow=body.receiveShadow=true;root.add(body);
    function mesh(g, material, parent = root) {
      scope.own(g);const object = new T.Mesh(g,material);object.castShadow=object.receiveShadow=true;parent.add(object);return object;
    }
    const pedestal=mesh(new T.BoxGeometry(width*1.35,.18,depth*1.35),materials.support);pedestal.position.y=.09;
    const sample = createSurfaceSampler(T,body);
    // Probe the actual emitted triangles, not a second ideal profile formula.
    const origin = new T.Vector3(spineX(.55),.18+height*.55,geometry.boundingBox.max.z+1);
    const contact = sample(origin,new T.Vector3(0,0,-1));
    if (!contact) throw new Error('Selected representation did not provide the required attachment surface');
    const z=contact.normal.clone().normalize(), y=new T.Vector3(0,1,0).addScaledVector(z,-z.y).normalize();
    const x=new T.Vector3().crossVectors(y,z).normalize();
    const port=new T.Matrix4().makeBasis(x,y,z).setPosition(contact.point),anchors=new Map([['service',port]]);
    const fixture=new T.Group();fixture.name=`${id}/fixture`;
    const sleeve=mesh(new T.CylinderGeometry(.15,.15,.22,24),materials.metal,fixture);sleeve.rotation.x=Math.PI/2;sleeve.position.z=.11;
    const rim=mesh(new T.TorusGeometry(.22,.04,8,40),materials.metal,fixture);rim.position.z=.23;
    for(let i=0;i<4;i++) {
      const angle=i*Math.PI/2,bolt=mesh(new T.CylinderGeometry(.025,.025,.035,6),materials.metal,fixture);
      bolt.rotation.x=Math.PI/2;bolt.position.set(Math.cos(angle)*.19,Math.sin(angle)*.19,.255);
    }
    placeAtAnchor(T,{host:{root,anchors},hostAnchor:'service',guest:{root:fixture,anchors:new Map([['base',new T.Matrix4()]])},guestAnchor:'base',parent:root,opposed:false});
    return {root,spec:snapshot,anchors,source,parts:{body,pedestal,fixture},
      sampleSurface(origin,direction,options) {
        if(scope.inspect().state!=='open') throw new Error('Profile relation is disposed');
        return sample(origin,direction,options);
      },
      dispose:scope.dispose};
  } catch(error) {
    try {scope.dispose();} catch(cleanupError) {throw new AggregateError([error,cleanupError],'Profile construction and cleanup failed');}
    throw error;
  }
}
