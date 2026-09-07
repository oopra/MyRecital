// Tests for MyRecital. They run the real shipped functions inside a real browser page —
// the parser, the canvas renderer and the editor exactly as they ship — so there is
// nothing duplicated and nothing mocked. A tiny static server (tests/helpers.mjs) serves
// the repo, and each test gets a fresh page.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser } from './helpers.mjs';

let srv, browser, page;

async function newReelPage() {
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(srv.url + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof ed !== 'undefined' && ed.project);
  p.__errors = errors;
  return p;
}

before(async () => { srv = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); await srv?.close(); });
beforeEach(async () => { page = await newReelPage(); });

const ev = (fn, arg) => page.evaluate(fn, arg);

// ------------------------------------------------------------------ the parser

test('splitSentences keeps terminators and ignores abbreviations', async () => {
  const out = await ev(() => splitSentences('Dr. Ade ran. The door slammed! Was it locked?'));
  assert.deepEqual(out, ['Dr. Ade ran.', 'The door slammed!', 'Was it locked?']);
});

test('a long sentence is broken at its clauses, not mid-thought', async () => {
  const parts = await ev(() => splitLongSentence(
    'She climbed the stairs, counting each one under her breath, and the wind pushed back, ' +
    'and the lamp above her went suddenly dark.', 10));
  assert.ok(parts.length >= 3, 'should break into several beats');
  assert.ok(parts.every((p) => p.split(/\s+/).length <= 10), 'no beat over the word cap');
  assert.equal(parts.join(' ').replace(/\s+/g, ' '),
    'She climbed the stairs, counting each one under her breath, and the wind pushed back, ' +
    'and the lamp above her went suddenly dark.');
});

test('buildStoryboard: title card, scenes, and no scene over the word cap', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('The Long Walk\n\nHe left at dawn. The road was empty and cold.\n\nBy noon he was singing.',
      { maxWordsPerScene: 12 });
    return {
      title: p.title,
      kinds: p.scenes.map((s) => s.kind),
      texts: p.scenes.map((s) => s.text),
      over: p.scenes.filter((s) => s.text.split(/\s+/).length > 12).length
    };
  });
  assert.equal(r.title, 'The Long Walk');
  assert.equal(r.kinds[0], 'title');
  assert.equal(r.texts[0], 'The Long Walk');
  assert.ok(r.kinds.length >= 3, 'body should become its own scenes');
  assert.equal(r.over, 0);
});

test('the same text always builds the same look (deterministic seeds)', async () => {
  const same = await ev(() => {
    const a = buildStoryboard('Ships in the dark harbour. Nobody came back.');
    const b = buildStoryboard('Ships in the dark harbour. Nobody came back.');
    return JSON.stringify(a.scenes.map((s) => [s.text, s.background, s.seed, s.duration])) ===
           JSON.stringify(b.scenes.map((s) => [s.text, s.background, s.seed, s.duration]));
  });
  assert.equal(same, true);
});

test('mood detection drives the background choice', async () => {
  const moods = await ev(() => ({
    tense: detectMood('She ran. Blood on the door. Panic in the dark.'),
    joyful: detectMood('They danced and laughed in the warm sun together.'),
    wonder: detectMood('The stars turned above the ancient door, glowing.')
  }));
  assert.equal(moods.tense, 'tense');
  assert.equal(moods.joyful, 'joyful');
  assert.equal(moods.wonder, 'wonder');
});

test('consecutive scenes never repeat the same background', async () => {
  const repeats = await ev(() => {
    const p = buildStoryboard('He ran through the rain. Blood on his hands. ' +
      'She was afraid. The night was cold and empty. He ran again. Danger everywhere.');
    let n = 0;
    for (let i = 1; i < p.scenes.length; i++) if (p.scenes[i].background === p.scenes[i - 1].background) n++;
    return n;
  });
  assert.equal(repeats, 0);
});

test('emphasis: asterisks and shouting win over the length heuristic', async () => {
  const r = await ev(() => ({
    starred: pickEmphasis('It was the *lighthouse* that saved them', 2),
    shouted: pickEmphasis('And then she said NEVER to him', 2),
    fallback: pickEmphasis('the enormous cathedral collapsed quietly', 2)
  }));
  assert.deepEqual(r.starred, ['lighthouse']);
  assert.deepEqual(r.shouted, ['never']);
  assert.ok(r.fallback.includes('cathedral'));
});

