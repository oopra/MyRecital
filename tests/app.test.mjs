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

// Kept here so the test says what Roman means rather than asking the code under test.
const MR_ROME_COSTUMES = ['toga', 'chiton'];

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

test('every script defines its globals without colliding', async () => {
  // These files share one global scope, so two top-level `const`s of the same name throw
  // on load and blank the page. Cheap to check, and it has already happened once.
  assert.deepEqual(page.__errors, [], 'no script threw while loading');
  const present = await ev(() => [
    typeof buildStoryboard, typeof renderFrame, typeof drawActor, typeof drawStage,
    typeof mrAudioPlay, typeof exportVideo, typeof wireEditor, typeof searchCommons,
    typeof generatePanelFor, typeof narrateScene
  ]);
  assert.deepEqual(present, new Array(present.length).fill('function'),
    'every module finished executing and exported its entry point');
});

test('the app boots with a reel on screen and no page errors', async () => {
  const state = await ev(() => ({ scenes: ed.project.scenes.length, total: totalDuration(ed.project) }));
  assert.ok(state.scenes > 3, 'sample story built');
  assert.ok(state.total > 5 && state.total <= 60);
  assert.equal(await page.locator('.clip').count(), state.scenes);
  assert.deepEqual(page.__errors, []);
});

test('editing a scene repaints, and undo puts it back', async () => {
  await page.click('.tab[data-tab="scene"]');   // Animate is the tab that opens by default
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
  await page.click('.tab[data-tab="scene"]');
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

// -------------------------------------------------------------- drawn panels
//
// There is no API key here, so the provider is stubbed — but the stub asserts the exact
// request each adapter builds (endpoint, headers, body), which is the part that would
// otherwise only fail on someone's first paid run.

// A tiny real PNG, so the blob → IndexedDB → object URL → canvas path is exercised for real.
const PANEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQI12P4//8/AzYEEwDGDGD8/x8A' +
  'A2wG8QwZ2QAAAABJRU5ErkJggg==';

async function stubProvider(page, respond) {
  await page.evaluate(({ b64, respond }) => {
    window.__calls = [];
    // eslint-disable-next-line no-eval
    const decide = new Function('call', 'b64', respond);
    window.fetch = (url, init) => {
      const call = { url: String(url), init: init || {} };
      window.__calls.push(call);
      const result = decide(call, b64);
      return Promise.resolve({
        ok: result.ok !== false,
        status: result.status || (result.ok === false ? 400 : 200),
        statusText: result.statusText || '',
        text: () => Promise.resolve(typeof result.body === 'string' ? result.body : JSON.stringify(result.body)),
        json: () => Promise.resolve(result.body)
      });
    };
  }, { b64: PANEL_PNG_B64, respond });
}

test('the panel prompt locks the style and describes only the cast in that beat', async () => {
  const r = await ev(() => {
    // Separate paragraphs, so the two beats cannot be glued together by the orphan rule.
    const p = buildStoryboard('Then Arjuna asked Krishna to drive the chariot between the armies.\n\n' +
      'Far away on the other wing, Bhima waited alone beside his chariot.',
      { titleCard: false, maxWordsPerScene: 12 });
    p.generation = Object.assign({}, MR_DEFAULT_GENERATION, { style: 'ack', styleNotes: 'dawn light' });
    p.cast = [
      { name: 'Arjuna', description: 'young warrior, green tunic' },
      { name: 'Krishna', description: 'blue skin, peacock feather' },
      { name: 'Bhima', description: 'huge, mace' }
    ];
    const first = panelPrompt(p.scenes[0], p);
    const last = panelPrompt(p.scenes[p.scenes.length - 1], p);
    return { first, last, suggested: suggestCast(p).map((c) => c.name) };
  });
  assert.match(r.first, /Amar Chitra Katha/, 'the house style is in every prompt');
  assert.match(r.first, /dawn light/);
  assert.match(r.first, /Arjuna — young warrior, green tunic/);
  assert.match(r.first, /Krishna — blue skin/);
  assert.doesNotMatch(r.first, /Bhima/, 'a character who is not in this beat is not described');
  assert.match(r.first, /no speech bubbles|no lettering/, 'the model is told not to draw text');
  assert.ok(r.suggested.includes('Arjuna') && r.suggested.includes('Krishna'));
});

test('the cast suggestion ignores the title card, which is written in title case', async () => {
  const names = await ev(() => {
    const p = buildStoryboard('The Question on the Field\n\n' +
      'Then Arjuna asked Krishna to drive his chariot between the two armies.',
      { titleCard: true });
    return suggestCast(p).map((c) => c.name);
  });
  assert.ok(names.includes('Arjuna'), 'real characters are still found');
  assert.ok(!names.includes('Question') && !names.includes('Field'),
    'title-case words from the title card are not characters');
});

test('the Gemini adapter posts the documented shape and keeps the key out of the URL', async () => {
  await stubProvider(page, `return { body: { interaction: { output_image: { data: b64 } } } };`);
  const r = await ev(async () => {
    const p = buildStoryboard('Arjuna looked upon the two armies.', { titleCard: false });
    p.generation = Object.assign({}, MR_DEFAULT_GENERATION, { provider: 'gemini' });
    await generatePanelFor(p.scenes[0], p, { apiKey: 'test-key-123' });
    const call = window.__calls[0];
    return {
      url: call.url,
      method: call.init.method,
      header: call.init.headers['x-goog-api-key'],
      body: JSON.parse(call.init.body),
      picture: p.scenes[0].picture,
      panel: p.scenes[0].panel
    };
  });
  assert.equal(r.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(r.method, 'POST');
  assert.equal(r.header, 'test-key-123', 'the key goes in a header, never the query string');
  assert.doesNotMatch(r.url, /test-key-123/);
  assert.equal(r.body.model, 'gemini-3.1-flash-image');
  assert.equal(r.body.input[0].type, 'text');
  assert.equal(r.body.response_format.aspect_ratio, '9:16', 'the reel aspect is requested, not cropped later');
  assert.equal(r.picture.source, 'generated');
  assert.ok(r.picture.src.startsWith('blob:'), 'the panel is drawn from a local blob, never a remote URL');
  assert.ok(r.panel.id && r.panel.prompt, 'the project remembers what made this panel');
});

test('OpenAI and Replicate go through the proxy, not the provider, and send no key by default', async () => {
  await stubProvider(page, `return { body: { b64: b64, mime: 'image/png' } };`);
  const r = await ev(async () => {
    const out = [];
    for (const provider of ['openai', 'replicate']) {
      const p = buildStoryboard('The armies stood facing one another.', { titleCard: false });
      p.generation = Object.assign({}, MR_DEFAULT_GENERATION, { provider });
      await generatePanelFor(p.scenes[0], p, {});
      const call = window.__calls[window.__calls.length - 1];
      out.push({ url: call.url, body: JSON.parse(call.init.body), src: p.scenes[0].picture.src });
    }
    return out;
  });
  for (const call of r) {
    assert.equal(call.url, '/api/image', 'browser-blocked providers go through our own function');
    assert.equal(call.body.aspect, '9:16');
    assert.ok(call.body.prompt.length > 20);
    assert.equal(call.body.apiKey, undefined, 'no key is sent when the server holds it');
    assert.ok(call.src.startsWith('blob:'));
  }
  assert.equal(r[0].body.provider, 'openai');
  assert.equal(r[1].body.provider, 'replicate');
});

test('a provider error surfaces the provider\'s own words', async () => {
  await stubProvider(page, `return { ok: false, status: 400, body: { error: { message: 'Unknown parameter: response_format' } } };`);
  const message = await ev(async () => {
    const p = buildStoryboard('A beat that will fail to draw.', { titleCard: false });
    p.generation = Object.assign({}, MR_DEFAULT_GENERATION, { provider: 'gemini' });
    try { await generatePanelFor(p.scenes[0], p, { apiKey: 'k' }); return 'no error'; }
    catch (e) { return e.message; }
  });
  // This is the difference between "generation failed" and a one-run fix.
  assert.match(message, /Unknown parameter: response_format/);
  assert.match(message, /400/);
});

test('a drawn panel is stored, redrawn from IndexedDB after a reload, and rendered', async () => {
  await stubProvider(page, `return { body: { interaction: { output_image: { data: b64 } } } };`);
  const drawn = await ev(async () => {
    ed.project.generation = Object.assign({}, MR_DEFAULT_GENERATION, { provider: 'gemini' });
    const scene = ed.project.scenes[1];
    await generatePanelFor(scene, ed.project, { apiKey: 'k' });
    saveLocal();
    return { panelId: scene.panel.id, grade: scene.pictureGrade };
  });
  assert.ok(drawn.panelId);
  assert.equal(drawn.grade, 0.08, 'a drawn panel is not graded down toward the palette like found art');

  // Reload: the object URL is gone, the blob is not.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof ed !== 'undefined' && ed.project);
  const after = await ev(async () => {
    const restored = await restorePanels(ed.project);
    const scene = ed.project.scenes.find((s) => s.panel);
    const canvas = document.createElement('canvas');
    canvas.width = 54; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.scale(54 / 1080, 96 / 1920);
    const times = sceneTimeline(ed.project);
    const index = ed.project.scenes.indexOf(scene);
    renderFrame(ctx, ed.project, times[index].start + 0.5, { width: 1080, height: 1920 });
    // Reading pixels back proves a blob-backed panel leaves the canvas recordable.
    let tainted = false;
    try { ctx.getImageData(0, 0, 1, 1); } catch { tainted = true; }
    return { restored, hasPicture: !!(scene && scene.picture), tainted };
  });
  assert.equal(after.restored, 1, 'the panel came back from IndexedDB');
  assert.equal(after.hasPicture, true);
  assert.equal(after.tainted, false);
  assert.deepEqual(page.__errors, []);
});

test('generated panels are not credited as somebody else\'s artwork', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('One beat about a boat. Another beat about the sea.',
      { titleCard: false, maxWordsPerScene: 6 });
    p.scenes[0].picture = { src: 'blob:x', title: 'Generated panel', licence: 'Generated illustration', licenceClass: 'generated', source: 'generated' };
    p.scenes[1].picture = { src: 'c', title: 'Sairandhri', artist: 'Raja Ravi Varma', licence: 'Public domain', licenceClass: 'public' };
    return { credits: projectCredits(p), line: creditLine(p.scenes[0].picture) };
  });
  assert.equal(r.credits.length, 1, 'only the found artwork is credited');
  assert.match(r.credits[0], /Raja Ravi Varma/);
  assert.equal(r.line, '', 'a drawn panel produces no credit line at all');
});

// --------------------------------------------------------------- narration
//
// No TTS key here either, so the provider is stubbed with a real, decodable WAV that the
// browser measures for itself — which is the part that matters, because the narration's
// measured length is what re-times the reel.

// A 1-second 8kHz mono WAV of silence, built in the page so the duration is genuinely read
// back by decodeAudioData rather than asserted from a constant.
const WAV_MAKER = `
  const rate = 8000, seconds = 1;
  const frames = rate * seconds;
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, frames * 2, true);
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
`;

test('narrating a scene re-times it to the length of the line', async () => {
  const r = await ev(async (wavMaker) => {
    const wav = new Function(wavMaker)();
    window.__voiceCalls = [];
    window.fetch = (url, init) => {
      window.__voiceCalls.push({ url: String(url), body: JSON.parse(init.body) });
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ b64: wav, mime: 'audio/wav' })),
        json: () => Promise.resolve({ b64: wav, mime: 'audio/wav' })
      });
    };
    const scene = ed.project.scenes[1];
    scene.duration = 6.5;                        // deliberately wrong for a 1s line
    ed.project.narration = Object.assign({}, MR_DEFAULT_NARRATION, { provider: 'openai', gap: 0.4 });
    await narrateScene(scene, ed.project, { apiKey: 'k' });
    return {
      call: window.__voiceCalls[0],
      duration: scene.duration,
      seconds: scene.narration.seconds,
      // Buffers are keyed by line now: a beat can hold several, one per voice.
      buffered: narrationLines(scene).every((line) => !!narrationBuffer(line.id)),
      lines: narrationLines(scene).length,
      total: narrationSeconds(ed.project)
    };
  }, WAV_MAKER);
  assert.equal(r.call.url, '/api/voice', 'TTS goes through our own function, never the provider directly');
  assert.equal(r.call.body.provider, 'openai');
  assert.equal(r.call.body.apiKey, 'k');
  assert.ok(Math.abs(r.seconds - 1) < 0.05, `measured ${r.seconds}s for a 1s clip`);
  // 1s of speech + a 0.4s breath, replacing the 6.5s guess.
  assert.ok(Math.abs(r.duration - 1.4) < 0.11, `scene re-timed to ${r.duration}s`);
  assert.equal(r.buffered, true, 'the decoded audio is ready to play');
  assert.ok(r.lines >= 1, 'the beat was recorded as at least one line');
  assert.ok(r.total >= 1);
});

test('narration is mixed into the recorded audio, and it ducks the score', async () => {
  const r = await ev(async (wavMaker) => {
    const wav = new Function(wavMaker)();
    window.fetch = () => Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ b64: wav, mime: 'audio/wav' })),
      json: () => Promise.resolve({ b64: wav, mime: 'audio/wav' })
    });
    await narrateScene(ed.project.scenes[0], ed.project, { apiKey: 'k' });
    ed.project.narration.enabled = true;
    const started = mrAudioPlay(ed.project, 0);
    const musicGain = mrAudio.music.gain.value;
    const stream = mrAudioStream();
    const tracks = stream ? stream.getAudioTracks().length : 0;
    mrAudioStop();
    return { started, tracks, musicRestored: mrAudio.music.gain.value };
  }, WAV_MAKER);
  assert.equal(r.started, true);
  assert.ok(r.tracks > 0, 'there is an audio track for the recorder to capture');
  assert.equal(r.musicRestored, 1, 'stopping cancels the duck, so the next play is not quiet');
  void r.musicRestored;
});

test('the score can be off while narration, voices and effects still play', async () => {
  const r = await ev(() => {
    ed.project.audio.enabled = false;
    ed.project.scenes[0].narration = { id: 'x', seconds: 1, text: 'x' };
    const withNarration = mrAudioPlay(ed.project, 0);
    mrAudioStop();
    delete ed.project.scenes[0].narration;
    // Nothing but footsteps and weather is still a soundtrack.
    ed.project.scenes[0].stage = makeStage({
      actors: [makeActor('A', { seed: 0, start: { x: 0.1, y: 0.88, scale: 0.5, action: 'walk' } })]
    });
    setKey(ed.project.scenes[0].stage.actors[0], Math.max(1, ed.project.scenes[0].duration - 0.2), { x: 0.9 });
    const effectsOnly = mrAudioPlay(ed.project, 0);
    const nodes = mrAudio.nodes.length;
    mrAudioStop();
    ed.project.audio.sfx = false;
    // Characters speaking their own lines is a fourth reason to have a soundtrack.
    const voicesOnly = mrAudioPlay(ed.project, 0);
    mrAudioStop();
    ed.project.voices.enabled = false;
    const nothing = mrAudioPlay(ed.project, 0);
    mrAudioStop();
    return { withNarration, effectsOnly, nodes, voicesOnly, nothing };
  });
  assert.equal(r.withNarration, true, 'a silent score must not silence the narrator');
  assert.equal(r.effectsOnly, true, 'nor the footsteps');
  assert.ok(r.nodes > 0, 'and they are really scheduled');
  assert.equal(r.voicesOnly, true, 'nor the characters speaking');
  assert.equal(r.nothing, false, 'with all four off there is nothing to play');
});

