// audio.js — a procedural score, generated from the storyboard.
//
// No audio files: the bed is synthesised from the scene moods, which keeps the app a
// zero-asset static site and means the music changes when you re-cut the story. The
// whole timeline is scheduled up front (a Short is 60 seconds, so that is a few hundred
// nodes) — that way playback and the recorded mix stay sample-accurate without a
// look-ahead scheduler fighting the render loop.

// Semitone offsets from the root, per mood, plus tempo and character.
const MR_SCORES = {
  tense:   { root: 46, scale: [0, 1, 3, 5, 7, 8, 10], bpm: 104, wave: 'sawtooth', pad: 0.16, pluck: 0.11, chords: [[0, 3, 7], [0, 3, 8], [-2, 1, 5], [0, 3, 7]] },
  dark:    { root: 43, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 78,  wave: 'triangle', pad: 0.2,  pluck: 0.06, chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7]] },
  action:  { root: 48, scale: [0, 2, 3, 5, 7, 9, 10], bpm: 124, wave: 'square',   pad: 0.1,  pluck: 0.14, chords: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [0, 3, 7]] },
  wonder:  { root: 52, scale: [0, 2, 4, 7, 9], bpm: 84,        wave: 'triangle', pad: 0.22, pluck: 0.1,  chords: [[0, 4, 7], [2, 5, 9], [-3, 0, 4], [0, 4, 7]] },
  joyful:  { root: 55, scale: [0, 2, 4, 5, 7, 9, 11], bpm: 112, wave: 'triangle', pad: 0.18, pluck: 0.13, chords: [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [2, 5, 9]] },
  sad:     { root: 45, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 68,  wave: 'sine',     pad: 0.24, pluck: 0.07, chords: [[0, 3, 7], [-4, 0, 3], [-5, -1, 2], [0, 3, 7]] },
  calm:    { root: 50, scale: [0, 2, 4, 7, 9], bpm: 72,        wave: 'sine',     pad: 0.24, pluck: 0.08, chords: [[0, 4, 7], [-3, 0, 4], [2, 5, 9], [0, 4, 7]] },
  neutral: { root: 50, scale: [0, 2, 4, 5, 7, 9, 11], bpm: 90,  wave: 'triangle', pad: 0.2,  pluck: 0.1,  chords: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [0, 4, 7]] }
};

const mrAudio = {
  ctx: null,
  master: null,
  music: null,     // the generated score
  voice: null,     // narration
  streamNode: null,
  nodes: [],       // everything scheduled, so stop() can cut it dead
  playing: false
};

function mrMidiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

// The AudioContext can only be created inside a user gesture on most browsers, so this
// is called lazily from play/record rather than at boot.
function mrAudioEnsure() {
  if (mrAudio.ctx) return mrAudio.ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  mrAudio.ctx = new Ctx();
  mrAudio.master = mrAudio.ctx.createGain();
  mrAudio.master.gain.value = 0.5;
  // The score and the narration are separate buses so the music can drop under a line
  // of speech and come back up after it — which is the difference between a score and
  // a thing you have to talk over.
  mrAudio.music = mrAudio.ctx.createGain();
  mrAudio.music.gain.value = 1;
  mrAudio.music.connect(mrAudio.master);
  mrAudio.voice = mrAudio.ctx.createGain();
  mrAudio.voice.gain.value = 1;
  mrAudio.voice.connect(mrAudio.master);
  // Gentle limiter so a dense scene can never clip the recording.
  const comp = mrAudio.ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 6;
  mrAudio.master.connect(comp);
  comp.connect(mrAudio.ctx.destination);
  if (mrAudio.ctx.createMediaStreamDestination) {
    mrAudio.streamNode = mrAudio.ctx.createMediaStreamDestination();
    comp.connect(mrAudio.streamNode);
  }
  return mrAudio.ctx;
}

function mrAudioStream() {
  mrAudioEnsure();
  return mrAudio.streamNode ? mrAudio.streamNode.stream : null;
}

function mrAudioVolume(value) {
  if (mrAudio.master) mrAudio.master.gain.value = Math.max(0, Math.min(1, value));
}

// One plucked/padded voice. `shape` picks the envelope: pads swell, plucks snap.
function mrVoice(midi, startAt, duration, gainValue, wave, shape) {
  const ctx = mrAudio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = shape === 'pad' ? 900 : 2600;
  filter.Q.value = shape === 'pad' ? 0.7 : 1.2;
  osc.type = wave;
  osc.frequency.value = mrMidiToHz(midi);
  // A touch of detune keeps two identical voices from phasing into a single thin tone.
  osc.detune.value = (midi % 3) * 4 - 4;
  const attack = shape === 'pad' ? Math.min(0.9, duration * 0.35) : 0.008;
  const release = shape === 'pad' ? Math.min(1.4, duration * 0.6) : Math.min(0.5, duration * 0.9);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), startAt + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(attack + 0.02, duration - release) + release);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(mrAudio.music);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.1);
  mrAudio.nodes.push(osc);
}

