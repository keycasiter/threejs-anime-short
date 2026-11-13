import design from './activity-design.json' with {type:'json'};
import {createResourceScope} from '../runtime/resource-scope.mjs';
import {FORMATION_ATTRIBUTE,writeFormationCoordinates} from '../geometry/formation-coordinates.mjs';
import {copyFormationGroup} from '../scene/formation-group.mjs';

const requireValue=(ok,message)=>{if(!ok)throw new Error('Activity geometry: '+message);};
export const activityRectangle=([x,z,X,Z])=>[[x,z],[X,z],[X,Z],[x,Z]];
export const triangleNormalY=p=>(p[1][2]-p[0][2])*(p[2][0]-p[0][0])-(p[1][0]-p[0][0])*(p[2][2]-p[0][2]);
const bounds=triangles=>{const p=triangles.flatMap(t=>t.p);return [0,1,2].map(k=>Math.min(...p.map(v=>v[k]))).concat([0,1,2].map(k=>Math.max(...p.map(v=>v[k]))));};
const allFinite=p=>p.every(Number.isFinite);
const copyEdge=x=>x.map(p=>({...p}));
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);

// Manual matrices are authoritative in Three. This consumer rejects that mode
// before any update can overwrite them; automatic TRS is inspected on a copy.
function automaticLocal(object){
 requireValue(object.matrixAutoUpdate&&object.matrixWorldAutoUpdate,'unsupported manual transform frame');
 return object.matrix.clone().compose(object.position,object.quaternion,object.scale);
}
function automaticHierarchy(root){
 root.traverse(o=>automaticLocal(o));for(let p=root.parent;p;p=p.parent)automaticLocal(p);
}
function rigidMatrix(matrix){
 const e=matrix.elements;requireValue(e.every(Number.isFinite)&&e[3]===0&&e[7]===0&&e[11]===0&&e[15]===1,'finite affine rigid matrix required');
 const axes=[[e[0],e[1],e[2]],[e[4],e[5],e[6]],[e[8],e[9],e[10]]],dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
 requireValue(axes.every(a=>Math.abs(dot(a,a)-1)<1e-10)&&Math.abs(dot(axes[0],axes[1]))<1e-10&&Math.abs(dot(axes[0],axes[2]))<1e-10&&Math.abs(dot(axes[1],axes[2]))<1e-10&&Math.abs(matrix.determinant()-1)<1e-10,'rigid orthonormal unit basis required');
}
/** The current final product uses ordinary full scalar draws on unit carriers.
 * Validate every site/member carrier before facts are read, not just its buffer. */
export function validateActivityFinalDraw(T,object,{translated=false}={}){
 requireValue(object?.isMesh&&!object.isInstancedMesh&&!object.isSkinnedMesh,'final draw mesh identity');
 const g=object.geometry,p=g?.getAttribute('position'),material=object.material;
 requireValue(g?.isBufferGeometry&&!g.isInstancedBufferGeometry&&!g.index&&!Object.keys(g.morphAttributes).length&&p?.array instanceof Float32Array&&p.itemSize===3&&!p.normalized&&(p.gpuType===undefined||p.gpuType===T.FloatType)&&p.count>0&&p.count%3===0&&g.drawRange.start===0&&(g.drawRange.count===Infinity||g.drawRange.count===p.count)&&g.groups.length===0,'final full draw identity');
 requireValue(!Array.isArray(material)&&material?.isMaterial&&material.visible&&!material.displacementMap&&object.layers.mask===1,'final visible scalar draw identity');
 const local=automaticLocal(object),e=local.elements;
 requireValue(e.every((v,i)=>translated&&[12,13,14].includes(i)?Number.isFinite(v):v===(i%5===0?1:0)),'final carrier unit transform');
 for(let p=object;p;p=p.parent){requireValue(p.visible,'final ancestor visibility');if(p!==object)requireValue(identityMatrix(automaticLocal(p)),'final parent unit frame');}
 return true;
}

/** r187 TriangleList semantics: scalar materials ignore geometry.groups; arrays
 * intersect each visible group with drawRange. References stay build-local. */
export function scanActivityDraws(T,root,{prefix='draw',space='world',budget}={}){
 requireValue(root?.isObject3D,'root required');automaticHierarchy(root);root.updateWorldMatrix(true,true);
 const inverse=space==='local'?root.matrixWorld.clone().invert():new T.Matrix4(),rows=[];
 root.traverseVisible(object=>{
  if(!object.isMesh){requireValue(!object.isLine&&!object.isPoints,'unsupported non-mesh draw');return;}
  const g=object.geometry,p=g?.getAttribute('position'),idx=g?.index;
  requireValue(!object.isInstancedMesh&&!object.isSkinnedMesh&&!g?.isInstancedBufferGeometry&&!Object.keys(g?.morphAttributes??{}).length,'static rigid meshes required');
  requireValue(p?.itemSize===3&&!p.normalized&&p.array instanceof Float32Array,'Float32 position required');
  const count=idx?.count??p.count,dr=g.drawRange;
  requireValue(count%3===0,'triangle element count');
  const slots=Array.isArray(object.material)?object.material:[object.material];
  requireValue(slots.every(m=>m?.isMaterial&&!m.displacementMap),'actual static materials required');
  const spans=Array.isArray(object.material)?g.groups.map((r,i)=>({...r,group:i})).filter(r=>slots[r.materialIndex]?.visible):slots[0].visible?[{start:0,count,materialIndex:0,group:null}]:[];
  const matrix=new T.Matrix4().multiplyMatrices(inverse,object.matrixWorld),seen=new Set(),triangles=[];
  rigidMatrix(automaticLocal(object));rigidMatrix(object.matrixWorld);rigidMatrix(matrix);
  for(const span of spans){
   const lo=Math.max(0,dr.start,span.start),hi=Math.min(count,dr.start+dr.count,span.start+span.count);
   if(hi<=lo)continue;requireValue(lo%3===0&&(hi-lo)%3===0,'partial triangle draw range');budget?.take((hi-lo)*3+1);
   for(let e=lo;e<hi;e+=3){requireValue(!seen.has(e),'overlapping triangle groups');seen.add(e);
    const vertexIds=[0,1,2].map(j=>idx?idx.getX(e+j):e+j);requireValue(vertexIds.every(i=>Number.isInteger(i)&&i>=0&&i<p.count),'triangle index');
    const points=vertexIds.map(i=>new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix).toArray());requireValue(points.every(allFinite),'finite drawn vertices');
    triangles.push({e,group:span.group,slot:span.materialIndex,vertexIds,p:points});
   }
  }
  requireValue(triangles.length,'visible mesh has no actual triangles');
  rows.push({id:`${prefix}/${rows.length}`,object,geometry:g,matrix,triangles,box:bounds(triangles)});
 });return rows;
}

