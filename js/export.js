// export.js — turn the storyboard into files you can actually upload.
//
// Recording is real-time: the same renderFrame() the preview uses paints an
// export-resolution canvas, captureStream() feeds MediaRecorder, and the procedural score
// is mixed in through a MediaStreamAudioDestination. Real-time is the honest trade here —
// a faster-than-real-time path would have to drop the live audio graph, and a 60-second
// Short takes 60 seconds either way on the machines this runs on.

// Browsers disagree about container and codec support; ask rather than assume.
const MR_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
];

function pickRecordingMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MR_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function mrExtensionFor(mime) {
  return mime && mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
}

// A bitrate that survives YouTube's re-encode without producing a 200MB file for a
// 40-second reel. Scales with pixel count so 1:1 and 16:9 get their fair share.
function mrBitrateFor(width, height, fps) {
  const perPixel = 0.09;
  return Math.round(width * height * fps * perPixel);
}

function mrSafeName(title, ext) {
  const base = (title || 'myrecital').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'myrecital';
  return `${base}.${ext}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadText(text, filename, type) {
  downloadBlob(new Blob([text], { type: type || 'text/plain;charset=utf-8' }), filename);
}

// Record the whole reel. `onProgress(fraction, seconds)` is called each frame so the UI
// can show a real progress bar; the returned promise resolves with { blob, mime, ext }.
// Record the reel. Pictures are warmed first: starting the recorder before they load
// would burn the fallback background into the opening seconds and then pop.
function exportVideo(project, opts) {
  const o = opts || {};
  return preloadPictures(project).then(() => new Promise((resolve, reject) => {
    const mime = pickRecordingMime();
    if (mime === null) { reject(new Error('This browser cannot record video (no MediaRecorder).')); return; }

    const dim = dimensionsOf(project);
    const scale = o.scale || 1;
    const width = Math.round(dim.w * scale / 2) * 2;   // even dimensions keep encoders happy
    const height = Math.round(dim.h * scale / 2) * 2;
    const fps = project.style.fps || 30;
    const total = totalDuration(project);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!canvas.captureStream) { reject(new Error('This browser cannot capture a canvas stream.')); return; }
    const stream = canvas.captureStream(fps);

    // Mix in the score. If audio is off or unsupported we simply record a silent video.
    let audioStarted = false;
    const hasNarration = project.scenes.some((s) => s.narration);
    const wantsAudio = (project.audio && project.audio.enabled) || hasNarration;
    if (wantsAudio) {
      const audioStream = mrAudioStream();
      if (audioStream) for (const track of audioStream.getAudioTracks()) stream.addTrack(track);
    }

    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime || undefined,
        videoBitsPerSecond: mrBitrateFor(width, height, fps)
      });
    } catch (err) { reject(err); return; }

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onerror = (e) => { cancelled = true; reject(e.error || new Error('Recording failed.')); };
    recorder.onstop = () => {
      mrAudioStop();
      for (const track of stream.getTracks()) track.stop();
      if (cancelled) { resolve(null); return; }
      resolve({ blob: new Blob(chunks, { type: mime || 'video/webm' }), mime: mime || 'video/webm', ext: mrExtensionFor(mime) });
    };

    let cancelled = false;
    if (o.signal) o.signal.addEventListener('abort', () => {
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
    });

    recorder.start(250);
    if (wantsAudio) audioStarted = mrAudioPlay(project, 0);

    // Drive frames off the wall clock so the video and the audio graph stay locked, even
    // if a heavy frame makes us miss a vsync.
    const started = performance.now();
    const drawScale = width / dim.w;
    function frame() {
      if (cancelled) return;
      const t = (performance.now() - started) / 1000;
      ctx.save();
      ctx.scale(drawScale, drawScale);
      renderFrame(ctx, project, Math.min(t, total), { width: dim.w, height: dim.h });
      ctx.restore();
      if (o.onProgress) o.onProgress(Math.min(1, t / total), Math.min(t, total));
      if (t >= total) {
        // One extra beat so the encoder flushes the final frame and the fade-out lands.
        setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 250);
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if (!audioStarted) mrAudioStop();
  }));
}

// A still, at full export resolution — the cover image for the upload, or a thumbnail
// pulled from whichever moment the scrubber is parked on.
function exportStill(project, t) {
  const dim = dimensionsOf(project);
  return preloadPictures(project).then(() => new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = dim.w;
    canvas.height = dim.h;
    renderFrame(canvas.getContext('2d'), project, t, { width: dim.w, height: dim.h });
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  }));
}

// The project file: plain JSON, so a reel can be re-opened, diffed, or handed to someone
// else without shipping any media.
function exportProjectJSON(project) {
  return JSON.stringify(project, null, 2);
}

function importProjectJSON(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.scenes) || !data.scenes.length) throw new Error('Not a MyRecital project (no scenes).');
  const project = {
    version: 1,
    title: data.title || 'Untitled',
    source: data.source || '',
    style: Object.assign({}, MR_DEFAULT_STYLE, data.style),
    audio: Object.assign({}, MR_DEFAULT_AUDIO, data.audio),
    generation: Object.assign({}, typeof MR_DEFAULT_GENERATION !== 'undefined' ? MR_DEFAULT_GENERATION : {}, data.generation),
    narration: Object.assign({}, typeof MR_DEFAULT_NARRATION !== 'undefined' ? MR_DEFAULT_NARRATION : {}, data.narration),
    cast: Array.isArray(data.cast) ? data.cast : [],
    scenes: data.scenes.map((scene) => Object.assign(makeScene(scene.text || '', {
      mood: scene.mood, background: scene.background, motion: scene.motion, transition: scene.transition,
      captionStyle: scene.captionStyle, captionPosition: scene.captionPosition, emphasis: scene.emphasis,
      accent: scene.accent, intensity: scene.intensity, duration: scene.duration, seed: scene.seed, kind: scene.kind,
      picture: scene.picture, pictureFit: scene.pictureFit, pictureFocus: scene.pictureFocus, pictureGrade: scene.pictureGrade,
      panel: scene.panel, narration: scene.narration
    }), { id: scene.id || undefined }))
  };
  for (const scene of project.scenes) if (!scene.id) scene.id = mrSceneId();
  return project;
}
