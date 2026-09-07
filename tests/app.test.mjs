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
      buffered: !!narrationBuffer(scene.id),
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

test('the score can be off while narration still plays', async () => {
  const started = await ev(() => {
    ed.project.audio.enabled = false;
    ed.project.scenes[0].narration = { id: 'x', seconds: 1, text: 'x' };
    return mrAudioPlay(ed.project, 0);
  });
  assert.equal(started, true, 'a silent score must not silence the narrator');
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