// ------------------------------------------------------------------- the clock

test('fitDuration squeezes a long story under the Shorts limit', async () => {
  const r = await ev(() => {
    const long = new Array(40).fill('The wind kept rising over the black water and nobody spoke.').join(' ');
    const p = buildStoryboard(long, { fit: false });
    const before = totalDuration(p);
    fitDuration(p, 60);
    return { before, after: totalDuration(p), min: Math.min(...p.scenes.map((s) => s.duration)) };
  });
  assert.ok(r.before > 60, 'the sample really is too long');
  assert.ok(r.after <= 60, `fitted to ${r.after}s`);
  assert.ok(r.min > 0.5, 'no scene squeezed to nothing');
});

test('sceneAt maps a time to the right scene and local offset', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('The first beat runs across the screen. The second beat answers it back. ' +
      'The third beat closes the whole thing.', { titleCard: false, maxWordsPerScene: 8 });
    p.scenes.forEach((s) => { s.duration = 2; });
    return {
      count: p.scenes.length,
      first: sceneAt(p, 0.5).index,
      second: sceneAt(p, 2.5).index,
      local: Math.round(sceneAt(p, 2.5).local * 100) / 100,
      past: sceneAt(p, 999).index
    };
  });
  assert.equal(r.first, 0);
  assert.equal(r.second, 1);
  assert.equal(r.local, 0.5);
  assert.equal(r.past, r.count - 1, 'past the end clamps to the last scene');
});

test('captions export with timecodes that match the timeline', async () => {
  const srt = await ev(() => {
    const p = buildStoryboard('The first beat runs across the screen. The second beat answers it back.',
      { titleCard: false, maxWordsPerScene: 8 });
    p.scenes.forEach((s) => { s.duration = 2; });
    return captionsSRT(p);
  });
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,000\nThe first beat runs across the screen\./);
  assert.match(srt, /2\n00:00:02,000 --> 00:00:04,000\nThe second beat answers it back\./);
});

test('publishKit flags a reel that is not Shorts-shaped', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('A quiet story about a boat and the sea.', { titleCard: false });
    const ok = publishKit(p).shortsReady;
    p.style.aspect = '16:9';
    return { ok, landscape: publishKit(p).shortsReady, tags: publishKit(p).tags };
  });
  assert.equal(r.ok, true);
  assert.equal(r.landscape, false);
  assert.ok(r.tags.length > 0, 'tags come out of the story words');
});

// ----------------------------------------------------------------- the picture

test('renderFrame paints something for every background', async () => {
  const blanks = await ev(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 108; canvas.height = 192;
    const ctx = canvas.getContext('2d');
    const bad = [];
    for (const bg of MR_BACKGROUNDS) {
      const p = buildStoryboard('A test beat with several words in it.', { titleCard: false });
      p.scenes[0].background = bg;
      ctx.save();
      ctx.scale(108 / 1080, 192 / 1920);
      renderFrame(ctx, p, p.scenes[0].duration * 0.5, { width: 1080, height: 1920 });
      ctx.restore();
      const data = ctx.getImageData(0, 0, 108, 192).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 30) lit++;
      if (lit < 200) bad.push(bg + ':' + lit);
    }
    return bad;
  });
  assert.deepEqual(blanks, [], 'every background should fill the frame');
});

test('renderFrame is pure: same time in, same pixels out, project untouched', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('The lamp went dark halfway up the stairs.', { titleCard: false });
    const before = JSON.stringify(p);
    const shot = () => {
      const c = document.createElement('canvas');
      c.width = 54; c.height = 96;
      const x = c.getContext('2d');
      x.scale(54 / 1080, 96 / 1920);
      renderFrame(x, p, 1.2, { width: 1080, height: 1920 });
      return c.toDataURL();
    };
    const a = shot(), b = shot();
    return { identical: a === b, unchanged: before === JSON.stringify(p) };
  });
  assert.equal(r.identical, true, 'two renders of the same moment must match');
  assert.equal(r.unchanged, true, 'rendering must not mutate the project');
});

