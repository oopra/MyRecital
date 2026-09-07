// editor.js — the tools for changing what got rendered.
//
// The build is one-way (words in, storyboard out) and everything after that is editing:
// every control here mutates the project, pushes an undo entry, and repaints. The
// renderer is pure, so a repaint is always just "draw the project at time t" — there is
// no separate "rendered video" to keep in sync, and no re-build needed to see a change.

const ed = {
  project: null,
  selectedId: null,
  time: 0,
  playing: false,
  raf: 0,
  clockOrigin: 0,
  history: [],
  future: [],
  exporting: null,      // AbortController while recording
  suppress: false       // set while writing values into inputs, so change events don't loop
};

const MR_STORAGE_KEY = 'myrecital.project.v1';
const MR_HISTORY_LIMIT = 60;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- state plumbing

function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

// Every mutation goes through here. The label is what an undo tooltip would say; keeping
// it on the entry makes the history readable when debugging a stuck state.
function commit(label, mutate) {
  ed.history.push({ label, project: cloneProject(ed.project) });
  if (ed.history.length > MR_HISTORY_LIMIT) ed.history.shift();
  ed.future.length = 0;
  mutate(ed.project);
  afterChange();
}

function undo() {
  if (!ed.history.length) return;
  ed.future.push({ label: 'redo', project: cloneProject(ed.project) });
  ed.project = ed.history.pop().project;
  afterChange();
}

function redo() {
  if (!ed.future.length) return;
  ed.history.push({ label: 'undo', project: cloneProject(ed.project) });
  ed.project = ed.future.pop().project;
  afterChange();
}

// One repaint path for every change: clamp the playhead, redraw the canvas, rebuild the
// timeline, refresh the inspector, save.
function afterChange() {
  const total = totalDuration(ed.project);
  if (ed.time > total) ed.time = total;
  if (!ed.project.scenes.some((s) => s.id === ed.selectedId)) {
    ed.selectedId = ed.project.scenes.length ? ed.project.scenes[0].id : null;
  }
  renderTimeline();
  syncInspector();
  syncStyleControls();
  syncPicturePanel();
  syncPublishKit();
  drawPreview();
  updateTransport();
  saveLocal();
  $('undoBtn').disabled = !ed.history.length;
  $('redoBtn').disabled = !ed.future.length;
}

function selectedScene() {
  return ed.project.scenes.find((s) => s.id === ed.selectedId) || null;
}

function selectedIndex() {
  return ed.project.scenes.findIndex((s) => s.id === ed.selectedId);
}

function saveLocal() {
  try {
    localStorage.setItem(MR_STORAGE_KEY, JSON.stringify(ed.project));
    flashSaved('Saved');
  } catch { flashSaved('Not saved (storage full)'); }
}

let mrSaveTimer = 0;
function flashSaved(text) {
  const el = $('saveState');
  el.textContent = text;
  clearTimeout(mrSaveTimer);
  mrSaveTimer = setTimeout(() => { el.textContent = ''; }, 1600);
}

// ---------------------------------------------------------------- preview

