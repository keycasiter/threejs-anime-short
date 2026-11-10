export function rateValue(value) {
  const parts = String(value ?? '').split('/').map(Number);
  return parts.length === 1 ? parts[0] : parts[0] / parts[1];
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