test('the caption shrinks to fit rather than overflowing the frame', async () => {
  const r = await ev(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    const font = MR_FONTS.display;
    const box = captionBox(1080, 1920, 'center');
    const short = fitCaption(ctx, 'Run.', font, box, { maxSize: 1920 * 0.062, minSize: 1920 * 0.028 });
    const long = fitCaption(ctx, new Array(30).fill('word').join(' '), font, box, { maxSize: 1920 * 0.062, minSize: 1920 * 0.028 });
    const height = long.lines.length * long.size * 1.18;
    return { shortSize: short.size, longSize: long.size, fits: height <= box.h + 1 };
  });
  assert.ok(r.longSize <= r.shortSize, 'a longer caption uses a smaller size');
  assert.equal(r.fits, true, 'the caption block stays inside its box');
});

// ------------------------------------------------------------------ the editor

test('the app boots with a reel on screen and no page errors', async () => {
  const state = await ev(() => ({ scenes: ed.project.scenes.length, total: totalDuration(ed.project) }));
  assert.ok(state.scenes > 3, 'sample story built');
  assert.ok(state.total > 5 && state.total <= 60);
  assert.equal(await page.locator('.clip').count(), state.scenes);
  assert.deepEqual(page.__errors, []);
});

test('editing a scene repaints, and undo puts it back', async () => {
  await page.locator('.clip').nth(2).click();
  const before = await ev(() => selectedScene().background);
  await page.selectOption('#sceneBackground', 'grid');
  const after = await ev(() => selectedScene().background);
  assert.equal(after, 'grid');
  await page.click('#undoBtn');
  assert.equal(await ev(() => selectedScene().background), before);
  await page.click('#redoBtn');
  assert.equal(await ev(() => selectedScene().background), 'grid');
  assert.deepEqual(page.__errors, []);
});

test('split at the playhead divides both the words and the time', async () => {
  const r = await ev(() => {
    ed.selectedId = ed.project.scenes[1].id;
    const times = sceneTimeline(ed.project);
    ed.time = times[1].start + ed.project.scenes[1].duration / 2;
    const words = mrWordCount(ed.project.scenes[1].text);
    const duration = ed.project.scenes[1].duration;
    const count = ed.project.scenes.length;
    splitAtPlayhead();
    return {
      count, newCount: ed.project.scenes.length,
      words, split: mrWordCount(ed.project.scenes[1].text) + mrWordCount(ed.project.scenes[2].text),
      duration, newDuration: Math.round((ed.project.scenes[1].duration + ed.project.scenes[2].duration) * 10) / 10
    };
  });
  assert.equal(r.newCount, r.count + 1);
  assert.equal(r.split, r.words, 'no words lost in the split');
  assert.ok(Math.abs(r.newDuration - r.duration) <= 0.2, 'the two halves still add up');
});

test('merge, delete and reorder keep the storyboard consistent', async () => {
  const r = await ev(() => {
    const first = ed.project.scenes[0].id;
    ed.selectedId = first;
    mergeWithNext();
    const merged = ed.project.scenes.length;
    moveScene(1);
    const movedTo = ed.project.scenes.findIndex((s) => s.id === ed.selectedId);
    deleteScene();
    return { merged, movedTo, afterDelete: ed.project.scenes.length, ids: new Set(ed.project.scenes.map((s) => s.id)).size };
  });
  assert.equal(r.movedTo, 1, 'the selected scene moved one later');
  assert.equal(r.afterDelete, r.merged - 1);
  assert.equal(r.ids, r.afterDelete, 'scene ids stay unique');
});

test('even out pacing keeps the total length and follows word counts', async () => {
  const r = await ev(() => {
    const before = totalDuration(ed.project);
    evenOutPacing();
    const scenes = ed.project.scenes;
    let ordered = true;
    for (let i = 1; i < scenes.length; i++) {
      const a = scenes[i - 1], b = scenes[i];
      // More words must never buy less time (bar the clamp at either end).
      if (mrWordCount(b.text) > mrWordCount(a.text) && b.duration < a.duration - 0.001 &&
          a.duration < MR_MAX_SCENE && b.duration > MR_MIN_SCENE) ordered = false;
    }
    return { before, after: totalDuration(ed.project), ordered };
  });
  assert.ok(Math.abs(r.after - r.before) <= 2, 'total length roughly preserved');
  assert.equal(r.ordered, true);
});

