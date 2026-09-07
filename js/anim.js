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
const MR_STEPPED = ['facing', 'action', 'expression'];

const MR_DEFAULT_KEY = {
  t: 0,
  x: 0.5,            // fraction of frame width
  y: 0.86,           // ground line, fraction of frame height
  scale: 0.55,       // actor height as a fraction of frame height
  rotate: 0,
  facing: 'right',
  action: 'idle',
  expression: 'calm'
};

let mrActorCounter = 0;
function mrActorId() { mrActorCounter += 1; return 'a' + mrActorCounter.toString(36) + Date.now().toString(36).slice(-3); }

function makeActor(name, opts) {
  const o = opts || {};
  return {
    id: mrActorId(),
    name: name || 'Character',
    body: o.body || 'average',
    skin: o.skin || MR_SKINS[1],
    hair: o.hair || MR_HAIRS[0],
    hairStyle: o.hairStyle || 'short',
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

// Is this actor talking right now? True while the scene's narration is playing, for
// whichever actor is marked the speaker — which is what drives the mouth.
function actorSpeaking(actor, scene, localT) {
  if (!actor.speaker) return false;
  if (scene.narration && scene.narration.seconds) return localT < scene.narration.seconds;
  // With no narration, an actor set to "talk" mouths for the whole beat.
  return actorStateAt(actor, localT).action === 'talk';
}

// ---------------------------------------------------------------- the stage

function makeStage(opts) {
  const o = opts || {};
  return { actors: o.actors || [], ground: o.ground != null ? o.ground : 0.86 };
}

// Draw every actor on a scene, back to front by size so a smaller (further) character
// cannot cover a nearer one.
function drawStage(ctx, scene, localT, w, h) {
  const stage = scene.stage;
  if (!stage || !stage.actors || !stage.actors.length) return false;
  const ordered = stage.actors
    .map((actor) => ({ actor, state: actorStateAt(actor, localT) }))
    .sort((a, b) => a.state.scale - b.state.scale);

  for (const { actor, state } of ordered) {
    const pose = poseFor(state.action, localT, actor.seed, actorSpeaking(actor, scene, localT));
    const height = state.scale * h;
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
    drawActor(ctx, actor, pose, state.x * w, state.y * h, height);
    ctx.restore();
  }
  return true;
}

// Which actor is under a point on the frame — the editor's hit test, kept here because it
// has to agree with how drawStage lays actors out. Nearest (largest) first.
function actorAtPoint(scene, localT, fx, fy) {
  const stage = scene.stage;
  if (!stage || !stage.actors) return null;
  const candidates = stage.actors
    .map((actor) => ({ actor, state: actorStateAt(actor, localT) }))
    .sort((a, b) => b.state.scale - a.state.scale);
  for (const { actor, state } of candidates) {
    const halfWidth = state.scale * 0.16;                   // generous: fingers are thin
    const top = state.y - state.scale;
    if (fx >= state.x - halfWidth && fx <= state.x + halfWidth && fy >= top && fy <= state.y + 0.02) {
      return actor;
    }
  }
  return null;
}