function loftGeometry(T,rings){
 const p=[],n=rings[0].length;requireValue(n>=3&&rings.every(r=>r.length===n),'loft rings');
 const triangle=(a,b,c)=>p.push(...a,...b,...c);
 for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++){const k=(i+1)%n;triangle(rings[j][i],rings[j+1][i],rings[j+1][k]);triangle(rings[j][i],rings[j+1][k],rings[j][k]);}
 for(let i=1;i<n-1;i++){triangle(rings[0][0],rings[0][i],rings[0][i+1]);triangle(rings.at(-1)[0],rings.at(-1)[i+1],rings.at(-1)[i]);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
}
// Each leaf is a closed construction unit. A single conservative box encloses
// that entire solid; no union-of-vertex boxes or face-shell collision proxy.
export function buildActivityPrototype(T,{id,materialFor,pressFrontOffset=0,pressFootOffset=0}={}){
 requireValue(Object.hasOwn(design.prototypes,id),'unknown prototype');requireValue(typeof materialFor==='function','material provider required');
 requireValue([pressFrontOffset,pressFootOffset].every(Number.isFinite),'finite design patch');
 const scope=createResourceScope(),root=new T.Group(),units=[],bearingBindings=[],materialBindings=[];root.name=id;let disposed=false,portBinding;
 const colors={stone:0xc3beb0,coating:0xd9dfd2,wood:0xa68152,metal:0x596d68};
 function mesh(name,g,role,position=[0,0,0],rotation=[0,0,0],bearing=false){
  scope.own(g);writeFormationCoordinates(T,g);const slot={role,options:{maps:false,baseColor:colors[role],color:0xffffff}},material=materialFor(role,slot.options);
  requireValue(material?.isMaterial,'borrowed material required');const object=new T.Mesh(g,material);object.name=`${id}.${name}`;object.position.set(...position);object.rotation.set(...rotation);object.castShadow=object.receiveShadow=true;root.add(object);
  const unit={id:name,object,closed:true,drawElements:g.index?.count??g.attributes.position.count};units.push(unit);materialBindings.push({object,slots:[slot]});if(bearing)bearingBindings.push({object});return object;
 }
 const box=(name,size,pos,role='wood',rotation,bearing=false)=>mesh(name,new T.BoxGeometry(...size),role,pos,rotation,bearing);
 function beam(name,a,b,r=.035,role='metal'){
  const A=new T.Vector3(...a),B=new T.Vector3(...b),o=mesh(name,new T.CylinderGeometry(r,r,A.distanceTo(B),10),role,A.clone().add(B).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),B.sub(A).normalize());return o;
 }
 function service(object){const anchor=[...design.prototypes[id].port];if(id==='coveredPress')anchor[2]+=pressFrontOffset;portBinding={object,plane:'front',surface:'top',width:design.prototypes[id].aperture,anchor};}
 try{
  if(id==='feedCradle'){
   const trestleObjects=[];
   for(const x of [-1.5,1.5]){
    box(`sole/${x}`,[.48,.10,1.28],[x,.05,0],'metal',undefined,true);
    // Open triangular trestle in YZ, extruded .20 along X.
    const yz=[[-.59,.10],[.59,.10],[.43,1.10],[-.39,.73]],rings=[x-.10,x+.10].map(X=>yz.map(([z,y])=>[X,y,z]));
    trestleObjects.push(mesh(`trestle/${x}`,loftGeometry(T,rings),'wood'));
   }
   service(box('receiving-rail',[3.84,.18,.20],[0,.62,-.65]));box('rear-rail',[3.84,.18,.20],[0,.99,.53]);
   for(let i=0;i<3;i++)box(`bound-stock/${i}`,[3.60,.20,.21],[0,.91+i*.14,-.29+i*.23]);
   for(const x of [-1.20,1.20]){box(`strap/${x}`,[.035,.43,.76],[x,1.07,.02],'metal');box(`strap-pin/${x}`,[.07,.05,.08],[x,1.29,-.31],'metal');}
   box('rear-stop',[4,.11,.12],[0,1.465,.69],'wood');for(const x of [-1.5,1.5])box(`stop-post/${x}`,[.09,.45,.09],[x,1.24,.65]);
   // Keep all original units/IDs in order. Two closed seats span the measured
   // rail-to-trestle gap and overlap both real solids at an interior height.
   const actual=scanActivityDraws(T,root,{space:'local'}),rail=actual.find(r=>r.object===portBinding.object),height=(rail.box[4]-rail.box[1])/2,y0=rail.box[1]+height/2,y1=y0+height;
   for(const object of trestleObjects){const row=actual.find(r=>r.object===object),cross=[];
    for(const t of row.triangles)for(let j=0;j<3;j++){const a=t.p[j],b=t.p[(j+1)%3];if(a[1]===y1)cross.push(a[2]);if(a[1]<y1&&b[1]>y1||a[1]>y1&&b[1]<y1)cross.push(a[2]+(y1-a[1])/(b[1]-a[1])*(b[2]-a[2]));}
    requireValue(cross.length,'trestle seat section');const width=row.box[3]-row.box[0],overlap=Math.min(width,rail.box[5]-rail.box[2])/4,z0=rail.box[5]-overlap,z1=Math.min(...cross)+overlap,x=(row.box[0]+row.box[3])/2;
    requireValue(z1>z0,'rail seat solid span');box(`rail-seat/${x}`,[width*.8,height,z1-z0],[x,(y0+y1)/2,(z0+z1)/2],'metal');
   }

  }else if(id==='partsRack'){
   for(const x of [-1.05,1.05]){
    box(`foot/${x}`,[.20,.10,.90],[x,.05,0],'metal',undefined,true);
    for(const z of [-.34,.34])box(`upright/${x}/${z}`,[.09,1.95,.09],[x,1.075,z],'metal');
    box(`u-frame/${x}`,[.09,.09,.77],[x,2.005,0],'metal');
   }
   // A closed assembly of three real slabs shares its front supporting plane.
   // The conservative box includes shelf air, which this approach never crosses.
   const shelfPositions=[];
   for(const y of [.34,1.01,1.65]){const g=new T.BoxGeometry(2.20,.06,.58),q=g.toNonIndexed();q.translate(0,y-.03,-.16);shelfPositions.push(...q.attributes.position.array);q.dispose();g.dispose();}
   const shelves=new T.BufferGeometry();shelves.setAttribute('position',new T.Float32BufferAttribute(shelfPositions,3));shelves.computeVertexNormals();service(mesh('shelves',shelves,'wood'));
   for(const [i,y]of [.34,1.01].entries()){
    const x=i?-.53:.53;box(`tray-bottom/${i}`,[.73,.035,.38],[x,y+.0175,-.08],'metal');
    for(const z of [-.27,.11])box(`tray-rim/${i}/${z}`,[.73,.10,.025],[x,y+.085,z],'metal');
    for(const X of [x-.365,x+.365])box(`tray-side/${i}/${X}`,[.025,.10,.38],[X,y+.085,-.08],'metal');
   }
   for(const x of [-1.05,1.05])beam(`rear-brace/${x}`,[x,.15,.37],[-x,1.95,.37],.022);
  }else if(id==='coveredPress'){
   const low=2.60,high=3.20,roofBottom=z=>low-.14+(z+1.41)/2.82*(high-low);
   const ring=y=>[[-2.10,y(-1.41),-1.41],[2.10,y(-1.41),-1.41],[2.10,y(1.41),1.41],[-2.10,y(1.41),1.41]];
   mesh('roof',loftGeometry(T,[ring(roofBottom),ring(z=>roofBottom(z)+.14)]),'coating');
   for(const x0 of [-1.82,1.82])for(const z of [-1.10,1.10]){
    const x=x0,footZ=z-(z<0?pressFootOffset:0);box(`canopy-foot/${x0}/${z}`,[.33,.12,.33],[x,.06,footZ],'stone',undefined,true);
    const top=roofBottom(z);if(footZ===z)box(`canopy-post/${x0}/${z}`,[.10,top-.12,.10],[x,(top+.12)/2,z],'wood');else beam(`canopy-post/${x0}/${z}`,[x,.12,footZ],[x,top,z],.06,'wood');
    beam(`knee/${x0}/${z}`,[x,top-.43,z],[x,z<0?roofBottom(z+.35):roofBottom(z-.35),z+(z<0?.35:-.35)],.035,'wood');
   }
   for(const x of [-1.82,1.82])beam(`roof-frame/${x}`,[x,roofBottom(-1.30),-1.30],[x,roofBottom(1.30),1.30],.055,'wood');
   const zc=-.09+pressFrontOffset;service(box('work-bed',[2.52,.10,1.22],[0,.83,zc],'wood'));
   for(const x of [-1.03,1.03])for(const z of [-.50,.34])box(`bed-foot/${x}/${z}`,[.10,.78,.10],[x,.39,z+pressFrontOffset],'metal',undefined,true);
   for(const x of [-.99,.99]){box(`yoke-post/${x}`,[.13,1.16,.15],[x,1.46,zc+.16],'metal');box(`yoke-joint/${x}`,[.25,.14,.28],[x,.94,zc+.16],'metal');}
   box('yoke-crosshead',[2.24,.16,.21],[0,1.99,zc+.16],'metal');
   mesh('press-screw',new T.CylinderGeometry(.045,.045,1.10,12),'metal',[0,1.60,zc+.16]);
   for(let i=0;i<9;i++)mesh(`screw-thread/${i}`,new T.TorusGeometry(.054,.012,4,12),'metal',[0,1.16+i*.10,zc+.16],[Math.PI/2,0,0]);
   box('pressure-shoe',[.48,.12,.42],[0,1.05,zc+.16],'metal');beam('turn-handle',[-.43,2.13,zc+.16],[.43,2.13,zc+.16],.022);
  }else if(id==='foldScreen'){
   const ring=[[-1.35,-.65],[1.35,-.65],[1.35,.50],[.55,.65],[-.45,.47],[-1.35,.60]];
   mesh('folded-plinth',loftGeometry(T,[ring.map(([x,z])=>[x,0,z]),ring.map(([x,z])=>[x,.14,z])]),'stone');bearingBindings.push({object:units.at(-1).object});service(units.at(-1).object);
   for(const [i,x,h,angle] of [[0,-.615,1.83,-19],[1,.615,2.34,19]]){
    const yaw=angle*Math.PI/180;box(`panel/${i}`,[1.25,h-.14,.14],[x,(h+.14)/2,.02],'wood',[0,yaw,0]);
    box(`relief/${i}`,[.57,.45,.10],[x,h*.55,-.12],'metal',[0,yaw,0]);
    beam(`rear-brace/${i}`,[x,.14,.48],[x,h*.72,.16],.033,'metal');beam(`hinge-pin/${i}`,[x+Math.sign(-x)*.54,.18,.18],[x+Math.sign(-x)*.54,h-.06,.18],.025,'metal');
   }
   // Actual straight coping at the visitor face is the registered service edge.
   box('coping-inlay',[2.45,.025,.07],[0,.1525,-.51],'metal');
  }else if(id==='restSeat'){
   for(const x of [-.91,.91])box(`stone-foot/${x}`,[.34,.37,.82],[x,.185,0],'stone',undefined,true);
   for(let i=0;i<4;i++)box(`seat-slat/${i}`,[2.60,.09,.118],[0,.415,-.26+.059+i*.134],'wood');
   for(const x of [-1.10,1.10])box(`back-post/${x}`,[.07,.48,.07],[x,.61,.39],'metal');
   box('rear-rail',[2.60,.15,.10],[0,.775,.42],'wood');box('lower-back-slat',[2.60,.095,.07],[0,.60,.42],'wood');
   service(box('front-toe',[2.60,.045,.06],[0,.2375,-.44],'metal'));
  }else if(id==='foldIsland'){
   service(box('stone-plinth',[2.60,.23,1.35],[0,.115,0],'stone',undefined,true));
   const sections=[[.23,.91,-.22,0],[.72,1.74,.10,6],[1.86,.83,.33,13],[2.54,.28,.17,18]];
   const rings=sections.map(([y,w,x,deg])=>{const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [[-w/2,-.09],[w/2,-.09],[w/2,.09],[-w/2,.09]].map(([u,z])=>[x+c*u+s*z,y,-s*u+c*z]);});
   mesh('twisted-blade',loftGeometry(T,rings),'metal');
   const small=[[.23,.63,-.45],[.66,.46,-.40],[.94,.17,-.31]].map(([y,w,x])=>[[-w/2,-.065],[w/2,-.065],[w/2,.065],[-w/2,.065]].map(([u,z])=>[x+u,y,z+.25]));mesh('second-blade',loftGeometry(T,small),'metal');
   for(const x of [-.40,.32])box(`anchor-shoe/${x}`,[.24,.10,.34],[x,.28,.02],'metal');
  }
  root.updateWorldMatrix(true,true);
  const serviceRow=scanActivityDraws(T,root,{space:'local'}).find(r=>r.object===portBinding.object),top=serviceRow.box[4],front=serviceRow.box[2];
  const edgePoints=[];
  for(const t of serviceRow.triangles)if(triangleNormalY(t.p)>0)for(let corner=0;corner<3;corner++){const p=t.p[corner];if(p[1]===top&&p[2]===front&&!edgePoints.some(q=>same(q.p,p)))edgePoints.push({element:t.e,corner,p});}
  edgePoints.sort((a,b)=>a.p[0]-b.p[0]);requireValue(edgePoints.length>=2,'physical service edge registration');
  portBinding.geometry=serviceRow.geometry;portBinding.edge=[edgePoints[0],edgePoints.at(-1)].map(({element,corner})=>({element,corner}));
  return {root,id,units,bearingBindings,portBinding,materialBindings,get disposed(){return disposed;},dispose(){if(disposed)return;disposed=true;try{scope.dispose();}finally{root.removeFromParent();root.clear();}}};
 }catch(e){scope.dispose();root.clear();throw e;}
}

