#!/usr/bin/env node
// Recheck an existing render_film export. This verifies files and encoded
// samples; visual quality, motion continuity, and sound still need review.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {validateVideoProbe} from './video-contract.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const fail = message => { throw Error(message); };
function packagePath(base,value,label) {
  if (typeof value !== 'string' || !value.trim() || isAbsolute(value)) fail(`${label} must be relative to its export directory`);
  const path = resolve(base,value), rel = relative(base,path);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) fail(`${label} must be relative to its export directory`);
  return path;
}
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function command(bin,args) {
  const result = spawnSync(bin,args,{maxBuffer:64*1024*1024});
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${bin} failed: ${result.stderr?.toString().trim().slice(-6000) || result.signal || result.status}`);
  return result.stdout;
}

try {
  const [argument,...extra] = process.argv.slice(2);
  if (!argument || extra.length) fail('Usage: node verify_video.mjs <render_film manifest.json>');
  const manifestPath = resolve(argument), base = dirname(manifestPath);
  const report = JSON.parse(await readFile(manifestPath,'utf8'));
  if (!report || report.status !== 'PASS') fail('Export report status must be PASS');
  const {width,height,fps,duration,audioMode,videoArtifact,videoSamples} = report;
  if (![width,height].every(value => Number.isSafeInteger(value) && value > 0)) fail('Export width and height must be positive integers');
  if (![fps,duration].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) fail('Export fps and duration must be positive finite numbers');
  const totalFrames = Math.ceil(duration*fps);
  if (!Number.isSafeInteger(totalFrames)) fail('Export frame count must be a safe integer');
  if (!['none','wav'].includes(audioMode)) fail('Export audioMode must be none or wav');
  const videoPath = packagePath(base,videoArtifact?.path,'videoArtifact.path');
  if (!hashPattern.test(videoArtifact.sha256) || await fileHash(videoPath) !== videoArtifact.sha256) fail('videoArtifact SHA-256 mismatch');
  const probe = JSON.parse(command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',videoPath]).toString());
  validateVideoProbe(probe,{width,height,fps,totalFrames,audioMode});
  if (!Array.isArray(videoSamples) || !videoSamples.length) fail('Export requires non-empty videoSamples');
  const ids = new Set(), frames = new Set();
  for (const sample of videoSamples) {
    const label = `sample ${sample?.id ?? '?'}`;
    if (typeof sample?.id !== 'string' || !sample.id.trim() || ids.has(sample.id)) fail(`${label} requires a unique non-empty id`);
    ids.add(sample.id);
    if (!Number.isInteger(sample.frame) || sample.frame < 0 || sample.frame >= totalFrames || frames.has(sample.frame)) fail(`${label} requires a unique encoded frame in range`);
    frames.add(sample.frame);
    if (typeof sample.t !== 'number' || !Number.isFinite(sample.t) || sample.t < 0 || sample.t >= totalFrames/fps || Math.abs(sample.t-sample.frame/fps) > 1e-6) fail(`${label} time must match its encoded frame`);
    const path = packagePath(join(base,'video-samples'),sample.file,`${label}.file`);
    const bytes = await readFile(path);
    if (!hashPattern.test(sample.sha256) || sha256(bytes) !== sample.sha256) fail(`${label} SHA-256 mismatch`);
    if (bytes.length < 24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii',12,16) !== 'IHDR') fail(`${label} is not a PNG`);
    if (bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height || sample.width !== width || sample.height !== height) fail(`${label} dimensions must match the encoded video`);
    const decoded = command('ffmpeg',['-v','error','-ss',sample.t.toFixed(6),'-i',videoPath,'-frames:v','1','-f','image2pipe','-vcodec','png','-']);
    if (sha256(decoded) !== sample.sha256) fail(`${label} does not match a frame independently decoded from the final MP4`);
  }
  console.log(JSON.stringify({status:'PASS',report:manifestPath,video:videoPath,samplesVerified:videoSamples.length,width,height,fps,totalFrames,audioMode},null,2));
} catch (error) {
  console.error(JSON.stringify({status:'FAIL',error:error.message},null,2));
  process.exitCode = 1;
}
