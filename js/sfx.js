// sfx.js — the sounds the picture makes.
//
// Two halves, and the split is the whole design:
//
//   1. `sfxCuesFor(project)` turns the reel into a list of {at, kind, gain, pan}. It is
//      pure — no audio, no clock, no randomness that is not seeded — for the same reason
//      renderFrame() is pure: the preview, the recording and the tests all have to agree
//      about when the foot hits the ground.
//   2. The rest of the file is synthesis. Every effect is built from an oscillator and a
//      burst of noise, because a zero-asset app cannot ship a footstep.wav and because a
//      generated step can take its pitch from how big the character is.
//
// The important part is where footsteps come from. They are NOT a timer: they are read off
// the same distance-driven walk cycle the legs are drawn from, sampled on the same grid, so
// the sound lands on the frame the foot lands on. Speed the character up and the steps
// speed up; stop them and the steps stop. That agreement is the only thing separating
// footsteps from a rhythm track.

// Must match the sampling grid in anim.js. Sharing it is what keeps sound and picture on
// the same frame; interpolation inside a step recovers the rest.
const MR_SFX_GRID = 0.05;

// A footfall happens at each stride extreme — a quarter and three quarters through the
// cycle, where one leg is furthest forward.
const MR_FOOTFALL_PHASE = 0.25;

// What a background sounds like when nothing else is happening.
const MR_BACKGROUND_SOUND = {
  forest:   { bed: 'wind', shot: 'bird', every: 2.4 },
  village:  { bed: 'wind', shot: 'bird', every: 4.5 },
  flatland: { bed: 'wind', shot: 'bird', every: 6 },
  city:     { bed: 'city' },
  waves:    { bed: 'sea' },
  rain:     { bed: 'rain' },
  mist:     { bed: 'wind' },
  embers:   { bed: 'wind', shot: 'crackle', every: 0.8 },
  corridor: { bed: 'city' }
};

// Props that make a noise simply by being on stage.
const MR_PROP_SOUND = {
  fire:   { shot: 'crackle', every: 0.4 },
  well:   { shot: 'drip', every: 2.6 },
  cart:   { shot: 'clop', every: 0.85 },
  tree:   { shot: 'bird', every: 3.8 },
  banner: { shot: 'flap', every: 2.4 },
  tower:  { shot: 'bell', every: 9 },
  door:   { shot: 'creak', every: 11 }
};

// What an action sounds like at the moment it begins. Walking is not here: it makes a
// sound per step, not one per decision.
const MR_ACTION_SOUND = {
  fall:  { kind: 'thud', delay: 0.24, gain: 1.2 },
  kneel: { kind: 'rustle', delay: 0.18, gain: 0.9 },
  sit:   { kind: 'rustle', delay: 0.22, gain: 0.8 },
  wave:  { kind: 'rustle', delay: 0.1, gain: 0.35 }
};

const MR_SFX_KINDS = ['step', 'thud', 'rustle', 'crackle', 'drip', 'bird', 'clop', 'flap', 'bell', 'creak'];
const MR_SFX_BEDS = ['wind', 'sea', 'rain', 'city'];

// ---------------------------------------------------------------- the cue list

// Where an actor is, as a stereo position and a loudness: someone small and far upstage is
// quieter and further to one side than someone downstage in the middle.
function mrPlacement(state) {
  const scale = state && state.scale != null ? state.scale : 0.5;
  return {
    pan: Math.max(-1, Math.min(1, ((state && state.x != null ? state.x : 0.5) - 0.5) * 1.6)),
    gain: Math.max(0.25, Math.min(1.4, scale / 0.5))
  };
}

