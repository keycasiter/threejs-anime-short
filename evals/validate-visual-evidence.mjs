#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const evalsRoot=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.dirname(evalsRoot);
const taskDocument=JSON.parse(await readFile(path.join(evalsRoot,'current/tasks.json'),'utf8'));
const taskById=new Map(taskDocument.tasks.map(task=>[task.id,task]));
const sha=/^[a-f0-9]{64}$/i;
const imageSignature={
 png:Buffer.from([137,80,78,71,13,10,26,10]),
 jpeg:Buffer.from([255,216]),
 webp:Buffer.from('RIFF')
};
const dimensions=['composition','space','formMiddle','detailDistribution','materialsLighting'];
const requirementStatuses=new Set(['met','partial','not-met','contradicted']);
const interactionStatuses=new Set(['works','issue']);
const playbackStatuses=new Set(['clear','issue']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const nonempty=value=>typeof value==='string'&&value.trim().length>0;

async function safeResolve(base,relative,allowedRoot=base){
 if(typeof relative!=='string'||!relative||path.isAbsolute(relative))throw new Error('path must be a nonempty relative path');
 const root=await realpath(allowedRoot),resolved=await realpath(path.resolve(base,relative)),rel=path.relative(root,resolved);
 if(rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel))throw new Error('path escapes its allowed root');
 return resolved;
}

function slug(value){return value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}

export function expectedCheckpointIds(task,observationSets=taskDocument.observationSets){
 // Nature is a composable environment module in the frozen route model; its
 // task label predates the shared environment observation contract.
 const set=observationSets[task?.observationSet]??(task?.observationSet==='natureOrbit'?observationSets.environmentOrbit:null);
 if(!set)throw new Error(`unknown observationSet ${String(task?.observationSet)}`);
 if(Array.isArray(set.azimuthDegrees)){
  return ['hero',...set.azimuthDegrees.map(angle=>`azimuth-${String(angle).padStart(3,'0')}`),...(set.additionalViews??[]).map(view=>slug(view.name))];
 }
 if(Array.isArray(set.views)&&Array.isArray(set.stateSamples)){
  return [...set.views.map(view=>`view-${slug(view)}`),...set.stateSamples.map(state=>`state-${slug(state)}`)];
 }
 if(Array.isArray(set.timeFractions))return set.timeFractions.map(fraction=>`time-${String(Math.round(fraction*1000)).padStart(3,'0')}`);
 throw new Error(`observationSet ${task.observationSet} has no supported checkpoint contract`);
}

export function artifactFingerprint(shaMap){
 if(!shaMap||typeof shaMap!=='object'||Array.isArray(shaMap))throw new Error('run.sha256 must be an object');
 const entries=Object.entries(shaMap)
  .filter(([relative])=>relative!=='qa/visual-evidence.json'&&!relative.startsWith('qa/visual-evidence/'))
  .sort(([a],[b])=>a.localeCompare(b));
 if(!entries.length)throw new Error('run.sha256 must contain artifact files');
 for(const [relative,digest] of entries){
  if(!nonempty(relative)||!sha.test(digest))throw new Error(`invalid run.sha256 entry ${relative}`);
 }
 return hash(Buffer.from(entries.map(([relative,digest])=>`${relative}\0${digest}\n`).join('')));
}

function expectedInteractions(task){
 if(task.observationSet==='filmLoop')return [];
 if(task.observationSet==='mechanismStates')return ['orbit-360','play-pause','state-seek','reset'];
 return ['orbit-360','zoom','reset'];
}

function validImage(bytes,relative){
 const ext=path.extname(relative).toLowerCase();
 if(ext==='.png')return bytes.length>=imageSignature.png.length&&bytes.subarray(0,8).equals(imageSignature.png);
 if(ext==='.jpg'||ext==='.jpeg')return bytes.length>=4&&bytes.subarray(0,2).equals(imageSignature.jpeg)&&bytes.subarray(-2).equals(Buffer.from([255,217]));
 if(ext==='.webp')return bytes.length>=12&&bytes.subarray(0,4).equals(imageSignature.webp)&&bytes.subarray(8,12).equals(Buffer.from('WEBP'));
 return false;
}

