import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Execute the browser's actual function in this realm, without a WebGL/browser
// stub that could clone values automatically across a protocol boundary.
const source=await readFile(new URL('../../assets/examples/core-lab/main.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function readState(){'),source.indexOf('\nfunction report(){'));
assert.ok(body.startsWith('function readState(){'));
function fixture(){
 const vector=values=>({toArray:()=>[...values]}),mesh={geometry:{uuid:'arrival-geometry'}};mesh.parent=mesh;
 const world={root:{updateMatrixWorld(){}},spec:{configuration:'grid'},stats:{buildingCount:23},materialRegionStats:[{slots:[{area:2}]}],
  parts:{curvedRoof:{geometry:{boundingBox:{max:vector([1,2,3])}}},panel:{matrixWorld:vector([1,0,0,1])}},anchors:new Map([['roof-service',vector([1,2,3])]]),
  materialBindings:[{object:{geometry:{uuid:'g'},material:{type:'MeshStandardMaterial'}}}],
  context:{sites:[{id:'site',position:[1,2,3],spec:{width:6},route:{start:[1,2,3],end:[4,2,3],width:2,mesh}}],stats:{staticMeshes:9},design:{topology:'branches'},layout:{connectionGraph:{components:[['a','b']]}},neighborhood:{diagnostics:{rejections:{neighbor:1}}},roads:{stats:{topTriangles:3}},gateways:[{center:[18,0,0]}]},
  regionalAssets:[{id:'hall',program:'gallery',regionId:'zone'}],observationSets:[{samples:[{point:[1,2,3]}]}],
  viewTasks:[{id:'region',position:[1,2,3],target:[0,0,0],sampleIds:['face'],inspection:{features:[{satisfied:true}]}}],
  layout:{ports:[{center:[18,0,0]}],connectionGraph:{components:[['campus']]}},placements:[{id:'hall',polygon:[[0,0],[1,0],[1,1]]}],detailGroups:[{id:'bolts',level:0,root:{visible:true}}]};
 const slot={current:{world,rig:{readState:()=>({key:{intensity:3}})}},revision:1},state={ready:true,error:null},renderer={info:{programs:[],render:{calls:4},memory:{geometries:5}}},owner={inspect:()=>({state:'open'})},camera={position:vector([1,2,3]),fov:41},controls={target:vector([0,0,0])},palettes={pbr:{inspect:()=>({entries:[]})},toon:{inspect:()=>({entries:[]})}};
 const readState=new Function('getWorld','slot','state','renderer','owner','camera','controls','palettes','coreViewLabel',body+'\nreturn readState;')(()=>world,slot,state,renderer,owner,camera,controls,palettes,t=>t.id);
 return {world,readState,slot};
}
test('public readState detaches the whole DTO in the same realm, including diagnostics and collections',()=>{
 const {world,readState}=fixture(),first=readState(),expected=structuredClone(first);
 assert.doesNotThrow(()=>JSON.stringify(first));assert.equal(first.context.sites[0].route.geometryId,'arrival-geometry');assert.equal('mesh' in first.context.sites[0].route,false);
 first.placements.length=0;
 assert.equal(world.placements.length,1,'mutating a snapshot collection must never mutate the live world');
 first.viewTasks[0].inspection.features[0].satisfied=false;
 assert.equal(world.viewTasks[0].inspection.features[0].satisfied,true,'nested task diagnostics must be detached');
 first.stats.buildingCount=0;first.materialRegionStats[0].slots[0].area=0;first.viewTasks[0].sampleIds.length=0;first.ports[0].center[0]=0;first.layoutComponents[0].length=0;
 first.context.neighborhood.rejections.neighbor=100;first.context.sites[0].spec.width=0;first.spec.configuration='mutated';first.observationSets[0].samples[0].point[0]=999;
 assert.deepEqual(readState(),expected,'every public DTO subtree must survive arbitrary caller mutations');
 assert.match(source,/window\.__CORE_TEST__\s*=\s*\{readState[,}]/,'the browser export must expose the tested snapshot function');
});
test('disposed snapshot remains a plain detached DTO',()=>{const {readState,slot}=fixture();slot.current=null;assert.deepEqual(readState(),{disposed:true,scope:{state:'open'},ready:false});});
