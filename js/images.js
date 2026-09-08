// images.js — illustrate scenes with public-domain artwork from Wikimedia Commons.
//
// Two things make this work without a backend, and both were verified before the code
// was written:
//   1. The Commons API answers anonymous cross-origin GETs when you pass `origin=*`.
//   2. The image hosts send `Access-Control-Allow-Origin: *`, so an <img crossOrigin>
//      does NOT taint the canvas — which matters enormously here, because a tainted
//      canvas makes captureStream() throw and the whole reel becomes unrecordable.
//
// Deliberately NO custom request headers: Commons' CORS preflight does not approve
// `Api-User-Agent`, so adding it (as their bot policy suggests) would break every
// request from the browser. A plain GET carrying the browser's own User-Agent is the
// documented path for in-browser tools.

const MR_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const MR_COMMONS_FILE = 'https://commons.wikimedia.org/wiki/';

// Licence codes come back in extmetadata.License. We only ever offer things that can
// actually be published: public domain and CC0 need no credit, CC-BY/CC-BY-SA do.
// Anything else (fair use, non-commercial, unknown) is dropped rather than shown with a
// warning nobody reads.
const MR_LICENCE_PUBLIC = ['pd', 'cc0', 'cc-pd', 'pd-us', 'pd-art'];
const MR_LICENCE_ATTRIBUTION = ['cc-by', 'cc-by-sa'];

function mrLicenceClass(code) {
  const c = String(code || '').toLowerCase();
  if (MR_LICENCE_PUBLIC.some((p) => c === p || c.startsWith(p + '-'))) return 'public';
  if (MR_LICENCE_ATTRIBUTION.some((p) => c === p || c.startsWith(p + '-'))) return 'attribution';
  return 'restricted';
}

// extmetadata values are HTML fragments (artist names are usually links). Strip to text
// for display, and never inject them as markup anywhere.
function mrStripHtml(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = String(html);
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  // Commons often nests the same name twice (link text inside a titled span), which
  // strips to "Unknown authorUnknown author". Collapse an exact doubling.
  const half = text.length / 2;
  if (text.length > 6 && text.length % 2 === 0 && text.slice(0, half) === text.slice(half)) {
    return text.slice(0, half);
  }
  return text;
}

// What a scanned book page looks like in metadata. These dominate Commons search results
// for narrative queries — a page of a 1904 journal is not an illustration for your reel.
const MR_NOT_ART = /scanned|djvu|\bpdf\b|google books|title page|\bvolume\b|\bpage \d|book cover|dust jacket|letterhead|logos?\b|\bmaps?\b|diagram|chart|coat of arms|postage stamp|banknote|screenshot|\bflags?\b|\bcoins?\b/i;
// What actual artwork looks like.
const MR_IS_ART = /painting|paintings|artwork|oleograph|lithograph|chromolithograph|illustration|drawing|watercolou?r|engraving|woodcut|mural|fresco|miniature|sculpture|relief|temple art|folk art/i;

// A library-catalogue byline ("Sarkar, Benoy Kumar, 1887-1949") means the file came out
// of a scanned book, not off a wall. Observed in the wild, hence the rule.
const MR_CATALOGUE_AUTHOR = /^[A-Z][a-z]+,\s+[A-Z][a-z]+.*\b1[6-9]\d{2}\b/;

// Rank a candidate as artwork. Negative means "never show this"; MR_ART_CONFIDENT or
// better means "safe to choose automatically".
const MR_ART_CONFIDENT = 3;
function mrArtScore(picture, categories) {
  const haystack = [picture.title, categories.join(' '), picture.credit || ''].join(' ');
  if (MR_NOT_ART.test(haystack)) return -1;
  if (MR_CATALOGUE_AUTHOR.test(picture.artist || '')) return -1;
  let score = 0;
  if (MR_IS_ART.test(haystack)) score += MR_ART_CONFIDENT;
  if (picture.artist) score += 1;
  if (picture.width >= 700) score += 1;
  // Very wide or very tall files are usually scans of spreads or scrolls, not scenes.
  const ratio = picture.width && picture.height ? picture.width / picture.height : 1;
  if (ratio > 2.6 || ratio < 0.32) score -= 2;
  return score;
}

function mrMetaValue(extmetadata, key) {
  const entry = extmetadata && extmetadata[key];
  return entry && entry.value != null ? entry.value : '';
}

