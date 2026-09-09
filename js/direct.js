// direct.js — read the story and stage it.
//
// This is the step that turns a storyboard into an animation without anybody placing a
// character by hand: work out who is in each beat, what they are doing, who is speaking,
// where they should stand, and what scenery the words imply — then write the actors,
// props and keyframes that the renderer already knows how to draw.
//
// It is a director, not an author. Every decision it makes is an ordinary edit you can
// change afterwards, and the whole pass is one undo.

// Verbs, grouped by the action they imply. Matched on stems, longest group first, so
// "walked back" beats a bare "back".
const MR_ACTION_VERBS = [
  ['walk',  /\b(walk|ran|run|came|come|went|go(?:es)?|approach|arriv|enter|follow|cross|left|leav|hurri|wander|march|strode|stride|climb|chase|flee|fled|return)/i],
  ['talk',  /\b(said|say|ask|repli|answer|told|tell|call|cri|shout|whisper|spoke|speak|beg|sang|sing|explain|declar|announc|mutter|murmur)/i],
  ['point', /\b(point|show|gestur|accus|indicat|aim|drew his|rais(?:ed)? (?:his|her) (?:hand|arm))/i],
  ['wave',  /\b(wav|greet|beckon|hail|welcom|salut)/i],
  ['think', /\b(thought|think|wonder|consider|remember|hesitat|puzzl|doubt|ponder|realis|realiz)/i],
  ['sit',   /\b(sat|sit|seated|rested|settled)/i],
  ['kneel', /\b(knelt|kneel|bow|crouch|pray|stoop|sank|sunk)/i],
  ['fall',  /\b(fell|fall|collaps|stumbl|tumbl|dropp|slipp)/i]
];

// Nouns that put something on the stage. First match wins, so "chariot" beats "cart".
const MR_SCENERY_NOUNS = [
  ['tree', /\b(tree|forest|grove|banyan|wood)/i],
  ['house', /\b(house|hut|home|cottage|palace|village|door(?:way)?)/i],
  ['fire', /\b(fire|flame|hearth|blaze|ember)/i],
  ['well', /\b(well\b|spring|water)/i],
  ['mountain', /\b(mountain|hill|peak|cliff|ridge)/i],
  ['cart', /\b(chariot|cart|wagon|carriage)/i],
  ['pot', /\b(pot\b|jar|vessel|urn)/i],
  ['rock', /\b(rock|stone|boulder)/i],
  ['banner', /\b(banner|flag|standard)/i],
  ['spear', /\b(spear|lance|weapon)/i],
  ['chair', /\b(chair|throne|stool|seat)/i],
  ['table', /\b(table|desk)/i],
  ['cloud', /\b(cloud|sky|storm)/i],
  ['bush', /\b(bush|shrub|thicket)/i]
];

// An arrival, as opposed to walking about: someone who arrives should come in from off
// the edge of the frame, which is most of what makes a staged scene feel directed.
const MR_ARRIVAL = /\b(came|come|arriv|enter|approach|walked (?:up|in|over)|reach)/i;

// Mood → face. The storyboard already worked out each beat's mood; this is the only place
// that has to know what a mood looks like on a character.
const MR_MOOD_FACES = {
  tense: 'worried', dark: 'sad', action: 'angry', wonder: 'shocked',
  joyful: 'glad', sad: 'sad', calm: 'calm', neutral: 'calm'
};

// Plenty of stories never name anybody: "a traveller", "the potter", "the old king".
// Those are characters too, and a director that only casts proper nouns leaves an empty
// stage for half the folk tales ever written.
const MR_ROLE_NOUNS = [
  'traveller', 'traveler', 'potter', 'farmer', 'merchant', 'soldier', 'priest', 'king', 'queen',
  'prince', 'princess', 'stranger', 'servant', 'master', 'teacher', 'student', 'hunter', 'fisherman',
  'boy', 'girl', 'woman', 'man', 'child', 'mother', 'father', 'brother', 'sister', 'friend',
  'thief', 'guard', 'beggar', 'sage', 'monk', 'washerman', 'barber', 'cook', 'shepherd', 'weaver'
];

// How old somebody is, read off the words the story uses about them. A history reel is
// full of children and elders, and drawing them all as thirty-year-olds is the fastest way
// to make a village look like a staff photograph.
const MR_AGE_WORDS = [
  ['child', /\b(child|boy|girl|infant|baby|toddler|little one|schoolboy|schoolgirl|kid)\b/i],
  ['youth', /\b(youth|young|lad|lass|apprentice|student|maiden|teenager)\b/i],
  ['elder', /\b(old|elder|aged|ancient|grandmother|grandfather|granny|grandpa|sage|crone|greybeard|widow)\b/i]
];

