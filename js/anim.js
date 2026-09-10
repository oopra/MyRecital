// anim.js — the timeline.
//
// An actor is a puppet plus a list of keyframes. Everything you can direct — where they
// stand, how big they are, which way they face, what they are doing, how they feel — is a
// property on a keyframe, and the value at any moment is interpolated between the two keys
// on either side of it.
//
// Numeric properties (position, scale) ease between keys, because that is motion.
// Categorical ones (action, expression, facing) hold until the next key and then switch,
// because a character cannot be 40% waving.

const MR_TWEENED = ['x', 'y', 'scale', 'rotate'];
const MR_STEPPED = ['facing', 'action', 'expression', 'lookAt'];

const MR_DEFAULT_KEY = {
  t: 0,
  x: 0.5,            // fraction of frame width
  y: 0.86,           // ground line, fraction of frame height
  scale: 0.55,       // actor height as a fraction of frame height
  rotate: 0,
  facing: 'right',
  action: 'idle',
  expression: 'calm',
  lookAt: ''         // the name of somebody (or something) on this stage to watch
};

let mrActorCounter = 0;
function mrActorId() { mrActorCounter += 1; return 'a' + mrActorCounter.toString(36) + Date.now().toString(36).slice(-3); }

function makeActor(name, opts) {
  const o = opts || {};
  return {
    id: mrActorId(),
    name: name || 'Character',
    age: o.age || 'adult',            // child, youth, adult or elder — proportions and pace
    body: o.body || 'average',
    skin: o.skin || MR_SKINS[1],
    hair: o.hair || MR_HAIRS[0],
    hairStyle: o.hairStyle || 'short',
    costume: o.costume || 'modern',
    headwear: o.headwear || 'none',
    headwearColour: o.headwearColour || '#e8e2d8',
    trim: o.trim || '#e8c46a',
    look: o.look || '',            // blank means "whatever the project is set to"
    top: o.top || '#3a5cc8',
    bottom: o.bottom || '#2b2f45',
    seed: o.seed != null ? o.seed : Math.floor(Math.random() * 1000),
    speaker: o.speaker || false,      // mouths the narration on this scene
    keys: o.keys || [Object.assign({}, MR_DEFAULT_KEY, o.start || {})]
  };
}

// Keys are kept sorted by time; the editor adds them in any order.
function sortKeys(actor) {
  actor.keys.sort((a, b) => a.t - b.t);
  return actor;
}

// Set (or update) a keyframe at time t. Keys within a frame of each other are the same
// key — otherwise clicking twice on the same moment silently makes two.
function setKey(actor, t, values) {
  const at = Math.max(0, Math.round(t * 100) / 100);
  const existing = actor.keys.find((k) => Math.abs(k.t - at) < 0.04);
  if (existing) { Object.assign(existing, values, { t: existing.t }); return existing; }
  const key = Object.assign({}, actorStateAt(actor, at), values, { t: at });
  actor.keys.push(key);
  sortKeys(actor);
  return key;
}

function removeKey(actor, t) {
  if (actor.keys.length <= 1) return false;      // an actor always keeps one pose
  const i = actor.keys.findIndex((k) => Math.abs(k.t - t) < 0.04);
  if (i < 0) return false;
  actor.keys.splice(i, 1);
  return true;
}

// render.js already owns mrEaseInOut; these scripts share one global scope, so a
// second const of that name kills the page on load.
const mrEaseKey = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

// The actor's full state at a moment inside its scene.
function actorStateAt(actor, t) {
  const keys = actor.keys;
  if (!keys.length) return Object.assign({}, MR_DEFAULT_KEY);
  if (keys.length === 1 || t <= keys[0].t) return Object.assign({}, MR_DEFAULT_KEY, keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.t) return Object.assign({}, MR_DEFAULT_KEY, last);

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const u = span > 0 ? mrEaseKey((t - a.t) / span) : 0;

  const state = Object.assign({}, MR_DEFAULT_KEY, a);
  for (const prop of MR_TWEENED) {
    const from = a[prop] != null ? a[prop] : MR_DEFAULT_KEY[prop];
    const to = b[prop] != null ? b[prop] : from;
    state[prop] = from + (to - from) * u;
  }
  for (const prop of MR_STEPPED) {
    state[prop] = a[prop] != null ? a[prop] : MR_DEFAULT_KEY[prop];
  }
  // Walking between two positions should look like walking, even if you only set where
  // they start and where they end — the commonest thing a person wants, and the commonest
  // thing they forget to key.
  if (state.action === 'idle' && Math.abs((b.x != null ? b.x : a.x) - a.x) > 0.02 && u > 0 && u < 1) {
    state.action = 'walk';
    state.facing = (b.x > a.x) ? 'right' : 'left';
  }
  return state;
}

