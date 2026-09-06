# MyRecital

Paste a story, get an animated vertical short — then change anything about it and record
the result as a video file you can upload to YouTube.

No build step, no framework, no backend, no media assets. Every pixel and every note is
generated in the browser from your text.

```
index.html        — the page: three panes (story, preview, tools)
css/styles.css    — all styling
js/story.js       — text → storyboard: sentence splitting, beats, mood, pacing
js/render.js      — the picture: 13 backgrounds, camera moves, captions, transitions
js/audio.js       — the score: synthesised from the scene moods, no audio files
js/export.js      — recording (MediaRecorder), stills, captions, project files
js/editor.js      — the editing tools: timeline, inspector, undo, autosave
js/app.js         — boot
tests/            — the test suite, run against a real browser
scripts/serve.mjs — `npm run serve`, a static server for local development
```

The app is **plain JavaScript with no build step** — `index.html` loads the `js/*.js`
files as ordinary `<script>` tags into one shared global scope, so any file can call
functions defined in an earlier-loaded one, and `app.js` runs last to wire everything up.
To add a feature, extend the relevant module (or add a new `js/*.js` and a `<script>` tag
in dependency order). No bundler, no framework, no `node_modules` at runtime.

## Running it

```sh
npm install     # only needed for the tests and the linter
npm run serve   # then open http://localhost:8080
```

Opening `index.html` directly from disk mostly works, but some browsers block
`localStorage` on `file://`, which is where your project autosaves — so prefer the server.

## How it works

**1 · Words in.** `buildStoryboard()` splits your text into sentences, groups them into
beats that fit one caption, and gives each beat a duration from its word count (2.6
words/second, clamped to 1.8–7s). A short first line becomes a title card. Each beat is
scored against small mood lexicons — tense, dark, action, wonder, joyful, sad, calm — and
the mood picks a background, a camera move and a transition. Consecutive scenes never get
the same background, and a swing into tension cuts hard instead of dissolving. The whole
reel is then squeezed under 60 seconds so it qualifies as a Short.

**2 · A picture out.** `renderFrame(ctx, project, t)` is a pure function: it never reads
the clock, never mutates the project, and draws entirely from the scene's own seed. That
is the load-bearing decision in the app — the preview, the scrubber, the thumbnail strip
and the recorder all call it, so what you scrub past is exactly what gets recorded, and
two renders of the same moment are identical to the pixel.

**3 · Tools, not a re-run.** Because there is no rendered artefact to keep in sync, every
edit is instant: change a background, drag a scene, split a beat, and the next frame just
draws differently. Nothing is ever "re-rendered" until you record.

## What you can change

| Per scene | Globally |
| --- | --- |
| Caption text, duration | Palette (8), typeface (5) |
| Background (13), camera move (8) | Aspect: 9:16, 1:1, 16:9 · 24/30/60 fps |
| Transition in (6), caption style (5) | Grain, vignette, camera amount |
| Caption position, emphasised words | Watermark, progress bar, scene numbers |
| Accent colour, motion amount, seed | Score: on/off, mood, volume, cut accents |

Timeline tools: add, duplicate, delete, reorder (drag or ↑/↓), **split at the playhead**
(divides the words in proportion to where you cut), **merge with next**, **even out
pacing** (redistributes the same total time by word count), and **shuffle looks**
(re-rolls every background and camera move within each scene's mood).

Undo/redo covers everything, and the project autosaves to `localStorage` on every change.

Keyboard: `space` play/pause · `←`/`→` seek (hold shift for one frame) · `↑`/`↓` select
scene · `s` split · `delete` remove scene · `ctrl/cmd+Z` undo.

## Exporting

- **Video** — records in real time through `MediaRecorder`, with the score mixed in via a
  `MediaStreamAudioDestination`. MP4 where the browser supports it, WebM otherwise;
  YouTube accepts both. A 45-second reel takes 45 seconds, and the tab must stay visible
  (a backgrounded tab throttles `requestAnimationFrame`). Draft mode records at half size
  for a quick look.
- **Cover image** — a full-resolution PNG of whatever frame the playhead is on.
- **Captions** — `.srt` and `.vtt`. The burned-in captions are part of the picture; the
  files are what make the video searchable and accessible.
- **Project** — plain JSON, so a reel can be reopened, diffed or handed to someone else.
- **Upload kit** — a title, a description built from the story, and tags pulled from its
  own most-used words, each with a copy button.

## The score

There are no audio files. Each scene's mood chooses a root, a scale, a tempo and a chord;
the whole timeline is scheduled up front as oscillator voices (a pad per scene, an
arpeggio on the beat) plus a filtered noise whoosh on each cut. Re-cut the story and the
music re-writes itself. It is mixed into the recording, not just played locally.

## Limitations, honestly

- **Recording is real-time.** A frame-accurate offline render would need to drop the live
  audio graph, so this trades exactness for a mixed soundtrack in one pass.
- **No narration.** Browser speech synthesis cannot be captured into `MediaRecorder`, so
  a spoken voiceover would play locally and be missing from the file. Rather than ship
  that trap, MyRecital does captions and score only — add narration in your editor if you
  want it, using the exported `.srt` as the script.
- **Mood detection is a hint engine**, not a classifier. It is wrong sometimes; that is
  what the Mood dropdown is for, and a wrong guess costs one click.
- **Safari** needs 14.1+ for `MediaRecorder`. Without it, the video button disables itself
  and the captions, cover image and project file still export.

## Hosting

Static files, so anything serves it: GitHub Pages, Cloudflare Pages, Netlify, Vercel, or
`python3 -m http.server`. `_headers` sets the revalidate policy for Cloudflare Pages and
Netlify; other hosts ignore it harmlessly. There is no backend and no API key anywhere.

## Tests

```sh
npm test     # parser, renderer, editor, recorder
npm run lint
npm run check
```

`tests/app.test.mjs` executes the real shipped functions inside a real Chromium page, so
there is nothing duplicated and nothing mocked. It covers sentence splitting, beat
grouping, mood detection, determinism, the 60-second fit, caption fitting, that every
background actually paints, that `renderFrame` is pure (same time in, same pixels out,
project untouched), the editing tools (split, merge, reorder, pacing, undo/redo, save/open
round trip, autosave), and a real `MediaRecorder` round trip that checks a video file
actually comes out.

CI runs all three on every push and pull request.
