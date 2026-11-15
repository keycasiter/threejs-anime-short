import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateControlledCohort} from '../../evals/validate-controlled-cohort.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tasks=JSON.parse(await readFile(path.join(root,'evals/current/tasks.json'),'utf8')).tasks;
const hash=s=>createHash('sha256').update(s).digest('hex');
const baselineSkillHash='a'.repeat(64),currentSkillHash='b'.repeat(64),systemHash='c'.repeat(64);
const promptHashes=Object.fromEntries(tasks.map(t=>[t.id,hash(t.prompt)]));
function makeRun(task,condition,replicate,patch={}){
 return {schemaVersion:1,evaluationId:'controlled-r187-test',runId:`${task.id}-${condition}-r${replicate}`,taskId:task.id,condition,replicate,
  promptSha256:promptHashes[task.id],skillBundleSha256:condition==='baseline'?baselineSkillHash:currentSkillHash,
  generator:{provider:'openai',name:'gpt-6-test',version:'2026-11-build-1',executionSurface:'codex-test',systemInstructionSha256:systemHash},
  sampling:{temperature:0.2,topP:0.9,seed:replicate,maxOutputTokens:16000},
  tools:[{name:'threejs-runtime',version:'0.187.0',permissions:['read-workspace','write-run-output']}],
  limits:{wallClockSeconds:1800,maxTurns:40},
  environment:{os:'macOS-test',nodeVersion:'22.22.3',threeVersion:'0.187.0',browser:'Chromium',browserVersion:'157.0',actualViewportCss:[1280,720],devicePixelRatio:1,rendererBackend:'WebGL2',networkPolicy:'offline'},
  contextPolicy:{cleanContext:true,priorRunsVisible:false,previousOutputsVisible:false,hiddenRubricVisible:false},...patch};
}
function cohort(){return tasks.flatMap(t=>[1,2].flatMap(rep=>['baseline','current'].map(c=>makeRun(t,c,rep))));}
const opts={taskIds:tasks.map(t=>t.id),baselineSkillHash,currentSkillHash,promptHashes,runsPerTask:2};

test('accepts a complete 12-task, two-replicate cohort with identical paired execution factors',()=>{
 const result=validateControlledCohort(cohort(),opts);assert.equal(result.valid,true);assert.equal(result.causalEligible,true);assert.equal(result.runCount,48);assert.deepEqual(result.errors,[]);
});

test('rejects a missing task-condition-replicate slot',()=>{
 const runs=cohort().slice(1),result=validateControlledCohort(runs,opts);assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.includes('missing paired slot')));
});

test('rejects mismatched generator or tool settings within a matched pair',()=>{
 const runs=cohort();runs.find(r=>r.runId==='ENV-S-current-r1').generator.version='other-build';
 const result=validateControlledCohort(runs,opts);assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.includes('generator, sampling, tools, limits, runtime or context differ')));
});

test('rejects cross-task execution-profile drift and mixed evaluation IDs',()=>{
 const runs=cohort();
 for(const condition of ['baseline','current'])runs.find(r=>r.runId===`ENV-S-${condition}-r1`).generator.name='different-model';
 let result=validateControlledCohort(runs,opts);assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.includes('differ across the cohort')));
 const mixed=cohort();mixed.find(r=>r.runId==='ENV-S-current-r1').evaluationId='other-evaluation';
 result=validateControlledCohort(mixed,opts);assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.includes('share one evaluationId')));
});

test('accepts explicit unavailable settings as descriptive-only and never causal',()=>{
 const runs=cohort();for(const r of runs)r.sampling.seed='not-exposed';
 const result=validateControlledCohort(runs,opts);assert.equal(result.valid,true);assert.equal(result.causalEligible,false);assert.ok(result.informational.some(e=>e.includes('sampling.seed is not exposed')));
});

test('requires the cohort config to declare a fixed generator profile before causal eligibility',()=>{
 const result=validateControlledCohort(cohort(),{...opts,modelControlled:false});
 assert.equal(result.valid,true);assert.equal(result.causalEligible,false);
 assert.ok(result.informational.some(e=>e.includes('does not declare a fixed generator model')));
});

test('treats tool and permission lists as sets when comparing paired runs',()=>{
 const runs=cohort();
 runs.forEach((r,i)=>r.tools.push({name:'browser',version:'157',permissions:i%2?['navigate','screenshot']:['screenshot','navigate']}));
 const result=validateControlledCohort(runs,opts);assert.equal(result.valid,true);assert.equal(result.causalEligible,true);
});

test('rejects an incorrect prompt hash or Skill condition mapping',()=>{
 const runs=cohort();runs.find(r=>r.runId==='ENV-S-current-r2').promptSha256='d'.repeat(64);
 const result=validateControlledCohort(runs,opts);assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.includes('prompt hash does not match')));
});
