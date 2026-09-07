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
  syncPanelControls();
  syncNarrationControls();
  syncAnimatePanel();
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
  if (!ed.playing) renderKeyList();
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

// ---------------------------------------------------------------- drawn panels

// The key never goes into the project file — that file gets shared. It lives in this
// browser only, under its own storage key, per provider.
const MR_KEY_STORAGE = 'myrecital.apikey.';
let mrDrawing = null;      // AbortController while a run is going

function storedKey(provider) {
  try { return localStorage.getItem(MR_KEY_STORAGE + provider) || ''; } catch { return ''; }
}
function storeKey(provider, value) {
  try {
    if (value) localStorage.setItem(MR_KEY_STORAGE + provider, value);
    else localStorage.removeItem(MR_KEY_STORAGE + provider);
  } catch { /* private mode — the key just won't be remembered */ }
}

function drawStatus(text, isError) {
  const box = $('drawStatus');
  box.hidden = !text;
  box.textContent = text || '';
  box.style.color = isError ? 'var(--danger)' : '';
}

function generationSettings() {
  return Object.assign({}, MR_DEFAULT_GENERATION, ed.project.generation);
}

function syncPanelControls() {
  const generation = generationSettings();
  ed.suppress = true;
  $('genProvider').value = generation.provider;
  $('genStyle').value = generation.style;
  $('genStyleNotes').value = generation.styleNotes || '';
  $('genKey').value = storedKey(generation.provider);
  ed.suppress = false;
  const provider = MR_PROVIDERS[generation.provider] || MR_PROVIDERS.gemini;
  $('genKeyLabel').textContent = `${provider.name} API key`;
  $('genKeyNote').textContent = provider.direct
    ? 'Called straight from this page, so no server is needed. The key is kept in this browser only — never in the project file.'
    : `${provider.name} does not allow browser calls, so requests go through ${generation.proxy}. Deploy functions/api/image.js and set the key there; a key typed here is sent to your own function as a fallback.`;
  renderCast();
}

function renderCast() {
  const list = $('castList');
  list.innerHTML = '';
  const cast = ed.project.cast || [];
  if (!cast.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No cast yet. Without descriptions the model redraws each character from scratch every panel.';
    list.appendChild(empty);
    return;
  }
  cast.forEach((member, i) => {
    const row = document.createElement('div');
    row.className = 'cast-row';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'cast-name';
    name.value = member.name;
    name.placeholder = 'Name';
    name.addEventListener('change', () => commit('rename character', (p) => { p.cast[i].name = name.value; }));
    const description = document.createElement('input');
    description.type = 'text';
    description.value = member.description || '';
    description.placeholder = 'young warrior, green tunic, gold armband, topknot';
    description.addEventListener('change', () =>
      commit('describe character', (p) => { p.cast[i].description = description.value; }));
    const remove = document.createElement('button');
    remove.className = 'btn ghost tiny';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => commit('remove character', (p) => { p.cast.splice(i, 1); }));
    row.appendChild(name);
    row.appendChild(description);
    row.appendChild(remove);
    list.appendChild(row);
  });
}

// Draw panels for the given scenes, one at a time. Serial on purpose: image models are
// slow and rate-limited, and a burst of ten parallel calls is the fastest way to get a
// 429 and a half-illustrated reel.
async function drawPanels(scenes) {
  if (mrDrawing) return;
  const generation = generationSettings();
  const provider = MR_PROVIDERS[generation.provider] || MR_PROVIDERS.gemini;
  const apiKey = $('genKey').value.trim();
  if (provider.direct && !apiKey) {
    drawStatus(`${provider.name} is called from this page, so it needs a key here.`, true);
    return;
  }
  mrDrawing = new AbortController();
  $('cancelDrawBtn').hidden = false;
  $('drawProgress').hidden = false;
  const bar = $('drawBar');
  let done = 0, drawn = 0;
  const before = cloneProject(ed.project);

  for (const scene of scenes) {
    if (mrDrawing.signal.aborted) break;
    drawStatus(`Drawing panel ${done + 1} of ${scenes.length}…`);
    try {
      const live = ed.project.scenes.find((s) => s.id === scene.id);
      if (live) { await generatePanelFor(live, ed.project, { apiKey, signal: mrDrawing.signal }); drawn++; }
      drawPreview();
      renderTimeline();
    } catch (err) {
      if (mrDrawing.signal.aborted) break;
      // Stop on the first real failure: ten identical errors help nobody, and a wrong key
      // or a wrong model name fails identically every time.
      drawStatus(`Stopped at panel ${done + 1}: ${err.message}`, true);
      break;
    }
    done++;
    bar.style.width = ((done / scenes.length) * 100).toFixed(1) + '%';
  }

  if (drawn) {
    // One undo entry for the whole run, holding the state from before it started.
    ed.history.push({ label: 'draw panels', project: before });
    if (ed.history.length > MR_HISTORY_LIMIT) ed.history.shift();
    ed.future.length = 0;
    if (!$('drawStatus').textContent.startsWith('Stopped')) {
      drawStatus(`Drew ${drawn} panel${drawn === 1 ? '' : 's'}.`);
    }
    afterChange();
  }
  mrDrawing = null;
  $('cancelDrawBtn').hidden = true;
  $('drawProgress').hidden = true;
  bar.style.width = '0%';
}

