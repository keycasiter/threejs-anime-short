import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tasks=JSON.parse(await readFile(path.join(root,'evals/current/tasks.json'),'utf8')).tasks;
const script=path.join(root,'evals/analyze-blind-comparison.mjs');
function fixture(reviewer,{missingScore=false,missingEvidence=false,missingCoverage=false}={}){
 const candidateMapping=Object.fromEntries(tasks.map(t=>[t.id,['A','B','C','D'].map(x=>`${t.id}-${x}`)]));
 const records=Object.fromEntries(tasks.map(t=>[t.id,{A:{scores:[0,0,0,0,0],evidence:Array(5).fill('baseline evidence')},B:{scores:[1,1,1,1,1],evidence:Array(5).fill('baseline evidence')},C:{scores:[2,2,2,2,2],evidence:Array(5).fill('current evidence')},D:{scores:[3,3,3,3,3],evidence:Array(5).fill('current evidence')},coverage:{A:'完整',B:'完整',C:'完整',D:'完整'}}]));
 if(missingScore)records[tasks[0].id].D.scores[0]='';
 if(missingEvidence)records[tasks[0].id].D.evidence[0]='';
 if(missingCoverage)delete records[tasks[0].id].coverage.D;
 return {schemaVersion:1,reviewer,reviewType:'blind current-vs-baseline visual review',threeVersion:'0.187.0',candidateMapping,records};
}
async function run(fixtures,acceptance=true){
 const dir=await mkdtemp(path.join(tmpdir(),'blind-review-test-'));
 try{
  const files=[];
  for(let i=0;i<fixtures.length;i++){const file=path.join(dir,`review-${i}.json`);await writeFile(file,JSON.stringify(fixtures[i]));files.push(file);}
  const result=spawnSync(process.execPath,[script,...(acceptance?['--acceptance']:[]),...files],{encoding:'utf8'});
  return {status:result.status,stdout:JSON.parse(result.stdout),stderr:result.stderr};
 }finally{await rm(dir,{recursive:true,force:true});}
}

test('formal acceptance passes only with three complete and evidenced independent reviews',async()=>{
 const result=await run(['review-a','review-b','review-c'].map(id=>fixture(id)));
 assert.equal(result.status,0);assert.equal(result.stdout.acceptanceGate.status,'PASS');
 assert.equal(result.stdout.reviewerCount,3);assert.equal(result.stdout.completeReviewers.length,3);
 assert.equal(result.stdout.acceptanceGate.blockers.length,0);
 assert.equal(result.stdout.interpretation.notCausal,true);
});

test('formal acceptance rejects fewer than three reviewers',async()=>{
 const result=await run([fixture('review-a'),fixture('review-b')]);
 assert.equal(result.status,1);assert.equal(result.stdout.acceptanceGate.status,'INCOMPLETE');
 assert.match(result.stdout.acceptanceGate.blockers.join('\n'),/at least 3 independent reviewers/);
});

test('formal acceptance reports missing scores, evidence and coverage as separate blockers',async()=>{
 const result=await run([
  fixture('review-a',{missingScore:true}),
  fixture('review-b',{missingEvidence:true}),
  fixture('review-c',{missingCoverage:true})
 ]);
 assert.equal(result.status,1);assert.equal(result.stdout.acceptanceGate.status,'INCOMPLETE');
 const blockers=result.stdout.acceptanceGate.blockers.join('\n');
 assert.match(blockers,/review-a: scored 11\/12 tasks/);
 assert.match(blockers,/review-b: fully evidenced 11\/12 tasks/);
 assert.match(blockers,/review-c: recorded coverage for 11\/12 tasks/);
});

test('exploration mode keeps partial data visible without calling it accepted',async()=>{
 const result=await run([fixture('review-a',{missingScore:true})],false);
 assert.equal(result.status,0);assert.equal(result.stdout.acceptanceGate.status,'INCOMPLETE');
 assert.equal(result.stdout.acceptanceGate.required,false);
});
