import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {artifactFingerprint, expectedCheckpointIds, validateVisualEvidence} from './validate-visual-evidence.mjs';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nXcAAAAASUVORK5CYII=','base64');
const taskDocument=JSON.parse(await readFile(new URL('./current/tasks.json',import.meta.url),'utf8'));
const taskMap=new Map(taskDocument.tasks.map(task=>[task.id,task]));

async function fixture(taskId='ENV-S'){
 const task=taskMap.get(taskId),root=await mkdtemp(path.join(os.tmpdir(),'threejs-visual-evidence-'));
 await mkdir(path.join(root,'qa/visual-evidence'),{recursive:true});
 const files={'index.html':'<canvas></canvas>','src/scene.js':'export {};','qa/visual-evidence/capture.png':png};
 if(taskId.startsWith('CINE'))files['dist/final.mp4']='hashed final video';
 for(const [relative,contents] of Object.entries(files)){const target=path.join(root,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,contents);}
 const sha256=Object.fromEntries(Object.entries(files).filter(([relative])=>!relative.startsWith('qa/')).map(([relative,contents])=>[relative,hash(Buffer.isBuffer(contents)?contents:Buffer.from(contents))]));
 const run={runId:`${taskId}-test`,taskId,rendered:true,sourceFiles:['src/scene.js'],sha256,actualViewport:[1280,720],pixelRatio:1};
 const runBytes=Buffer.from(JSON.stringify(run,null,2)+'\n');await writeFile(path.join(root,'run.json'),runBytes);
 const checkpointIds=expectedCheckpointIds(task);
 const checkpoints=checkpointIds.map(id=>({id,reproduction:`Set view ${id}.`,capture:{path:'qa/visual-evidence/capture.png',sha256:hash(png)},outcome:'clear',observation:`Observed ${id}.`}));
 const requirementCoverage=[...(task.mustShow??[]).map(text=>({kind:'mustShow',text,status:'met',checkpointIds:[checkpointIds[0]],observation:'Observed in the cited view.'})),...(task.notAllowed??[]).map(text=>({kind:'notAllowed',text,status:'met',checkpointIds:[checkpointIds[0]],observation:'Checked and not present.'}))];
 const interactionChecks=(task.observationSet==='filmLoop'?[]:task.observationSet==='mechanismStates'?['orbit-360','play-pause','state-seek','reset']:['orbit-360','zoom','reset']).map(action=>({action,status:'works',checkpointIds:[checkpointIds[0]],observation:`${action} completed.`}));
 const evidence={schemaVersion:1,runId:run.runId,taskId,observationSet:task.observationSet,runManifestSha256:hash(runBytes),artifactFingerprint:artifactFingerprint(sha256),viewportCss:[1280,720],devicePixelRatio:1,runtime:{browser:'Chromium',browserVersion:'test',rendererBackend:'WebGL2'},reviewStatus:'complete',checkpoints,requirementCoverage,visualFindings:Object.fromEntries(['composition','space','formMiddle','detailDistribution','materialsLighting'].map(dimension=>[dimension,{finding:`Reviewed ${dimension}.`,checkpointIds:[checkpointIds[0]]}])),interactionChecks,unresolvedIssues:[]};
 if(task.observationSet==='filmLoop')evidence.fullPlayback={complete:true,videoPath:'dist/final.mp4',transitions:['last-to-first loop seam','camera pose continuity','moving object continuity','water/particle continuity'].map(name=>({name,status:'clear',observation:`Reviewed ${name}.`,checkpointIds:[checkpointIds[0]]}))};
 await writeFile(path.join(root,'qa/visual-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
 return{root,run,evidence,cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('accepts complete orbit evidence bound to the rendered run and frozen observations',async()=>{
 const f=await fixture();try{const result=await validateVisualEvidence(f.root);assert.equal(result.status,'valid');assert.equal(result.checkpointCount,11);assert.equal(result.interactionCount,3);}finally{await f.cleanup();}
});

test('accepts mechanism view/state evidence and covers every frozen observation contract',async()=>{
 const f=await fixture('MECH-S');try{const result=await validateVisualEvidence(f.root);assert.equal(result.status,'valid');assert.equal(result.checkpointCount,10);assert.equal(result.interactionCount,4);}finally{await f.cleanup();}
 const sets=new Set(taskDocument.tasks.map(task=>task.observationSet));
 for(const observationSet of sets){const task=taskDocument.tasks.find(candidate=>candidate.observationSet===observationSet),ids=expectedCheckpointIds(task);assert.ok(ids.length>0);assert.equal(new Set(ids).size,ids.length,`${observationSet} checkpoint IDs must be unique`);}
 assert.deepEqual(expectedCheckpointIds(taskMap.get('NAT-S')),expectedCheckpointIds(taskMap.get('ENV-S')),'nature scenes reuse the shared environment orbit contract');
});

test('reports missing evidence as pending and acceptance rejects it at the CLI boundary',async()=>{
 const f=await fixture();try{await rm(path.join(f.root,'qa/visual-evidence.json'));const result=await validateVisualEvidence(f.root);assert.equal(result.status,'pending');const cli=spawnSync(process.execPath,['evals/validate-visual-evidence.mjs','--acceptance',f.root],{cwd:repoRoot,encoding:'utf8'});assert.equal(cli.status,1);assert.match(cli.stdout,/SUMMARY: 0 valid, 1 pending, 0 invalid/);}finally{await f.cleanup();}
});

test('rejects malformed top-level JSON objects and empty acceptance inputs',async()=>{
 const f=await fixture();try{await writeFile(path.join(f.root,'qa/visual-evidence.json'),'null');assert.equal((await validateVisualEvidence(f.root)).status,'invalid');const empty=spawnSync(process.execPath,['evals/validate-visual-evidence.mjs','--acceptance',f.root+'/missing'],{cwd:repoRoot,encoding:'utf8'});assert.notEqual(empty.status,0);}finally{await f.cleanup();}
});

test('rejects missing frozen checkpoints, stale run manifests and changed capture bytes',async()=>{
 const f=await fixture();try{
  const complete=structuredClone(f.evidence.checkpoints);
  f.evidence.checkpoints.pop();await writeFile(path.join(f.root,'qa/visual-evidence.json'),JSON.stringify(f.evidence));
  assert.ok((await validateVisualEvidence(f.root)).errors.some(error=>error.includes('missing checkpoint')));
  f.evidence.checkpoints=complete;f.evidence.checkpoints[0].capture.sha256='0'.repeat(64);
  f.evidence.runManifestSha256='0'.repeat(64);await writeFile(path.join(f.root,'qa/visual-evidence.json'),JSON.stringify(f.evidence));
  const result=await validateVisualEvidence(f.root);assert.ok(result.errors.some(error=>error.includes('runManifestSha256')));assert.ok(result.errors.some(error=>error.includes('capture hash mismatch')));
 }finally{await f.cleanup();}
});

test('rejects screenshot symlinks that escape the run directory',async()=>{
 const f=await fixture(),outside=await mkdtemp(path.join(os.tmpdir(),'threejs-evidence-outside-'));
 try{await writeFile(path.join(outside,'capture.png'),png);await symlink(path.join(outside,'capture.png'),path.join(f.root,'qa/visual-evidence/outside.png'));f.evidence.checkpoints[0].capture={path:'qa/visual-evidence/outside.png',sha256:hash(png)};await writeFile(path.join(f.root,'qa/visual-evidence.json'),JSON.stringify(f.evidence));const result=await validateVisualEvidence(f.root);assert.ok(result.errors.some(error=>error.includes('escapes its allowed root')));}finally{await f.cleanup();await rm(outside,{recursive:true,force:true});}
});

test('rejects visual evidence manifests that resolve outside the run directory',async()=>{
 const f=await fixture(),outside=await mkdtemp(path.join(os.tmpdir(),'threejs-evidence-manifest-'));
 try{await writeFile(path.join(outside,'evidence.json'),'{}');await rm(path.join(f.root,'qa/visual-evidence.json'));await symlink(path.join(outside,'evidence.json'),path.join(f.root,'qa/visual-evidence.json'));const result=await validateVisualEvidence(f.root);assert.equal(result.status,'invalid');assert.match(result.errors.join(' '),/escapes its allowed root/);}finally{await f.cleanup();await rm(outside,{recursive:true,force:true});}
});

test('film evidence requires a hashed encoded video and every transition check',async()=>{
 const f=await fixture('CINE-S');try{f.evidence.fullPlayback.transitions.pop();await writeFile(path.join(f.root,'qa/visual-evidence.json'),JSON.stringify(f.evidence));assert.ok((await validateVisualEvidence(f.root)).errors.some(error=>error.includes('missing playback transition check')));}finally{await f.cleanup();}
});