// Turn one API page into the flat record the rest of the app stores on a scene.
function mrPictureFromPage(page) {
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const licenceCode = mrMetaValue(meta, 'License');
  const title = String(page.title || '').replace(/^File:/, '').replace(/\.(jpe?g|png|gif|tiff?|webp|svg)$/i, '');
  return {
    // `src` is what the renderer draws: the 1200px thumbnail, not the 40MB original.
    src: info.thumburl || info.url,
    full: info.url,
    width: info.thumbwidth || info.width,
    height: info.thumbheight || info.height,
    title: mrStripHtml(mrMetaValue(meta, 'ObjectName')) || title,
    artist: mrStripHtml(mrMetaValue(meta, 'Artist')),
    date: mrStripHtml(mrMetaValue(meta, 'DateTimeOriginal')).slice(0, 40),
    licence: mrStripHtml(mrMetaValue(meta, 'LicenseShortName')) || licenceCode,
    licenceCode,
    licenceClass: mrLicenceClass(licenceCode),
    licenceUrl: mrMetaValue(meta, 'LicenseUrl'),
    page: info.descriptionurl || (MR_COMMONS_FILE + encodeURIComponent(String(page.title || '').replace(/ /g, '_'))),
    source: 'commons'
  };
}

// Parse a Commons response. Handles both formatversion shapes (array in v2, keyed object
// in v1) so a stray `formatversion` change can't silently return nothing.
function parseCommonsResults(json, opts) {
  const o = opts || {};
  const query = json && json.query;
  if (!query || !query.pages) return [];
  const pages = Array.isArray(query.pages) ? query.pages : Object.keys(query.pages).map((k) => query.pages[k]);
  const out = [];
  pages.forEach((page, rank) => {
    const picture = mrPictureFromPage(page);
    if (!picture || !picture.src) return;
    if (picture.licenceClass === 'restricted') return;                   // never offer it
    if (o.publicDomainOnly && picture.licenceClass !== 'public') return;
    // Tiny files look like thumbnails of thumbnails once blown up to 1080 wide.
    if (picture.width && picture.width < 380) return;
    const categories = (page.categories || []).map((c) => String(c.title || '').replace(/^Category:/, ''));
    const score = mrArtScore(picture, categories);
    if (score < 0) return;                                               // a scanned page, not art
    picture.artScore = score;
    out.push({ picture, score, rank });
  });
  // Artwork first, and within the same score keep Commons' own relevance order.
  out.sort((a, b) => b.score - a.score || a.rank - b.rank);
  return out.map((entry) => entry.picture);
}

// Search Commons. Resolves to a (possibly empty) array; rejects only on a real network
// or HTTP failure, so callers can tell "nothing found" from "we couldn't ask".
function searchCommons(query, opts) {
  const o = opts || {};
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',                       // anonymous CORS
    generator: 'search',
    gsrsearch: query + ' filetype:bitmap',
    gsrnamespace: '6',                 // File: namespace
    gsrlimit: String(o.limit || 12),
    prop: 'imageinfo|categories',
    cllimit: '30',
    clshow: '!hidden',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: String(o.width || 1200)
  });
  return fetch(`${MR_COMMONS_API}?${params.toString()}`, { signal: o.signal, credentials: 'omit' })
    .then((res) => res.text().then((body) => ({ res, body })))
    .then(({ res, body }) => {
      // Commons answers a rate limit with a plain-text body, not JSON. Say so plainly
      // instead of surfacing "Unexpected token Y in JSON".
      if (res.status === 429 || /too many requests|rate limit/i.test(body.slice(0, 200))) {
        const err = new Error('Wikimedia is rate-limiting these searches — wait a moment and try again.');
        err.rateLimited = true;
        throw err;
      }
      if (!res.ok) throw new Error(`Commons search failed (HTTP ${res.status})`);
      try {
        return JSON.parse(body);
      } catch {
        throw new Error('Commons returned something that was not JSON.');
      }
    })
    .then((json) => parseCommonsResults(json, o));
}

// ---------------------------------------------------------------- picking a query

// Words that are proper nouns in the middle of a sentence, which for narrative prose is
// almost exactly "the people and places in this beat" — the thing worth illustrating.
// Words that begin sentences all the time and are never anybody's name. Without this
// list, the only safe rule is "ignore the first word of every sentence" — and that loses
// the main character of any story written as "Aruna looked up. Aruna said...", which is
// most stories.
const MR_SENTENCE_OPENERS = new Set(('the a an and but or so then now when while after before if as at in on by for ' +
  'from with he she it they we i you his her their its our my that this these those there here one two no not all ' +
  'some every each both many most later meanwhile suddenly finally once again still yet even only just up down out ' +
  'over under into above below far near long soon next first last high low deep dark light cold warm old young ' +
  'good great small big new nobody nothing everyone someone what who where why how because though although since ' +
  'until unless whether perhaps maybe of to').split(' '));

