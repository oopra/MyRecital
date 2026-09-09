// render.js — draw one frame of the video.
//
// The whole renderer is a pure function of (project, time): renderFrame() never reads the
// clock, never mutates the project, and never touches the DOM beyond the canvas it is
// handed. That is what lets the preview, the scrubber, the thumbnail strip and the
// recorder all share exactly one code path — what you scrub past is what gets exported.
//
// Coordinates are always the export resolution (e.g. 1080x1920). Small canvases just
// scale the context before calling in.

const MR_ASPECTS = {
  '9:16': { w: 1080, h: 1920, label: 'Shorts / TikTok' },
  '1:1':  { w: 1080, h: 1080, label: 'Square' },
  '16:9': { w: 1920, h: 1080, label: 'Landscape' }
};

// Palettes are ordered [deep, mid, light, accent, accent2]. Backgrounds paint with the
// first three, captions and highlights use the accents.
const MR_PALETTES = {
  midnight: { name: 'Midnight',  colors: ['#070b18', '#152047', '#3a5cc8', '#7fd4ff', '#ff77c8'] },
  ember:    { name: 'Ember',     colors: ['#160806', '#4a1408', '#a8330f', '#ffb347', '#fff1c9'] },
  forest:   { name: 'Forest',    colors: ['#04120d', '#0c3a2a', '#1f7a53', '#9ff0b5', '#ffe08a'] },
  bloom:    { name: 'Bloom',     colors: ['#1a0620', '#4a1145', '#a3358c', '#ffb3e6', '#ffe9a8'] },
  paper:    { name: 'Paper',     colors: ['#f4efe6', '#ded3c0', '#8a7a63', '#c2452d', '#2b2118'] },
  noir:     { name: 'Noir',      colors: ['#0a0a0b', '#1e1e22', '#4a4a52', '#e0483f', '#e8e8ee'] },
  candy:    { name: 'Candy',     colors: ['#1b1035', '#3b1f7a', '#7a4bff', '#57e6ff', '#ffd166'] },
  comicday: { name: 'Comic day', colors: ['#1d3b2a', '#3f7a4a', '#5aa9e6', '#e8b04b', '#f6d76b'] },
  comicdusk: { name: 'Comic dusk', colors: ['#2a1b2e', '#7a4a5a', '#e08a5a', '#ffd08a', '#ffeec2'] },
  tide:     { name: 'Tide',      colors: ['#03151c', '#0a3a4a', '#12879e', '#7ff0e0', '#ffc46b'] },
  // Period palettes. The eras a history reel spends its time in, mixed so the flat
  // backgrounds land somewhere real: desert, marble, wet stone, coal smoke.
  sand:     { name: 'Sand',      colors: ['#2a1d10', '#c9a86a', '#7fc4e8', '#e0b23c', '#fff0c4'] },
  marble:   { name: 'Marble',    colors: ['#232028', '#b9b089', '#8fc6e0', '#d9c98f', '#fff8e8'] },
  stone:    { name: 'Stone',     colors: ['#1c1f26', '#5f6b58', '#9fb6cc', '#8c8272', '#e8e4d8'] },
  sepia:    { name: 'Sepia',     colors: ['#241a12', '#8a7a5e', '#b9c3c9', '#c0a06a', '#f2e6cf'] },
  mughal:   { name: 'Mughal',    colors: ['#241634', '#7a5a8a', '#8fc6e0', '#e0a83c', '#ffe9b8'] }
};