// Every footfall in one scene, for one actor.
function footstepCues(actor, scene) {
  const cues = [];
  const duration = Math.max(0, scene.duration || 0);
  if (!duration) return cues;
  const age = typeof ageOf === 'function' ? ageOf(actor.age) : { pace: 1 };
  // The stride length uses the mid-scene size, the way the drawing uses the current one.
  const track = typeof strideTrack === 'function' ? strideTrack(actor, duration, stateAt(actor, duration / 2)) : null;
  let previous = null;

  for (let i = 0; i * MR_SFX_GRID <= duration + 1e-9; i++) {
    const t = Math.min(duration, i * MR_SFX_GRID);
    const action = typeof actionStartAt === 'function' ? actionStartAt(actor, t).action : stateAt(actor, t).action;
    if (action !== 'walk') { previous = null; continue; }
    // Exactly what posedFor() hands the pose: distance where there is any, and the clock
    // where the character is walking on the spot.
    const travelled = track ? mrTrackAt(track, t) : 0;
    const cycles = travelled > 0.02 ? travelled : t * age.pace * 0.95;
    const phase = cycles * 2 - MR_FOOTFALL_PHASE * 2;
    if (previous != null && Math.floor(phase) > Math.floor(previous.phase)) {
      // Land the step where the crossing actually happened, not on the sample after it.
      const crossed = Math.floor(phase);
      const span = phase - previous.phase;
      const at = span > 0 ? previous.t + (crossed - previous.phase) / span * (t - previous.t) : t;
      const place = mrPlacement(stateAt(actor, at));
      cues.push({
        at, kind: 'step', pan: place.pan,
        // Children patter; a heavy adult lands. Pitch carries that more than volume does.
        gain: place.gain * (actor.age === 'child' ? 0.6 : actor.age === 'youth' ? 0.8 : 1),
        pitch: actor.age === 'child' ? 1.5 : actor.age === 'youth' ? 1.2 : actor.age === 'elder' ? 0.92 : 1
      });
    }
    previous = { t, phase };
  }
  return cues;
}

function mrTrackAt(track, t) {
  if (!track || !track.length) return 0;
  let value = track[0].cycles;
  for (const point of track) {
    if (point.t > t + 1e-9) break;
    value = point.cycles;
  }
  return value;
}

// The moment an action begins is the moment it makes its noise.
function actionCues(actor, scene) {
  const cues = [];
  let current = null;
  for (const key of actor.keys || []) {
    const action = key.action || (typeof MR_DEFAULT_KEY !== 'undefined' ? MR_DEFAULT_KEY.action : 'idle');
    if (action === current) continue;
    const sound = MR_ACTION_SOUND[action];
    current = action;
    if (!sound) continue;
    const at = key.t + sound.delay;
    if (at > (scene.duration || 0)) continue;
    const place = mrPlacement(stateAt(actor, at));
    cues.push({ at, kind: sound.kind, pan: place.pan, gain: place.gain * sound.gain, pitch: 1 });
  }
  return cues;
}

// A sound that repeats across a scene — fire crackling, a bird in a tree. Spaced by a
// seeded jitter so it is irregular but identical on every playback and every render.
function mrRepeatCues(kind, every, from, until, seed, place) {
  const cues = [];
  const random = typeof mrRandom === 'function' ? mrRandom(seed) : () => 0.5;
  let at = from + every * (0.2 + random() * 0.6);
  while (at < until) {
    cues.push({ at, kind, pan: place.pan, gain: place.gain, pitch: 0.85 + random() * 0.4 });
    at += every * (0.55 + random() * 0.9);
  }
  return cues;
}

// The whole reel, as sound. Pure: same project in, same cues out.
function sfxCuesFor(project) {
  const cues = [];
  const times = sceneTimeline(project);

  project.scenes.forEach((scene, i) => {
    const start = times[i].start;
    const duration = Math.max(0, times[i].end - start);
    const seed = (scene.seed || 0) + 41;
    const push = (cue) => {
      if (cue.at >= -0.001 && cue.at <= duration + 0.001) cues.push(Object.assign({}, cue, { at: start + cue.at }));
    };

    // Weather and place, under everything.
    const ambience = MR_BACKGROUND_SOUND[scene.background];
    if (ambience && scene.kind !== 'title') {
      if (ambience.bed) cues.push({ at: start, dur: duration, kind: 'bed', bed: ambience.bed, gain: 1, pan: 0 });
      if (ambience.shot) {
        for (const cue of mrRepeatCues(ambience.shot, ambience.every, 0, duration, seed, { pan: 0.3, gain: 0.5 })) push(cue);
      }
    }

    const stage = scene.stage;
    if (!stage) return;

    for (const actor of stage.actors || []) {
      for (const cue of footstepCues(actor, scene)) push(cue);
      for (const cue of actionCues(actor, scene)) push(cue);
    }

    for (const prop of stage.props || []) {
      const sound = MR_PROP_SOUND[prop.kind];
      if (!sound) continue;
      const place = mrPlacement(stateAt(prop, duration / 2));
      const spot = { pan: place.pan, gain: place.gain * 0.7 };
      for (const cue of mrRepeatCues(sound.shot, sound.every, 0, duration, seed + prop.kind.length, spot)) push(cue);
    }
  });

  return cues.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- synthesis

// One noise buffer, reused by every effect that needs one. Generating two seconds of
// random numbers per footstep is a real cost at thirty steps a scene.
function mrSfxNoise() {
  const ctx = mrAudio.ctx;
  if (!mrAudio.noise || mrAudio.noise.sampleRate !== ctx.sampleRate) {
    const frames = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    mrAudio.noise = buffer;
  }
  return mrAudio.noise;
}

// Where an effect ends up in the stereo field. Older browsers without a panner simply get
// the sound in the middle, which is the right failure.
function mrSfxOut(pan) {
  if (!pan || !mrAudio.ctx.createStereoPanner) return mrAudio.sfx;
  const panner = mrAudio.ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(mrAudio.sfx);
  return panner;
}

// A shaped burst of the shared noise: the body of nearly every effect here.
function mrSfxBurst(at, duration, gainValue, filterType, frequency, q, out, sweepTo) {
  const ctx = mrAudio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = mrSfxNoise();
  src.loop = true;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, at);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), at + duration);
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), at + Math.min(0.012, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  src.connect(filter); filter.connect(gain); gain.connect(out);
  src.start(at);
  src.stop(at + duration + 0.02);
  mrAudio.nodes.push(src);
}