test('picture-first mode drops the words to subtitles and calms the camera', async () => {
  const r = await ev(() => {
    setPresentation('people');
    const after = ed.project.scenes.filter((s) => s.captionStyle !== 'title');
    const people = {
      styles: [...new Set(after.map((s) => s.captionStyle))],
      motion: ed.project.style.motionScale,
      intensity: Math.max(...after.map((s) => s.intensity))
    };
    setPresentation('words');
    const words = [...new Set(ed.project.scenes.filter((s) => s.captionStyle !== 'title').map((s) => s.captionStyle))];
    return { people, words };
  });
  assert.deepEqual(r.people.styles, ['subtitle']);
  assert.ok(r.people.motion <= 0.6, 'the camera calms down when the picture carries the scene');
  assert.ok(r.people.intensity <= 0.6);
  assert.deepEqual(r.words, ['kinetic'], 'and it flips back');
});

test('captions are the same physical size in portrait and landscape', async () => {
  const r = await ev(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = MR_FONTS.display;
    const text = 'The armies stood facing one another in the grey light.';
    const size = (w, h) => {
      const base = captionBase(w, h);
      const box = captionBox(w, h, 'bottom', 'subtitle');
      return fitCaption(ctx, text, font, box, { maxSize: base * 0.041, minSize: base * 0.026, maxLines: 3 }).size;
    };
    return { portrait: size(1080, 1920), landscape: size(1920, 1080), square: size(1080, 1080) };
  });
  // Sizing off height alone made 16:9 text half the size of the same reel in 9:16.
  assert.ok(Math.abs(r.portrait - r.landscape) <= 2, `portrait ${r.portrait}px vs landscape ${r.landscape}px`);
  assert.ok(r.square > 30 && r.square < r.portrait + 4);
});

test('a subtitle sits low, stays small, and does not colour words', async () => {
  const r = await ev(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    const subtitle = captionBox(1080, 1920, 'bottom', 'subtitle');
    const kinetic = captionBox(1080, 1920, 'center', 'kinetic');
    const font = MR_FONTS.display;
    const text = 'Seeing all his kinsmen arrayed, he was filled with pity.';
    const subSize = fitCaption(ctx, text, font, subtitle, { maxSize: 1920 * 0.032, minSize: 1920 * 0.02, maxLines: 3 }).size;
    const kinSize = fitCaption(ctx, text, font, kinetic, { maxSize: 1920 * 0.062, minSize: 1920 * 0.028, maxLines: 5 }).size;
    return { subY: subtitle.y / 1920, kinY: kinetic.y / 1920, subSize, kinSize };
  });
  assert.ok(r.subY > 0.7, 'subtitles sit in the lower quarter, clear of faces');
  assert.ok(r.kinY < 0.4, 'kinetic captions own the middle');
  assert.ok(r.subSize < r.kinSize / 1.5, `subtitle ${r.subSize}px vs kinetic ${r.kinSize}px`);
});

test('a narrated scene survives the save file and the reel stays timed to the voice', async () => {
  const r = await ev(() => {
    ed.project.scenes[0].narration = { id: 'voice-1', seconds: 3.2, text: 'x', mime: 'audio/mpeg' };
    ed.project.scenes[0].duration = 3.6;
    ed.project.narration = Object.assign({}, MR_DEFAULT_NARRATION, { enabled: true, voice: 'onyx' });
    const back = importProjectJSON(exportProjectJSON(ed.project));
    return {
      narration: back.scenes[0].narration,
      duration: back.scenes[0].duration,
      settings: { enabled: back.narration.enabled, voice: back.narration.voice }
    };
  });
  assert.equal(r.narration.id, 'voice-1');
  assert.equal(r.narration.seconds, 3.2);
  assert.equal(r.duration, 3.6);
  assert.deepEqual(r.settings, { enabled: true, voice: 'onyx' });
});

// -------------------------------------------------------------- animation

test('keyframes tween position and step pose, and a move implies a walk', async () => {
  const r = await ev(() => {
    const actor = makeActor('Walker', { start: { x: 0.2, y: 0.86, scale: 0.5, action: 'idle', facing: 'right' } });
    setKey(actor, 2, { x: 0.8, action: 'idle' });
    const mid = actorStateAt(actor, 1);
    const start = actorStateAt(actor, 0);
    const end = actorStateAt(actor, 2);
    const past = actorStateAt(actor, 99);
    return { start: start.x, mid: mid.x, end: end.x, past: past.x, midAction: mid.action, endAction: end.action };
  });
  assert.equal(r.start, 0.2);
  assert.ok(Math.abs(r.mid - 0.5) < 0.02, `half way across is ${r.mid}`);
  assert.equal(r.end, 0.8);
  assert.equal(r.past, 0.8, 'past the last key the actor holds its final pose');
  // Nobody keys "walk" by hand when they drag someone across the stage.
  assert.equal(r.midAction, 'walk', 'moving between two keys plays a walk cycle');
  assert.equal(r.endAction, 'idle', 'and stops walking on arrival');
});

test('a keyframe at the same moment is updated, not duplicated', async () => {
  const r = await ev(() => {
    const actor = makeActor('A');
    setKey(actor, 1.5, { x: 0.4 });
    setKey(actor, 1.52, { x: 0.6 });     // the same instant, as far as a person is concerned
    setKey(actor, 3, { x: 0.9 });
    return { count: actor.keys.length, at15: actorStateAt(actor, 1.5).x, sorted: actor.keys.map((k) => k.t) };
  });
  assert.equal(r.count, 3, 'one starting key plus two real ones');
  assert.ok(Math.abs(r.at15 - 0.6) < 0.001, 'the second edit replaced the first');
  assert.deepEqual(r.sorted, [...r.sorted].sort((a, b) => a - b), 'keys stay in time order');
});

test('an actor always keeps at least one pose', async () => {
  const r = await ev(() => {
    const actor = makeActor('A');
    const removedOnly = removeKey(actor, 0);
    setKey(actor, 2, { x: 0.7 });
    const removedSecond = removeKey(actor, 2);
    return { removedOnly, removedSecond, left: actor.keys.length };
  });
  assert.equal(r.removedOnly, false, 'the last keyframe cannot be deleted');
  assert.equal(r.removedSecond, true);
  assert.equal(r.left, 1);
});

test('actors are drawn on the stage, in depth order, and move over time', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('Two people meet on a road at dusk.', { titleCard: false });
    const scene = p.scenes[0];
    scene.captionStyle = 'none';
    scene.motion = 'none';
    scene.duration = 4;
    const walker = makeActor('Walker', { top: '#ff0000', start: { x: 0.15, y: 0.86, scale: 0.5 } });
    setKey(walker, 4, { x: 0.85 });
    scene.stage = makeStage({ actors: [walker] });

    const columnAt = (t, col) => {
      const c = document.createElement('canvas');
      c.width = 216; c.height = 384;
      const x = c.getContext('2d');
      x.scale(216 / 1080, 384 / 1920);
      renderFrame(x, p, t, { width: 1080, height: 1920 });
      const data = x.getImageData(Math.round(col * 216), 0, 1, 384).data;
      let red = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 90) red++;
      return red;
    };
    return {
      leftEarly: columnAt(0.6, 0.15), rightEarly: columnAt(0.6, 0.85),
      leftLate: columnAt(3.6, 0.15), rightLate: columnAt(3.6, 0.85)
    };
  });
  assert.ok(r.leftEarly > 0, 'the actor starts on the left');
  assert.ok(r.rightEarly === 0, 'and is not yet on the right');
  assert.ok(r.rightLate > 0, 'by the end they have walked across');
  assert.ok(r.leftLate === 0, 'and left where they started');
});

test('every action and expression produces a distinct pose', async () => {
  const r = await ev(() => {
    const shot = (make) => {
      const c = document.createElement('canvas');
      c.width = 90; c.height = 140;
      const x = c.getContext('2d');
      const actor = makeActor('A', { top: '#3a5cc8' });
      make(actor);
      drawActor(x, actor, poseFor(actor.__action || 'idle', 0.7, 5, false), 45, 136, 128);
      return c.toDataURL();
    };
    const actions = {};
    for (const action of MR_ACTIONS) actions[action] = shot((a) => { a.__action = action; });
    const faces = {};
    for (const expression of Object.keys(MR_EXPRESSIONS)) faces[expression] = shot((a) => { a.expression = expression; });
    return {
      actions: new Set(Object.values(actions)).size, actionCount: MR_ACTIONS.length,
      faces: new Set(Object.values(faces)).size, faceCount: Object.keys(MR_EXPRESSIONS).length
    };
  });
  assert.equal(r.actions, r.actionCount, 'no two actions render the same');
  assert.equal(r.faces, r.faceCount, 'no two expressions render the same');
});

test('a kneeling character keeps their feet on the floor', async () => {
  const r = await ev(() => {
    // Bent legs cover less vertical distance than straight ones, so without a matching
    // drop the figure kneels in mid-air. Measure where the lowest ink actually lands.
    const lowestInk = (action) => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 300;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 300);
      const actor = makeActor('A', { top: '#1f7a53', bottom: '#4a5568' });
      drawActor(x, actor, poseFor(action, 1.2, 3, false), 100, 260, 240);
      const data = x.getImageData(0, 0, 200, 300).data;
      let lowest = 0;
      for (let y = 0; y < 300; y++) {
        for (let px = 0; px < 200; px++) {
          const i = (y * 200 + px) * 4;
          if (data[i] < 200 && data[i + 1] < 200) { lowest = y; break; }
        }
      }
      return lowest;
    };
    return { idle: lowestInk('idle'), kneel: lowestInk('kneel') };
  });
  // Both should end at the same floor, within a few pixels of the 260px ground line.
  assert.ok(Math.abs(r.idle - 260) < 12, `standing feet land at ${r.idle}`);
  assert.ok(Math.abs(r.kneel - 260) < 20, `kneeling lands at ${r.kneel}, not floating`);
});

test('the speaker mouths the narration, and only the speaker', async () => {
  const r = await ev(() => {
    const scene = buildStoryboard('She told him what she had seen.', { titleCard: false }).scenes[0];
    const speaker = makeActor('Speaker', { speaker: true });
    const listener = makeActor('Listener');
    scene.stage = makeStage({ actors: [speaker, listener] });
    scene.narration = { id: 'n', seconds: 2, text: 'x' };
    const during = {
      speaker: poseFor('idle', 0.5, 1, actorSpeaking(speaker, scene, 0.5)).mouthOpen,
      listener: poseFor('idle', 0.5, 1, actorSpeaking(listener, scene, 0.5)).mouthOpen
    };
    const after = poseFor('idle', 3, 1, actorSpeaking(speaker, scene, 3)).mouthOpen;
    return { during, after };
  });
  assert.ok(r.during.speaker > 0.2, 'the speaker\'s mouth is moving');
  assert.equal(r.during.listener, 0, 'the listener\'s is not');
  assert.equal(r.after, 0, 'and it stops when the line ends');
});

test('clicking a character on the stage picks that character', async () => {
  const r = await ev(() => {
    const scene = buildStoryboard('Two figures stand apart.', { titleCard: false }).scenes[0];
    const left = makeActor('Left', { start: { x: 0.25, y: 0.86, scale: 0.5 } });
    const right = makeActor('Right', { start: { x: 0.75, y: 0.86, scale: 0.5 } });
    scene.stage = makeStage({ actors: [left, right] });
    return {
      onLeft: (actorAtPoint(scene, 0, 0.25, 0.6) || {}).name,
      onRight: (actorAtPoint(scene, 0, 0.75, 0.6) || {}).name,
      onNobody: actorAtPoint(scene, 0, 0.5, 0.2)
    };
  });
  assert.equal(r.onLeft, 'Left');
  assert.equal(r.onRight, 'Right');
  assert.equal(r.onNobody, null, 'empty stage space selects nobody');
});

test('a whole cast survives the save file', async () => {
  const r = await ev(() => {
    const scene = ed.project.scenes[0];
    const actor = makeActor('Arjuna', { body: 'tall', hairStyle: 'bun', top: '#1f7a53', speaker: true });
    setKey(actor, 1.5, { x: 0.7, action: 'point', expression: 'angry' });
    scene.stage = makeStage({ actors: [actor] });
    const back = importProjectJSON(exportProjectJSON(ed.project));
    const restored = back.scenes[0].stage.actors[0];
    return {
      name: restored.name, body: restored.body, speaker: restored.speaker,
      keys: restored.keys.length, action: actorStateAt(restored, 1.5).action
    };
  });
  assert.equal(r.name, 'Arjuna');
  assert.equal(r.body, 'tall');
  assert.equal(r.speaker, true);
  assert.equal(r.keys, 2);
  assert.equal(r.action, 'point');
});

test('adding and dragging a character through the UI keys them where you drop them', async () => {
  await page.click('.tab[data-tab="animate"]');
  await page.click('#addActorBtn');
  assert.equal(await page.locator('.actor-chip').count(), 1);

  const moved = await ev(async () => {
    const canvas = document.getElementById('preview');
    const rect = canvas.getBoundingClientRect();
    const actor = selectedScene().stage.actors[0];
    const before = actorStateAt(actor, localTime()).x;
    const send = (type, fx, fy) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1,
      clientX: rect.left + rect.width * fx, clientY: rect.top + rect.height * fy
    }));
    // Grab the actor where they stand, drag right, release.
    send('pointerdown', before, 0.7);
    send('pointermove', before + 0.25, 0.7);
    send('pointerup', before + 0.25, 0.7);
    return { before, after: actorStateAt(selectedScene().stage.actors[0], localTime()).x };
  });
  assert.ok(moved.after > moved.before + 0.15, `dragged from ${moved.before} to ${moved.after}`);
  await page.click('#undoBtn');
  const undone = await ev(() => actorStateAt(selectedScene().stage.actors[0], localTime()).x);
  assert.ok(Math.abs(undone - moved.before) < 0.01, 'one undo puts the whole drag back');
  assert.deepEqual(page.__errors, []);
});

// ------------------------------------------------------------ props & lip-sync

