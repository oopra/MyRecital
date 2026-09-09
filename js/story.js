// story.js — turn a block of prose into a storyboard.
//
// Pure logic, no DOM: takes text in, returns a project object (title, style, scenes)
// that render.js knows how to draw and editor.js knows how to edit. Everything here is
// deterministic — same text plus same seed always gives the same storyboard, which is
// what makes "re-roll the look" and "undo" behave predictably.

// How fast a viewer reads a caption on a phone. Shorts run hot; 2.6 words/second with a
// beat of breathing room either side is close to what real captioned shorts use.
const MR_WORDS_PER_SECOND = 2.6;
const MR_MIN_SCENE = 1.8;      // seconds — below this a cut feels like a glitch
const MR_MAX_SCENE = 7.0;      // seconds — above this the eye wanders
const MR_MAX_WORDS_PER_SCENE = 26;
const MR_SHORTS_LIMIT = 60;    // YouTube Shorts hard ceiling

// ---------------------------------------------------------------- deterministic random

// Small, fast, seedable PRNG (mulberry32). Used everywhere a "random" choice must survive
// a reload: particle layouts, scene seeds, look re-rolls.
function mrRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable string hash, so a scene's default look is derived from its own words.
function mrHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------- mood

// Word lists are deliberately small and obvious: this is a hint engine, not a classifier.
// Every scene keeps its mood as an editable field, so a wrong guess costs one click.
const MR_MOODS = {
  tense:   ['fear', 'afraid', 'scream', 'ran', 'run', 'chase', 'danger', 'blood', 'knife', 'shadow', 'hunt', 'trap', 'panic', 'shatter', 'crash', 'alarm', 'warning', 'never', 'too late', 'behind'],
  dark:    ['night', 'dark', 'grave', 'cold', 'empty', 'alone', 'silence', 'lost', 'ghost', 'rot', 'ruin', 'storm', 'grey', 'gray', 'ash', 'smoke'],
  action:  ['jump', 'leap', 'fight', 'strike', 'burst', 'explode', 'race', 'speed', 'fast', 'slam', 'hit', 'throw', 'dive', 'charge', 'break'],
  wonder:  ['star', 'sky', 'moon', 'space', 'magic', 'dream', 'glow', 'light', 'shimmer', 'ancient', 'vast', 'infinite', 'discover', 'secret', 'door', 'strange'],
  joyful:  ['laugh', 'smile', 'happy', 'joy', 'sun', 'warm', 'friend', 'dance', 'sing', 'bright', 'gift', 'love', 'home', 'together', 'won', 'win'],
  sad:     ['cry', 'tears', 'gone', 'miss', 'grief', 'sorry', 'goodbye', 'end', 'broken', 'quiet', 'fade', 'last', 'remember', 'forgot'],
  calm:    ['slow', 'still', 'breathe', 'rest', 'soft', 'gentle', 'morning', 'water', 'sea', 'river', 'garden', 'sleep', 'peace', 'wait']
};

const MR_MOOD_ORDER = ['tense', 'dark', 'action', 'wonder', 'joyful', 'sad', 'calm'];

// Compiled once at load: a long story asks for a mood per beat, and rebuilding a hundred
// regexes each time added up to real lag on the Build button.
// Matching is on word stems with surrounding spaces, so "ran" does not fire inside "range".
const MR_MOOD_PATTERNS = {};
for (const mood of MR_MOOD_ORDER) {
  MR_MOOD_PATTERNS[mood] = MR_MOODS[mood].map(
    (word) => new RegExp('\\s' + word.replace(/ /g, '\\s') + "[a-z']{0,3}\\s", 'g'));
}