/** Every positive-width interval is from a real triangle/measurement plane.
 * No epsilon joins, rounded endpoints, or endpoint-only aperture assumption. */
export function measureActivitySection(faces,{axis='z',value,lo,hi}={}){
 const fixed=axis==='z'?2:0,across=axis==='z'?0:2,hits=[];
 for(const f of faces){const pts=[];
  for(let i=0;i<3;i++){const a=f.p[i],b=f.p[(i+1)%3];if(a[fixed]===value)pts.push(a);
   if(a[fixed]<value&&b[fixed]>value||a[fixed]>value&&b[fixed]<value){const t=(value-a[fixed])/(b[fixed]-a[fixed]),p=a.map((v,k)=>v+t*(b[k]-v));p[fixed]=value;pts.push(p);}}
  if(pts.length<2)continue;pts.sort((a,b)=>a[across]-b[across]);const a=pts[0],b=pts.at(-1);if(a[across]===b[across])continue;
  const L=Math.max(lo,a[across]),H=Math.min(hi,b[across]);if(!(H>L))continue;
  const point=x=>a.map((v,k)=>k===fixed?value:k===across?x:v+(x-a[across])/(b[across]-a[across])*(b[k]-v));hits.push({lo:L,hi:H,p:[point(L),point(H)],faceId:f.id??`e${f.e}`});
 }
 hits.sort((a,b)=>a.lo-b.lo||a.hi-b.hi);let end=lo;for(const h of hits){requireValue(h.lo<=end,'service face section coverage gap');end=Math.max(end,h.hi);}requireValue(end===hi,'service face section coverage incomplete');
 const witness=[...new Map(hits.flatMap(h=>h.p).map(p=>[p.join(','),p])).values()].sort((a,b)=>a[across]-b[across]||a[1]-b[1]);requireValue(witness.length<=32,'finite section witness limit');
 return {witness,intervals:hits};
}