// When did the action showing at time t begin? Gestures need a start — an arm that
// appears already raised has no life in it — and blending needs to know how long ago the
// pose changed.
function actionStartAt(actor, t) {
  const keys = actor.keys || [];
  let start = 0;
  let current = null;
  for (const key of keys) {
    if (key.t > t + 0.0001) break;
    const action = key.action || MR_DEFAULT_KEY.action;
    if (action !== current) { current = action; start = key.t; }
  }
  return { action: current || MR_DEFAULT_KEY.action, start, previous: previousAction(actor, start) };
}

function previousAction(actor, before) {
  let current = null;
  for (const key of actor.keys || []) {
    if (key.t >= before - 0.0001) break;
    current = key.action || MR_DEFAULT_KEY.action;
  }
  return current;
}

// How far this actor has travelled, in strides, over time. Tying the walk cycle to
// distance rather than to the clock is what stops the feet skating: a character crossing
// the stage slowly takes slow steps, and one standing still stops stepping.
//
// The sampling grid is part of the contract, not an implementation detail: the footstep
// sounds are generated from this same track, and a step that lands a frame off the foot is
// worse than no step at all.
const MR_STRIDE_STEP = 0.05;

function strideTrack(actor, upTo, state) {
  const keys = actor.keys || [];
  if (keys.length < 2) return null;
  // A stride is about two steps, and a step is a bit under half a leg length. Everything
  // is in frame fractions, so it scales with how big the character is drawn.
  // Short legs take short steps: a child crossing the same distance takes more of them.
  const age = ageOf(actor.age);
  const strideLength = Math.max(0.001, 0.42 * ((state && state.scale) || 0.5) * age.height * age.legs);
  const track = [];
  let distance = 0;
  let previous = stateAt(actor, keys[0].t);
  for (let time = keys[0].t; time < upTo; time += MR_STRIDE_STEP) {
    const here = stateAt(actor, time);
    distance += Math.abs(here.x - previous.x);
    previous = here;
    track.push({ t: time, cycles: distance / strideLength });
  }
  const last = stateAt(actor, upTo);
  distance += Math.abs(last.x - previous.x);
  track.push({ t: upTo, cycles: distance / strideLength });
  return track;
}

function strideCycles(actor, t, state) {
  const track = strideTrack(actor, t, state);
  return track ? track[track.length - 1].cycles : null;
}

// Where a character is looking, as a point on the frame. A person is looked at in the
// eye, a prop in the middle of itself, and a prop somebody is carrying is really that
// person, since that is where it is. `frame` is the size the stage is being drawn at,
// because an angle needs both dimensions and the stage is kept in fractions of them.
function gazeTarget(scene, name, t, frame) {
  const stage = scene.stage;
  if (!stage || !name || !frame) return null;
  const actor = (stage.actors || []).find((a) => a.name === name);
  if (actor) {
    const state = stateAt(actor, t);
    const height = actorHeight(actor, state.scale * frame.h);
    const m = actorMetrics(actor, height, frame.look);
    return { x: state.x * frame.w, y: state.y * frame.h + m.headY };
  }
  const prop = (stage.props || []).find((p) => p.name === name || p.kind === name);
  if (!prop) return null;
  // Whatever they are carrying is at the end of their arm, so look at them.
  if (propIsHeld(prop)) return gazeTarget(scene, prop.heldBy, t, { w: frame.w, h: frame.h, look: frame.look });
  const state = stateAt(prop, t);
  return { x: state.x * frame.w, y: state.y * frame.h - state.scale * frame.h * 0.5 };
}

