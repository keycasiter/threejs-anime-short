import {createContourProfileSource} from '../geometry/contour-profile.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';
const snapshot=value=>JSON.parse(JSON.stringify(value));
const defaults={spanX:1,spanY:1,sectionWidth:1,sectionHeight:1};
/** Complete technical relationships. Materials are borrowed; only generated
 * geometry/source are owned. Source XY/+Z sits inside an upright asset root.
 * Do not mutate returned mesh geometry while using its surface queries. */
export function createContourRelation(T,{design,id='opening-bearing',mode='profile',parameters={},materials}={}){
 if(!['plain','profile'].includes(mode))throw new RangeError('mode must be plain or profile');
 const input=design?.examples?.find(example=>example.id===id);
 if(!input||!['opening-bearing','support-recess'].includes(id))throw new RangeError('Unknown registered relationship');
 for(const role of ['frame','panelDeck','attachment'])if(!materials?.[role]?.isMaterial)throw new TypeError(`Borrowed material required: ${role}`);
 if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw new TypeError('parameters must be an object');
 for(const key of Reflect.ownKeys(parameters))if(typeof key!=='string'||!Object.hasOwn(defaults,key))throw new RangeError(`Unknown structural parameter: ${String(key)}`);
 const p=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,Object.hasOwn(parameters,key)?parameters[key]:value]));for(const [key,value]of Object.entries(p))if(!Number.isFinite(value)||value<=0||value>3)throw new RangeError(`${key} must be in (0,3]`);
 const config=snapshot(input),contour=config.contour.map(([x,y])=>[x*p.spanX,y*p.spanY]);
 const profile=(mode==='plain'?config.plainControlProfile:config.profile).map(([d,z])=>[d*p.sectionWidth,z*p.sectionHeight]);
 const scope=createResourceScope(),root=new T.Group(),axes=new T.Group(),parts={axes},bindings=[];root.name=id;axes.name='source-XY-Z';root.add(axes);
 if(id==='support-recess')axes.rotation.x=-Math.PI/2;
 let disposed=false,source,attachmentHeight=0,attachmentSpec=null;
 scope.defer(()=>{root.removeFromParent();root.clear();axes.clear();});
 const alive=()=>{if(disposed)throw new Error('Contour relation is disposed');};
 function mesh(name,geometry,role){const m=new T.Mesh(geometry,materials[role]);m.name=name;m.castShadow=true;m.receiveShadow=true;axes.add(m);parts[name]=m;bindings.push({part:m,role,material:materials[role]});return m;}
 function slab(outline,hole,zInterval){
  const shape=new T.Shape(outline.map(xy=>new T.Vector2(...xy)));
  if(hole)shape.holes.push(new T.Path(hole.map(xy=>new T.Vector2(...xy))));
  const [lo,hi]=zInterval;if(!(Number.isFinite(lo)&&Number.isFinite(hi)&&hi>lo))throw new RangeError('Invalid neighbor interval');
  const geometry=scope.own(new T.ExtrudeGeometry(shape,{depth:hi-lo,steps:1,bevelEnabled:false,curveSegments:1}));geometry.translate(0,0,lo);geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
 }
 // The kernel selects the outgoing cell at an exact normalized boundary.
 // Preserve the caller's named cell if conversion rounds an interior value up,
 // including the final cell whose upper boundary wraps 1 back to 0.
 function arcParameter(arcs,index,t){
  if(!Number.isInteger(index)||index<0||index>=arcs.length-1||!Number.isFinite(t)||t<0||t>=1)throw new RangeError('Invalid band/segment coordinates; t and s must be in [0,1)');
  const total=arcs.at(-1),start=arcs[index]/total,end=arcs[index+1]/total;
  const value=(arcs[index]+(arcs[index+1]-arcs[index])*t)/total;
  if(value<end)return Math.max(start,value);
  const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,end);
  bits.setBigUint64(0,bits.getBigUint64(0)-1n);
  return Math.max(start,bits.getFloat64(0));
 }
 function query(spec,space='root'){
  alive();if(!['source','root','world'].includes(space))throw new RangeError('query space must be source, root or world');
  const {contourSegment,t,profileBand,s}=spec??{},meta=source.metadata;
  const result=source.surfaceAt(arcParameter(meta.contourArcLengths,contourSegment,t),arcParameter(meta.profileArcLengths,profileBand,s));
  if(space==='source')return result;
  root.updateWorldMatrix(true,true);const matrix=space==='world'?axes.matrixWorld:axes.matrix;
  return {...result,point:result.point.clone().applyMatrix4(matrix),normal:result.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(matrix)),
   tangent:result.tangent.clone().transformDirection(matrix),frame:new T.Matrix4().multiplyMatrices(matrix,result.frame)};
 }
 // A kernel cell is a convex planar quad represented by these two actual
 // indexed Float32 triangles. A convex base with every corner inside this quad
 // is wholly supported; no ideal offset/profile formula is used here.
 function cellTriangles(band,segment){
  const first=source.metadata.bands[band].triangleStart+segment*2,g=source.geometry;
  return [first,first+1].map(i=>new T.Triangle(...[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(g.attributes.position,g.index.getX(i*3+k)))));
 }
 function checkFiniteBase(q,spec){
  const triangles=cellTriangles(q.profileBand,q.contourSegment),scale=Math.max(1,q.point.length()),epsilon=2e-7*scale;
  for(const x of [-spec.baseDepth/2,spec.baseDepth/2])for(const y of [-spec.baseWidth/2,spec.baseWidth/2]){
   const corner=new T.Vector3(x,y,0).applyMatrix4(q.frame);
   const supported=triangles.some(triangle=>{
    if(Math.abs(triangle.getPlane(new T.Plane()).distanceToPoint(corner))>epsilon)return false;
    const bary=triangle.getBarycoord(corner,new T.Vector3());return bary&&Math.min(bary.x,bary.y,bary.z)>=-1e-7;
   });
   if(!supported)throw new RangeError('Finite attachment footprint exceeds actual contact cell');
  }
 }
 function checkPanelBearing(){
  const box=parts.panel.geometry.boundingBox,epsilon=2e-7;
  for(let segment=0;segment<contour.length;segment++)for(const triangle of cellTriangles(0,segment))for(const v of [triangle.a,triangle.b,triangle.c]){
   if(v.x<box.min.x-epsilon||v.x>box.max.x+epsilon||v.y<box.min.y-epsilon||v.y>box.max.y+epsilon)throw new RangeError('Finite frame bearing exceeds panel support');
  }
 }
 function anchorState(){if(!attachmentSpec)return {};const q=query(attachmentSpec);return {attachment:{id:'opening-contact-fixture',point:q.point.toArray(),normal:q.normal.toArray(),frame:q.frame.toArray(),triangleIndex:q.triangleIndex,profileBand:q.profileBand,contourSegment:q.contourSegment}};}
 try{
  source=scope.own(createContourProfileSource(T,{contour,profile,maxTriangles:design.renderContract.budget.trianglesPerRelationship}));
  mesh('frame',source.geometry,'frame');
  if(id==='opening-bearing'){
   mesh('panel',slab(config.panel.outer.map(([x,y])=>[x*p.spanX,y*p.spanY]),contour,config.panel.zInterval.map(z=>z*p.sectionHeight)),'panelDeck');
   checkPanelBearing();
   attachmentSpec=mode==='plain'?config.controlAttachment:config.attachment;
   const q=query(attachmentSpec,'source');if(q.normal.dot(new T.Vector3(...attachmentSpec.expectNormal))<.999)throw new RangeError('Actual attachment contact normal disagrees with design');
   checkFiniteBase(q,attachmentSpec);
   // Registered footprint; finite raised body height is twice registered width.
   attachmentHeight=attachmentSpec.baseWidth*2;
   const geometry=scope.own(new T.BoxGeometry(attachmentSpec.baseDepth,attachmentSpec.baseWidth,attachmentHeight));
   const attachment=mesh('attachment',geometry,'attachment');attachment.matrixAutoUpdate=false;
   attachment.matrix.copy(q.frame).multiply(new T.Matrix4().makeTranslation(0,0,attachmentHeight/2));
  }else mesh('deck',slab(contour,null,config.deck.zInterval.map(z=>z*p.sectionHeight)),'panelDeck');
  root.updateMatrixWorld(true);
  const triangles=Object.values(parts).filter(x=>x.isMesh).reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
  const draws=Object.values(parts).filter(x=>x.isMesh).length;
  if(triangles>design.renderContract.budget.trianglesPerRelationship||draws>design.renderContract.budget.drawsPerRelationship)throw new RangeError('Relationship budget exceeded');
  const cachedAnchors=anchorState();
  return {root,parts,materialBindings:bindings,ports:{query,surfaceAt(u,v,space='root'){
   alive();const q=source.surfaceAt(u,v);if(space==='source')return q;
   if(!['root','world'].includes(space))throw new RangeError('Invalid query space');root.updateWorldMatrix(true,true);const m=space==='world'?axes.matrixWorld:axes.matrix;
   return {...q,point:q.point.clone().applyMatrix4(m),normal:q.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(m)),tangent:q.tangent.clone().transformDirection(m),frame:new T.Matrix4().multiplyMatrices(m,q.frame)};
  }},
   get anchors(){alive();return anchorState();},
   readState(){return {id,mode,disposed,parameters:{...p},contour:snapshot(contour),profile:snapshot(profile),attachmentHeight,
    anchors:disposed?snapshot(cachedAnchors):anchorState(),triangles,draws,rootUuid:root.uuid,sourceToRoot:axes.matrix.toArray(),
    geometryUuids:Object.fromEntries(Object.entries(parts).filter(([,x])=>x.isMesh).map(([name,x])=>[name,x.geometry.uuid])),
    materialUuids:Object.fromEntries(bindings.map(({part,material})=>[part.name,material.uuid])),metadata:snapshot(source.metadata),
    ownership:'source owns frame geometry; relation owns neighbor/attachment geometry; materials are borrowed'};},
   dispose(){if(disposed)return;disposed=true;scope.dispose();}};
 }catch(error){disposed=true;try{scope.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Relationship construction and cleanup failed');}throw error;}
}