// How the story refers to somebody, where it says so at all. This decides nothing about a
// character on its own — it only filters the wardrobe, so a boy is not put in a saree. When
// the story does not say, neither do we, and every garment stays one click away.
const MR_GENDER_WORDS = [
  ['f', /\b(she|her|hers|woman|girl|queen|princess|mother|sister|daughter|wife|lady|widow|grandmother|maiden|nun)\b/i],
  ['m', /\b(he|him|his|man|boy|king|prince|father|brother|son|husband|lord|monk|grandfather)\b/i]
];

// Look at the words around the name, not the whole beat: "the old woman told the boy"
// has an elder and a child in one sentence, and a window wide enough to hold both of them
// gives you an old boy.
// Counted in words and stopped at the nearest punctuation, not in characters: "a young
// prince named Ashoka" and "even a child may teach a king" are almost the same length,
// and only one of them is telling you how old the person is.
function nearName(text, name, wordsBefore, wordsAfter) {
  const source = String(text || '');
  const at = source.toLowerCase().indexOf(String(name || '').toLowerCase());
  if (at < 0) return null;
  const words = (part) => part.trim().split(/\s+/).filter(Boolean);
  const before = words(source.slice(0, at).split(/[,;:.!?]/).pop()).slice(-wordsBefore);
  const after = words(source.slice(at + String(name).length).split(/[,;:.!?]/)[0]).slice(0, wordsAfter);
  return before.concat([String(name)], after).join(' ');
}

function genderFor(text, name) {
  const near = nearName(text, name, 6, 8);
  if (near == null) return null;
  for (const [gender, pattern] of MR_GENDER_WORDS) if (pattern.test(near)) return gender;
  return null;
}

function genderAcrossStory(project, name) {
  for (const [gender, pattern] of MR_GENDER_WORDS) if (pattern.test(name)) return gender;
  const votes = { f: 0, m: 0 };
  for (const scene of project.scenes) {
    if (scene.kind === 'title') continue;
    const gender = genderFor(scene.text || '', name);
    if (gender) votes[gender]++;
  }
  if (votes.f === votes.m) return null;
  return votes.f > votes.m ? 'f' : 'm';
}

function ageFor(text, name) {
  // A beat that does not mention them says nothing about them. Reading the whole beat
  // instead made everyone in a story containing "the old potter" old. The window is
  // narrow for the same reason: "even a child may teach a king" must not age the king.
  const near = nearName(text, name, 3, 2);
  if (near == null) return null;
  for (const [age, pattern] of MR_AGE_WORDS) if (pattern.test(near)) return age;
  return null;
}

// Whoever the story calls a boy or an old woman IS one, in every scene — age is a fact
// about a character, not about a beat, so it is read once across the whole reel.
function ageAcrossStory(project, name) {
  for (const scene of project.scenes) {
    if (scene.kind === 'title') continue;
    const age = ageFor(scene.text || '', name);
    if (age) return age;
  }
  // An unnamed role can carry its own age: "the child", "the sage".
  for (const [age, pattern] of MR_AGE_WORDS) if (pattern.test(name)) return age;
  return 'adult';
}

// The article is what marks a role as a character rather than a passing mention: "the
// potter looked up" is a person, "he was a potter by trade" mostly is not.
function rolesInText(text) {
  const found = [];
  for (const role of MR_ROLE_NOUNS) {
    if (new RegExp('\\b(the|a|an|old|young|poor|rich)\\s+' + role + '\\b', 'i').test(text)) {
      const name = role[0].toUpperCase() + role.slice(1);
      if (found.indexOf(name) === -1) found.push(name);
    }
  }
  return found;
}

// ---------------------------------------------------------------- casting