export function captureActivityTop(row){return row.triangles.filter(t=>triangleNormalY(t.p)>0).map(t=>({id:`${row.id}/e${t.e}`,p:t.p.map(p=>[...p])}));}

/** A service rail is a continuous common boundary of real top/front faces.
 * Exact interval union preserves real gaps and accepts conforming subdivisions. */
export function measureActivityServiceEdge(row,{witness,center,width,budget}={}){
 budget?.take(row.triangles.length*9+1);
 const height=witness[0][1],plane=witness[0][2],top=[],front=[];
 requireValue(witness.every(p=>p[1]===height&&p[2]===plane),'service edge level front');
 for(const t of row.triangles){const [a,b,c]=t.p,n=[(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),triangleNormalY(t.p),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])];
  const isTop=n[1]>0&&t.p.every(p=>p[1]===height),isFront=n[2]<0&&t.p.every(p=>p[2]===plane);if(!isTop&&!isFront)continue;
  const edge=t.p.filter(p=>p[1]===height&&p[2]===plane);if(edge.length<2)continue;const lo=Math.min(...edge.map(p=>p[0])),hi=Math.max(...edge.map(p=>p[0]));if(hi>lo)(isTop?top:front).push({lo,hi,element:t.e});
 }
 const merged=intervals=>{const sorted=intervals.slice().sort((a,b)=>a.lo-b.lo||a.hi-b.hi),out=[];for(const p of sorted){const last=out.at(-1);if(last&&p.lo<=last[1])last[1]=Math.max(last[1],p.hi);else out.push([p.lo,p.hi]);}return out;};
 const tops=merged(top),fronts=merged(front),common=[];let i=0,j=0;
 while(i<tops.length&&j<fronts.length){const a=tops[i],b=fronts[j],lo=Math.max(a[0],b[0]),hi=Math.min(a[1],b[1]);if(hi>lo)common.push([lo,hi]);if(a[1]<b[1])i++;else j++;}
 const lo=center[0]-width/2,hi=center[0]+width/2;let end=lo;
 for(const [a,b]of common){if(b<=end)continue;requireValue(a<=end,'service adjoining edge continuity gap');end=Math.max(end,b);if(end>=hi)break;}
 requireValue(end>=hi,'service adjoining edge coverage gap');
 return {basis:'canonical-front',height,plane,span:[lo,hi],topIntervals:top,frontIntervals:front,commonIntervals:common};
}

