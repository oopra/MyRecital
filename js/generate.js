// generate.js — draw the panels instead of finding them.
//
// Commons gives you paintings somebody already made; this gives you a panel drawn for
// the beat in front of you, in one house style, with the same cast each time. That needs
// an image model, which needs a key, which is the one thing this app cannot supply.
//
// Three adapters, because the three providers differ in ways that matter:
//   • Gemini      — the only one that answers cross-origin browser calls, so it works
//                   with no backend at all. Key lives in this browser.
//   • OpenAI      — no browser CORS, so it goes through functions/api/image.js.
//   • Replicate   — same, plus it returns a URL rather than bytes, which the proxy
//                   resolves so a foreign image host can never taint the canvas.
//
// Everything the model returns is turned into a Blob and kept in IndexedDB: ten 1K panels
// is far more than localStorage's ~5MB, and the project file stays small and portable.

const MR_PANEL_DB = 'myrecital-panels';
const MR_PANEL_STORE = 'panels';

// ---------------------------------------------------------------- style

// The house style is one block of prompt text reused on every panel — that, far more than
// any per-panel wording, is what stops ten images looking like ten different comics.
const MR_ART_STYLES = {
  ack: {
    name: 'Amar Chitra Katha',
    prompt: 'Classic Indian mythological comic book art in the Amar Chitra Katha tradition: ' +
      'hand-painted gouache look, warm saturated colours, confident dark ink outlines, ' +
      'heroic naturalistic figures with expressive faces, richly patterned textiles and jewellery, ' +
      'painted scenic backgrounds, dramatic but uncluttered composition, flat even lighting'
  },
  tinkle: {
    name: 'Tinkle cartoon',
    prompt: 'Indian children\'s comic cartoon art in the Tinkle tradition: bold black ink outlines, ' +
      'flat bright cel colours, rounded friendly character designs with big expressive eyes, ' +
      'simple uncluttered backgrounds, cheerful and readable at small size'
  },
  inkwash: {
    name: 'Ink and wash',
    prompt: 'Ink and watercolour wash illustration: loose confident brush lines, limited muted palette, ' +
      'lots of negative space, painterly texture, storybook feel'
  },
  woodcut: {
    name: 'Block print',
    prompt: 'Indian folk block-print illustration: strong flat shapes, limited earthy palette, ' +
      'visible carved texture, decorative borders and motifs, stylised rather than realistic figures'
  }
};

// Appended to every prompt. Panels carry no lettering because the app draws the captions
// itself — a model's attempt at text inside the picture is both unreadable and off-brand.
const MR_PANEL_RULES = 'Single illustration, no speech bubbles, no captions, no lettering, no text of any kind, ' +
  'no watermark, no signature, no panel borders, no frame.';

const MR_DEFAULT_GENERATION = {
  provider: 'gemini',
  model: '',              // blank means "the adapter's default"
  style: 'ack',
  styleNotes: '',
  proxy: '/api/image',
  useCast: true
};

// ---------------------------------------------------------------- the cast

// Character consistency is the hard part of an illustrated sequence: the model has no
// memory between calls, so unless every prompt describes Arjuna the same way, you get a
// different Arjuna each panel. The cast is that shared description, written once.
function suggestCast(project) {
  // A title card is written in title case, so every word in it looks like a proper noun —
  // "The Question on the Field" would nominate "Question" and "Field" for your cast.
  // Skipping title scenes is the whole fix; filtering on the project title itself is not,
  // because a reel with no heading takes its title from the first beat, and that beat is
  // exactly where the real character names live.
  const counts = new Map();
  for (const scene of project.scenes) {
    if (scene.kind === 'title') continue;
    for (const name of mrProperNouns(scene.text || '')) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([name]) => ({ name, description: '' }));
}

// Only the characters actually named in this beat, so a two-person scene does not get a
// prompt describing everyone in the story.
function castForScene(scene, cast) {
  if (!cast || !cast.length) return [];
  const text = (scene.text || '').toLowerCase();
  return cast.filter((member) => member.name && text.indexOf(member.name.toLowerCase()) !== -1);
}