function wirePanels() {
  const providerKeys = Object.keys(MR_PROVIDERS);
  fillSelect($('genProvider'), providerKeys, providerKeys.map((k) => MR_PROVIDERS[k].name));
  const styleKeys = Object.keys(MR_ART_STYLES);
  fillSelect($('genStyle'), styleKeys, styleKeys.map((k) => MR_ART_STYLES[k].name));

  $('genProvider').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('set provider', (p) => {
      p.generation = Object.assign({}, MR_DEFAULT_GENERATION, p.generation, { provider: $('genProvider').value });
    });
  });
  $('genStyle').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('set art style', (p) => {
      p.generation = Object.assign({}, MR_DEFAULT_GENERATION, p.generation, { style: $('genStyle').value });
    });
  });
  $('genStyleNotes').addEventListener('change', () => {
    if (ed.suppress) return;
    commit('set style notes', (p) => {
      p.generation = Object.assign({}, MR_DEFAULT_GENERATION, p.generation, { styleNotes: $('genStyleNotes').value });
    });
  });
  $('genKey').addEventListener('change', () => {
    if (ed.suppress) return;
    storeKey(generationSettings().provider, $('genKey').value.trim());
  });
  $('suggestCastBtn').addEventListener('click', () => {
    commit('find the cast', (p) => {
      const existing = new Set((p.cast || []).map((c) => c.name.toLowerCase()));
      const found = suggestCast(p).filter((c) => !existing.has(c.name.toLowerCase()));
      p.cast = (p.cast || []).concat(found);
    });
  });
  $('addCastBtn').addEventListener('click', () => {
    commit('add character', (p) => { p.cast = (p.cast || []).concat([{ name: '', description: '' }]); });
  });
  $('drawAllBtn').addEventListener('click', () => drawPanels(ed.project.scenes.slice()));
  $('drawOneBtn').addEventListener('click', () => {
    const scene = selectedScene();
    if (scene) drawPanels([scene]);
  });
  $('cancelDrawBtn').addEventListener('click', () => { if (mrDrawing) mrDrawing.abort(); });
}

// ---------------------------------------------------------------- animating

let mrSelectedActorId = null;
let mrDrag = null;

function currentStage() {
  const scene = selectedScene();
  if (!scene) return null;
  if (!scene.stage) scene.stage = makeStage();
  return scene.stage;
}

function selectedActor() {
  const stage = currentStage();
  if (!stage) return null;
  return stage.actors.find((a) => a.id === mrSelectedActorId) || null;
}

function selectedProp() {
  const stage = currentStage();
  if (!stage) return null;
  return (stage.props || []).find((p) => p.id === mrSelectedActorId) || null;
}

// Anything selected, actor or prop — both are keyframed the same way.
function selectedItem() {
  return selectedActor() || selectedProp();
}

// Where the playhead is *inside* the selected scene — the time an actor's keyframes are
// measured in, because a scene is the unit you animate.
function localTime() {
  const at = sceneAt(ed.project, ed.time);
  return at ? at.local : 0;
}

function editActors(label, mutate) {
  const sceneId = ed.selectedId;
  commit(label, (p) => {
    const scene = p.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    if (!scene.stage) scene.stage = makeStage();
    mutate(scene.stage, scene);
  });
}

