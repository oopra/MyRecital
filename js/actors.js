// actors.js — the puppets.
//
// A character is not a picture: it is a small skeleton plus a colour scheme, drawn fresh
// every frame from joint angles. That is what makes it animatable — you can pose it, walk
// it, make it talk and point, and none of that needs an artist or an image model.
//
// Everything here is a pure function of (actor, pose, size). No state, no DOM, no clock —
// the same contract renderFrame() already keeps, so actors scrub and record exactly like
// the rest of the reel.

// Body presets are ratios of the actor's height, so one number scales a whole figure.
// Ratios of the actor's total height. `head` is the head's DIAMETER: a cartoon figure is
// about six heads tall, and the face has to be big enough to carry an expression at phone
// size — a realist eighth-of-height head reads as a smudge.
const MR_BODIES = {
  average: { name: 'Average', head: 0.17, shoulders: 0.21, hips: 0.15, torso: 0.26, legs: 0.47 },
  tall:    { name: 'Tall',    head: 0.15, shoulders: 0.22, hips: 0.15, torso: 0.26, legs: 0.51 },
  sturdy:  { name: 'Sturdy',  head: 0.18, shoulders: 0.27, hips: 0.21, torso: 0.28, legs: 0.42 },
  slight:  { name: 'Slight',  head: 0.17, shoulders: 0.18, hips: 0.13, torso: 0.25, legs: 0.48 },
  child:   { name: 'Child',   head: 0.24, shoulders: 0.18, hips: 0.15, torso: 0.24, legs: 0.40 }
};

// A "look" is the drawing style of the whole cast: line weight and colour, how big the
// head and eyes are relative to the body, whether faces carry a nose and blush. Indian
// comic art (Tinkle, Amar Chitra Katha) is rounder, heavier-inked and warmer than the
// neutral explainer-video look, and those are the numbers that carry the difference.
const MR_LOOKS = {
  natural: { name: 'Natural',  ink: '#15100e', inkWeight: 1,    head: 1,    eye: 1,    limb: 1,    brow: 1,    nose: false, blush: false },
  comic:   { name: 'Comic',    ink: '#2a1c12', inkWeight: 1.75, head: 1.24, eye: 1.32, limb: 1.18, brow: 1.4,  nose: true,  blush: true },
  storybook: { name: 'Storybook', ink: '#3a2a1c', inkWeight: 1.35, head: 1.34, eye: 1.45, limb: 1.1, brow: 1.2, nose: true, blush: true }
};

function lookOf(name) {
  return MR_LOOKS[name] || MR_LOOKS.natural;
}

// Age is not a body preset — it multiplies whichever body you picked, so a sturdy child
// and a slight child are both recognisably children. The numbers are the ones that
// actually read at phone size: how big the head is against the body, how tall the figure
// stands next to the adults, how fast it moves, and how much it stoops.
//
// A child is not a small adult. Its head is nearly a quarter of its height, its legs are
// proportionally shorter, and it moves faster and more often. An elder stands a little
// lower, leans forward, and moves slowly. Get those four numbers right and a crowd scene
// reads as a family without a word of explanation.
const MR_AGES = {
  child:  { name: 'Child (5-10)',    head: 1.34, height: 0.68, legs: 0.86, limb: 0.92, eye: 1.16, pace: 1.35, stoop: 0 },
  youth:  { name: 'Young (11-17)',   head: 1.14, height: 0.86, legs: 0.94, limb: 0.96, eye: 1.08, pace: 1.15, stoop: 0 },
  adult:  { name: 'Grown-up',        head: 1,    height: 1,    legs: 1,    limb: 1,    eye: 1,    pace: 1,    stoop: 0 },
  elder:  { name: 'Old',             head: 1.02, height: 0.94, legs: 0.97, limb: 0.98, eye: 0.94, pace: 0.72, stoop: 0.11 }
};

function ageOf(name) {
  return MR_AGES[name] || MR_AGES.adult;
}

// The height an actor is actually drawn at. Age belongs here rather than in the size
// slider: the slider is where the character stands in the frame, age is who they are, and
// keeping them apart means putting a child next to an adult does not need arithmetic.
function actorHeight(actor, baseHeight) {
  return baseHeight * ageOf(actor && actor.age).height;
}

const MR_SKINS = ['#f2c9a0', '#e0aa7c', '#c98b5e', '#a8663c', '#7d4b2c', '#5a3520'];
const MR_HAIRS = ['#1c1512', '#3b2a1d', '#6b4a2b', '#a8722e', '#8d8d95', '#e8e2d8', '#2b3a55'];
const MR_HAIR_STYLES = ['short', 'long', 'bun', 'bald', 'braid'];

// What the character is wearing. 'modern' is a top and trousers; the rest are silhouettes
// from somewhere and sometime, because a history reel lives or dies on whether the people
// in it are dressed for the century. Silhouette does more work than colour ever will: a
// toga and a frock coat are the same two arms and two legs until you cut the cloth.
const MR_COSTUMES = [
  'modern', 'kurta', 'dhoti', 'saree', 'robe',
  'kilt',    // Egyptian schenti: a short wrapped linen skirt
  'chiton',  // Greek: a pinned tunic to the knee or the ankle
  'toga',    // Roman: the chiton with a draped band over one shoulder
  'gown',    // Medieval European: a long belted dress or surcoat
  'jama',    // Mughal: a flared coat tied at the side, over churidar
  'coat'     // Frock coat: colonial through Victorian
];
// Costumes that leave the legs bare. Drawing trousers under a kilt or a chiton is the
// single fastest way to make a cartoon Egyptian look like a man in pyjamas.
const MR_BARE_LEG_COSTUMES = ['kilt', 'chiton', 'toga', 'dhoti'];

const MR_HEADWEAR = [
  'none', 'turban', 'cap', 'crown',
  'nemes',   // the striped Egyptian headcloth
  'laurel',  // a Greek or Roman wreath
  'helmet',  // crested, close enough for Greece, Rome and the Middle Ages
  'hood',    // medieval European
  'tricorn', // three-cornered hat, 1700s
  'tophat',
  'bonnet'
];

// Expressions are three numbers: brow angle, eye openness, mouth shape. Everything a flat
// character needs to read as calm, worried, angry, glad or shocked at phone size.
const MR_EXPRESSIONS = {
  calm:    { brow: 0, eye: 1, mouth: 'neutral' },
  glad:    { brow: -0.1, eye: 0.9, mouth: 'smile' },
  sad:     { brow: 0.35, eye: 0.75, mouth: 'frown' },
  angry:   { brow: -0.5, eye: 0.8, mouth: 'frown' },
  shocked: { brow: -0.2, eye: 1.35, mouth: 'open' },
  worried: { brow: 0.28, eye: 1.05, mouth: 'small' }
};