// Size the preview canvas to the project aspect, capped to what fits on screen. The
// backing store is the CSS size times DPR so text stays sharp on a retina display.
function sizePreview() {
  const canvas = $('preview');
  const dim = dimensionsOf(ed.project);
  const stage = canvas.parentElement;
  const maxH = Math.max(320, Math.min(720, stage.clientHeight || 720));
  const maxW = Math.max(220, stage.clientWidth || 405);
  const scale = Math.min(maxW / dim.w, maxH / dim.h);
  const cssW = Math.round(dim.w * scale);
  const cssH = Math.round(dim.h * scale);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

function drawPreview() {
  const canvas = $('preview');
  const dim = dimensionsOf(ed.project);
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / dim.w;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderFrame(ctx, ed.project, ed.time, { width: dim.w, height: dim.h });
  ctx.restore();
  const at = sceneAt(ed.project, ed.time);
  $('stageBadge').textContent = at ? `Scene ${at.index + 1} · ${at.scene.background} · ${at.scene.motion}` : '';
}

function updateTransport() {
  const total = totalDuration(ed.project);
  $('scrub').value = String(total ? Math.round((ed.time / total) * 1000) : 0);
  $('timeLabel').textContent = `${ed.time.toFixed(1)} / ${total.toFixed(1)}s`;
  $('playBtn').textContent = ed.playing ? '❚❚' : '▶';
  const badge = total > MR_SHORTS_LIMIT ? ' · over 60s' : '';
  $('storyStats').textContent = `${ed.project.scenes.length} scenes · ${total.toFixed(1)}s${badge}`;
}

function play() {
  if (ed.playing) return;
  const total = totalDuration(ed.project);
  if (ed.time >= total - 0.02) ed.time = 0;
  ed.playing = true;
  ed.clockOrigin = performance.now() - ed.time * 1000;
  if (!$('muteCheck').checked) mrAudioPlay(ed.project, ed.time);
  const step = () => {
    if (!ed.playing) return;
    ed.time = (performance.now() - ed.clockOrigin) / 1000;
    const end = totalDuration(ed.project);
    if (ed.time >= end) {
      if ($('loopCheck').checked) {
        ed.time = 0;
        ed.clockOrigin = performance.now();
        if (!$('muteCheck').checked) mrAudioPlay(ed.project, 0);
      } else { ed.time = end; pause(); return; }
    }
    drawPreview();
    updateTransport();
    highlightPlayhead();
    ed.raf = requestAnimationFrame(step);
  };
  ed.raf = requestAnimationFrame(step);
  updateTransport();
}

function pause() {
  ed.playing = false;
  cancelAnimationFrame(ed.raf);
  mrAudioStop();
  updateTransport();
}

function seek(seconds) {
  const total = totalDuration(ed.project);
  ed.time = Math.max(0, Math.min(total, seconds));
  if (ed.playing) {
    ed.clockOrigin = performance.now() - ed.time * 1000;
    if (!$('muteCheck').checked) mrAudioPlay(ed.project, ed.time);
  }
  drawPreview();
  updateTransport();
  highlightPlayhead();
}

// ---------------------------------------------------------------- timeline

function renderTimeline() {
  const strip = $('timeline');
  strip.innerHTML = '';
  ed.project.scenes.forEach((scene, i) => {
    const card = document.createElement('div');
    card.className = 'clip' + (scene.id === ed.selectedId ? ' is-selected' : '');
    card.draggable = true;
    card.dataset.id = scene.id;
    card.dataset.index = String(i);
    // Thumbnail width follows the scene's share of the reel, so the strip reads as time.
    const thumb = document.createElement('canvas');
    const dim = dimensionsOf(ed.project);
    thumb.width = 78;
    thumb.height = Math.round(78 * dim.h / dim.w);
    thumb.className = 'clip-thumb';
    card.appendChild(thumb);
    const meta = document.createElement('div');
    meta.className = 'clip-meta';
    meta.innerHTML = `<b>${i + 1}</b><span>${scene.duration.toFixed(1)}s</span>`;
    card.appendChild(meta);
    if (scene.picture) {
      const mark = document.createElement('span');
      mark.className = 'clip-picture';
      mark.textContent = '▣';
      mark.title = creditLine(scene.picture);
      card.appendChild(mark);
    }
    const caption = document.createElement('div');
    caption.className = 'clip-text';
    caption.textContent = scene.text.slice(0, 44) + (scene.text.length > 44 ? '…' : '');
    card.appendChild(caption);
    card.title = scene.text;
    card.addEventListener('click', () => selectScene(scene.id, true));
    strip.appendChild(card);
    renderThumbnail(thumb, ed.project, scene);
  });
  wireDragAndDrop(strip);
  highlightPlayhead();
}

// Drag to reorder. Plain HTML5 DnD: no library, and it degrades to the ↑/↓ buttons on
// touch devices where dragging a small card is fiddly anyway.
function wireDragAndDrop(strip) {
  let dragId = null;
  strip.querySelectorAll('.clip').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch { /* Safari */ }
    });
    card.addEventListener('dragend', () => { card.classList.remove('is-dragging'); dragId = null; });
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('is-drop'); });
    card.addEventListener('dragleave', () => card.classList.remove('is-drop'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('is-drop');
      const from = ed.project.scenes.findIndex((s) => s.id === dragId);
      const to = Number(card.dataset.index);
      if (from < 0 || from === to) return;
      commit('reorder scenes', (p) => {
        const [moved] = p.scenes.splice(from, 1);
        p.scenes.splice(to, 0, moved);
      });
    });
  });
}

function highlightPlayhead() {
  const at = sceneAt(ed.project, ed.time);
  const cards = $('timeline').querySelectorAll('.clip');
  cards.forEach((card, i) => card.classList.toggle('is-live', !!at && i === at.index));
}

function selectScene(id, seekToIt) {
  ed.selectedId = id;
  if (seekToIt) {
    const times = sceneTimeline(ed.project);
    const i = ed.project.scenes.findIndex((s) => s.id === id);
    if (i >= 0) seek(times[i].start + 0.05);
  }
  renderTimeline();
  syncInspector();
  syncPicturePanel();
  drawPreview();
}

// ---------------------------------------------------------------- inspector

function fillSelect(select, values, labels) {
  select.innerHTML = '';
  values.forEach((value, i) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = labels ? labels[i] : value;
    select.appendChild(opt);
  });
}

function buildSelects() {
  fillSelect($('sceneBackground'), MR_BACKGROUNDS);
  fillSelect($('sceneMotion'), MR_MOTIONS);
  fillSelect($('sceneTransition'), MR_TRANSITIONS);
  fillSelect($('sceneCaption'), MR_CAPTION_STYLES);
  fillSelect($('scenePosition'), ['top', 'center', 'bottom']);
  fillSelect($('sceneMood'), MR_MOOD_ORDER.concat(['neutral']));
  const paletteKeys = Object.keys(MR_PALETTES);
  fillSelect($('stylePalette'), paletteKeys, paletteKeys.map((k) => MR_PALETTES[k].name));
  const fontKeys = Object.keys(MR_FONTS);
  fillSelect($('styleFont'), fontKeys, fontKeys.map((k) => MR_FONTS[k].name));
  const aspectKeys = Object.keys(MR_ASPECTS);
  fillSelect($('styleAspect'), aspectKeys, aspectKeys.map((k) => `${k} · ${MR_ASPECTS[k].label}`));
  const moodSelect = $('audioMood');
  moodSelect.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = 'auto'; auto.textContent = 'Follow each scene';
  moodSelect.appendChild(auto);
  for (const mood of Object.keys(MR_SCORES)) {
    const opt = document.createElement('option');
    opt.value = mood; opt.textContent = mood[0].toUpperCase() + mood.slice(1);
    moodSelect.appendChild(opt);
  }
}

