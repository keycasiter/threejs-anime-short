import test from 'node:test';
import assert from 'node:assert/strict';
import {extractVideoSamples, validateVideoProbe} from '../video-contract.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const spec = {width: 1280, height: 720, fps: 24, totalFrames: 192, audioMode: 'none'};
function probe(overrides = {}) {
  return {streams: [{codec_type: 'video', width: 1280, height: 720, avg_frame_rate: '24/1', nb_frames: '192', duration: '8', ...overrides}]};
}

test('accepts an MP4 that matches the declared frame, size, rate, duration, and audio contract', () => {
  assert.equal(validateVideoProbe(probe(), spec), true);
});

test('rejects mismatched video dimensions, frame rate, frame count, or duration', () => {
  for (const overrides of [
    {width: 1920},
    {avg_frame_rate: '30/1'},
    {nb_frames: '191'},
    {duration: '7.95'},
  ]) assert.throws(() => validateVideoProbe(probe(overrides), spec));
});

test('rejects silent exports with audio and WAV exports without a correctly timed AAC input stream', () => {
  const withAudio = {...probe(), streams: [...probe().streams, {codec_type: 'audio', sample_rate: '22050', duration: '8'}]};
  assert.throws(() => validateVideoProbe(withAudio, spec), /unexpectedly contains an audio stream/);

  const wavSpec = {...spec, audioMode: 'wav'};
  const validWav = {...probe(), streams: [...probe().streams, {codec_type: 'audio', sample_rate: '22050', duration: '8'}]};
  assert.equal(validateVideoProbe(validWav, wavSpec), true);
  assert.throws(() => validateVideoProbe(probe(), wavSpec), /Expected one encoded audio stream/);
  const wav = {...probe(), streams: [...probe().streams, {codec_type: 'audio', sample_rate: '44100', duration: '8'}]};
  assert.throws(() => validateVideoProbe(wav, wavSpec), /sample rate 44100 does not match 22050/);
  const shortWav = {...probe(), streams: [...probe().streams, {codec_type: 'audio', sample_rate: '22050', duration: '6'}]};
  assert.throws(() => validateVideoProbe(shortWav, wavSpec), /audio duration 6 does not match/);
});

test('extracts representative PNG samples from the encoded timeline and hashes the actual bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'encoded-video-samples-'));
  const calls = [];
  const fakeCommand = async (_bin, args) => {
    calls.push(args);
    const output = args.at(-1);
    const png = Buffer.alloc(24);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
    png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(1280, 16); png.writeUInt32BE(720, 20);
    await writeFile(output, png);
    return '';
  };
  try {
    const samples = await extractVideoSamples('/tmp/final.mp4', dir, {
      duration: 8, fps: 24, width: 1280, height: 720, times: [0, 4, 8], command: fakeCommand,
    });
    assert.deepEqual(samples.map(sample => sample.id), ['opening', 'quarter-1', 'midpoint', 'quarter-3', 'ending']);
    assert.equal(samples.at(-1).t, 191 / 24, 'ending sample must point at the last encoded frame, not duration');
    assert.equal(calls.length, 5);
    for (const sample of samples) {
      const bytes = await readFile(join(dir, sample.file));
      assert.equal(sample.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(sample.width, 1280); assert.equal(sample.height, 720);
    }
    assert.ok(calls.every(args => args.includes('/tmp/final.mp4')));
  } finally { await rm(dir, {recursive:true,force:true}); }
});

test('rejects an extracted encoded sample with a different size or non-PNG output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'encoded-video-invalid-'));
  try {
    await assert.rejects(extractVideoSamples('/tmp/final.mp4', dir, {
      duration: 1, fps: 24, width: 1280, height: 720, command: async (_bin,args) => {
        await writeFile(args.at(-1), Buffer.from('not png')); return '';
      },
    }), /not a valid PNG/);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