const MR_ACTIONS = ['idle', 'talk', 'walk', 'point', 'wave', 'think', 'sit', 'kneel', 'fall'];

// ---------------------------------------------------------------- the pose
//
// A pose is the set of joint angles at one instant. Angles are radians from straight down
// for legs and straight down-ish for arms, so 0 is a figure standing at rest.

function mrPoseBase() {
  return {
    lean: 0, bob: 0, drop: 0, headTurn: 0, headTilt: 0,
    shoulderL: 0.06, elbowL: 0.12, shoulderR: -0.06, elbowR: -0.12,
    hipL: 0.04, kneeL: 0.03, hipR: -0.04, kneeR: 0.03,
    mouthOpen: 0, viseme: null, blink: 0
  };
}

const mrClampPose = (v) => (v < 0 ? 0 : v);
const mrEaseOutPose = (u) => 1 - Math.pow(1 - u, 3);
const mrSat = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);

// Angles are measured from straight DOWN, positive swinging FORWARD — the direction the
// actor faces. Getting this backwards is how pointing and waving originally aimed behind
// the character. Useful landmarks: 0 = hanging, 1.57 = horizontal in front, 3.14 = straight up.
const MR_ARM_FORWARD = Math.PI / 2;
const MR_ARM_UP = Math.PI;
// Where a pointing hand goes when nobody has said what to point at: a shade above level,
// which is what "there!" looks like. An aim replaces this number and nothing else, so a
// pointing gesture keeps its anticipation, its overshoot and its small living drift.
const MR_POINT_AIM = MR_ARM_FORWARD + 0.12;
// The pointing arm's own bend, shared out between the shoulder and the elbow. Subtracted
// from the aim so that the HAND ends up along it rather than the upper arm.
const MR_POINT_BEND = 0.39;
// How far the eyes go before a head would really have to turn with them.
const MR_GAZE_TURN = 0.5;