// Build the full prompt for one panel.
function panelPrompt(scene, project) {
  const generation = project.generation || MR_DEFAULT_GENERATION;
  const style = MR_ART_STYLES[generation.style] || MR_ART_STYLES.ack;
  const cast = generation.useCast ? castForScene(scene, project.cast || []) : [];
  const castLine = cast.length
    ? 'Characters, drawn exactly as described every time: ' +
      cast.map((c) => c.description ? `${c.name} — ${c.description}` : c.name).join('; ') + '.'
    : '';
  return [
    style.prompt + '.',
    generation.styleNotes,
    castLine,
    'Scene: ' + (scene.text || '').replace(/\s+/g, ' ').trim(),
    MR_PANEL_RULES
  ].filter(Boolean).join(' ');
}

function aspectForProject(project) {
  return (project.style && project.style.aspect) || '9:16';
}

// ---------------------------------------------------------------- adapters
//
// Each adapter takes { prompt, aspect, apiKey, model, reference } and resolves to
// { blob, mime }. They all surface the provider's own error text verbatim: this code
// cannot be tested against a live key here, so when a request shape is wrong the message
// has to say exactly what the provider objected to.

function mrBase64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/png' });
}

async function mrReadError(res) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = (json.error && (json.error.message || json.error)) || json.detail || json.message || text;
    } catch { detail = text; }
  } catch { /* nothing readable */ }
  return `${res.status} ${res.statusText}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`;
}

// Google Gemini. The only provider callable straight from the page, which is why it is
// the default: no proxy, no deploy, key stays in this browser.
const MR_GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MR_GEMINI_MODEL = 'gemini-3.1-flash-image';

async function generateWithGemini(request) {
  const input = [{ type: 'text', text: request.prompt }];
  // A reference image is how the cast stays recognisable between panels.
  if (request.reference) {
    input.push({ type: 'image', mime_type: request.reference.mime || 'image/png', data: request.reference.base64 });
  }
  const res = await fetch(MR_GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': request.apiKey },
    body: JSON.stringify({
      model: request.model || MR_GEMINI_MODEL,
      input,
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: request.aspect, image_size: '1K' }
    }),
    signal: request.signal
  });
  if (!res.ok) throw new Error('Gemini: ' + await mrReadError(res));
  const json = await res.json();
  const base64 = mrFindImageData(json);
  if (!base64) throw new Error('Gemini returned no image. Response keys: ' + Object.keys(json).join(', '));
  return { blob: mrBase64ToBlob(base64, 'image/jpeg'), mime: 'image/jpeg' };
}

// Providers move fields around between versions; rather than pin one path and break on the
// next release, walk the response for the first base64 image payload.
function mrFindImageData(node, depth) {
  const level = depth || 0;
  if (!node || level > 6) return null;
  if (typeof node === 'string') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = mrFindImageData(item, level + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    // The conventional carriers, in order of how specific they are.
    for (const key of ['b64_json', 'imageBytes', 'image_bytes']) {
      if (typeof node[key] === 'string' && node[key].length > 100) return node[key];
    }
    if (typeof node.data === 'string' && node.data.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(node.data.slice(0, 64))) {
      return node.data;
    }
    for (const key of Object.keys(node)) {
      const found = mrFindImageData(node[key], level + 1);
      if (found) return found;
    }
  }
  return null;
}

// OpenAI and Replicate cannot be called from a browser (no CORS), so both go through the
// project's own function, which also resolves Replicate's output URL into bytes.
async function generateViaProxy(request) {
  const res = await fetch(request.proxy || '/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: request.provider,
      model: request.model || '',
      prompt: request.prompt,
      aspect: request.aspect,
      reference: request.reference || null,
      // Sent only when the user chose to keep the key in the browser instead of the
      // server environment; the function prefers its own env var when it has one.
      apiKey: request.apiKey || undefined
    }),
    signal: request.signal
  });
  if (!res.ok) throw new Error(request.provider + ': ' + await mrReadError(res));
  const json = await res.json();
  if (!json.b64) throw new Error(request.provider + ' proxy returned no image: ' + JSON.stringify(json).slice(0, 200));
  return { blob: mrBase64ToBlob(json.b64, json.mime || 'image/png'), mime: json.mime || 'image/png' };
}