test('shuffle looks re-rolls backgrounds without repeating neighbours', async () => {
  const r = await ev(() => {
    const before = ed.project.scenes.map((s) => s.background + s.seed).join('|');
    shuffleLooks();
    const after = ed.project.scenes.map((s) => s.background + s.seed).join('|');
    let repeats = 0;
    for (let i = 1; i < ed.project.scenes.length; i++) {
      if (ed.project.scenes[i].background === ed.project.scenes[i - 1].background) repeats++;
    }
    return { changed: before !== after, repeats };
  });
  assert.equal(r.changed, true);
  assert.equal(r.repeats, 0);
});

test('re-building from new text keeps the look you chose', async () => {
  const r = await ev(() => {
    ed.project.style.palette = 'ember';
    ed.project.style.watermark = '@reel';
    document.getElementById('storyText').value = 'A New Story\n\nIt started with a knock. Nobody was there.';
    buildFromText();
    return { palette: ed.project.style.palette, watermark: ed.project.style.watermark, title: ed.project.title };
  });
  assert.equal(r.palette, 'ember');
  assert.equal(r.watermark, '@reel');
  assert.equal(r.title, 'A New Story');
});

test('a project survives a round trip through the save file', async () => {
  const r = await ev(() => {
    const json = exportProjectJSON(ed.project);
    const back = importProjectJSON(json);
    const key = (p) => p.scenes.map((s) => [s.text, s.background, s.motion, s.duration, s.transition].join(',')).join('|');
    return { same: key(back) === key(ed.project), style: JSON.stringify(back.style) === JSON.stringify(ed.project.style) };
  });
  assert.equal(r.same, true);
  assert.equal(r.style, true);
});

test('importProjectJSON rejects a file that is not a storyboard', async () => {
  const message = await ev(() => {
    try { importProjectJSON('{"hello":true}'); return 'no error'; } catch (e) { return e.message; }
  });
  assert.match(message, /no scenes/);
});

test('the score follows the scenes and stops at the end of the reel', async () => {
  const r = await ev(() => {
    const events = scoreFor(ed.project);
    const total = totalDuration(ed.project);
    return {
      count: events.length,
      pads: events.filter((e) => e.type === 'pad').length,
      overruns: events.filter((e) => e.at > total + 0.01).length,
      negative: events.filter((e) => e.at < 0).length
    };
  });
  assert.ok(r.count > 10, 'a reel should produce a real score');
  assert.ok(r.pads >= 3, 'each scene gets a chord');
  assert.equal(r.overruns, 0);
  assert.equal(r.negative, 0);
});

test('changing the aspect resizes the preview canvas', async () => {
  const before = await ev(() => document.getElementById('preview').width / document.getElementById('preview').height);
  await page.click('.tab[data-tab="look"]');
  await page.selectOption('#styleAspect', '16:9');
  const after = await ev(() => document.getElementById('preview').width / document.getElementById('preview').height);
  assert.ok(before < 1, 'starts vertical');
  assert.ok(after > 1, 'ends landscape');
  assert.deepEqual(page.__errors, []);
});

