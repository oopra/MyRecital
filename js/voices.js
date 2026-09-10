// voices.js — who is speaking, and what they sound like.
//
// Two problems, one answer.
//
// The first is that a reel with one narrator is a reel where everybody sounds the same. A
// story with a child, an old sage and a king in it needs three voices, and the difference
// between them has to be audible in a second, from a phone, by a seven-year-old.
//
// The second is that real text-to-speech needs a key and a deployed function, and most of
// the time there isn't one. So there are two ways to hear a character here, and they share
// everything except the sound: the same lines, the same attribution, the same mouth shapes.
//
//   • Spoken voices — synthesised right here, per syllable, from the same viseme sequence
//     that drives the lips. Not words: pitched gibberish, the way a Saturday-morning
//     cartoon or Animal Crossing does it. It costs nothing, needs no key, and a child, an
//     old man and a king are instantly three different people.
//   • Narrated voices — real TTS, one voice per character, when a key is there.
//
// The lip sync is exact for the synthesised path, because the mouth and the sound are
// generated from the same list of syllables. That is the reason it is built this way round.

// Voice colours. Each is a waveform and a filter: the wave is the buzz of the voice, the
// filter is the mouth it is coming out of.
// `wave`, `formant`, `q`, `noise` and `vibrato` are the syllable voice. `tilt`, `breath`
// and `jitter` are the word voice: how fast the glottal harmonics fall away (dark or
// pressed), how much air is in the tone, and how steady the pitch is. Those three are what
// separate one person from another far more than the formants do.
const MR_TIMBRES = {
  warm:   { name: 'Warm',   wave: 'triangle', formant: 1,    q: 4, noise: 0.22, vibrato: 0.02,  tilt: 0.5,  breath: 0.1,  jitter: 0.008 },
  bright: { name: 'Bright', wave: 'square',   formant: 1.18, q: 6, noise: 0.18, vibrato: 0.035, tilt: 0.25, breath: 0.07, jitter: 0.011 },
  reedy:  { name: 'Reedy',  wave: 'sawtooth', formant: 1.05, q: 8, noise: 0.3,  vibrato: 0.025, tilt: 0.18, breath: 0.09, jitter: 0.013 },
  soft:   { name: 'Soft',   wave: 'triangle', formant: 0.94, q: 3, noise: 0.12, vibrato: 0.015, tilt: 0.72, breath: 0.18, jitter: 0.006 },
  gruff:  { name: 'Gruff',  wave: 'sawtooth', formant: 0.82, q: 5, noise: 0.4,  vibrato: 0.01,  tilt: 0.62, breath: 0.22, jitter: 0.018 }
};

const MR_TIMBRE_KEYS = Object.keys(MR_TIMBRES);

// Where each age sits. A child is not a small adult here either: the whole band moves, and
// so does the speed. These are the two numbers a listener actually hears.
const MR_VOICE_AGES = {
  child: { low: 65, span: 7, rate: 1.14 },
  youth: { low: 59, span: 7, rate: 1.06 },
  adult: { low: 49, span: 13, rate: 1 },
  elder: { low: 45, span: 6, rate: 0.86 }
};

const MR_NARRATOR = 'Narrator';

// The mouth shapes a voice has to make a sound for, and the vowel colour of each. A voice
// that says every syllable at the same frequency is a telephone; moving the filter with
// the vowel is most of what makes this read as speech rather than as beeping.
const MR_VISEME_FORMANT = {
  AA: { hz: 780, tone: 1, open: 1 },
  EE: { hz: 2100, tone: 1, open: 0.8 },
  OO: { hz: 420, tone: 1, open: 0.7 },
  UH: { hz: 640, tone: 1, open: 0.85 },
  L:  { hz: 520, tone: 1, open: 0.6 },
  MBP: { hz: 260, tone: 1, open: 0.35 },
  FV: { hz: 3600, tone: 0, open: 0.3 },
  S:  { hz: 5200, tone: 0, open: 0.3 },
  rest: null
};

// ---------------------------------------------------------------- who has a voice