function renderActorList() {
  const list = $('actorList');
  list.innerHTML = '';
  const stage = currentStage();
  const scene = selectedScene();
  if (!stage || !scene) return;
  if (!stage.actors.length && !(stage.props || []).length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No one on stage yet. Add a character and drag them where you want them.';
    list.appendChild(empty);
    return;
  }
  for (const prop of stage.props || []) {
    const chip = document.createElement('div');
    chip.className = 'actor-chip' + (prop.id === mrSelectedActorId ? ' is-selected' : '');
    const thumb = document.createElement('canvas');
    thumb.width = 52; thumb.height = 68;
    chip.appendChild(thumb);
    const name = document.createElement('b');
    name.textContent = prop.name;
    chip.appendChild(name);
    const meta = document.createElement('span');
    meta.textContent = `${prop.layer} · ${prop.keys.length} key${prop.keys.length === 1 ? '' : 's'}`;
    chip.appendChild(meta);
    chip.addEventListener('click', () => { mrSelectedActorId = prop.id; syncAnimatePanel(); drawPreview(); });
    list.appendChild(chip);
    const tctx = thumb.getContext('2d');
    tctx.clearRect(0, 0, 52, 68);
    drawProp(tctx, prop, { x: 0.5, y: 0.92, scale: 0.8, facing: 'right', rotate: 0 }, 52, 68);
  }
  for (const actor of stage.actors) {
    const chip = document.createElement('div');
    chip.className = 'actor-chip' + (actor.id === mrSelectedActorId ? ' is-selected' : '');
    const thumb = document.createElement('canvas');
    thumb.width = 52; thumb.height = 68;
    chip.appendChild(thumb);
    const name = document.createElement('b');
    name.textContent = actor.name;
    chip.appendChild(name);
    const meta = document.createElement('span');
    const state = actorStateAt(actor, localTime());
    meta.textContent = `${state.action} · ${actor.keys.length} key${actor.keys.length === 1 ? '' : 's'}`;
    chip.appendChild(meta);
    chip.addEventListener('click', () => { mrSelectedActorId = actor.id; syncAnimatePanel(); drawPreview(); });
    list.appendChild(chip);
    // Draw the actor into their own chip, so the cast list is faces rather than names.
    const tctx = thumb.getContext('2d');
    tctx.clearRect(0, 0, 52, 68);
    drawActor(tctx, actor, poseFor('idle', 0.4, actor.seed, false), 26, 66, 62);
  }
}

function renderKeyList() {
  const list = $('keyList');
  list.innerHTML = '';
  const actor = selectedItem();
  if (!actor) return;
  const now = localTime();
  for (const key of actor.keys) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'key-pill' + (Math.abs(key.t - now) < 0.06 ? ' is-current' : '');
    pill.textContent = `${key.t.toFixed(1)}s · ${actor.type === 'prop' ? 'pose' : key.action}`;
    pill.title = `x ${key.x.toFixed(2)} · size ${key.scale.toFixed(2)} · ${key.expression}`;
    pill.addEventListener('click', () => {
      const at = sceneAt(ed.project, ed.time);
      seek((at ? at.start : 0) + key.t);
    });
    list.appendChild(pill);
  }
}

function syncAnimatePanel() {
  const stage = currentStage();
  if (stage && !selectedItem() && stage.actors.length) mrSelectedActorId = stage.actors[0].id;
  const chosen = selectedActor();
  const prop = selectedProp();
  $('actorEditor').hidden = !chosen;
  $('propEditor').hidden = !prop;
  renderActorList();
  renderKeyList();
  if (prop) {
    const state = stateAt(prop, localTime());
    ed.suppress = true;
    $('propKindEdit').value = prop.kind;
    $('propLayer').value = prop.layer;
    $('propScale').value = String(state.scale);
    $('propScaleValue').textContent = Number(state.scale).toFixed(2);
    $('propTint').value = prop.tint;
    ed.suppress = false;
  }
  if (!chosen) return;
  const state = actorStateAt(chosen, localTime());
  ed.suppress = true;
  $('actorName').value = chosen.name;
  $('actorAction').value = state.action;
  $('actorExpression').value = state.expression;
  $('actorFacing').value = state.facing;
  $('actorBody').value = chosen.body;
  $('actorHairStyle').value = chosen.hairStyle;
  $('actorScale').value = String(state.scale);
  $('actorScaleValue').textContent = Number(state.scale).toFixed(2);
  $('actorSkin').value = chosen.skin;
  $('actorHair').value = chosen.hair;
  $('actorTop').value = chosen.top;
  $('actorBottom').value = chosen.bottom;
  $('actorSpeaker').checked = !!chosen.speaker;
  ed.suppress = false;
}