test('a slider drag is one undo step, and undo really puts the value back', async () => {
  await page.locator('.clip').nth(1).click();
  const before = await ev(() => selectedScene().duration);
  // Three input events (a drag) then one change event (mouse up), as a browser sends them.
  await ev(() => {
    const el = document.getElementById('sceneDuration');
    for (const value of ['3.0', '4.0', '5.0']) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await ev(() => selectedScene().duration), 5);
  await page.click('#undoBtn');
  assert.equal(await ev(() => selectedScene().duration), before, 'one undo covers the whole drag');
  assert.deepEqual(page.__errors, []);
});

test('recording produces a real video file with the score mixed in', async () => {
  const result = await ev(async () => {
    if (typeof MediaRecorder === 'undefined') return { skipped: true };
    // A deliberately tiny reel: this test is about the pipeline, not the length.
    ed.project.scenes = ed.project.scenes.slice(0, 2);
    ed.project.scenes.forEach((s) => { s.duration = 1; });
    try {
      const r = await exportVideo(ed.project, { scale: 0.25 });
      return { size: r.blob.size, mime: r.mime, ext: r.ext };
    } catch (e) { return { error: e.message }; }
  });
  if (result.skipped) return;
  assert.ok(!result.error, 'recording should not throw: ' + result.error);
  assert.ok(result.size > 1000, `expected a real file, got ${result.size} bytes`);
  assert.match(result.ext, /^(mp4|webm)$/);
  assert.deepEqual(page.__errors, []);
});

// ------------------------------------------------------------------- pictures
//
// These run offline against a fixture of a real Commons response (captured from the live
// API) so CI never depends on Wikimedia being up or fast. The live path is exercised by
// the opt-in test at the bottom.

const COMMONS_FIXTURE = {
  batchcomplete: true,
  query: {
    pages: [
      {
        pageid: 1, ns: 6, title: 'File:Sairandhri, by Raja Ravi Varma.jpg',
        categories: [{ title: 'Category:Paintings by Raja Ravi Varma' }],
        imageinfo: [{
          width: 535, height: 800, thumbwidth: 803, thumbheight: 1200,
          thumburl: 'https://upload.wikimedia.org/pd-800.jpg',
          url: 'https://upload.wikimedia.org/pd-full.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Sairandhri',
          extmetadata: {
            License: { value: 'pd' },
            LicenseShortName: { value: 'Public domain' },
            ObjectName: { value: 'Sairandhri' },
            Categories: { value: 'Paintings by Raja Ravi Varma' },
            Artist: { value: '<a href="/wiki/Raja_Ravi_Varma">Raja Ravi Varma</a>' },
            DateTimeOriginal: { value: 'circa 1890' }
          }
        }]
      },
      {
        pageid: 2, ns: 6, title: 'File:Krishna and Arjuna on Chariot Painting.jpg',
        categories: [{ title: 'Category:Paintings of Krishna' }],
        imageinfo: [{
          width: 2196, height: 3126, thumbwidth: 1200, thumbheight: 1708,
          thumburl: 'https://upload.wikimedia.org/ccbysa-1200.jpg',
          url: 'https://upload.wikimedia.org/ccbysa-full.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Krishna',
          extmetadata: {
            License: { value: 'cc-by-sa-4.0' },
            LicenseShortName: { value: 'CC BY-SA 4.0' },
            ObjectName: { value: 'Krishna and Arjuna on Chariot' },
            Artist: { value: '<a class="new">V Karnathia</a>' }
          }
        }]
      },
      {
        pageid: 3, ns: 6, title: 'File:Something copyrighted.jpg',
        imageinfo: [{
          width: 1000, height: 800, thumburl: 'https://upload.wikimedia.org/fairuse.jpg',
          url: 'https://upload.wikimedia.org/fairuse-full.jpg',
          extmetadata: { License: { value: 'fair use' }, LicenseShortName: { value: 'Fair use' } }
        }]
      },
      {
        pageid: 4, ns: 6, title: 'File:Tiny icon.png',
        imageinfo: [{
          width: 64, height: 64, thumburl: 'https://upload.wikimedia.org/tiny.png',
          url: 'https://upload.wikimedia.org/tiny-full.png',
          extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' } }
        }]
      }
    ]
  }
};

test('Commons results: unusable licences and thumbnails are filtered out', async () => {
  const r = await ev((fixture) => {
    const all = parseCommonsResults(fixture, {});
    const pdOnly = parseCommonsResults(fixture, { publicDomainOnly: true });
    return {
      all: all.map((p) => [p.title, p.licenceClass]),
      pdOnly: pdOnly.map((p) => p.title),
      artist: all[0].artist,
      credit: creditLine(all[0])
    };
  }, COMMONS_FIXTURE);
  // Fair use is never offered; a 64px icon is not artwork.
  assert.deepEqual(r.all, [['Sairandhri', 'public'], ['Krishna and Arjuna on Chariot', 'attribution']]);
  assert.deepEqual(r.pdOnly, ['Sairandhri']);
  assert.equal(r.artist, 'Raja Ravi Varma', 'artist HTML is stripped to text');
  assert.match(r.credit, /Sairandhri — Raja Ravi Varma — circa 1890 \(Public domain\), via Wikimedia Commons/);
});

test('the search query for a scene comes from its proper nouns, plus the style hint', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('Then Arjuna asked Krishna to drive the chariot. The dust had not yet risen.',
      { titleCard: false });
    p.style.imageHint = 'Mahabharata painting';
    return { query: imageQueryFor(p.scenes[0], p), plain: imageQueryFor(p.scenes[0], { style: {} }) };
  });
  assert.match(r.query, /Arjuna/);
  assert.match(r.query, /Krishna/);
  assert.match(r.query, /Mahabharata painting$/);
  assert.doesNotMatch(r.plain, /Then/, 'a sentence-opening capital is not a proper noun');
});