function mrVoiceHash(text) {
  let hash = 2166136261;
  const source = String(text || '');
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

// The age this character is drawn at, taken from the stage rather than guessed again.
function mrAgeOfName(project, name) {
  for (const scene of project.scenes || []) {
    for (const actor of (scene.stage && scene.stage.actors) || []) {
      if (actor.name === name) return actor.age || 'adult';
    }
  }
  return 'adult';
}

// A voice for a name: whatever the project has stored, or one derived from the name and
// the age. Derived voices are stable — Ashoka sounds like Ashoka in every scene and in
// every reel — and different names land on different pitches and different timbres.
function voicesOn(project) {
  return !!(project && project.voices && project.voices.enabled);
}

function voiceProfileFor(project, name) {
  const stored = project && project.voices && project.voices.cast && project.voices.cast[name];
  if (stored && stored.pitch != null) return Object.assign({ name }, stored);

  const narrator = name === MR_NARRATOR;
  const age = narrator ? 'adult' : mrAgeOfName(project, name);
  const band = MR_VOICE_AGES[age] || MR_VOICE_AGES.adult;
  const hash = mrVoiceHash(name);
  const profile = {
    name,
    pitch: narrator ? 52 : band.low + (hash % band.span),
    timbre: narrator ? 'soft' : MR_TIMBRE_KEYS[hash % MR_TIMBRE_KEYS.length],
    rate: narrator ? 0.95 : band.rate,
    tts: ''                                   // a provider voice, when there is a key
  };
  return Object.assign(profile, stored || {});
}

// Everyone in the reel who could speak: the cast, plus the narrator who reads everything
// nobody says out loud.
function voiceCastOf(project) {
  const names = [MR_NARRATOR];
  for (const scene of project.scenes || []) {
    for (const actor of (scene.stage && scene.stage.actors) || []) {
      if (names.indexOf(actor.name) < 0) names.push(actor.name);
    }
  }
  return names;
}

// ---------------------------------------------------------------- who says what

const MR_SPEECH_VERB = /\b(said|says|asked|asks|replied|answered|told|called|cried|shouted|whispered|murmured|laughed|begged|ordered)\b/i;
const MR_SILENCE = /\bsaid\s+(nothing|not a word|no word)|\bspoke\s+no\b|\bwithout a word\b|\bin silence\b/i;

// Split one sentence into the part somebody says out loud and the part the narrator reads.
// Quotation marks settle it where they exist; where they do not, the speech tag does —
// "You have walked a long way, she said" is two different voices, and reading the whole
// sentence in one of them is the thing that makes a reel sound like a robot.
function splitSpeech(sentence, names, lastNamed) {
  const text = String(sentence || '').trim();
  if (!text) return [];
  const silent = MR_SILENCE.test(text);

  // Who, if anyone, this sentence attributes speech to.
  const named = (names || []).filter((n) => text.toLowerCase().indexOf(n.toLowerCase()) >= 0);
  let who = null;
  if (!silent && MR_SPEECH_VERB.test(text)) {
    if (named.length === 1) who = named[0];
    else if (named.length > 1) {
      const verbAt = text.search(MR_SPEECH_VERB);
      const placed = named
        .map((n) => ({ n, at: text.toLowerCase().indexOf(n.toLowerCase()) }))
        .sort((a, b) => a.at - b.at);
      const before = placed.filter((entry) => entry.at < verbAt);
      who = (before.length ? before[0] : placed[0]).n;
    } else who = lastNamed || null;
  }

  // Quoted speech, wherever it falls in the sentence.
  const quoted = [...text.matchAll(/[""“]([^""”]{2,})[""”]/g)];
  if (quoted.length) {
    const lines = [];
    let at = 0;
    for (const match of quoted) {
      const before = text.slice(at, match.index).trim();
      if (before) lines.push({ who: null, text: before });
      lines.push({ who: who || (named.length === 1 ? named[0] : null), text: match[1].trim() });
      at = match.index + match[0].length;
    }
    const after = text.slice(at).trim();
    if (after) lines.push({ who: null, text: after });
    return lines.filter((line) => line.text);
  }

  if (!who) return [{ who: null, text }];

  // No quotes, but a speech tag: everything on the far side of the tag is the line.
  const tag = text.match(new RegExp('(,?\\s*(?:and\\s+)?(?:' + named.concat(['he', 'she', 'they', 'it']).join('|') +
    ')\\s+\\w*\\s*(?:' + MR_SPEECH_VERB.source.replace(/\\b|[()]/g, '').replace(/\|/g, '|') + ')[^,.!?]*[.!?]?)$', 'i'));
  if (tag && tag.index > 4) {
    const spoken = text.slice(0, tag.index).replace(/[,\s]+$/, '');
    const rest = text.slice(tag.index).replace(/^[,\s]+/, '');
    const lines = [];
    if (spoken) lines.push({ who, text: spoken + (/[.!?]$/.test(spoken) ? '' : '.') });
    if (rest) lines.push({ who: null, text: rest });
    return lines;
  }

  // The tag comes first — "She said, you have walked a long way" — or the sentence is
  // description with a verb in it. Anything after the verb is the line.
  const verbAt = text.search(MR_SPEECH_VERB);
  const afterVerb = text.slice(verbAt).replace(MR_SPEECH_VERB, '').replace(/^[\s,:]+/, '');
  if (afterVerb.length > 3) {
    return [
      { who: null, text: text.slice(0, verbAt + (text.slice(verbAt).match(MR_SPEECH_VERB) || [''])[0].length).trim() },
      { who, text: afterVerb }
    ].filter((line) => line.text);
  }
  return [{ who: null, text }];
}

// The reel's list of "say it like this" fixes, ready to look words up in. Rebuilt only
// when the list itself changes, since every line of every beat asks for it.
let mrSayingCache = { table: null, map: null };
function sayingFor(project) {
  const table = project && project.voices && project.voices.saying;
  if (!table || !Object.keys(table).length) return null;
  if (mrSayingCache.table === table) return mrSayingCache.map;
  const map = typeof sayingMap === 'function' ? sayingMap(table) : null;
  mrSayingCache = { table, map };
  return map;
}

// One beat, as an ordered list of who says what.
function speechLinesFor(scene, names, fixes) {
  const text = String(scene.text || '').trim();
  if (!text || scene.kind === 'title') return text ? [{ who: null, text }] : [];
  const sentences = typeof splitSentences === 'function' ? splitSentences(text) : [text];
  const lines = [];
  let lastNamed = null;
  for (const sentence of sentences) {
    const here = (names || []).filter((n) => sentence.toLowerCase().indexOf(n.toLowerCase()) >= 0);
    for (const line of splitSpeech(sentence, names, lastNamed)) lines.push(line);
    if (here.length === 1) lastNamed = here[0];
  }
  // Merge a run of narrator lines back together: two consecutive sentences of description
  // are one piece of reading, not two.
  const merged = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    if (previous && !previous.who && !line.who) previous.text += ' ' + line.text;
    else merged.push(Object.assign({}, line));
  }
  // Anybody can overrule the guess. Working out who says what from punctuation and speech
  // verbs is right most of the time and wrong some of it, and a line in the wrong voice is
  // the most obvious mistake a reel can make — so the answer is a list, not a better guess.
  const fixed = fixes === undefined ? scene.lineWho : fixes;
  if (!fixed || !fixed.length) return merged;
  return merged.map((line, i) => {
    const who = fixed[i];
    if (!who) return line;
    return Object.assign({}, line, { who: who === MR_NARRATOR ? null : who });
  });
}