// A pose at one instant.
//   t        scene time, for continuous idles like breathing and blinking
//   opts.tIn seconds since this action began — gestures need to start, not just exist
//   opts.cycle walk cycles completed, derived from distance travelled so feet do not skate
function poseFor(action, clock, seed, speaking, opts) {
  const o = opts || {};
  const p = mrPoseBase();
  const offset = ((seed || 0) % 100) / 100 * Math.PI * 2;
  const tIn = o.tIn != null ? o.tIn : clock;
  // Everything cyclic — breath, blink, sway, beats, steps — runs on a clock that age
  // scales. A child fidgets faster than an adult and an old person moves slower, and that
  // difference reads before any of the proportions do. Settling into a gesture still takes
  // real seconds, so `tIn` is deliberately left off this clock.
  const t = clock * (o.pace || 1);

  // Everyone breathes and blinks, whatever else they are doing — stillness reads as dead.
  p.bob = Math.sin(t * 1.1 + offset) * 0.004;
  const breath = Math.sin(t * 1.1 + offset) * 0.03;
  p.shoulderL += breath * 0.5;
  p.shoulderR -= breath * 0.5;
  const blinkCycle = (t + offset) % 4.3;
  p.blink = blinkCycle < 0.12 ? 1 - Math.abs(blinkCycle - 0.06) / 0.06 : 0;

  switch (action) {
    case 'walk': {
      // One cycle is two steps. Phase comes from distance when the caller knows it, so a
      // slow walk takes slow steps and a stopped character stops stepping.
      const cycles = o.cycle != null ? o.cycle : t * 0.95;
      const a = cycles * Math.PI * 2 + offset;
      const sin = Math.sin(a);
      const cos = Math.cos(a);
      const swing = 0.36;   // ~20 degrees each way; 0.5 read as a stage stride

      p.hipL = sin * swing;
      p.hipR = -sin * swing;
      // The knee bends on the SWING leg — the one travelling forward, hip velocity
      // positive — and stays near straight while the other takes the weight. Without this
      // the legs are two rigid sticks scissoring, which is exactly how it looked.
      p.kneeL = mrClampPose(cos) * 0.72 + 0.05;
      p.kneeR = mrClampPose(-cos) * 0.72 + 0.05;
      // The body rides highest when the legs pass each other and drops at each stride.
      p.bob += 0.014 * (1 - Math.abs(sin));
      p.lean = 0.05;
      // Arms swing opposite the legs, bending more as each one comes forward. Both elbows
      // bend the same way — the forearm always leads the upper arm. Mirroring the sign, as
      // the first version did, folded whichever arm was trailing straight across the chest.
      // The 0.17 cancels the outward splay the drawing adds to each arm: that splay is in
      // the same plane as the swing, so left it in, one half of every stride came out
      // shallower than the other and the figure hunched on alternate steps. The swing
      // itself is small on purpose. The shoulders are only a fifth of a body-height apart,
      // so an anatomically full swing throws each hand clear across the midline and the
      // walk alternates between arms flung wide and arms knotted at the waist.
      p.shoulderL = -sin * 0.13 + 0.17;
      p.shoulderR = sin * 0.13 - 0.17;
      p.elbowL = 0.14 + mrClampPose(-sin) * 0.16;
      p.elbowR = 0.14 + mrClampPose(sin) * 0.16;
      p.headTilt = Math.sin(a * 2) * 0.015;
      break;
    }
    case 'talk': {
      // Beat gestures, not a windmill: bursts of movement with pauses between them, the
      // way people actually gesture while speaking.
      const beat = Math.sin(t * 3.2 + offset);
      const gate = mrSat(0.35 + Math.sin(t * 0.85 + offset * 2) * 1.3);
      const start = mrEaseOutPose(mrSat(tIn / 0.3));
      // Hands come UP and FORWARD — held around chest height, moving on the beats. The
      // first version used negative angles, which swung both arms behind the body and
      // read as someone standing still with their hands hidden.
      // The reach is nearly all elbow. A big shoulder angle with a half-bent elbow throws
      // the hand 75px in front of the body at hip height — a zombie arm, which is what the
      // first pass drew. A hanging upper arm with a folded elbow puts the hand where people
      // actually gesture: chest height, a forearm's length in front.
      p.shoulderR = (-0.12 + beat * 0.18) * gate * start;
      p.elbowR = (2.3 + beat * 0.28) * gate * start;
      p.shoulderL = (-0.08 + beat * 0.12) * gate * 0.7 * start;
      p.elbowL = (2.2 + beat * 0.22) * gate * 0.7 * start;
      p.headTilt = Math.sin(t * 0.9 + offset) * 0.05;
      p.headTurn = Math.sin(t * 0.6 + offset) * 0.06;
      break;
    }
    case 'point': {
      // Anticipation, a small overshoot, then a settle — the arm arrives rather than
      // appearing. It also points FORWARD now.
      const u = mrEaseOutPose(mrSat(tIn / 0.38));
      const overshoot = Math.sin(mrSat(tIn / 0.38) * Math.PI) * 0.13;
      // Just under horizontal at the shoulder, with the forearm carrying the last of the
      // angle back up — a ruler-straight arm reads as a T-pose, not a gesture.
      // `aim` is the angle the hand should end up along — straight down is 0, level in
      // front is 1.57 — so pointing at a thing is one number, worked out from where the
      // thing actually is, and everything else about the gesture is unchanged.
      const aim = (o.aim != null ? o.aim : MR_POINT_AIM) - MR_POINT_BEND;
      p.shoulderR = (aim + overshoot) * u;
      p.elbowR = 0.22 * u;
      p.headTurn = 0.2 * u;
      p.lean = 0.03 * u;
      p.shoulderR += Math.sin(t * 1.6 + offset) * 0.02 * u;   // it is held, not frozen
      p.shoulderL = 0.05;
      p.elbowL = 0.2;
      break;
    }
    case 'wave': {
      const u = mrEaseOutPose(mrSat(tIn / 0.3));
      p.shoulderR = (MR_ARM_UP - 0.55) * u;
      // The forearm does the waving, pivoting about the elbow.
      p.elbowR = (-0.15 + Math.sin(t * 6.2 + offset) * 0.5) * u;
      p.headTilt = 0.05 * u;
      p.shoulderL = 0.08;
      p.elbowL = 0.22;
      break;
    }
    case 'think': {
      const u = mrEaseOutPose(mrSat(tIn / 0.45));
      // Hand to the chin. The rig's arms are long next to the short shoulder-to-chin gap,
      // so a forward upper arm plus a folded elbow lands the hand at the waist, not the
      // face — which is what the first version did. The upper arm has to drop BACK across
      // the chest, the only angle from which a fully folded forearm brings the hand up
      // under the jaw. (Negative is backward here, deliberately, unlike point and wave.)
      p.shoulderR = -0.86 * u;
      p.elbowR = -2.55 * u;
      p.headTilt = 0.14 * u;
      p.headTurn = -0.1 * u;
      p.shoulderL = 0.26 * u;     // the other arm just hangs, slightly forward
      p.elbowL = 0.34 * u;
      // A held pose still shifts: the weight rocks and the head rolls, slowly.
      p.bob += Math.sin(t * 0.7 + offset) * 0.004;
      p.headTilt += Math.sin(t * 0.55 + offset) * 0.02 * u;
      break;
    }
    case 'sit': {
      // On a seat: thighs forward and level, shins down, hands resting on the knees.
      const u = mrEaseOutPose(mrSat(tIn / 0.55));
      p.hipL = 1.36 * u; p.kneeL = 1.5 * u;
      p.hipR = 1.3 * u; p.kneeR = 1.44 * u;
      p.drop = 0.19 * u;
      p.lean = -0.05 * u;
      // Angles are absolute, not mirrored: mirroring the sign here swung the right arm
      // backwards and landed each hand on the other knee, arms crossed. Both upper arms
      // hang; both forearms come forward onto the thighs.
      p.shoulderL = 0.19 * u; p.elbowL = 0.84 * u;
      p.shoulderR = -0.15 * u; p.elbowR = 0.84 * u;
      break;
    }
    case 'kneel': {
      // Down on one knee: the back shin lies along the ground, the front leg is folded.
      const u = mrEaseOutPose(mrSat(tIn / 0.5));
      p.hipL = 1.2 * u; p.kneeL = 1.4 * u;
      p.hipR = 0.2 * u; p.kneeR = 1.5 * u;
      p.lean = 0.12 * u;
      p.drop = 0.16 * u;
      p.shoulderL = 0.2 * u; p.elbowL = 0.35 * u;
      p.shoulderR = -0.15 * u; p.elbowR = 0.5 * u;    // the leading hand rests on the raised knee
      break;
    }
    case 'fall': {
      const u = mrEaseOutPose(mrSat(tIn / 0.45));
      p.lean = 0.5 * u;
      p.shoulderL = 1.15 * u; p.shoulderR = 0.95 * u;   // arms fly forward to break it
      p.elbowL = 0.25 * u; p.elbowR = -0.25 * u;
      p.hipL = 0.45 * u; p.hipR = -0.35 * u; p.kneeL = 0.55 * u;
      p.drop = 0.05 * u;
      break;
    }
    default: {
      // Idle: weight shifts slowly from foot to foot, and the arms hang with a little sway.
      const shift = Math.sin(t * 0.45 + offset);
      p.hipL = 0.04 + shift * 0.03;
      p.hipR = -0.04 + shift * 0.03;
      p.kneeL = 0.03 + mrClampPose(shift) * 0.05;
      p.kneeR = 0.03 + mrClampPose(-shift) * 0.05;
      p.shoulderL += Math.sin(t * 0.5 + offset) * 0.05;
      p.shoulderR -= Math.sin(t * 0.5 + offset + 0.6) * 0.05;
      p.headTurn = Math.sin(t * 0.32 + offset) * 0.07;
      p.bob += Math.abs(shift) * 0.002;
    }
  }

  // Looking at somebody beats whatever the action had the head doing: a character who has
  // been told to watch the king watches the king while they walk, sit or wave.
  if (o.gaze != null) p.headTurn = o.gaze;

  // Speaking overrides the mouth whatever the body is doing. Three forms, in order of how
  // much we know: `{ open, viseme }` is measured loudness plus the shape of the sound being
  // made — real lip sync; a bare number is loudness only; `true` means "speaking, but we
  // cannot hear it", which is all a reel with no narration can honestly claim.
  if (speaking && typeof speaking === 'object') {
    p.mouthOpen = Math.max(0, Math.min(1, speaking.open || 0));
    p.viseme = speaking.viseme || 'rest';
  } else if (typeof speaking === 'number') p.mouthOpen = Math.max(0, Math.min(1, speaking));
  else if (speaking) p.mouthOpen = 0.35 + Math.abs(Math.sin(t * 2 * Math.PI * 5.5 + offset)) * 0.65;
  else if (action === 'talk') p.mouthOpen = 0.3 + Math.abs(Math.sin(t * 2 * Math.PI * 4.5 + offset)) * 0.5;
  return p;
}

