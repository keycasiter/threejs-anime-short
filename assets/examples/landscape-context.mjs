import {buildRegionalArchitecture} from './region-programs.mjs';
import {createFractalHeightField,createHeightFieldGeometry} from '../environment/height-field.mjs';
import {createPlateauHeightField} from '../environment/constrained-height-field.mjs';
import {createAssetAssembly} from '../scene/asset-assembly.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';

/** A caller-authored settlement on one continuous terrain field. Buildings borrow
 * their materials; their final triangles are baked into a small static assembly.
 * Plot plateaus reserve the actual transformed footprint before terrain sampling.
 */
export function buildLandscapeContext(T,{mergeGeometries,materialFor,siteBounds=[-25,-25,25,25]}={}) {
  const scope=createResourceScope(),root=new T.Group(),sites=[],materialBindings=[];
  root.name='landscape-context';scope.defer(()=>root.removeFromParent());
  const buckets=new Map(),canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
  function staticAdd(g,material,binding,settings){
    const key=JSON.stringify(canonical(binding));
    if(!buckets.has(key))buckets.set(key,{binding,assembly:scope.own(createAssetAssembly(T,{mergeGeometries}))});
    buckets.get(key).assembly.add(g,material,settings);
  }
  let field=createFractalHeightField({seed:71,baseHeight:-1.1,amplitude:10,baseFrequency:.013,octaves:3,persistence:.4});
  field=createPlateauHeightField({field,bounds:siteBounds,height:-.44,falloff:9});
  // Three ranges, all quadrants, different densities and orientations. These are
  // placements, not different proxy representations of the architectural family.
  const plots=[[-36,-18,'near','courtyard',6.4,5.2,3.2,.4],[36,-22,'near','workshop',7.2,4.8,3.5,-.5],[-32,23,'near','gallery',7,4.6,3.3,2.4],[34,26,'near','courtyard',6.2,5.2,3.1,-2.3],
    [-57,-43,'regional','workshop',8.5,5.6,4.5,.3],[-64,-30,'regional','gallery',6.8,4.5,4,.3],[55,-43,'regional','courtyard',8,7,3.8,-.5],[64,-28,'regional','workshop',6.5,4.8,5,-.5],[-55,48,'regional','gallery',8.4,5.8,4.2,2.3],[59,48,'regional','workshop',9,6,4.7,-2.4],
    [-84,-68,'distant','courtyard',10,8,4.6,.5],[80,-70,'distant','gallery',9,6.4,5,-.7],[-83,70,'distant','workshop',10,6.4,5.8,2.6],[81,72,'distant','courtyard',10,8.4,5,-2.5],[1,87,'distant','gallery',11,7,5.8,Math.PI],[5,-89,'distant','workshop',10,6,5.5,0]];
  try{
    for(const [index,[x,z,tier,program,width,depth,height,rotation]] of plots.entries()){
      const asset=buildRegionalArchitecture(T,{program,width,depth,height,materialFor});
      try{
        asset.root.position.set(x,0,z);asset.root.rotation.y=rotation;asset.root.updateWorldMatrix(true,true);
        const f=asset.footprint,footprint=[[f.minX,f.minZ],[f.maxX,f.minZ],[f.maxX,f.maxZ],[f.minX,f.maxZ]].map(([a,b])=>{const p=asset.root.localToWorld(new T.Vector3(a,0,b));return [p.x,p.z];});
        const xs=footprint.map(p=>p[0]),zs=footprint.map(p=>p[1]),bounds=[Math.min(...xs)-.35,Math.min(...zs)-.35,Math.max(...xs)+.35,Math.max(...zs)+.35];
        const groundY=field.heightAt(x,z),baseY=groundY+.18;
        field=createPlateauHeightField({field,bounds,height:groundY,falloff:4});
        asset.root.position.y=baseY;asset.root.updateWorldMatrix(true,true);
        const semantics=new Map(asset.materialBindings.map(b=>[b.object,b.slots]));
        asset.root.traverse(object=>{
          if(!object.isMesh)return;
          const slots=semantics.get(object),materials=Array.isArray(object.material)?object.material:[object.material],g=object.geometry;
          const groups=g.groups.length?g.groups:[{start:0,count:g.index?.count??g.attributes.position.count,materialIndex:0}];
          for(const group of groups){
            const source=materials[group.materialIndex]??materials[0],binding=slots[group.materialIndex]??slots[0],copy=new T.BufferGeometry();
            for(const key of ['position','normal','uv']){const a=g.attributes[key];if(!a)continue;const values=new Float32Array(group.count*a.itemSize);
              for(let i=0;i<group.count;i++){const v=g.index?g.index.getX(group.start+i):group.start+i;for(let c=0;c<a.itemSize;c++)values[i*a.itemSize+c]=a.getComponent(v,c);}copy.setAttribute(key,new T.BufferAttribute(values,a.itemSize));}
            try{staticAdd(copy,source,binding,{matrix:object.matrixWorld,castShadow:false,receiveShadow:false,layers:object.layers.mask});}finally{copy.dispose();}
          }
        });
        sites.push({id:`context/${index}`,tier,program,footprint,groundY,baseY,position:[x,baseY,z],rotation,spec:asset.spec,partCounts:Object.fromEntries(Object.entries(asset.parts).map(([k,v])=>[k,v.length]))});
      }finally{asset.dispose();}
    }
    const terrainGeometry=scope.own(createHeightFieldGeometry(T,field,{sizeX:240,sizeZ:240,segmentsX:160,segmentsZ:160}));
    const terrainSlot={role:'stone',options:{maps:false,baseColor:0x88957b,color:0xffffff}},terrain=new T.Mesh(terrainGeometry,materialFor(terrainSlot.role,terrainSlot.options));
    terrain.name='continuous-terrain';terrain.receiveShadow=true;root.add(terrain);materialBindings.push({object:terrain,slots:[terrainSlot]});
    const settlement=new T.Group(),stats={staticInputs:0,staticMeshes:0,staticTriangles:0,dynamicRoots:0};settlement.name='merged-settlement';root.add(settlement);
    for(const {assembly,binding} of buckets.values()){
      const merged=assembly.finish();settlement.add(merged.root);
      for(const key of Object.keys(stats))stats[key]+=merged.stats[key];
      merged.root.traverse(o=>{if(o.isMesh)materialBindings.push({object:o,slots:[binding]});});
    }
    let disposed=false;
    return {root,terrain,field,sites,materialBindings,stats:Object.freeze(stats),dispose(){if(disposed)return;disposed=true;scope.dispose();root.clear();}};
  }catch(error){scope.dispose();throw error;}
}