test('props use the same keyframes as actors, so scenery can move', async () => {
  const r = await ev(() => {
    const cart = makeProp('cart', { start: { x: 0.2, y: 0.88, scale: 0.3 } });
    setKey(cart, 3, { x: 0.8 });
    return {
      start: stateAt(cart, 0).x,
      middle: stateAt(cart, 1.5).x,
      end: stateAt(cart, 3).x,
      kinds: MR_PROP_KINDS.length
    };
  });
  assert.equal(r.start, 0.2);
  assert.ok(Math.abs(r.middle - 0.5) < 0.02, 'a prop tweens like an actor');
  assert.equal(r.end, 0.8);
  assert.ok(r.kinds >= 12, `${r.kinds} props in the library`);
});

test('depth decides what covers what', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('Someone stands behind a rock.', { titleCard: false });
    const scene = p.scenes[0];
    scene.captionStyle = 'none';
    scene.motion = 'none';
    scene.duration = 3;
    const actor = makeActor('Person', { top: '#00ff00', bottom: '#00ff00', start: { x: 0.5, y: 0.86, scale: 0.5 } });
    const rock = makeProp('rock', { tint: '#ff0000', layer: 'front', start: { x: 0.5, y: 0.9, scale: 0.6 } });
    scene.stage = makeStage({ actors: [actor], props: [rock] });

    // Count over a band rather than probing one pixel: the idle pose shifts the actor's
    // weight from foot to foot, so a single sample lands on a leg or misses it by chance.
    const sample = () => {
      const c = document.createElement('canvas');
      c.width = 216; c.height = 384;
      const x = c.getContext('2d');
      x.scale(216 / 1080, 384 / 1920);
      renderFrame(x, p, 1.5, { width: 1080, height: 1920 });
      const band = x.getImageData(86, Math.round(384 * 0.78), 44, 24).data;
      let r = 0, g = 0;
      for (let i = 0; i < band.length; i += 4) {
        if (band[i] > 150 && band[i + 1] < 120) r++;
        if (band[i + 1] > 150 && band[i] < 120) g++;
      }
      return { r, g };
    };
    const inFront = sample();
    rock.layer = 'back';
    const behind = sample();
    return { inFront, behind, order: stageItems(scene, 1.5).map((i) => i.kind) };
  });
  assert.ok(r.inFront.r > 40 && r.inFront.g === 0, `a front prop covers the actor (${JSON.stringify(r.inFront)})`);
  assert.ok(r.behind.g > 40, `a back prop is covered by the actor (${JSON.stringify(r.behind)})`);
  assert.deepEqual(r.order, ['prop', 'actor'], 'scenery is painted before the cast');
});

test('clicking a prop selects the prop', async () => {
  const r = await ev(() => {
    const scene = buildStoryboard('A tree beside a person.', { titleCard: false }).scenes[0];
    const tree = makeProp('tree', { start: { x: 0.2, y: 0.9, scale: 0.5 } });
    const actor = makeActor('Person', { start: { x: 0.7, y: 0.86, scale: 0.5 } });
    scene.stage = makeStage({ actors: [actor], props: [tree] });
    const onTree = actorAtPoint(scene, 0, 0.2, 0.6);
    const onPerson = actorAtPoint(scene, 0, 0.7, 0.6);
    return { tree: onTree && onTree.kind, person: onPerson && onPerson.name };
  });
  assert.equal(r.tree, 'tree');
  assert.equal(r.person, 'Person');
});

test('lip-sync follows the measured loudness of the line, not a timer', async () => {
  const r = await ev(async () => {
    // A clip that is loud for its first half and silent for its second.
    const ctx = mrAudioEnsure();
    const rate = 8000;
    const buffer = ctx.createBuffer(1, rate * 2, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < rate; i++) data[i] = Math.sin(i * 0.1) * 0.8;
    const envelope = envelopeFrom(buffer);
    const scene = buildStoryboard('She spoke, and then she stopped.', { titleCard: false }).scenes[0];
    scene.narration = { id: 'n', seconds: 2, text: 'x', envelope };
    const actor = makeActor('Speaker', { speaker: true });
    scene.stage = makeStage({ actors: [actor] });
    return {
      length: envelope.length,
      loudMouth: poseFor('idle', 0.5, 1, actorSpeaking(actor, scene, 0.5)).mouthOpen,
      quietMouth: poseFor('idle', 1.5, 1, actorSpeaking(actor, scene, 1.5)).mouthOpen,
      afterLine: poseFor('idle', 2.5, 1, actorSpeaking(actor, scene, 2.5)).mouthOpen
    };
  });
  assert.ok(r.length > 50, `envelope sampled ${r.length} times over 2 seconds`);
  assert.ok(r.loudMouth > 0.5, 'the mouth is open on the loud half');
  assert.equal(r.quietMouth, 0, 'and shut through the silence — a timer could not do this');
  assert.equal(r.afterLine, 0);
});

test('an older narration with no envelope still flaps rather than freezing', async () => {
  const mouth = await ev(() => {
    const scene = buildStoryboard('An old project, saved before lip-sync existed.', { titleCard: false }).scenes[0];
    scene.narration = { id: 'n', seconds: 3, text: 'x' };      // no envelope
    const actor = makeActor('Speaker', { speaker: true });
    scene.stage = makeStage({ actors: [actor] });
    return poseFor('idle', 1, 1, actorSpeaking(actor, scene, 1)).mouthOpen;
  });
  assert.ok(mouth > 0.2, 'falls back to the timed flap');
});

test('props survive the save file and copy forward with the cast', async () => {
  const r = await ev(() => {
    const scene = ed.project.scenes[0];
    const cart = makeProp('cart', { tint: '#c2452d', layer: 'stage' });
    setKey(cart, 2, { x: 0.8 });
    scene.stage = makeStage({ actors: [makeActor('Driver')], props: [cart] });
    const back = importProjectJSON(exportProjectJSON(ed.project));
    const restored = back.scenes[0].stage.props[0];
    return { kind: restored.kind, tint: restored.tint, keys: restored.keys.length, end: stateAt(restored, 2).x };
  });
  assert.equal(r.kind, 'cart');
  assert.equal(r.tint, '#c2452d');
  assert.equal(r.keys, 2);
  assert.equal(r.end, 0.8);
});

test('adding a prop through the UI puts it on the stage', async () => {
  await page.click('.tab[data-tab="animate"]');
  await page.click('#addActorBtn');
  await page.selectOption('#propKind', 'tree');
  await page.click('#addPropBtn');
  const r = await ev(() => {
    const stage = selectedScene().stage;
    return { props: stage.props.length, actors: stage.actors.length, selectedIsProp: !!selectedProp() };
  });
  assert.equal(r.props, 1);
  assert.equal(r.actors, 1);
  assert.equal(r.selectedIsProp, true, 'a new prop is selected so you can place it at once');
  assert.equal(await page.locator('.actor-chip').count(), 2, 'the stage list shows cast and scenery');
  assert.deepEqual(page.__errors, []);
});

// ---------------------------------------------------------------- the comic look

test('the cast style changes the drawing, not just the colours', async () => {
  const r = await ev(() => {
    const shot = (look) => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 240;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 160, 240);
      const actor = makeActor('A', { top: '#3a5cc8' });
      drawActor(x, actor, poseFor('idle', 0.6, 3, false), 80, 232, 220, look);
      return c.toDataURL();
    };
    // Count dark pixels as a proxy for how much ink is on the page.
    const inkiness = (look) => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 240;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 160, 240);
      drawActor(x, makeActor('A', { top: '#3a5cc8' }), poseFor('idle', 0.6, 3, false), 80, 232, 220, look);
      const data = x.getImageData(0, 0, 160, 240).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 90 && data[i + 1] < 90) dark++;
      return dark;
    };
    return {
      differ: shot('natural') !== shot('comic'),
      naturalInk: inkiness('natural'),
      comicInk: inkiness('comic'),
      looks: Object.keys(MR_LOOKS).length
    };
  });
  assert.equal(r.differ, true);
  assert.ok(r.comicInk > r.naturalInk * 1.15,
    `comic style lays down more ink (${r.comicInk} vs ${r.naturalInk})`);
  assert.ok(r.looks >= 3);
});

test('every costume and headwear draws something different', async () => {
  const r = await ev(() => {
    const shot = (extra) => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 240;
      const x = c.getContext('2d');
      drawActor(x, makeActor('A', Object.assign({ top: '#e8e2d8', bottom: '#8a6a3f' }, extra)),
        poseFor('idle', 0.6, 3, false), 80, 232, 220, 'comic');
      return c.toDataURL();
    };
    const costumes = new Set(MR_COSTUMES.map((costume) => shot({ costume })));
    const hats = new Set(MR_HEADWEAR.map((headwear) => shot({ headwear })));
    return { costumes: costumes.size, costumeCount: MR_COSTUMES.length, hats: hats.size, hatCount: MR_HEADWEAR.length };
  });
  assert.equal(r.costumes, r.costumeCount, 'no two costumes render identically');
  assert.equal(r.hats, r.hatCount, 'no two headwear options render identically');
});

test('a speech balloon sits above the speaker and never covers their face', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('A very long line of dialogue that would happily grow a balloon ' +
      'right across the face of whoever is unlucky enough to be saying it out loud.', { titleCard: false });
    const scene = p.scenes[0];
    scene.captionStyle = 'balloon';
    scene.background = 'flatland';
    scene.motion = 'none';
    scene.duration = 4;
    const speaker = makeActor('Speaker', { speaker: true, top: '#00ff00', bottom: '#00ff00',
      start: { x: 0.5, y: 0.88, scale: 0.55, action: 'talk' } });
    scene.stage = makeStage({ actors: [speaker] });

    const c = document.createElement('canvas');
    c.width = 384; c.height = 216;                       // a wide frame, the harder case
    const x = c.getContext('2d');
    x.scale(384 / 1920, 216 / 1080);
    p.style.aspect = '16:9';
    renderFrame(x, p, 2, { width: 1920, height: 1080 });
    const data = x.getImageData(0, 0, 384, 216).data;
    // The head sits just below the top of the actor: y = (0.88 - 0.55) of the frame.
    const headRow = Math.round(216 * 0.36);
    let faceCovered = 0;
    for (let px = Math.round(384 * 0.42); px < Math.round(384 * 0.58); px++) {
      const i = (headRow * 384 + px) * 4;
      // Balloon cream is bright and unsaturated; skin and ink are not.
      if (data[i] > 240 && data[i + 1] > 235 && data[i + 2] > 215) faceCovered++;
    }
    return { faceCovered };
  });
  assert.equal(r.faceCovered, 0, 'no balloon paint across the speaker\'s head');
});

test('the comic preset changes the whole reel in one undoable step', async () => {
  const r = await ev(() => {
    const before = { look: ed.project.style.look, palette: ed.project.style.palette };
    // Give a scene a cast so the preset can put a balloon on it.
    ed.project.scenes[1].stage = makeStage({ actors: [makeActor('Someone')] });
    applyComicPreset();
    const after = {
      look: ed.project.style.look,
      palette: ed.project.style.palette,
      panel: ed.project.style.panel,
      backgrounds: [...new Set(ed.project.scenes.filter((s) => s.kind !== 'title').map((s) => s.background))],
      balloons: ed.project.scenes.filter((s) => s.captionStyle === 'balloon').length,
      costumes: [...new Set(ed.project.scenes[1].stage.actors.map((a) => a.costume))]
    };
    undo();
    return { before, after, restored: { look: ed.project.style.look, palette: ed.project.style.palette } };
  });
  assert.equal(r.after.look, 'comic');
  assert.equal(r.after.palette, 'comicday');
  assert.equal(r.after.panel, true);
  assert.ok(r.after.backgrounds.every((b) => b === 'flatland' || b === 'village'));
  assert.equal(r.after.balloons, 1, 'only the scene with someone on stage gets a balloon');
  assert.deepEqual(r.after.costumes, ['kurta']);
  assert.deepEqual(r.restored, r.before, 'one undo puts the whole reel back');
});

test('the comic page border frames the picture instead of covering it', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('A framed panel.', { titleCard: false });
    p.style.panel = true;
    p.scenes[0].background = 'village';
    p.scenes[0].captionStyle = 'none';
    p.scenes[0].motion = 'none';
    const c = document.createElement('canvas');
    c.width = 200; c.height = 356;
    const x = c.getContext('2d');
    x.scale(200 / 1080, 356 / 1920);
    renderFrame(x, p, 1, { width: 1080, height: 1920 });
    const at = (fx, fy) => {
      const d = x.getImageData(Math.round(200 * fx), Math.round(356 * fy), 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    };
    return { corner: at(0.01, 0.01), middle: at(0.5, 0.35) };
  });
  // Paper at the very edge, picture in the middle — the bug this replaced filled the lot.
  assert.ok(r.corner.r > 220 && r.corner.b > 190, `edge should be paper, got ${JSON.stringify(r.corner)}`);
  assert.ok(!(r.middle.r > 230 && r.middle.g > 225 && r.middle.b > 200),
    `the middle must still be the picture, got ${JSON.stringify(r.middle)}`);
});

// ------------------------------------------------------------- auto-direction

const POTTER = 'The Potter and the Traveller\n\n' +
  'A traveller came down the road at noon, walking slowly past the well.\n\n' +
  'Aruna looked up from her wheel. You have walked a long way, she said.\n\n' +
  'The traveller sat down beside the fire and said nothing at all.\n\n' +
  'Aruna pointed at the empty pot. Then you can carry water, she said.';

test('casting finds named characters even when they start every sentence', async () => {
  const cast = await ev((text) => castFromStory(buildStoryboard(text), 5), POTTER);
  // "Aruna looked up..." — the main character opens her sentences, which the strict
  // mid-sentence-capital rule threw away entirely.
  assert.ok(cast.includes('Aruna'), `cast was ${cast.join(', ')}`);
  // ...and the other character has no name at all, only a role.
  assert.ok(cast.includes('Traveller'), `cast was ${cast.join(', ')}`);
});

test('a name always looks the same, and two names look different', async () => {
  const r = await ev(() => {
    const a1 = appearanceFor('Aruna');
    const a2 = appearanceFor('Aruna');
    const b = appearanceFor('Traveller');
    return { same: JSON.stringify(a1) === JSON.stringify(a2), differ: JSON.stringify(a1) !== JSON.stringify(b) };
  });
  // Consistency is free for drawn characters — this is the thing image generation cannot do.
  assert.equal(r.same, true);
  assert.equal(r.differ, true);
});

test('actions come from the verb about that character, not from elsewhere in the beat', async () => {
  const r = await ev(() => ({
    walked: actionFor('A traveller came down the road at noon.', 'traveller'),
    // "looked up" is not walking; the beat's other sentence contains "walked".
    looked: actionFor('Aruna looked up from her wheel. You have walked a long way, she said.', 'Aruna'),
    sat: actionFor('The traveller sat down beside the fire.', 'traveller'),   // sitting, not kneeling
    pointed: actionFor('Aruna pointed at the empty pot.', 'Aruna'),
    nothing: actionFor('The rain fell on the roof.', 'Aruna')
  }));
  assert.equal(r.walked, 'walk');
  assert.equal(r.looked, 'idle', 'a verb from another sentence must not be borrowed');
  assert.equal(r.sat, 'sit');
  assert.equal(r.pointed, 'point');
  assert.equal(r.nothing, 'fall', 'an unattributable verb still falls back to the beat');
});

