// voice.js — narration, and the timing that follows from it.
//
// This is what lets the captions stop performing. A reel with no voice has to put the
// words on screen at reading size, which is why the app was built words-first; once a
// narrator carries the story, the text can drop to ordinary subtitles and the picture
// gets the frame.
//
// Two consequences that shape the whole module:
//   • The narration decides the cut. A beat lasts exactly as long as its line takes to
//     say, plus a breath — so generating narration re-times the reel.
//   • Browser speech synthesis is useless here: it cannot be captured into MediaRecorder,
//     so a voiceover made that way plays for you and is silently missing from the file.
//     Real TTS returns bytes we can both play AND mix into the recording.

const MR_VOICE_STORE = 'narration';

const MR_VOICE_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini-tts',
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
    defaultVoice: 'onyx'
  },
  elevenlabs: {
    name: 'ElevenLabs',
    defaultModel: 'eleven_multilingual_v2',
    // ElevenLabs addresses voices by id, so this is a free-text field in the UI.
    voices: [],
    defaultVoice: 'JBFqnCBsd6RMkjVDRZzb'
  }
};

const MR_DEFAULT_NARRATION = {
  enabled: false,
  provider: 'openai',
  model: '',
  voice: '',
  instructions: 'Read this as an unhurried storyteller: warm, clear, a little grave.',
  proxy: '/api/voice',
  gap: 0.45,          // seconds of silence added after each line, so cuts do not clip speech
  duckMusic: 0.3      // how far the score drops under the voice
};

// ---------------------------------------------------------------- generation

// Neither provider allows browser calls, so both go through the project's own function.
async function generateNarrationAudio(text, project, opts) {
  const o = opts || {};
  const narration = Object.assign({}, MR_DEFAULT_NARRATION, project.narration);
  const provider = MR_VOICE_PROVIDERS[narration.provider] || MR_VOICE_PROVIDERS.openai;
  const res = await fetch(narration.proxy || '/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: narration.provider,
      model: narration.model || provider.defaultModel,
      voice: narration.voice || provider.defaultVoice,
      instructions: narration.instructions || '',
      text,
      apiKey: o.apiKey || undefined
    }),
    signal: o.signal
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch { /* nothing readable */ }
    throw new Error(`${provider.name}: ${res.status}${detail ? ' — ' + detail : ''}`);
  }
  const json = await res.json();
  if (!json.b64) throw new Error(`${provider.name} returned no audio: ${JSON.stringify(json).slice(0, 200)}`);
  return { blob: mrBase64ToBlob(json.b64, json.mime || 'audio/mpeg'), mime: json.mime || 'audio/mpeg' };
}

// ---------------------------------------------------------------- storage & decoding

// Narration lives beside the panels in IndexedDB, for the same reason: audio is far too
// big for localStorage, and the project file should stay small enough to email.
function mrVoiceTx(mode, run) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MR_PANEL_DB, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MR_PANEL_STORE)) db.createObjectStore(MR_PANEL_STORE);
      if (!db.objectStoreNames.contains(MR_VOICE_STORE)) db.createObjectStore(MR_VOICE_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MR_VOICE_STORE)) { db.close(); resolve(null); return; }
      const tx = db.transaction(MR_VOICE_STORE, mode);
      const store = tx.objectStore(MR_VOICE_STORE);
      let out;
      try { out = run(store); } catch (e) { db.close(); reject(e); return; }
      tx.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : out); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
}

function saveNarrationBlob(id, blob) { return mrVoiceTx('readwrite', (store) => store.put(blob, id)); }
function deleteNarrationBlob(id) { return mrVoiceTx('readwrite', (store) => store.delete(id)); }
function loadNarrationBlob(id) {
  return mrVoiceTx('readonly', (store) => {
    const request = store.get(id);
    return { get result() { return request.result; } };
  });
}

// Decoded narration, keyed by scene. The renderer never touches this; the audio graph
// and the timeline do.
const mrNarrationBuffers = new Map();