// A pitched blip: the thump under a footstep, the ring of a bell, a bird.
function mrSfxTone(at, duration, gainValue, fromHz, toHz, type, out) {
  const ctx = mrAudio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(fromHz, at);
  if (toHz && toHz !== fromHz) osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), at + duration);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), at + Math.min(0.01, duration * 0.15));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain); gain.connect(out);
  osc.start(at);
  osc.stop(at + duration + 0.02);
  mrAudio.nodes.push(osc);
}

// A bed: the shared noise, looped, filtered and slowly modulated so it breathes instead of
// hissing. Wind gusts, sea swells, rain sits still, a city hums.
function mrSfxBed(kind, at, duration, gainValue) {
  const ctx = mrAudio.ctx;
  const spec = kind === 'sea' ? { type: 'lowpass', freq: 620, q: 0.7, gain: 0.17, rate: 0.14, depth: 0.6 }
    : kind === 'rain' ? { type: 'highpass', freq: 1500, q: 0.5, gain: 0.12, rate: 0.5, depth: 0.15 }
      : kind === 'city' ? { type: 'lowpass', freq: 340, q: 0.6, gain: 0.15, rate: 0.09, depth: 0.25 }
        : { type: 'lowpass', freq: 420, q: 0.8, gain: 0.1, rate: 0.08, depth: 0.5 };

  const src = ctx.createBufferSource();
  src.buffer = mrSfxNoise();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = spec.type;
  filter.frequency.value = spec.freq;
  filter.Q.value = spec.q;
  const gain = ctx.createGain();
  const level = spec.gain * gainValue;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + Math.min(1.2, duration * 0.3));
  gain.gain.setValueAtTime(level, Math.max(at, at + duration - 0.6));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  // The gusts. Without this a bed is just hiss, and the ear stops believing it in seconds.
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = spec.rate;
  lfoGain.gain.value = level * spec.depth;
  lfo.connect(lfoGain); lfoGain.connect(gain.gain);
  lfo.start(at); lfo.stop(at + duration + 0.05);
  mrAudio.nodes.push(lfo);

  src.connect(filter); filter.connect(gain); gain.connect(mrAudio.sfx);
  src.start(at);
  src.stop(at + duration + 0.05);
  mrAudio.nodes.push(src);
}