const MR_FONTS = {
  display: { name: 'Display',  stack: '"Arial Black", "Helvetica Neue", Impact, sans-serif', weight: '900', spacing: -0.01 },
  grotesk: { name: 'Grotesk',  stack: 'Inter, "Helvetica Neue", Arial, sans-serif',          weight: '800', spacing: 0 },
  serif:   { name: 'Serif',    stack: 'Georgia, "Times New Roman", serif',                   weight: '700', spacing: 0.005 },
  rounded: { name: 'Rounded',  stack: '"Trebuchet MS", Verdana, sans-serif',                 weight: '700', spacing: 0.01 },
  mono:    { name: 'Mono',     stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', weight: '700', spacing: 0.02 }
};

const MR_BACKGROUNDS = ['flatland', 'village', 'gradient', 'starfield', 'aurora', 'rain', 'embers', 'waves', 'city', 'forest', 'orbit', 'mist', 'grid', 'confetti', 'corridor'];
const MR_MOTIONS = ['none', 'zoom', 'pull', 'pan', 'drift', 'bob', 'push', 'shake'];
const MR_TRANSITIONS = ['cut', 'fade', 'dissolve', 'slide', 'wipe', 'flash'];
const MR_CAPTION_STYLES = ['balloon', 'subtitle', 'kinetic', 'karaoke', 'block', 'dialogue', 'title', 'none'];
const MR_TRANSITION_SECONDS = 0.42;

function paletteOf(project) {
  return (MR_PALETTES[project.style.palette] || MR_PALETTES.midnight).colors;
}
function fontOf(project) {
  return MR_FONTS[project.style.font] || MR_FONTS.display;
}
function dimensionsOf(project) {
  return MR_ASPECTS[project.style.aspect] || MR_ASPECTS['9:16'];
}
function accentOf(project, scene) {
  return (scene && scene.accent) || paletteOf(project)[3];
}

// ---------------------------------------------------------------- colour helpers

function mrHexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
function mrRgba(hex, alpha) {
  const [r, g, b] = mrHexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
function mrLuminance(hex) {
  const [r, g, b] = mrHexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// A palette is "light" when its deepest colour still reads as paper. Captions then flip:
// dark ink on a pale plate, because white-on-cream is unreadable at phone size.
function mrIsLightPalette(colors) {
  return mrLuminance(colors[0]) > 0.55;
}

function mrInkFor(colors) {
  if (!mrIsLightPalette(colors)) return '#ffffff';
  let ink = colors[0], darkest = 1;
  for (const colour of colors) {
    const l = mrLuminance(colour);
    if (l < darkest) { darkest = l; ink = colour; }
  }
  return ink;
}

function mrMix(a, b, amount) {
  const A = mrHexToRgb(a), B = mrHexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * amount));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Easing: everything on screen moves on one of these so the whole reel feels of a piece.
const mrEaseOut = (t) => 1 - Math.pow(1 - t, 3);
const mrEaseInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mrClamp01 = (t) => Math.max(0, Math.min(1, t));

// ---------------------------------------------------------------- scratch surfaces

// One reusable offscreen canvas per role. Transitions need to composite two scenes, and
// allocating a 1080x1920 canvas per frame would thrash the GC during a recording.
const mrScratch = {};
function mrSurface(key, w, h) {
  let s = mrScratch[key];
  if (!s) { s = mrScratch[key] = { canvas: document.createElement('canvas') }; }
  if (s.canvas.width !== w || s.canvas.height !== h) { s.canvas.width = w; s.canvas.height = h; }
  s.ctx = s.canvas.getContext('2d');
  return s;
}

// A small tiled noise texture, generated once. Per-frame grain is just this pattern drawn
// at a jittered offset — cheap enough to keep 30fps at full resolution.
let mrGrainPattern = null;
function mrGrain(ctx) {
  if (!mrGrainPattern) {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const rand = mrRandom(9241);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + rand() * 135;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    mrGrainPattern = c;
  }
  return ctx.createPattern(mrGrainPattern, 'repeat');
}

// ---------------------------------------------------------------- backgrounds
//
// Every background is a pure draw: (ctx, w, h, colors, scene, t). They never allocate
// per-frame state — particle positions come back out of the scene's seeded PRNG each
// frame, which costs a little maths and buys perfect scrubbing.

function bgGradient(ctx, w, h, colors, scene, t) {
  const angle = t * 0.08 + scene.seed * 0.001;
  const cx = w / 2 + Math.cos(angle) * w * 0.25;
  const cy = h / 2 + Math.sin(angle * 0.8) * h * 0.18;
  const g = ctx.createRadialGradient(cx, cy, 0, w / 2, h / 2, Math.max(w, h) * 0.85);
  g.addColorStop(0, colors[2]);
  g.addColorStop(0.45, colors[1]);
  g.addColorStop(1, colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // A second, slower blob keeps the frame from reading as a flat vignette.
  const g2 = ctx.createRadialGradient(w - cx, h - cy, 0, w - cx, h - cy, Math.max(w, h) * 0.45);
  g2.addColorStop(0, mrRgba(colors[3], 0.18));
  g2.addColorStop(1, mrRgba(colors[3], 0));
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);
}

function bgStarfield(ctx, w, h, colors, scene, t) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mrRgba(colors[1], 0.9));
  g.addColorStop(1, mrRgba(colors[0], 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = mrRandom(scene.seed + 17);
  for (let layer = 0; layer < 3; layer++) {
    const count = 90 - layer * 20;
    const speed = (layer + 1) * 6;
    const size = (layer + 1) * (w / 900);
    for (let i = 0; i < count; i++) {
      const x = rand() * w;
      const y0 = rand() * h;
      const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(t * (0.8 + rand()) + i));
      const y = (y0 + t * speed) % h;
      ctx.fillStyle = mrRgba(layer === 2 ? colors[3] : colors[4], twinkle * (0.35 + layer * 0.22));
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function bgAurora(ctx, w, h, colors, scene, t) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const rand = mrRandom(scene.seed + 3);
  for (let band = 0; band < 4; band++) {
    const hue = band % 2 ? colors[3] : colors[4];
    const phase = rand() * 10;
    const amp = h * (0.05 + rand() * 0.07);
    const yBase = h * (0.2 + band * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, yBase);
    for (let x = 0; x <= w; x += w / 40) {
      const y = yBase + Math.sin(x / w * 4 + t * 0.5 + phase) * amp + Math.sin(x / w * 9 - t * 0.3) * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0, yBase - amp, 0, yBase + h * 0.35);
    grad.addColorStop(0, mrRgba(hue, 0.32));
    grad.addColorStop(1, mrRgba(hue, 0));
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function bgRain(ctx, w, h, colors, scene, t) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, colors[1]);
  g.addColorStop(1, colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = mrRandom(scene.seed + 41);
  const wind = Math.sin(t * 0.4) * 0.25 + 0.18;
  ctx.lineCap = 'round';
  for (let i = 0; i < 170; i++) {
    const speed = 900 + rand() * 1400;
    const len = 30 + rand() * 90;
    const x0 = rand() * (w * 1.4) - w * 0.2;
    const y = (rand() * h + t * speed) % (h + len) - len;
    const x = x0 + y * wind;
    ctx.strokeStyle = mrRgba(colors[3], 0.06 + rand() * 0.16);
    ctx.lineWidth = 1 + rand() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * wind, y + len);
    ctx.stroke();
  }
}

function bgEmbers(ctx, w, h, colors, scene, t) {
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, colors[1]);
  g.addColorStop(0.6, colors[0]);
  g.addColorStop(1, colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = mrRandom(scene.seed + 77);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 120; i++) {
    const speed = 60 + rand() * 190;
    const life = (h + 200) / speed;
    const born = rand() * life;
    const age = (t + born) % life;
    const y = h + 60 - age * speed;
    const drift = Math.sin((t + i) * 0.6 + i) * (w * 0.05);
    const x = rand() * w + drift;
    const size = (1.5 + rand() * 5) * (w / 1080);
    const fade = 1 - age / life;
    ctx.fillStyle = mrRgba(rand() > 0.7 ? colors[4] : colors[3], 0.55 * fade);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function bgWaves(ctx, w, h, colors, scene, t) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, colors[1]);
  g.addColorStop(1, colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let layer = 5; layer >= 0; layer--) {
    const y0 = h * (0.42 + layer * 0.1);
    const amp = h * 0.035 * (1 + layer * 0.35);
    const speed = 0.35 + layer * 0.18;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, y0);
    for (let x = 0; x <= w; x += w / 48) {
      ctx.lineTo(x, y0 + Math.sin(x / w * (2 + layer) + t * speed + layer) * amp);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = mrRgba(layer % 2 ? colors[2] : colors[1], 0.22 + layer * 0.09);
    ctx.fill();
  }
}

function bgCity(ctx, w, h, colors, scene, t) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, colors[1]);
  g.addColorStop(0.55, mrMix(colors[1], colors[3], 0.25));
  g.addColorStop(1, colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Moon / sun disc, parked off-centre, with the haze a real one picks up near a skyline.
  const moonX = w * 0.7, moonY = h * 0.28, moonR = w * 0.09;
  const halo = ctx.createRadialGradient(moonX, moonY, moonR * 0.6, moonX, moonY, moonR * 3.2);
  halo.addColorStop(0, mrRgba(colors[4], 0.28));
  halo.addColorStop(1, mrRgba(colors[4], 0));
  ctx.fillStyle = halo;
  ctx.fillRect(moonX - moonR * 3.2, moonY - moonR * 3.2, moonR * 6.4, moonR * 6.4);
  ctx.fillStyle = mrRgba(colors[4], 0.62);
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.fill();
  for (let layer = 0; layer < 3; layer++) {
    const rand = mrRandom(scene.seed + layer * 31);
    const baseY = h * (0.62 + layer * 0.11);
    const shift = (t * (6 + layer * 14)) % (w * 0.5);
    ctx.fillStyle = mrMix(colors[0], colors[1], 0.35 - layer * 0.12);
    ctx.beginPath();
    ctx.moveTo(-shift, h);
    let x = -shift;
    while (x < w + w * 0.6) {
      const bw = w * (0.05 + rand() * 0.09);
      const bh = h * (0.06 + rand() * (0.16 + layer * 0.05));
      ctx.lineTo(x, baseY - bh);
      ctx.lineTo(x + bw, baseY - bh);
      x += bw;
      ctx.lineTo(x, baseY);
    }
    ctx.lineTo(x, h);
    ctx.closePath();
    ctx.fill();
    // Lit windows on the nearest layer only — enough to read as a city, cheap to draw.
    if (layer === 2) {
      const wr = mrRandom(scene.seed + 991);
      for (let i = 0; i < 60; i++) {
        if (wr() > 0.5 + Math.sin(t * 0.7 + i) * 0.1) continue;
        ctx.fillStyle = mrRgba(colors[4], 0.5);
        ctx.fillRect(-shift + wr() * (w + w * 0.6), baseY - wr() * h * 0.14, w * 0.006, w * 0.01);
      }
    }
  }
}

function bgForest(ctx, w, h, colors, scene, t) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mrMix(colors[1], colors[3], 0.3));
  g.addColorStop(1, colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let layer = 0; layer < 4; layer++) {
    const rand = mrRandom(scene.seed + layer * 57);
    const shade = mrMix(colors[0], colors[2], 0.42 - layer * 0.1);
    const baseY = h * (0.72 + layer * 0.08);
    const sway = Math.sin(t * 0.5 + layer) * (w * 0.006) * (4 - layer);
    ctx.fillStyle = shade;
    for (let i = 0; i < 9 + layer * 3; i++) {
      const x = rand() * w * 1.1 - w * 0.05 + sway;
      const treeH = h * (0.2 + rand() * (0.3 - layer * 0.05));
      const treeW = treeH * 0.34;
      ctx.beginPath();
      ctx.moveTo(x, baseY - treeH);
      ctx.lineTo(x + treeW / 2, baseY);
      ctx.lineTo(x - treeW / 2, baseY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(0, baseY, w, h - baseY);
  }
}

function bgOrbit(ctx, w, h, colors, scene, t) {
  bgGradient(ctx, w, h, colors, scene, t * 0.4);
  const cx = w / 2, cy = h * 0.45;
  const rand = mrRandom(scene.seed + 13);
  for (let ring = 0; ring < 4; ring++) {
    const r = w * (0.18 + ring * 0.12);
    const speed = (ring % 2 ? 1 : -1) * (0.25 + ring * 0.12);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * speed + rand() * 6);
    ctx.strokeStyle = mrRgba(colors[3], 0.14);
    ctx.lineWidth = w * 0.002;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    const dots = 3 + ring;
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * Math.PI * 2;
      ctx.fillStyle = mrRgba(i % 2 ? colors[4] : colors[3], 0.85);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.42, w * (0.004 + ring * 0.002), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function bgMist(ctx, w, h, colors, scene, t) {
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, mrMix(colors[0], colors[1], 0.55));
  base.addColorStop(1, colors[0]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const rand = mrRandom(scene.seed + 5);
  for (let i = 0; i < 14; i++) {
    const r = w * (0.18 + rand() * 0.35);
    const x = w / 2 + Math.cos(t * (0.08 + rand() * 0.12) + i) * w * 0.4;
    const y = h / 2 + Math.sin(t * (0.06 + rand() * 0.1) + i * 2) * h * 0.35;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = i % 3 === 0 ? colors[3] : colors[2];
    grad.addColorStop(0, mrRgba(tone, 0.22));
    grad.addColorStop(1, mrRgba(tone, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function bgGrid(ctx, w, h, colors, scene, t) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.55, colors[1]);
  g.addColorStop(1, colors[0]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const horizon = h * 0.5;
  ctx.strokeStyle = mrRgba(colors[3], 0.4);
  ctx.lineWidth = Math.max(1, w * 0.0018);
  // Verticals converging on a vanishing point.
  for (let i = -12; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + i * w * 0.09, h);
    ctx.lineTo(w / 2 + i * w * 0.012, horizon);
    ctx.stroke();
  }
  // Horizontals accelerating toward the viewer.
  for (let i = 0; i < 16; i++) {
    const p = ((i + (t * 0.35) % 1) / 16);
    const y = horizon + Math.pow(p, 2.4) * (h - horizon);
    ctx.strokeStyle = mrRgba(colors[3], 0.08 + p * 0.35);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const sun = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, w * 0.3);
  sun.addColorStop(0, mrRgba(colors[4], 0.55));
  sun.addColorStop(1, mrRgba(colors[4], 0));
  ctx.fillStyle = sun;
  ctx.fillRect(0, horizon - w * 0.3, w, w * 0.6);
}

function bgConfetti(ctx, w, h, colors, scene, t) {
  bgGradient(ctx, w, h, colors, scene, t * 0.3);
  const rand = mrRandom(scene.seed + 202);
  for (let i = 0; i < 90; i++) {
    const speed = 140 + rand() * 320;
    const life = (h + 200) / speed;
    const age = (t + rand() * life) % life;
    const x = rand() * w + Math.sin(age * 2 + i) * w * 0.05;
    const y = -80 + age * speed;
    const size = (6 + rand() * 14) * (w / 1080);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(age * (2 + rand() * 4) + i);
    ctx.fillStyle = mrRgba([colors[2], colors[3], colors[4]][i % 3], 0.85);
    ctx.fillRect(-size / 2, -size / 4, size, size / 2);
    ctx.restore();
  }
}

function bgCorridor(ctx, w, h, colors, scene, t) {
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.48;
  for (let i = 0; i < 14; i++) {
    const p = ((i + (t * 0.5) % 1) / 14);
    const scale = Math.pow(p, 2.2);
    const rw = w * 1.4 * scale, rh = h * 1.1 * scale;
    ctx.strokeStyle = mrRgba(i % 3 === 0 ? colors[3] : colors[2], 0.12 + p * 0.5);
    ctx.lineWidth = Math.max(1, w * 0.004 * (0.4 + p));
    ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
  }
}

// Flat, painted-looking scenery: a sky band, rolling ground and a horizon. Indian comic
// backgrounds are colour fields, not the atmospheric gradients the reel started with, and
// a flat background is also what lets ink-outlined characters read against it.
function bgFlatland(ctx, w, h, colors, scene, t) {
  const horizon = h * 0.66;
  ctx.fillStyle = mrMix(colors[2], '#ffffff', 0.45);
  ctx.fillRect(0, 0, w, horizon);
  ctx.fillStyle = mrMix(colors[4], '#ffffff', 0.2);
  ctx.beginPath();
  ctx.arc(w * 0.78, horizon * 0.4, h * 0.05, 0, Math.PI * 2);
  ctx.fill();
  // Two bands of hills, each a flat colour with a scalloped top edge.
  const rand = mrRandom(scene.seed + 61);
  for (let band = 0; band < 2; band++) {
    const baseY = horizon - h * (0.04 - band * 0.03);
    ctx.fillStyle = mrMix(colors[1], colors[3], band === 0 ? 0.25 : 0.45);
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, baseY);
    for (let x = 0; x <= w; x += w / 6) {
      const lift = h * (0.03 + rand() * 0.05);
      ctx.quadraticCurveTo(x + w / 12, baseY - lift, x + w / 6, baseY);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = mrMix(colors[1], '#8a9a3a', 0.4);
  ctx.fillRect(0, horizon, w, h - horizon);
  void t;
}

function bgVillage(ctx, w, h, colors, scene, t) {
  bgFlatland(ctx, w, h, colors, scene, t);
  const rand = mrRandom(scene.seed + 12);
  const horizon = h * 0.66;
  // A row of flat huts along the horizon: two shapes and a door, repeated.
  for (let i = 0; i < 5; i++) {
    const x = w * (0.06 + i * 0.2) + rand() * w * 0.04;
    const hw = w * (0.07 + rand() * 0.04);
    const hh = h * (0.06 + rand() * 0.04);
    ctx.fillStyle = mrMix(colors[1], '#c8a877', 0.55);
    ctx.fillRect(x - hw / 2, horizon - hh, hw, hh);
    ctx.fillStyle = mrMix(colors[0], '#7a5a34', 0.5);
    ctx.beginPath();
    ctx.moveTo(x - hw * 0.72, horizon - hh);
    ctx.lineTo(x, horizon - hh - h * 0.045);
    ctx.lineTo(x + hw * 0.72, horizon - hh);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(40,26,18,0.75)';
    ctx.fillRect(x - hw * 0.12, horizon - hh * 0.55, hw * 0.24, hh * 0.55);
  }
}

const MR_BG_FUNCTIONS = {
  flatland: bgFlatland, village: bgVillage,
  gradient: bgGradient, starfield: bgStarfield, aurora: bgAurora, rain: bgRain, embers: bgEmbers,
  waves: bgWaves, city: bgCity, forest: bgForest, orbit: bgOrbit, mist: bgMist, grid: bgGrid,
  confetti: bgConfetti, corridor: bgCorridor
};

// ---------------------------------------------------------------- camera motion

// The camera transform for a scene at progress p (0..1). Returned as numbers rather than
// applied, so callers can dampen it (the preview strip renders thumbnails un-moved).
function cameraFor(scene, p, intensityScale) {
  const k = (scene.intensity != null ? scene.intensity : 1) * (intensityScale != null ? intensityScale : 1);
  const e = mrEaseInOut(p);
  switch (scene.motion) {
    case 'zoom':  return { scale: 1 + 0.14 * k * e, x: 0, y: 0, rotate: 0 };
    case 'pull':  return { scale: 1.14 - 0.13 * k * e, x: 0, y: 0, rotate: 0 };
    case 'pan':   return { scale: 1.12, x: (-0.06 + 0.12 * e) * k, y: 0, rotate: 0 };
    case 'drift': return { scale: 1.08, x: Math.sin(p * Math.PI) * 0.03 * k, y: (-0.02 + 0.04 * e) * k, rotate: 0.004 * k * Math.sin(p * Math.PI * 2) };
    case 'bob':   return { scale: 1.06 + Math.sin(p * Math.PI * 2) * 0.012 * k, x: 0, y: Math.sin(p * Math.PI * 3) * 0.012 * k, rotate: 0 };
    case 'push':  return { scale: 1 + 0.22 * k * mrEaseOut(p), x: 0, y: 0, rotate: 0 };
    case 'shake': return { scale: 1.08, x: Math.sin(p * 62) * 0.006 * k, y: Math.cos(p * 71) * 0.006 * k, rotate: Math.sin(p * 53) * 0.006 * k };
    default:      return { scale: 1, x: 0, y: 0, rotate: 0 };
  }
}

// ---------------------------------------------------------------- captions

// Wrap words into lines that fit `maxWidth` at the given font size. Returns the lines
// and the per-line word ranges, which the kinetic styles need to animate word by word.
function layoutCaption(ctx, text, fontSpec, maxWidth) {
  ctx.font = fontSpec;
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = [], lineWidth = 0;
  for (const word of words) {
    const candidate = line.length ? line.join(' ') + ' ' + word : word;
    const width = ctx.measureText(candidate).width;
    if (line.length && width > maxWidth) {
      lines.push(line);
      line = [word];
      lineWidth = ctx.measureText(word).width;
    } else {
      line.push(word);
      lineWidth = width;
    }
  }
  if (line.length) lines.push(line);
  return { lines, lineWidth };
}

// Fitting a caption costs a few hundred measureText calls, and the answer only changes
// when the text, the font or the box does — so memoise it. At 30fps this is the difference
// between a recording that keeps up and one that drops frames on long captions.
const mrCaptionCache = new Map();

// Pick the largest font size that fits the caption into the text box, so a two-word beat
// fills the frame and a long one still fits without clipping.
function fitCaption(ctx, text, font, box, opts) {
  const o = opts || {};
  const cacheKey = [text, font.stack, font.weight, Math.round(box.w), Math.round(box.h),
    Math.round(o.maxSize || 0), Math.round(o.minSize || 0), o.maxLines || 0].join('|');
  const cached = mrCaptionCache.get(cacheKey);
  if (cached) return cached;
  const maxSize = o.maxSize || box.h * 0.22;
  const minSize = o.minSize || box.h * 0.05;
  let size = maxSize;
  let layout = null;
  for (let i = 0; i < 26; i++) {
    const spec = `${font.weight} ${Math.round(size)}px ${font.stack}`;
    layout = layoutCaption(ctx, text, spec, box.w);
    const lineHeight = size * 1.12;
    if (layout.lines.length * lineHeight <= box.h && layout.lines.length <= (o.maxLines || 5)) break;
    size *= 0.9;
    if (size < minSize) { size = minSize; break; }
  }
  const spec = `${font.weight} ${Math.round(size)}px ${font.stack}`;
  layout = layoutCaption(ctx, text, spec, box.w);
  const result = { size: Math.round(size), spec, lines: layout.lines };
  // Plenty for a reel's worth of captions at a few box sizes; clear the oldest beyond it.
  if (mrCaptionCache.size > 400) mrCaptionCache.clear();
  mrCaptionCache.set(cacheKey, result);
  return result;
}

// ctx.roundRect only landed in browsers recently; this keeps the caption plate working
// on anything that can run MediaRecorder at all.
// Adds a rounded rectangle to the CURRENT path. Kept separate from mrRoundRect because
// that one starts a new path, which silently erases anything already in it — which is how
// the comic panel border first came out as a sheet of paper over the whole picture.
function mrRoundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function mrRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function mrIsEmphasised(word, emphasis) {
  if (!emphasis || !emphasis.length) return false;
  const clean = word.toLowerCase().replace(/[^a-z0-9'-]/g, '');
  return emphasis.some((e) => clean === e || (e.length > 4 && clean.startsWith(e)));
}

// The caption box: a safe area that keeps text clear of the phone UI and the progress bar.
function captionBox(w, h, position, style) {
  // A subtitle is furniture: low, narrow, out of the way of faces. A kinetic caption is
  // the performance itself and gets the middle of the frame.
  if (style === 'subtitle') {
    // Cap the line length: on a wide frame a full-width subtitle is an unreadable ribbon.
    const boxW = Math.min(w * 0.86, h * 1.15);
    // Low enough to sit over feet rather than faces or torsos — where a subtitle belongs,
    // and the difference between "subtitled" and "text written across the actors".
    return { x: (w - boxW) / 2, y: h * 0.8, w: boxW, h: h * 0.145 };
  }
  const marginX = w * 0.09;
  const boxW = w - marginX * 2;
  const boxH = h * 0.42;
  let top;
  if (position === 'top') top = h * 0.12;
  else if (position === 'bottom') top = h * 0.52;
  else top = h * 0.5 - boxH / 2;
  return { x: marginX, y: top, w: boxW, h: boxH };
}

// Type size has to come from the whole frame, not its height. Sizing captions off `h`
// alone means a 16:9 export gets text half the size of the same reel in 9:16 — the number
// is the same fraction of a much shorter dimension. The mean of the two sides keeps text
// the same physical size in every aspect, and is calibrated so 9:16 is unchanged.
function captionBase(w, h) {
  return (w + h) / 2;
}

// Which actor the balloon points at: the marked speaker, else whoever is talking, else
// the first person on stage. A balloon with no owner is just a box.
function balloonSpeaker(scene, localT) {
  const actors = (scene.stage && scene.stage.actors) || [];
  if (!actors.length) return null;
  const marked = actors.find((a) => a.speaker);
  if (marked) return { actor: marked, state: stateAt(marked, localT) };
  const talking = actors.find((a) => stateAt(a, localT).action === 'talk');
  const chosen = talking || actors[0];
  return { actor: chosen, state: stateAt(chosen, localT) };
}

// A comic speech balloon: rounded, inked, with a tail to the speaker's mouth. Drawn above
// the speaker's head where there is room, and flipped to the other side of the frame when
// there is not.
function drawBalloon(ctx, project, scene, localT, w, h) {
  const speaker = balloonSpeaker(scene, localT);
  const font = fontOf(project);
  const base = captionBase(w, h);
  const headTop = speaker ? (speaker.state.y - speaker.state.scale) * h : h * 0.35;
  const anchorX = speaker ? speaker.state.x * w : w / 2;

  // The balloon has to fit in the gap ABOVE the speaker's head. Fit the text to that gap
  // rather than to an arbitrary box, or a long line grows a balloon straight over the
  // face it belongs to — which is the one thing a speech balloon must never do.
  const gapAbove = Math.max(h * 0.12, headTop - h * 0.1);
  const maxWidth = Math.min(w * 0.62, h * 0.66);
  const fit = fitCaption(ctx, scene.text, font, { w: maxWidth - base * 0.06, h: gapAbove }, {
    maxSize: base * 0.046, minSize: base * 0.024, maxLines: 5
  });
  const padding = fit.size * 0.7;
  const lineHeight = fit.size * 1.2;
  const textWidth = Math.max(...fit.lines.map((line) => {
    ctx.font = fit.spec;
    return ctx.measureText(line.join(' ')).width;
  }));
  const boxW = textWidth + padding * 2;
  const boxH = fit.lines.length * lineHeight + padding * 1.6;
  // Sit above the head, never off the top of the frame, never off either side.
  const boxY = Math.max(h * 0.03, headTop - boxH - h * 0.055);
  const boxX = Math.min(Math.max(anchorX - boxW / 2, w * 0.03), Math.max(w * 0.03, w - boxW - w * 0.03));

  const appear = mrClamp01(localT / 0.25) * mrClamp01((scene.duration - localT) / 0.25);
  ctx.save();
  ctx.globalAlpha = appear;
  ctx.fillStyle = '#fdf7ea';
  ctx.strokeStyle = '#2a1c12';
  ctx.lineWidth = Math.max(2, base * 0.005);
  ctx.lineJoin = 'round';
  mrRoundRect(ctx, boxX, boxY, boxW, boxH, fit.size * 0.7);
  ctx.fill();
  ctx.stroke();

  // The tail runs from the balloon's bottom edge DOWN to just above the head — always
  // below the balloon, whatever the layout did.
  const tailX = Math.min(Math.max(anchorX, boxX + boxW * 0.2), boxX + boxW * 0.8);
  const tipY = Math.max(boxY + boxH + h * 0.015, headTop - h * 0.012);
  ctx.beginPath();
  ctx.moveTo(tailX - boxW * 0.09, boxY + boxH - 2);
  ctx.lineTo(tailX + boxW * 0.06, boxY + boxH - 2);
  ctx.lineTo(anchorX + (tailX > anchorX ? boxW * 0.02 : -boxW * 0.02), tipY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Cover the seam the tail's outline leaves across the balloon's edge.
  ctx.beginPath();
  ctx.moveTo(tailX - boxW * 0.085, boxY + boxH - ctx.lineWidth * 0.7);
  ctx.lineTo(tailX + boxW * 0.055, boxY + boxH - ctx.lineWidth * 0.7);
  ctx.strokeStyle = '#fdf7ea';
  ctx.stroke();

  ctx.fillStyle = '#20160f';
  ctx.font = fit.spec;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  fit.lines.forEach((line, i) => {
    ctx.fillText(line.join(' '), boxX + boxW / 2, boxY + padding * 0.9 + fit.size * 0.85 + i * lineHeight);
  });
  ctx.restore();
}

function drawCaption(ctx, project, scene, localT, w, h) {
  if (scene.captionStyle === 'none' || !scene.text.trim()) return;
  if (scene.captionStyle === 'balloon') { drawBalloon(ctx, project, scene, localT, w, h); return; }
  const font = fontOf(project);
  const colors = paletteOf(project);
  const accent = accentOf(project, scene);
  const isSubtitle = scene.captionStyle === 'subtitle';
  const box = captionBox(w, h, scene.captionPosition, scene.captionStyle);
  const isTitle = scene.captionStyle === 'title';
  const base = captionBase(w, h);
  const fit = fitCaption(ctx, scene.text, font, box, {
    maxSize: isTitle ? base * 0.141 : isSubtitle ? base * 0.041 : base * 0.079,
    minSize: isSubtitle ? base * 0.026 : base * 0.036,
    maxLines: isTitle ? 3 : isSubtitle ? 3 : 5
  });
  const lineHeight = fit.size * 1.18;
  const totalHeight = fit.lines.length * lineHeight;
  const startY = box.y + (box.h - totalHeight) / 2 + fit.size * 0.82;
  const light = mrIsLightPalette(colors);
  const ink = mrInkFor(colors);
  const plateInk = light ? '#ffffff' : '#000000';

  ctx.save();
  ctx.font = fit.spec;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // A plate behind the text — the one thing that makes captions readable over any
  // background, which matters because these backgrounds are generated, not curated. One
  // rounded bar per line, hugging the words: a single full-width rectangle reads as a
  // grey box sitting on the picture, which is exactly what a caption should not do.
  if (scene.captionStyle !== 'title' && scene.captionStyle !== 'none' && !isSubtitle) {
    const padX = fit.size * 0.34, padY = fit.size * 0.16;
    const plateAlpha = (light ? 0.55 : 0.34) * mrClamp01((scene.duration - localT) / 0.28);
    ctx.fillStyle = mrRgba(plateInk, plateAlpha);
    for (let li = 0; li < fit.lines.length; li++) {
      const lineWidth = ctx.measureText(fit.lines[li].join(' ')).width;
      const y = startY + li * lineHeight;
      mrRoundRect(ctx, w / 2 - lineWidth / 2 - padX, y - fit.size * 0.86 - padY,
        lineWidth + padX * 2, fit.size * 1.06 + padY * 2, fit.size * 0.22);
      ctx.fill();
    }
  }

  const wordCount = fit.lines.reduce((n, l) => n + l.length, 0);
  // Words land at reading speed and stop early: a caption that is still assembling itself
  // when the cut arrives never gets read. Long beats reveal faster rather than later.
  const revealWindow = Math.max(0.4, scene.duration * 0.55);
  const perWord = wordCount ? Math.min(0.16, revealWindow / wordCount) : 0;
  let wordIndex = 0;

  for (let li = 0; li < fit.lines.length; li++) {
    const words = fit.lines[li];
    const y = startY + li * lineHeight;
    const lineText = words.join(' ');
    const lineWidth = ctx.measureText(lineText).width;
    let x = w / 2 - lineWidth / 2;
    const spaceWidth = ctx.measureText(' ').width;

    for (const word of words) {
      const wordWidth = ctx.measureText(word).width;
      const appear = wordIndex * perWord;
      const age = localT - appear;
      const emphasised = mrIsEmphasised(word, scene.emphasis);
      let alpha = 1, dy = 0, scale = 1;

      if (isSubtitle) {
        alpha = mrClamp01(localT / 0.18);
      } else if (scene.captionStyle === 'kinetic') {
        const p = mrClamp01(age / 0.32);
        alpha = p;
        dy = (1 - mrEaseOut(p)) * fit.size * 0.5;
        scale = 0.86 + mrEaseOut(p) * 0.14;
      } else if (scene.captionStyle === 'karaoke') {
        const spoken = age >= 0;
        alpha = spoken ? 1 : 0.42;
      } else if (scene.captionStyle === 'block' || scene.captionStyle === 'dialogue') {
        const p = mrClamp01(localT / 0.4);
        alpha = p;
        dy = (1 - mrEaseOut(p)) * fit.size * 0.35;
      } else if (isTitle) {
        const p = mrClamp01(localT / 0.55);
        alpha = p;
        scale = 0.92 + mrEaseOut(p) * 0.08;
      }

      // Fade the whole caption out just before the cut, so transitions never chop a word.
      const outro = mrClamp01((scene.duration - localT) / 0.28);
      alpha *= outro;

      const cx = x + wordWidth / 2;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(cx, y + dy);
      ctx.scale(scale, scale);
      const highlight = !isSubtitle &&
        (emphasised || (scene.captionStyle === 'karaoke' && age >= 0 && age < perWord * 1.4));
      ctx.shadowColor = light ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = fit.size * 0.25;
      ctx.shadowOffsetY = fit.size * 0.04;
      ctx.fillStyle = highlight ? accent : ink;
      ctx.fillText(word, 0, 0);
      if (highlight && emphasised) {
        // Underline the emphasis rather than shouting with size — keeps the line rhythm.
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = mrRgba(accent, 0.75);
        ctx.fillRect(-wordWidth / 2, fit.size * 0.16, wordWidth, Math.max(2, fit.size * 0.06));
      }
      ctx.restore();

      x += wordWidth + spaceWidth;
      wordIndex++;
    }
  }

  if (isTitle) {
    // A rule under the title, wiping open with the reveal.
    const p = mrEaseOut(mrClamp01(localT / 0.7));
    const ruleW = box.w * 0.5 * p;
    ctx.globalAlpha = 0.9 * mrClamp01((scene.duration - localT) / 0.28);
    ctx.fillStyle = accent;
    ctx.fillRect(w / 2 - ruleW / 2, startY + totalHeight + fit.size * 0.3, ruleW, Math.max(3, h * 0.004));
  }
  if (scene.captionStyle === 'dialogue') {
    const p = mrClamp01(localT / 0.4);
    ctx.globalAlpha = p * mrClamp01((scene.duration - localT) / 0.28);
    ctx.fillStyle = accent;
    ctx.fillRect(box.x - fit.size * 0.6, startY - fit.size, Math.max(4, w * 0.006), totalHeight);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- one scene

// Draw a scene's picture, cover-fitted around its focal point. Returns false when the
// image has not been loaded yet, so the caller can fall back to the procedural
// background — a slow network degrades the look instead of breaking the frame.
function drawScenePicture(ctx, project, scene, w, h) {
  const picture = scene.picture;
  const img = picture && pictureImage(picture.src);
  if (!img || !img.width || !img.height) return false;

  const focus = scene.pictureFocus || { x: 0.5, y: 0.42 };
  const contain = scene.pictureFit === 'contain';
  const scale = contain
    ? Math.min(w / img.width, h / img.height)
    : Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  // With cover the overflow is cropped around the focal point; with contain the picture
  // is centred and the palette fills the gaps behind it.
  const dx = contain ? (w - dw) / 2 : (w - dw) * mrClamp01(focus.x);
  const dy = contain ? (h - dh) / 2 : (h - dh) * mrClamp01(focus.y);

  if (contain) {
    const colors = paletteOf(project);
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, dx, dy, dw, dh);

  // Grade: pull every picture toward the reel's palette so a Ravi Varma oleograph and a
  // British Museum scan sitting in the same reel read as one film rather than a slideshow.
  const grade = scene.pictureGrade != null ? scene.pictureGrade : 0.28;
  if (grade > 0) {
    const colors = paletteOf(project);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = grade * 0.75;
    ctx.fillStyle = colors[1];
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = grade * 0.4;
    ctx.fillStyle = colors[3];
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  return true;
}

// Background + camera, without the caption. Split out because transitions cross-fade
// backgrounds while captions stay crisp on top. A scene with a picture gets the same
// camera move applied to the artwork — that is the whole Ken Burns effect, for free.
function drawSceneBackground(ctx, project, scene, localT, w, h) {
  const colors = scene.accent
    ? paletteOf(project).slice(0, 3).concat([scene.accent, paletteOf(project)[4]])
    : paletteOf(project);
  const progress = scene.duration ? mrClamp01(localT / scene.duration) : 0;
  const cam = cameraFor(scene, progress, project.style.motionScale);
  ctx.save();
  ctx.translate(w / 2 + cam.x * w, h / 2 + cam.y * h);
  ctx.rotate(cam.rotate);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-w / 2, -h / 2);
  if (!drawScenePicture(ctx, project, scene, w, h)) {
    const fn = MR_BG_FUNCTIONS[scene.background] || bgGradient;
    fn(ctx, w, h, colors, scene, localT + scene.seed * 0.01);
  }
  // The cast stands on the background and moves with the camera.
  if (typeof drawStage === 'function') drawStage(ctx, scene, localT, w, h, project.style.look);
  ctx.restore();
}

function drawVignette(ctx, w, h, strength) {
  if (!strength) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawGrain(ctx, w, h, strength, t) {
  if (!strength) return;
  const pattern = mrGrain(ctx);
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = strength * 0.09;
  ctx.globalCompositeOperation = 'overlay';
  // Jitter the tile every frame so the grain shimmers instead of sitting still.
  ctx.translate(Math.floor((t * 977) % 128) - 128, Math.floor((t * 1361) % 128) - 128);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w + 256, h + 256);
  ctx.restore();
}

// A comic-page border: paper margin, then an inked panel edge. Costs a little of the
// picture and buys a lot of "this is a comic".
function drawPanelFrame(ctx, w, h) {
  const margin = Math.min(w, h) * 0.035;
  const ink = Math.max(3, Math.min(w, h) * 0.008);
  ctx.save();
  ctx.fillStyle = '#f3e9d6';
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  // The hole. Same path, so evenodd leaves only the margin painted.
  mrRoundRectPath(ctx, margin, margin, w - margin * 2, h - margin * 2, margin * 0.5);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#2a1c12';
  ctx.lineWidth = ink;
  mrRoundRect(ctx, margin + ink / 2, margin + ink / 2, w - (margin + ink / 2) * 2, h - (margin + ink / 2) * 2, margin * 0.45);
  ctx.stroke();
  ctx.restore();
}

// Progress bar, scene counter, watermark — the furniture that sits above every scene.
function drawOverlays(ctx, project, t, total, w, h, sceneIndex) {
  const colors = paletteOf(project);
  if (project.style.progressBar && total > 0) {
    const barH = Math.max(4, h * 0.005);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = colors[3];
    ctx.fillRect(0, h - barH, w * mrClamp01(t / total), barH);
  }
  const base = captionBase(w, h);
  if (project.style.sceneNumbers) {
    ctx.save();
    ctx.font = `600 ${Math.round(base * 0.023)}px ${MR_FONTS.mono.stack}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'right';
    ctx.fillText(`${sceneIndex + 1}/${project.scenes.length}`, w - w * 0.05, h * 0.06);
    ctx.restore();
  }
  if (project.style.watermark) {
    ctx.save();
    ctx.font = `700 ${Math.round(base * 0.026)}px ${fontOf(project).stack}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = h * 0.01;
    ctx.fillText(project.style.watermark, w * 0.05, h * 0.06);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- the frame

// Draw the whole composition at time t. `opts.width/height` default to the project's
// aspect; pass a scaled context (or set opts.stillOnly) for thumbnails.
function renderFrame(ctx, project, t, opts) {
  const o = opts || {};
  const dim = dimensionsOf(project);
  const w = o.width || dim.w;
  const h = o.height || dim.h;
  const total = totalDuration(project);
  const at = sceneAt(project, Math.max(0, Math.min(total, t)));
  if (!at) return;
  const { scene, index, local } = at;

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const transition = scene.transition || 'cut';
  const inTransition = index > 0 && local < MR_TRANSITION_SECONDS && transition !== 'cut';
  const tp = inTransition ? mrClamp01(local / MR_TRANSITION_SECONDS) : 1;

  if (inTransition && (transition === 'dissolve' || transition === 'slide' || transition === 'wipe')) {
    // These three need the outgoing scene's last frame, so render it to scratch first.
    const previous = project.scenes[index - 1];
    const prevSurface = mrSurface('prev', w, h);
    prevSurface.ctx.save();
    prevSurface.ctx.clearRect(0, 0, w, h);
    drawSceneBackground(prevSurface.ctx, project, previous, previous.duration, w, h);
    drawVignette(prevSurface.ctx, w, h, project.style.vignette);
    prevSurface.ctx.restore();

    const curSurface = mrSurface('cur', w, h);
    curSurface.ctx.save();
    curSurface.ctx.clearRect(0, 0, w, h);
    drawSceneBackground(curSurface.ctx, project, scene, local, w, h);
    drawVignette(curSurface.ctx, w, h, project.style.vignette);
    curSurface.ctx.restore();

    ctx.drawImage(prevSurface.canvas, 0, 0);
    const e = mrEaseInOut(tp);
    if (transition === 'dissolve') {
      ctx.globalAlpha = e;
      ctx.drawImage(curSurface.canvas, 0, 0);
      ctx.globalAlpha = 1;
    } else if (transition === 'slide') {
      ctx.drawImage(curSurface.canvas, 0, h * (1 - e));
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w * e, h);
      ctx.clip();
      ctx.drawImage(curSurface.canvas, 0, 0);
      ctx.restore();
    }
  } else {
    drawSceneBackground(ctx, project, scene, local, w, h);
    drawVignette(ctx, w, h, project.style.vignette);
  }

  drawCaption(ctx, project, scene, local, w, h);
  drawGrain(ctx, w, h, project.style.grain, t);

  // Fade and flash sit on top of everything, including the caption.
  if (inTransition && transition === 'fade') {
    ctx.fillStyle = `rgba(0,0,0,${1 - mrEaseOut(tp)})`;
    ctx.fillRect(0, 0, w, h);
  } else if (inTransition && transition === 'flash') {
    ctx.fillStyle = `rgba(255,255,255,${(1 - tp) * 0.75})`;
    ctx.fillRect(0, 0, w, h);
  }
  // Open on black and close on black — a reel that starts mid-image looks like a glitch.
  if (t < 0.35) { ctx.fillStyle = `rgba(0,0,0,${1 - mrEaseOut(t / 0.35)})`; ctx.fillRect(0, 0, w, h); }
  const tail = total - t;
  if (tail < 0.35) { ctx.fillStyle = `rgba(0,0,0,${1 - mrEaseOut(Math.max(0, tail) / 0.35)})`; ctx.fillRect(0, 0, w, h); }

  if (project.style.panel) drawPanelFrame(ctx, w, h);
  drawOverlays(ctx, project, t, total, w, h, index);
  ctx.restore();
}

// Draw a scene into a small canvas for the timeline strip: mid-scene, no camera move,
// no grain — a thumbnail should read as the scene, not as one arbitrary frame of it.
function renderThumbnail(canvas, project, scene) {
  const dim = dimensionsOf(project);
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / dim.w;
  ctx.save();
  ctx.scale(scale, scale);
  const still = Object.assign({}, scene, { motion: 'none' });
  drawSceneBackground(ctx, project, still, scene.duration * 0.5, dim.w, dim.h);
  drawVignette(ctx, dim.w, dim.h, project.style.vignette);
  ctx.restore();
}
