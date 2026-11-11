import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {extractVideoSamples} from '../video-contract.mjs';

// Removing artifact hashing, real probing, or independent decoding must make
// the corresponding tamper case fail. Fixtures use actual tiny encoded MP4s.
const cli = fileURLToPath(new URL('../verify_video.mjs', import.meta.url));
const available = ['ffmpeg','ffprobe'].every(bin => spawnSync(bin,['-version']).status === 0);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function command(bin,args) {
  const result = spawnSync(bin,args,{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr || result.error?.message);
  return result.stdout;
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(),'verify-video-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const video = join(dir,'film.mp4');
  command('ffmpeg',['-y','-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=8:d=1','-frames:v','8','-c:v','libx264','-pix_fmt','yuv420p','-an',video]);
  const videoSamples = await extractVideoSamples(video,join(dir,'video-samples'),{duration:1,fps:8,width:160,height:90});
  const manifest = {status:'PASS',sourceHash:'a'.repeat(64),html:'/original/source.html',width:160,height:90,fps:8,duration:1,audioMode:'none',
    videoArtifact:{path:'film.mp4',sha256:sha256(await readFile(video))},videoSamples};
  const path = join(dir,'manifest.json');
  const save = () => writeFile(path,JSON.stringify(manifest));
  await save();
  return {dir,video,manifest,path,save};
}
function verify(path,...args) { return spawnSync(process.execPath,[cli,path,...args],{encoding:'utf8'}); }
function rejected(result,pattern) {
  assert.notEqual(result.status,0);
  const report = JSON.parse(result.stderr);
  assert.equal(report.status,'FAIL');
  assert.match(report.error,pattern);
}

test('verifies a real encoded film and its sample PNGs without stage records or original HTML', {skip:!available}, async t => {
  const f = await fixture(t);
  const result = verify(f.path);
  assert.equal(result.status,0,result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status,'PASS');
  assert.equal(report.samplesVerified,f.manifest.videoSamples.length);
});

test('rejects changed MP4 bytes before accepting an old export report', {skip:!available}, async t => {
  const f = await fixture(t);
  await writeFile(f.video,'tampered video');
  rejected(verify(f.path),/videoArtifact.*SHA-256 mismatch/);
});

test('probes the actual MP4 rather than trusting declared or stored metadata', {skip:!available}, async t => {
  const f = await fixture(t);
  f.manifest.width = 320;
  f.manifest.video = {streams:[{codec_type:'video',width:320,height:90}]};
  await f.save();
  rejected(verify(f.path),/Encoded video dimensions/);
});

test('rejects a stored sample whose bytes changed', {skip:!available}, async t => {
  const f = await fixture(t);
  const sample = f.manifest.videoSamples[0];
  await writeFile(join(f.dir,'video-samples',sample.file),'tampered PNG');
  rejected(verify(f.path),/sample.*SHA-256 mismatch/);
});

test('rejects a self-consistent sample hash that belongs to another encoded time', {skip:!available}, async t => {
  const f = await fixture(t);
  const first = f.manifest.videoSamples[0], last = f.manifest.videoSamples.at(-1);
  assert.notEqual(first.sha256,last.sha256,'fixture must have visibly different time samples');
  await copyFile(join(f.dir,'video-samples',last.file),join(f.dir,'video-samples',first.file));
  first.sha256 = last.sha256;
  await f.save();
  rejected(verify(f.path),/sample.*does not match.*decoded.*MP4/);
});

test('rejects incomplete reports, invalid timeline samples, and escaped package paths', {skip:!available}, async t => {
  const f = await fixture(t);
  const original = structuredClone(f.manifest);
  const cases = [
    [m => {m.status = 'FAIL';}, /status.*PASS/],
    [m => {m.videoSamples = [];}, /non-empty videoSamples/],
    [m => {m.videoSamples[0].t = 1;}, /sample.*time/],
    [m => {m.videoSamples[0].frame = -1;}, /sample.*frame/],
    [m => {m.videoArtifact.path = '../film.mp4';}, /videoArtifact.*relative.*directory/],
    [m => {m.videoSamples[0].file = '../../sample.png';}, /sample.*relative.*directory/],
    [m => {m.audioMode = 'unknown';}, /audioMode/],
  ];
  for (const [mutate,pattern] of cases) {
    Object.keys(f.manifest).forEach(key => delete f.manifest[key]);
    Object.assign(f.manifest,structuredClone(original));
    mutate(f.manifest); await f.save();
    rejected(verify(f.path),pattern);
  }
  rejected(verify(f.path,'--unexpected'),/Usage:/);
});