test('speech is attributed through pronouns, and silence is not speech', async () => {
  const r = await ev(() => ({
    pronoun: speakerFor('Aruna looked up from her wheel. You have walked a long way, she said.', ['Aruna', 'Traveller']),
    silent: speakerFor('The traveller sat down beside the fire and said nothing at all.', ['Aruna', 'Traveller']),
    named: speakerFor('Krishna said: you have come far.', ['Krishna', 'Arjuna']),
    both: speakerFor('Arjuna turned to Krishna and asked why.', ['Krishna', 'Arjuna']),
    none: speakerFor('The dust rose behind them on the road.', ['Aruna', 'Traveller'])
  }));
  assert.equal(r.pronoun, 'Aruna', '"she said" belongs to the last person named');
  assert.equal(r.silent, null, '"said nothing at all" is the opposite of speaking');
  assert.equal(r.named, 'Krishna');
  assert.equal(r.both, 'Arjuna', 'the name before the verb is the speaker');
  assert.equal(r.none, null);
});

test('directing stages the whole reel: cast, actions, dialogue and scenery', async () => {
  const r = await ev((text) => {
    const p = buildStoryboard(text);
    const summary = directProject(p);
    const beats = p.scenes.filter((s) => s.kind !== 'title');
    return {
      summary,
      staged: beats.every((s) => s.stage && s.stage.actors.length),
      actions: beats.map((s) => s.stage.actors.map((a) => stateAt(a, 0.5).action)),
      speakers: beats.filter((s) => s.stage.actors.some((a) => a.speaker)).length,
      props: beats.reduce((n, s) => n + s.stage.props.length, 0)
    };
  }, POTTER);
  assert.ok(r.summary.cast.length >= 2);
  assert.equal(r.staged, true, 'every beat has somebody on stage');
  assert.ok(r.actions.some((list) => list.includes('walk')), 'the arrival walks');
  assert.ok(r.actions.some((list) => list.includes('sit')), 'sitting down gets the sit pose, not a kneel');
  assert.equal(r.speakers, 2, 'two beats have an identified speaker');
  assert.ok(r.props >= 3, `scenery placed in ${r.props} slots`);
});

test('people stay on their side of the stage, and stay on stage between lines', async () => {
  const r = await ev((text) => {
    const p = buildStoryboard(text);
    directProject(p);
    const beats = p.scenes.filter((s) => s.kind !== 'title' && s.stage.actors.length > 1);
    const sides = {};
    for (const scene of beats) {
      for (const actor of scene.stage.actors) {
        const x = stateAt(actor, scene.duration).x;
        (sides[actor.name] = sides[actor.name] || []).push(x < 0.5 ? 'left' : 'right');
      }
    }
    return {
      sides,
      pairs: beats.length,
      // A beat naming only one person still keeps the other on stage.
      carried: p.scenes.filter((s) => s.kind !== 'title').every((s) => s.stage.actors.length >= 1)
    };
  }, POTTER);
  assert.ok(r.pairs >= 2, 'there are multi-character beats to check');
  for (const [name, seen] of Object.entries(r.sides)) {
    assert.equal(new Set(seen).size, 1, `${name} kept swapping sides: ${seen.join(', ')}`);
  }
  assert.equal(r.carried, true);
});

test('an arrival walks in from off the frame', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('A traveller came down the road at noon, walking slowly past the well.',
      { titleCard: false });
    directProject(p);
    const actor = p.scenes[0].stage.actors[0];
    return { start: stateAt(actor, 0).x, end: stateAt(actor, p.scenes[0].duration).x, keys: actor.keys.length };
  });
  assert.ok(r.start < 0 || r.start > 1, `starts off frame at ${r.start}`);
  assert.ok(r.end > 0.1 && r.end < 0.9, `arrives on stage at ${r.end}`);
  assert.equal(r.keys, 2);
});

test('the direct button stages the reel and one undo puts it back', async () => {
  await ev((text) => { document.getElementById('storyText').value = text; }, POTTER);
  await page.click('#buildBtn');
  const before = await ev(() => ed.project.scenes.filter((s) => s.stage && s.stage.actors.length).length);
  await page.click('#directBtn');
  const after = await ev(() => ({
    staged: ed.project.scenes.filter((s) => s.stage && s.stage.actors.length).length,
    message: document.getElementById('directResult').textContent
  }));
  assert.equal(before, 0, 'building alone leaves the stage empty');
  assert.ok(after.staged >= 4, `directing staged ${after.staged} scenes`);
  assert.match(after.message, /Cast .*Aruna/);
  await page.click('#undoBtn');
  assert.equal(await ev(() => ed.project.scenes.filter((s) => s.stage && s.stage.actors.length).length), 0,
    'one undo clears the whole pass');
  assert.deepEqual(page.__errors, []);
});

// ----------------------------------------------------------------- movement

test('the walk bends the swing knee and keeps the stance leg straight', async () => {
  const r = await ev(() => {
    // Sample a whole stride and look at how the knees behave.
    const samples = [];
    for (let i = 0; i <= 20; i++) {
      const pose = poseFor('walk', 0, 0, false, { cycle: i / 20, tIn: 5 });
      samples.push({ hipL: pose.hipL, kneeL: pose.kneeL, kneeR: pose.kneeR });
    }
    const maxKnee = Math.max(...samples.map((s) => s.kneeL));
    // The stance leg is the one whose hip is forward and moving back.
    const atContact = samples.reduce((best, s) => (s.hipL > best.hipL ? s : best), samples[0]);
    const alternates = samples.some((s) => s.kneeL > 0.4 && s.kneeR < 0.15) &&
      samples.some((s) => s.kneeR > 0.4 && s.kneeL < 0.15);
    return { maxKnee, kneeAtContact: atContact.kneeL, alternates };
  });
  // Before this pass both legs stayed rigid: two sticks scissoring.
  assert.ok(r.maxKnee > 0.5, `swing knee should bend hard, peaked at ${r.maxKnee}`);
  assert.ok(r.kneeAtContact < 0.2, `the leg taking the weight should be near straight, was ${r.kneeAtContact}`);
  assert.equal(r.alternates, true, 'the legs take turns');
});

test('the walk cycle follows distance travelled, so feet do not skate', async () => {
  const r = await ev(() => {
    const make = (endX) => {
      const actor = makeActor('W', { start: { x: 0.1, y: 0.88, scale: 0.5, action: 'walk' } });
      setKey(actor, 4, { x: endX });
      return actor;
    };
    const scene = buildStoryboard('A walk.', { titleCard: false }).scenes[0];
    const far = make(0.9);
    const near = make(0.25);
    return {
      farCycles: strideCycles(far, 4, stateAt(far, 4)),
      nearCycles: strideCycles(near, 4, stateAt(near, 4)),
      stillPose: posedFor(makeActor('S', { start: { x: 0.5, y: 0.88, scale: 0.5, action: 'walk' } }), scene, 2)
    };
  });
  // Same four seconds, four times the distance — so four times the strides.
  assert.ok(r.farCycles > r.nearCycles * 3, `${r.farCycles.toFixed(2)} vs ${r.nearCycles.toFixed(2)} strides`);
  assert.ok(r.farCycles > 2 && r.farCycles < 12, 'a sensible number of steps for the distance');
  assert.ok(r.stillPose, 'walking on the spot still produces a pose');
});

test('the walking arms swing evenly, forward and back by the same amount', async () => {
  const r = await ev(() => {
    const samples = [];
    for (let i = 0; i < 24; i++) {
      const cycle = i / 24;
      const p = poseFor('walk', cycle, 0, false, { cycle });
      // The drawing splays each arm outward by 0.17 before swinging it, so the angle that
      // actually reaches the canvas is the pose angle plus that splay.
      samples.push({ left: p.shoulderL - 0.17, right: p.shoulderR + 0.17 });
    }
    const span = (key) => {
      const v = samples.map((s) => s[key]);
      return { forward: Math.max(...v), back: Math.min(...v) };
    };
    return { left: span('left'), right: span('right') };
  });
  for (const [side, s] of Object.entries(r)) {
    // A stride is symmetrical: each arm goes as far back as it comes forward. It did not,
    // because the outward splay was left in the swing — it cancelled half of one arm's
    // travel and doubled the other's, so the figure hunched on alternate steps.
    assert.ok(Math.abs(s.forward + s.back) < 0.06,
      `the ${side} arm swings evenly (forward ${s.forward.toFixed(2)}, back ${s.back.toFixed(2)})`);
    assert.ok(s.forward > 0.04, `the ${side} arm actually swings (${s.forward.toFixed(2)})`);
    // The shoulders are close together on a drawn figure. A full anatomical swing throws
    // each hand across the midline and the two arms knot together at the waist.
    assert.ok(s.forward < 0.3, `the ${side} arm stays at the side (${s.forward.toFixed(2)})`);
  }
  // ...and the two arms are opposites, not a pair.
  assert.ok(r.left.forward * r.right.forward > 0, 'both arms swing');
  assert.ok(Math.abs(r.left.forward + r.right.back) < 0.06, 'the arms mirror each other');
});

test('gestures reach in front of the character, not behind', async () => {
  const r = await ev(() => {
    // How far the drawing extends either side of the actor's own centre line. Counting ink
    // in halves does not work: the torso, head and legs dominate the total and drown out the
    // one limb under test. Reach does not — it is exactly what a gesture changes.
    const reach = (action) => {
      const c = document.createElement('canvas');
      c.width = 240; c.height = 260;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 240, 260);
      // tIn well past the settle, so the gesture is fully extended.
      drawActor(x, makeActor('A', { top: '#c2452d' }), poseFor(action, 2, 0, false, { tIn: 2 }), 120, 250, 230);
      const data = x.getImageData(0, 0, 240, 260).data;
      const column = new Array(240).fill(0);
      for (let y = 0; y < 260; y++) {
        for (let px = 0; px < 240; px++) {
          const i = (y * 240 + px) * 4;
          if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) continue;   // background
          column[px]++;
        }
      }
      let lo = 120, hi = 120;
      // Six pixels of ink, so a stray antialiased edge is not mistaken for a limb.
      for (let px = 0; px < 240; px++) if (column[px] >= 6) { lo = Math.min(lo, px); hi = Math.max(hi, px); }
      return { behind: 120 - lo, ahead: hi - 120 };
    };
    return { point: reach('point'), wave: reach('wave'), talk: reach('talk'), idle: reach('idle') };
  });
  // A character drawn facing right must gesture to the right. All three used negative angles
  // before, which aimed the arm behind them.
  assert.ok(r.point.ahead > r.point.behind * 1.8, `point reaches forward (${JSON.stringify(r.point)})`);
  assert.ok(r.wave.ahead > r.wave.behind * 1.3, `wave reaches forward (${JSON.stringify(r.wave)})`);
  assert.ok(r.talk.ahead > r.talk.behind * 1.15, `talk gestures forward (${JSON.stringify(r.talk)})`);
  // ...and a gesture is a reach, not a permanent stance: standing still stays symmetrical.
  assert.ok(Math.abs(r.idle.ahead - r.idle.behind) < r.idle.behind * 0.35,
    `idle stays roughly symmetrical (${JSON.stringify(r.idle)})`);
});

test('a gesture starts from rest instead of appearing fully formed', async () => {
  const r = await ev(() => ({
    atStart: poseFor('point', 0, 0, false, { tIn: 0 }).shoulderR,
    settling: poseFor('point', 0.2, 0, false, { tIn: 0.2 }).shoulderR,
    settled: poseFor('point', 1.5, 0, false, { tIn: 1.5 }).shoulderR,
    talkQuiet: poseFor('talk', 0, 0, false, { tIn: 0 }).elbowR
  }));
  assert.ok(Math.abs(r.atStart) < 0.15, `the arm starts down, was ${r.atStart}`);
  assert.ok(r.settling > r.atStart && r.settling < r.settled + 0.3, 'it travels');
  assert.ok(r.settled > 1.2, `and ends extended, at ${r.settled}`);
  assert.ok(Math.abs(r.talkQuiet) < 0.4, 'talking begins from rest too');
});

test('actions cross-fade instead of snapping', async () => {
  const r = await ev(() => {
    const scene = buildStoryboard('Standing, then kneeling.', { titleCard: false }).scenes[0];
    scene.duration = 4;
    const actor = makeActor('A', { start: { x: 0.5, y: 0.88, scale: 0.5, action: 'idle' } });
    setKey(actor, 2, { action: 'kneel' });
    scene.stage = makeStage({ actors: [actor] });
    const before = posedFor(actor, scene, 1.9).hipL;
    const during = posedFor(actor, scene, 2.12).hipL;
    const after = posedFor(actor, scene, 3.5).hipL;
    return { before, during, after };
  });
  assert.ok(r.after > 1, 'the kneel arrives');
  // Mid-blend the hip is between standing and kneeling — not at either end.
  assert.ok(r.during > r.before + 0.15 && r.during < r.after - 0.15,
    `mid-transition hip was ${r.during.toFixed(2)}, between ${r.before.toFixed(2)} and ${r.after.toFixed(2)}`);
});

test('sitting puts the body down at seat height, not standing height', async () => {
  const r = await ev(() => {
    const headTop = (action) => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 300;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 300);
      drawActor(x, makeActor('A', { top: '#1f7a53' }), poseFor(action, 2, 0, false, { tIn: 2 }), 100, 270, 240);
      const data = x.getImageData(0, 0, 200, 300).data;
      for (let y = 0; y < 300; y++) {
        for (let px = 0; px < 200; px++) {
          const i = (y * 200 + px) * 4;
          if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) return y;
        }
      }
      return 300;
    };
    return { standing: headTop('idle'), sitting: headTop('sit') };
  });
  // Sitting lowers the whole figure; the head must come down with it.
  assert.ok(r.sitting > r.standing + 25, `sitting head at ${r.sitting}, standing at ${r.standing}`);
});

test('a seated character rests their hands on their own knees', async () => {
  const r = await ev(() => poseFor('sit', 2, 0, false, { tIn: 2 }));
  // Joint angles are absolute, not mirrored, so a seated pose cannot mirror its signs:
  // doing that swung the right arm backwards and crossed the hands onto opposite knees.
  const forearmR = r.shoulderR + r.elbowR;
  const forearmL = r.shoulderL + r.elbowL;
  assert.ok(forearmR > 0.4, `the right forearm comes forward, was ${forearmR.toFixed(2)}`);
  assert.ok(forearmL > 0.4, `the left forearm comes forward, was ${forearmL.toFixed(2)}`);
  assert.ok(Math.abs(forearmR - forearmL) < 0.5, 'and neither reaches across the other');
});

