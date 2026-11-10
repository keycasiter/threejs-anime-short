import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVideoProbe} from '../video-contract.mjs';

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
