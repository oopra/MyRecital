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

const MR_SKINS = ['#f2c9a0', '#e0aa7c', '#c98b5e', '#a8663c', '#7d4b2c', '#5a3520'];
const MR_HAIRS = ['#1c1512', '#3b2a1d', '#6b4a2b', '#a8722e', '#8d8d95', '#e8e2d8', '#2b3a55'];
const MR_HAIR_STYLES = ['short', 'long', 'bun', 'bald', 'braid'];

// What the character is wearing. 'modern' is a top and trousers; the rest are the shapes
// Indian comics actually draw, and they change the silhouette more than any colour does.
const MR_COSTUMES = ['modern', 'kurta', 'dhoti', 'saree', 'robe'];
const MR_HEADWEAR = ['none', 'turban', 'cap', 'crown'];

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

const MR_ACTIONS = ['idle', 'talk', 'walk', 'point', 'wave', 'think', 'kneel', 'fall'];

// ---------------------------------------------------------------- the pose
//
// A pose is the set of joint angles at one instant. Angles are radians from straight down
// for legs and straight down-ish for arms, so 0 is a figure standing at rest.

function mrPoseBase() {
  return {
    lean: 0, bob: 0, drop: 0, headTurn: 0, headTilt: 0,
    shoulderL: 0.12, elbowL: 0.15, shoulderR: -0.12, elbowR: -0.15,
    hipL: 0.05, kneeL: 0, hipR: -0.05, kneeR: 0,
    mouthOpen: 0, blink: 0
  };
}