// One effect, scheduled. Everything is noise plus a tone; what separates a footstep from a
// bell is which frequencies and how fast they die.
//
// The levels are the ones that survive the master gain and the limiter and still sit under
// the score rather than over it. They were set by recording the bus and measuring it: an
// effect that peaks two percent of full scale is, in practice, an effect nobody hears.
function mrSfxPlay(cue, at, duration) {
  const out = mrSfxOut(cue.pan);
  const gain = Math.max(0, cue.gain != null ? cue.gain : 1);
  const pitch = cue.pitch || 1;

  switch (cue.kind) {
    case 'bed':
      mrSfxBed(cue.bed, at, Math.max(0.3, duration || cue.dur || 1), gain);
      break;
    case 'step':
      // A scuff and a thump: the scuff is the shoe, the thump is the weight behind it.
      mrSfxBurst(at, 0.085, 0.26 * gain, 'lowpass', 1500 * pitch, 0.8, out, 500 * pitch);
      mrSfxTone(at, 0.07, 0.24 * gain, 92 * pitch, 55 * pitch, 'sine', out);
      break;
    case 'thud':
      mrSfxBurst(at, 0.2, 0.42 * gain, 'lowpass', 700, 0.7, out, 200);
      mrSfxTone(at, 0.26, 0.5 * gain, 78, 38, 'sine', out);
      break;
    case 'rustle':
      mrSfxBurst(at, 0.26, 0.13 * gain, 'bandpass', 2400 * pitch, 0.7, out, 1500);
      break;
    case 'crackle':
      mrSfxBurst(at, 0.035, 0.2 * gain, 'bandpass', (1400 + Math.random() * 2600) * pitch, 4, out);
      break;
    case 'drip':
      mrSfxTone(at, 0.13, 0.22 * gain, 1150 * pitch, 380 * pitch, 'sine', out);
      break;
    case 'bird':
      // Three chirps, each sweeping up. Two is a beep; three is a bird.
      for (let n = 0; n < 3; n++) {
        mrSfxTone(at + n * 0.085, 0.055, 0.15 * gain, 2300 * pitch, 3300 * pitch, 'sine', out);
      }
      break;
    case 'clop':
      for (const [offset, hz] of [[0, 430], [0.055, 380]]) {
        mrSfxBurst(at + offset, 0.05, 0.2 * gain, 'bandpass', hz * pitch, 7, out);
      }
      break;
    case 'flap':
      mrSfxBurst(at, 0.3, 0.14 * gain, 'bandpass', 900 * pitch, 1.1, out, 400);
      break;
    case 'bell':
      // Inharmonic partials are the whole difference between a bell and an organ note.
      for (const [ratio, level] of [[1, 0.26], [2.76, 0.13], [5.4, 0.07]]) {
        mrSfxTone(at, 1.9, level * gain, 420 * pitch * ratio, 418 * pitch * ratio, 'sine', out);
      }
      break;
    case 'creak':
      mrSfxBurst(at, 0.45, 0.14 * gain, 'bandpass', 620 * pitch, 9, out, 1100);
      break;
    default:
      break;
  }
}

// Schedule every cue from `fromSeconds` onward, on the same origin as the score.
function mrScheduleSfx(project, origin, fromSeconds) {
  if (!mrAudio.ctx || !mrAudio.sfx) return 0;
  const from = fromSeconds || 0;
  const level = project.audio && project.audio.sfxVolume != null ? project.audio.sfxVolume : 0.8;
  let scheduled = 0;
  for (const cue of sfxCuesFor(project)) {
    const end = cue.at + (cue.dur || 0.5);
    if (end < from) continue;
    const at = origin + Math.max(0, cue.at - from);
    // A bed already under way starts part-played rather than starting over.
    const duration = cue.dur ? cue.dur - Math.max(0, from - cue.at) : 0;
    if (cue.dur && duration <= 0.1) continue;
    mrSfxPlay(Object.assign({}, cue, { gain: (cue.gain != null ? cue.gain : 1) * level }), at, duration);
    scheduled++;
  }
  return scheduled;
}

// What this reel will actually sound like, in words. The Sound tab shows it, because
// "sound effects: on" tells you nothing about whether anything is going to happen.
function sfxSummary(project) {
  const cues = sfxCuesFor(project);
  if (!cues.length) return 'Nothing on stage makes a sound yet — add a character who walks, or scenery.';
  const counts = new Map();
  for (const cue of cues) {
    const key = cue.kind === 'bed' ? cue.bed : cue.kind;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const names = {
    step: ['footstep', 'footsteps'], thud: ['fall', 'falls'], rustle: ['rustle', 'rustles'],
    crackle: ['crackle', 'crackles'], drip: ['drip', 'drips'], bird: ['bird', 'birds'],
    clop: ['hoofbeat', 'hoofbeats'], flap: ['flap', 'flaps'], bell: ['bell', 'bells'],
    creak: ['creak', 'creaks'], wind: ['scene of wind', 'scenes of wind'],
    sea: ['scene of surf', 'scenes of surf'], rain: ['scene of rain', 'scenes of rain'],
    city: ['scene of street noise', 'scenes of street noise']
  };
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${n} ${(names[kind] || [kind, kind])[n === 1 ? 0 : 1]}`);
  return parts.join(', ') + '.';
}