function syncInspector() {
  const scene = selectedScene();
  $('sceneEditor').hidden = !scene;
  $('noScene').hidden = !!scene;
  if (!scene) return;
  ed.suppress = true;
  $('sceneText').value = scene.text;
  $('sceneDuration').value = String(scene.duration);
  $('durationValue').textContent = scene.duration.toFixed(1) + 's';
  $('sceneBackground').value = scene.background;
  $('sceneMotion').value = scene.motion;
  $('sceneTransition').value = scene.transition;
  $('sceneCaption').value = scene.captionStyle;
  $('scenePosition').value = scene.captionPosition;
  $('sceneMood').value = scene.mood;
  $('sceneEmphasis').value = (scene.emphasis || []).join(', ');
  $('sceneIntensity').value = String(scene.intensity);
  $('intensityValue').textContent = Number(scene.intensity).toFixed(2);
  $('sceneAccent').value = scene.accent || accentOf(ed.project, null);
  ed.suppress = false;
}

function syncStyleControls() {
  const style = ed.project.style;
  const audio = ed.project.audio;
  ed.suppress = true;
  $('projectTitle').value = ed.project.title;
  $('stylePalette').value = style.palette;
  $('styleFont').value = style.font;
  $('styleAspect').value = style.aspect;
  $('styleFps').value = String(style.fps);
  $('styleGrain').value = String(style.grain);
  $('grainValue').textContent = Number(style.grain).toFixed(2);
  $('styleVignette').value = String(style.vignette);
  $('vignetteValue').textContent = Number(style.vignette).toFixed(2);
  $('styleMotionScale').value = String(style.motionScale);
  $('motionScaleValue').textContent = Number(style.motionScale).toFixed(2);
  $('styleWatermark').value = style.watermark || '';
  $('styleProgress').checked = !!style.progressBar;
  $('styleNumbers').checked = !!style.sceneNumbers;
  $('audioEnabled').checked = !!audio.enabled;
  $('audioMood').value = audio.mood;
  $('audioVolume').value = String(audio.volume);
  $('audioVolumeValue').textContent = Math.round(audio.volume * 100) + '%';
  $('audioAccents').checked = !!audio.accents;
  ed.suppress = false;

  const swatches = $('paletteSwatches');
  swatches.innerHTML = '';
  for (const colour of paletteOf(ed.project)) {
    const chip = document.createElement('span');
    chip.className = 'swatch';
    chip.style.background = colour;
    chip.title = colour;
    swatches.appendChild(chip);
  }
}

function syncPublishKit() {
  const kit = publishKit(ed.project);
  const box = $('publishKit');
  box.innerHTML = '';
  const rows = [
    ['Title', kit.title],
    ['Description', kit.description],
    ['Tags', kit.tags.join(', ')]
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'kit-row';
    const head = document.createElement('div');
    head.className = 'kit-head';
    head.innerHTML = `<span>${label}</span>`;
    const copy = document.createElement('button');
    copy.className = 'btn tiny ghost';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => copyToClipboard(value, copy));
    head.appendChild(copy);
    const body = document.createElement('pre');
    body.className = 'kit-body';
    body.textContent = value;
    row.appendChild(head);
    row.appendChild(body);
    box.appendChild(row);
  }
  const status = document.createElement('p');
  status.className = kit.shortsReady ? 'kit-ok' : 'kit-warn';
  status.textContent = kit.shortsReady
    ? `Shorts-ready: ${kit.duration.toFixed(1)}s, vertical.`
    : `Not Shorts-shaped yet: ${kit.duration.toFixed(1)}s, ${ed.project.style.aspect}. Shorts want 9:16 and under 60s.`;
  box.appendChild(status);
}

function copyToClipboard(text, button) {
  const done = () => {
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); done(); } catch { /* clipboard blocked */ }
  area.remove();
}

// ---------------------------------------------------------------- scene edits

function editScene(label, mutate) {
  const id = ed.selectedId;
  if (!id) return;
  commit(label, (p) => {
    const scene = p.scenes.find((s) => s.id === id);
    if (scene) mutate(scene, p);
  });
}