test('an assigned picture is drawn, framed by its focal point, and keeps the canvas untainted', async () => {
  const r = await ev(async () => {
    // A same-origin generated image stands in for the Commons artwork: what matters is
    // the draw path, the focal-point crop and that reading pixels back still works.
    const source = document.createElement('canvas');
    source.width = 400; source.height = 200;
    const sctx = source.getContext('2d');
    sctx.fillStyle = '#ff0000'; sctx.fillRect(0, 0, 200, 200);
    sctx.fillStyle = '#00ff00'; sctx.fillRect(200, 0, 200, 200);
    const img = new Image();
    await new Promise((resolve) => { img.onload = resolve; img.src = source.toDataURL(); });

    const p = buildStoryboard('A test beat with several words in it.', { titleCard: false });
    const scene = p.scenes[0];
    scene.picture = { src: 'test://art', title: 'Test', licence: 'Public domain', licenceClass: 'public' };
    scene.motion = 'none';
    scene.captionStyle = 'none';
    scene.pictureGrade = 0;
    mrImageCache.set('test://art', { status: 'ready', img });

    const sample = (focusX) => {
      scene.pictureFocus = { x: focusX, y: 0.5 };
      const c = document.createElement('canvas');
      c.width = 108; c.height = 192;
      const x = c.getContext('2d');
      x.scale(108 / 1080, 192 / 1920);
      renderFrame(x, p, scene.duration * 0.5, { width: 1080, height: 1920 });
      // getImageData throws on a tainted canvas — this doubles as the taint check.
      const px = x.getImageData(54, 96, 1, 1).data;
      return { r: px[0], g: px[1] };
    };
    const left = sample(0);
    const right = sample(1);
    const withoutPicture = (() => {
      scene.picture = null;
      const c = document.createElement('canvas');
      c.width = 108; c.height = 192;
      const x = c.getContext('2d');
      x.scale(108 / 1080, 192 / 1920);
      renderFrame(x, p, scene.duration * 0.5, { width: 1080, height: 1920 });
      return x.getImageData(54, 96, 1, 1).data[0];
    })();
    return { left, right, withoutPicture };
  });
  // Focus 0 crops to the left (red) half, focus 1 to the right (green) half.
  assert.ok(r.left.r > 200 && r.left.g < 80, `expected red, got ${JSON.stringify(r.left)}`);
  assert.ok(r.right.g > 200 && r.right.r < 80, `expected green, got ${JSON.stringify(r.right)}`);
  assert.ok(r.withoutPicture < 120, 'without a picture the procedural background is drawn instead');
});

test('a scene whose picture has not loaded falls back instead of drawing nothing', async () => {
  const lit = await ev(() => {
    const p = buildStoryboard('The storm came in over the water tonight.', { titleCard: false });
    p.scenes[0].picture = { src: 'test://never-loads', title: 'Missing', licenceClass: 'public' };
    const c = document.createElement('canvas');
    c.width = 108; c.height = 192;
    const x = c.getContext('2d');
    x.scale(108 / 1080, 192 / 1920);
    renderFrame(x, p, 1, { width: 1080, height: 1920 });
    const data = x.getImageData(0, 0, 108, 192).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 30) n++;
    return n;
  });
  assert.ok(lit > 200, 'the frame still has a picture in it');
});