function mrProperNouns(text) {
  // A capital in the MIDDLE of a sentence is strong evidence of a proper noun. A capital
  // at the START is weak evidence — worth counting, but only when the word is not one of
  // the ordinary words sentences begin with.
  const evidence = new Map();
  for (const sentence of String(text).split(/(?<=[.!?])\s+/)) {
    const trimmed = sentence.trim();
    const words = trimmed.match(/[A-Z][a-zA-Z'À-ɏ]{2,}/g) || [];
    const opener = (trimmed.match(/^[A-Z][a-zA-Z'À-ɏ]{2,}/) || [])[0];
    words.forEach((word, i) => {
      const isOpener = i === 0 && word === opener;
      const weak = isOpener && MR_SENTENCE_OPENERS.has(word.toLowerCase());
      const seen = evidence.get(word) || 0;
      // Mid-sentence capitals score 2, sentence openers 1, ordinary opening words 0 —
      // so a real name outranks a "Then" even if "Then" appears more often.
      evidence.set(word, seen + (weak ? 0 : (isOpener ? 1 : 2)));
    });
  }
  return [...evidence.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
}

// Build the search string for a scene: its proper nouns, else its emphasis words, plus
// whatever standing hint the user gave for the whole reel ("Mahabharata painting").
function imageQueryFor(scene, project) {
  const hint = (project && project.style && project.style.imageHint) || '';
  const names = mrProperNouns(scene.text || '').slice(0, 3);
  const terms = names.length ? names : (scene.emphasis || []).slice(0, 2);
  return [terms.join(' '), hint].filter(Boolean).join(' ').trim() || (scene.text || '').slice(0, 60);
}

// ---------------------------------------------------------------- credit

function creditLine(picture) {
  if (!picture || picture.source === 'generated') return '';
  const bits = [picture.title];
  if (picture.artist) bits.push(picture.artist);
  if (picture.date) bits.push(picture.date);
  return `${bits.filter(Boolean).join(' — ')} (${picture.licence || 'unknown licence'}), via Wikimedia Commons`;
}

// One credit per distinct picture, in scene order. CC-BY/CC-BY-SA pictures legally
// require this in the description; public-domain ones are courtesy, and cost nothing.
function projectCredits(project) {
  const seen = new Set();
  const out = [];
  for (const scene of project.scenes) {
    if (!scene.picture || scene.picture.source === 'generated') continue;
    if (seen.has(scene.picture.src)) continue;
    seen.add(scene.picture.src);
    const line = creditLine(scene.picture);
    if (line) out.push(line);
  }
  return out;
}

function projectNeedsAttribution(project) {
  return project.scenes.some((s) => s.picture && s.picture.licenceClass === 'attribution');
}

// ---------------------------------------------------------------- the image cache
//
// renderFrame() is synchronous and pure, and must stay that way — it is what makes the
// preview, the scrubber and the recorder agree. So loading lives out here: images are
// warmed into this cache, and the renderer only ever does a synchronous lookup. A scene
// whose picture has not arrived yet simply draws its procedural background, which means
// a slow network degrades the look rather than breaking the render.

const mrImageCache = new Map();   // src -> { status: 'loading'|'ready'|'failed', img }

function pictureImage(src) {
  const entry = src && mrImageCache.get(src);
  return entry && entry.status === 'ready' ? entry.img : null;
}

function loadPicture(src) {
  if (!src) return Promise.reject(new Error('no image source'));
  const existing = mrImageCache.get(src);
  if (existing && existing.status === 'ready') return Promise.resolve(existing.img);
  if (existing && existing.promise) return existing.promise;

  const img = new Image();
  // Required: without it the image loads but poisons the canvas, and captureStream()
  // throws a SecurityError the moment you try to record.
  img.crossOrigin = 'anonymous';
  const promise = new Promise((resolve, reject) => {
    img.onload = () => { mrImageCache.set(src, { status: 'ready', img }); resolve(img); };
    img.onerror = () => { mrImageCache.set(src, { status: 'failed', img: null }); reject(new Error('Could not load ' + src)); };
  });
  mrImageCache.set(src, { status: 'loading', img: null, promise });
  img.src = src;
  return promise;
}

// Warm every picture in the project. Never rejects: a failed image is reported in the
// result so the UI can say which one, while the rest of the reel carries on.
function preloadPictures(project, onProgress) {
  const sources = [];
  for (const scene of project.scenes) {
    if (scene.picture && scene.picture.src && sources.indexOf(scene.picture.src) === -1) sources.push(scene.picture.src);
  }
  let done = 0;
  const failed = [];
  return Promise.all(sources.map((src) =>
    loadPicture(src)
      .catch(() => { failed.push(src); })
      .then(() => { done++; if (onProgress) onProgress(done / sources.length, done, sources.length); })
  )).then(() => ({ total: sources.length, failed }));
}