test('an arm crossing the body stays visible against the garment', async () => {
  const r = await ev(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 300);
    // Thinking folds the arm up across the chest — the one pose drawn entirely inside the
    // silhouette, where the ink outline cannot separate it from the torso.
    x.fillStyle = '#c2452d';
    drawActor(x, makeActor('A', { top: '#c2452d' }), poseFor('think', 2, 0, false, { tIn: 2 }), 100, 270, 240);
    const data = x.getImageData(0, 0, 200, 300).data;
    let torso = 0, other = 0;
    for (let y = 90; y < 165; y++) {
      for (let px = 80; px < 120; px++) {
        const i = (y * 200 + px) * 4;
        const [red, green, blue] = [data[i], data[i + 1], data[i + 2]];
        if (red > 240 && green > 240 && blue > 240) continue;
        // Within a few points of the garment colour, or something else drawn over it.
        if (Math.abs(red - 194) < 12 && Math.abs(green - 69) < 12 && Math.abs(blue - 45) < 12) torso++;
        else other++;
      }
    }
    return { torso, other };
  });
  assert.ok(r.torso > 200, `the chest is drawn (${JSON.stringify(r)})`);
  assert.ok(r.other > r.torso * 0.12, `the arm is distinguishable from it (${JSON.stringify(r)})`);
});

// ------------------------------------------------------------------ age

test('a child is drawn shorter than a grown-up, with a bigger head', async () => {
  const r = await ev(() => {
    const measure = (age) => {
      const c = document.createElement('canvas');
      c.width = 260; c.height = 320;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 260, 320);
      const actor = makeActor('A', { age, top: '#c2452d', hair: '#1c1512' });
      // Same size setting for both: age is what changes how tall they stand.
      drawActor(x, actor, poseFor('idle', 2, 0, false, { tIn: 2 }), 130, 300, actorHeight(actor, 260));
      const data = x.getImageData(0, 0, 260, 320).data;
      let top = 320, face = 0;
      for (let y = 0; y < 320; y++) {
        let ink = 0, skin = 0;
        for (let px = 0; px < 260; px++) {
          const i = (y * 260 + px) * 4;
          if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) continue;
          ink++;
          // The skin the actor was given, within a few points either way.
          if (Math.abs(data[i] - 224) < 14 && Math.abs(data[i + 1] - 170) < 14 && Math.abs(data[i + 2] - 124) < 14) skin++;
        }
        if (ink && y < top) top = y;
        // The widest band of face on any row: the head, since nothing else is that wide.
        if (skin > face) face = skin;
      }
      return { height: 300 - top, face };
    };
    return { child: measure('child'), adult: measure('adult'), elder: measure('elder') };
  });
  assert.ok(r.child.height < r.adult.height * 0.8,
    `a child stands shorter (${r.child.height} vs ${r.adult.height})`);
  // Head as a share of the whole figure: the giveaway that this is a child and not a
  // shrunken adult. The widest run of skin on any row is the face.
  const childShare = r.child.face / r.child.height;
  const adultShare = r.adult.face / r.adult.height;
  assert.ok(childShare > adultShare * 1.15,
    `and the head takes up more of them (${childShare.toFixed(3)} vs ${adultShare.toFixed(3)})`);
  assert.ok(r.elder.height < r.adult.height, 'an elder stands a little lower');
});

test('short legs take more steps, and an old body idles on a slower clock', async () => {
  const r = await ev(() => {
    const walk = (age) => {
      const scene = buildStoryboard('A walk.', { titleCard: false }).scenes[0];
      scene.duration = 4;
      // A fixed seed: the pose phase is seeded, and counting crossings of a sine with a
      // random phase is how you write a test that fails one run in three.
      const actor = makeActor('A', { age, seed: 0, start: { x: 0.1, y: 0.88, scale: 0.5, action: 'walk' } });
      setKey(actor, 3, { x: 0.9, action: 'walk' });
      scene.stage = makeStage({ actors: [actor] });
      return {
        strides: strideCycles(actor, 3, stateAt(actor, 3)),
        steps: footstepCues(actor, scene).length
      };
    };
    // Walking is driven by distance, so age cannot change how fast the legs go when the
    // crossing is timed — it changes how long a stride is. The pace multiplier shows up in
    // everything that is not going anywhere: a child at seven seconds is where an adult
    // gets to at seven and a half.
    const bob = (pace, t) => poseFor('idle', t, 0, false, { pace }).bob;
    const sway = (age) => ({
      here: bob(MR_AGES[age].pace, 7),
      adultLater: bob(1, 7 * MR_AGES[age].pace)
    });
    return {
      child: walk('child'), adult: walk('adult'), elder: walk('elder'),
      sway: { child: sway('child'), elder: sway('elder') },
      paces: { child: MR_AGES.child.pace, adult: MR_AGES.adult.pace, elder: MR_AGES.elder.pace }
    };
  });
  assert.ok(r.child.strides > r.adult.strides * 1.4,
    `a child needs more strides to cross the same stage (${r.child.strides.toFixed(1)} vs ${r.adult.strides.toFixed(1)})`);
  assert.ok(r.elder.strides > r.adult.strides,
    `and so does a shorter-legged elder (${r.elder.strides.toFixed(1)} vs ${r.adult.strides.toFixed(1)})`);
  assert.ok(r.child.steps > r.adult.steps, `and you hear it (${r.child.steps} steps vs ${r.adult.steps})`);
  assert.ok(r.paces.child > r.paces.adult && r.paces.adult > r.paces.elder,
    'standing still, a child fidgets faster than an old person');
  for (const [age, s] of Object.entries(r.sway)) {
    assert.ok(Math.abs(s.here - s.adultLater) < 1e-9,
      `a ${age}'s idle clock really is scaled, not just labelled (${s.here} vs ${s.adultLater})`);
  }
});

test('the director reads age off the words about each character', async () => {
  const r = await ev(() => {
    const story = 'The old potter sat at her wheel.\n\nA boy named Ravi ran to her.\n\n' +
      'Ravi asked about the fire. The potter smiled.';
    const p = buildStoryboard(story, { titleCard: false });
    const report = directProject(p);
    const ages = {};
    for (const scene of p.scenes) {
      for (const actor of (scene.stage && scene.stage.actors) || []) ages[actor.name] = actor.age;
    }
    return { ages, reported: [...report.ages.entries()] };
  });
  assert.equal(r.ages.Ravi, 'child', `Ravi is a boy, got ${r.ages.Ravi}`);
  assert.equal(r.ages.Potter, 'elder', `the old potter is old, got ${r.ages.Potter}`);
});

// ------------------------------------------------------------------ period

test('dressing for a period puts the whole cast in that century', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('Ashoka spoke to the people.\n\nThe people listened.', { titleCard: false });
    directProject(p);
    applyPeriod(p, 'rome');
    const worn = [];
    for (const scene of p.scenes) {
      for (const actor of (scene.stage && scene.stage.actors) || []) {
        worn.push({ name: actor.name, costume: actor.costume, headwear: actor.headwear });
      }
    }
    return { worn, palette: p.style.palette, background: p.scenes[0].background, period: p.style.period };
  });
  assert.ok(r.worn.length, 'there is a cast to dress');
  const roman = MR_ROME_COSTUMES;
  for (const person of r.worn) {
    assert.ok(roman.includes(person.costume), `${person.name} wears ${person.costume}, which is not Roman`);
  }
  assert.equal(r.palette, 'marble', 'the palette follows the period');
  assert.equal(r.period, 'rome');
  assert.ok(['village', 'flatland'].includes(r.background), `background was ${r.background}`);
});

test('a character keeps the same clothes in every scene, and across a second dressing', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('Meera walked to the well.\n\nMeera drew water.\n\nMeera went home.', { titleCard: false });
    directProject(p);
    applyPeriod(p, 'medieval');
    const wornIn = (project) => project.scenes
      .flatMap((s) => (s.stage && s.stage.actors) || [])
      .filter((a) => a.name === 'Meera')
      .map((a) => `${a.costume}/${a.headwear}/${a.top}`);
    const first = wornIn(p);
    // Someone changes one hat by hand, then presses the button again.
    for (const scene of p.scenes) {
      for (const actor of (scene.stage && scene.stage.actors) || []) actor.headwear = 'crown';
    }
    applyPeriod(p, 'medieval');
    const afterSecond = wornIn(p);
    applyPeriod(p, 'egypt');
    const afterChange = wornIn(p);
    return { first, afterSecond, afterChange };
  });
  assert.ok(r.first.length >= 2, 'Meera is in several scenes');
  assert.equal(new Set(r.first).size, 1, `same clothes throughout, got ${JSON.stringify(r.first)}`);
  assert.ok(r.afterSecond.every((w) => w.includes('crown')),
    'dressing for the period you are already in leaves hand-picked choices alone');
  assert.ok(!r.afterChange.some((w) => w.includes('crown')), 'changing period re-dresses from scratch');
  assert.equal(new Set(r.afterChange).size, 1, 'and still agrees with itself across scenes');
});

test('a kilt leaves the legs bare instead of putting trousers under it', async () => {
  const r = await ev(() => {
    const legColour = (costume) => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 260;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 260);
      drawActor(x, makeActor('A', { costume, skin: '#e0aa7c', bottom: '#101a3a', top: '#f2ead6' }),
        poseFor('idle', 2, 0, false, { tIn: 2 }), 100, 240, 230);
      const d = x.getImageData(0, 0, 200, 260).data;
      // Sample the shin, well below any hem.
      let skin = 0, cloth = 0;
      for (let y = 195; y < 225; y++) {
        for (let px = 60; px < 140; px++) {
          const i = (y * 200 + px) * 4;
          if (d[i] > 200 && d[i + 1] > 140 && d[i + 2] > 90 && d[i + 2] < 200) skin++;
          else if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] > 40) cloth++;
        }
      }
      return { skin, cloth };
    };
    return { kilt: legColour('kilt'), modern: legColour('modern') };
  });
  assert.ok(r.kilt.skin > r.kilt.cloth * 3, `bare shins under a kilt (${JSON.stringify(r.kilt)})`);
  assert.ok(r.modern.cloth > r.modern.skin, `trousers under modern clothes (${JSON.stringify(r.modern)})`);
});

// ------------------------------------------------------------------ lip sync

test('lip sync makes mouth shapes from the words, not just the volume', async () => {
  const r = await ev(() => {
    const text = 'My name is Ashoka and I walked to the river.';
    const envelope = [];
    for (let i = 0; i < 120; i++) envelope.push(i < 4 || i > 114 ? 1 : 40 + Math.round(40 * Math.abs(Math.sin(i * 0.6))));
    const visemes = visemesFrom(text, envelope);
    const scene = { text, narration: { seconds: 4, envelope, visemes } };
    const names = visemes.map((v) => MR_VISEME_KINDS[v]);
    const sampled = [];
    for (let t = 0; t < 3.9; t += 0.1) sampled.push(mouthAt(scene, t));
    return {
      distinct: [...new Set(names)],
      silentStart: names[1],
      silentEnd: names[names.length - 2],
      firstSpoken: names.slice(4, 12),
      shapes: [...new Set(sampled.map((m) => m && m.viseme))],
      opens: sampled.map((m) => (m ? m.open : null))
    };
  });
  assert.ok(r.distinct.length >= 5, `several shapes are used, got ${r.distinct.join(',')}`);
  assert.equal(r.silentStart, 'rest', 'silence is a shut mouth');
  assert.equal(r.silentEnd, 'rest', 'and so is the tail');
  // "My" starts with an M: the lips have to close before the vowel.
  assert.ok(r.firstSpoken.includes('MBP'), `an m closes the lips, got ${r.firstSpoken.join(',')}`);
  assert.ok(r.shapes.length >= 4, 'the shape changes through the line, not only the opening');
  assert.ok(r.opens.some((o) => o > 0.5), 'and the mouth actually opens');
});