// A filtered noise burst — the "whoosh" on a cut and the soft impact on a title card.
function mrNoise(startAt, duration, gainValue, sweepFrom, sweepTo) {
  const ctx = mrAudio.ctx;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(sweepFrom, startAt);
  filter.frequency.exponentialRampToValueAtTime(sweepTo, startAt + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(mrAudio.music);
  src.start(startAt);
  mrAudio.nodes.push(src);
}

// Turn the storyboard into a note list. Pure — exported for tests and for the "what will
// this sound like" summary in the UI.
function scoreFor(project) {
  const events = [];
  const times = sceneTimeline(project);
  const forced = project.audio && project.audio.mood && project.audio.mood !== 'auto' ? project.audio.mood : null;
  project.scenes.forEach((scene, i) => {
    const mood = forced || scene.mood || 'neutral';
    const score = MR_SCORES[mood] || MR_SCORES.neutral;
    const start = times[i].start;
    const end = times[i].end;
    const chord = score.chords[i % score.chords.length];
    // Pad: the chord held for the whole scene, an octave low.
    for (const note of chord) {
      events.push({ type: 'pad', midi: score.root + note - 12, at: start, dur: Math.max(0.6, end - start), gain: score.pad, wave: score.wave });
    }
    // Pluck: an arpeggio on the beat, walking the mood's scale.
    const beat = 60 / score.bpm;
    let step = 0;
    for (let t = start + beat; t < end - 0.15; t += beat) {
      const degree = score.scale[(step * 2 + i) % score.scale.length];
      const octave = step % 4 === 0 ? 12 : 0;
      events.push({ type: 'pluck', midi: score.root + degree + octave, at: t, dur: beat * 0.9, gain: score.pluck, wave: score.wave });
      step++;
    }
    if (project.audio && project.audio.accents && i > 0) {
      events.push({ type: 'whoosh', at: Math.max(0, start - 0.18), dur: 0.5, gain: scene.transition === 'cut' ? 0.14 : 0.09 });
    }
  });
  return events;
}

// Schedule the score from `fromSeconds` onward. Returns false when there is no audio
// support or the bed is switched off, so callers can carry on silently.
function mrAudioPlay(project, fromSeconds) {
  mrAudioStop();
  // The score can be off while narration is on — the voice is still the audio track.
  const scoreOn = !!(project.audio && project.audio.enabled);
  const hasNarration = project.scenes.some((s) => s.narration);
  if (!scoreOn && !hasNarration) return false;
  const ctx = mrAudioEnsure();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume();
  mrAudioVolume(project.audio.volume != null ? project.audio.volume : 0.5);
  const origin = ctx.currentTime + 0.08;
  const from = fromSeconds || 0;
  for (const e of (scoreOn ? scoreFor(project) : [])) {
    if (e.at + e.dur < from) continue;
    const at = origin + Math.max(0, e.at - from);
    const dur = e.at < from ? e.dur - (from - e.at) : e.dur;
    if (dur <= 0.05) continue;
    if (e.type === 'whoosh') mrNoise(at, dur, e.gain, 200, 3000);
    else mrVoice(e.midi, at, dur, e.gain, e.wave, e.type);
  }
  mrScheduleNarration(project, origin, from);
  mrAudio.playing = true;
  return true;
}

// Play each scene's narration at its place on the timeline, and duck the score around it.
// Called from mrAudioPlay so narration is part of the same graph the recorder captures —
// the reason this app does not use browser speech synthesis, which cannot be recorded.
function mrScheduleNarration(project, origin, from) {
  if (typeof narrationBuffer !== 'function') return;
  const settings = Object.assign({ duckMusic: 0.3 }, project.narration);
  if (settings.enabled === false) return;
  const ctx = mrAudio.ctx;
  const times = sceneTimeline(project);
  const duck = Math.max(0, Math.min(1, 1 - (settings.duckMusic != null ? settings.duckMusic : 0.3)));
  let spoke = false;

  project.scenes.forEach((scene, i) => {
    const buffer = narrationBuffer(scene.id);
    if (!buffer) return;
    const start = times[i].start;
    const end = start + buffer.duration;
    if (end < from) return;
    const offset = Math.max(0, from - start);
    const at = origin + Math.max(0, start - from);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(mrAudio.voice);
    source.start(at, offset);
    mrAudio.nodes.push(source);
    spoke = true;

    // Fade the score down just before the line and back up just after, rather than
    // stepping it, which is audible as a click.
    const gain = mrAudio.music.gain;
    gain.setTargetAtTime(duck, Math.max(ctx.currentTime, at - 0.12), 0.06);
    gain.setTargetAtTime(1, at + (buffer.duration - offset) + 0.05, 0.25);
  });
  if (!spoke) mrAudio.music.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
}

function mrAudioStop() {
  // Cancel any ducking still scheduled, or the next play would start under a fade.
  if (mrAudio.music && mrAudio.ctx) {
    try {
      mrAudio.music.gain.cancelScheduledValues(mrAudio.ctx.currentTime);
      // cancelScheduledValues does not undo a ramp already under way, and a value
      // scheduled at `currentTime` is not necessarily applied by the time anything reads
      // it back. Assigning .value is immediate and leaves no ramp running.
      mrAudio.music.gain.value = 1;
    } catch { /* context already closed */ }
  }
  for (const node of mrAudio.nodes) {
    try { node.stop(0); } catch { /* already stopped — fine */ }
    try { node.disconnect(); } catch { /* ditto */ }
  }
  mrAudio.nodes = [];
  mrAudio.playing = false;
}

// A one-off click for UI feedback (scene selected, export finished).
function mrAudioTick(kind) {
  const ctx = mrAudioEnsure();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const at = ctx.currentTime + 0.01;
  mrVoice(kind === 'ok' ? 76 : 69, at, 0.12, 0.05, 'sine', 'pluck');
}