// ---------------------------------------------------------------- timing

// Roughly how long a line takes to say. The same units the mouth uses, so the sound and
// the lips agree by construction rather than by adjustment.
const MR_SPEECH_UNITS = 13;

function speechWeight(text) {
  return visemeSequence(text).reduce((sum, piece) => sum + piece.weight, 0);
}

function speechSeconds(text, rate, mode, saying) {
  if (mode !== 'syllables' && typeof speechPlanSeconds === 'function') return speechPlanSeconds(text, rate, saying);
  return speechWeight(text) / (MR_SPEECH_UNITS * (rate || 1));
}

// Words or syllables. Words is the point of the thing; syllables is the cartoon-gibberish
// voice, kept because it is a legitimate style and because it never mispronounces anything.
function voiceMode(project) {
  const mode = project && project.voices && project.voices.mode;
  return mode === 'syllables' ? 'syllables' : 'words';
}

// Lay the lines of one scene end to end inside it. If the beat is too short for what is
// said, everyone speaks a little faster rather than the last line being cut off — the
// alternative is a character whose sentence disappears.
function speechScheduleFor(project, scene) {
  const names = voiceCastOf(project).filter((n) => n !== MR_NARRATOR);
  const lines = speechLinesFor(scene, names);
  if (!lines.length) return [];
  const gap = 0.16;
  const room = Math.max(0.5, (scene.duration || 0) - 0.3);
  const mode = voiceMode(project);
  const saying = sayingFor(project);
  const spans = lines.map((line) => {
    const profile = voiceProfileFor(project, line.who || MR_NARRATOR);
    return { line, profile, seconds: speechSeconds(line.text, profile.rate, mode, saying) };
  });
  const total = spans.reduce((sum, span) => sum + span.seconds, 0) + gap * (spans.length - 1);
  const squeeze = total > room ? room / total : 1;
  let at = 0.15;
  return spans.map((span) => {
    const seconds = span.seconds * squeeze;
    const out = {
      at, dur: seconds, who: span.line.who || MR_NARRATOR, text: span.line.text,
      rate: span.profile.rate / squeeze, profile: span.profile, mode, saying
    };
    at += seconds + gap * squeeze;
    return out;
  });
}