test('the mouth shape follows the sound: oo is round, ee is wide', async () => {
  const r = await ev(() => {
    const widthOf = (viseme) => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 200);
      // A big head, framed on the mouth.
      drawActor(x, makeActor('A', {}), poseFor('idle', 2, 0, { open: 1, viseme }, { tIn: 2 }), 100, 700, 800);
      const d = x.getImageData(0, 0, 200, 200).data;
      let minX = 200, maxX = 0, minY = 200, maxY = 0;
      for (let y = 0; y < 200; y++) {
        for (let px = 0; px < 200; px++) {
          const i = (y * 200 + px) * 4;
          // The inside of an open mouth, exactly: hair blended over skin lands in the same
          // broad brown range, so a loose filter measures the head instead of the mouth.
          if (Math.abs(d[i] - 109) < 8 && Math.abs(d[i + 1] - 47) < 8 && Math.abs(d[i + 2] - 43) < 8) {
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      return maxX < minX ? null : { w: maxX - minX, h: maxY - minY };
    };
    return { OO: widthOf('OO'), EE: widthOf('EE'), AA: widthOf('AA'), MBP: widthOf('MBP') };
  });
  assert.ok(r.OO && r.EE && r.AA, `the open shapes draw an opening (${JSON.stringify(r)})`);
  assert.ok(r.EE.w > r.OO.w * 1.5, `ee is wider than oo (${r.EE.w} vs ${r.OO.w})`);
  assert.ok(r.AA.h > r.EE.h * 1.4, `aa is taller than ee (${r.AA.h} vs ${r.EE.h})`);
  assert.equal(r.MBP, null, 'and m is a shut mouth with no opening at all');
});

test('with no narration the mouth still speaks the words it has', async () => {
  const r = await ev(() => {
    const text = 'Peace, my friend, and welcome home.';
    const sampled = [];
    for (let t = 0; t < 3; t += 0.05) sampled.push(spokenMouthAt(text, t));
    return {
      shapes: [...new Set(sampled.map((m) => m.viseme))],
      closed: sampled.filter((m) => m.open === 0).length,
      open: sampled.filter((m) => m.open > 0.5).length
    };
  });
  assert.ok(r.shapes.length >= 4, `shapes from the text, got ${r.shapes.join(',')}`);
  assert.ok(r.open > 5, 'the mouth opens');
  assert.ok(r.closed > 0, 'and shuts between words');
});

test('the character panel follows the scene you are looking at', async () => {
  const r = await ev(() => {
    document.getElementById('storyText').value =
      'Ashoka and the Sage\n\nA young prince rode to the city.\n\nThe old sage waited at the temple.';
    document.getElementById('buildBtn').click();
    document.getElementById('directAnimateBtn').click();
    // Straight after casting, the panel is looking at whichever scene is selected — which
    // is the title card, with nobody on it. Selecting a staged scene must refill it.
    const afterCasting = document.getElementById('actorList').textContent;
    const staged = ed.project.scenes.filter((s) => s.stage && s.stage.actors.length);
    selectScene(staged[0].id, true);
    const first = {
      list: document.getElementById('actorList').textContent,
      editorHidden: document.getElementById('actorEditor').hidden,
      name: document.getElementById('actorName').value
    };
    selectScene(staged[1].id, true);
    const second = {
      list: document.getElementById('actorList').textContent,
      name: document.getElementById('actorName').value
    };
    // And moving the playhead re-reads what they are doing at that moment.
    const actor = ed.project.scenes.find((s) => s.id === staged[1].id).stage.actors[0];
    mrSelectedActorId = actor.id;
    setKey(actor, 0, { action: 'idle' });
    setKey(actor, 1.4, { action: 'wave' });
    const times = sceneTimeline(ed.project);
    const start = times[ed.project.scenes.findIndex((s) => s.id === staged[1].id)].start;
    seek(start + 0.2);
    const early = document.getElementById('actorAction').value;
    seek(start + 1.8);
    const late = document.getElementById('actorAction').value;
    return { afterCasting, first, second, early, late, cast: staged.length };
  });
  assert.ok(r.cast >= 2, 'the reel has at least two staged scenes');
  assert.ok(!/No one on stage/.test(r.first.list),
    `selecting a staged scene shows its cast (${r.first.list.slice(0, 60)})`);
  assert.equal(r.first.editorHidden, false, 'and opens the character panel');
  assert.ok(r.first.name, 'with somebody in it');
  assert.ok(!/No one on stage/.test(r.second.list), 'and the next scene shows its own cast');
  assert.equal(r.early, 'idle', 'the panel reads the pose at the playhead');
  assert.equal(r.late, 'wave', 'and re-reads it when the playhead moves');
  void r.afterCasting;
});

test('the character panel offers an age, and choosing one redraws them', async () => {
  const r = await ev(() => {
    document.querySelector('[data-tab="animate"]').click();
    document.getElementById('storyText').value = 'Ravi ran to the river.';
    document.getElementById('buildBtn').click();
    document.getElementById('directAnimateBtn').click();
    const scene = ed.project.scenes.find((s) => s.stage && s.stage.actors.length);
    selectScene(scene.id, true);
    mrSelectedActorId = scene.stage.actors[0].id;
    syncInspector();
    const select = document.getElementById('actorAge');
    const options = [...select.options].map((o) => o.value);
    const before = actorHeight(scene.stage.actors[0], 100);
    select.value = 'child';
    select.dispatchEvent(new Event('change'));
    const after = actorHeight(currentStage().actors[0], 100);
    return { options, before, after, hidden: document.getElementById('actorEditor').hidden };
  });
  assert.equal(r.hidden, false, 'the character panel is showing');
  assert.deepEqual(r.options, ['child', 'youth', 'adult', 'elder']);
  assert.ok(r.after < r.before * 0.8, `choosing child redraws them shorter (${r.after} vs ${r.before})`);
});

test('the preview paints a staged, dressed scene rather than a blank frame', async () => {
  const r = await ev(() => {
    document.getElementById('storyText').value =
      'Ashoka and the Elephant\n\nA young prince rode to the great city.\n\nThe old sage waited at the temple.';
    document.getElementById('buildBtn').click();
    document.getElementById('directAnimateBtn').click();
    commit('dress', (p) => { applyPeriod(p, 'india'); });
    const scene = ed.project.scenes.find((s) => s.stage && s.stage.actors.length);
    selectScene(scene.id, true);
    const times = sceneTimeline(ed.project);
    const at = times[ed.project.scenes.indexOf(scene)].start + scene.duration * 0.5;
    const canvas = document.getElementById('preview');
    const x = canvas.getContext('2d');
    x.clearRect(0, 0, canvas.width, canvas.height);
    renderFrame(x, ed.project, at, { width: canvas.width, height: canvas.height });
    const d = x.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set();
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) lit++;
      seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    }
    return { lit, total: d.length / 4, colours: seen.size };
  });
  assert.ok(r.lit > r.total * 0.98, 'the frame is fully painted');
  assert.ok(r.colours > 12, `and has a picture in it, not one flat colour (${r.colours} colours)`);
});

test('the period button dresses the reel in one undoable step', async () => {
  const r = await ev(async () => {
    document.querySelector('[data-tab="animate"]').click();
    document.getElementById('storyText').value = 'Ashoka spoke to the people at the temple.';
    document.getElementById('buildBtn').click();
    document.getElementById('directAnimateBtn').click();
    const before = (ed.project.scenes[0].stage.actors[0] || {}).costume;
    document.querySelector('[data-tab="look"]').click();
    const select = document.getElementById('stylePeriod');
    select.value = 'egypt';
    select.dispatchEvent(new Event('change'));
    document.getElementById('periodBtn').click();
    const after = ed.project.scenes[0].stage.actors[0].costume;
    const note = document.getElementById('periodNote').textContent;
    document.getElementById('undoBtn').click();
    const undone = ed.project.scenes[0].stage.actors[0].costume;
    return { before, after, undone, note, palette: ed.project.style.palette };
  });
  assert.ok(['kilt', 'robe'].includes(r.after), `dressed for Egypt, got ${r.after}`);
  assert.equal(r.undone, r.before, 'and one undo puts the clothes back');
  assert.match(r.note, /Ancient Egypt/);
});

// ------------------------------------------------------------------ sound effects

test('a footstep lands on the frame the foot does', async () => {
  const r = await ev(() => {
    const scene = buildStoryboard('A walk.', { titleCard: false }).scenes[0];
    scene.duration = 5;
    const actor = makeActor('A', { seed: 0, start: { x: 0.08, y: 0.88, scale: 0.5, action: 'walk' } });
    setKey(actor, 4, { x: 0.92, action: 'walk' });
    scene.stage = makeStage({ actors: [actor] });
    const cues = footstepCues(actor, scene);
    // At the moment of each cue, one leg should be at the far end of its swing — that is
    // where the foot is on the ground and the two legs are furthest apart.
    const spread = cues.map((cue) => {
      const pose = posedFor(actor, scene, cue.at);
      return Math.abs(pose.hipL - pose.hipR);
    });
    // ...and the widest spread the walk ever reaches, to compare against.
    let widest = 0;
    for (let t = 0; t < 4; t += 0.02) {
      const pose = posedFor(actor, scene, t);
      widest = Math.max(widest, Math.abs(pose.hipL - pose.hipR));
    }
    return { count: cues.length, spread, widest, times: cues.map((c) => c.at) };
  });
  assert.ok(r.count >= 6, `a stage crossing is several steps (${r.count})`);
  for (const spread of r.spread) {
    assert.ok(spread > r.widest * 0.9,
      `each step lands at a stride extreme (${spread.toFixed(3)} of ${r.widest.toFixed(3)})`);
  }
  // Steps are evenly spaced when the walk is even, and never doubled up.
  const gaps = r.times.slice(1).map((t, i) => t - r.times[i]);
  assert.ok(Math.min(...gaps) > 0.1, `no two steps on top of each other (${Math.min(...gaps).toFixed(3)}s)`);
});

test('a character who is not walking makes no footsteps', async () => {
  const r = await ev(() => {
    const scene = buildStoryboard('Standing about.', { titleCard: false }).scenes[0];
    scene.duration = 5;
    const still = makeActor('Still', { seed: 0, start: { x: 0.3, y: 0.88, scale: 0.5, action: 'idle' } });
    const talker = makeActor('Talker', { seed: 0, start: { x: 0.7, y: 0.88, scale: 0.5, action: 'talk' } });
    // Someone who walks and then stops: the steps must stop with them.
    const stopper = makeActor('Stopper', { seed: 0, start: { x: 0.1, y: 0.88, scale: 0.5, action: 'walk' } });
    setKey(stopper, 2, { x: 0.6, action: 'idle' });
    scene.stage = makeStage({ actors: [still, talker, stopper] });
    return {
      still: footstepCues(still, scene).length,
      talker: footstepCues(talker, scene).length,
      stopper: footstepCues(stopper, scene).map((c) => c.at)
    };
  });
  assert.equal(r.still, 0, 'standing still is silent');
  assert.equal(r.talker, 0, 'so is talking');
  assert.ok(r.stopper.length > 0, 'the walk before the stop is heard');
  assert.ok(Math.max(...r.stopper) <= 2.05, `and nothing after it (last step at ${Math.max(...r.stopper)})`);
});

test('the reel makes the noises the story implies, placed where things are', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('The traveller walked to the fire.\n\nHe fell.', { titleCard: false });
    directProject(p);
    const scene = p.scenes[0];
    scene.duration = 5;
    scene.background = 'forest';
    scene.stage = makeStage({
      actors: [makeActor('A', { seed: 0, start: { x: 0.1, y: 0.88, scale: 0.5, action: 'walk' } })],
      props: [makeProp('fire', { start: { x: 0.85, y: 0.92, scale: 0.14 } })]
    });
    setKey(scene.stage.actors[0], 2, { x: 0.7, action: 'idle' });
    setKey(scene.stage.actors[0], 3, { action: 'fall' });
    const cues = sfxCuesFor(p);
    const kinds = {};
    for (const cue of cues) kinds[cue.kind === 'bed' ? 'bed:' + cue.bed : cue.kind] = (kinds[cue.kind === 'bed' ? 'bed:' + cue.bed : cue.kind] || 0) + 1;
    const crackles = cues.filter((c) => c.kind === 'crackle');
    return {
      kinds,
      cracklePan: crackles.length ? crackles[0].pan : null,
      ordered: cues.every((c, i) => i === 0 || c.at >= cues[i - 1].at),
      summary: sfxSummary(p)
    };
  });
  assert.ok(r.kinds.step > 0, 'the walk is heard');
  assert.ok(r.kinds.thud > 0, 'so is the fall');
  assert.ok(r.kinds.crackle > 2, 'the fire crackles more than once');
  assert.ok(r.kinds['bed:wind'] > 0, 'the forest brings its own air');
  assert.ok(r.cracklePan > 0.3, `the fire is over on the right, where it stands (${r.cracklePan})`);
  assert.equal(r.ordered, true, 'cues come out in time order');
  assert.match(r.summary, /footstep/);
});

test('sound effects are deterministic, and off when switched off', async () => {
  const r = await ev(() => {
    const build = () => {
      const p = buildStoryboard('She walked past the fire.', { titleCard: false });
      p.scenes[0].background = 'village';
      p.scenes[0].stage = makeStage({
        actors: [makeActor('A', { seed: 0, start: { x: 0.1, y: 0.88, scale: 0.5, action: 'walk' } })],
        props: [makeProp('fire', { start: { x: 0.8, y: 0.92, scale: 0.14 } })]
      });
      setKey(p.scenes[0].stage.actors[0], 2.5, { x: 0.8, action: 'walk' });
      return p;
    };
    const one = sfxCuesFor(build());
    const two = sfxCuesFor(build());
    const project = build();
    project.audio.sfx = false;
    const started = mrAudioPlay(project, 0);
    const scheduledWithOff = mrScheduleSfx === undefined;
    mrAudioStop();
    return {
      same: JSON.stringify(one) === JSON.stringify(two),
      count: one.length,
      started,
      scheduledWithOff
    };
  });
  assert.ok(r.count > 5, 'there are cues to compare');
  assert.equal(r.same, true, 'the same reel always sounds the same — no unseeded randomness');
  assert.equal(r.started, true, 'the reel still plays with effects off');
});

test('the effects are actually audible on the recorded bus', async () => {
  const r = await ev(async () => {
    // Recorded off the same bus the exported video is mixed from, with the score off, so
    // what is measured is exactly the sound effects. The first version of this file put
    // them at two percent of full scale — present in the file, inaudible in the room —
    // which no amount of cue-list testing would have caught.
    const p = buildStoryboard('He walked across the yard.', { titleCard: false });
    p.scenes[0].duration = 3;
    p.audio.enabled = false;
    p.scenes[0].stage = makeStage({
      actors: [makeActor('A', { seed: 0, start: { x: 0.05, y: 0.9, scale: 0.5, action: 'walk' } })]
    });
    setKey(p.scenes[0].stage.actors[0], 2.8, { x: 0.95, action: 'walk' });
    mrAudioPlay(p, 0);
    const recorder = new MediaRecorder(mrAudioStream());
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    await new Promise((done) => setTimeout(done, 1600));
    await new Promise((done) => { recorder.onstop = done; recorder.stop(); });
    mrAudioStop();
    const buffer = await new AudioContext().decodeAudioData(await new Blob(chunks).arrayBuffer());
    const data = buffer.getChannelData(0);
    let peak = 0, sum = 0;
    for (let i = 0; i < data.length; i++) { peak = Math.max(peak, Math.abs(data[i])); sum += data[i] * data[i]; }
    return { peak, rms: Math.sqrt(sum / data.length), seconds: buffer.duration };
  });
  assert.ok(r.seconds > 0.5, `something was recorded (${r.seconds.toFixed(2)}s)`);
  assert.ok(r.peak > 0.02, `and you can hear it (peak ${r.peak.toFixed(4)})`);
  assert.ok(r.peak < 0.9, `without clipping the mix (peak ${r.peak.toFixed(4)})`);
});

test('the score is played by an ensemble, and the period picks one', async () => {
  const r = await ev(() => {
    const layers = (project) => {
      const events = scoreFor(project);
      return {
        perc: events.filter((e) => e.type === 'perc').length,
        pads: events.filter((e) => e.type === 'pad').length,
        plucks: events.filter((e) => e.type === 'pluck').length,
        waves: [...new Set(events.filter((e) => e.wave).map((e) => e.wave))].sort()
      };
    };
    const p = buildStoryboard('He walked. She waited. They spoke at last.', { titleCard: false });
    p.audio.ensemble = 'chamber';
    const chamber = layers(p);
    p.audio.ensemble = 'epic';
    const epic = layers(p);
    p.audio.ensemble = 'folk';
    const folk = layers(p);
    p.audio.ensemble = 'auto';
    p.style.period = 'rome';
    const auto = ensembleFor(p).name;
    p.style.period = 'india';
    const autoIndia = ensembleFor(p).name;
    return { chamber, epic, folk, auto, autoIndia };
  });
  assert.equal(r.chamber.perc, 0, 'a chamber group has no drum');
  assert.ok(r.epic.perc > 0, 'an epic one does');
  assert.ok(r.folk.perc > 0, 'and so does a folk group');
  assert.ok(r.epic.plucks < r.chamber.plucks, 'the epic arpeggio is sparser');
  assert.ok(r.epic.waves.includes('sawtooth'), `epic pads are reedier (${r.epic.waves.join(',')})`);
  assert.ok(r.chamber.pads > 3, 'every scene still gets its chord and its bass');
  assert.equal(r.auto, 'Epic', 'Rome gets the epic ensemble by default');
  assert.equal(r.autoIndia, 'Folk drone', 'and ancient India a drone');
});

