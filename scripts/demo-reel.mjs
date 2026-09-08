// scripts/demo-reel.mjs — build and record the demonstration reel.
//
//   npm run demo                 → 16:9, into ./
//   node scripts/demo-reel.mjs . 9:16
//
// Every frame is produced by MyRecital itself, through the same functions the editor
// calls; this file just does the clicking. It doubles as the most complete worked example
// of the animation API — cast, keyframed actions and expressions, an implied walk, props
// at three depths, a keyframed cart, and lip-sync from a measured envelope.
import { chromium } from 'playwright';
import { startServer } from '../tests/helpers.mjs';
import fs from 'node:fs';

const out = process.argv[2] || '.';
const aspect = process.argv[3] || '16:9';
const srv = await startServer();
// Same escape hatch the tests use, for sandboxes where Playwright's own browser is not
// the one installed.
const launchOptions = {};
if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(srv.url + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof ed !== 'undefined' && ed.project);

const report = await page.evaluate((aspect) => {
  // Actor scale is a fraction of frame height, so a short, wide frame needs larger
  // numbers for the cast to hold the picture.
  const S = aspect === '16:9' ? 1.5 : 1;
  const sz = (v) => Math.round(v * S * 100) / 100;
  const scenes = [];
  const beat = (text, opts) => {
    const scene = makeScene(text, Object.assign({ captionStyle: 'subtitle', background: 'gradient', motion: 'none' }, opts));
    scenes.push(scene);
    return scene;
  };
  const look = {
    a: { body: 'average', skin: MR_SKINS[1], hair: MR_HAIRS[1], hairStyle: 'short', top: '#c2452d', bottom: '#3d4657' },
    b: { body: 'tall', skin: MR_SKINS[3], hair: MR_HAIRS[0], hairStyle: 'bun', top: '#1f7a53', bottom: '#8a6a3f' },
    c: { body: 'sturdy', skin: MR_SKINS[0], hair: MR_HAIRS[5], hairStyle: 'long', top: '#3a5cc8', bottom: '#2b2f45' },
    d: { body: 'slight', skin: MR_SKINS[4], hair: MR_HAIRS[2], hairStyle: 'braid', top: '#7a4bff', bottom: '#e0a33f' },
    e: { body: 'child', skin: MR_SKINS[2], hair: MR_HAIRS[3], hairStyle: 'short', top: '#e0a33f', bottom: '#4a5568' }
  };

  // 1 — title
  const title = makeScene('MyRecital', { kind: 'title', captionStyle: 'title', duration: 3.2, background: 'starfield', motion: 'drift' });
  scenes.push(title);

  // 2 — what it is
  const intro = beat('An animation tool that runs in a browser tab.', { duration: 3.4, background: 'starfield', motion: 'drift' });
  intro.stage = makeStage({ actors: [
    makeActor('A', Object.assign({}, look.a, { start: { x: 0.5, y: 0.86, scale: sz(0.5), action: 'wave', facing: 'right' } }))
  ] });

  // 3 — the cast
  const cast = beat('Characters are drawn from code. Five body types, any colours — no image files anywhere.', { duration: 5.5 });
  cast.stage = makeStage({ actors: ['a', 'b', 'c', 'd', 'e'].map((k, i) =>
    makeActor('C' + i, Object.assign({}, look[k], {
      start: { x: 0.14 + i * 0.18, y: 0.87, scale: sz(k === 'e' ? 0.34 : 0.44), action: 'idle', facing: 'right' } }))) });

  // 4 — actions, cycled by keyframes on one character
  const actions = beat('Eight actions, switched on keyframes.', { duration: 8.4, background: 'grid' });
  const performer = makeActor('P', Object.assign({}, look.b, {
    start: { x: 0.5, y: 0.87, scale: sz(0.56), action: 'idle', facing: 'right' } }));
  ['talk', 'point', 'wave', 'think', 'kneel', 'fall'].forEach((action, i) => {
    setKey(performer, 1.2 + i * 1.2, { action, x: 0.5 });
  });
  actions.stage = makeStage({ actors: [performer] });

  // 5 — expressions
  const feelings = beat('Six expressions, on the same rig.', { duration: 6, background: 'aurora' });
  const face = makeActor('F', Object.assign({}, look.d, {
    start: { x: 0.5, y: 0.87, scale: sz(0.62), action: 'idle', expression: 'calm' } }));
  ['glad', 'worried', 'sad', 'angry', 'shocked'].forEach((expression, i) => {
    setKey(face, 0.9 + i * 0.95, { expression, x: 0.5 });
  });
  feelings.stage = makeStage({ actors: [face] });

  // 6 — the implied walk
  const walk = beat('Set where someone starts and where they end. The walk fills itself in.', { duration: 6, background: 'forest' });
  const walker = makeActor('W', Object.assign({}, look.a, {
    start: { x: 0.1, y: 0.88, scale: sz(0.4), facing: 'right' } }));
  setKey(walker, 5.6, { x: 0.9, scale: sz(0.52) });
  walk.stage = makeStage({ actors: [walker] });

  // 7 — props and depth
  const props = beat('Fourteen props at three depths. A cart is keyframed exactly like a person.', { duration: 7.5, background: 'gradient' });
  const cart = makeProp('cart', { tint: '#b4542f', layer: 'front', start: { x: -0.12, y: 0.93, scale: sz(0.2) } });
  setKey(cart, 7.4, { x: 1.1 });
  props.stage = makeStage({
    actors: [makeActor('S', Object.assign({}, look.c, { start: { x: 0.62, y: 0.88, scale: sz(0.42), action: 'idle', facing: 'left' } }))],
    props: [
      makeProp('mountain', { tint: '#5c6f82', layer: 'back', start: { x: 0.22, y: 0.68, scale: sz(0.3) } }),
      makeProp('cloud', { tint: '#cfd8e3', layer: 'back', start: { x: 0.75, y: 0.26, scale: sz(0.14) } }),
      makeProp('house', { tint: '#a08765', layer: 'back', start: { x: 0.85, y: 0.86, scale: sz(0.3) } }),
      makeProp('tree', { tint: '#1f7a53', layer: 'back', start: { x: 0.36, y: 0.88, scale: sz(0.4) } }),
      makeProp('well', { tint: '#8a7a63', layer: 'stage', start: { x: 0.16, y: 0.9, scale: sz(0.2) } }),
      cart,
      makeProp('bush', { tint: '#2f6b45', layer: 'front', start: { x: 0.95, y: 1.0, scale: sz(0.18) } })
    ] });

  // 8 — lip-sync, driven by a measured envelope
  const talk = beat('When a line is narrated, the speaker’s mouth follows the actual audio.', { duration: 6.5, background: 'mist' });
  const ctx = mrAudioEnsure();
  const rate = 8000, seconds = 5.2;
  const speech = ctx.createBuffer(1, Math.round(rate * seconds), rate);
  const data = speech.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    const phrase = (t % 1.7) < 1.15 ? 1 : 0.02;          // words, then a breath
    const syllable = Math.max(0, Math.sin(t * 8.5));
    data[i] = Math.sin(i * 0.07) * syllable * phrase * 0.9;
  }
  talk.narration = { id: 'demo', seconds, text: talk.text, envelope: envelopeFrom(speech) };
  talk.stage = makeStage({ actors: [
    makeActor('Speaker', Object.assign({}, look.b, { speaker: true, start: { x: 0.38, y: 0.88, scale: sz(0.55), action: 'talk', facing: 'right', expression: 'glad' } })),
    makeActor('Listener', Object.assign({}, look.c, { start: { x: 0.64, y: 0.88, scale: sz(0.55), action: 'idle', facing: 'left', expression: 'worried' } }))
  ] });

  // 9 — a finished scene
  const scene = beat('Put them together and you have a scene.', { duration: 7, background: 'gradient', motion: 'push', intensity: 0.5 });
  const potter = makeActor('Potter', Object.assign({}, look.d, {
    start: { x: 0.34, y: 0.9, scale: sz(0.46), action: 'talk', facing: 'right', expression: 'glad' } }));
  const guest = makeActor('Traveller', Object.assign({}, look.a, {
    start: { x: 0.78, y: 0.9, scale: sz(0.3), action: 'walk', facing: 'left' } }));
  setKey(guest, 3.2, { x: 0.6, scale: sz(0.46), action: 'idle', expression: 'calm' });
  setKey(guest, 5.2, { action: 'kneel' });
  scene.stage = makeStage({
    actors: [potter, guest],
    props: [
      makeProp('house', { tint: '#a08765', layer: 'back', start: { x: 0.14, y: 0.87, scale: sz(0.34) } }),
      makeProp('tree', { tint: '#1f7a53', layer: 'back', start: { x: 0.9, y: 0.89, scale: sz(0.38) } }),
      makeProp('fire', { tint: '#e2622a', layer: 'stage', start: { x: 0.48, y: 0.93, scale: sz(0.13) } }),
      makeProp('pot', { tint: '#b4542f', layer: 'stage', start: { x: 0.24, y: 0.93, scale: sz(0.1) } })
    ] });

  // 10 — outro
  const outro = makeScene('No assets. No API keys. No AI. Just code, in your browser.',
    { captionStyle: 'title', duration: 4.6, background: 'starfield', motion: 'drift', emphasis: [] });
  scenes.push(outro);

  ed.project = {
    version: 1,
    title: 'MyRecital — animation in the browser',
    source: '',
    style: Object.assign({}, MR_DEFAULT_STYLE, {
      palette: 'midnight', font: 'grotesk', aspect, fps: 30,
      grain: 0.2, vignette: 0.45, progressBar: true, watermark: 'github.com/oopra/MyRecital'
    }),
    audio: Object.assign({}, MR_DEFAULT_AUDIO, { enabled: true, mood: 'wonder', volume: 0.4 }),
    generation: Object.assign({}, MR_DEFAULT_GENERATION),
    narration: Object.assign({}, MR_DEFAULT_NARRATION),
    cast: [],
    scenes
  };
  ed.selectedId = scenes[0].id;
  ed.time = 0;
  afterChange();
  return { scenes: scenes.length, total: totalDuration(ed.project), aspect: ed.project.style.aspect };
}, aspect);
console.log(JSON.stringify(report));

