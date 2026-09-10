// props.js — the things that are not people.
//
// Same idea as the actors: every prop is drawn from code, in one flat style with an ink
// outline, so the stage has furniture and scenery without a single asset file. Each prop
// draws in its own unit space — origin at the centre of its base, one unit tall, growing
// upward — and the stage scales and places it, exactly as it does a character.

const MR_PROP_INK = '#15100e';

// Fill a path and ink its edge in one go. Everything here is built from these, which is
// what keeps props and characters looking like they belong in the same film.
function mrShape(ctx, colour, build, lineWidth) {
  ctx.beginPath();
  build();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = MR_PROP_INK;
  ctx.lineWidth = lineWidth != null ? lineWidth : 0.018;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// Each prop: draw(ctx, tint) in unit space. Ground is y = 0, the top of the prop is y = -1.
const MR_PROPS = {
  tree: {
    name: 'Tree', layer: 'back', ratio: 0.8,
    draw(ctx, tint) {
      mrShape(ctx, '#5a3b22', () => { ctx.rect(-0.06, -0.42, 0.12, 0.42); });
      for (let i = 0; i < 3; i++) {
        const y = -0.35 - i * 0.22;
        const r = 0.34 - i * 0.08;
        mrShape(ctx, i % 2 ? tint : mrShade(tint, -0.12), () => {
          ctx.moveTo(-r, y); ctx.lineTo(0, y - 0.34); ctx.lineTo(r, y); ctx.closePath();
        });
      }
    }
  },
  bush: {
    name: 'Bush', layer: 'front', ratio: 1.5,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => {
        ctx.ellipse(-0.22, -0.16, 0.26, 0.18, 0, 0, Math.PI * 2);
      });
      mrShape(ctx, mrShade(tint, 0.08), () => { ctx.ellipse(0.2, -0.18, 0.28, 0.2, 0, 0, Math.PI * 2); });
      mrShape(ctx, tint, () => { ctx.ellipse(0, -0.3, 0.3, 0.24, 0, 0, Math.PI * 2); });
    }
  },
  rock: {
    name: 'Rock', layer: 'front', ratio: 1.4, hold: { x: 0, y: -0.16, tilt: 0, size: 0.16 },
    draw(ctx, tint) {
      mrShape(ctx, tint, () => {
        ctx.moveTo(-0.5, 0); ctx.lineTo(-0.34, -0.62); ctx.lineTo(0.08, -0.82);
        ctx.lineTo(0.44, -0.5); ctx.lineTo(0.5, 0); ctx.closePath();
      });
    }
  },
  mountain: {
    name: 'Mountain', layer: 'back', ratio: 2.2,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => {
        ctx.moveTo(-1.1, 0); ctx.lineTo(-0.3, -0.86); ctx.lineTo(0.15, -0.5);
        ctx.lineTo(0.55, -1); ctx.lineTo(1.1, 0); ctx.closePath();
      }, 0.012);
      mrShape(ctx, '#f0f3f7', () => {
        ctx.moveTo(0.55, -1); ctx.lineTo(0.36, -0.76); ctx.lineTo(0.47, -0.72);
        ctx.lineTo(0.58, -0.82); ctx.lineTo(0.68, -0.74); ctx.closePath();
      }, 0.01);
    }
  },
  chair: {
    name: 'Chair', layer: 'stage', ratio: 0.62,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => { ctx.rect(-0.3, -1, 0.14, 1); });          // back post
      mrShape(ctx, tint, () => { ctx.rect(-0.3, -0.86, 0.6, 0.12); });      // back rail
      mrShape(ctx, mrShade(tint, 0.1), () => { ctx.rect(-0.34, -0.5, 0.68, 0.13); });  // seat
      mrShape(ctx, tint, () => { ctx.rect(-0.3, -0.4, 0.1, 0.4); });
      mrShape(ctx, tint, () => { ctx.rect(0.2, -0.4, 0.1, 0.4); });
    }
  },
  table: {
    name: 'Table', layer: 'stage', ratio: 1.5,
    draw(ctx, tint) {
      mrShape(ctx, mrShade(tint, 0.1), () => { ctx.rect(-0.75, -1, 1.5, 0.18); });
      mrShape(ctx, tint, () => { ctx.rect(-0.6, -0.84, 0.13, 0.84); });
      mrShape(ctx, tint, () => { ctx.rect(0.47, -0.84, 0.13, 0.84); });
    }
  },
  pot: {
    name: 'Pot', layer: 'stage', ratio: 0.8, hold: { x: 0, y: -0.18, tilt: 0.2, size: 0.26 },
    draw(ctx, tint) {
      mrShape(ctx, tint, () => {
        ctx.moveTo(-0.3, -0.1); ctx.quadraticCurveTo(-0.46, -0.55, -0.22, -0.8);
        ctx.lineTo(0.22, -0.8); ctx.quadraticCurveTo(0.46, -0.55, 0.3, -0.1);
        ctx.quadraticCurveTo(0, 0.06, -0.3, -0.1);
      });
      mrShape(ctx, mrShade(tint, -0.15), () => { ctx.rect(-0.28, -0.92, 0.56, 0.14); });
    }
  },
  door: {
    name: 'Doorway', layer: 'back', ratio: 0.7,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => { ctx.rect(-0.5, -1, 1, 1); });
      mrShape(ctx, mrShade(tint, -0.35), () => {
        ctx.moveTo(-0.3, 0); ctx.lineTo(-0.3, -0.62);
        ctx.quadraticCurveTo(0, -0.94, 0.3, -0.62); ctx.lineTo(0.3, 0); ctx.closePath();
      });
    }
  },
  house: {
    name: 'House', layer: 'back', ratio: 1.3,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => { ctx.rect(-0.6, -0.62, 1.2, 0.62); });
      mrShape(ctx, mrShade(tint, -0.25), () => {
        ctx.moveTo(-0.72, -0.6); ctx.lineTo(0, -1); ctx.lineTo(0.72, -0.6); ctx.closePath();
      });
      mrShape(ctx, '#3a2b1e', () => { ctx.rect(-0.14, -0.42, 0.28, 0.42); });
      mrShape(ctx, '#ffd98a', () => { ctx.rect(0.24, -0.5, 0.22, 0.2); });
    }
  },
  cart: {
    name: 'Cart', layer: 'stage', ratio: 1.5,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => {
        ctx.moveTo(-0.7, -0.34); ctx.lineTo(0.7, -0.34); ctx.lineTo(0.56, -0.78);
        ctx.lineTo(-0.56, -0.78); ctx.closePath();
      });
      mrShape(ctx, mrShade(tint, -0.2), () => { ctx.rect(0.66, -0.5, 0.5, 0.08); });   // shaft
      for (const cx of [-0.36, 0.36]) {
        mrShape(ctx, '#2f2a24', () => { ctx.arc(cx, -0.2, 0.22, 0, Math.PI * 2); });
        mrShape(ctx, mrShade(tint, 0.2), () => { ctx.arc(cx, -0.2, 0.08, 0, Math.PI * 2); });
      }
    }
  },
  banner: {
    name: 'Banner', layer: 'stage', ratio: 0.36, hold: { x: 0, y: -0.3, tilt: 0.8, size: 0.5 },
    draw(ctx, tint) {
      mrShape(ctx, '#6b4a2b', () => { ctx.rect(-0.04, -1, 0.08, 1); });
      mrShape(ctx, tint, () => {
        ctx.moveTo(0.02, -0.98); ctx.lineTo(0.6, -0.9); ctx.lineTo(0.46, -0.72);
        ctx.lineTo(0.6, -0.54); ctx.lineTo(0.02, -0.46); ctx.closePath();
      });
    }
  },
  fire: {
    name: 'Fire', layer: 'stage', ratio: 1.1, hold: { x: 0, y: -0.2, tilt: 0.5, size: 0.22 },
    draw(ctx, tint) {
      mrShape(ctx, '#4a3527', () => { ctx.rect(-0.4, -0.16, 0.8, 0.16); });
      mrShape(ctx, tint, () => {
        ctx.moveTo(-0.28, -0.14); ctx.quadraticCurveTo(-0.34, -0.6, 0, -0.95);
        ctx.quadraticCurveTo(0.34, -0.6, 0.28, -0.14); ctx.closePath();
      });
      mrShape(ctx, '#ffe08a', () => {
        ctx.moveTo(-0.13, -0.14); ctx.quadraticCurveTo(-0.16, -0.42, 0, -0.62);
        ctx.quadraticCurveTo(0.16, -0.42, 0.13, -0.14); ctx.closePath();
      }, 0.008);
    }
  },
  well: {
    name: 'Well', layer: 'stage', ratio: 1.0,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => { ctx.rect(-0.42, -0.5, 0.84, 0.5); });
      mrShape(ctx, '#1b232e', () => { ctx.ellipse(0, -0.5, 0.42, 0.1, 0, 0, Math.PI * 2); });
      mrShape(ctx, '#6b4a2b', () => { ctx.rect(-0.38, -1, 0.08, 0.52); });
      mrShape(ctx, '#6b4a2b', () => { ctx.rect(0.3, -1, 0.08, 0.52); });
      mrShape(ctx, mrShade(tint, -0.2), () => {
        ctx.moveTo(-0.52, -0.96); ctx.lineTo(0, -1.2); ctx.lineTo(0.52, -0.96); ctx.closePath();
      });
    }
  },
  spear: {
    name: 'Spear', layer: 'stage', ratio: 0.14, hold: { x: 0, y: -0.45, tilt: 1, size: 0.62 },
    draw(ctx, tint) {
      mrShape(ctx, '#7a5a34', () => { ctx.rect(-0.035, -0.86, 0.07, 0.86); });
      mrShape(ctx, tint, () => {
        ctx.moveTo(-0.09, -0.84); ctx.lineTo(0, -1.02); ctx.lineTo(0.09, -0.84); ctx.closePath();
      }, 0.012);
    }
  },
  // ---- things a person can carry. `hold` says where the hand goes on the prop and
  // whether it tilts with the arm: a spear follows the forearm, a pot stays upright
  // however the arm is waving.
  sword: {
    name: 'Sword', layer: 'stage', ratio: 0.3, hold: { x: 0, y: -0.22, tilt: 1, size: 0.42 },
    draw(ctx, tint) {
      mrShape(ctx, '#3a2b1e', () => { ctx.rect(-0.05, -0.22, 0.1, 0.22); });        // grip
      mrShape(ctx, mrShade(tint, -0.2), () => { ctx.rect(-0.18, -0.28, 0.36, 0.07); }); // guard
      mrShape(ctx, tint, () => {
        ctx.moveTo(-0.08, -0.28); ctx.lineTo(-0.06, -0.9); ctx.lineTo(0, -1);
        ctx.lineTo(0.06, -0.9); ctx.lineTo(0.08, -0.28); ctx.closePath();
      });
    }
  },
  scroll: {
    name: 'Scroll', layer: 'stage', ratio: 0.5, hold: { x: 0, y: -0.5, tilt: 0.35, size: 0.3 },
    draw(ctx, tint) {
      mrShape(ctx, tint, () => { ctx.rect(-0.34, -0.62, 0.68, 0.36); });
      for (const x of [-0.34, 0.28]) {
        mrShape(ctx, mrShade(tint, -0.25), () => { ctx.rect(x, -0.68, 0.06, 0.48); });
      }
      ctx.strokeStyle = 'rgba(60,45,30,0.5)';
      ctx.lineWidth = 0.012;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-0.24, -0.56 + i * 0.09);
        ctx.lineTo(0.24, -0.56 + i * 0.09);
        ctx.stroke();
      }
    }
  },

  // ---- landmarks. One shape per era, because a period reads from its skyline first.
  pyramid: {
    name: 'Pyramid', layer: 'back', ratio: 1.6,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => { ctx.moveTo(-0.8, 0); ctx.lineTo(0, -1); ctx.lineTo(0.8, 0); ctx.closePath(); });
      mrShape(ctx, mrShade(tint, -0.22), () => { ctx.moveTo(0, -1); ctx.lineTo(0.8, 0); ctx.lineTo(0.1, 0); ctx.closePath(); });
    }
  },
  column: {
    name: 'Column', layer: 'stage', ratio: 0.42,
    draw(ctx, tint) {
      mrShape(ctx, mrShade(tint, -0.1), () => { ctx.rect(-0.21, -0.09, 0.42, 0.09); });      // base
      mrShape(ctx, tint, () => { ctx.rect(-0.15, -0.9, 0.3, 0.81); });                       // shaft
      mrShape(ctx, mrShade(tint, -0.14), () => { ctx.rect(-0.05, -0.9, 0.05, 0.81); });      // one flute
      mrShape(ctx, mrShade(tint, 0.1), () => { ctx.rect(-0.22, -1, 0.44, 0.1); });           // capital
    }
  },
  tower: {
    name: 'Tower', layer: 'back', ratio: 0.7,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => { ctx.rect(-0.3, -0.86, 0.6, 0.86); });
      mrShape(ctx, mrShade(tint, -0.18), () => { ctx.rect(0.08, -0.86, 0.22, 0.86); });
      // Crenellations: three teeth is enough to say castle.
      for (const x of [-0.3, -0.1, 0.1]) mrShape(ctx, mrShade(tint, 0.08), () => { ctx.rect(x, -1, 0.2, 0.16); });
      mrShape(ctx, '#2b2119', () => {
        ctx.moveTo(-0.09, -0.44); ctx.lineTo(-0.09, -0.6);
        ctx.quadraticCurveTo(0, -0.72, 0.09, -0.6); ctx.lineTo(0.09, -0.44); ctx.closePath();
      });
    }
  },
  cloud: {
    name: 'Cloud', layer: 'back', ratio: 2.0,
    draw(ctx, tint) {
      mrShape(ctx, tint, () => {
        ctx.ellipse(-0.42, -0.3, 0.34, 0.22, 0, 0, Math.PI * 2);
      }, 0.01);
      mrShape(ctx, tint, () => { ctx.ellipse(0.1, -0.4, 0.46, 0.3, 0, 0, Math.PI * 2); }, 0.01);
      mrShape(ctx, tint, () => { ctx.ellipse(0.55, -0.28, 0.3, 0.2, 0, 0, Math.PI * 2); }, 0.01);
    }
  }
};