// Change something about the actor *at the playhead*: appearance is a property of the
// character, but pose, position and mood are properties of this moment, so they land on a
// keyframe. That distinction is the whole mental model of the tool.
function setActorProperty(label, values, appearance) {
  const actorId = mrSelectedActorId;
  const t = localTime();
  editActors(label, (stage) => {
    const actor = stage.actors.find((a) => a.id === actorId);
    if (!actor) return;
    if (appearance) Object.assign(actor, values);
    else setKey(actor, t, values);
  });
}

function addActor() {
  const stage = currentStage();
  if (!stage) return;
  const index = stage.actors.length;
  const actor = makeActor(`Character ${index + 1}`, {
    skin: MR_SKINS[index % MR_SKINS.length],
    hair: MR_HAIRS[index % MR_HAIRS.length],
    hairStyle: MR_HAIR_STYLES[index % MR_HAIR_STYLES.length],
    top: ['#c2452d', '#1f7a53', '#3a5cc8', '#7a4bff', '#e0a33f'][index % 5],
    // Spread new arrivals across the stage rather than stacking them on one spot.
    start: { x: 0.3 + (index % 3) * 0.2, y: 0.86, scale: 0.5 }
  });
  editActors('add character', (stage) => { stage.actors.push(actor); });
  mrSelectedActorId = actor.id;
  syncAnimatePanel();
}

