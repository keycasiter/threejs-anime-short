import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWorldLayout} from '../../assets/scene/world-layout.mjs';
import {allocateActivityGroups} from '../../assets/scene/activity-distribution.mjs';
import {createActivityDistributionExample} from '../../assets/examples/activity-distribution-example.mjs';

const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
function world(){
 return compileWorldLayout({
  levels:[{id:'ground',y:0,nodes:[],edges:[]}],
  regions:[{id:'district',level:'ground',role:'public',outline:rect(-10,-10,10,10)}]
 });
}
function candidate(id,x,z,{regionId='district',level='ground',clearance=0,minY=0,maxY=2}={}){
 return {id,footprints:[{id:`${id}/body`,regionId,level,polygon:rect(x-1,z-1,x+1,z+1),clearance,minY,maxY}]};
}

test('allocates complete spatial groups in stable priority order, skipping invalid and occupied candidates',()=>{
 const layout=world(),groups=[
  {id:'north-exhibit',priority:10,candidates:[candidate('blocked',-4,0),candidate('exhibit-a',0,4)]},
  {id:'west-work',priority:20,candidates:[candidate('outside',10.2,0),candidate('work-a',-4,0)]},
 ];
 const result=allocateActivityGroups({layout,groups});
 assert.equal(result.status,'complete');
 assert.deepEqual(result.assignments.map(a=>[a.groupId,a.candidateId]),[['west-work','work-a'],['north-exhibit','exhibit-a']]);
});

test('does not commit a partial world when a required activity group has no legal candidate',()=>{
 const result=allocateActivityGroups({layout:world(),groups:[
  {id:'first',priority:0,candidates:[candidate('first-at-center',0,0)]},
  {id:'second',priority:0,candidates:[candidate('overlap-center',0,0)],required:true},
 ]});
 assert.equal(result.status,'unsatisfied');
 assert.deepEqual(result.assignments,[]);
 assert.deepEqual(result.unassignedGroupIds,['second']);
 assert.equal(result.diagnostics[0].code,'group-overlap');
});

test('vertical clearance separates stacked groups while same-level volume overlap rejects',()=>{
 const result=allocateActivityGroups({layout:world(),groups:[
  {id:'lower',candidates:[candidate('lower',0,0,{maxY:2})]},
  {id:'upper',candidates:[candidate('upper',0,0,{minY:2.2,maxY:4})]},
  {id:'same-level',candidates:[candidate('same-level',0,0,{minY:1.8,maxY:3})],required:false},
 ]});
 assert.equal(result.status,'complete');
 assert.deepEqual(result.assignments.map(a=>a.groupId),['lower','upper']);
 assert.deepEqual(result.unassignedGroupIds,['same-level']);
});

test('rejects an unbounded candidate batch before scanning it',()=>{
 const groups=[{id:'too-many',candidates:Array.from({length:5},(_,i)=>candidate(`c${i}`,i,0))}];
 assert.throws(()=>allocateActivityGroups({layout:world(),groups,limits:{maxCandidates:4}}),/maxCandidates/);
});

test('rejects sparse group and candidate lists instead of treating holes as missing content',()=>{
 const sparseGroups=new Array(1);
 assert.throws(()=>allocateActivityGroups({layout:world(),groups:sparseGroups}),/dense/);
 const sparseCandidates=new Array(1);
 assert.throws(()=>allocateActivityGroups({layout:world(),groups:[{id:'incomplete',candidates:sparseCandidates}]}),/dense/);
});

test('the published multi-zone example executes the same reusable allocator',()=>{
 const result=createActivityDistributionExample();
 assert.equal(result.status,'complete');
 assert.deepEqual(result.assignments.map(a=>a.groupId),['primary-destination','secondary-destination']);
 assert.equal(result.assignments[1].candidateId,'candidate-c');
 assert.deepEqual(result.assignments[0].payload,{frame:{origin:[-2,0],yawRadians:0},memberIds:['member-a','member-b']});
});

test('returns a detached immutable candidate payload for the geometry handoff',()=>{
 const payload={frame:{origin:[2,4],yawRadians:.5},memberIds:['frame','panel']};
 const result=allocateActivityGroups({layout:world(),groups:[{id:'assembled-zone',candidates:[{...candidate('candidate-a',0,0),payload}]}]});
 assert.deepEqual(result.assignments[0].payload,{frame:{origin:[2,4],yawRadians:.5},memberIds:['frame','panel']});
 payload.frame.origin[0]=99;
 assert.deepEqual(result.assignments[0].payload.frame.origin,[2,4]);
 assert.ok(Object.isFrozen(result.assignments[0].payload.frame.origin));
});
