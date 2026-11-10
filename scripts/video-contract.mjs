import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export function rateValue(value) {
  const parts = String(value ?? '').split('/').map(Number);
  return parts.length === 1 ? parts[0] : parts[0] / parts[1];
}

function planVideoSamples({duration, fps, times = []}) {
  const totalFrames = Math.ceil(duration * fps);
  if (!Number.isInteger(totalFrames) || totalFrames < 1) throw Error('Encoded sample plan requires a positive frame count');
  const lastFrame = totalFrames - 1;
  const indexes = new Map();
  for (const [id, frame] of [
    ['opening', 0], ['quarter-1', Math.round(lastFrame * .25)], ['midpoint', Math.round(lastFrame * .5)],
    ['quarter-3', Math.round(lastFrame * .75)], ['ending', lastFrame],
  ]) if (!indexes.has(frame)) indexes.set(frame, id);
  let custom = 0;
  for (const time of times) {
    if (!Number.isFinite(time) || time < 0) throw Error(`Invalid encoded sample time: ${time}`);
    const frame = Math.min(lastFrame, Math.max(0, Math.round(time * fps)));
    if (!indexes.has(frame)) indexes.set(frame, `requested-${String(++custom).padStart(3, '0')}`);
  }
  return [...indexes].sort(([a], [b]) => a - b).map(([frame, id], index) => ({
    id, frame, t: frame / fps, file: `video-frame-${String(index).padStart(3, '0')}.png`,
  }));
}

async function runCommand(file, args) {
  const proc = spawn(file, args, {stdio: ['ignore', 'ignore', 'pipe']});
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
  const code = await new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', resolve);
  });
  if (code !== 0) throw Error(`${file} exited with ${code}: ${stderr}`);
  return '';
}

export async function extractVideoSamples(videoPath, outputDir, {duration, fps, width, height, times = [], ffmpeg = 'ffmpeg', command = runCommand} = {}) {
  const plan = planVideoSamples({duration, fps, times});
  await mkdir(outputDir, {recursive: true});
  const samples = [];
  for (const sample of plan) {
    const path = join(outputDir, sample.file);
    await command(ffmpeg, ['-y', '-v', 'error', '-ss', sample.t.toFixed(6), '-i', videoPath, '-frames:v', '1', path]);
    const bytes = await readFile(path);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      throw Error(`Encoded sample ${sample.id} is not a valid PNG`);
    }
    const sampleWidth = bytes.readUInt32BE(16), sampleHeight = bytes.readUInt32BE(20);
    if (sampleWidth !== width || sampleHeight !== height) throw Error(`Encoded sample ${sample.id} dimensions ${sampleWidth}x${sampleHeight} do not match ${width}x${height}`);
    samples.push({...sample, width: sampleWidth, height: sampleHeight, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  return samples;
}

export function validateVideoProbe(probe, {width, height, fps, totalFrames, audioMode}) {
  const streams = probe?.streams ?? [];
  const videoStreams = streams.filter(stream => stream.codec_type === 'video');
  const audioStreams = streams.filter(stream => stream.codec_type === 'audio');
  if (videoStreams.length !== 1) throw Error(`Expected one encoded video stream, got ${videoStreams.length}`);
  const video = videoStreams[0];
  const rate = rateValue(video.avg_frame_rate || video.r_frame_rate);
  if (video.width !== width || video.height !== height) throw Error(`Encoded video dimensions ${video.width}x${video.height} do not match ${width}x${height}`);
  if (!Number.isFinite(rate) || Math.abs(rate - fps) > 1e-6) throw Error(`Encoded video frame rate ${video.avg_frame_rate || video.r_frame_rate} does not match ${fps}`);
  if (Number(video.nb_frames) !== totalFrames) throw Error(`Encoded video frame count ${video.nb_frames} does not match ${totalFrames}`);
  const expectedDuration = totalFrames / fps;
  const actualDuration = Number(video.duration);
  if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - expectedDuration) > Math.max(1e-6, .01 / fps)) {
    throw Error(`Encoded video duration ${video.duration} does not match ${expectedDuration}`);
  }
  if (audioMode === 'none' && audioStreams.length !== 0) throw Error('Encoded video unexpectedly contains an audio stream');
  if (audioMode === 'wav') {
    if (audioStreams.length !== 1) throw Error(`Expected one encoded audio stream, got ${audioStreams.length}`);
    const audio = audioStreams[0];
    if (Number(audio.sample_rate) !== 22050) throw Error(`Encoded audio sample rate ${audio.sample_rate} does not match 22050`);
    const audioDuration = Number(audio.duration);
    if (!Number.isFinite(audioDuration) || Math.abs(audioDuration - expectedDuration) > 1 / fps) {
      throw Error(`Encoded audio duration ${audio.duration} does not match video duration ${expectedDuration}`);
    }
  }
  return true;
}