// Split the selected scene at the playhead: the words are divided in proportion to where
// you cut, which is the split a human would make when a beat runs long.
function splitAtPlayhead() {
  const at = sceneAt(ed.project, ed.time);
  if (!at) return;
  const scene = at.scene;
  const words = scene.text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || at.local < 0.3 || scene.duration - at.local < 0.3) return;
  const share = at.local / scene.duration;
  const cut = Math.max(1, Math.min(words.length - 1, Math.round(words.length * share)));
  const firstText = words.slice(0, cut).join(' ');
  const secondText = words.slice(cut).join(' ');
  commit('split scene', (p) => {
    const i = p.scenes.findIndex((s) => s.id === scene.id);
    const original = p.scenes[i];
    const second = makeScene(secondText, {
      mood: original.mood, background: original.background, motion: original.motion,
      transition: 'cut', captionStyle: original.captionStyle, captionPosition: original.captionPosition,
      accent: original.accent, intensity: original.intensity,
      duration: Math.round((original.duration - at.local) * 10) / 10,
      seed: (original.seed + 7919) % 100000
    });
    original.text = firstText;
    original.duration = Math.round(at.local * 10) / 10;
    original.emphasis = pickEmphasis(firstText, 2);
    p.scenes.splice(i + 1, 0, second);
    ed.selectedId = second.id;
  });
}

function mergeWithNext() {
  const i = selectedIndex();
  if (i < 0 || i >= ed.project.scenes.length - 1) return;
  commit('merge scenes', (p) => {
    const a = p.scenes[i], b = p.scenes[i + 1];
    a.text = (a.text + ' ' + b.text).trim();
    a.duration = Math.round((a.duration + b.duration) * 10) / 10;
    a.emphasis = pickEmphasis(a.text, 2);
    p.scenes.splice(i + 1, 1);
  });
}

// Re-distribute time by word count: long captions get more, short ones less, and the
// total stays where it is. The single most useful button after a first build.
function evenOutPacing() {
  commit('even out pacing', (p) => {
    distributeDurations(p.scenes, totalDuration(p));
  });
}

// Re-roll the generated look of every scene while respecting each scene's mood, so a
// story that came out too samey gets a different cut without touching the words.
function shuffleLooks() {
  commit('shuffle looks', (p) => {
    const rand = mrRandom(Date.now() % 100000);
    let previous = null;
    for (const scene of p.scenes) {
      const look = MR_MOOD_LOOK[scene.mood] || MR_MOOD_LOOK.neutral;
      const options = look.backgrounds.filter((b) => b !== previous);
      scene.background = options[Math.floor(rand() * options.length)] || look.backgrounds[0];
      scene.motion = scene.kind === 'title' ? scene.motion : MR_MOTIONS[1 + Math.floor(rand() * (MR_MOTIONS.length - 1))];
      scene.seed = Math.floor(rand() * 100000);
      previous = scene.background;
    }
  });
}

function addScene() {
  const i = selectedIndex();
  commit('add scene', (p) => {
    const scene = makeScene('New scene', { duration: 2.5 });
    p.scenes.splice(i < 0 ? p.scenes.length : i + 1, 0, scene);
    ed.selectedId = scene.id;
  });
}

function duplicateScene() {
  const i = selectedIndex();
  if (i < 0) return;
  commit('duplicate scene', (p) => {
    const copy = cloneProject({ s: p.scenes[i] }).s;
    copy.id = mrSceneId();
    copy.seed = (copy.seed + 4093) % 100000;
    p.scenes.splice(i + 1, 0, copy);
    ed.selectedId = copy.id;
  });
}

function deleteScene() {
  const i = selectedIndex();
  if (i < 0 || ed.project.scenes.length <= 1) return;
  commit('delete scene', (p) => {
    p.scenes.splice(i, 1);
    ed.selectedId = (p.scenes[i] || p.scenes[i - 1]).id;
  });
}

function moveScene(delta) {
  const i = selectedIndex();
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ed.project.scenes.length) return;
  commit('move scene', (p) => {
    const [moved] = p.scenes.splice(i, 1);
    p.scenes.splice(j, 0, moved);
  });
}

// ---------------------------------------------------------------- pictures

let mrSearchAbort = null;      // in-flight Commons search, so a new one cancels the old
let mrIllustrating = false;

function pictureStatus(text) {
  $('searchStatus').textContent = text || '';
}

// Render the search results as clickable cards. Every card carries its licence, because
// choosing a picture is also choosing an obligation.
function renderResults(results) {
  const box = $('imageResults');
  box.innerHTML = '';
  for (const picture of results) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'result';
    card.title = creditLine(picture);
    const img = document.createElement('img');
    img.src = picture.src;
    img.alt = picture.title;
    img.loading = 'lazy';
    card.appendChild(img);
    const badge = document.createElement('span');
    badge.className = 'badge' + (picture.licenceClass === 'attribution' ? ' attrib' : '');
    badge.textContent = picture.licenceClass === 'public' ? 'PD' : 'BY';
    card.appendChild(badge);
    const meta = document.createElement('div');
    meta.className = 'result-meta';
    meta.textContent = picture.artist ? `${picture.title} — ${picture.artist}` : picture.title;
    card.appendChild(meta);
    card.addEventListener('click', () => usePicture(picture));
    box.appendChild(card);
  }
}

function runSearch(query) {
  if (!query.trim()) return;
  if (mrSearchAbort) mrSearchAbort.abort();
  mrSearchAbort = new AbortController();
  pictureStatus('Searching…');
  searchCommons(query, {
    limit: 12,
    publicDomainOnly: $('publicDomainOnly').checked,
    signal: mrSearchAbort.signal
  }).then((results) => {
    renderResults(results);
    pictureStatus(results.length ? `${results.length} usable results` : 'Nothing usable — try different words');
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    $('imageResults').innerHTML = '';
    pictureStatus('Could not reach Commons: ' + err.message);
  });
}