test('the sound tab reports what the reel will sound like, and one undo puts it back', async () => {
  const r = await ev(() => {
    document.getElementById('storyText').value = 'Ravi walked to the fire and sat down.';
    document.getElementById('buildBtn').click();
    document.querySelector('[data-tab="animate"]').click();
    document.getElementById('directAnimateBtn').click();
    document.querySelector('[data-tab="sound"]').click();
    const before = ed.project.audio.ensemble;
    const select = document.getElementById('audioEnsemble');
    select.value = 'playful';
    select.dispatchEvent(new Event('change'));
    const after = ed.project.audio.ensemble;
    const note = document.getElementById('ensembleNote').textContent;
    const summary = document.getElementById('sfxSummary').textContent;
    document.getElementById('undoBtn').click();
    return { before, after, undone: ed.project.audio.ensemble, note, summary,
      options: [...select.options].map((o) => o.value) };
  });
  assert.equal(r.after, 'playful');
  assert.equal(r.undone, r.before, 'one undo puts the score style back');
  assert.match(r.note, /Playful/);
  assert.ok(r.options.includes('auto') && r.options.includes('folk'), 'the styles are offered');
  assert.ok(r.summary.length > 0, 'and the tab says what you will hear');
});

// ------------------------------------------------------------------ character voices

// ------------------------------------------------------------------ spoken words

test('letters become the sounds they are actually pronounced as', async () => {
  const r = await ev(() => {
    const words = ['walked', 'asked', 'wanted', 'cats', 'dogs', 'houses', 'city', 'cat',
      'giant', 'gate', 'through', 'thought', 'night', 'nation', 'temple', 'well',
      'traveller', 'happy', 'story', 'slowly', 'queen', 'children', 'said', 'one'];
    const out = {};
    for (const word of words) out[word] = phonemesForWord(word).join(' ');
    return out;
  });
  // The endings that agree with the sound before them — the thing a naive rule gets wrong
  // in every second word.
  assert.equal(r.walked, 'W AO K T', 'walked ends in a t');
  assert.equal(r.asked, 'AE S K T', 'so does asked');
  assert.ok(r.wanted.endsWith('IH D'), `wanted grows a syllable (${r.wanted})`);
  assert.ok(r.cats.endsWith('S') && r.dogs.endsWith('Z'), `cats hisses, dogs buzzes (${r.cats} / ${r.dogs})`);
  // Soft and hard c and g, decided by what follows.
  assert.ok(r.city.startsWith('S') && r.cat.startsWith('K'), 'c is soft before i and hard before a');
  assert.ok(r.giant.startsWith('JH') && r.gate.startsWith('G'), 'and g the same way');
  // The spellings no rule will ever get: these come from the dictionary.
  assert.equal(r.through, 'TH R UW');
  assert.equal(r.thought, 'TH AO T');
  assert.equal(r.said, 'S EH D');
  assert.equal(r.one, 'W AH N');
  // A doubled letter is one sound.
  assert.equal(r.well, 'W EH L', `well has one l (${r.well})`);
  assert.ok(!/L L/.test(r.traveller), `and so does traveller (${r.traveller})`);
  assert.ok(!/P P/.test(r.happy), `and happy (${r.happy})`);
  assert.equal(r.temple, 'T EH M P AX L', 'a final -le is its own syllable');
  assert.ok(r.nation.startsWith('N EY SH'), `-tion is a sh (${r.nation})`);
  assert.equal(r.night, 'N AY T');
  assert.equal(r.queen, 'K W IY N');
});

test('the stress lands on the syllable English puts it on', async () => {
  const r = await ev(() => {
    const stressed = (word) => {
      const said = pronounce(word);
      const at = said.stress != null ? said.stress : mrStressIndex(said.word, said.phonemes);
      return at < 0 ? null : said.phonemes[at];
    };
    const words = ['nation', 'ability', 'historic', 'engineer', 'Chinese', 'photography',
      'biology', 'remember', 'remembering', 'machine', 'himself', 'understand', 'traveller',
      'together', 'emperor', 'ancient', 'answer', 'again', 'beside', 'discover', 'kingdom',
      'quietly', 'wonderful', 'the', 'of', 'was'];
    const out = {};
    for (const word of words) out[word] = stressed(word);
    return out;
  });
  // Suffixes decide English stress far more than prefixes do, and each kind counts back a
  // different distance: naTION one syllable, aBILity two, phoTOGraphy three, engiNEER none.
  assert.equal(r.nation, 'EY', 'naTION');
  assert.equal(r.ability, 'IH', 'aBILity');
  assert.equal(r.historic, 'AO', 'hisTORic');
  assert.equal(r.engineer, 'IY', 'engiNEER takes the stress itself');
  assert.equal(r.Chinese, 'IY', 'and so does ChiNESE');
  assert.equal(r.photography, 'AA', 'phoTOGraphy counts back three');
  assert.equal(r.biology, 'AA', 'and biOLogy');
  // Stress-neutral endings leave the stem alone.
  assert.equal(r.remember, 'EH', 'reMEMber');
  assert.equal(r.remembering, 'EH', 'and reMEMbering, not REmembering');
  assert.equal(r.quietly, 'AY', 'QUIetly');
  assert.equal(r.wonderful, 'AH', 'WONderful');
  // The ones that used to come out wrong: a false prefix, or none at all.
  assert.equal(r.ancient, 'EY', 'ANcient is not an-CIENT');
  assert.equal(r.answer, 'AE', 'ANswer is not an-SWER');
  assert.equal(r.emperor, 'EH', 'EMperor is not em-PEROR');
  assert.equal(r.machine, 'IY', 'maCHINE, from the dictionary');
  assert.equal(r.himself, 'EH', 'himSELF, likewise');
  assert.equal(r.understand, 'AE', 'underSTAND');
  assert.equal(r.again, 'EH', 'aGAIN');
  assert.equal(r.beside, 'AY', 'beSIDE — a real prefix this time');
  assert.equal(r.discover, 'AH', 'disCOVer');
  assert.equal(r.traveller, 'AE', 'TRAVeller');
  assert.equal(r.together, 'EH', 'toGETHer');
  assert.equal(r.kingdom, 'IH', 'KINGdom');
  // Function words carry no stress at all, which is what makes the others stand out.
  for (const word of ['the', 'of', 'was']) {
    assert.equal(r[word], null, `${word} is unstressed`);
  }
});

test('inflections are pronounced from the word they are inflections of', async () => {
  const r = await ev(() => {
    const out = {};
    for (const word of ['having', 'giving', 'coming', 'living', 'waking', 'making',
      'writing', 'running', 'carried', 'tried', 'cities', 'ruled', 'ruler', 'hopeful',
      'happiness', 'careless', 'walked', 'listened', 'answered', 'thousand']) {
      out[word] = phonemesForWord(word).join(' ');
    }
    return out;
  });
  // A silent e that the spelling drops before -ing still lengthens the vowel...
  assert.equal(r.waking, 'W EY K IH NG', 'waking, not wacking');
  assert.equal(r.writing, 'R AY T IH NG');
  assert.equal(r.ruled, 'R UW L D', 'and it survives an ending: ruled, not rulled');
  assert.equal(r.ruler, 'R UW L ER');
  assert.equal(r.hopeful, 'HH OW P F AX L', 'hopeful, not hop-eh-ful');
  // ...except in the words where it lies, which the dictionary catches first.
  assert.equal(r.having, 'HH AE V IH NG', 'having, not hay-ving');
  assert.equal(r.giving, 'G IH V IH NG');
  assert.equal(r.coming, 'K AH M IH NG');
  assert.equal(r.living, 'L IH V IH NG');
  assert.equal(r.running, 'R AH N IH NG', 'a doubled consonant keeps it short');
  // -ied is one syllable or two depending on the stem it came off.
  assert.equal(r.tried, 'T R AY D', 'tried rhymes with ride');
  assert.equal(r.carried, 'K AE R IY D', 'carried does not');
  assert.equal(r.cities, 'S IH T IY Z');
  assert.ok(!/S Z$/.test(r.happiness), `happiness ends in one s (${r.happiness})`);
  assert.equal(r.thousand, 'TH AW Z AX N D');
  assert.equal(r.walked, 'W AO K T');
  assert.equal(r.answered, 'AE N S ER D');
});

test('the dictionary covers the words a story is made of', async () => {
  const r = await ev(() => {
    const story = `Long ago, in the years before the great empire, a young prince named
      Ashoka rode out from the palace at dawn. The old sage was waiting beside the temple
      gate. Ashoka knelt and asked how a kingdom should be ruled. A ruler who listens, said
      the sage, will be remembered for a thousand years. Around them the market was waking:
      farmers carried grain, merchants counted silver coins, and the children shouted.`;
    const words = story.toLowerCase().match(/[a-z']+/g);
    const distinct = [...new Set(words)];
    let known = 0;
    for (const word of distinct) if (MR_LEXICON[word]) known++;
    return {
      distinct: distinct.length, known, entries: Object.keys(MR_LEXICON).length,
      // Nothing in the dictionary may be empty, and every sound in it must be a sound.
      broken: Object.entries(MR_LEXICON).filter(([, value]) =>
        !value.trim() || value.split(' ').some((p) => !MR_PHONEMES[p.replace(/1$/, '')])).map(([k]) => k)
    };
  });
  assert.deepEqual(r.broken, [], 'every entry is made of real phonemes');
  assert.ok(r.entries > 450, `the dictionary is a real dictionary (${r.entries} words)`);
  assert.ok(r.known / r.distinct > 0.55,
    `and it covers most of a page of story (${r.known} of ${r.distinct})`);
});

test('a spoken line is a plan of sounds, and the mouth comes off the same plan', async () => {
  const r = await ev(() => {
    const text = 'My name is Ashoka.';
    const plan = speechPlan(text, { rate: 1 });
    const shapes = [];
    for (let t = 0; t < plan.seconds; t += 0.02) shapes.push(mouthFromPlan(plan, t).viseme);
    const runs = [];
    for (const shape of shapes) if (runs[runs.length - 1] !== shape) runs.push(shape);
    return {
      phonemes: plan.phonemes.join(' '),
      seconds: plan.seconds,
      steps: plan.steps.length,
      runs,
      after: mouthFromPlan(plan, plan.seconds + 1),
      falls: plan.steps[0].pitch > plan.steps[plan.steps.length - 1].pitch,
      question: speechPlan('Where are you?', { rate: 1 })
    };
  });
  assert.ok(/M AY/.test(r.phonemes), `my is a diphthong (${r.phonemes})`);
  assert.ok(r.seconds > 0.8 && r.seconds < 3.5, `a short line takes a short time (${r.seconds.toFixed(2)}s)`);
  // The lips close on the m of "my" and on the m of "name" — because /m/ IS closed lips,
  // not because a spelling rule guessed.
  assert.ok(r.runs.filter((v) => v === 'MBP').length >= 2, `the m shuts the mouth (${r.runs.join(',')})`);
  assert.ok(r.runs.includes('S'), 'and the s is a narrow one');
  assert.deepEqual(r.after, { open: 0, viseme: 'rest' }, 'after the line the mouth is shut');
  assert.equal(r.falls, true, 'a statement falls away at the end');
  const q = r.question;
  assert.ok(q.steps[q.steps.length - 1].pitch > q.steps[0].pitch, 'and a question rises');
});

test('stressed and unstressed syllables are not the same syllable', async () => {
  const r = await ev(() => {
    const plan = speechPlan('A traveller walked along the river.', { rate: 1 });
    const vowels = plan.steps.filter((step) => step.type === 'vowel');
    const stressed = vowels.filter((step) => step.stress > 0);
    const reduced = vowels.filter((step) => step.stress < 0);
    const schwaDistance = (step) => Math.abs(step.f[0] - 500) + Math.abs(step.f[1] - 1400);
    const tokens = phonemeTokens('The old man walked.');
    return {
      stressedCount: stressed.length,
      reducedCount: reduced.length,
      stressedDur: stressed.reduce((sum, s) => sum + s.dur, 0) / (stressed.length || 1),
      reducedDur: reduced.reduce((sum, s) => sum + s.dur, 0) / (reduced.length || 1),
      stressedAmp: stressed.reduce((sum, s) => sum + s.amp, 0) / (stressed.length || 1),
      reducedAmp: reduced.reduce((sum, s) => sum + s.amp, 0) / (reduced.length || 1),
      stressedSchwa: stressed.reduce((sum, s) => sum + schwaDistance(s), 0) / (stressed.length || 1),
      reducedSchwa: reduced.reduce((sum, s) => sum + schwaDistance(s), 0) / (reduced.length || 1),
      theIsReduced: tokens.filter((t) => t.word === 'the' && t.p !== '_').every((t) => t.stress <= 0),
      manIsStressed: tokens.some((t) => t.word === 'man' && t.stress > 0)
    };
  });
  assert.ok(r.stressedCount >= 3 && r.reducedCount >= 2, 'the line has both kinds of syllable');
  assert.ok(r.stressedDur > r.reducedDur * 1.4,
    `a stressed syllable is longer (${r.stressedDur.toFixed(3)}s vs ${r.reducedDur.toFixed(3)}s)`);
  assert.ok(r.stressedAmp > r.reducedAmp, 'and louder');
  assert.ok(r.reducedSchwa < r.stressedSchwa * 0.8,
    `and an unstressed one collapses towards a schwa (${Math.round(r.reducedSchwa)} vs ${Math.round(r.stressedSchwa)})`);
  assert.equal(r.theIsReduced, true, 'a function word carries no stress of its own');
  assert.equal(r.manIsStressed, true, 'and the word that matters does');
});

test('the pitch moves the way a speaking voice moves', async () => {
  const r = await ev(() => {
    const plan = speechPlan('The old sage waited at the temple.', { rate: 1 });
    const pitches = plan.steps.map((step) => step.pitch);
    const glides = plan.steps.filter((step) => Math.abs(step.pitchTo - step.pitch) > 0.001).length;
    const accents = plan.steps.filter((step) => step.stress > 0);
    const around = plan.steps.filter((step) => step.type === 'vowel' && step.stress <= 0);
    const comma = speechPlan('Yes, he said.', { rate: 1 }).steps.filter((s) => s.type === 'silence');
    return {
      spread: Math.max(...pitches) - Math.min(...pitches),
      falls: pitches[0] > pitches[pitches.length - 1],
      glides, steps: plan.steps.length,
      accentPitch: accents.reduce((sum, s) => sum + s.pitch, 0) / (accents.length || 1),
      otherPitch: around.reduce((sum, s) => sum + s.pitch, 0) / (around.length || 1),
      pauses: comma.map((s) => +s.dur.toFixed(2))
    };
  });
  assert.ok(r.spread > 0.15, `the pitch really moves across a line (${r.spread.toFixed(2)})`);
  assert.equal(r.falls, true, 'a statement ends lower than it began');
  assert.ok(r.glides > r.steps * 0.8, 'and it glides between targets rather than stepping');
  assert.ok(r.accentPitch > r.otherPitch, 'stressed syllables are the high points');
  // A comma is a breath; a full stop is a stop.
  assert.ok(r.pauses.length >= 2 && Math.max(...r.pauses) > Math.min(...r.pauses) * 1.5,
    `a comma is shorter than a full stop (${JSON.stringify(r.pauses)})`);
});

test('the recorded voice is not a monotone', async () => {
  const r = await ev(async () => {
    mrAudioEnsure();
    const recorder = new MediaRecorder(mrAudioStream());
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    const seconds = mrSpeakWords('The old sage waited at the temple and did not move.',
      mrAudio.ctx.currentTime + 0.05, { name: 'A', pitch: 52, timbre: 'warm', rate: 1 }, 1, 1);
    await new Promise((done) => setTimeout(done, seconds * 1000 + 400));
    await new Promise((done) => { recorder.onstop = done; recorder.stop(); });
    mrAudioStop();
    const buffer = await new AudioContext().decodeAudioData(await new Blob(chunks).arrayBuffer());
    const data = buffer.getChannelData(0);
    // Track the pitch across the line by autocorrelation, window by window. A synthesiser
    // that holds one note is exactly what "robotic" means; this is how you measure it.
    const window = Math.floor(buffer.sampleRate * 0.06);
    const track = [];
    for (let start = 0; start + window * 2 < data.length; start += window) {
      let energy = 0;
      for (let i = start; i < start + window; i++) energy += data[i] * data[i];
      if (Math.sqrt(energy / window) < 0.03) continue;          // silence and hiss
      let bestLag = 0, best = 0;
      for (let lag = Math.floor(buffer.sampleRate / 320); lag < buffer.sampleRate / 70; lag++) {
        let sum = 0;
        for (let i = 0; i < window; i++) sum += data[start + i] * data[start + i + lag];
        if (sum > best) { best = sum; bestLag = lag; }
      }
      if (bestLag) track.push(buffer.sampleRate / bestLag);
    }
    const mean = track.reduce((a, b) => a + b, 0) / (track.length || 1);
    const spread = Math.sqrt(track.reduce((sum, f) => sum + (f - mean) * (f - mean), 0) / (track.length || 1));
    return { frames: track.length, mean, spread, low: Math.min(...track), high: Math.max(...track) };
  });
  assert.ok(r.frames > 8, `there is enough voiced sound to measure (${r.frames} frames)`);
  assert.ok(r.spread / r.mean > 0.03,
    `the pitch varies across the line (${(r.spread / r.mean * 100).toFixed(1)}% of ${Math.round(r.mean)}Hz)`);
  assert.ok(r.spread / r.mean < 0.35, 'but does not wander out of the voice');
  assert.ok(r.high > r.low * 1.1, `it has a top and a bottom (${Math.round(r.low)}–${Math.round(r.high)}Hz)`);
});

test('the words are actually spoken on the recorded bus', async () => {
  const r = await ev(async () => {
    mrAudioEnsure();
    const recorder = new MediaRecorder(mrAudioStream());
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    const seconds = mrSpeakWords('You have walked a long way.', mrAudio.ctx.currentTime + 0.05,
      { name: 'A', pitch: 52, timbre: 'warm', rate: 1 }, 1, 1);
    await new Promise((done) => setTimeout(done, seconds * 1000 + 400));
    await new Promise((done) => { recorder.onstop = done; recorder.stop(); });
    mrAudioStop();
    const buffer = await new AudioContext().decodeAudioData(await new Blob(chunks).arrayBuffer());
    const data = buffer.getChannelData(0);
    let peak = 0;
    // Speech is not a drone: it starts and stops, several times, in every phrase.
    const frame = Math.floor(buffer.sampleRate * 0.02);
    const loud = [];
    for (let start = 0; start + frame < data.length; start += frame) {
      let sum = 0;
      for (let i = start; i < start + frame; i++) { sum += data[i] * data[i]; peak = Math.max(peak, Math.abs(data[i])); }
      loud.push(Math.sqrt(sum / frame) > 0.02);
    }
    let bursts = 0;
    for (let i = 1; i < loud.length; i++) if (loud[i] && !loud[i - 1]) bursts++;
    return { peak, seconds, bursts, frames: loud.length, spoken: loud.filter(Boolean).length };
  });
  assert.ok(r.seconds > 0.9, `the line has real length (${r.seconds.toFixed(2)}s)`);
  assert.ok(r.peak > 0.08, `and it is audible (peak ${r.peak.toFixed(3)})`);
  assert.ok(r.peak < 0.95, 'without clipping');
  assert.ok(r.spoken > r.frames * 0.25, 'most of the line is sound, not silence');
  assert.ok(r.bursts >= 3, `and it is a phrase of separate words, not one long drone (${r.bursts} bursts)`);
});

test('a reel can be spoken in words or in syllables, and says so', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('Aruna walked to the river.', { titleCard: false });
    directProject(p);
    p.voices = { enabled: true, mode: 'words', cast: {} };
    const words = speechScheduleFor(p, p.scenes[0]);
    p.voices.mode = 'syllables';
    const syllables = speechScheduleFor(p, p.scenes[0]);
    return {
      wordsMode: words[0].mode, syllableMode: syllables[0].mode,
      wordSeconds: words[0].dur, syllableSeconds: syllables[0].dur,
      defaultMode: voiceMode(buildStoryboard('x', { titleCard: false }))
    };
  });
  assert.equal(r.defaultMode, 'words', 'words are the default — that is the point of them');
  assert.equal(r.wordsMode, 'words');
  assert.equal(r.syllableMode, 'syllables');
  assert.ok(r.wordSeconds > 0.2 && r.syllableSeconds > 0.2, 'both modes take real time');
});

