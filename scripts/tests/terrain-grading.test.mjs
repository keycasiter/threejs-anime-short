import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHeightFieldGeometry} from '../../assets/environment/height-field.mjs';
import {createConstrainedTerrainGeometry} from '../../assets/environment/constrained-terrain.mjs';
import {prepareTerrainRoadSupport,createTerrainRoadSource,samplePreparedTerrainSurface} from '../../assets/environment/terrain-roads.mjs';
import {compileTerrainGradeField} from '../../assets/environment/constrained-height-field.mjs';

const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const field=()=>createHeightFieldGeometry(T,{sample:(x,z)=>({height:.08*x+.025*z+.08*Math.sin(x*.3)*Math.cos(z*.2),dx:.08+.024*Math.cos(x*.3)*Math.cos(z*.2),dz:.025-.016*Math.sin(x*.3)*Math.sin(z*.2)})},{sizeX:40,sizeZ:40,segmentsX:40,segmentsZ:40});
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('a convex level zone reaches a hard datum and eases continuously to the source surface',()=>{
 const base=field(),support=prepareTerrainRoadSupport({terrainGeometry:base}),grade=compileTerrainGradeField({zones:[{id:'pad',outline:rect(-4,-3,4,3),targetHeight:2.25,transitionWidth:6}]});
 const sample=(x,z)=>samplePreparedTerrainSurface(support,x,z).height;
 near(grade.heightAt({x:0,z:0,baseHeight:sample(0,0)}),2.25);
 near(grade.heightAt({x:4,z:0,baseHeight:sample(4,0)}),2.25);
 const baseline=sample(7,0),middle=grade.heightAt({x:7,z:0,baseHeight:baseline});near(middle,(baseline+2.25)/2,1e-6);
 near(grade.heightAt({x:10,z:0,baseHeight:sample(10,0)}),sample(10,0));
 assert.equal(grade.diagnostics.status,'ACCEPTED');assert.equal(grade.constraints.length,1);
 support.dispose();base.dispose();
});

test('different hard datums with intersecting transition envelopes fail as UNSAT; equal datums can merge',()=>{
 const zones=[{id:'west',outline:rect(-5,-3,-1,3),targetHeight:1,transitionWidth:4},{id:'east',outline:rect(1,-3,5,3),targetHeight:3,transitionWidth:4}];
 const unsat=compileTerrainGradeField({zones});assert.equal(unsat.diagnostics.status,'UNSAT');assert.equal(unsat.diagnostics.conflicts[0].kind,'overlapping-grade-transitions');assert.throws(()=>unsat.heightAt({x:0,z:0,baseHeight:0}),/UNSAT/);
 const accepted=compileTerrainGradeField({zones:zones.map(z=>({...z,targetHeight:1}))});assert.equal(accepted.diagnostics.status,'ACCEPTED');assert.ok(accepted.heightAt({x:0,z:0,baseHeight:7})<1.1);
});

test('protected regions retain source heights and suppress the grade before the protected edge',()=>{
 const grade=compileTerrainGradeField({zones:[{id:'pad',outline:rect(-2,-2,2,2),targetHeight:4,transitionWidth:10}],protectedRegions:[{id:'road',outline:rect(7,-4,11,4),transitionWidth:3}]});
 const base=1;
 near(grade.heightAt({x:7,z:0,baseHeight:base}),base);
 const values=[5,6,7].map(x=>grade.heightAt({x,z:0,baseHeight:base}));
 assert.ok(values[0]>base&&values[0]<4);assert.ok(values[1]>base&&values[1]<values[0]);assert.equal(values[2],base);
});

test('grade cores cannot overlap protected envelopes or unequal grade cores',()=>{
 const overlap=compileTerrainGradeField({zones:[{id:'pad',outline:rect(0,0,4,4),targetHeight:2,transitionWidth:2}],protectedRegions:[{id:'old-lot',outline:rect(3,1,5,3),transitionWidth:1}]});
 assert.equal(overlap.diagnostics.status,'UNSAT');assert.equal(overlap.diagnostics.conflicts[0].kind,'grade-core-intersects-protected-envelope');
 const hard=compileTerrainGradeField({zones:[{id:'a',outline:rect(0,0,3,3),targetHeight:1,transitionWidth:1},{id:'b',outline:rect(2,1,4,4),targetHeight:2,transitionWidth:1}]});
 assert.equal(hard.diagnostics.status,'UNSAT');
 const abrupt=compileTerrainGradeField({zones:[{id:'pad',outline:rect(0,0,2,2),targetHeight:1,transitionWidth:5}],protectedRegions:[{id:'legacy-ground',outline:rect(6,0,8,2)}]});
 assert.equal(abrupt.diagnostics.status,'UNSAT');assert.equal(abrupt.diagnostics.conflicts[0].kind,'grade-transition-meets-unfaded-protected-region');
});

test('final conforming terrain carries pads while preserving old road and occupied ground',()=>{
 const source=field(),pad=rect(-7.25,-5.25,3.25,5.25),oldLot=rect(-18,-8,-12,8),roadArea=rect(8,-3,16,3);
 const grade=compileTerrainGradeField({zones:[{id:'level-pad',outline:pad,targetHeight:2.1,transitionWidth:5}],protectedRegions:[{id:'old-lot',outline:oldLot,transitionWidth:1},{id:'old-road',outline:roadArea,transitionWidth:2}]});
 assert.equal(grade.diagnostics.status,'ACCEPTED');
 const originalRoad=createTerrainRoadSource(T,{terrainGeometry:source,surfaces:[{outer:roadArea,holes:[]}],thickness:.18});
 const result=createConstrainedTerrainGeometry(T,{terrainGeometry:source,constraints:grade.constraints,protectedRegions:grade.protectedRegions,heightAt:grade.heightAt});
 const support=prepareTerrainRoadSupport({terrainGeometry:result.geometry,topology:'triangulated'}),originalSupport=prepareTerrainRoadSupport({terrainGeometry:source}),editedRoad=createTerrainRoadSource(T,{terrainSupport:support,surfaces:[{outer:roadArea,holes:[]}],thickness:.18});
 near(samplePreparedTerrainSurface(support,-2,0).height,2.1,2e-6);
 for(const [x,z] of [[-17,-7],[-15,0],[-13,7]])near(samplePreparedTerrainSurface(support,x,z).height,samplePreparedTerrainSurface(originalSupport,x,z).height,2e-5);
 for(const [x,z] of [[9,-2],[10,0],[12,2],[15,-1]])near(editedRoad.query(x,z).topHeight,originalRoad.query(x,z).topHeight,2e-5);
 assert.ok(result.stats.outputTriangles>result.stats.sourceTriangles);assert.equal(result.stats.protectedRegionCount,2);
 editedRoad.dispose();support.dispose();originalSupport.dispose();result.dispose();originalRoad.dispose();source.dispose();
});

test('malformed or ambiguous grade input rejects before a mesh is allocated',()=>{
 assert.throws(()=>compileTerrainGradeField({zones:[{id:'bad',outline:[[0,0],[2,2],[0,2],[2,0]],targetHeight:1,transitionWidth:2}]}),/convex|zero area/i);
 assert.throws(()=>compileTerrainGradeField({zones:[{id:'bad',outline:rect(0,0,2,2),targetHeight:1,transitionWidth:0}]}),/transitionWidth/i);
 assert.throws(()=>compileTerrainGradeField({zones:[{id:'same',outline:rect(0,0,2,2),targetHeight:1,transitionWidth:1}],protectedRegions:[{id:'same',outline:rect(4,0,6,2)}]}),/unique/i);
});