// The whole reel, as speech. Pure, like the score and the effects.
function speechCuesFor(project) {
  const cues = [];
  const times = sceneTimeline(project);
  project.scenes.forEach((scene, i) => {
    if (scene.kind === 'title') return;
    for (const span of speechScheduleFor(project, scene)) {
      cues.push(Object.assign({}, span, { at: times[i].start + span.at, localAt: span.at, scene: scene.id }));
    }
  });
  return cues;
}

// ---------------------------------------------------------------- the mouth

// The mouth of one actor at one instant, when the reel is speaking its own lines. Returns
// null when this actor is not the one talking, so the caller can fall back.
function spokenMouthFor(project, scene, actor, localT) {
  if (!voicesOn(project)) return null;
  const spans = speechScheduleFor(project, scene);
  // Whose mouth moves on a narrator's line? Nobody's, when the beat has dialogue in it —
  // the narrator is not in the picture. But a beat that is nothing but description would
  // then have every mouth shut, so there the character marked as speaker reads it, which
  // is what a reel did before any of this existed.
  const dialogue = spans.some((span) => span.who !== MR_NARRATOR);
  for (const span of spans) {
    if (localT < span.at || localT > span.at + span.dur) continue;
    const mine = span.who === actor.name || (span.who === MR_NARRATOR && actor.speaker && !dialogue);
    if (!mine) return null;
    // In words mode the mouth comes from the phonemes themselves, which is the shape the
    // sound is actually being made with rather than a guess from the spelling.
    if (span.mode !== 'syllables' && typeof speechPlan === 'function') {
      return mouthFromPlan(speechPlan(span.text, { rate: span.rate, saying: span.saying }), localT - span.at);
    }
    return spokenMouthAt(span.text, localT - span.at, { rate: span.rate, loop: false });
  }
  return null;
}

// ---------------------------------------------------------------- synthesis