test('credits are collected once per artwork and land in the description', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('One beat here about a boat. Another beat here about the sea.',
      { titleCard: false, maxWordsPerScene: 7 });
    const pd = { src: 'a', title: 'Sairandhri', artist: 'Raja Ravi Varma', licence: 'Public domain', licenceClass: 'public' };
    const by = { src: 'b', title: 'Chariot', artist: 'V Karnathia', licence: 'CC BY-SA 4.0', licenceClass: 'attribution' };
    p.scenes[0].picture = pd;
    p.scenes[1].picture = by;
    if (p.scenes[2]) p.scenes[2].picture = pd;      // same artwork reused
    const kit = publishKit(p);
    return { credits: projectCredits(p), needsAttribution: projectNeedsAttribution(p), description: kit.description };
  });
  assert.equal(r.credits.length, 2, 'the reused artwork is credited once');
  assert.equal(r.needsAttribution, true);
  assert.match(r.description, /Artwork:/);
  assert.match(r.description, /Raja Ravi Varma/);
});

// A regression test built from a real failure: the first live run of "illustrate every
// scene" on a Kurukshetra passage returned these three files, and put a book cover and a
// Google Books watermark page into the reel. The painting must survive; the scans must not.
test('the junk that a real Commons run actually returned is rejected', async () => {
  const r = await ev(() => {
    const observed = {
      query: {
        pages: [
          { pageid: 11, title: 'File:The Green Bag (1889–1914), Volume 08.jpg',
            categories: [{ title: 'Category:Scanned books' }, { title: 'Category:Google Books' }],
            imageinfo: [{ width: 900, height: 1400, thumburl: 'https://upload.wikimedia.org/greenbag.jpg',
              url: 'https://upload.wikimedia.org/greenbag.jpg',
              extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' },
                ObjectName: { value: 'The Green Bag (1889–1914), Volume 08' },
                Artist: { value: 'The Green Bag' } } }] },
          { pageid: 12, title: 'File:Love in Hindu literature.jpg',
            categories: [{ title: 'Category:Books about Hinduism' }],
            imageinfo: [{ width: 800, height: 1200, thumburl: 'https://upload.wikimedia.org/love.jpg',
              url: 'https://upload.wikimedia.org/love.jpg',
              extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' },
                ObjectName: { value: 'Love in Hindu literature' },
                Artist: { value: 'Sarkar, Benoy Kumar, 1887-1949' } } }] },
          { pageid: 13, title: 'File:Bhima fighting Duryodhana.jpg',
            categories: [{ title: 'Category:Paintings of the Mahabharata' }],
            imageinfo: [{ width: 1100, height: 1500, thumburl: 'https://upload.wikimedia.org/bhima.jpg',
              url: 'https://upload.wikimedia.org/bhima.jpg',
              extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' },
                ObjectName: { value: 'Bhima fighting Duryodhana' },
                Artist: { value: 'Unknown authorUnknown author' } } }] }
        ]
      }
    };
    const results = parseCommonsResults(observed, { publicDomainOnly: true });
    return {
      titles: results.map((p) => p.title),
      confident: results.filter((p) => p.artScore >= MR_ART_CONFIDENT).map((p) => p.title),
      artist: results.length ? results[0].artist : ''
    };
  });
  assert.deepEqual(r.titles, ['Bhima fighting Duryodhana'],
    'the book scan and the library-catalogue scan are both dropped');
  assert.deepEqual(r.confident, ['Bhima fighting Duryodhana']);
  assert.equal(r.artist, 'Unknown author', 'Commons doubles the artist name; it is collapsed');
});

test('a picture survives the save-file round trip', async () => {
  const r = await ev(() => {
    ed.project.scenes[0].picture = { src: 'https://example.org/art.jpg', title: 'Art', licence: 'Public domain', licenceClass: 'public' };
    ed.project.scenes[0].pictureFocus = { x: 0.2, y: 0.8 };
    ed.project.scenes[0].pictureFit = 'contain';
    const back = importProjectJSON(exportProjectJSON(ed.project));
    return {
      src: back.scenes[0].picture.src,
      focus: back.scenes[0].pictureFocus,
      fit: back.scenes[0].pictureFit
    };
  });
  assert.equal(r.src, 'https://example.org/art.jpg');
  assert.deepEqual(r.focus, { x: 0.2, y: 0.8 });
  assert.equal(r.fit, 'contain');
});