// Assign a picture to the selected scene, then preload it so the very next repaint
// already shows the artwork rather than the fallback background.
function usePicture(picture) {
  const id = ed.selectedId;
  if (!id) return;
  editScene('use picture', (scene) => { scene.picture = picture; });
  loadPicture(picture.src).then(() => { drawPreview(); renderTimeline(); }, () => {
    pictureStatus('That image would not load — pick another');
  });
}

// The one-button version: search per scene using its own proper nouns, take the best
// usable hit, and prefer not to repeat a picture inside one reel.
//
// The fallback chain matters more than it looks. A beat like "I will not fight, he said"
// has no proper nouns, and a strict no-repeats rule starves later scenes once the good
// results are taken — both leave bare scenes in the middle of an otherwise illustrated
// reel, which reads as broken. So: the scene's own query, then the reel-wide hint, then
// a repeat of something already used, and only then nothing.
async function illustrateAll() {
  if (mrIllustrating) return;
  mrIllustrating = true;
  const bar = $('illustrateBar');
  $('illustrateProgress').hidden = false;
  const publicDomainOnly = $('publicDomainOnly').checked;
  const used = new Set();
  const seen = [];                 // every usable result, for the repeat fallback
  const found = {};
  const scenes = ed.project.scenes.slice();
  const hint = (ed.project.style.imageHint || '').trim();
  let done = 0;

  // Wikimedia rate-limits bursts, and illustrating a ten-scene reel is a burst. Space
  // the searches out and stop early if we get limited anyway, rather than hammering on
  // and getting the user's IP throttled.
  let rateLimited = false;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  // Automatic picking only accepts results with positive evidence of being artwork —
  // categories or a title that actually say painting, lithograph, illustration. A scene
  // left with its procedural background looks intentional; a Google Books watermark
  // sliding past behind your caption does not. The manual search box below stays
  // permissive, so anything usable can still be chosen by hand.
  const search = async (query) => {
    if (!query || rateLimited) return [];
    try {
      const results = await searchCommons(query, { limit: 8, publicDomainOnly });
      return results.filter((r) => (r.artScore || 0) >= MR_ART_CONFIDENT);
    } catch (err) {
      if (err && err.rateLimited) rateLimited = true;
      return [];
    }
  };

  for (const scene of scenes) {
    let results = await search(imageQueryFor(scene, ed.project));
    let pick = results.find((r) => !used.has(r.src));
    if (!pick && hint) {
      results = await search(hint);
      pick = results.find((r) => !used.has(r.src));
    }
    for (const r of results) if (!seen.some((s) => s.src === r.src)) seen.push(r);
    if (!pick) pick = seen[Math.floor(Math.random() * seen.length)] || null;
    if (pick) { used.add(pick.src); found[scene.id] = pick; }
    done++;
    bar.style.width = ((done / scenes.length) * 100).toFixed(1) + '%';
    pictureStatus(rateLimited
      ? 'Wikimedia is rate-limiting — stopping here. Wait a moment and run it again.'
      : `Illustrated ${Object.keys(found).length} of ${done}…`);
    if (rateLimited) break;
    await pause(350);
  }
  commit('illustrate every scene', (p) => {
    for (const scene of p.scenes) if (found[scene.id]) scene.picture = found[scene.id];
  });
  await preloadPictures(ed.project);
  drawPreview();
  renderTimeline();
  $('illustrateProgress').hidden = true;
  bar.style.width = '0%';
  pictureStatus(`Illustrated ${Object.keys(found).length} of ${scenes.length} scenes`);
  mrIllustrating = false;
}

function syncPicturePanel() {
  const scene = selectedScene();
  $('pictureEditor').hidden = !scene;
  $('noPictureScene').hidden = !!scene;
  ed.suppress = true;
  $('imageHint').value = ed.project.style.imageHint || '';
  ed.suppress = false;
  if (!scene) { renderCredits(); return; }

  const picture = scene.picture;
  $('currentPicture').hidden = !picture;
  $('pictureControls').hidden = !picture;
  if (picture) {
    const box = $('currentPicture');
    box.innerHTML = '';
    const img = document.createElement('img');
    img.src = picture.src;
    img.alt = '';
    const text = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = picture.title;
    text.appendChild(name);
    text.appendChild(document.createTextNode(
      [picture.artist, picture.date, picture.licence].filter(Boolean).join(' · ')));
    box.appendChild(img);
    box.appendChild(text);
    $('pictureSource').href = picture.page;

    ed.suppress = true;
    $('pictureFit').value = scene.pictureFit || 'cover';
    $('pictureGrade').value = String(scene.pictureGrade);
    $('gradeValue').textContent = Number(scene.pictureGrade).toFixed(2);
    const focus = scene.pictureFocus || { x: 0.5, y: 0.42 };
    $('focusX').value = String(focus.x);
    $('focusY').value = String(focus.y);
    $('focusXValue').textContent = Number(focus.x).toFixed(2);
    $('focusYValue').textContent = Number(focus.y).toFixed(2);
    ed.suppress = false;
  }
  // Prefill the search with what this scene is actually about.
  if (!$('imageQuery').value || $('imageQuery').dataset.auto === 'yes') {
    $('imageQuery').value = imageQueryFor(scene, ed.project);
    $('imageQuery').dataset.auto = 'yes';
  }
  renderCredits();
}

