import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateVisualFinish} from '../validate-visual-finish.mjs';

function fixture(){
 const run={assetFamilies:[
  {id:'hero',name:'Primary structure',role:'focal',requiredFeatures:[
   {id:'silhouette',description:'Full silhouette reads at scene scale',targetCheckpointIds:['hero','rear']},
   {id:'support',description:'Support contact remains visible',targetCheckpointIds:['rear']}
  ]},
  {id:'environment',name:'Environment family',role:'context',requiredFeatures:[
   {id:'depth',description:'Near/mid/far layers remain distinct',targetCheckpointIds:['hero']}
  ]}
 ]};
 const evidence={checkpoints:[{id:'hero'},{id:'rear'}],assetFamilyReviews:[
  {familyId:'hero',featureChecks:[
   {featureId:'silhouette',status:'clear',checkpointIds:['hero','rear'],observation:'Silhouette holds in both views.'},
   {featureId:'support',status:'clear',checkpointIds:['rear'],observation:'Support contact reads from the rear.'}
  ]},
  {familyId:'environment',featureChecks:[
   {featureId:'depth',status:'clear',checkpointIds:['hero'],observation:'All spatial layers remain distinguishable.'}
  ]}
 ]};
 return{run,evidence};
}

test('accepts a complete family and required-feature handoff across target views',()=>{
 const result=validateVisualFinish(...Object.values(fixture()));
 assert.equal(result.valid,true);assert.equal(result.visualStatus,'pass');assert.equal(result.familyCount,2);assert.deepEqual(result.errors,[]);
});

test('rejects an omitted visible family and an omitted required feature',()=>{
 const {run,evidence}=fixture();evidence.assetFamilyReviews.pop();
 let result=validateVisualFinish(run,evidence);assert.ok(result.errors.some(error=>error.includes('missing asset family review environment')));
 evidence.assetFamilyReviews[0].featureChecks.pop();
 result=validateVisualFinish(run,evidence);assert.ok(result.errors.some(error=>error.includes('missing featureCheck support')));
});

test('rejects evidence that skips a required complementary view',()=>{
 const {run,evidence}=fixture();evidence.assetFamilyReviews[0].featureChecks[0].checkpointIds=['hero'];
 const result=validateVisualFinish(run,evidence);assert.ok(result.errors.some(error=>error.includes('target checkpoint rear was not reviewed')));
});

test('keeps defect evidence valid while failing the visual status',()=>{
 const {run,evidence}=fixture();evidence.assetFamilyReviews[0].featureChecks[1].status='issue';evidence.assetFamilyReviews[0].featureChecks[1].observation='The rear foot floats above the plinth.';
 const result=validateVisualFinish(run,evidence);assert.equal(result.valid,true);assert.equal(result.visualStatus,'issues');assert.ok(result.visualIssues.some(issue=>issue.includes('floats above the plinth')));
});

test('CLI visual-pass mode succeeds only for complete clear family evidence',async()=>{
 const {run,evidence}=fixture(),root=await mkdtemp(path.join(os.tmpdir(),'threejs-visual-finish-'));
 try{
  await mkdir(path.join(root,'qa'),{recursive:true});
  await writeFile(path.join(root,'run.json'),JSON.stringify(run));
  const evidencePath=path.join(root,'qa/visual-evidence.json');
  await writeFile(evidencePath,JSON.stringify(evidence));
  let result=spawnSync(process.execPath,['scripts/validate-visual-finish.mjs','--require-visual-pass',root],{encoding:'utf8'});
  assert.equal(result.status,0);assert.match(result.stdout,/VALID asset-family coverage: 2 families; visual pass/);
  evidence.assetFamilyReviews[0].featureChecks[1].status='issue';
  evidence.assetFamilyReviews[0].featureChecks[1].observation='The rear foot does not touch the plinth.';
  await writeFile(evidencePath,JSON.stringify(evidence));
  result=spawnSync(process.execPath,['scripts/validate-visual-finish.mjs','--require-visual-pass',root],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stdout,/visual issues/);
 }finally{await rm(root,{recursive:true,force:true});}
});
