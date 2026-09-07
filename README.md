# MyRecital

Paste a story, get an animated vertical short — then change anything about it and record
the result as a video file you can upload to YouTube.

No build step, no framework, no backend, no media assets. Every pixel and every note is
generated in the browser from your text.

```
index.html        — the page: three panes (story, preview, tools)
css/styles.css    — all styling
js/story.js       — text → storyboard: sentence splitting, beats, mood, pacing
js/images.js      — found artwork: Wikimedia Commons search, licence filter, image cache
js/generate.js    — drawn panels: provider adapters, prompt + cast, IndexedDB panel store
js/render.js      — the picture: artwork or 13 procedural backgrounds, camera, captions
js/audio.js       — the score: synthesised from the scene moods, no audio files
js/export.js      — recording (MediaRecorder), stills, captions, project files
js/editor.js      — the editing tools: timeline, inspector, undo, autosave
js/app.js         — boot
tests/            — the test suite, run against a real browser
scripts/serve.mjs — `npm run serve`, a static server for local development
functions/api/image.js — optional: image-model proxy for providers that block browsers
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

**3 · Illustration.** A scene can carry a picture, and then the camera move becomes a Ken
Burns pass over it instead of over a generated background. A picture comes from one of two
places: **drawn** for that beat by an image model in a house style you choose, or **found**
on Wikimedia Commons. Drawing gets you panels of your own story; finding gets you real
paintings for free.

**4 · Tools, not a re-run.** Because there is no rendered artefact to keep in sync, every
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
| Picture, framing, focal point, grade | Style hint for every picture search |

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

## Drawing the panels

Open the **Art** tab, describe your cast, press **Draw every panel**. Each beat becomes a
prompt: one fixed house-style block, the characters named *in that beat* described exactly
as you wrote them, the beat itself, and a rule that the panel must contain no lettering
(the app draws the captions, and a model's attempt at text inside the picture is both
unreadable and off-brand).

**Style presets:** Amar Chitra Katha (default), Tinkle cartoon, ink and wash, block print —
plus a free-text notes field that is appended to every prompt.

**The cast is the point.** A model has no memory between calls, so unless every prompt
describes Arjuna identically you get a different Arjuna in every panel. **Find names in
the story** proposes the recurring proper nouns; you write one description each
("young warrior, green tunic, gold armband, topknot") and that line is reused in every
panel he appears in. This gets you *consistent*, not *identical* — drift across ten panels
is real, and the honest fix for a specific panel is to redraw it.

**Providers.** You bring the key; Claude cannot generate images, so there is no way around
that.

| Provider | Backend needed | Why |
| --- | --- | --- |
| Google Gemini | none | The only one that answers cross-origin browser calls. Key stays in this browser. |
| OpenAI `gpt-image-1` | `functions/api/image.js` | OpenAI's API sends no CORS headers, so a browser cannot call it. |
| Replicate (Flux) | `functions/api/image.js` | Same, and it returns a URL on its own CDN rather than bytes. |

Deploy `functions/api/image.js` to Cloudflare Pages (or move it to `api/image.js` for
Vercel) and set `OPENAI_API_KEY` / `REPLICATE_API_TOKEN` / `GEMINI_API_KEY` in the
environment. The function always returns image *bytes*, never a URL — a foreign image host
would taint the canvas and make the reel unrecordable. A key typed into the app is sent to
your own function only as a fallback for quick trials.

Cost and time land around 1–20¢ and 5–20 seconds per panel depending on provider and size,
so a ten-scene reel is roughly a minute and small change. Panels are drawn one at a time on
purpose: ten parallel calls is the fastest way to get rate-limited half way through.

**Where panels live.** The image bytes go into IndexedDB in *this browser*; the project
file only remembers the panel's id and the prompt that made it. So a saved `.json` stays
small and shareable, but the panels themselves do not travel with it — the exported video
is the artefact that does.

## Illustrating from Wikimedia Commons

Search from the **Picture** tab, or press **Illustrate every scene**. What arrives is
governed by three rules, because an image search that returns anything is worse than one
that returns little:

- **Only publishable licences.** Public domain and CC0 are offered by default; CC-BY and
  CC-BY-SA are available behind the "Public domain only" toggle and clearly badged.
  Anything else — fair use, non-commercial, unknown — is never shown at all.
- **Artwork, not scans.** Commons ranks OCR'd book pages very highly for narrative
  queries; without filtering, a search for a battlefield passage returns title pages and
  Google Books watermarks — that is not hypothetical, it is what the first live run of
  this feature produced. Results are scored on their categories, title, byline and shape;
  scanned text, maps, logos, coins and diagrams are dropped. **Illustrate every scene**
  goes further and only accepts positive evidence of artwork (a category or title that
  actually says painting, lithograph, illustration), because a scene left with its
  generated background looks intentional and a book cover sliding past behind your
  caption does not. The manual search box stays permissive, so you can still pick
  anything usable by hand.
- **Credits are automatic.** Every picture's title, artist, date and licence go into the
  Credits panel and into the exported description. For CC-BY/CC-BY-SA that is a licence
  condition, not a courtesy, and the app says so.

Per scene you then control framing (fill or fit), the focal point the crop is anchored to,
and a **grade** that pulls the artwork toward the reel's palette — which is what stops a
Ravi Varma oleograph and a museum scan in the same reel looking like a slideshow.

Two implementation details worth knowing if you extend this: images are loaded with
`crossOrigin="anonymous"` because Commons sends `Access-Control-Allow-Origin: *`, and a
tainted canvas would make the whole reel unrecordable; and `renderFrame` stays pure by
only ever doing a *synchronous* cache lookup, so a scene whose picture has not arrived
draws its procedural background instead of stalling.

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
- **The generation adapters have never run against a live API.** They were written from
  each provider's current documentation, and the request shapes are asserted in tests, but
  no key exists in the environment they were built in. Every adapter therefore surfaces the
  provider's own error text verbatim, so a wrong field name is a one-run fix rather than a
  guessing game — but expect that first run to be where a shape problem shows up.
- **Character drift is real.** A textual cast description gets you the same costume and
  broad look, not the same face. Reference-image conditioning (supported by Gemini and
  OpenAI, not by the Replicate path) would tighten this and is not wired up yet.
- **Picture search is a hint engine too.** It reads proper nouns, not meaning, so an
  abstract beat ("I will not fight, he said") has nothing to search on and falls back to
  the reel's style hint, then to reusing a picture already in the reel. Expect to swap a
  few by hand — that is what the search box next to each scene is for.
- **Illustrating needs the network**, and Wikimedia rate-limits bursts. Searches are
  paced, and if you are limited anyway the app says so and stops rather than hammering.
  Pictures are referenced by URL, so a saved project is tiny but needs the network again
  when reopened; the reel falls back to procedural backgrounds until they load.
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
actually comes out. The Commons layer is tested offline against a fixture of a real API
response — licence filtering, scan rejection, credit lines, the focal-point crop, and the
search-and-assign UI — so CI never depends on Wikimedia being up. One opt-in test does hit
the live API (`MR_LIVE_COMMONS=1 npm test`) to check the response shape and that the
images still do not taint the canvas.

CI runs all three on every push and pull request.