function renderCredits() {
  const box = $('creditsBox');
  box.innerHTML = '';
  const credits = projectCredits(ed.project);
  if (!credits.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No pictures yet. Credits appear here and in your description automatically.';
    box.appendChild(empty);
    return;
  }
  const row = document.createElement('div');
  row.className = 'kit-row';
  const head = document.createElement('div');
  head.className = 'kit-head';
  head.innerHTML = `<span>${credits.length} artwork${credits.length > 1 ? 's' : ''}</span>`;
  const copy = document.createElement('button');
  copy.className = 'btn tiny ghost';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => copyToClipboard(credits.join('\n'), copy));
  head.appendChild(copy);
  const body = document.createElement('pre');
  body.className = 'kit-body';
  body.textContent = credits.join('\n');
  row.appendChild(head);
  row.appendChild(body);
  box.appendChild(row);
  if (projectNeedsAttribution(ed.project)) {
    const warn = document.createElement('p');
    warn.className = 'kit-warn';
    warn.textContent = 'Some artwork is CC-BY/CC-BY-SA: these credits must stay in your video description.';
    box.appendChild(warn);
  }
}

function wirePictures() {
  $('imageSearchBtn').addEventListener('click', () => {
    $('imageQuery').dataset.auto = 'no';
    runSearch($('imageQuery').value);
  });
  $('imageQuery').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('imageQuery').dataset.auto = 'no'; runSearch($('imageQuery').value); }
  });
  $('publicDomainOnly').addEventListener('change', () => {
    if ($('imageQuery').value.trim()) runSearch($('imageQuery').value);
  });
  $('illustrateAllBtn').addEventListener('click', illustrateAll);
  $('clearPicturesBtn').addEventListener('click', () => {
    commit('clear pictures', (p) => { for (const scene of p.scenes) scene.picture = null; });
  });
  $('removePictureBtn').addEventListener('click', () => editScene('remove picture', (scene) => { scene.picture = null; }));
  $('imageHint').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('set style hint', (p) => { p.style.imageHint = $('imageHint').value; });
  });
  $('pictureFit').addEventListener('change', () => {
    if (ed.suppress) return;
    editScene('set framing', (scene) => { scene.pictureFit = $('pictureFit').value; });
  });
  bindRange('pictureGrade', (p, v) => {
    const s = p.scenes.find((x) => x.id === ed.selectedId);
    if (s) s.pictureGrade = v;
  }, (v) => { $('gradeValue').textContent = v.toFixed(2); });
  bindRange('focusX', (p, v) => {
    const s = p.scenes.find((x) => x.id === ed.selectedId);
    if (s) s.pictureFocus = { x: v, y: (s.pictureFocus || {}).y != null ? s.pictureFocus.y : 0.42 };
  }, (v) => { $('focusXValue').textContent = v.toFixed(2); });
  bindRange('focusY', (p, v) => {
    const s = p.scenes.find((x) => x.id === ed.selectedId);
    if (s) s.pictureFocus = { x: (s.pictureFocus || {}).x != null ? s.pictureFocus.x : 0.5, y: v };
  }, (v) => { $('focusYValue').textContent = v.toFixed(2); });
}

// ---------------------------------------------------------------- building

function buildFromText() {
  const text = $('storyText').value.trim();
  if (!text) { flashSaved('Nothing to build — write something first'); return; }
  const maxWords = Number($('pacingSelect').value);
  const fit = Number($('fitSelect').value);
  const previous = ed.project;
  commit('build storyboard', () => {
    const built = buildStoryboard(text, {
      maxWordsPerScene: maxWords,
      titleCard: $('titleCardCheck').checked,
      fit: fit > 0,
      maxSeconds: fit || 999,
      // Keep the look the user has already chosen — a re-build is about the words.
      style: previous ? previous.style : undefined,
      audio: previous ? previous.audio : undefined
    });
    ed.project = built;
    ed.selectedId = built.scenes[0].id;
    ed.time = Math.min(0.6, totalDuration(built) * 0.15);
  });
  sizePreview();
  afterChange();
}

const MR_SAMPLE = `The Lighthouse Keeper's Last Night

For forty years Aoife kept the lamp. Every night she climbed the hundred and twelve steps, and every night the light went out over the water.

The storm came in on a Tuesday. It took the roof off the boathouse and threw the sea against the cliff until the whole tower rang like a struck bell.

Halfway up the stairs, the lamp went dark. Aoife ran. She had never run those steps before.

The mechanism had seized. Her hands were shaking and the glass was cold and somewhere out there a trawler was steering by a light that no longer existed.

She turned the wheel by hand. All night. Her arms burned and the storm screamed and the beam went round, and round, and round.

At dawn the trawler came into harbour. The crew asked who had been keeping the light. Nobody, they were told. The tower has been automatic for years.`;