async function decodeNarration(sceneId, blob) {
  const ctx = mrAudioEnsure();
  if (!ctx) throw new Error('No Web Audio support, so narration cannot be played.');
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  mrNarrationBuffers.set(sceneId, buffer);
  return buffer;
}

// How many mouth samples per second of speech. 30 is enough: a mouth that changes faster
// than the frame rate is just noise, and the envelope is stored in the project file.
const MR_ENVELOPE_RATE = 30;

// Reduce a spoken line to a loudness envelope — the actual shape of the speech, sampled
// often enough to drive a mouth. This is amplitude lip-sync, the technique hand-drawn
// animation has used forever: it will not distinguish an "oo" from an "ee", but it opens
// and closes on the real syllables instead of flapping on a timer.
function envelopeFrom(buffer) {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate / MR_ENVELOPE_RATE));
  const out = [];
  let peak = 0;
  for (let i = 0; i < data.length; i += step) {
    let sum = 0;
    const end = Math.min(data.length, i + step);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    peak = Math.max(peak, rms);
    out.push(rms);
  }
  // Normalise against the loudest moment, then store as small integers so a minute of
  // narration adds kilobytes to the project rather than megabytes.
  if (peak <= 0) return out.map(() => 0);
  return out.map((v) => Math.round(Math.min(1, v / peak) * 100));
}

// How far open the mouth should be at this instant, 0..1. Silence closes it; the quietest
// audible speech still parts the lips a little, because a mouth that snaps shut between
// every syllable reads as a glitch.
function mouthAmountAt(scene, localT) {
  const narration = scene && scene.narration;
  if (!narration || !narration.envelope || !narration.envelope.length) return null;
  const i = Math.floor(localT * MR_ENVELOPE_RATE);
  if (i < 0 || i >= narration.envelope.length) return 0;
  const level = narration.envelope[i] / 100;
  return level < 0.06 ? 0 : Math.min(1, 0.18 + level * 0.85);
}

function narrationBuffer(sceneId) {
  return mrNarrationBuffers.get(sceneId) || null;
}

// Narrate one scene, store it, and re-time the scene to fit what was actually said.
// Re-timing is the whole point: a cut that lands mid-word is worse than no narration.
async function narrateScene(scene, project, opts) {
  const o = opts || {};
  const narration = Object.assign({}, MR_DEFAULT_NARRATION, project.narration);
  const { blob, mime } = await generateNarrationAudio(scene.text, project, o);
  const id = `${scene.id}-voice-${Date.now().toString(36)}`;
  if (scene.narration && scene.narration.id) deleteNarrationBlob(scene.narration.id).catch(() => {});
  await saveNarrationBlob(id, blob);
  const buffer = await decodeNarration(scene.id, blob);
  scene.narration = {
    id, mime, seconds: buffer.duration, text: scene.text, at: Date.now(),
    envelope: envelopeFrom(buffer)
  };
  scene.duration = Math.round((buffer.duration + (narration.gap || 0.45)) * 10) / 10;
  return scene.narration;
}

// Bring stored narration back after a reload: the blobs survive, the decoded buffers do not.
async function restoreNarration(project) {
  let restored = 0;
  for (const scene of project.scenes) {
    if (!scene.narration || !scene.narration.id) continue;
    try {
      const blob = await loadNarrationBlob(scene.narration.id);
      if (blob) {
        const buffer = await decodeNarration(scene.id, blob);
        if (!scene.narration.envelope) scene.narration.envelope = envelopeFrom(buffer);
        restored++;
      }
    } catch { /* a scene with no audio simply plays silent */ }
  }
  return restored;
}

// Total spoken seconds, for the UI's "this reel is 52s of speech" line.
function narrationSeconds(project) {
  return Math.round(project.scenes.reduce((sum, s) => sum + (s.narration ? s.narration.seconds : 0), 0) * 10) / 10;
}