// Every cycle is driven by the scene clock and the actor's own seed, so two characters
// doing the same thing are not doing it in lockstep.
function poseFor(action, t, seed, speaking) {
  const p = mrPoseBase();
  const phase = t * 2 * Math.PI;
  const offset = ((seed || 0) % 100) / 100 * Math.PI * 2;

  // Everyone breathes and blinks, whatever else they are doing — stillness reads as dead.
  p.bob = Math.sin(phase * 0.55 + offset) * 0.004;
  const blinkCycle = (t + offset) % 4.3;
  p.blink = blinkCycle < 0.12 ? 1 - Math.abs(blinkCycle - 0.06) / 0.06 : 0;

  switch (action) {
    case 'walk': {
      const s = Math.sin(phase * 2.2 + offset);
      const c = Math.cos(phase * 2.2 + offset);
      p.hipL = s * 0.55; p.hipR = -s * 0.55;
      p.kneeL = Math.max(0, -s) * 0.7; p.kneeR = Math.max(0, s) * 0.7;
      p.shoulderL = -s * 0.5; p.shoulderR = s * 0.5;
      p.elbowL = 0.25 + Math.max(0, s) * 0.3; p.elbowR = -0.25 - Math.max(0, -s) * 0.3;
      p.bob = Math.abs(c) * 0.012;
      p.lean = 0.03;
      break;
    }
    case 'talk': {
      p.headTilt = Math.sin(phase * 0.7 + offset) * 0.05;
      p.shoulderL = 0.12 + Math.sin(phase * 0.9 + offset) * 0.18;
      p.elbowL = 0.5 + Math.sin(phase * 1.3 + offset) * 0.25;
      p.shoulderR = -0.1 + Math.sin(phase * 0.8 + 1 + offset) * 0.1;
      break;
    }
    case 'point': {
      p.shoulderR = -1.35; p.elbowR = -0.1;
      p.headTurn = 0.15;
      break;
    }
    case 'wave': {
      p.shoulderR = -2.1;
      p.elbowR = -0.5 + Math.sin(phase * 3 + offset) * 0.45;
      break;
    }
    case 'think': {
      p.shoulderR = -1.9; p.elbowR = -1.5;
      p.headTilt = 0.12; p.headTurn = -0.1;
      break;
    }
    case 'kneel': {
      p.hipL = 1.2; p.kneeL = 1.4; p.hipR = 0.2; p.kneeR = 1.5;
      p.lean = 0.12;
      // Bent legs reach less far than straight ones, so the hips have to come down or the
      // character kneels in mid-air — which is exactly what the first version did.
      p.drop = 0.16;
      break;
    }
    case 'fall': {
      p.lean = 0.5; p.shoulderL = 0.9; p.shoulderR = -0.9;
      p.hipL = 0.4; p.hipR = -0.3; p.kneeL = 0.5;
      p.drop = 0.04;
      break;
    }
    default:
      p.shoulderL = 0.12 + Math.sin(phase * 0.5 + offset) * 0.03;
      p.shoulderR = -0.12 - Math.sin(phase * 0.5 + offset + 1) * 0.03;
  }

  // Speaking overrides the mouth whatever the body is doing — an actor can talk while
  // walking, and the mouth is what sells it. A number is a measured loudness from the
  // narration (true lip-sync); `true` means "speaking, but we cannot hear it", which
  // falls back to a timed flap.
  if (typeof speaking === 'number') p.mouthOpen = Math.max(0, Math.min(1, speaking));
  else if (speaking) p.mouthOpen = 0.35 + Math.abs(Math.sin(phase * 5.5 + offset)) * 0.65;
  else if (action === 'talk') p.mouthOpen = 0.3 + Math.abs(Math.sin(phase * 4.5 + offset)) * 0.5;
  return p;
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

function mrMouth(ctx, x, y, size, shape, open) {
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.strokeStyle = 'rgba(70,38,28,0.9)';
  ctx.lineCap = 'round';
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
function drawActor(ctx, actor, pose, x, groundY, height, lookName) {
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
  const headwear = actor.headwear || 'none';

  // The look scales the head, the eyes, the limbs and the line — the four numbers that
  // separate a neutral figure from a comic one.
  const headR = height * body.head * look.head / 2;
  const legLength = height * body.legs;
  const torsoLength = height * body.torso;
  const limbWidth = height * 0.052 * look.limb;
  const outline = Math.max(1.5, height * 0.013 * look.inkWeight);

  const hipY = -legLength;
  const shoulderY = hipY - torsoLength;
  const headY = shoulderY - height * 0.02 - headR;
  const hipHalf = height * body.hips / 2;
  const shoulderHalf = height * body.shoulders / 2;
  const armY = shoulderY + height * 0.025;
  const armLength = height * 0.34;

  // One pass over the whole figure. `pad` fattens every stroke and fill for the ink pass.
  const paint = (pad, only) => {
    const c = (key) => (only ? ink : colours[key]);
    const w = (base) => base + pad * 2;

    for (const side of [-1, 1]) {
      const hip = side < 0 ? pose.hipL : pose.hipR;
      const knee = side < 0 ? pose.kneeL : pose.kneeR;
      const kneeJoint = mrLimb(ctx, side * hipHalf * 0.55, hipY, hip, legLength * 0.52, w(limbWidth), c('bottom'));
      const foot = mrLimb(ctx, kneeJoint.x, kneeJoint.y, hip - knee, legLength * 0.48, w(limbWidth * 0.9), c('bottom'));
      mrShoe(ctx, foot.x, foot.y + limbWidth * 0.1, hip - knee, limbWidth + pad, actor.facing, c('shoe'));
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
      // A sleeve the same colour as the garment behind it disappears; nudge it darker.
      const sleeve = only ? ink : (costume === 'modern' ? colours.top : mrShade(colours.top, -0.16));
      const elbowJoint = mrLimb(ctx, side * shoulderHalf * 0.95, armY, shoulder + splay, armLength * 0.52, w(limbWidth * 0.85), sleeve);
      const hand = mrLimb(ctx, elbowJoint.x, elbowJoint.y, shoulder + splay + elbow, armLength * 0.48, w(limbWidth * 0.78), sleeve);
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
  if (actor.facing === 'left') ctx.scale(-1, 1);
  ctx.rotate(-pose.lean * 0.5);

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
  const eyeR = headR * 0.19 * look.eye;
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
  mrMouth(ctx, turn * 0.6, headR * (look.nose ? 0.62 : 0.56), headR, expression.mouth, pose.mouthOpen);
  ctx.restore();
  ctx.restore();
}