// Score a chunk of text against each lexicon; ties fall back to a neutral mood so the
// look stays varied instead of collapsing to one background for a whole story.
function detectMood(text) {
  const low = ' ' + text.toLowerCase().replace(/[^a-z' ]+/g, ' ') + ' ';
  let best = 'neutral', bestScore = 0;
  for (const mood of MR_MOOD_ORDER) {
    let score = 0;
    for (const pattern of MR_MOOD_PATTERNS[mood]) {
      const hits = low.match(pattern);
      if (hits) score += hits.length;
    }
    if (score > bestScore) { best = mood; bestScore = score; }
  }
  if (/[!?]/.test(text) && best === 'neutral') best = 'action';
  return best;
}

// Each mood suggests a set of backgrounds, a motion, and how hard the camera pushes.
// Backgrounds are listed most-typical-first; the storyboard walks the list to avoid
// showing the same background twice in a row.
const MR_MOOD_LOOK = {
  tense:   { backgrounds: ['rain', 'corridor', 'grid'],     motion: 'shake',  intensity: 1.15, transition: 'cut' },
  dark:    { backgrounds: ['mist', 'city', 'rain'],         motion: 'push',   intensity: 0.8,  transition: 'fade' },
  action:  { backgrounds: ['grid', 'embers', 'corridor'],   motion: 'zoom',   intensity: 1.2,  transition: 'slide' },
  wonder:  { backgrounds: ['starfield', 'orbit', 'aurora'], motion: 'drift',  intensity: 0.7,  transition: 'dissolve' },
  joyful:  { backgrounds: ['aurora', 'confetti', 'waves'],  motion: 'bob',    intensity: 0.9,  transition: 'dissolve' },
  sad:     { backgrounds: ['rain', 'waves', 'mist'],        motion: 'pull',   intensity: 0.6,  transition: 'fade' },
  calm:    { backgrounds: ['waves', 'forest', 'aurora'],    motion: 'pan',    intensity: 0.5,  transition: 'dissolve' },
  neutral: { backgrounds: ['gradient', 'forest', 'orbit'],  motion: 'drift',  intensity: 0.75, transition: 'dissolve' }
};

// ---------------------------------------------------------------- text splitting

function mrWordCount(text) {
  const m = text.trim().match(/[^\s]+/g);
  return m ? m.length : 0;
}

// Split prose into sentences. Keeps the terminator, tolerates quotes and ellipses, and
// refuses to break on common abbreviations that end in a period.
const MR_ABBREV = /\b(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e)\.$/i;
function splitSentences(text) {
  const out = [];
  let buf = '';
  const parts = text.split(/(\s+)/);
  for (const part of parts) {
    buf += part;
    const trimmed = buf.trim();
    if (!trimmed) continue;
    if (/[.!?…]["'”’)\]]*$/.test(trimmed) && !MR_ABBREV.test(trimmed)) {
      out.push(trimmed);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// A sentence longer than a caption should hold gets broken at its own punctuation
// (clause boundaries first, then any word boundary) rather than being crammed on screen.
function splitLongSentence(sentence, maxWords) {
  if (mrWordCount(sentence) <= maxWords) return [sentence];
  const clauses = sentence.split(/(?<=[,;:—–])\s+/);
  const out = [];
  let current = '';
  for (const clause of clauses) {
    const merged = current ? current + ' ' + clause : clause;
    if (current && mrWordCount(merged) > maxWords) { out.push(current); current = clause; }
    else current = merged;
  }
  if (current) out.push(current);
  // Still too long (one endless clause) — fall back to a hard word split.
  const final = [];
  for (const chunk of out) {
    if (mrWordCount(chunk) <= maxWords) { final.push(chunk); continue; }
    const words = chunk.split(/\s+/);
    for (let i = 0; i < words.length; i += maxWords) final.push(words.slice(i, i + maxWords).join(' '));
  }
  return final;
}

// Group sentences into beats: one beat is one caption on screen. Short sentences merge
// with their neighbour so the cut rhythm stays even.
function groupIntoBeats(sentences, maxWords) {
  const beats = [];
  let current = '';
  for (const sentence of sentences) {
    for (const piece of splitLongSentence(sentence, maxWords)) {
      const merged = current ? current + ' ' + piece : piece;
      if (current && mrWordCount(merged) > maxWords) { beats.push(current); current = piece; }
      else if (mrWordCount(merged) >= Math.round(maxWords * 0.55)) { beats.push(merged); current = ''; }
      else current = merged;
    }
  }
  if (current) {
    // Don't leave a 2-word orphan beat dangling — glue it to the previous one if it fits.
    const last = beats[beats.length - 1];
    if (last && mrWordCount(current) < 4 && mrWordCount(last + ' ' + current) <= maxWords + 4) {
      beats[beats.length - 1] = last + ' ' + current;
    } else beats.push(current);
  }
  return beats;
}

// ---------------------------------------------------------------- emphasis

const MR_STOPWORDS = new Set(('a an the and or but if then than that this these those of to in on at by for with from into over under ' +
  'is are was were be been being am do does did have has had will would can could should may might must not no ' +
  'i you he she it we they me him her them his hers its their our your my as so up out down off just very ' +
  'there here when where what who whom which how why all any some more most other same each every').split(' '));

// Words the caption should hit harder. Explicit *asterisks* and SHOUTING always win;
// otherwise pick the longest content words, which in practice are the concrete nouns
// and verbs a viewer's eye should land on.
function pickEmphasis(text, limit) {
  const explicit = [];
  const starred = text.match(/\*([^*]+)\*/g);
  if (starred) for (const s of starred) explicit.push(s.replace(/\*/g, '').trim());
  const words = (text.replace(/\*/g, '').match(/[A-Za-z][A-Za-z'-]*/g) || []);
  for (const w of words) if (w.length > 2 && w === w.toUpperCase()) explicit.push(w);
  if (explicit.length) return explicit.slice(0, limit).map((w) => w.toLowerCase());

  const scored = words
    .filter((w) => w.length >= 5 && !MR_STOPWORDS.has(w.toLowerCase()))
    .map((w) => ({ w: w.toLowerCase(), score: w.length + (/[A-Z]/.test(w[0]) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const { w } of scored) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

// Text inside quotes is dialogue — worth its own caption treatment.
function isDialogue(text) {
  return /^["“'‘]/.test(text.trim()) || /["“][^"”]{6,}["”]/.test(text);
}

// ---------------------------------------------------------------- durations

function sceneDurationFor(text) {
  const words = mrWordCount(text);
  const raw = words / MR_WORDS_PER_SECOND + 0.9;
  return Math.round(Math.min(MR_MAX_SCENE, Math.max(MR_MIN_SCENE, raw)) * 10) / 10;
}

function totalDuration(project) {
  return Math.round(project.scenes.reduce((sum, s) => sum + s.duration, 0) * 10) / 10;
}

// Scale every scene to land under a target length (Shorts' 60s, usually), keeping the
// relative rhythm and never dropping a scene below the minimum readable time.
function fitDuration(project, targetSeconds) {
  const total = totalDuration(project);
  if (total <= targetSeconds || !project.scenes.length) return project;
  const factor = targetSeconds / total;
  for (const scene of project.scenes) {
    scene.duration = Math.round(Math.max(MR_MIN_SCENE * 0.8, scene.duration * factor) * 10) / 10;
  }
  // Rounding can still overshoot; shave the longest scenes until it fits.
  let guard = 400;
  while (totalDuration(project) > targetSeconds && guard-- > 0) {
    const longest = project.scenes.reduce((a, b) => (b.duration > a.duration ? b : a));
    longest.duration = Math.round((longest.duration - 0.1) * 10) / 10;
    if (longest.duration <= 0.5) break;
  }
  return project;
}

// Re-distribute a fixed amount of time across scenes in proportion to their word counts.
// Naively scaling by weight then clamping inflates the total (every clamped-up scene adds
// time), which would silently push a 60s reel over the Shorts limit — so this water-fills:
// clamp, measure the error, and take it back off the scenes that still have room.
function distributeDurations(scenes, totalSeconds) {
  if (!scenes.length || totalSeconds <= 0) return scenes;
  const weights = scenes.map((s) => Math.max(1, mrWordCount(s.text)));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let alloc = weights.map((w) => (w / weightSum) * totalSeconds);

  // If the floor alone would blow the budget, honour the budget and let scenes run short.
  if (scenes.length * MR_MIN_SCENE <= totalSeconds) {
    for (let pass = 0; pass < 8; pass++) {
      let excess = 0;
      const free = [];
      alloc = alloc.map((value, i) => {
        if (value < MR_MIN_SCENE) { excess += MR_MIN_SCENE - value; return MR_MIN_SCENE; }
        if (value > MR_MAX_SCENE) { excess += MR_MAX_SCENE - value; return MR_MAX_SCENE; }
        free.push(i);
        return value;
      });
      if (Math.abs(excess) < 0.02 || !free.length) break;
      const share = excess / free.length;
      for (const i of free) alloc[i] -= share;
    }
  }

  scenes.forEach((scene, i) => { scene.duration = Math.round(alloc[i] * 10) / 10; });
  // Rounding to a tenth drifts; put the difference on the scene with the most room.
  const drift = Math.round((totalSeconds - scenes.reduce((sum, s) => sum + s.duration, 0)) * 10) / 10;
  if (Math.abs(drift) >= 0.1) {
    const target = scenes.reduce((a, b) => (b.duration > a.duration ? b : a));
    target.duration = Math.round(Math.max(0.5, target.duration + drift) * 10) / 10;
  }
  return scenes;
}

// Absolute start time of each scene, plus the running total. Used by the timeline,
// the scrubber, the renderer and the caption exporter alike.
function sceneTimeline(project) {
  let t = 0;
  return project.scenes.map((scene) => {
    const entry = { id: scene.id, start: Math.round(t * 1000) / 1000, end: 0, duration: scene.duration };
    t += scene.duration;
    entry.end = Math.round(t * 1000) / 1000;
    return entry;
  });
}

// Which scene is on screen at time t (and how far into it we are, 0..1).
function sceneAt(project, t) {
  const times = sceneTimeline(project);
  for (let i = 0; i < times.length; i++) {
    if (t < times[i].end || i === times.length - 1) {
      const local = Math.max(0, Math.min(times[i].duration, t - times[i].start));
      return { index: i, scene: project.scenes[i], start: times[i].start, local, progress: times[i].duration ? local / times[i].duration : 0 };
    }
  }
  return null;
}

// ---------------------------------------------------------------- the storyboard

let mrSceneCounter = 0;
function mrSceneId() { mrSceneCounter += 1; return 's' + mrSceneCounter.toString(36) + Date.now().toString(36).slice(-3); }

function makeScene(text, opts) {
  const o = opts || {};
  const mood = o.mood || detectMood(text);
  const look = MR_MOOD_LOOK[mood] || MR_MOOD_LOOK.neutral;
  return {
    id: mrSceneId(),
    text: text.replace(/\*/g, '').trim(),
    mood,
    background: o.background || look.backgrounds[0],
    motion: o.motion || look.motion,
    transition: o.transition || look.transition,
    captionStyle: o.captionStyle || (isDialogue(text) ? 'dialogue' : 'kinetic'),
    captionPosition: o.captionPosition || 'center',
    emphasis: o.emphasis || (o.kind === 'title' ? [] : pickEmphasis(text, 2)),
    accent: o.accent || null,       // null = inherit the project palette
    intensity: o.intensity != null ? o.intensity : look.intensity,
    duration: o.duration != null ? o.duration : sceneDurationFor(text),
    seed: o.seed != null ? o.seed : mrHash(text) % 100000,
    kind: o.kind || 'beat',         // 'title' | 'beat' | 'outro'
    // Illustration. null means "draw the procedural background instead", which is also
    // what a scene falls back to while its picture is still downloading.
    picture: o.picture || null,
    pictureFit: o.pictureFit || 'cover',
    pictureFocus: o.pictureFocus || { x: 0.5, y: 0.42 },   // faces sit above centre
    pictureGrade: o.pictureGrade != null ? o.pictureGrade : 0.28,
    // A drawn panel: { id, prompt, provider, model } — the bytes live in IndexedDB under
    // that id, because ten 1K images do not fit in localStorage.
    panel: o.panel || null,
    // Narration: { id, seconds, text } — the audio lives in IndexedDB too, and its length
    // is what sets this scene's duration.
    narration: o.narration || null,
    // The animation: actors and their keyframes for this scene.
    stage: o.stage || (typeof makeStage === 'function' ? makeStage() : { actors: [], ground: 0.86 })
  };
}

const MR_DEFAULT_STYLE = {
  palette: 'midnight',
  font: 'display',
  aspect: '9:16',
  fps: 30,
  grain: 0.35,
  vignette: 0.55,
  progressBar: true,
  sceneNumbers: false,
  watermark: '',
  motionScale: 1,
  seed: 1,
  look: 'natural',      // how the cast is drawn: natural, comic or storybook
  period: 'modern',     // when the story happens: dresses the cast and picks the scenery
  panel: false,         // a comic-page border around the frame
  imageHint: ''        // appended to every picture search, e.g. "Mahabharata painting"
};

const MR_DEFAULT_AUDIO = {
  enabled: true, mood: 'auto', volume: 0.5, accents: true,
  ensemble: 'auto',   // who plays the score; 'auto' follows the period
  sfx: true,          // footsteps, fire, weather
  sfxVolume: 0.8
};

// Pull a title out of the text: an explicit "Title: ..." line, or a short first line that
// isn't a sentence. Returns { title, body } so the body never repeats the title on screen.
function extractTitle(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const first = (lines[i] || '').trim();
  const labelled = first.match(/^title\s*[:—-]\s*(.+)$/i);
  if (labelled) return { title: labelled[1].trim(), body: lines.slice(i + 1).join('\n').trim() };
  const isHeading = first && first.length <= 60 && !/[.!?]$/.test(first) && mrWordCount(first) <= 9 &&
    (lines[i + 1] === '' || lines[i + 1] === undefined || first === first.toUpperCase() || /^#+\s/.test(first));
  if (isHeading) return { title: first.replace(/^#+\s*/, ''), body: lines.slice(i + 1).join('\n').trim() };
  return { title: '', body: text.trim() };
}

// The main entry point: prose in, editable storyboard out.
function buildStoryboard(text, opts) {
  const o = opts || {};
  const { title, body } = o.title != null ? { title: o.title, body: text.trim() } : extractTitle(text);
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const maxWords = o.maxWordsPerScene || MR_MAX_WORDS_PER_SCENE;

  const scenes = [];
  if (title && o.titleCard !== false) {
    scenes.push(makeScene(title, { kind: 'title', captionStyle: 'title', duration: 2.4, mood: detectMood(body.slice(0, 400) || title) }));
  }

  let previousBackground = scenes.length ? scenes[0].background : null;
  let previousMood = null;
  for (const paragraph of paragraphs) {
    const beats = groupIntoBeats(splitSentences(paragraph.replace(/\n+/g, ' ')), maxWords);
    for (const beat of beats) {
      const mood = detectMood(beat);
      const look = MR_MOOD_LOOK[mood] || MR_MOOD_LOOK.neutral;
      // Walk the mood's background list so consecutive scenes never share a background.
      let background = look.backgrounds[0];
      for (const candidate of look.backgrounds) { if (candidate !== previousBackground) { background = candidate; break; } }
      // A mood change is a real edit point: cut hard instead of dissolving through it.
      const transition = previousMood && previousMood !== mood && (mood === 'tense' || mood === 'action') ? 'cut' : look.transition;
      scenes.push(makeScene(beat, { mood, background, transition }));
      previousBackground = background;
      previousMood = mood;
    }
  }
  if (!scenes.length) scenes.push(makeScene(title || 'Your story goes here.', { kind: 'title', captionStyle: 'title' }));

  const project = {
    version: 1,
    title: title || (scenes[0] ? scenes[0].text.slice(0, 60) : 'Untitled'),
    source: text,
    style: Object.assign({}, MR_DEFAULT_STYLE, o.style),
    audio: Object.assign({}, MR_DEFAULT_AUDIO, o.audio),
    // Panel drawing settings and the cast description shared by every panel prompt.
    generation: Object.assign({}, typeof MR_DEFAULT_GENERATION !== 'undefined' ? MR_DEFAULT_GENERATION : {}, o.generation),
    narration: Object.assign({}, typeof MR_DEFAULT_NARRATION !== 'undefined' ? MR_DEFAULT_NARRATION : {}, o.narration),
    cast: o.cast || [],
    scenes
  };
  if (o.fit !== false) fitDuration(project, o.maxSeconds || MR_SHORTS_LIMIT);
  return project;
}

// ---------------------------------------------------------------- exports for humans

function mrTimecode(seconds, comma) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s}${comma ? ',' : '.'}${f}`;
}

// Burned-in captions are not the same as a caption track: YouTube wants the file so the
// video is searchable and accessible, so we hand it over in both common formats.
function captionsSRT(project) {
  const times = sceneTimeline(project);
  return project.scenes.map((scene, i) =>
    `${i + 1}\n${mrTimecode(times[i].start, true)} --> ${mrTimecode(times[i].end, true)}\n${scene.text}\n`
  ).join('\n');
}

function captionsVTT(project) {
  const times = sceneTimeline(project);
  return 'WEBVTT\n\n' + project.scenes.map((scene, i) =>
    `${mrTimecode(times[i].start, false)} --> ${mrTimecode(times[i].end, false)}\n${scene.text}\n`
  ).join('\n');
}

// Everything you have to paste into the YouTube upload form, derived from the story so
// the description actually matches the video.
function publishKit(project) {
  const total = totalDuration(project);
  const body = project.scenes.filter((s) => s.kind !== 'title').map((s) => s.text).join(' ');
  const words = (body.match(/[A-Za-z][A-Za-z'-]{3,}/g) || []).map((w) => w.toLowerCase());
  const counts = new Map();
  for (const w of words) if (!MR_STOPWORDS.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map((e) => e[0]);
  const hook = project.scenes.find((s) => s.kind !== 'title');
  const title = project.title.length <= 70 ? project.title : project.title.slice(0, 67) + '…';
  // The hook is the first line of the description; the rest of the story follows it, with
  // the hook itself trimmed off so the opening sentence isn't printed twice.
  const rest = hook && body.startsWith(hook.text) ? body.slice(hook.text.length).trim() : body;
  const credits = typeof projectCredits === 'function' ? projectCredits(project) : [];
  const description = [
    hook ? hook.text : '',
    '',
    rest.length > 300 ? rest.slice(0, 297) + '…' : rest,
    '',
    tags.map((t) => '#' + t.replace(/[^a-z0-9]/g, '')).slice(0, 5).join(' '),
    credits.length ? '\nArtwork:\n' + credits.map((c) => '· ' + c).join('\n') : ''
  ].join('\n').trim();
  return {
    title,
    description,
    credits,
    tags,
    hashtags: tags.slice(0, 5).map((t) => '#' + t.replace(/[^a-z0-9]/g, '')),
    duration: total,
    shortsReady: total <= MR_SHORTS_LIMIT && project.style.aspect === '9:16',
    sceneCount: project.scenes.length
  };
}