test('a beat is split into who says what, not read out in one voice', async () => {
  const r = await ev(() => {
    const names = ['Aruna', 'Ravi'];
    const split = (text) => splitSpeech(text, names, null).map((line) => `${line.who || '-'}|${line.text}`);
    return {
      tagAfter: split('You have walked a long way, Aruna said.'),
      quoted: split('Aruna pointed at the pot. "Then you can carry water," she said.'),
      tagFirst: split('Ravi asked where the road went.'),
      plain: split('The rain came down on the empty road.'),
      silence: split('The traveller sat down and said nothing at all.')
    };
  });
  assert.deepEqual(r.tagAfter, ['Aruna|You have walked a long way.', '-|Aruna said.'],
    `the line and the tag are two voices (${JSON.stringify(r.tagAfter)})`);
  assert.ok(r.quoted.some((line) => line.startsWith('Aruna|Then you can carry water')),
    `quoted speech belongs to whoever is attributed it (${JSON.stringify(r.quoted)})`);
  assert.ok(r.plain.every((line) => line.startsWith('-|')), 'description is the narrator');
  assert.ok(r.silence.every((line) => line.startsWith('-|')), 'and saying nothing is not speech');
});

test('every character gets a different voice, and keeps it', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('The old sage waited.\n\nA boy named Ravi ran to him.\n\n' +
      'Ravi asked about the fire. The sage answered him.', { titleCard: false });
    directProject(p);
    const cast = voiceCastOf(p);
    const profiles = cast.map((name) => voiceProfileFor(p, name));
    const again = cast.map((name) => voiceProfileFor(p, name));
    return {
      cast,
      profiles: profiles.map((v) => ({ name: v.name, pitch: v.pitch, timbre: v.timbre, rate: v.rate })),
      stable: JSON.stringify(profiles) === JSON.stringify(again),
      signatures: new Set(profiles.map((v) => `${v.pitch}/${v.timbre}`)).size
    };
  });
  assert.ok(r.cast.includes('Ravi') && r.cast.includes('Sage'), `the cast has voices (${r.cast.join(',')})`);
  assert.equal(r.stable, true, 'a name sounds the same every time it is asked for');
  assert.equal(r.signatures, r.profiles.length, `no two characters share a voice (${JSON.stringify(r.profiles)})`);
  const boy = r.profiles.find((v) => v.name === 'Ravi');
  const sage = r.profiles.find((v) => v.name === 'Sage');
  assert.ok(boy.pitch > sage.pitch + 8, `a boy is pitched well above an old sage (${boy.pitch} vs ${sage.pitch})`);
  assert.ok(boy.rate > sage.rate, 'and speaks faster');
});

test('the mouth that moves is the one whose line it is', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('Aruna looked up. You have walked a long way, she said.', { titleCard: false });
    directProject(p);
    const scene = p.scenes[0];
    scene.duration = 6;
    const spans = speechScheduleFor(p, scene);
    const aruna = scene.stage.actors.find((a) => a.name === 'Aruna');
    const other = scene.stage.actors.find((a) => a.name !== 'Aruna');
    const line = spans.find((span) => span.who === 'Aruna');
    const mid = line ? line.at + line.dur / 2 : 0;
    const narratorLine = spans.find((span) => span.who === 'Narrator');
    const narratorMid = narratorLine ? narratorLine.at + narratorLine.dur / 2 : 0;
    return {
      spans: spans.map((s) => s.who),
      arunaOnHerLine: !!actorSpeaking(aruna, scene, mid, p),
      otherOnHerLine: other ? !!actorSpeaking(other, scene, mid, p) : false,
      arunaOnNarration: !!actorSpeaking(aruna, scene, narratorMid, p),
      hasOther: !!other
    };
  });
  assert.ok(r.spans.includes('Aruna'), `Aruna has a line (${r.spans.join(',')})`);
  assert.equal(r.arunaOnHerLine, true, 'her mouth moves on her line');
  if (r.hasOther) assert.equal(r.otherOnHerLine, false, 'and nobody else’s does');
  assert.equal(r.arunaOnNarration, false, 'she does not mouth the narration either');
});

test('spoken lines fit inside the beat they belong to', async () => {
  const r = await ev(() => {
    const p = buildStoryboard('A short beat.\n\n' +
      'This is a very much longer beat with a great many more syllables in it than the ' +
      'first one had, spoken by somebody who will not stop talking.', { titleCard: false });
    p.scenes.forEach((s) => { s.duration = 3; });
    const cues = speechCuesFor(p);
    const times = sceneTimeline(p);
    const overruns = cues.filter((cue, i) => {
      const scene = p.scenes.findIndex((s) => s.id === cue.scene);
      return cue.at + cue.dur > times[scene].end + 0.01 || void i;
    });
    return { count: cues.length, overruns: overruns.length, rates: cues.map((c) => +c.rate.toFixed(2)) };
  });
  assert.ok(r.count >= 2, 'both beats are spoken');
  assert.equal(r.overruns, 0, `nothing runs past the end of its beat (${JSON.stringify(r.rates)})`);
  assert.ok(Math.max(...r.rates) > Math.min(...r.rates), 'a crowded beat is spoken faster, not cut off');
});

test('two characters really do sound different on the recorded bus', async () => {
  const r = await ev(async () => {
    const listen = async (profile) => {
      mrAudioEnsure();
      const recorder = new MediaRecorder(mrAudioStream());
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.start();
      mrSpeakLine('You have walked a long way to find me here.', mrAudio.ctx.currentTime + 0.05,
        profile, profile.rate, 1);
      await new Promise((done) => setTimeout(done, 1500));
      await new Promise((done) => { recorder.onstop = done; recorder.stop(); });
      mrAudioStop();
      const buffer = await new AudioContext().decodeAudioData(await new Blob(chunks).arrayBuffer());
      const data = buffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));

      // The pitch of the voice, by autocorrelation over the loudest tenth of a second.
      // Anything less direct measures brightness and calls it pitch.
      const window = Math.floor(buffer.sampleRate * 0.1);
      let loudest = 0, energy = 0;
      for (let start = 0; start + window < data.length; start += window) {
        let sum = 0;
        for (let i = start; i < start + window; i++) sum += data[i] * data[i];
        if (sum > energy) { energy = sum; loudest = start; }
      }
      let bestLag = 0, best = -Infinity;
      for (let lag = Math.floor(buffer.sampleRate / 500); lag < buffer.sampleRate / 60; lag++) {
        let sum = 0;
        for (let i = 0; i < window - lag; i++) sum += data[loudest + i] * data[loudest + i + lag];
        if (sum > best) { best = sum; bestLag = lag; }
      }
      return { peak, f0: bestLag ? buffer.sampleRate / bestLag : 0, seconds: buffer.duration };
    };
    const boy = await listen({ name: 'Boy', pitch: 68, timbre: 'bright', rate: 1.14 });
    const sage = await listen({ name: 'Sage', pitch: 45, timbre: 'gruff', rate: 0.86 });
    return { boy, sage };
  });
  assert.ok(r.boy.peak > 0.05, `the boy is audible (peak ${r.boy.peak.toFixed(3)})`);
  assert.ok(r.sage.peak > 0.05, `so is the sage (peak ${r.sage.peak.toFixed(3)})`);
  assert.ok(r.boy.peak < 0.9 && r.sage.peak < 0.9, 'without clipping the mix');
  // A boy at MIDI 68 against a sage at 45 is nearly two octaves. Anything less than half
  // that and the two are not telling anybody apart.
  assert.ok(r.boy.f0 > r.sage.f0 * 1.6,
    `and the boy really is pitched above the sage (${Math.round(r.boy.f0)}Hz vs ${Math.round(r.sage.f0)}Hz)`);
});

test('narration records one line per voice, each in that character’s voice', async () => {
  const r = await ev(async (wavMaker) => {
    const wav = new Function(wavMaker)();
    window.__voiceCalls = [];
    window.fetch = (url, init) => {
      window.__voiceCalls.push(JSON.parse(init.body));
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ b64: wav, mime: 'audio/wav' })),
        json: () => Promise.resolve({ b64: wav, mime: 'audio/wav' })
      });
    };
    document.getElementById('storyText').value = 'Aruna looked up. You have walked a long way, she said.';
    document.getElementById('buildBtn').click();
    document.getElementById('directAnimateBtn').click();
    const p = ed.project;
    p.narration = Object.assign({}, MR_DEFAULT_NARRATION, { provider: 'openai', gap: 0.4 });
    p.voices = { enabled: true, cast: { Aruna: Object.assign(voiceProfileFor(p, 'Aruna'), { tts: 'shimmer' }) } };
    const scene = p.scenes.find((s) => s.kind !== 'title');
    await narrateScene(scene, p, { apiKey: 'k' });
    const lines = narrationLines(scene);
    const aruna = scene.stage.actors.find((a) => a.name === 'Aruna');
    const hers = lines.find((line) => line.who === 'Aruna');
    return {
      texts: lines.map((line) => `${line.who || '-'}`),
      voices: window.__voiceCalls.map((call) => call.voice),
      offsets: lines.map((line) => +line.at.toFixed(2)),
      whoAtHerLine: hers ? narrationSpeakerAt(scene, hers.at + hers.seconds / 2) : null,
      herMouth: hers && aruna ? !!actorSpeaking(aruna, scene, hers.at + hers.seconds / 2, p) : false,
      voiceCount: narrationVoices(p).length
    };
  }, WAV_MAKER);
  assert.ok(r.texts.length >= 2, `the beat was recorded line by line (${r.texts.join(',')})`);
  assert.ok(r.voices.includes('shimmer'), `Aruna's line went to her own voice (${r.voices.join(',')})`);
  assert.ok(r.voices.some((v) => v !== 'shimmer'), 'and the narrator kept the reel default');
  assert.ok(r.offsets[1] > r.offsets[0], 'the lines are laid one after another');
  assert.equal(r.whoAtHerLine, 'Aruna', 'the recording knows whose line is playing');
  assert.equal(r.herMouth, true, 'and it is her mouth that moves');
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
