import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHeightFieldGeometry} from '../../assets/environment/height-field.mjs';
import {createConstrainedTerrainGeometry} from '../../assets/environment/constrained-terrain.mjs';
import {prepareTerrainRoadSupport,samplePreparedTerrainSurface} from '../../assets/environment/terrain-roads.mjs';
import {compileTerrainInterfaceField} from '../../assets/environment/terrain-interface-field.mjs';

const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const flat=(height,normal=[0,1,0])=>({height,normal});
function fixture({targetHeight=1,sourceRevision='terrain-v1',targetRevision='pad-v1'}={}){
 const source={id:'ground',revision:sourceRevision,boundary:[[-3,-2],[3,-2]],protectedRegion:{id:'old-road',outline:rect(-3,-3,3,-2)},sample:(x)=>({...flat(.05*x,[-.05,1,0]),revision:sourceRevision})};
 const target={id:'pad-support',revision:targetRevision,boundary:[[-3,2],[3,2]],zone:{id:'pad',outline:rect(-3,2,3,4),targetHeight},sample:()=>({...flat(targetHeight),revision:targetRevision})};
 const stations=[{from:[-2,-2],to:[-2,2]},{from:[2,-2],to:[2,2]}];
 return {source,target,stations,limits:{maxBoundaryError:.002,maxProfileError:.005,maxLongitudinalGrade:.1,maxCrossSlope:.5,maxBoundaryStep:.002}};
}
const near=(a,b,e=2e-5)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('a bounded interface field creates a conforming terrain connector and preserves protected/target cores',()=>{
 const sourceTerrain=createHeightFieldGeometry(T,{sample:(x)=>({height:.05*x,dx:.05,dz:0})},{sizeX:12,sizeZ:12,segmentsX:24,segmentsZ:24});
 const plan=compileTerrainInterfaceField({id:'road-to-pad',...fixture()});assert.equal(plan.diagnostics.status,'ACCEPTED');assert.ok(plan.diagnostics.cellCount<=128);
 const refined=createConstrainedTerrainGeometry(T,{terrainGeometry:sourceTerrain,constraints:plan.constraints,protectedRegions:plan.protectedRegions,heightAt:plan.heightAt});
 const support=prepareTerrainRoadSupport({terrainGeometry:refined.geometry,topology:'triangulated'});
 near(samplePreparedTerrainSurface(support,0,3).height,1);near(samplePreparedTerrainSurface(support,0,-2.5).height,0);
 assert.ok(samplePreparedTerrainSurface(support,0,0).height>0&&samplePreparedTerrainSurface(support,0,0).height<1);
 support.dispose();refined.dispose();sourceTerrain.dispose();
});

test('stale surface revisions, target datum mismatch, profile error and cell budget fail explicitly',()=>{
 assert.equal(compileTerrainInterfaceField({id:'r',...fixture()}).diagnostics.sourceRevision,'terrain-v1');
 assert.equal(compileTerrainInterfaceField({id:'r',...fixture({targetHeight:2}),limits:{...fixture().limits,maxBoundaryError:.1,maxBoundaryStep:.1}}).diagnostics.status,'UNSAT');
 const tooFew={...fixture(),limits:{...fixture().limits,maxProfileError:1e-7}};
 assert.equal(compileTerrainInterfaceField({id:'r',...tooFew,maxProfileSegments:1}).diagnostics.status,'UNSAT');
 const many={...fixture(),stations:Array.from({length:4},(_,i)=>({from:[-2+i*4/3,-2],to:[-2+i*4/3,2]}))};
 assert.equal(compileTerrainInterfaceField({id:'r',...many,maxCells:1}).diagnostics.status,'UNSAT');
 const stale=fixture();stale.source.sample=()=>({...flat(0),revision:'terrain-v0'});assert.throws(()=>compileTerrainInterfaceField({id:'r',...stale}),/revision is stale/);
});

test('a connector that folds into a protected road or target core is rejected',()=>{
 const input=fixture();input.stations=[{from:[-2,-2],to:[-2,2]},{from:[2,-2],to:[2,1]}];
 assert.equal(compileTerrainInterfaceField({id:'r',...input}).diagnostics.status,'UNSAT');
});