// A character's appearance is derived from their NAME, so Arjuna looks like Arjuna in
// every scene without anybody storing a character sheet. This is the one place where
// drawn characters are simply better than generated ones: consistency is free.
function appearanceFor(name) {
  const h = mrHash(name);
  const pick = (list, shift) => list[Math.floor(h / Math.pow(7, shift)) % list.length];
  const tops = ['#c2452d', '#1f7a53', '#3a5cc8', '#7a4bff', '#e0a33f', '#e8e2d8', '#b4542f'];
  const bottoms = ['#3d4657', '#8a6a3f', '#4a5568', '#2b2f45', '#6b4a2b'];
  return {
    body: pick(['average', 'tall', 'sturdy', 'slight'], 0),
    skin: pick(MR_SKINS, 1),
    hair: pick(MR_HAIRS, 2),
    hairStyle: pick(MR_HAIR_STYLES.filter((s) => s !== 'bald'), 3),
    top: pick(tops, 4),
    bottom: pick(bottoms, 5),
    trim: '#e8c46a'
  };
}

// Everybody the story names, most-mentioned first. Capped, because a stage with nine
// people on it is a crowd scene nobody asked for.
function castFromStory(project, limit) {
  const counts = new Map();
  const add = (name, weight) => counts.set(name, (counts.get(name) || 0) + weight);
  for (const scene of project.scenes) {
    if (scene.kind === 'title') continue;
    const text = scene.text || '';
    // Named characters first — a name is the strongest signal a story gives.
    mrProperNouns(text).forEach((name, i) => add(name, i === 0 ? 3 : 2));
    // Then the unnamed ones the story refers to by role.
    for (const role of rolesInText(text)) add(role, 2);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit || 5)
    .map(([name]) => name);
}

// ---------------------------------------------------------------- reading a beat

// Which of the cast this beat is about, in the order the sentence introduces them.
function namesInBeat(text, cast) {
  const found = [];
  for (const name of cast) {
    const at = text.toLowerCase().indexOf(name.toLowerCase());
    if (at >= 0) found.push({ name, at });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.name);
}

// The action a beat implies. Looks at the clause after each name where it can, so
// "Arjuna knelt while Krishna spoke" gives two different answers.
function actionFor(text, name) {
  const whole = String(text);
  const sentences = whole.split(/(?<=[.!?])\s+/);
  const match = (fragment) => {
    for (const [action, pattern] of MR_ACTION_VERBS) if (pattern.test(fragment)) return action;
    return null;
  };
  if (name) {
    const sentence = sentences.find((line) => line.toLowerCase().indexOf(name.toLowerCase()) >= 0);
    if (sentence) {
      const at = sentence.toLowerCase().indexOf(name.toLowerCase());
      const rest = sentence.slice(at + name.length);
      const end = rest.search(/[,.;:!?]|\band\b|\bwhile\b|\bbut\b/i);
      // The clause about this character, then the sentence they are in — and no further.
      // Scanning the whole beat borrows verbs from other people's sentences, which is how
      // "Aruna looked up" first came out as a walk (from a later "you have walked").
      return match(end > 3 ? rest.slice(0, end) : rest) || match(sentence) || 'idle';
    }
  }
  return match(whole) || 'idle';
}

