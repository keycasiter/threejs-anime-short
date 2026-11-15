#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const uniqueStrings=values=>Array.isArray(values)&&values.length>0&&values.every(nonempty)&&new Set(values).size===values.length;

/**
 * Validate that every declared visible asset family and every required feature
 * has an observation record tied to the required rendered checkpoints.
 * This validates coverage and declared outcomes; it does not judge pixels or
 * prove that the inventory contains every visible family in the scene.
 */
export function validateVisualFinish(run,evidence){
 const errors=[],visualIssues=[];
 const fail=message=>errors.push(message);
 const families=run?.assetFamilies;
 const familyReviews=evidence?.assetFamilyReviews;
 const checkpoints=new Set((Array.isArray(evidence?.checkpoints)?evidence.checkpoints:[]).map(item=>item?.id).filter(nonempty));
 if(!Array.isArray(families)||families.length===0)fail('run.assetFamilies must inventory every visible, quality-relevant family');
 if(!Array.isArray(familyReviews))fail('assetFamilyReviews must review every declared asset family');
 const familyById=new Map();
 for(const family of Array.isArray(families)?families:[]){
  if(!nonempty(family?.id)||familyById.has(family.id)){fail('asset family IDs must be unique and nonempty');continue;}
  familyById.set(family.id,family);
  if(!nonempty(family?.name))fail(`asset family ${family.id} needs a readable name`);
  if(!nonempty(family?.role))fail(`asset family ${family.id} needs a scene role`);
  if(!Array.isArray(family?.requiredFeatures)||family.requiredFeatures.length===0){fail(`asset family ${family.id} needs requiredFeatures`);continue;}
  const featureIds=new Set();
  for(const feature of family.requiredFeatures){
   if(!nonempty(feature?.id)||featureIds.has(feature.id)){fail(`asset family ${family.id} feature IDs must be unique and nonempty`);continue;}
   featureIds.add(feature.id);
   if(!nonempty(feature?.description))fail(`${family.id}/${feature.id} needs a visible feature description`);
   if(!uniqueStrings(feature?.targetCheckpointIds))fail(`${family.id}/${feature.id} needs unique targetCheckpointIds`);
   else for(const checkpointId of feature.targetCheckpointIds)if(!checkpoints.has(checkpointId))fail(`${family.id}/${feature.id} references missing checkpoint ${checkpointId}`);
  }
 }
 const reviewById=new Map();
 for(const review of Array.isArray(familyReviews)?familyReviews:[]){
  if(!nonempty(review?.familyId)||reviewById.has(review.familyId)){fail('asset family review IDs must be unique and nonempty');continue;}
  reviewById.set(review.familyId,review);
  if(!familyById.has(review.familyId))fail(`unexpected asset family review ${review.familyId}`);
 }
 for(const [familyId,family] of familyById){
  const review=reviewById.get(familyId);
  if(!review){fail(`missing asset family review ${familyId}`);continue;}
  const expected=new Map((Array.isArray(family.requiredFeatures)?family.requiredFeatures:[]).map(feature=>[feature.id,feature]));
  const checks=Array.isArray(review.featureChecks)?review.featureChecks:[];
  const checkById=new Map();
  for(const check of checks){
   if(!nonempty(check?.featureId)||checkById.has(check.featureId)){fail(`${familyId}: featureCheck IDs must be unique and nonempty`);continue;}
   checkById.set(check.featureId,check);
   if(!expected.has(check.featureId))fail(`${familyId}: unexpected featureCheck ${check.featureId}`);
  }
  for(const [featureId,feature] of expected){
   const check=checkById.get(featureId);
   if(!check){fail(`${familyId}: missing featureCheck ${featureId}`);continue;}
   if(!['clear','issue'].includes(check.status))fail(`${familyId}/${featureId}: status must be clear or issue`);
   if(!nonempty(check.observation))fail(`${familyId}/${featureId}: observation is required`);
   if(!uniqueStrings(check.checkpointIds))fail(`${familyId}/${featureId}: checkpointIds must be a nonempty unique list`);
   else{
    for(const id of check.checkpointIds)if(!checkpoints.has(id))fail(`${familyId}/${featureId}: references missing checkpoint ${id}`);
    for(const id of feature.targetCheckpointIds??[])if(!check.checkpointIds.includes(id))fail(`${familyId}/${featureId}: target checkpoint ${id} was not reviewed`);
   }
   if(check.status==='issue')visualIssues.push(`${familyId}/${featureId}: ${check.observation}`);
  }
 }
 for(const [familyId] of reviewById)if(!familyById.has(familyId))fail(`review references undeclared family ${familyId}`);
 return{valid:errors.length===0,visualStatus:visualIssues.length?'issues':'pass',errors,visualIssues,familyCount:familyById.size};
}

async function main(args){
 const requirePass=args.includes('--require-visual-pass');
 const runDir=path.resolve(args.find(value=>!value.startsWith('--'))||'');
 if(!args.some(value=>!value.startsWith('--'))){console.error('Usage: node scripts/validate-visual-finish.mjs [--require-visual-pass] <run-directory>');process.exitCode=2;return;}
 let run,evidence;
 try{[run,evidence]=await Promise.all([
  readFile(path.join(runDir,'run.json'),'utf8').then(JSON.parse),
  readFile(path.join(runDir,'qa/visual-evidence.json'),'utf8').then(JSON.parse)
 ]);}catch(error){console.error(`Cannot read run/evidence manifests: ${error.message}`);process.exitCode=2;return;}
 const result=validateVisualFinish(run,evidence);
 if(!result.valid){console.error('INVALID asset-family visual finish:');for(const error of result.errors)console.error(`- ${error}`);process.exitCode=1;return;}
 console.log(`VALID asset-family coverage: ${result.familyCount} families; visual ${result.visualStatus}`);
 for(const issue of result.visualIssues)console.log(`- ${issue}`);
 if(requirePass&&result.visualStatus!=='pass')process.exitCode=1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