/** Optional rows are a final-range remeasurement, in prototype coordinates. */
export function measureActivityPrototype(T,asset,{rows=scanActivityDraws(T,asset.root,{space:'local'}),prototypeOwner=Object.freeze({}),budget}={}){
 requireValue(!asset.disposed,'disposed prototype');
 requireValue(rows.length===asset.units.length&&asset.units.length<=96,'unit coverage mismatch');
 const refs=new Set(asset.units.map(u=>u.object));requireValue(refs.size===rows.length&&rows.every(r=>refs.has(r.object)),'unit coverage mismatch');
 requireValue(asset.units.every(u=>u.closed)&&asset.materialBindings.length===rows.length,'closed unit coverage');
 requireValue(rows.every(r=>r.triangles.length*3===asset.units.find(u=>u.object===r.object).drawElements),'draw triangle coverage mismatch');
 const envelope=bounds(rows.flatMap(r=>r.triangles)),datum=envelope[1];
 // The arrival anchor has the authored Y=0 convention; the conservative
 // envelope also contains it when Float32 feet lie a fraction above zero.
 envelope[1]=Math.min(0,envelope[1]);const tol=2**-23*Math.max(1,...envelope.map(Math.abs));
 const bottoms=[];
 for(const r of rows)for(const t of r.triangles){if(triangleNormalY(t.p)>=0||!t.p.every(p=>p[1]===t.p[0][1])||Math.abs(t.p[0][1]-datum)>tol)continue;bottoms.push({object:r.object,sourceId:r.id,element:t.e,ring:t.p.map(p=>[p[0],p[2]]),bottomY:t.p[0][1]});}
 const bottomObjects=new Set(bottoms.map(b=>b.object)),bindings=new Set(asset.bearingBindings.map(b=>b.object));
 requireValue(bindings.size===asset.bearingBindings.length&&bindings.size===bottomObjects.size&&[...bottomObjects].every(o=>bindings.has(o)),'bearing coverage mismatch');
 requireValue(bottoms.length>0&&bottoms.length<=16,'bearing triangle count');
 const binding=asset.portBinding,front=rows.find(r=>r.object===binding.object);requireValue(front&&front.geometry===binding.geometry,'service face source mismatch');
 const witness=binding.edge.map(({element,corner})=>{const t=front.triangles.find(t=>t.e===element);requireValue(t,'service face triangle missing');return [...t.p[corner]];});
 // The authored arrival axis intersects the actual finite edge. Its centre
 // need not equal the midpoint of a translated Float32 vertex pair.
 const parameter=(binding.anchor[0]-witness[0][0])/(witness[1][0]-witness[0][0]);
 requireValue(parameter>=0&&parameter<=1,'service axis outside real edge');
 const center=witness[0].map((v,k)=>k===0?binding.anchor[0]:v+parameter*(witness[1][k]-v)),z=center[2],top=center[1],width=binding.width;
 requireValue(Math.abs(z-binding.anchor[2])<=2e-5&&Math.abs(center[0]-binding.anchor[0])<=2e-5,'service face does not match declared front');
 requireValue(2*Math.min(center[0]-witness[0][0],witness[1][0]-center[0])>=width,'service edge aperture too narrow');
 const adjacency=measureActivityServiceEdge(front,{witness,center,width,budget});
 const section={witness,edge:copyEdge(binding.edge),adjacency};
 const parts=rows.map((r,i)=>({id:asset.units.find(u=>u.object===r.object).id,box:[...r.box],prototypeOwner}));
 const facePartId=asset.units.find(u=>u.object===binding.object).id;
 const facts={id:asset.id,prototypeOwner,envelope,parts,bearings:bottoms.map(({ring,bottomY})=>({ring,bottomY,prototypeOwner})),ports:[{id:'front',kind:'serve',prototypeOwner,position:[center[0],0,z],servicePosition:center,normal:[0,0,-1],width,facePartId,witness:section.witness}]};
 return {...facts,measurement:{drawTriangles:rows.reduce((n,r)=>n+r.triangles.length,0),units:rows.map(r=>({id:asset.units.find(u=>u.object===r.object).id,sourceId:r.id,triangles:r.triangles.length,box:[...r.box]})),bottoms:bottoms.map(({object,...b})=>b),portSection:section}};
}

/** Extract real draw spans, retaining per-element formation coordinates. The
 * assembly owns its snapshots; temporary slices are retired immediately. */
export function addActivityDraws(T,{rows,assemblyFor,slotsFor}){
 const records=[];
 for(const row of rows){const groups=new Map();for(const t of row.triangles){const key=String(t.group);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);}
  for(const triangles of groups.values()){
   const slot=slotsFor(row.object,triangles[0].slot),id=`${row.id}@${triangles[0].e}`;
   const source=row.geometry,g=copyFormationGroup(T,source,{start:triangles[0].e,count:triangles.length*3});
   try{
    requireValue(triangles.every((t,i)=>t.e===triangles[0].e+i*3),'contiguous draw span required');
    if(!g.hasAttribute(FORMATION_ATTRIBUTE))writeFormationCoordinates(T,g);
    const assembly=assemblyFor(slot);assembly.add(g,row.object.material[triangles[0].slot]??row.object.material,{matrix:row.matrix,sourceId:id,castShadow:row.object.castShadow,receiveShadow:row.object.receiveShadow,layers:row.object.layers.mask});
    records.push({id,row,triangles,slot,expectedPositions:triangles.flatMap(t=>t.p.flat().map(Math.fround)),expectedFormation:Array.from(g.getAttribute(FORMATION_ATTRIBUTE).array)});
   }finally{g.dispose();}
  }
 }
 return records;
}