// A contact sheet first, so the composition can be checked before spending the real-time record.
const sheet = await page.evaluate(() => {
  const dim = dimensionsOf(ed.project);
  const cw = 320, ch = Math.round(320 * dim.h / dim.w), cols = 5;
  const times = sceneTimeline(ed.project);
  const shots = ed.project.scenes.map((s, i) => times[i].start + s.duration * 0.55);
  const c = document.createElement('canvas');
  c.width = cw * cols; c.height = ch * Math.ceil(shots.length / cols);
  const x = c.getContext('2d');
  shots.forEach((t, n) => {
    const cell = document.createElement('canvas');
    cell.width = cw; cell.height = ch;
    const cx = cell.getContext('2d');
    cx.scale(cw / dim.w, ch / dim.h);
    renderFrame(cx, ed.project, t, { width: dim.w, height: dim.h });
    x.drawImage(cell, (n % cols) * cw, Math.floor(n / cols) * ch);
  });
  return c.toDataURL('image/png');
});
fs.writeFileSync(`${out}/demo-sheet-${aspect.replace(':', 'x')}.png`, Buffer.from(sheet.split(',')[1], 'base64'));

const rec = await page.evaluate(async () => {
  const r = await exportVideo(ed.project, { scale: 1 });
  const buf = new Uint8Array(await r.blob.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return { ext: r.ext, size: r.blob.size, b64: btoa(s) };
});
fs.writeFileSync(`${out}/myrecital-demo-${aspect.replace(':', 'x')}.${rec.ext}`, Buffer.from(rec.b64, 'base64'));
console.log(`Wrote ${out}/myrecital-demo-${aspect.replace(':', 'x')}.${rec.ext} — ${(rec.size / 1048576).toFixed(2)} MB`);
await browser.close(); await srv.close();