// Dragging on the preview moves whoever is under the pointer and keys them there.
function wireStageDragging() {
  const canvas = $('preview');
  const toFrame = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  canvas.addEventListener('pointerdown', (event) => {
    const scene = selectedScene();
    if (!scene || !scene.stage || (!scene.stage.actors.length && !(scene.stage.props || []).length)) return;
    const point = toFrame(event);
    const hit = actorAtPoint(scene, localTime(), point.x, point.y);
    if (!hit) return;
    mrSelectedActorId = hit.id;
    const state = stateAt(hit, localTime());
    mrDrag = { id: hit.id, dx: state.x - point.x, dy: state.y - point.y, moved: false, before: cloneProject(ed.project) };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
    syncAnimatePanel();
    drawPreview();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!mrDrag) return;
    const scene = selectedScene();
    const actor = scene && (scene.stage.actors.find((a) => a.id === mrDrag.id) ||
      (scene.stage.props || []).find((p) => p.id === mrDrag.id));
    if (!actor) return;
    const point = toFrame(event);
    mrDrag.moved = true;
    // Live, without an undo entry per pixel — the entry is pushed once on release.
    setKey(actor, localTime(), {
      x: Math.max(0.02, Math.min(0.98, point.x + mrDrag.dx)),
      y: Math.max(0.15, Math.min(1, point.y + mrDrag.dy))
    });
    drawPreview();
  });

  const endDrag = (event) => {
    if (!mrDrag) return;
    canvas.classList.remove('is-dragging');
    if (event && event.pointerId != null && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (mrDrag.moved) {
      ed.history.push({ label: 'move character', project: mrDrag.before });
      if (ed.history.length > MR_HISTORY_LIMIT) ed.history.shift();
      ed.future.length = 0;
      afterChange();
    }
    mrDrag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
}

function wireAnimate() {
  fillSelect($('actorAction'), MR_ACTIONS);
  fillSelect($('actorExpression'), Object.keys(MR_EXPRESSIONS));
  const bodies = Object.keys(MR_BODIES);
  fillSelect($('actorBody'), bodies, bodies.map((b) => MR_BODIES[b].name));
  fillSelect($('actorHairStyle'), MR_HAIR_STYLES);

  $('addActorBtn').addEventListener('click', addActor);
  $('copyActorsBtn').addEventListener('click', () => {
    const i = selectedIndex();
    if (i < 0 || i >= ed.project.scenes.length - 1) return;
    // Same people, same look, first pose only — the next scene is a new performance.
    const stage = currentStage();
    const firstPose = (item) => [Object.assign({}, stateAt(item, 0), { t: 0 })];
    const cast = (stage.actors || []).map((actor) => Object.assign({}, actor, { id: undefined, keys: firstPose(actor) }));
    const scenery = (stage.props || []).map((prop) => Object.assign({}, prop, { id: undefined, keys: firstPose(prop) }));
    commit('copy stage forward', (p) => {
      const next = p.scenes[i + 1];
      if (!next.stage) next.stage = makeStage();
      next.stage.actors = cast.map((actor) => makeActor(actor.name, actor));
      next.stage.props = scenery.map((prop) => Object.assign(makeProp(prop.kind, prop), { tint: prop.tint, layer: prop.layer, keys: prop.keys }));
    });
  });

  // Pose, mood, facing, position and size are moments — they become keyframes.
  for (const [id, prop] of [['actorAction', 'action'], ['actorExpression', 'expression'], ['actorFacing', 'facing']]) {
    $(id).addEventListener('change', () => {
      if (ed.suppress) return;
      setActorProperty('set ' + prop, { [prop]: $(id).value }, false);
    });
  }
  // Body, hair and colours are the character themselves — they apply to the whole reel.
  for (const [id, prop] of [['actorBody', 'body'], ['actorHairStyle', 'hairStyle'], ['actorSkin', 'skin'],
    ['actorHair', 'hair'], ['actorTop', 'top'], ['actorBottom', 'bottom']]) {
    $(id).addEventListener('change', () => {
      if (ed.suppress) return;
      setActorProperty('restyle character', { [prop]: $(id).value }, true);
    });
  }
  $('actorName').addEventListener('change', () => {
    if (ed.suppress) return;
    setActorProperty('rename character', { name: $('actorName').value }, true);
  });
  $('actorSpeaker').addEventListener('change', () => {
    if (ed.suppress) return;
    const speaker = $('actorSpeaker').checked;
    const actorId = mrSelectedActorId;
    // Only one mouth moves at a time, or the scene looks like a chorus.
    editActors('set speaker', (stage) => {
      for (const actor of stage.actors) actor.speaker = speaker && actor.id === actorId;
    });
  });
  bindRange('actorScale', (p, v) => {
    const scene = p.scenes.find((s) => s.id === ed.selectedId);
    const actor = scene && scene.stage && scene.stage.actors.find((a) => a.id === mrSelectedActorId);
    if (actor) setKey(actor, localTime(), { scale: v });
  }, (v) => { $('actorScaleValue').textContent = v.toFixed(2); });

  $('setKeyBtn').addEventListener('click', () => {
    const actor = selectedActor();
    if (!actor) return;
    setActorProperty('set keyframe', actorStateAt(actor, localTime()), false);
  });
  $('removeKeyBtn').addEventListener('click', () => {
    const t = localTime();
    setActorProperty('remove keyframe', {}, true);   // no-op values; the removal is below
    editActors('remove keyframe', (stage) => {
      const actor = stage.actors.find((a) => a.id === mrSelectedActorId);
      if (actor) removeKey(actor, t);
    });
  });
  $('removeActorBtn').addEventListener('click', () => {
    const actorId = mrSelectedActorId;
    editActors('delete character', (stage) => {
      const i = stage.actors.findIndex((a) => a.id === actorId);
      if (i >= 0) stage.actors.splice(i, 1);
    });
    mrSelectedActorId = null;
    syncAnimatePanel();
  });

  fillSelect($('propKind'), MR_PROP_KINDS, MR_PROP_KINDS.map((k) => MR_PROPS[k].name));
  fillSelect($('propKindEdit'), MR_PROP_KINDS, MR_PROP_KINDS.map((k) => MR_PROPS[k].name));
  $('addPropBtn').addEventListener('click', () => {
    const kind = $('propKind').value;
    const prop = makeProp(kind, { start: { x: 0.5, y: 0.88, scale: MR_PROPS[kind].layer === 'back' ? 0.5 : 0.3 } });
    editActors('add prop', (stage) => { if (!stage.props) stage.props = []; stage.props.push(prop); });
    mrSelectedActorId = prop.id;
    syncAnimatePanel();
  });

  const editProp = (label, mutate) => {
    const propId = mrSelectedActorId;
    editActors(label, (stage) => {
      const prop = (stage.props || []).find((p) => p.id === propId);
      if (prop) mutate(prop);
    });
  };
  $('propKindEdit').addEventListener('change', () => {
    if (ed.suppress) return;
    editProp('change prop', (prop) => { prop.kind = $('propKindEdit').value; prop.name = MR_PROPS[prop.kind].name; });
  });
  $('propLayer').addEventListener('change', () => {
    if (ed.suppress) return;
    editProp('set prop depth', (prop) => { prop.layer = $('propLayer').value; });
  });
  $('propTint').addEventListener('change', () => {
    if (ed.suppress) return;
    editProp('recolour prop', (prop) => { prop.tint = $('propTint').value; });
  });
  bindRange('propScale', (p, v) => {
    const scene = p.scenes.find((s) => s.id === ed.selectedId);
    const prop = scene && scene.stage && (scene.stage.props || []).find((x) => x.id === mrSelectedActorId);
    if (prop) setKey(prop, localTime(), { scale: v });
  }, (v) => { $('propScaleValue').textContent = v.toFixed(2); });
  $('flipPropBtn').addEventListener('click', () => {
    const prop = selectedProp();
    if (!prop) return;
    const facing = stateAt(prop, localTime()).facing === 'left' ? 'right' : 'left';
    editProp('flip prop', (p) => { setKey(p, localTime(), { facing }); });
  });
  $('setPropKeyBtn').addEventListener('click', () => {
    const prop = selectedProp();
    if (!prop) return;
    editProp('set prop keyframe', (p) => { setKey(p, localTime(), stateAt(p, localTime())); });
  });
  $('removePropBtn').addEventListener('click', () => {
    const propId = mrSelectedActorId;
    editActors('delete prop', (stage) => {
      const i = (stage.props || []).findIndex((p) => p.id === propId);
      if (i >= 0) stage.props.splice(i, 1);
    });
    mrSelectedActorId = null;
    syncAnimatePanel();
  });

  wireStageDragging();
}

// ---------------------------------------------------------------- narration

let mrNarrating = null;

function narrationSettings() {
  return Object.assign({}, MR_DEFAULT_NARRATION, ed.project.narration);
}

function narrateStatus(text, isError) {
  const box = $('narrateStatus');
  box.hidden = !text;
  box.textContent = text || '';
  box.style.color = isError ? 'var(--danger)' : '';
}

function syncNarrationControls() {
  const settings = narrationSettings();
  const provider = MR_VOICE_PROVIDERS[settings.provider] || MR_VOICE_PROVIDERS.openai;
  ed.suppress = true;
  $('voiceProvider').value = settings.provider;
  // OpenAI names its voices; ElevenLabs addresses them by id, so the field changes shape.
  const named = provider.voices.length > 0;
  $('voiceName').parentElement.hidden = !named;
  $('voiceIdField').hidden = named;
  if (named) {
    fillSelect($('voiceName'), provider.voices);
    $('voiceName').value = settings.voice || provider.defaultVoice;
  } else {
    $('voiceId').value = settings.voice || provider.defaultVoice;
  }
  $('voiceKey').value = storedKey('voice-' + settings.provider);
  $('voiceInstructions').value = settings.instructions || '';
  $('voiceGap').value = String(settings.gap);
  $('voiceGapValue').textContent = Number(settings.gap).toFixed(2) + 's';
  $('voiceDuck').value = String(settings.duckMusic);
  $('voiceDuckValue').textContent = Math.round(settings.duckMusic * 100) + '%';
  ed.suppress = false;
  $('voiceKeyLabel').textContent = `${provider.name} API key`;
  const spoken = narrationSeconds(ed.project);
  if (spoken) narrateStatus(`${spoken.toFixed(1)}s of narration across ${ed.project.scenes.filter((s) => s.narration).length} scenes.`);
}

// Narrate scenes one at a time, re-timing each to its line. Serial for the same reason
// panels are: TTS endpoints rate-limit, and a burst fails half way through.
async function narrateScenes(scenes) {
  if (mrNarrating) return;
  const settings = narrationSettings();
  const provider = MR_VOICE_PROVIDERS[settings.provider] || MR_VOICE_PROVIDERS.openai;
  const apiKey = $('voiceKey').value.trim();
  mrNarrating = new AbortController();
  $('cancelNarrateBtn').hidden = false;
  $('narrateProgress').hidden = false;
  const bar = $('narrateBar');
  const before = cloneProject(ed.project);
  let done = 0, spoken = 0;

  for (const scene of scenes) {
    if (mrNarrating.signal.aborted) break;
    narrateStatus(`Narrating ${done + 1} of ${scenes.length}…`);
    try {
      const live = ed.project.scenes.find((s) => s.id === scene.id);
      if (live && live.text.trim()) {
        await narrateScene(live, ed.project, { apiKey, signal: mrNarrating.signal });
        spoken++;
        updateTransport();
      }
    } catch (err) {
      if (mrNarrating.signal.aborted) break;
      narrateStatus(`Stopped at scene ${done + 1}: ${err.message}`, true);
      break;
    }
    done++;
    bar.style.width = ((done / scenes.length) * 100).toFixed(1) + '%';
  }

  if (spoken) {
    ed.history.push({ label: 'narrate', project: before });
    if (ed.history.length > MR_HISTORY_LIMIT) ed.history.shift();
    ed.future.length = 0;
    // A narrated reel is a picture-first reel: nobody needs the line twice, once spoken
    // and once dancing. Anything still on a kinetic style drops to subtitles.
    commit('narration', (p) => {
      p.narration = Object.assign({}, MR_DEFAULT_NARRATION, p.narration, { enabled: true });
      for (const scene of p.scenes) {
        if (scene.narration && scene.captionStyle !== 'title' && scene.captionStyle !== 'none') {
          scene.captionStyle = 'subtitle';
        }
      }
    });
    if (!$('narrateStatus').textContent.startsWith('Stopped')) {
      narrateStatus(`Narrated ${spoken} scene${spoken === 1 ? '' : 's'} · ${narrationSeconds(ed.project).toFixed(1)}s of speech. Captions dropped to subtitles.`);
    }
  }
  mrNarrating = null;
  $('cancelNarrateBtn').hidden = true;
  $('narrateProgress').hidden = true;
  bar.style.width = '0%';
  void provider;
}

// Flip the whole reel between the two presentations. This is the setting that decides
// whether you are making a typography video or a video with people in it.
function setPresentation(mode) {
  commit(mode === 'people' ? 'picture-first' : 'words-first', (p) => {
    for (const scene of p.scenes) {
      if (scene.captionStyle === 'title' || scene.captionStyle === 'none') continue;
      scene.captionStyle = mode === 'people' ? 'subtitle' : 'kinetic';
      if (mode === 'people') {
        scene.intensity = Math.min(scene.intensity, 0.6);   // let the picture hold still
        scene.captionPosition = 'bottom';
      }
    }
    p.style.motionScale = mode === 'people' ? 0.6 : 1;
  });
}

function wireNarration() {
  const providerKeys = Object.keys(MR_VOICE_PROVIDERS);
  fillSelect($('voiceProvider'), providerKeys, providerKeys.map((k) => MR_VOICE_PROVIDERS[k].name));

  const setNarration = (label, changes) => commit(label, (p) => {
    p.narration = Object.assign({}, MR_DEFAULT_NARRATION, p.narration, changes);
  });

  $('voiceProvider').addEventListener('change', () => {
    if (ed.suppress) return;
    setNarration('set voice provider', { provider: $('voiceProvider').value, voice: '' });
  });
  $('voiceName').addEventListener('change', () => {
    if (ed.suppress) return;
    setNarration('set voice', { voice: $('voiceName').value });
  });
  $('voiceId').addEventListener('change', () => {
    if (ed.suppress) return;
    setNarration('set voice', { voice: $('voiceId').value.trim() });
  });
  $('voiceInstructions').addEventListener('change', () => {
    if (ed.suppress) return;
    setNarration('set delivery', { instructions: $('voiceInstructions').value });
  });
  $('voiceKey').addEventListener('change', () => {
    if (ed.suppress) return;
    storeKey('voice-' + narrationSettings().provider, $('voiceKey').value.trim());
  });
  bindRange('voiceGap', (p, v) => {
    p.narration = Object.assign({}, MR_DEFAULT_NARRATION, p.narration, { gap: v });
  }, (v) => { $('voiceGapValue').textContent = v.toFixed(2) + 's'; });
  bindRange('voiceDuck', (p, v) => {
    p.narration = Object.assign({}, MR_DEFAULT_NARRATION, p.narration, { duckMusic: v });
  }, (v) => { $('voiceDuckValue').textContent = Math.round(v * 100) + '%'; });

  $('narrateAllBtn').addEventListener('click', () => narrateScenes(ed.project.scenes.slice()));
  $('narrateOneBtn').addEventListener('click', () => {
    const scene = selectedScene();
    if (scene) narrateScenes([scene]);
  });
  $('cancelNarrateBtn').addEventListener('click', () => { if (mrNarrating) mrNarrating.abort(); });
  $('peopleModeBtn').addEventListener('click', () => setPresentation('people'));
  $('wordsModeBtn').addEventListener('click', () => setPresentation('words'));
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
  wirePanels();
  wireNarration();
  wireAnimate();

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
