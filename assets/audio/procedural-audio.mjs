/** Small Web Audio sound layer for code-generated scenes.
 * AudioContext is created only from an explicit start() call (normally a user
 * gesture). The caller owns this handle; no scene, DOM or Three.js dependency.
 */
export function createProceduralAudio({
  AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  destination = null,
  ambientFrequency = 110,
  ambientGain = 0.018,
  filterFrequency = 520,
  maxVoices = 12
} = {}) {
  if (!Number.isFinite(ambientFrequency) || ambientFrequency <= 0 ||
      !Number.isFinite(ambientGain) || ambientGain < 0 || ambientGain > 1 ||
      !Number.isFinite(filterFrequency) || filterFrequency <= 0 || !Number.isInteger(maxVoices) || maxVoices < 1) {
    throw new Error('Invalid ambient audio settings');
  }

  let context = null, master = null, ambient = null, filter = null;
  let started = false, muted = false, disposed = false;
  const active = new Set(), voices = new Set();
  function alive() { if (disposed) throw new Error('Audio handle disposed'); }
  function ensureContext() {
    alive();
    if (!context) {
      if (typeof AudioContextCtor !== 'function') throw new Error('Web Audio API is unavailable');
      context = new AudioContextCtor();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(destination ?? context.destination);
      filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFrequency;
      filter.connect(master);
    }
    return context;
  }
  function setParam(param, value, time, ramp = 0.012) {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, ramp);
  }
  async function start() {
    const ctx = ensureContext();
    if (!started) {
      ambient = ctx.createOscillator();
      ambient.type = 'sine';
      ambient.frequency.value = ambientFrequency;
      const envelope = ctx.createGain();
      envelope.gain.value = ambientGain;
      ambient.connect(envelope);
      envelope.connect(filter);
      ambient.start();
      active.add(ambient); active.add(envelope);
      started = true;
    }
    if (ctx.state === 'suspended') await ctx.resume();
    return readState();
  }
  async function trigger({frequency = 440, duration = 0.22, gain = 0.12,
    position = [0, 0, -1], wave = 'triangle', when} = {}) {
    if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(gain) || gain < 0 || gain > 1 || !Array.isArray(position) ||
        position.length !== 3 || !position.every(Number.isFinite) ||
        !['sine', 'triangle', 'square', 'sawtooth'].includes(wave) ||
        (when !== undefined && !Number.isFinite(when))) {
      throw new Error('Invalid cue settings');
    }
    if (voices.size >= maxVoices) throw new Error('Audio voice limit reached');
    const ctx = ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const now = when ?? ctx.currentTime;
    if (now < ctx.currentTime) throw new Error('Cue time must not be in the past');
    const oscillator = ctx.createOscillator(), envelope = ctx.createGain();
    const panner = ctx.createPanner();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    if (panner.positionX) {
      panner.positionX.value = position[0]; panner.positionY.value = position[1]; panner.positionZ.value = position[2];
    } else panner.setPosition(...position);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), now + Math.min(0.025, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope); envelope.connect(panner); panner.connect(master);
    const nodes = [oscillator, envelope, panner];
    nodes.forEach(node => active.add(node));voices.add(oscillator);
    oscillator.onended = () => {
      voices.delete(oscillator);
      for (const node of nodes) { active.delete(node); try { node.disconnect(); } catch {} }
    };
    oscillator.start(now); oscillator.stop(now + duration + 0.01);
    return {frequency, duration, position: [...position], wave, audioTime: now};
  }
  async function triggerNoise({duration = 0.32, gain = 0.1, position = [0, 0, -1],
    seed = 1, filterFrequency = 1400, when} = {}) {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(gain) || gain < 0 || gain > 1 ||
        !Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) ||
        !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isFinite(filterFrequency) || filterFrequency <= 0 ||
        (when !== undefined && !Number.isFinite(when))) throw new Error('Invalid noise cue settings');
    if (voices.size >= maxVoices) throw new Error('Audio voice limit reached');
    const ctx = ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const now = when ?? ctx.currentTime;
    if (now < ctx.currentTime) throw new Error('Cue time must not be in the past');
    const frameCount = Math.max(1, Math.ceil(duration * ctx.sampleRate));
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate), data = buffer.getChannelData(0);
    let randomState = seed >>> 0;
    for (let i = 0; i < frameCount; i++) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      data[i] = randomState / 0x80000000 - 1;
    }
    const source = ctx.createBufferSource(), envelope = ctx.createGain(), panner = ctx.createPanner(), filter = ctx.createBiquadFilter();
    source.buffer = buffer;filter.type = 'lowpass';filter.frequency.value = filterFrequency;
    panner.panningModel = 'HRTF';panner.distanceModel = 'inverse';
    if (panner.positionX) {panner.positionX.value = position[0];panner.positionY.value = position[1];panner.positionZ.value = position[2];}
    else panner.setPosition(...position);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), now + Math.min(0.025, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(envelope);envelope.connect(panner);panner.connect(filter);filter.connect(master);
    const nodes = [source, envelope, panner, filter];nodes.forEach(node => active.add(node));voices.add(source);
    source.onended = () => {voices.delete(source);for (const node of nodes) {active.delete(node);try {node.disconnect();} catch {}}};
    source.start(now);source.stop(now + duration + 0.01);
    return {duration, position: [...position], seed, audioTime: now, samples: frameCount};
  }
  function setMuted(value) {
    alive(); if (typeof value !== 'boolean') throw new Error('muted must be boolean');
    muted = value;
    if (master && context) setParam(master.gain, muted ? 0 : 0.7, context.currentTime);
    return muted;
  }
  async function pause() {
    alive(); if (context?.state === 'running') await context.suspend();
    return readState();
  }
  async function resume() {
    alive(); if (!context) return readState();
    if (context.state === 'suspended') await context.resume();
    return readState();
  }
  function readState() {
    return {started, muted, disposed, contextState: context?.state ?? 'not-created', activeNodes: active.size, activeVoices: voices.size, maxVoices};
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    for (const node of active) {
      try { if (node === ambient) node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    }
    active.clear();
    voices.clear();
    if (context && context.state !== 'closed') await context.close();
    ambient = filter = master = null;
  }
  return {start, trigger, triggerNoise, setMuted, pause, resume, readState, dispose};
}