export async function validateVisualEvidence(runDirectory){
 const runDir=path.resolve(runDirectory),errors=[];
 let run,evidence,runBytes;
 try{runBytes=await readFile(await safeResolve(runDir,'run.json',runDir));run=JSON.parse(runBytes);}catch(error){return{runDirectory:runDir,status:'invalid',errors:[`cannot read run.json (${error.message})`]};}
 if(!run||typeof run!=='object'||Array.isArray(run))return{runDirectory:runDir,status:'invalid',errors:['run.json must contain an object']};
 const label=run.runId||path.basename(runDir);
 const fail=message=>errors.push(`${label}: ${message}`);
 const task=taskById.get(run.taskId);
 if(!nonempty(run.runId))fail('runId is required');
 if(!task)fail(`unknown taskId ${String(run.taskId)}`);
 if(!task)return{runId:label,taskId:run.taskId,status:'invalid',errors};
 try{evidence=JSON.parse(await readFile(await safeResolve(runDir,'qa/visual-evidence.json',runDir),'utf8'));}
 catch(error){
  if(error.code==='ENOENT')return{runId:label,taskId:run.taskId,status:'pending',errors:[],missing:'qa/visual-evidence.json'};
  return{runId:label,taskId:run.taskId,status:'invalid',errors:[`${label}: invalid qa/visual-evidence.json (${error.message})`]};
 }
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))return{runId:label,taskId:run.taskId,status:'invalid',errors:[`${label}: qa/visual-evidence.json must contain an object`]};
 if(run.rendered!==true)fail('visual evidence exists but run.rendered is not true');
 if(evidence.schemaVersion!==1)fail('visual evidence schemaVersion must be 1');
 if(evidence.runId!==run.runId||evidence.taskId!==run.taskId)fail('runId/taskId do not match run.json');
 if(evidence.observationSet!==task.observationSet)fail('observationSet does not match the frozen task');
 if(evidence.runManifestSha256!==hash(runBytes))fail('runManifestSha256 does not match run.json');

 let fingerprint;
 try{fingerprint=artifactFingerprint(run.sha256);}catch(error){fail(error.message);}
 if(fingerprint&&evidence.artifactFingerprint!==fingerprint)fail('artifactFingerprint does not match the frozen run.sha256 map');
 const sourceFiles=['index.html',...(Array.isArray(run.sourceFiles)?run.sourceFiles:[])];
 for(const source of new Set(sourceFiles))if(!run.sha256?.[source])fail(`source file ${source} is absent from run.sha256`);
 if(!Array.isArray(run.actualViewport)||run.actualViewport.length!==2||!run.actualViewport.every(Number.isFinite))fail('run.actualViewport is missing');
 if(!Number.isFinite(run.pixelRatio)||run.pixelRatio<=0)fail('run.pixelRatio must be positive');
 if(JSON.stringify(evidence.viewportCss)!==JSON.stringify(run.actualViewport))fail('viewportCss does not match run.actualViewport');
 if(evidence.devicePixelRatio!==run.pixelRatio)fail('devicePixelRatio does not match run.pixelRatio');
 const runtime=evidence.runtime||{};
 for(const key of ['browser','browserVersion','rendererBackend'])if(!nonempty(runtime[key]))fail(`runtime.${key} is required`);
 if(evidence.reviewStatus!=='complete')fail('reviewStatus must be complete; visual defects belong in findings, not pending status');

 const checkpoints=Array.isArray(evidence.checkpoints)?evidence.checkpoints:[];
 const byId=new Map();
 for(const checkpoint of checkpoints){
  if(!nonempty(checkpoint?.id)||byId.has(checkpoint.id)){fail('checkpoint IDs must be unique and nonempty');continue;}
  byId.set(checkpoint.id,checkpoint);
 }
 let required=[];
 try{required=expectedCheckpointIds(task);}catch(error){fail(error.message);}
 for(const id of required){
  const checkpoint=byId.get(id);
  if(!checkpoint){fail(`missing checkpoint ${id}`);continue;}
  if(!nonempty(checkpoint.reproduction))fail(`checkpoint ${id} needs reproducible view/state/time instructions`);
  if(!nonempty(checkpoint.observation))fail(`checkpoint ${id} needs an observed result`);
  if(!['clear','issue'].includes(checkpoint.outcome))fail(`checkpoint ${id} outcome must be clear or issue`);
  const capture=checkpoint.capture;
  if(!capture||typeof capture.path!=='string'||!sha.test(capture.sha256||'')){fail(`checkpoint ${id} needs capture.path and SHA-256`);continue;}
  try{
   const capturePath=await safeResolve(runDir,capture.path,runDir),bytes=await readFile(capturePath);
   if(hash(bytes)!==capture.sha256)fail(`checkpoint ${id} capture hash mismatch`);
   if(!validImage(bytes,capture.path))fail(`checkpoint ${id} capture is not a valid PNG/JPEG/WebP image`);
  }catch(error){fail(`checkpoint ${id} capture cannot be read (${error.message})`);}
 }
 for(const id of byId.keys())if(!required.includes(id))fail(`unexpected checkpoint ${id}`);

 const coverage=Array.isArray(evidence.requirementCoverage)?evidence.requirementCoverage:[];
 const requiredCoverage=[...(task.mustShow??[]).map(text=>({kind:'mustShow',text})),...(task.notAllowed??[]).map(text=>({kind:'notAllowed',text}))];
 const coverageMap=new Map();
 for(const item of coverage){
  const key=`${item?.kind}\0${item?.text}`;
  if(coverageMap.has(key))fail(`duplicate requirement coverage ${String(item?.text)}`);
  coverageMap.set(key,item);
 }
 for(const expected of requiredCoverage){
  const item=coverageMap.get(`${expected.kind}\0${expected.text}`);
  if(!item){fail(`missing ${expected.kind} coverage: ${expected.text}`);continue;}
  if(!requirementStatuses.has(item.status))fail(`invalid coverage status for ${expected.text}`);
  if(!Array.isArray(item.checkpointIds)||!item.checkpointIds.length||item.checkpointIds.some(id=>!byId.has(id)))fail(`coverage ${expected.text} must cite existing checkpoints`);
  if(!nonempty(item.observation))fail(`coverage ${expected.text} needs an observation`);
 }
 for(const [key] of coverageMap)if(!requiredCoverage.some(item=>`${item.kind}\0${item.text}`===key))fail(`unexpected requirement coverage ${key.replace('\0',': ')}`);

 const findings=evidence.visualFindings||{};
 for(const dimension of dimensions){
  const finding=findings[dimension];
  if(!nonempty(finding?.finding))fail(`visualFindings.${dimension}.finding is required`);
  if(!Array.isArray(finding?.checkpointIds)||!finding.checkpointIds.length||finding.checkpointIds.some(id=>!byId.has(id)))fail(`visualFindings.${dimension} must cite existing checkpoints`);
 }
 if(!Array.isArray(evidence.unresolvedIssues))fail('unresolvedIssues must be an array, including an empty array when none remain');
 else for(const issue of evidence.unresolvedIssues)if(!nonempty(issue))fail('unresolvedIssues entries must be nonempty strings');

 const interactions=Array.isArray(evidence.interactionChecks)?evidence.interactionChecks:[];
 const interactionMap=new Map();
 for(const item of interactions){
  if(!nonempty(item?.action)||interactionMap.has(item.action)){fail('interaction action IDs must be unique and nonempty');continue;}
  interactionMap.set(item.action,item);
 }
 for(const action of expectedInteractions(task)){
  const item=interactionMap.get(action);
  if(!item){fail(`missing interaction check ${action}`);continue;}
  if(!interactionStatuses.has(item.status))fail(`interaction ${action} status must be works or issue`);
  if(!nonempty(item.observation))fail(`interaction ${action} needs an observed result`);
  if(!Array.isArray(item.checkpointIds)||!item.checkpointIds.length||item.checkpointIds.some(id=>!byId.has(id)))fail(`interaction ${action} must cite existing checkpoints`);
 }
 for(const action of interactionMap.keys())if(!expectedInteractions(task).includes(action))fail(`unexpected interaction check ${action}`);

 if(task.observationSet==='filmLoop'){
  const playback=evidence.fullPlayback||{};
  if(playback.complete!==true)fail('fullPlayback.complete must be true only after playing the final encoded video end-to-end');
  if(!nonempty(playback.videoPath)||!run.sha256?.[playback.videoPath])fail('fullPlayback.videoPath must name the hashed final video');
  const requiredTransitions=taskDocument.observationSets.filmLoop.transitionChecks??[];
  const transitionMap=new Map();
  for(const item of Array.isArray(playback.transitions)?playback.transitions:[]){
   if(!nonempty(item?.name)||transitionMap.has(item.name)){fail('playback transition names must be unique and nonempty');continue;}
   transitionMap.set(item.name,item);
  }
  for(const name of requiredTransitions){
   const item=transitionMap.get(name);
   if(!item){fail(`missing playback transition check ${name}`);continue;}
   if(!playbackStatuses.has(item.status))fail(`playback transition ${name} status must be clear or issue`);
   if(!nonempty(item.observation))fail(`playback transition ${name} needs an observation`);
   if(!Array.isArray(item.checkpointIds)||!item.checkpointIds.length||item.checkpointIds.some(id=>!byId.has(id)))fail(`playback transition ${name} must cite existing checkpoints`);
  }
  for(const name of transitionMap.keys())if(!requiredTransitions.includes(name))fail(`unexpected playback transition ${name}`);
 }

 if(errors.length)return{runId:label,taskId:run.taskId,status:'invalid',errors};
 return{runId:label,taskId:run.taskId,status:'valid',errors:[],checkpointCount:required.length,interactionCount:expectedInteractions(task).length};
}