const MR_PROVIDERS = {
  gemini: { name: 'Google Gemini', direct: true, references: true, defaultModel: MR_GEMINI_MODEL, run: generateWithGemini },
  openai: { name: 'OpenAI gpt-image-1', direct: false, references: true, defaultModel: 'gpt-image-1', run: generateViaProxy },
  replicate: { name: 'Replicate (Flux)', direct: false, references: false, defaultModel: 'black-forest-labs/flux-1.1-pro', run: generateViaProxy }
};

function generatePanelImage(request) {
  const provider = MR_PROVIDERS[request.provider] || MR_PROVIDERS.gemini;
  return provider.run(Object.assign({}, request, { provider: request.provider }));
}

// ---------------------------------------------------------------- storage
//
// Panels are blobs, and ten of them blow past localStorage. IndexedDB holds the bytes;
// the project JSON only remembers that a panel exists and what prompt made it.

function mrOpenPanelDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MR_PANEL_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MR_PANEL_STORE)) db.createObjectStore(MR_PANEL_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
}

function mrPanelTx(mode, run) {
  return mrOpenPanelDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(MR_PANEL_STORE, mode);
    const store = tx.objectStore(MR_PANEL_STORE);
    let result;
    try { result = run(store); } catch (e) { reject(e); return; }
    tx.oncomplete = () => { db.close(); resolve(result && result.result !== undefined ? result.result : result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function savePanelBlob(id, blob) {
  return mrPanelTx('readwrite', (store) => store.put(blob, id));
}

function loadPanelBlob(id) {
  return mrPanelTx('readonly', (store) => {
    const request = store.get(id);
    return { get result() { return request.result; } };
  });
}

function deletePanelBlob(id) {
  return mrPanelTx('readwrite', (store) => store.delete(id));
}

// Turn a stored panel into something the renderer can draw. Registers the object URL in
// the same cache Commons pictures use, so render.js needs no idea where a picture came from.
function attachPanel(scene, blob) {
  const url = URL.createObjectURL(blob);
  return loadPicture(url).then((img) => {
    // A drawn panel already IS the look you asked for; the palette grade exists to make
    // found artwork agree with the reel, and on a cartoon it just mutes the ink. Lower it
    // — but only from the default, never over a value you set yourself.
    if (scene.pictureGrade === 0.28) scene.pictureGrade = 0.08;
    scene.picture = {
      src: url,
      title: 'Generated panel',
      artist: '',
      licence: 'Generated illustration',
      licenceClass: 'generated',
      source: 'generated',
      width: img.width,
      height: img.height
    };
    return scene.picture;
  });
}

// Re-attach every stored panel after a reload: the blobs survive in IndexedDB but their
// object URLs do not, so they have to be minted again.
async function restorePanels(project) {
  let restored = 0;
  for (const scene of project.scenes) {
    if (!scene.panel || !scene.panel.id) continue;
    try {
      const blob = await loadPanelBlob(scene.panel.id);
      if (blob) { await attachPanel(scene, blob); restored++; }
    } catch { /* a missing panel just falls back to the procedural background */ }
  }
  return restored;
}

// Generate one panel and store it. Returns the scene's new picture.
async function generatePanelFor(scene, project, opts) {
  const o = opts || {};
  const generation = Object.assign({}, MR_DEFAULT_GENERATION, project.generation);
  const prompt = panelPrompt(scene, project);
  const { blob, mime } = await generatePanelImage({
    provider: generation.provider,
    model: generation.model,
    apiKey: o.apiKey,
    proxy: generation.proxy,
    prompt,
    aspect: aspectForProject(project),
    reference: o.reference || null,
    signal: o.signal
  });
  const id = `${scene.id}-${Date.now().toString(36)}`;
  if (scene.panel && scene.panel.id) deletePanelBlob(scene.panel.id).catch(() => {});
  await savePanelBlob(id, blob);
  scene.panel = { id, prompt, provider: generation.provider, model: generation.model || MR_PROVIDERS[generation.provider].defaultModel, mime, at: Date.now() };
  return attachPanel(scene, blob);
}