// Who is speaking this beat, if anyone: a name attached to a speech verb, or the only
// person present when the beat is in quotes.
function speakerFor(text, names) {
  // Everything here works sentence by sentence. An earlier version tested the whole beat
  // for "name ... said" and so heard speech in "the traveller sat down and said nothing
  // at all" — the one sentence in the story that is explicitly about not speaking.
  const speech = /\b(said|asked|replied|answered|told|called|cried|shouted|whispered|spoke)\b/i;
  const silence = /\bsaid\s+(nothing|not a word|no word)|\bspoke\s+no\b|\bwithout a word\b|\bin silence\b|\bsaid nothing\b/i;
  let lastNamed = null;

  for (const sentence of String(text).split(/(?<=[.!?])\s+/)) {
    const here = names.filter((name) => sentence.toLowerCase().indexOf(name.toLowerCase()) >= 0);
    if (here.length === 1) lastNamed = here[0];
    if (!speech.test(sentence) || silence.test(sentence)) continue;
    // A name in the same sentence as the speech verb.
    if (here.length === 1) return here[0];
    if (here.length > 1) {
      // Two names in one sentence: the SUBJECT speaks, not whoever happens to sit nearest
      // the verb — "Arjuna turned to Krishna and asked" is Arjuna asking. When every name
      // follows the verb the attribution is inverted ("said the king to the boy"), and
      // then the first name after it is the speaker.
      const verbAt = sentence.search(speech);
      const placed = here
        .map((name) => ({ name, at: sentence.toLowerCase().indexOf(name.toLowerCase()) }))
        .sort((a, b) => a.at - b.at);
      const before = placed.filter((entry) => entry.at < verbAt);
      return (before.length ? before[0] : placed[0]).name;
    }
    // No name at all: "she said" belongs to whoever was named last.
    if (lastNamed) return lastNamed;
  }
  if (/["\u201c']/.test(text) && names.length === 1 && !silence.test(text)) return names[0];
  return null;
}

// Scenery the words put on the stage, at most two per beat so the frame stays readable.
// Monumental places have no single shape — a palace is a fort in one century and a
// pillared court in another — so the period says which landmark stands in for them.
const MR_MONUMENT = /\b(palace|temple|fort|castle|citadel|tomb|shrine|court|capital|city|pyramid)\b/i;

function sceneryFor(text, period) {
  const found = [];
  if (period && period.landmark && MR_MONUMENT.test(text)) found.push(period.landmark);
  for (const [kind, pattern] of MR_SCENERY_NOUNS) {
    if (found.indexOf(kind) < 0 && pattern.test(text)) found.push(kind);
    if (found.length >= 2) break;
  }
  return found.slice(0, 2);
}

// ---------------------------------------------------------------- blocking

// Where people stand. Two characters face each other; a crowd spreads out; everyone gets
// a slightly different size so the stage has depth instead of a line-up.
function blockingFor(count) {
  if (count <= 1) return [{ x: 0.5, scale: 0.52, facing: 'right' }];
  if (count === 2) {
    return [
      { x: 0.34, scale: 0.52, facing: 'right' },
      { x: 0.68, scale: 0.5, facing: 'left' }
    ];
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    out.push({
      x: 0.16 + t * 0.68,
      scale: 0.46 + ((i % 2) ? 0.06 : 0),
      facing: t < 0.5 ? 'right' : 'left'
    });
  }
  return out;
}

const MR_SCENERY_PLACES = {
  tree: { x: 0.87, y: 0.88, scale: 0.42, layer: 'back', tint: '#2f7a45' },
  house: { x: 0.15, y: 0.86, scale: 0.34, layer: 'back', tint: '#a08765' },
  pyramid: { x: 0.2, y: 0.78, scale: 0.34, layer: 'back', tint: '#d8bd82' },
  tower: { x: 0.16, y: 0.84, scale: 0.4, layer: 'back', tint: '#8f8a80' },
  column: { x: 0.12, y: 0.9, scale: 0.44, layer: 'back', tint: '#e8e0cc' },
  mountain: { x: 0.26, y: 0.7, scale: 0.32, layer: 'back', tint: '#5c6f82' },
  cloud: { x: 0.72, y: 0.28, scale: 0.16, layer: 'back', tint: '#cfd8e3' },
  well: { x: 0.2, y: 0.92, scale: 0.2, layer: 'stage', tint: '#8a7a63' },
  fire: { x: 0.5, y: 0.94, scale: 0.14, layer: 'stage', tint: '#e2622a' },
  cart: { x: 0.8, y: 0.93, scale: 0.22, layer: 'stage', tint: '#b4542f' },
  pot: { x: 0.24, y: 0.94, scale: 0.11, layer: 'stage', tint: '#b4542f' },
  chair: { x: 0.78, y: 0.92, scale: 0.2, layer: 'stage', tint: '#8a6a3f' },
  table: { x: 0.7, y: 0.92, scale: 0.22, layer: 'stage', tint: '#8a6a3f' },
  banner: { x: 0.9, y: 0.9, scale: 0.34, layer: 'stage', tint: '#c2452d' },
  spear: { x: 0.12, y: 0.92, scale: 0.3, layer: 'stage', tint: '#8a8f98' },
  rock: { x: 0.08, y: 0.97, scale: 0.16, layer: 'front', tint: '#8a7a63' },
  bush: { x: 0.94, y: 1.0, scale: 0.18, layer: 'front', tint: '#3f8a55' }
};

// ---------------------------------------------------------------- directing

// Stage one beat. `carried` is the cast of the previous scene, used when a beat names
// nobody — a story does not re-introduce its people in every sentence, and an empty stage
// mid-conversation looks like a mistake.
function directScene(scene, cast, carried, project, slots, ages, genders) {
  if (scene.kind === 'title') return { actors: [], props: [] };
  const period = typeof projectPeriod === 'function' ? projectPeriod(project) : null;
  const text = scene.text || '';
  const named = namesInBeat(text, cast);
  // Whoever was on stage stays on stage unless the story moves somewhere else: a
  // conversation does not re-introduce both speakers in every sentence, and dropping the
  // listener between lines makes a two-hander look like two monologues.
  let names = named.slice();
  for (const name of carried || []) {
    if (names.length >= 3) break;
    if (names.indexOf(name) === -1) names.push(name);
  }
  if (!names.length && cast.length) names = [cast[0]];

  // Stable screen direction: once a character has a side of the stage, they keep it for
  // the rest of the reel. Blocking by "whoever the sentence names first" makes people
  // teleport across the frame between beats, which reads as a continuity error.
  if (slots) {
    for (const name of names) if (!slots.has(name)) slots.set(name, slots.size);
    names.sort((a, b) => slots.get(a) - slots.get(b));
  }

  const speaker = speakerFor(text, names);
  const blocking = blockingFor(names.length);
  const mood = MR_MOOD_FACES[scene.mood] || 'calm';

  const actors = names.map((name, i) => {
    const spot = blocking[i];
    // Someone the beat does not mention is present but not acting.
    const action = named.indexOf(name) >= 0 ? actionFor(text, name) : 'idle';
    const isSpeaker = speaker === name;
    const actor = makeActor(name, Object.assign({}, appearanceFor(name), {
      age: (ages && ages.get(name)) || 'adult',
      speaker: isSpeaker,
      start: {
        x: spot.x, y: 0.88, scale: spot.scale, facing: spot.facing,
        action: isSpeaker ? 'talk' : action,
        expression: isSpeaker ? 'calm' : mood
      }
    }));
    // An arrival walks in from the edge and stops where they were blocked.
    if (action === 'walk' && MR_ARRIVAL.test(text) && !isSpeaker) {
      const fromLeft = spot.x >= 0.5;
      actor.keys = [Object.assign({}, MR_DEFAULT_KEY, {
        t: 0, x: fromLeft ? -0.08 : 1.08, y: 0.88,
        scale: spot.scale * 0.85, facing: fromLeft ? 'right' : 'left', action: 'walk', expression: mood
      })];
      setKey(actor, Math.max(1.2, scene.duration * 0.7), {
        x: spot.x, scale: spot.scale, action: 'idle', expression: mood
      });
    }
    return actor;
  });

  // Everyone is dressed for the era before they are staged, so the reel is never briefly
  // a set of moderns standing in ancient Egypt.
  if (period && typeof dressActorForPeriod === 'function') {
    for (const actor of actors) {
      dressActorForPeriod(actor, period, { gender: genders && genders.get(actor.name) });
    }
  }

  const props = sceneryFor(text, period).map((kind) => {
    const place = MR_SCENERY_PLACES[kind] || MR_SCENERY_PLACES.tree;
    return makeProp(kind, {
      tint: place.tint, layer: place.layer,
      start: { x: place.x, y: place.y, scale: place.scale }
    });
  });

  return { actors, props, speaker };
}

// Direct the whole reel. Returns a summary the UI can report, because "it did something"
// is not a useful thing for a button to say.
function directProject(project, opts) {
  const o = opts || {};
  const cast = castFromStory(project, o.castLimit || 5);
  // Age is decided once for the whole reel, from every mention of the character: a boy in
  // the first beat is still a boy in the last one.
  const ages = new Map(cast.map((name) => [name, ageAcrossStory(project, name)]));
  const genders = new Map(cast.map((name) => [name, genderAcrossStory(project, name)]));
  const slots = new Map();
  let carried = [];
  let staged = 0, spoken = 0, propped = 0;

  for (const scene of project.scenes) {
    const result = directScene(scene, cast, carried, project, slots, ages, genders);
    if (!result.actors.length && !result.props.length) continue;
    scene.stage = makeStage({ actors: result.actors, props: result.props });
    if (result.actors.length) {
      carried = result.actors.map((a) => a.name);
      staged++;
    }
    if (result.props.length) propped++;
    if (result.speaker) {
      spoken++;
      // Dialogue wants a balloon; narration keeps whatever the reel is using.
      if (scene.captionStyle !== 'none' && scene.captionStyle !== 'title') scene.captionStyle = 'balloon';
    }
    // The camera should not swing about over a staged scene; the performance is the move.
    if (scene.motion === 'shake' || scene.motion === 'push') scene.motion = 'drift';
    scene.intensity = Math.min(scene.intensity, 0.55);
  }
  const period = typeof projectPeriod === 'function' ? projectPeriod(project) : null;
  return { cast, staged, spoken, propped, ages, period: period && period.name };
}