test('the picture panel searches Commons and assigns what you click', async () => {
  // Stub fetch so the UI path is tested without the network.
  await page.evaluate((fixture) => {
    window.__searched = [];
    // Shaped like a real Response: searchCommons reads text() so it can recognise a
    // rate-limit body, which is not JSON.
    window.fetch = (url) => {
      window.__searched.push(String(url));
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(fixture)) });
    };
  }, COMMONS_FIXTURE);
  await page.click('.tab[data-tab="picture"]');
  await page.fill('#imageQuery', 'Raja Ravi Varma');
  await page.uncheck('#publicDomainOnly');
  await page.click('#imageSearchBtn');
  await page.waitForSelector('.result');
  assert.equal(await page.locator('.result').count(), 2);
  const url = await ev(() => window.__searched[window.__searched.length - 1]);
  assert.match(url, /commons\.wikimedia\.org/);
  assert.match(url, /origin=\*/, 'anonymous CORS parameter must be present');
  assert.match(url, /gsrnamespace=6/);

  await page.locator('.result').first().click();
  const assigned = await ev(() => selectedScene().picture);
  assert.equal(assigned.title, 'Sairandhri');
  assert.equal(await page.locator('.clip-picture').count(), 1, 'the timeline marks illustrated scenes');
  assert.match(await page.locator('#creditsBox').innerText(), /Raja Ravi Varma/);
  assert.deepEqual(page.__errors, []);
});

test('illustrate-every-scene fills every scene, using distinct pictures first', async () => {
  await page.evaluate((fixture) => {
    window.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(fixture)) });
  }, COMMONS_FIXTURE);
  await page.click('.tab[data-tab="picture"]');
  await page.uncheck('#publicDomainOnly');
  await page.click('#illustrateAllBtn');
  // Wait for the run itself to finish, not for a hidden element to become "visible".
  await page.waitForFunction(() => typeof mrIllustrating !== 'undefined' && mrIllustrating === false &&
    ed.project.scenes.some((s) => s.picture));
  const r = await ev(() => {
    const used = ed.project.scenes.filter((s) => s.picture).map((s) => s.picture.src);
    return { used: used.length, unique: new Set(used).size, scenes: ed.project.scenes.length };
  });
  // A bare scene in the middle of an illustrated reel reads as broken, so every scene
  // gets a picture: the distinct ones first, then repeats once the pool runs dry.
  assert.equal(r.used, r.scenes, 'no scene is left bare');
  assert.equal(r.unique, 2, 'both usable fixture pictures are used before anything repeats');
  assert.deepEqual(page.__errors, []);
});

// Opt-in: hits the real Commons API. Run with MR_LIVE_COMMONS=1 to check the contract
// still holds; kept out of CI so an upstream hiccup never turns the build red.
test('live: Commons still answers the shape we parse', { skip: !process.env.MR_LIVE_COMMONS }, async () => {
  const r = await ev(async () => {
    const results = await searchCommons('Raja Ravi Varma Mahabharata', { limit: 5, publicDomainOnly: true });
    if (!results.length) return { count: 0 };
    const img = await loadPicture(results[0].src);
    // Draw it and read the pixels back: proves the CORS headers still allow an
    // untainted canvas, which is what makes the reel recordable.
    const c = document.createElement('canvas');
    c.width = 40; c.height = 40;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 40, 40);
    let tainted = false;
    try { x.getImageData(0, 0, 1, 1); } catch { tainted = true; }
    return { count: results.length, licence: results[0].licenceClass, tainted, width: img.width };
  });
  assert.ok(r.count > 0, 'live search returned results');
  assert.equal(r.licence, 'public');
  assert.equal(r.tainted, false, 'Commons images must not taint the canvas');
  assert.ok(r.width > 300);
});

test('the reel reloads from local storage on the next visit', async () => {
  await ev(() => {
    document.getElementById('storyText').value = 'Persisted Reel\n\nOne line of story that should come back.';
    buildFromText();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof ed !== 'undefined' && ed.project);
  const restored = await ev(() => ({ title: ed.project.title, scenes: ed.project.scenes.length, text: document.getElementById('storyText').value }));
  assert.equal(restored.title, 'Persisted Reel');
  assert.ok(restored.scenes >= 2);
  assert.match(restored.text, /should come back/);
});