// The pose an actor is in right now: the right cycle, started at the right moment, and
// cross-faded from whatever they were doing before. `frame` is optional; without it the
// pose is the same except that nobody is watching anybody, since a gaze is geometry and
// geometry needs to know how big the frame is.
function posedFor(actor, scene, localT, project, frame) {
  const state = stateAt(actor, localT);
  const { action, start, previous } = actionStartAt(actor, localT);
  const speaking = actorSpeaking(actor, scene, localT, project);
  const tIn = Math.max(0, localT - start);

  const opts = { tIn, pace: ageOf(actor.age).pace };
  // Looking at somebody turns the head, and aims the arm if they are pointing.
  const target = state.lookAt && state.lookAt !== actor.name
    ? gazeTarget(scene, state.lookAt, localT, frame) : null;
  let facing = state.facing;
  if (target) {
    // Nobody points over their own shoulder: pointing at a thing behind you means turning
    // round to point at it. Looking is different — a glance back is an ordinary thing to
    // do — so only the gesture turns the body.
    if (action === 'point') facing = target.x >= state.x * frame.w ? 'right' : 'left';
    const height = actorHeight(actor, state.scale * frame.h);
    const aims = aimAngles(actor, facing, state.x * frame.w, state.y * frame.h, height, frame.look, target);
    opts.gaze = aims.gaze;
    opts.aim = aims.arm;
  }
  if (action === 'walk') {
    const cycles = strideCycles(actor, localT, state);
    // Walking on the spot still needs a cycle, so fall back to the clock when the
    // character is not actually going anywhere.
    if (cycles != null && cycles > 0.02) opts.cycle = cycles;
  }
  const pose = poseFor(action, localT, actor.seed, speaking, opts);
  // Which way they are facing is part of the moment, and the drawing reads it from here.
  pose.facing = facing;
  if (!previous || previous === action) return pose;

  // Ease out of the previous action rather than snapping — a character should sit down,
  // not teleport into a sitting position.
  const blend = mrSat(tIn / 0.28);
  if (blend >= 1) return pose;
  const before = poseFor(previous, localT, actor.seed, speaking,
    { tIn: tIn + 1, pace: opts.pace, gaze: opts.gaze, aim: opts.aim });
  before.facing = facing;
  return blendPoses(before, pose, mrEaseKey(blend));
}

// How much this actor's mouth is open right now, 0..1 (or false for "not speaking").
// With narration it follows the measured loudness of the line AND the shapes of the words
// in it — real lip sync. Without narration, the words are still known even though their
// timing is not, so the same shapes are spent at an ordinary speaking rate.
function actorSpeaking(actor, scene, localT, project) {
  // When the reel speaks its own lines, the mouth that moves is the one the line belongs
  // to — which is not necessarily whoever is marked as reading the narration.
  if (project && typeof spokenMouthFor === 'function' && !(scene.narration && scene.narration.seconds)) {
    const mine = spokenMouthFor(project, scene, actor, localT);
    if (mine) return mine;
    if (voicesOn(project)) return false;
  }
  if (!actor.speaker && !(scene.narration && scene.narration.seconds)) {
    // Anyone else set to "talk" still moves their mouth; we just have nothing to sync to.
    return false;
  }
  if (scene.narration && scene.narration.seconds) {
    if (localT >= scene.narration.seconds) return false;
    // A recorded beat is a list of lines with a name on each. The mouth that moves is the
    // one the line belongs to; the narrator's own reading goes to whoever is marked.
    if (typeof narrationSpeakerAt === 'function') {
      const who = narrationSpeakerAt(scene, localT);
      if (who === undefined) return false;                 // between lines: mouths shut
      if (who && who !== actor.name) return false;
      // Narration over a beat that also has dialogue in it belongs to nobody on stage.
      if (!who && (!actor.speaker || (typeof narrationHasDialogue === 'function' && narrationHasDialogue(scene)))) {
        return false;
      }
    } else if (!actor.speaker) return false;
    const measured = typeof mouthAt === 'function' ? mouthAt(scene, localT) : null;
    return measured != null ? measured : true;
  }
  if (actorStateAt(actor, localT).action !== 'talk') return false;
  const spoken = typeof spokenMouthAt === 'function' ? spokenMouthAt(scene.text, localT) : null;
  return spoken || true;
}

// ---------------------------------------------------------------- the stage

function makeStage(opts) {
  const o = opts || {};
  return { actors: o.actors || [], props: o.props || [], ground: o.ground != null ? o.ground : 0.86 };
}

