// app.js — boot. Runs last, once every other script has defined its half of the app.

function reportExportSupport() {
  const el = document.getElementById('exportSupport');
  const mime = pickRecordingMime();
  if (mime === null) {
    el.textContent = 'This browser has no MediaRecorder, so video recording is unavailable — ' +
      'the captions, cover image and project file still export. Chrome, Edge, Firefox and Safari 14.1+ can record.';
    document.getElementById('exportBtn').disabled = true;
    document.getElementById('exportBtn2').disabled = true;
    return;
  }
  const container = mime.indexOf('mp4') !== -1 ? 'MP4' : 'WebM';
  el.textContent = `Recording as ${container} (${mime.split(';')[0]}). YouTube accepts both.`;
}

function bootMyRecital() {
  wireEditor();

  // Come back to whatever was on screen last time; fall back to the sample so the first
  // run shows a finished reel instead of an empty canvas.
  let restored = null;
  try {
    const raw = localStorage.getItem(MR_STORAGE_KEY);
    if (raw) restored = importProjectJSON(raw);
  } catch { restored = null; }

  if (restored) {
    ed.project = restored;
    document.getElementById('storyText').value = restored.source || '';
  } else {
    ed.project = buildStoryboard(MR_SAMPLE, { titleCard: true, fit: true, maxSeconds: MR_SHORTS_LIMIT });
    document.getElementById('storyText').value = MR_SAMPLE;
  }
  ed.selectedId = ed.project.scenes[0].id;
  // Reels open with a fade from black, so t=0 is a black frame. Park the playhead just
  // past the fade: the first thing you should see is a picture.
  ed.time = Math.min(0.6, totalDuration(ed.project) * 0.15);

  sizePreview();
  afterChange();
  reportExportSupport();
  // The first render can land before web fonts settle; repaint once they have.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawPreview());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootMyRecital);
else bootMyRecital();