// One syllable. A tone through a filter tuned to the vowel, or a burst of noise for the
// consonants that have no pitch at all.
function mrSpeakPiece(viseme, at, duration, profile, timbre, pitchHz, out) {
  const ctx = mrAudio.ctx;
  const shape = MR_VISEME_FORMANT[viseme];
  if (!shape || duration < 0.012) return;
  // Loud enough to be the thing you are listening to — voices sit above the score, which
  // peaks around a quarter of full scale — and quiet enough to leave the limiter alone.
  const level = 0.26 * (shape.open || 0.6);

  if (shape.tone) {
    const osc = ctx.createOscillator();
    // The vowel is a BOOST at its formant, not a narrow band around it. A bandpass tuned
    // to 780Hz throws away a 110Hz voice almost entirely — the first version of this made
    // every character, however deep, come out as the same thin whistle. Peaking colours
    // the vowel and leaves the pitch you can actually hear.
    const colour = ctx.createBiquadFilter();
    colour.type = 'peaking';
    colour.frequency.value = shape.hz * timbre.formant;
    colour.Q.value = Math.max(0.6, timbre.q * 0.35);
    colour.gain.value = 15;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = Math.max(1600, shape.hz * timbre.formant * 2.6);
    soften.Q.value = 0.7;
    const gain = ctx.createGain();
    osc.type = timbre.wave;
    osc.frequency.setValueAtTime(pitchHz, at);
    // A syllable that holds one exact frequency sounds like a machine; a little drift is
    // the difference between a voice and a test tone.
    osc.frequency.linearRampToValueAtTime(pitchHz * (1 + timbre.vibrato), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.02, duration * 0.3));
    gain.gain.setValueAtTime(level, at + duration * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(colour); colour.connect(soften); soften.connect(gain); gain.connect(out);
    osc.start(at); osc.stop(at + duration + 0.02);
    mrAudio.nodes.push(osc);
  }

  // Every voice carries some breath; the unvoiced consonants are nothing but breath.
  const noiseLevel = shape.tone ? level * timbre.noise * 0.22 : level * 0.5;
  if (noiseLevel > 0.004 && typeof mrSfxNoise === 'function') {
    const src = ctx.createBufferSource();
    src.buffer = mrSfxNoise();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = shape.hz * timbre.formant;
    filter.Q.value = shape.tone ? 1.2 : 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(noiseLevel, at + Math.min(0.015, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(filter); filter.connect(gain); gain.connect(out);
    src.start(at); src.stop(at + duration + 0.02);
    mrAudio.nodes.push(src);
  }
}

// One line, spoken. The pitch drifts down across a statement and up at a question, which
// is the smallest amount of prosody that stops a voice sounding like a list.
function mrSpeakLine(text, at, profile, rate, gainValue, mode, saying) {
  const ctx = mrAudio.ctx;
  if (!ctx) return 0;
  // Real words unless the reel has asked for the gibberish voice.
  if (mode !== 'syllables' && typeof mrSpeakWords === 'function') {
    return mrSpeakWords(text, at, profile, rate, gainValue, saying);
  }
  const timbre = MR_TIMBRES[profile.timbre] || MR_TIMBRES.warm;
  const sequence = visemeSequence(text);
  const question = /\?\s*$/.test(text);
  const total = sequence.reduce((sum, piece) => sum + piece.weight, 0) || 1;
  const seconds = total / (MR_SPEECH_UNITS * (rate || 1));
  const base = mrMidiToHz(profile.pitch);
  const out = mrAudio.voice;
  const level = gainValue == null ? 1 : gainValue;

  let spent = 0;
  for (const piece of sequence) {
    const progress = spent / total;
    const duration = (piece.weight / total) * seconds;
    // Down across the line, or up at the end of a question.
    const contour = question ? 1 + progress * 0.22 : 1 - progress * 0.12;
    const wobble = 1 + ((mrVoiceHash(text + spent) % 100) / 100 - 0.5) * 0.06;
    if (piece.viseme !== 'rest') {
      mrSpeakPiece(piece.viseme, at + spent / total * seconds, duration * 0.92, profile, timbre,
        base * contour * wobble * level, out);
    }
    spent += piece.weight;
  }
  return seconds;
}

// Schedule every spoken line from `fromSeconds` on, and duck the score under them.
function mrScheduleSpeech(project, origin, fromSeconds) {
  if (!mrAudio.ctx || !mrAudio.voice) return 0;
  if (!voicesOn(project)) return 0;
  // Real narration wins: if a scene has a recording, we do not talk over it.
  const ctx = mrAudio.ctx;
  const from = fromSeconds || 0;
  const narrated = new Set(project.scenes.filter((s) => s.narration).map((s) => s.id));
  let spoken = 0;
  const duck = Math.max(0, Math.min(1, 1 - (project.narration && project.narration.duckMusic != null
    ? project.narration.duckMusic : 0.3)));

  for (const cue of speechCuesFor(project)) {
    if (narrated.has(cue.scene)) continue;
    if (cue.at + cue.dur < from) continue;
    const at = origin + Math.max(0, cue.at - from);
    if (cue.at < from) continue;                 // a line already half-said is left alone
    mrSpeakLine(cue.text, at, cue.profile, cue.rate, 1, cue.mode, cue.saying);
    spoken++;
    mrAudio.music.gain.setTargetAtTime(duck, Math.max(ctx.currentTime, at - 0.1), 0.05);
    mrAudio.music.gain.setTargetAtTime(1, at + cue.dur + 0.05, 0.2);
  }
  return spoken;
}

// Speak one line right now, for the "try it" button in the Sound tab.
function mrTryVoice(project, name) {
  const ctx = mrAudioEnsure();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume();
  const profile = voiceProfileFor(project, name);
  mrSpeakLine(name === MR_NARRATOR ? 'And so the long road turned towards home.' : `My name is ${name}. Listen, and I will tell you.`,
    ctx.currentTime + 0.05, profile, profile.rate, 1, voiceMode(project), sayingFor(project));
  return true;
}

// Say one word out loud, for the "hear it" button beside a pronunciation fix. The word on
// its own, said the way the reel would say it, is the only way to tell whether a
// respelling worked.
function mrTryWord(project, word, respelling) {
  const ctx = mrAudioEnsure();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume();
  const profile = voiceProfileFor(project, MR_NARRATOR);
  const saying = respelling
    ? (typeof sayingMap === 'function' ? sayingMap({ [word]: respelling }) : null)
    : sayingFor(project);
  mrSpeakLine(String(word || ''), ctx.currentTime + 0.05, profile, profile.rate, 1, voiceMode(project), saying);
  return true;
}