// Blend two poses. Used to cross-fade between actions so a character eases from standing
// to kneeling instead of snapping between them on a keyframe.
function blendPoses(a, b, u) {
  const out = {};
  for (const key of Object.keys(a)) {
    const from = a[key], to = b[key] != null ? b[key] : a[key];
    out[key] = typeof from === 'number' ? from + (to - from) * u : to;
  }
  return out;
}

// ---------------------------------------------------------------- drawing

// Limb angles are measured from straight DOWN, positive swinging forward (toward the
// direction the actor faces). Getting this convention wrong is how the first version of
// this file ended up with every character reaching for the sky.
function mrLimb(ctx, x0, y0, angle, length, width, colour) {
  const x1 = x0 + Math.sin(angle) * length;
  const y1 = y0 + Math.cos(angle) * length;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  return { x: x1, y: y1, angle };
}

// Mouth shapes for speech. Real lip sync is not a jaw hinging open and shut in time with
// the volume — it is the mouth taking the SHAPE of the sound. Nine shapes is the standard
// working set for hand-drawn animation and it is plenty: at phone size the difference
// between "oo" and "ee" carries, and the difference between "t" and "d" does not.
//
// Sizes are fractions of the head radius. `ry` is the fully-open height; how far open the
// mouth actually is comes from the loudness at that instant.
const MR_VISEMES = {
  rest: { rx: 0.17, ry: 0.02 },
  MBP:  { rx: 0.20, ry: 0.02, press: true },              // m, b, p — lips shut
  AA:   { rx: 0.21, ry: 0.30, tongue: true },             // father, cat
  EE:   { rx: 0.26, ry: 0.13, teeth: true },              // see, it
  OO:   { rx: 0.12, ry: 0.21 },                           // boot, go
  UH:   { rx: 0.18, ry: 0.19 },                           // but, the
  FV:   { rx: 0.20, ry: 0.07, teeth: true },              // f, v — teeth on the lip
  L:    { rx: 0.18, ry: 0.22, tongue: true },             // l, th — tongue showing
  S:    { rx: 0.21, ry: 0.06, teeth: true }               // s, z, t, d, n
};

const MR_VISEME_KINDS = Object.keys(MR_VISEMES);