// Props and actors share one keyframe model, so `stateAt` is the same function for both —
// which is what lets a cart be driven across the stage exactly like a person walks it.
const stateAt = actorStateAt;

// Everything on stage, in the order it should be painted: scenery behind, then actors and
// stage-level props by size so nearer figures cover further ones, then foreground.
const MR_LAYER_ORDER = { back: 0, stage: 1, front: 2 };
// A prop in somebody's hand is not on the stage on its own account: it is drawn with the
// person holding it, and it cannot be dragged or keyframed separately.
// A prop only counts as held if it is the kind of thing a hand closes around and the
// person named is actually in this scene; otherwise it stays on the ground, where at
// least it can be seen and put right.
function propIsHeld(prop, holders) {
  return !!(prop.heldBy && propIsHoldable(prop.kind) && (!holders || holders.has(prop.heldBy)));
}

function heldProps(scene, name) {
  return ((scene.stage && scene.stage.props) || []).filter((prop) => prop.heldBy === name && propIsHoldable(prop.kind));
}

function stageItems(scene, t) {
  const stage = scene.stage;
  if (!stage) return [];
  const holders = new Set((stage.actors || []).map((a) => a.name));
  const items = [];
  for (const prop of stage.props || []) {
    if (propIsHeld(prop, holders)) continue;
    items.push({ kind: 'prop', item: prop, state: stateAt(prop, t), layer: MR_LAYER_ORDER[prop.layer] != null ? MR_LAYER_ORDER[prop.layer] : 0 });
  }
  for (const actor of stage.actors || []) {
    items.push({ kind: 'actor', item: actor, state: stateAt(actor, t), layer: 1 });
  }
  items.sort((a, b) => a.layer - b.layer || a.state.scale - b.state.scale);
  return items;
}

// Draw every actor on a scene, back to front by size so a smaller (further) character
// cannot cover a nearer one.
function drawStage(ctx, scene, localT, w, h, look, project) {
  const items = stageItems(scene, localT);
  if (!items.length) return false;

  for (const entry of items) {
    const { item, state } = entry;
    if (entry.kind === 'prop') {
      drawProp(ctx, item, state, w, h);
      continue;
    }
    const pose = posedFor(item, scene, localT, project, { w, h, look });
    // The size slider says where they stand in the frame; their age says how tall they are.
    const height = actorHeight(item, state.scale * h);
    ctx.save();
    if (state.rotate) {
      ctx.translate(state.x * w, state.y * h);
      ctx.rotate(state.rotate);
      ctx.translate(-state.x * w, -state.y * h);
    }
    // A soft contact shadow: without one, characters look pasted on rather than standing.
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(state.x * w, state.y * h, height * 0.14, height * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawActor(ctx, item, pose, state.x * w, state.y * h, height, look);
    // Anything they are carrying goes on last, in the hand, in front of them.
    for (const prop of heldProps(scene, item.name)) {
      const side = prop.hand === 'left' ? -1 : 1;
      const hand = actorHandPoint(item, pose, state.x * w, state.y * h, height, look, side);
      drawHeldProp(ctx, prop, hand, height);
    }
    ctx.restore();
  }
  return true;
}

// Which actor is under a point on the frame — the editor's hit test, kept here because it
// has to agree with how drawStage lays actors out. Nearest (largest) first.
function actorAtPoint(scene, localT, fx, fy) {
  // Front to back, so clicking overlapping things picks the one you can see. Actors win
  // ties against scenery, since scenery is usually what you are trying to click past.
  const candidates = stageItems(scene, localT).slice().reverse();
  for (const entry of candidates) {
    const { item, state } = entry;
    const spec = entry.kind === 'prop' ? MR_PROPS[item.kind] : null;
    const ratio = spec ? spec.ratio : 0.32;                 // width as a share of height
    // A child is drawn shorter, so the box you can click has to be shorter too.
    const drawn = spec ? state.scale : actorHeight(item, state.scale);
    const halfWidth = drawn * Math.max(0.14, ratio / 2);
    const top = state.y - drawn * (spec ? 1.05 : 1);
    if (fx >= state.x - halfWidth && fx <= state.x + halfWidth && fy >= top && fy <= state.y + 0.02) {
      return item;
    }
  }
  return null;
}