// ---------------------------------------------------------------- files

function saveToFile() {
  downloadText(exportProjectJSON(ed.project), mrSafeName(ed.project.title, 'json'), 'application/json');
}

function openFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const project = importProjectJSON(String(reader.result));
      commit('open project', () => {
        ed.project = project;
        ed.selectedId = project.scenes[0].id;
        ed.time = 0;
      });
      $('storyText').value = project.source || '';
      sizePreview();
      afterChange();
      flashSaved('Opened ' + file.name);
    } catch (err) {
      flashSaved('Could not open: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------- recording

async function startExport() {
  if (ed.exporting) return;
  pause();
  const controller = new AbortController();
  ed.exporting = controller;
  const bar = $('exportBar');
  $('exportProgress').hidden = false;
  $('exportResult').hidden = true;
  $('cancelExportBtn').hidden = false;
  $('exportBtn').disabled = true;
  $('exportBtn2').disabled = true;
  showTab('export');
  try {
    const result = await exportVideo(ed.project, {
      scale: Number($('exportScale').value),
      signal: controller.signal,
      onProgress: (fraction, seconds) => {
        bar.style.width = (fraction * 100).toFixed(1) + '%';
        ed.time = seconds;
        updateTransport();
      }
    });
    if (result) {
      const name = mrSafeName(ed.project.title, result.ext);
      downloadBlob(result.blob, name);
      const size = (result.blob.size / (1024 * 1024)).toFixed(1);
      const box = $('exportResult');
      box.hidden = false;
      box.innerHTML = `<b>${name}</b> · ${size} MB · ${result.mime.split(';')[0]}` +
        (result.ext === 'webm' ? '<br><span class="muted">WebM uploads to YouTube directly. Convert it if you need MP4 elsewhere.</span>' : '');
      mrAudioTick('ok');
    }
  } catch (err) {
    const box = $('exportResult');
    box.hidden = false;
    box.textContent = 'Recording failed: ' + err.message;
  } finally {
    ed.exporting = null;
    $('exportProgress').hidden = true;
    $('cancelExportBtn').hidden = true;
    $('exportBtn').disabled = false;
    $('exportBtn2').disabled = false;
    bar.style.width = '0%';
  }
}

// ---------------------------------------------------------------- tabs & wiring

function showTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === name);
  });
}

// Wire a slider to a project field: repaint live on every input so the frame moves under
// your finger, but record exactly one undo point per drag — the state as it was when the
// drag began, snapshotted before the first change lands.
function bindRange(id, write, format) {
  const el = $(id);
  let dragStart = null;
  el.addEventListener('input', () => {
    if (ed.suppress) return;
    if (!dragStart) dragStart = cloneProject(ed.project);
    write(ed.project, Number(el.value));
    if (format) format(Number(el.value));
    drawPreview();
  });
  el.addEventListener('change', () => {
    if (ed.suppress || !dragStart) return;
    ed.history.push({ label: id, project: dragStart });
    if (ed.history.length > MR_HISTORY_LIMIT) ed.history.shift();
    ed.future.length = 0;
    dragStart = null;
    afterChange();
  });
}