async function collectRunDirectories(inputs){
 const directories=[];
 for(const input of inputs){
  const absolute=path.resolve(input);
  let info;try{info=await stat(absolute);}catch(error){throw new Error(`${input}: ${error.message}`);}
  if(!info.isDirectory())throw new Error(`${input} must be a run directory or directory containing run directories`);
  try{await stat(path.join(absolute,'run.json'));directories.push(absolute);continue;}catch{}
  const entries=await readdir(absolute,{withFileTypes:true});
  for(const entry of entries)if(entry.isDirectory())directories.push(path.join(absolute,entry.name));
 }
 return [...new Set(directories)].sort();
}

async function main(args){
 const requireComplete=args.includes('--acceptance');
 const inputs=args.filter(value=>value!=='--acceptance');
 if(!inputs.length){console.error('Usage: node evals/validate-visual-evidence.mjs [--acceptance] <run-directory-or-run-root> [...]');process.exitCode=2;return;}
 let directories;try{directories=await collectRunDirectories(inputs);}catch(error){console.error(error.message);process.exitCode=2;return;}
 if(!directories.length){console.error('No run directories found');process.exitCode=2;return;}
 const results=[];
 for(const directory of directories)results.push(await validateVisualEvidence(directory));
 for(const result of results){
  if(result.status==='pending')console.log(`PENDING ${result.runId}: ${result.missing}`);
  else if(result.status==='valid')console.log(`VALID ${result.runId}: ${result.checkpointCount} checkpoints, ${result.interactionCount} interactions`);
  else{console.error(`INVALID ${result.runId}:`);for(const error of result.errors)console.error(`- ${error}`);}
 }
 const counts=Object.fromEntries(['valid','pending','invalid'].map(status=>[status,results.filter(result=>result.status===status).length]));
 console.log(`SUMMARY: ${counts.valid} valid, ${counts.pending} pending, ${counts.invalid} invalid`);
 if(counts.invalid||requireComplete&&counts.pending)process.exitCode=1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