export function verifyActivityRanges(T,records,ranges,{budget}={}){
 budget?.take(ranges.length*17);const carriers=new Set(ranges.map(r=>r.object));for(const object of carriers)validateActivityFinalDraw(T,object);
 requireValue(ranges.length===records.length,'final source range coverage');const used=new Set(),rows=new Map(),proof=[],bySource=new Map(ranges.map(r=>[r.sourceId,r]));requireValue(bySource.size===ranges.length,'final source range identity');
 for(const record of records){const range=bySource.get(record.id);requireValue(range&&!used.has(range),'final source range identity');used.add(range);requireValue(range.geometry===range.object.geometry,'final source geometry identity');
  const p=range.geometry.getAttribute('position'),f=range.geometry.getAttribute(FORMATION_ATTRIBUTE),start=range.vertexStart,count=range.vertexCount;
  requireValue(count*3===record.expectedPositions.length,'final source triangle count');
  for(let i=0;i<count*3;i++)requireValue(p.array[start*3+i]===record.expectedPositions[i],'final source pose or position mismatch');
  for(let i=0;i<count*3;i++)requireValue(f.array[start*3+i]===record.expectedFormation[i],'final formation mismatch');
  if(!rows.has(record.row.id))rows.set(record.row.id,{...record.row,triangles:[]});
  const row=rows.get(record.row.id);record.triangles.forEach((t,i)=>row.triangles.push({...t,p:[0,1,2].map(k=>[0,1,2].map(c=>p.getComponent(start+i*3+k,c)))}));
  proof.push({sourceId:record.id,objectId:range.object.uuid,geometryId:range.geometry.uuid,vertexStart:start,vertexCount:count,finalVerified:true});
 }
 for(const row of rows.values()){row.triangles.sort((a,b)=>a.e-b.e);row.box=bounds(row.triangles);}
 return {rows:[...rows.values()],proof};
}

/** Measurement work is bounded separately from the court's pair budget.
 * Charge before allocating/copying triangle pages; it is build-local. */
export function createActivityMeasurementBudget(maxWork=2000000){
 requireValue(Number.isInteger(maxWork)&&maxWork>=1&&maxWork<=2000000,'measurement budget limit');
 let spent=0;return {take(n){requireValue(Number.isSafeInteger(n)&&n>=0,'measurement charge');if(n>maxWork-spent){const e=new Error('Activity geometry: measurement budget exhausted');e.code='ACTIVITY_MEASUREMENT_BUDGET';throw e;}spent+=n;},inspect(){return {spent,maxWork};}};
}
const signedAxis=(p,k)=>{const [x,y,z]=p;return [[x,y,z],[z,y,-x],[-x,y,-z],[-z,y,x]][k];};
const identityFrame=frame=>frame?.origin?.length===2&&frame.origin.every(v=>v===0)&&frame.yawRadians===0;
const translated=(p,t)=>p.map((v,i)=>v+t[i]);
const samePoint=(a,b)=>same(a,b);

/** The baked orientation belongs to the vertices. A cardinal author angle is
 * only a candidate: the registered physical support edge proves this basis.
 * No inverse trig, snapping, rebaking, or tolerance-based cardinal selection. */
export function measureActivityFinalMember(T,{asset,rows,memberId,authorPose,frame,recipe,budget}={}){
 requireValue(identityFrame(frame),'unsupported recipe frame');
 const translation=authorPose?.position,quarter=authorPose?.rotationY/(Math.PI/2);
 requireValue(translation?.length===3&&translation.every(Number.isFinite)&&Number.isInteger(quarter),'unsupported author frame');
 requireValue(rows?.length>0&&rows.length<=96,'final unit coverage');
 budget?.take(rows.reduce((n,r)=>n+r.triangles.length*9+1,0));
 const k=(quarter%4+4)%4,rotate=p=>signedAxis(p,k),unrotate=p=>signedAxis(p,(4-k)%4);
 const byObject=new Map(),byId=new Map();
 const reduced=rows.map(row=>{
  requireValue(!byObject.has(row.object)&&!byId.has(row.id),'final source ownership');byObject.set(row.object,row);byId.set(row.id,row);
  const elements=new Map();
  const triangles=row.triangles.map(t=>{requireValue(!elements.has(t.e),'duplicate final element');elements.set(t.e,t);
   return {...t,p:t.p.map(p=>{const u=p.map((v,i)=>v-translation[i]);requireValue(u[0]+translation[0]===p[0]&&u[2]+translation[2]===p[2],'unrepresentable final XZ frame');return unrotate(u);})};});
  return {...row,triangles,box:bounds(triangles)};
 });
 const measured=measureActivityPrototype(T,asset,{rows:reduced,budget}),dimBox=b=>bounds([{p:[rotate(b.slice(0,3)),rotate(b.slice(3))]}]);
 const ring=r=>r.map(v=>{const q=rotate([v[0],0,v[1]]);return [q[0],q[2]];});
 const facts={...measured,envelope:dimBox(measured.envelope),parts:measured.parts.map(p=>({...p,box:dimBox(p.box)})),bearings:measured.bearings.map(b=>({...b,ring:ring(b.ring)})),ports:measured.ports.map(p=>({...p,position:rotate(p.position),servicePosition:rotate(p.servicePosition),normal:rotate(p.normal),witness:p.witness.map(rotate)}))};
 const binding=asset.portBinding,front=byObject.get(binding.object),port=facts.ports[0];
 requireValue(front&&facts.ports.length===1&&port.kind==='serve','single bound serve edge required');
 const frontElements=new Map(front.triangles.map(t=>[t.e,t]));
 const selected=binding.edge.map(({element,corner})=>{const t=frontElements.get(element);requireValue(t&&Number.isInteger(corner)&&corner>=0&&corner<3,'service edge element');return t.p[corner];});
 const ni=port.normal[0]===0?2:0,ti=2-ni,outward=port.normal[ni],plane=selected[0][ni];
 requireValue(Math.abs(outward)===1&&selected.length===2&&selected.every(p=>p[ni]===plane&&p[1]===selected[0][1])&&selected[0][ti]!==selected[1][ti],'actual support edge is not cardinal and level');
 let strict=false,vertical=false;
 for(const t of front.triangles){
  for(const p of t.p){const side=(p[ni]-plane)*outward;requireValue(side<=0,'service edge is not a support plane');if(side<0)strict=true;}
  if(t.p.every(p=>p[ni]===plane)){const [a,b,c]=t.p.map(p=>new T.Vector3(...p));if(b.sub(a).cross(c.sub(a)).getComponent(ni)*outward>0)vertical=true;}
 }
 requireValue(strict&&vertical,'missing outward physical support face');
 const serving=recipe.nodes.filter(n=>n.memberId===memberId&&n.portId===port.id);
 requireValue(serving.length===1,'unique serve incidence required');
 const node=serving[0],incident=recipe.edges.filter(e=>e.a===node.id||e.b===node.id);
 requireValue(incident.length===1,'single serve incidence required');
 const edge=incident[0],other=recipe.nodes.find(n=>n.id===(edge.a===node.id?edge.b:edge.a));
 requireValue(other?.uv?.length===2,'serve predecessor requires authored axis');
 const centre=translated(port.servicePosition,translation);
 requireValue(centre[ni]===plane&&centre[ti]===other.uv[ti===0?0:1]&&(other.uv[ni===0?0:1]-plane)*outward>0,'author axis does not intersect support edge');
 requireValue(Number.isFinite(edge.width)&&edge.width>0&&2*Math.min(Math.abs(selected[0][ti]-centre[ti]),Math.abs(selected[1][ti]-centre[ti]))>=edge.width,'service edge aperture');
 // Replay BOX extrema and every registered bottom/edge against final readback.
 const units=new Map(asset.units.map(u=>[u.id,byObject.get(u.object)]));
 for(const p of facts.parts)requireValue(samePoint(p.box.map((v,i)=>v+translation[i%3]),units.get(p.id).box),'final world BOX extrema');
 const elementIndex=new Map(rows.map(r=>[r.id,new Map(r.triangles.map(t=>[t.e,t]))]));
 for(const b of measured.measurement.bottoms){const t=elementIndex.get(b.sourceId)?.get(b.element);requireValue(t,'actual bottom source');for(let j=0;j<3;j++)requireValue(samePoint(translated(rotate([b.ring[j][0],b.bottomY,b.ring[j][1]]),translation),t.p[j]),'actual bottom replay');}
 for(let j=0;j<selected.length;j++)requireValue(samePoint(translated(port.witness[j],translation),selected[j]),'actual service witness replay');
 facts.measurement={...measured.measurement,units:measured.measurement.units.map(u=>({...u,box:dimBox(u.box)})),bottoms:measured.measurement.bottoms.map(b=>({...b,ring:ring(b.ring)})),portSection:{...measured.measurement.portSection,witness:port.witness}};
 return {facts,pointRows:reduced.map(r=>({id:r.id,triangles:r.triangles.map(t=>({e:t.e,p:t.p.map(rotate)}))})),evidence:{quarter:k,translation:[...translation],residualYaw:0,authoredYaw:authorPose.rotationY,sourceUnitCount:rows.length,triangles:measured.measurement.drawTriangles,centre,plane,normal:port.normal,sourceWitness:selected.map(p=>[...p]),worldBoxesAndWitnessesExact:true}};
}

