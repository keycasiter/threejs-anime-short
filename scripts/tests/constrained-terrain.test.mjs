import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHeightFieldGeometry} from '../../assets/environment/height-field.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
import {prepareTerrainRoadSupport,createTerrainRoadSource} from '../../assets/environment/terrain-roads.mjs';
let api={};try{api=await import('../../assets/environment/constrained-terrain.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const make=()=>createHeightFieldGeometry(T,{sample:(x,z)=>({height:.1*x+.2*z,dx:.1,dz:.2})},{sizeX:8,sizeZ:4,segmentsX:2,segmentsZ:1});
const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
function mesh(g){return new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));}
function ray(g,x,z){const m=mesh(g),hit=new T.Raycaster(new T.Vector3(x,20,z),new T.Vector3(0,-1,0)).intersectObject(m)[0];m.material.dispose();return hit?.point.y;}
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('constraint boundaries split the source triangles while preserving the exact source surface',()=>{
 const source=make(),before=[...source.attributes.position.array],index=[...source.index.array];assert.equal(typeof api.createConstrainedTerrainGeometry,'function');
 const result=api.createConstrainedTerrainGeometry(T,{terrainGeometry:source,constraints:[rect(-3,-1,-1,1)]});
 assert.ok(result.stats.outputTriangles>result.stats.sourceTriangles);for(const [x,z]of [[-3.7,-1.4],[-2,0],[-1.2,.8],[0,-.5],[3.3,1.2]])near(ray(result.geometry,x,z),ray(source,x,z));
 const support=prepareTerrainRoadSupport({terrainGeometry:result.geometry,topology:'triangulated'});support.dispose();assert.deepEqual([...source.attributes.position.array],before);assert.deepEqual([...source.index.array],index);result.geometry.dispose();source.dispose();
});

test('height edits stay continuous and protected road corridors retain the borrowed source surface',()=>{
 const source=make(),protectedRoad=rect(.5,-1.5,3.5,1.5),road=awaitRoad(source,protectedRoad),before=[...source.attributes.position.array];
 const result=api.createConstrainedTerrainGeometry(T,{terrainGeometry:source,constraints:[rect(-3.4,-1.4,-.6,1.4)],protectedRegions:[protectedRoad],heightAt:({x,z,baseHeight})=>baseHeight+.35*Math.max(0,1-Math.abs(x+2)/1.4)});
 const support=prepareTerrainRoadSupport({terrainGeometry:result.geometry,topology:'triangulated'}),draped=createTerrainRoadSource(T,{terrainSupport:support,surfaces:[{outer:protectedRoad}],thickness:.15});
 for(const [x,z]of [[1,-1],[2,.4],[3,1]]){const base=ray(source,x,z),edited=ray(result.geometry,x,z),oldRoad=ray(road.geometry,x,z),newRoad=ray(draped.geometry,x,z);assert.ok(Math.abs(edited-base)<1e-5,`protected terrain changed at ${x},${z}: ${edited} vs ${base}`);assert.ok(Math.abs(newRoad-oldRoad)<1e-5,`road support changed at ${x},${z}: ${newRoad} vs ${oldRoad}`);}
 const editedPosition=result.geometry.getAttribute('position');let maxEdit=0;for(let i=0;i<editedPosition.count;i++){const x=editedPosition.getX(i),z=editedPosition.getZ(i);if(x<-3.4||x>-.6)continue;maxEdit=Math.max(maxEdit,Math.abs(editedPosition.getY(i)-ray(source,x,z)));}assert.ok(maxEdit>.2,`expected a measurable height edit, got ${maxEdit}`);assert.deepEqual([...source.attributes.position.array],before);
 draped.dispose();support.dispose();result.geometry.dispose();road.dispose();source.dispose();
});

test('multiple oblique convex constraints remain a manifold and preserve source coverage',()=>{
 const source=make(),constraints=[[[ -3.3,-1.1],[-1.1,-1.5],[-.6,.5],[-2.8,.9]],[[.2,-1.6],[2.1,-.8],[1.4,1.4],[-.1,.8]]];
 const result=api.createConstrainedTerrainGeometry(T,{terrainGeometry:source,constraints});
 const support=prepareTerrainRoadSupport({terrainGeometry:result.geometry,topology:'triangulated'});assert.ok(result.stats.outputTriangles>result.stats.sourceTriangles);support.dispose();result.geometry.dispose();source.dispose();
});

test('the production path hands a refined noisy terrain to the road consumer without moving a protected corridor',()=>{
 const source=createHeightFieldGeometry(T,{sample:(x,z)=>({height:.08*x+.04*z+.2*Math.sin(x*.17)*Math.cos(z*.13),dx:.08+.034*Math.cos(x*.17)*Math.cos(z*.13),dz:.04-.026*Math.sin(x*.17)*Math.sin(z*.13)})},{sizeX:40,sizeZ:40,segmentsX:40,segmentsZ:40});
 const roadFootprint=rect(-15,-2.5,15,2.5),oldRoad=createTerrainRoadSource(T,{terrainGeometry:source,surfaces:[{outer:roadFootprint,holes:[]}],thickness:.15});
 const refined=api.createConstrainedTerrainGeometry(T,{terrainGeometry:source,constraints:[rect(-18,-12,10,14)],protectedRegions:[roadFootprint],heightAt:({x,z,baseHeight})=>baseHeight+.3*Math.max(0,1-Math.abs(x+4)/20)});
 const support=prepareTerrainRoadSupport({terrainGeometry:refined.geometry,topology:'triangulated'}),newRoad=createTerrainRoadSource(T,{terrainSupport:support,surfaces:[{outer:roadFootprint,holes:[]}],thickness:.15});
 for(const [x,z]of [[-13,-1.7],[-4,0],[11,1.9]]){near(ray(newRoad.geometry,x,z),ray(oldRoad.geometry,x,z));near(newRoad.query(x,z).topHeight,oldRoad.query(x,z).topHeight);}
 assert.ok(refined.stats.outputTriangles>refined.stats.sourceTriangles);newRoad.dispose();support.dispose();refined.dispose();oldRoad.dispose();source.dispose();
});

test('input validation and work budgets fail before mutating the borrowed source',()=>{
 const source=make(),before=[...source.attributes.position.array];
 assert.throws(()=>api.createConstrainedTerrainGeometry(T,{terrainGeometry:source,constraints:[[[0,0],[1,1],[0,1],[1,0]]]}),/convex/i);
 assert.throws(()=>api.createConstrainedTerrainGeometry(T,{terrainGeometry:source,constraints:[rect(-3,-1,-1,1)],maxWorkUnits:1}),/maxWorkUnits/i);
 assert.throws(()=>api.createConstrainedTerrainGeometry(T,{terrainGeometry:source,constraints:[rect(-3,-1,-1,1)],maxOutputTriangles:1}),/maxOutputTriangles/i);
 assert.deepEqual([...source.attributes.position.array],before);source.dispose();
});

function awaitRoad(terrain,area){return createTerrainRoadSource(T,{terrainGeometry:terrain,surfaces:[{outer:area}],thickness:.15});}