function wireEditor() {
  buildSelects();
  wirePictures();

  $('buildBtn').addEventListener('click', buildFromText);
  $('sampleBtn').addEventListener('click', () => {
    $('storyText').value = MR_SAMPLE;
    buildFromText();
  });
  $('storyText').addEventListener('input', () => {
    const words = mrWordCount($('storyText').value);
    $('storyStats').textContent = `${words} words in the draft — press Build`;
  });

  $('playBtn').addEventListener('click', () => (ed.playing ? pause() : play()));
  $('scrub').addEventListener('input', () => {
    const total = totalDuration(ed.project);
    seek((Number($('scrub').value) / 1000) * total);
  });
  $('muteCheck').addEventListener('change', () => {
    if ($('muteCheck').checked) mrAudioStop();
    else if (ed.playing) mrAudioPlay(ed.project, ed.time);
  });

  $('addSceneBtn').addEventListener('click', addScene);
  $('splitBtn').addEventListener('click', splitAtPlayhead);
  $('mergeBtn').addEventListener('click', mergeWithNext);
  $('evenBtn').addEventListener('click', evenOutPacing);
  $('shuffleBtn').addEventListener('click', shuffleLooks);
  $('dupBtn').addEventListener('click', duplicateScene);
  $('deleteBtn').addEventListener('click', deleteScene);
  $('upBtn').addEventListener('click', () => moveScene(-1));
  $('downBtn').addEventListener('click', () => moveScene(1));
  $('rerollBtn').addEventListener('click', () => editScene('re-roll look', (scene) => {
    scene.seed = Math.floor(Math.random() * 100000);
  }));

  $('sceneText').addEventListener('change', () => editScene('edit caption', (scene) => {
    scene.text = $('sceneText').value;
    scene.emphasis = pickEmphasis(scene.text, 2);
  }));
  bindRange('sceneDuration',
    (p, v) => { const s = p.scenes.find((x) => x.id === ed.selectedId); if (s) s.duration = v; },
    (v) => { $('durationValue').textContent = v.toFixed(1) + 's'; });
  bindRange('sceneIntensity',
    (p, v) => { const s = p.scenes.find((x) => x.id === ed.selectedId); if (s) s.intensity = v; },
    (v) => { $('intensityValue').textContent = v.toFixed(2); });

  const sceneFields = [
    ['sceneBackground', 'background'], ['sceneMotion', 'motion'], ['sceneTransition', 'transition'],
    ['sceneCaption', 'captionStyle'], ['scenePosition', 'captionPosition'], ['sceneMood', 'mood']
  ];
  for (const [id, field] of sceneFields) {
    $(id).addEventListener('change', () => {
      if (ed.suppress) return;
      editScene('set ' + field, (scene) => { scene[field] = $(id).value; });
    });
  }
  $('sceneEmphasis').addEventListener('change', () => editScene('set emphasis', (scene) => {
    scene.emphasis = $('sceneEmphasis').value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  }));
  $('sceneAccent').addEventListener('change', () => editScene('set accent', (scene) => {
    scene.accent = $('sceneAccent').value;
  }));
  $('accentReset').addEventListener('click', () => editScene('clear accent', (scene) => { scene.accent = null; }));

  const styleFields = [
    ['stylePalette', 'palette'], ['styleFont', 'font'], ['styleAspect', 'aspect']
  ];
  for (const [id, field] of styleFields) {
    $(id).addEventListener('change', () => {
      if (ed.suppress) return;
      commit('set ' + field, (p) => { p.style[field] = $(id).value; });
      if (field === 'aspect') { sizePreview(); drawPreview(); }
    });
  }
  $('styleFps').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('set fps', (p) => { p.style.fps = Number($('styleFps').value); });
  });
  bindRange('styleGrain', (p, v) => { p.style.grain = v; },
    (v) => { $('grainValue').textContent = v.toFixed(2); });
  bindRange('styleVignette', (p, v) => { p.style.vignette = v; },
    (v) => { $('vignetteValue').textContent = v.toFixed(2); });
  bindRange('styleMotionScale', (p, v) => { p.style.motionScale = v; },
    (v) => { $('motionScaleValue').textContent = v.toFixed(2); });
  $('styleWatermark').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('set watermark', (p) => { p.style.watermark = $('styleWatermark').value; });
  });
  $('styleProgress').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('toggle progress bar', (p) => { p.style.progressBar = $('styleProgress').checked; });
  });
  $('styleNumbers').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('toggle scene numbers', (p) => { p.style.sceneNumbers = $('styleNumbers').checked; });
  });
  $('applyLookAllBtn').addEventListener('click', () => {
    const scene = selectedScene();
    if (!scene) return;
    commit('apply camera to all', (p) => {
      for (const s of p.scenes) { s.motion = scene.motion; s.intensity = scene.intensity; }
    });
  });

  $('audioEnabled').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('toggle score', (p) => { p.audio.enabled = $('audioEnabled').checked; });
    if (!$('audioEnabled').checked) mrAudioStop();
  });
  $('audioMood').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('set score mood', (p) => { p.audio.mood = $('audioMood').value; });
  });
  $('audioAccents').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('toggle accents', (p) => { p.audio.accents = $('audioAccents').checked; });
  });
  bindRange('audioVolume', (p, v) => { p.audio.volume = v; mrAudioVolume(v); },
    (v) => { $('audioVolumeValue').textContent = Math.round(v * 100) + '%'; });

  $('projectTitle').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('rename', (p) => { p.title = $('projectTitle').value || 'Untitled'; });
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });

  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('saveBtn').addEventListener('click', saveToFile);
  $('openBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) openFromFile(file);
    e.target.value = '';
  });

  $('exportBtn').addEventListener('click', startExport);
  $('exportBtn2').addEventListener('click', startExport);
  $('cancelExportBtn').addEventListener('click', () => { if (ed.exporting) ed.exporting.abort(); });
  $('stillBtn').addEventListener('click', async () => {
    const blob = await exportStill(ed.project, ed.time);
    if (blob) downloadBlob(blob, mrSafeName(ed.project.title + '-cover', 'png'));
  });
  $('srtBtn').addEventListener('click', () => downloadText(captionsSRT(ed.project), mrSafeName(ed.project.title, 'srt')));
  $('vttBtn').addEventListener('click', () => downloadText(captionsVTT(ed.project), mrSafeName(ed.project.title, 'vtt'), 'text/vtt'));
  $('jsonBtn').addEventListener('click', saveToFile);

  window.addEventListener('resize', () => { sizePreview(); drawPreview(); });
  document.addEventListener('keydown', onKey);
}

// Editing shortcuts, skipped whenever a text field has focus so typing still works.
function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (typing) return;
  const frame = 1 / (ed.project.style.fps || 30);
  if (e.key === ' ') { e.preventDefault(); if (ed.playing) pause(); else play(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(ed.time + (e.shiftKey ? frame : 0.5)); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(ed.time - (e.shiftKey ? frame : 0.5)); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const i = selectedIndex();
    const next = Math.max(0, Math.min(ed.project.scenes.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    selectScene(ed.project.scenes[next].id, true);
  } else if (e.key === 's' && !e.ctrlKey && !e.metaKey) splitAtPlayhead();
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteScene();
}