const identityMatrix=m=>m.elements.every((v,i)=>v===(i%5===0?1:0));
function requireUnitParents(root,carrier){
 let p=carrier.parent;while(p){requireValue(identityMatrix(automaticLocal(p)),'unsupported parent unit frame');if(p===root)break;p=p.parent;}
 requireValue(p===root,'carrier outside submission root');
 for(p=root.parent;p;p=p.parent)requireValue(identityMatrix(automaticLocal(p)),'unsupported ancestor unit frame');
}

/** One linear source/range/carrier ownership index. It keeps only final handles
 * and pure measurements; retired prototype Mesh references never escape. */
export function createActivitySubmissionIndex(T,{root,ranges,members,owner,revision=1,budget}={}){
 requireValue(root?.isObject3D&&owner&&Number.isInteger(revision)&&revision>0,'submission identity');
 requireValue(members?.length>0&&members.length<=16&&ranges?.length<=2048,'submission coverage limit');
 budget?.take(ranges.length+members.reduce((n,m)=>n+m.pointRows.reduce((s,r)=>s+r.triangles.length*9+1,0),0));
 const bySource=new Map(),byCarrier=new Map(),memberIndex=new Map(),rangeIds=new Set();
 for(const m of members){requireValue(!memberIndex.has(m.id),'duplicate member ownership');const entry={...m,carriers:new Set(),ranges:[],elements:new Map()};memberIndex.set(m.id,entry);
  for(const row of m.pointRows){requireValue(!bySource.has(row.id),'duplicate source ownership');const elements=new Map(row.triangles.map(t=>[t.e,t.p]));requireValue(elements.size===row.triangles.length,'duplicate source elements');bySource.set(row.id,{member:entry,elements});entry.elements.set(row.id,elements);}
 }
 for(const range of ranges){
  requireValue(typeof range.sourceId==='string'&&!rangeIds.has(range.sourceId),'final range source identity');rangeIds.add(range.sourceId);
  const at=range.sourceId.lastIndexOf('@'),rowId=range.sourceId.slice(0,at),first=Number(range.sourceId.slice(at+1)),source=bySource.get(rowId);
  const object=range.object,g=range.geometry,p=g?.getAttribute('position'),start=range.vertexStart,count=range.vertexCount;
  requireValue(at>0&&Number.isInteger(first)&&first>=0&&first%3===0&&object?.isMesh&&object.geometry===g&&!g.index&&p?.array instanceof Float32Array&&p.itemSize===3&&Number.isInteger(start)&&start>=0&&start%3===0&&Number.isInteger(count)&&count>0&&count%3===0&&start+count<=p.count,'final range draw identity');
  if(!byCarrier.has(object))byCarrier.set(object,{object,ranges:[],owners:new Set()});const carrier=byCarrier.get(object);carrier.ranges.push(range);carrier.owners.add(source?.member.id??null);
  if(source){source.member.carriers.add(object);source.member.ranges.push({range,rowId,first});for(let e=first;e<first+count;e+=3)requireValue(source.elements.has(e),'final range element identity');}
 }
 for(const carrier of byCarrier.values()){
  requireValue(carrier.owners.size===1,'mixed carrier requires exclusive member ownership');
  const spans=carrier.ranges.slice().sort((a,b)=>a.vertexStart-b.vertexStart);let end=0;for(const r of spans){requireValue(r.vertexStart===end,'final carrier range coverage');end+=r.vertexCount;}
  requireValue(end===carrier.object.geometry.attributes.position.count,'final carrier draw coverage');
 }
 for(const m of memberIndex.values()){
  requireValue(m.carriers.size>0,'missing member carrier');const seen=new Map();
  for(const {rowId,first,range}of m.ranges){if(!seen.has(rowId))seen.set(rowId,new Set());for(let e=first;e<first+range.vertexCount;e+=3){requireValue(!seen.get(rowId).has(e),'overlapping source range');seen.get(rowId).add(e);}}
  for(const [id,elements]of m.elements)requireValue(seen.get(id)?.size===elements.size,'missing source range element');
 }
 return {owner,revision,members:memberIndex,bySource,byCarrier,budget,submitted:false,disposed:false,dispose(){if(this.disposed)return;this.disposed=true;this.members.clear();this.bySource.clear();this.byCarrier.clear();}};
}
function requireSubmission(index,owner,revision){requireValue(!index?.disposed,'disposed submission');requireValue(index.owner===owner,'submission owner mismatch');requireValue(index.revision===revision,'submission revision mismatch');}