function mrMouth(ctx, x, y, size, shape, open, viseme) {
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.strokeStyle = 'rgba(70,38,28,0.9)';
  ctx.lineCap = 'round';
  const v = viseme && MR_VISEMES[viseme];
  if (v && open > 0.04) {
    const rx = size * v.rx;
    // Loudness opens the shape; it never changes which shape it is.
    const ry = size * v.ry * (0.35 + open * 0.65);
    if (v.press) {
      ctx.lineWidth = Math.max(1.2, size * 0.11);
      ctx.beginPath();
      ctx.moveTo(x - rx, y); ctx.lineTo(x + rx, y);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#6d2f2b';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    if (v.teeth) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#f6efe4';
      ctx.fillRect(x - rx, y - ry, rx * 2, ry * 0.85);
      ctx.restore();
    }
    if (v.tongue && ry > size * 0.12) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#c96a72';
      ctx.beginPath();
      ctx.ellipse(x, y + ry * 0.72, rx * 0.66, ry * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(70,38,28,0.55)';
    ctx.lineWidth = Math.max(1, size * 0.045);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (open > 0.05) {
    ctx.fillStyle = '#6d2f2b';
    ctx.beginPath();
    ctx.ellipse(x, y, size * 0.2, size * 0.08 + size * 0.2 * open, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  if (shape === 'smile') ctx.arc(x, y - size * 0.12, size * 0.26, 0.2 * Math.PI, 0.8 * Math.PI);
  else if (shape === 'frown') ctx.arc(x, y + size * 0.3, size * 0.26, 1.2 * Math.PI, 1.8 * Math.PI);
  else if (shape === 'small') { ctx.moveTo(x - size * 0.09, y); ctx.lineTo(x + size * 0.09, y); }
  else if (shape === 'open') { ctx.ellipse(x, y, size * 0.13, size * 0.17, 0, 0, Math.PI * 2); ctx.stroke(); return; }
  else { ctx.moveTo(x - size * 0.17, y); ctx.lineTo(x + size * 0.17, y); }
  ctx.stroke();
}

// Where the fringe sits, as a fraction of head radius above centre. Everything about the
// face hangs off this: too low and the character is wearing a mask, too high and it is bald.
const MR_HAIRLINE = 0.28;

// The arc angles at which a horizontal cut at MR_HAIRLINE meets the head circle.
const MR_HAIR_A1 = Math.PI + Math.asin(MR_HAIRLINE);
const MR_HAIR_A2 = Math.PI * 2 - Math.asin(MR_HAIRLINE);

function mrHair(ctx, x, y, r, style, colour) {
  if (style === 'bald') return;
  ctx.fillStyle = colour;
  ctx.beginPath();
  if (style === 'long') {
    ctx.arc(x, y, r * 1.04, MR_HAIR_A1, MR_HAIR_A2);
    ctx.closePath();
  } else if (style === 'bun') {
    ctx.arc(x, y, r * 1.04, MR_HAIR_A1, MR_HAIR_A2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * 0.08, y - r * 1.15, r * 0.4, 0, Math.PI * 2);
  } else if (style === 'braid') {
    ctx.arc(x, y, r * 1.04, MR_HAIR_A1, MR_HAIR_A2);
    ctx.closePath();
  } else {
    ctx.arc(x, y, r * 1.04, MR_HAIR_A1, MR_HAIR_A2);
    ctx.closePath();
  }
  ctx.fill();
}

// The parts of a hairstyle that fall behind the head, drawn before the face so they can
// never cross it.
function mrHairBack(ctx, x, y, r, style, colour) {
  if (style === 'long') {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x - r * 1.05, y - r * 0.4);
    ctx.lineTo(x - r * 1.05, y + r * 1.55);
    ctx.lineTo(x + r * 1.05, y + r * 1.55);
    ctx.lineTo(x + r * 1.05, y - r * 0.4);
    ctx.closePath();
    ctx.fill();
  } else if (style === 'braid') {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(x + r * 0.05, y + r * 1.05, r * 0.26, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Costume shapes. Each is drawn in the actor's local space, where the hips are at hipY
// and the feet at 0 — the same coordinates the limbs use.
function mrCostume(ctx, kind, colour, trim, hipY, shoulderY, hipHalf, shoulderHalf, height, pad) {
  const fill = (build) => { ctx.beginPath(); build(); ctx.fillStyle = colour; ctx.fill(); };
  if (kind === 'kurta') {
    // A tunic to mid-thigh, flaring slightly.
    fill(() => {
      ctx.moveTo(-shoulderHalf - pad, shoulderY);
      ctx.lineTo(-hipHalf * 1.5 - pad, hipY + height * 0.15);
      ctx.lineTo(hipHalf * 1.5 + pad, hipY + height * 0.15);
      ctx.lineTo(shoulderHalf + pad, shoulderY);
      ctx.closePath();
    });
    ctx.strokeStyle = trim;
    ctx.lineWidth = height * 0.008;
    ctx.beginPath();
    ctx.moveTo(0, shoulderY + height * 0.02);
    ctx.lineTo(0, hipY + height * 0.13);
    ctx.stroke();
  } else if (kind === 'dhoti') {
    // A wrapped lower garment to the shins.
    fill(() => {
      ctx.moveTo(-hipHalf - pad, hipY - height * 0.02);
      ctx.lineTo(-hipHalf * 1.7 - pad, hipY + height * 0.26);
      ctx.lineTo(hipHalf * 1.7 + pad, hipY + height * 0.26);
      ctx.lineTo(hipHalf + pad, hipY - height * 0.02);
      ctx.closePath();
    });
  } else if (kind === 'saree' || kind === 'robe') {
    // A full-length drape to the ankles.
    fill(() => {
      ctx.moveTo(-hipHalf - pad, hipY - height * 0.03);
      ctx.lineTo(-hipHalf * 2.1 - pad, -height * 0.01);
      ctx.lineTo(hipHalf * 2.1 + pad, -height * 0.01);
      ctx.lineTo(hipHalf + pad, hipY - height * 0.03);
      ctx.closePath();
    });
    if (kind === 'saree') {
      // The pallu, over one shoulder and across the body.
      fill(() => {
        ctx.moveTo(-shoulderHalf - pad, shoulderY);
        ctx.lineTo(-shoulderHalf * 0.2, shoulderY + height * 0.02);
        ctx.lineTo(hipHalf * 1.2 + pad, hipY + height * 0.04);
        ctx.lineTo(hipHalf * 0.1, hipY + height * 0.06);
        ctx.closePath();
      });
    }
  } else if (kind === 'kilt') {
    // Egyptian schenti: a short wrapped linen skirt, and the broad collar that does more
    // to say "Egypt" than the skirt does.
    fill(() => {
      ctx.moveTo(-hipHalf - pad, hipY - height * 0.03);
      ctx.lineTo(-hipHalf * 1.35 - pad, hipY + height * 0.13);
      ctx.lineTo(hipHalf * 1.35 + pad, hipY + height * 0.13);
      ctx.lineTo(hipHalf + pad, hipY - height * 0.03);
      ctx.closePath();
    });
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.ellipse(0, shoulderY + height * 0.03, shoulderHalf * 0.92 + pad, height * 0.045 + pad, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.rect(-hipHalf * 0.12, hipY - height * 0.03, hipHalf * 0.24, height * 0.15);
    ctx.fill();
  } else if (kind === 'chiton' || kind === 'toga') {
    // A pinned tunic, belted at the waist, falling to the shin. The toga adds the band
    // over one shoulder — the one silhouette everybody reads as Rome.
    fill(() => {
      ctx.moveTo(-shoulderHalf - pad, shoulderY + height * 0.01);
      ctx.lineTo(-hipHalf * 1.75 - pad, hipY + height * 0.2);
      ctx.lineTo(hipHalf * 1.75 + pad, hipY + height * 0.2);
      ctx.lineTo(shoulderHalf + pad, shoulderY + height * 0.01);
      ctx.closePath();
    });
    ctx.strokeStyle = trim;
    ctx.lineWidth = height * 0.012;
    ctx.beginPath();
    ctx.moveTo(-hipHalf * 1.15, hipY - height * 0.01);
    ctx.lineTo(hipHalf * 1.15, hipY - height * 0.01);
    ctx.stroke();
    if (kind === 'toga') {
      fill(() => {
        ctx.moveTo(-shoulderHalf - pad, shoulderY);
        ctx.lineTo(-shoulderHalf * 0.35, shoulderY);
        ctx.lineTo(hipHalf * 1.5 + pad, hipY + height * 0.09);
        ctx.lineTo(hipHalf * 0.5, hipY + height * 0.12);
        ctx.closePath();
      });
    }
  } else if (kind === 'gown') {
    // Medieval Europe: cut from the shoulder, belted high, hem on the floor.
    fill(() => {
      ctx.moveTo(-shoulderHalf - pad, shoulderY + height * 0.01);
      ctx.lineTo(-hipHalf * 2.2 - pad, -height * 0.005);
      ctx.lineTo(hipHalf * 2.2 + pad, -height * 0.005);
      ctx.lineTo(shoulderHalf + pad, shoulderY + height * 0.01);
      ctx.closePath();
    });
    ctx.strokeStyle = trim;
    ctx.lineWidth = height * 0.016;
    ctx.beginPath();
    ctx.moveTo(-hipHalf * 1.1, hipY - height * 0.03);
    ctx.lineTo(hipHalf * 1.1, hipY - height * 0.03);
    ctx.stroke();
  } else if (kind === 'jama') {
    // Mughal: a flared coat to below the knee, crossed at the chest and tied at one side,
    // with a sash at the waist.
    fill(() => {
      ctx.moveTo(-shoulderHalf - pad, shoulderY + height * 0.015);
      ctx.lineTo(-hipHalf * 1.9 - pad, hipY + height * 0.24);
      ctx.lineTo(hipHalf * 1.9 + pad, hipY + height * 0.24);
      ctx.lineTo(shoulderHalf + pad, shoulderY + height * 0.015);
      ctx.closePath();
    });
    ctx.strokeStyle = trim;
    ctx.lineWidth = height * 0.009;
    ctx.beginPath();
    ctx.moveTo(-shoulderHalf * 0.7, shoulderY + height * 0.03);
    ctx.lineTo(hipHalf * 0.95, hipY - height * 0.035);
    ctx.stroke();
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.rect(-hipHalf * 1.25 - pad, hipY - height * 0.03, hipHalf * 2.5 + pad * 2, height * 0.032);
    ctx.fill();
  } else if (kind === 'coat') {
    // A frock coat: colonial through Victorian. Knee-length, open, with a pale shirt
    // showing between the lapels.
    fill(() => {
      ctx.moveTo(-shoulderHalf - pad, shoulderY + height * 0.01);
      ctx.lineTo(-hipHalf * 1.5 - pad, hipY + height * 0.16);
      ctx.lineTo(-hipHalf * 0.35, hipY + height * 0.16);
      ctx.lineTo(-hipHalf * 0.2, shoulderY + height * 0.05);
      ctx.lineTo(hipHalf * 0.2, shoulderY + height * 0.05);
      ctx.lineTo(hipHalf * 0.35, hipY + height * 0.16);
      ctx.lineTo(hipHalf * 1.5 + pad, hipY + height * 0.16);
      ctx.lineTo(shoulderHalf + pad, shoulderY + height * 0.01);
      ctx.closePath();
    });
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(-hipHalf * 0.2, shoulderY + height * 0.05);
    ctx.lineTo(0, shoulderY + height * 0.015);
    ctx.lineTo(hipHalf * 0.2, shoulderY + height * 0.05);
    ctx.lineTo(0, hipY - height * 0.01);
    ctx.closePath();
    ctx.fill();
  }
}

function mrHeadwear(ctx, kind, r, colour, trim) {
  if (kind === 'turban') {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.6, r * 1.14, r * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = trim;
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * 1.06, r * 0.5, 0.1, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  } else if (kind === 'cap') {
    // High on the skull: any lower and it reads as a blindfold across the brows.
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.72, r * 0.86, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'crown') {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, -r * 0.55);
    ctx.lineTo(-r * 0.85, -r * 1.05);
    ctx.lineTo(-r * 0.42, -r * 0.75);
    ctx.lineTo(0, -r * 1.25);
    ctx.lineTo(r * 0.42, -r * 0.75);
    ctx.lineTo(r * 0.85, -r * 1.05);
    ctx.lineTo(r * 0.85, -r * 0.55);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'nemes') {
    // The Egyptian headcloth: over the crown, and down past the jaw on both sides. The
    // lappets are what make it read as Egypt rather than as a hat.
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(-r * 1.02, -r * 0.35);
    ctx.lineTo(-r * 1.28, r * 0.95);
    ctx.lineTo(-r * 0.66, r * 0.95);
    ctx.lineTo(-r * 0.7, -r * 0.2);
    ctx.closePath();
    ctx.moveTo(r * 1.02, -r * 0.35);
    ctx.lineTo(r * 1.28, r * 0.95);
    ctx.lineTo(r * 0.66, r * 0.95);
    ctx.lineTo(r * 0.7, -r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.42, r * 1.06, r * 0.72, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.rect(-r * 1.04, -r * 0.42, r * 2.08, r * 0.16);
    ctx.fill();
  } else if (kind === 'laurel') {
    // A wreath: leaves around the crown, open at the front.
    ctx.fillStyle = colour;
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (1.08 + i * 0.13);
      const x = Math.cos(a) * r * 0.98, y = Math.sin(a) * r * 0.98;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * x, y);
        ctx.rotate(side * a);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.2, r * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  } else if (kind === 'helmet') {
    // A dome to the brow with a nose bar and a crest — near enough for a hoplite, a
    // legionary or a man-at-arms, which is as far as one shape can honestly stretch.
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.12, r * 1.06, r * 1.02, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.rect(-r * 1.06, -r * 0.2, r * 2.12, r * 0.2);
    ctx.rect(-r * 0.1, -r * 0.2, r * 0.2, r * 0.62);
    ctx.fill();
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, -r * 1.08);
    ctx.quadraticCurveTo(0, -r * 1.7, r * 0.5, -r * 1.5);
    ctx.quadraticCurveTo(r * 0.2, -r * 1.2, r * 0.12, -r * 1.02);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'hood') {
    // Cowl over the head and down the neck, open around the face.
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(-r * 1.12, r * 0.9);
    ctx.quadraticCurveTo(-r * 1.24, -r * 1.16, 0, -r * 1.16);
    ctx.quadraticCurveTo(r * 1.24, -r * 1.16, r * 1.12, r * 0.9);
    ctx.lineTo(r * 0.78, r * 0.86);
    ctx.quadraticCurveTo(r * 0.94, -r * 0.5, 0, -r * 0.62);
    ctx.quadraticCurveTo(-r * 0.94, -r * 0.5, -r * 0.78, r * 0.86);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'tricorn') {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.78, r * 0.82, r * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 1.5, -r * 0.72);
    ctx.quadraticCurveTo(0, -r * 1.5, r * 1.5, -r * 0.72);
    ctx.quadraticCurveTo(0, -r * 0.5, -r * 1.5, -r * 0.72);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'tophat') {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.rect(-r * 0.62, -r * 1.95, r * 1.24, r * 1.2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.78, r * 1.16, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.rect(-r * 0.62, -r * 0.98, r * 1.24, r * 0.2);
    ctx.fill();
  } else if (kind === 'bonnet') {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.35, r * 1.08, r * 0.94, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, -r * 0.35, r * 1.2, r * 0.5, -0.35, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.strokeStyle = trim;
    ctx.lineWidth = r * 0.11;
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, r * 0.1);
    ctx.quadraticCurveTo(0, r * 1.1, r * 0.62, r * 0.1);
    ctx.stroke();
  }
}

function mrShoe(ctx, x, y, angle, size, facing, colour) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle * 0.5);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(size * 0.35, 0, size * 0.62, size * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  void facing;
}

// Draw one actor. `height` is the figure's full height in canvas units and (x, groundY)
// is where the feet meet the floor, so a caller only has to decide where and how big.
//
// The figure is painted twice: an ink silhouette slightly fatter than the body, then the
// colours on top. That outline is not decoration — flat colours disappear against a
// background of similar value (dark trousers on a dark field read as no legs at all), and
// the ink is what keeps a character readable over anything.
// Every measurement of a figure, derived from its height. Pulled out of drawActor so that
// anything else needing to know where a hand is — a prop being carried, for one — asks the
// same arithmetic rather than a copy of it that will drift.
function actorMetrics(actor, height, lookName) {
  const look = lookOf(actor.look || lookName);
  const body = MR_BODIES[actor.body] || MR_BODIES.average;
  const age = ageOf(actor.age);
  const headR = height * body.head * look.head * age.head / 2;
  const legLength = height * body.legs * age.legs;
  const torsoLength = height * body.torso;
  const hipY = -legLength;
  const shoulderY = hipY - torsoLength;
  return {
    look, body, age, headR, legLength, torsoLength, hipY, shoulderY,
    headY: shoulderY - height * 0.02 - headR,
    hipHalf: height * body.hips / 2,
    shoulderHalf: height * body.shoulders / 2,
    armY: shoulderY + height * 0.025,
    armLength: height * 0.34,
    limbWidth: height * 0.052 * look.limb * age.limb,
    outline: Math.max(1.5, height * 0.013 * look.inkWeight)
  };
}

// Which way a character is facing at this instant. It belongs to the moment, not to the
// character, so it arrives on the pose — a character walks left in one beat and right in
// the next without becoming a different person. (For a long while nothing read it off the
// pose at all, and every figure in every reel faced right whatever their keyframes said.)
function mrFacing(actor, pose) {
  return (pose && pose.facing) || (actor && actor.facing) || 'right';
}

// Where one hand is, in canvas coordinates, for a figure drawn at (x, groundY) — including
// the lean, the stoop and the flip, so a prop put here lands in the hand and not beside it.
// `side` is -1 for the far hand and 1 for the near one, as everywhere else in this file.
function actorHandPoint(actor, pose, x, groundY, height, lookName, side) {
  const m = actorMetrics(actor, height, lookName);
  const shoulder = side < 0 ? pose.shoulderL : pose.shoulderR;
  const elbow = side < 0 ? pose.elbowL : pose.elbowR;
  const upper = shoulder + side * 0.17;
  const fore = upper + elbow;
  const sx = side * m.shoulderHalf * 0.95;
  const ex = sx + Math.sin(upper) * m.armLength * 0.52;
  const ey = m.armY + Math.cos(upper) * m.armLength * 0.52;
  const lx = ex + Math.sin(fore) * m.armLength * 0.48;
  const ly = ey + Math.cos(fore) * m.armLength * 0.48;

  // The same transform drawActor uses, applied by hand: rotate, then flip, then translate.
  const angle = -(pose.lean + m.age.stoop) * 0.5;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const flip = mrFacing(actor, pose) === 'left' ? -1 : 1;
  return {
    x: x + (lx * cos - ly * sin) * flip,
    y: groundY - pose.bob * height + (pose.drop || 0) * height + (lx * sin + ly * cos),
    angle: fore * flip,
    flip,
    grip: m.limbWidth
  };
}

// Turn "look at that" into the two numbers a pose can use: how far the head turns, and
// the angle a pointing hand wants to be along. Both are in the actor's own frame, where
// forward is whichever way they happen to be facing — so the same target makes a
// character glance forward or back over their shoulder depending on how they stand.
function aimAngles(actor, facing, x, groundY, height, lookName, target) {
  const m = actorMetrics(actor, height, lookName);
  const forward = facing === 'left' ? -1 : 1;
  const ahead = (target.x - x) * forward;
  // Half a body height to the side is as far as the eyes go; anything beyond that is the
  // same glance, not a further one, so this saturates rather than growing without bound.
  const swing = Math.max(1, height * 0.45);
  const gaze = Math.max(-1, Math.min(1, ahead / swing)) * MR_GAZE_TURN;
  // The arm is aimed from the shoulder, and it is allowed to swing back: pointing at
  // something behind you is a real gesture, and clamping it forward would be a lie about
  // where the thing is.
  const arm = Math.max(-1, Math.min(2.8, Math.atan2(ahead, target.y - (groundY + m.armY))));
  return { gaze, arm };
}

function drawActor(ctx, actor, pose, x, groundY, height, lookName) {
  const facing = mrFacing(actor, pose);
  const look = lookOf(actor.look || lookName);
  const body = MR_BODIES[actor.body] || MR_BODIES.average;
  const expression = MR_EXPRESSIONS[actor.expression] || MR_EXPRESSIONS.calm;
  const colours = {
    skin: actor.skin || MR_SKINS[1],
    top: actor.top || '#3a5cc8',
    bottom: actor.bottom || '#2b2f45',
    hair: actor.hair || MR_HAIRS[0],
    shoe: '#22252e',
    trim: actor.trim || '#e8c46a'
  };
  const ink = actor.ink || look.ink;
  const costume = actor.costume || 'modern';
  // Bare legs are skin, and what is on the feet is sandals rather than shoes.
  const bareLegs = MR_BARE_LEG_COSTUMES.indexOf(costume) >= 0;
  if (bareLegs) colours.shoe = '#8a6a4a';
  const legColour = bareLegs ? 'skin' : 'bottom';
  const headwear = actor.headwear || 'none';

  // The look scales the head, the eyes, the limbs and the line — the four numbers that
  // separate a neutral figure from a comic one.
  // Age multiplies the body preset. A bigger head and shorter legs almost cancel out in
  // total height, which is the point: a child is the same figure with the proportions of a
  // child, and how tall they stand is handled once, by actorHeight().
  const m = actorMetrics(actor, height, lookName);
  const { age, headR, legLength, torsoLength, limbWidth, outline,
    hipY, shoulderY, headY, hipHalf, shoulderHalf, armY, armLength } = m;

  // One pass over the whole figure. `pad` fattens every stroke and fill for the ink pass.
  const paint = (pad, only) => {
    const c = (key) => (only ? ink : colours[key]);
    const w = (base) => base + pad * 2;

    // Limbs carry their own outline. The silhouette pass only draws the OUTSIDE edge, so a
    // leg swinging past the other leg, or an arm crossing the chest, has no line where it
    // needs one most and dissolves into whatever it overlaps.
    const edge = only ? 0 : outline * 1.5;
    for (const side of [-1, 1]) {
      const hip = side < 0 ? pose.hipL : pose.hipR;
      const knee = side < 0 ? pose.kneeL : pose.kneeR;
      const hipX = side * hipHalf * 0.55;
      if (edge) {
        const j = mrLimb(ctx, hipX, hipY, hip, legLength * 0.52, limbWidth + edge, ink);
        mrLimb(ctx, j.x, j.y, hip - knee, legLength * 0.48, limbWidth * 0.9 + edge, ink);
      }
      const kneeJoint = mrLimb(ctx, hipX, hipY, hip, legLength * 0.52, w(limbWidth), c(legColour));
      const foot = mrLimb(ctx, kneeJoint.x, kneeJoint.y, hip - knee, legLength * 0.48, w(limbWidth * 0.9), c(legColour));
      mrShoe(ctx, foot.x, foot.y + limbWidth * 0.1, hip - knee, limbWidth + pad, facing, c('shoe'));
    }

    ctx.fillStyle = c('top');
    ctx.beginPath();
    ctx.moveTo(-hipHalf - pad, hipY + limbWidth * 0.2);
    ctx.lineTo(-shoulderHalf - pad, shoulderY + height * 0.015 - pad);
    ctx.quadraticCurveTo(0, shoulderY - height * 0.01 - pad, shoulderHalf + pad, shoulderY + height * 0.015 - pad);
    ctx.lineTo(hipHalf + pad, hipY + limbWidth * 0.2);
    ctx.quadraticCurveTo(0, hipY + limbWidth * 0.75 + pad, -hipHalf - pad, hipY + limbWidth * 0.2);
    ctx.closePath();
    ctx.fill();

    if (costume !== 'modern') {
      mrCostume(ctx, costume, c('top'), only ? ink : colours.trim,
        hipY, shoulderY, hipHalf, shoulderHalf, height, pad);
    }

    for (const side of [-1, 1]) {
      const shoulder = side < 0 ? pose.shoulderL : pose.shoulderR;
      const elbow = side < 0 ? pose.elbowL : pose.elbowR;
      const splay = side * 0.17;
      // A sleeve the same colour as the garment behind it disappears; nudge it darker. The
      // outline does the real separating, but the shade keeps a raised arm from reading as
      // part of the chest.
      const sleeve = only ? ink : mrShade(colours.top, -0.1);
      const shoulderX = side * shoulderHalf * 0.95;
      const upper = shoulder + splay, fore = shoulder + splay + elbow;
      if (edge) {
        const j = mrLimb(ctx, shoulderX, armY, upper, armLength * 0.52, limbWidth * 0.85 + edge, ink);
        mrLimb(ctx, j.x, j.y, fore, armLength * 0.48, limbWidth * 0.78 + edge, ink);
      }
      const elbowJoint = mrLimb(ctx, shoulderX, armY, upper, armLength * 0.52, w(limbWidth * 0.85), sleeve);
      const hand = mrLimb(ctx, elbowJoint.x, elbowJoint.y, fore, armLength * 0.48, w(limbWidth * 0.78), sleeve);
      if (edge) {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, limbWidth * 0.5 + edge * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = c('skin');
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, limbWidth * 0.5 + pad, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = c('skin');
    ctx.lineWidth = w(limbWidth * 0.8);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, shoulderY + height * 0.004);
    ctx.lineTo(0, headY + headR * 0.75);
    ctx.stroke();

    ctx.save();
    ctx.translate(0, headY);
    ctx.rotate(pose.headTilt);
    mrHairBack(ctx, 0, 0, headR + pad, actor.hairStyle || 'short', c('hair'));
    ctx.fillStyle = c('skin');
    ctx.beginPath();
    ctx.ellipse(0, 0, headR * 0.88 + pad, headR + pad, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-headR * 0.86, headR * 0.14, headR * 0.13 + pad, headR * 0.19 + pad, 0, 0, Math.PI * 2);
    ctx.fill();
    mrHair(ctx, 0, 0, headR + pad * 0.6, actor.hairStyle || 'short', c('hair'));
    if (headwear !== 'none') {
      mrHeadwear(ctx, headwear, headR + pad * 0.6, only ? ink : (actor.headwearColour || '#e8e2d8'),
        only ? ink : colours.trim);
    }
    ctx.restore();
  };

  ctx.save();
  // `drop` lowers the whole figure so bent legs still reach the floor.
  ctx.translate(x, groundY - pose.bob * height + (pose.drop || 0) * height);
  if (facing === 'left') ctx.scale(-1, 1);
  ctx.rotate(-(pose.lean + age.stoop) * 0.5);

  paint(outline, true);     // ink silhouette
  paint(0, false);          // the character

  // The face goes on last, over the finished head.
  ctx.save();
  ctx.translate(0, headY);
  ctx.rotate(pose.headTilt);
  const turn = pose.headTurn * headR * 0.45;
  const open = Math.max(0.1, expression.eye * (1 - pose.blink));
  const eyeY = headR * 0.16;
  const eyeX = headR * 0.33;
  const eyeR = headR * 0.19 * look.eye * age.eye;
  // Blush first, so the eyes and nose sit on top of it.
  if (look.blush) {
    ctx.fillStyle = 'rgba(214,108,92,0.34)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * headR * 0.56 + turn * 0.5, headR * 0.42, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const side of [-1, 1]) {
    const ex = side * eyeX + turn;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.05 * open, 0, 0, Math.PI * 2);
    ctx.fill();
    if (look.inkWeight > 1.2) {
      // A comic eye is drawn, not just filled.
      ctx.strokeStyle = ink;
      ctx.lineWidth = headR * 0.035;
      ctx.stroke();
    }
    ctx.fillStyle = '#221a16';
    ctx.beginPath();
    ctx.arc(ex + turn * 0.35, eyeY + headR * 0.02, eyeR * 0.47 * Math.min(1, open + 0.25), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colours.hair;
    ctx.lineWidth = headR * 0.08 * look.brow;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - eyeR, eyeY - headR * 0.32 + side * expression.brow * headR * 0.16);
    ctx.lineTo(ex + eyeR, eyeY - headR * 0.32 - side * expression.brow * headR * 0.16);
    ctx.stroke();
  }
  // A nose. Its absence is the single biggest reason the neutral face reads as a mask
  // rather than a cartoon.
  if (look.nose) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = headR * 0.055;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(turn * 0.7, headR * 0.2);
    ctx.quadraticCurveTo(turn * 0.7 + headR * 0.11, headR * 0.36, turn * 0.7 - headR * 0.02, headR * 0.38);
    ctx.stroke();
  }
  mrMouth(ctx, turn * 0.6, headR * (look.nose ? 0.62 : 0.56), headR, expression.mouth, pose.mouthOpen, pose.viseme);
  ctx.restore();
  ctx.restore();
}