// Lighten or darken a hex colour — how every prop gets its own shading without a palette
// per object.
function mrShade(hex, amount) {
  const [r, g, b] = mrHexToRgb(hex);
  const mix = (v) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

const MR_PROP_KINDS = Object.keys(MR_PROPS);

function makeProp(kind, opts) {
  const o = opts || {};
  const spec = MR_PROPS[kind] || MR_PROPS.tree;
  return {
    id: mrActorId(),
    type: 'prop',
    kind,
    name: spec.name,
    tint: o.tint || '#1f7a53',
    layer: o.layer || spec.layer,
    heldBy: o.heldBy || '',        // a character's name: this prop travels in their hand
    hand: o.hand || 'right',
    keys: o.keys || [Object.assign({}, MR_DEFAULT_KEY, { scale: 0.35, y: 0.88 }, o.start || {})]
  };
}

// Which props can be picked up, for the editor to offer.
function propIsHoldable(kind) {
  return !!(MR_PROPS[kind] && MR_PROPS[kind].hold);
}

// Draw a prop in somebody's hand rather than on the ground. The prop is scaled to the
// person holding it — a child's spear is a child-sized spear — and tilts with the forearm
// by however much its own `hold` says: a spear follows the arm, a pot stays upright while
// the arm waves it about.
function drawHeldProp(ctx, prop, hand, height) {
  const spec = MR_PROPS[prop.kind];
  if (!spec || !spec.hold) return;
  const size = height * spec.hold.size * (prop.holdScale || 1);
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(hand.angle * spec.hold.tilt);
  if (hand.flip < 0) ctx.scale(-1, 1);
  ctx.scale(size, size);
  // The grip is the point on the prop the hand is closed around, so it goes to the origin.
  ctx.translate(-spec.hold.x, -spec.hold.y);
  spec.draw(ctx, prop.tint);
  ctx.restore();
}

// Draw one prop at a state produced by the same keyframe machinery the actors use.
function drawProp(ctx, prop, state, w, h) {
  const spec = MR_PROPS[prop.kind];
  if (!spec) return;
  const size = state.scale * h;
  ctx.save();
  ctx.translate(state.x * w, state.y * h);
  if (state.rotate) ctx.rotate(state.rotate);
  if (state.facing === 'left') ctx.scale(-1, 1);
  ctx.scale(size, size);
  // Line widths are in unit space, so they scale with the prop and stay proportional.
  spec.draw(ctx, prop.tint);
  ctx.restore();
}