/** Q and M are certified translations here. Validate every carrier before the
 * first mutation, then consume Q*M^-1 once on each exclusive actual Mesh. */
export function submitActivityQualification(T,{root,index,qualification,owner,revision}={}){
 requireSubmission(index,owner,revision);requireValue(!index.submitted,'qualification already submitted');
 requireValue(qualification?.status==='complete'&&qualification.snapshot.members.length===index.members.size,'complete qualification required');
 const plans=[];automaticHierarchy(root);
 for(const q of qualification.snapshot.members){const m=index.members.get(q.id);requireValue(m&&q.prototypeId===m.facts.id&&q.rotationY===0,'qualification member frame');
  const M=m.evidence.translation;requireValue(q.position[0]===M[0]&&q.position[2]===M[2],'qualification changed author XZ');
  const delta=q.position.map((v,i)=>v-M[i]);
  for(const object of m.carriers){requireUnitParents(root,object);requireValue(identityMatrix(automaticLocal(object)),'unsupported original carrier unit frame');plans.push({object,delta});}
  m.qualificationPose={position:[...q.position],rotationY:q.rotationY};m.submittedCarrierDelta=delta;
 }
 index.budget?.take(plans.length);
 for(const {object,delta}of plans){object.position.set(...delta);object.updateMatrix();object.updateWorldMatrix(true,false);}
 index.submitted=true;
 return verifyActivitySubmission(T,{root,index,qualification,owner,revision});
}

/** Read real matrixWorld, positions and draw spans again. Metadata alone cannot
 * prove placement. All unit extrema, actual feet and registered services replay. */
export function verifyActivitySubmission(T,{root,index,qualification,owner,revision}={}){
 requireSubmission(index,owner,revision);requireValue(index.submitted,'qualification not submitted');
 const qualified=new Map(qualification.snapshot.members.map(m=>[m.id,m])),proof=[];
 index.budget?.take([...index.members.values()].reduce((n,m)=>n+m.ranges.reduce((s,r)=>s+r.range.vertexCount*9,0),0));automaticHierarchy(root);for(const {object}of index.byCarrier.values())validateActivityFinalDraw(T,object,{translated:true});root.updateWorldMatrix(true,true);
 for(const m of index.members.values()){
  const q=qualified.get(m.id),Q=q.position,worldRows=new Map(),worldElements=new Map();let components=0;
  for(const {range,rowId,first}of m.ranges){const {object,geometry,vertexStart,vertexCount}=range;requireUnitParents(root,object);
   const p=geometry.getAttribute('position');requireValue(object.geometry===geometry&&!geometry.index&&geometry.drawRange.start===0&&(geometry.drawRange.count===Infinity||geometry.drawRange.count===p.count)&&!geometry.groups.length&&object.visible&&!Array.isArray(object.material)&&object.material.visible,'submitted draw identity');
   if(!worldRows.has(rowId)){worldRows.set(rowId,[]);worldElements.set(rowId,new Map());}
   const actualElements=worldElements.get(rowId),expectedElements=m.elements.get(rowId);
   for(let i=0;i<vertexCount;i++){
    const e=first+Math.floor(i/3)*3,corner=i%3,actual=new T.Vector3().fromBufferAttribute(p,vertexStart+i).applyMatrix4(object.matrixWorld).toArray(),expected=translated(expectedElements.get(e)[corner],Q);
    requireValue(samePoint(actual,expected),'submitted world point mismatch');components+=3;worldRows.get(rowId).push(actual);if(!actualElements.has(e))actualElements.set(e,[]);actualElements.get(e)[corner]=actual;
   }
  }
  const parts=new Map(m.facts.parts.map(p=>[p.id,p]));
  for(const unit of m.facts.measurement.units){const box=bounds([{p:worldRows.get(unit.sourceId)}]);requireValue(samePoint(box,parts.get(unit.id).box.map((v,i)=>v+Q[i%3])),'submitted world unit extrema');}
  for(const b of m.facts.measurement.bottoms){const tri=worldElements.get(b.sourceId)?.get(b.element);requireValue(tri,'submitted bottom source');for(let j=0;j<3;j++)requireValue(samePoint(tri[j],[b.ring[j][0]+Q[0],b.bottomY+Q[1],b.ring[j][1]+Q[2]]),'submitted world bottom mismatch');}
  const port=m.facts.ports[0],unit=m.facts.measurement.units.find(u=>u.id===port.facePartId),worldPort=q.worldPorts.find(p=>p.id===port.id);
  requireValue(worldPort,'submitted qualified service');
  for(const [j,b]of m.facts.measurement.portSection.edge.entries())requireValue(samePoint(worldElements.get(unit.sourceId).get(b.element)[b.corner],worldPort.witness[j]),'submitted world service witness');
  requireValue(samePoint(translated(port.servicePosition,Q),worldPort.servicePosition),'submitted world service centre');
  proof.push({id:m.id,components,units:m.facts.parts.length,bottomTriangles:m.facts.measurement.bottoms.length,witnessPoints:port.witness.length,carriers:m.carriers.size,delta:[...m.submittedCarrierDelta],mismatches:0});
 }
 return proof;
}
