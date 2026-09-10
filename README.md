# MyRecital

An animation tool for YouTube videos. Put characters on a stage, move them, give them
actions and expressions, keyframe the moments that matter — then record it as a video file.

Characters are drawn, not generated: a small skeleton plus a colour scheme, painted fresh
every frame from joint angles. That is what makes them animatable, and it is why the whole
thing needs no API key, no account and no cost. A story can also be pasted in to lay out
the scenes and captions for you, but the animation is the point.

No build step, no framework, no backend, no media assets.

```
index.html        — the page: three panes (story, preview, tools)
css/styles.css    — all styling
js/actors.js      — the puppets: rig, poses, walk/talk/point cycles, faces
js/props.js       — the scenery: 17 procedural props, drawn in the same flat ink style
js/period.js      — when it happens: ten eras, their clothes, palettes and landmarks
js/anim.js        — the timeline: keyframes, interpolation, the stage, hit testing
js/direct.js      — auto-direction: casting, blocking, actions, dialogue, scenery
js/story.js       — text → storyboard: sentence splitting, beats, mood, pacing
js/images.js      — found artwork: Wikimedia Commons search, licence filter, image cache
js/generate.js    — drawn panels: provider adapters, prompt + cast, IndexedDB panel store
js/voice.js       — narration: TTS adapters, audio storage, and the timing it dictates
js/voices.js      — character voices: who says what, and what each of them sounds like
js/speech.js      — the speech synthesiser: letters to sounds, sounds to sound
js/render.js      — the picture: artwork or 13 procedural backgrounds, camera, captions
js/audio.js       — the score: synthesised from the scene moods and an ensemble, no files
js/sfx.js         — sound effects: footsteps read off the walk, weather, fire, hooves
js/export.js      — recording (MediaRecorder), stills, captions, project files
js/editor.js      — the editing tools: timeline, inspector, undo, autosave
js/app.js         — boot
tests/            — the test suite, run against a real browser
scripts/serve.mjs — `npm run serve`, a static server for local development
scripts/demo-reel.mjs  — `npm run demo`, builds and records the demonstration reel
functions/api/image.js — optional: image-model proxy for providers that block browsers
functions/api/voice.js — optional: text-to-speech proxy, same pattern
```

The app is **plain JavaScript with no build step** — `index.html` loads the `js/*.js`
files as ordinary `<script>` tags into one shared global scope, so any file can call
functions defined in an earlier-loaded one, and `app.js` runs last to wire everything up.
To add a feature, extend the relevant module (or add a new `js/*.js` and a `<script>` tag
in dependency order). No bundler, no framework, no `node_modules` at runtime.

## Running it

```sh
npm install     # only needed for the tests, the linter and the demo
npm run serve   # then open http://localhost:8080
npm run demo    # build and record the demonstration reel (58s, real time)
```

`npm run demo` is also the most complete worked example of the animation API — cast,
keyframed actions and expressions, an implied walk, props at three depths, a keyframed
cart and lip-sync from a measured envelope, in about 150 lines. Pass `9:16` as a second
argument for the vertical cut.

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
| Cast, poses, expressions, keyframes | Cast drawing style (3), comic page border |
| Costume (5), headwear (4), colours | — |
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

## Text to animation, in two clicks

Paste a story, press **Build the storyboard**, then press **Cast it and animate it**. The
second button reads the prose and stages the whole reel:

- **Casting.** Named characters, and — because plenty of stories never name anybody — the
  unnamed ones the text refers to by role ("a traveller", "the potter", "the old king").
  A character's whole appearance is derived from their *name*, so Aruna looks like Aruna in
  every scene with nothing stored anywhere. Consistency across shots is free for drawn
  characters; it is the hardest problem in the image-generation version of this idea.
- **Actions from verbs.** Walked, ran, came → the walk cycle; said, asked, replied → talk;
  pointed, knelt, fell, waved, wondered → the matching pose. The verb is read from the
  clause about *that* character, then from their sentence, and no further — scanning the
  whole beat borrows verbs from other people's sentences.
- **Dialogue.** Who speaks is worked out through pronouns ("Aruna looked up. *You have
  walked a long way*, she said." → Aruna), through subject position when two names share a
  sentence, and *not* at all when the sentence says somebody said nothing. Dialogue beats
  switch to speech balloons.
- **Blocking.** One character centre, two facing each other, more spread across the stage.
  Whoever arrives ("came", "entered", "approached") walks in from off the frame. Screen
  direction is stable: once someone has a side of the stage they keep it, because
  characters teleporting between beats reads as a continuity error.
- **Scenery.** Nouns put props on the stage — a well, a fire, a tree, a house, a cart —
  placed at sensible depths.
- **Continuity.** People stay on stage between lines. A story does not re-introduce both
  speakers in every sentence, and dropping the listener makes a two-hander look like two
  monologues.

It is a director, not an author: every decision is an ordinary edit afterwards, and the
whole pass is one undo. Follow it with **Make it a comic** and you have gone from pasted
text to a finished comic-styled animation without placing a single character by hand.

## Animating

Open the **Animate** tab, press **+ Character**, and drag them around the preview.

- **How old they are.** Child, young, grown-up or old, and it is not a body preset — it
  multiplies whichever body you picked, so a sturdy child and a slight child are both
  recognisably children. Four numbers carry it: head against body, how tall they stand
  beside the adults, how fast they move, how much they stoop. A child is not a small adult;
  its head is nearly a quarter of its height and it takes quicker, shorter steps. Size on
  the slider is where they stand in the frame; age is who they are, and they stay separate
  so that putting a child next to an adult needs no arithmetic.
- **A character is a rig, not a picture.** Five body types, six skin tones, five hair
  styles, four colours you pick — and nine actions (idle, talk, walk, point, wave, think,
  sit, kneel, fall) and six expressions that are all drawn from joint angles rather than
  stored as frames. Everyone breathes and blinks whatever else they are doing, because
  stillness reads as dead.
- **The motion is timed, not just posed.** The walk takes its phase from the distance
  actually covered, so a slow crossing takes slow steps and a stopped character stops
  stepping instead of jogging on the spot. Gestures start from rest and arrive with a
  little overshoot. Switching action cross-fades over about a third of a second, so nobody
  snaps from standing to kneeling between two frames.
- **Every limb carries its own outline.** The ink pass draws the outside of the figure, so
  an arm folded across the chest or a leg swinging past the other leg would otherwise
  dissolve into whatever it overlaps. Arms and legs are drawn with their own line on top.
- **Keyframes are moments.** Drag a character somewhere and that lands a key at the
  playhead; everything between two keys is worked out for you. Position and size ease
  between keys because that is motion; action, expression and facing hold and then switch,
  because nobody is 40% waving.
- **Move someone across the stage and they walk there.** If two keys have different
  positions and no action was set, the walk cycle plays and the character faces the way
  they are going — the commonest thing you want and the commonest thing you forget to key.
- **Appearance versus performance.** Body, hair and colours belong to the character and
  apply everywhere; pose, mood, position and size belong to this instant and become
  keyframes. That distinction is the whole mental model of the tool.
- **Copy cast to next scene** carries the same people, same look, first pose only — the
  next scene is a new performance.
- Mark one character as the speaker and their mouth moves for exactly as long as that
  scene's narration lasts.

### Making it look like a comic

The Look tab has a **Make it a comic** button. It sets six things at once, and one undo
puts them all back:

| What changes | Why it matters |
| --- | --- |
| Cast style → **Comic** | Heavier, warmer ink; bigger heads and eyes; thicker brows; and a **nose** and blush on every face. The missing nose is the single biggest reason the default face reads as a mask rather than a cartoon. |
| Palette → **Comic day** | A real blue sky and warm ground, instead of the moody gradients the reel starts with. |
| Backgrounds → **flatland / village** | Flat painted colour fields with a horizon and a row of huts. Indian comic backgrounds are colour fields, not atmosphere — and a flat background is what lets an ink-outlined character read against it. |
| Captions → **speech balloons** | Rounded, inked, with a tail to whoever is speaking, placed in the gap above their head so it can never cover the face. Scenes with an empty stage keep subtitles, since a balloon with no owner is just a box. |
| Page → **comic panel border** | A paper margin and an inked panel edge. Costs a little of the picture, buys a lot of "this is a comic". |
| Costumes → **kurta** | Anyone still in the default top-and-trousers gets dressed. |

Then tune it by hand. Per character there is **kurta, dhoti, saree, robe** or modern
dress, and **turban, cap or crown** — the silhouette changes far more than any colour
does, and it is what makes a cast read as Indian comic rather than generic explainer
video. Three cast styles ship: Natural, Comic and Storybook (rounder still, bigger eyes).

What this is *not*: it is not a Tinkle pastiche and does not imitate any particular
artist's hand. It is flat vector art with heavy ink, in the register those comics work in.
Hand-lettered wobble, cross-hatching, ink-weight variation along a single line and real
brush texture are all absent — that is the gap between this and a drawn page.

### Props and scenery

Fourteen props — tree, bush, rock, mountain, chair, table, pot, doorway, house, cart,
banner, fire, well, spear, cloud — drawn in code in the same flat style with the same ink
outline, so they belong in the frame with the characters. Each takes a colour of your
choosing.

Props sit at one of three depths: **behind everyone**, **among the cast** (sorted by size,
so a nearer character passes in front of a further prop) or **in front**. And because a
prop is keyframed by exactly the same machinery as an actor, a cart can be driven across
the stage the same way a person walks it.

**Copy everything to next scene** carries the cast *and* the scenery forward with their
first pose, which is how you keep a location consistent across a sequence.

Scenes still carry a background (thirteen generated ones, or found artwork, or a drawn
panel), so the cast has somewhere to stand, and the camera move applies to the whole stage.

## Two presentations: words-first or picture-first

The app began words-first — big kinetic captions performing the story, because with no
voice the text has to be readable at arm's length and there is nothing else to look at.
That is a fine format, and it is not the only one.

**Picture-first** (a button in the Look tab, and what narrating automatically switches you
to) drops the captions to ordinary subtitles along the bottom, turns off the word-by-word
reveal and the emphasis colouring, and calms the camera. The picture holds the frame and
the words get out of the way. Choose it whenever there are people on screen carrying the
scene; the words-first look is for reels that *are* typography.

## Shots

The camera had eight moves and no subject: it could drift and zoom, but it could not look
**at** anybody, so every beat was the same wide shot of a stage. A story for children is
mostly faces — the sage answering, the boy laughing — and a face needs a frame with a face
in it.

Each scene now has a **Shot** and a **Framed on**, in the Scene tab:

| Shot | What it frames |
| --- | --- |
| Wide | The whole stage. The default, and identical to how the reel rendered before shots existed. |
| Mid | Head and shoulders, with headroom. |
| Close | The face. |

The framing follows the subject: they can walk while the shot holds them. It is clamped so
the frame never travels past the edge of the picture, and it composes with the camera move
rather than replacing it — a slow drift across a close-up is a drift across a close-up.

Two things had to move with it. The speech balloon is drawn outside the camera transform,
so it now asks where the speaker ended up on screen; without that a close-up leaves the
balloon pointing at where the speaker used to be. And in a tight shot there is no room
above a head, so the balloon drops **below** the chin, pinned to the bottom of the frame and
capped at a third of it — in a close-up a balloon should cover a collarbone, never a face.

The auto-director uses all three: the first staged beat opens wide to establish the place,
a beat with dialogue cuts to the speaker and alternates mid and close so a conversation is
not one unchanging frame, and a crowd stays wide, because a close-up of three people is a
close-up of nobody.

## When it happens

A history reel is wrong in a way a fable never is: if the people in it are dressed for the
wrong century, the video teaches something false before it says a word. So the era is a
setting of the project. Pick it in the **Look** tab and press **Dress the reel for this
period**.

| Period | Roughly | What it puts people in |
| --- | --- | --- |
| Ancient Egypt | 3000–30 BCE | Linen kilts and shifts, broad collars, nemes headcloths, pyramids |
| Ancient India | 1500–200 BCE | Dhotis, sarees, kurtas, turbans |
| Ancient Greece | 800–300 BCE | Pinned chitons, wreaths, crested helmets, columns |
| Ancient Rome | 500 BCE–476 CE | Tunics and draped togas, laurel, helmets |
| Imperial China | 200 BCE–1900 CE | Long crossed robes, sashes, scholar caps |
| Medieval Europe | 500–1500 | Belted tunics, long gowns, hoods, helms, castle towers |
| Mughal India | 1526–1857 | Flared jamas, sashes, sarees, turbans |
| Age of Sail | 1600–1800 | Frock coats, three-cornered hats, long gowns |
| Industrial age | 1800–1900 | Frock coats and top hats, bonnets, brick and smoke |
| Modern | 1900 on | Ordinary clothes, any colour |

A period sets the clothes, the palette and the flat scenery, and tells the auto-director
which landmark belongs on the skyline when a beat mentions a palace or a temple. Silhouette
does more of that work than colour ever will: a toga and a frock coat are the same two arms
and two legs until you cut the cloth.

Three things worth knowing:

- **It leaves faces and skin alone.** Every era on that list held every kind of person.
  Deciding otherwise from a date would be both crude and false, and clothing carries the
  century anyway. Skin, hair and face stay yours to set.
- **It only guesses what the story says.** The auto-director reads age off the words near
  each name — "a young prince named Ashoka", "the old sage" — and only avoids putting a boy
  in a saree when the story has actually called him a boy. Where the words say nothing,
  neither does the tool, and every garment is one click away in the character panel.
- **The button is safe to press twice.** A character remembers which era they were dressed
  for, so re-dressing for the period you are already in leaves alone the hat you picked by
  hand. Changing period re-dresses everyone from scratch, because half a Roman is worse
  than none. Either way it is one undo.

Ten sets of clothes drawn as silhouettes will never be a costume history. They are the
difference between "someone in a robe" and "someone in jeans in ancient Egypt", which is
the difference that matters to a child watching.

## Narration

Open the **Sound** tab, pick a voice, press **Narrate every scene**. Each line is spoken by
a real TTS model and — this is the part that matters — **the scene is re-timed to the length
of what was said**, plus a breath you control. A cut that lands mid-word is worse than no
narration at all, so the voice sets the rhythm rather than fighting a duration you guessed
earlier.

The score keeps playing underneath and ducks around each line, on a separate bus so it
fades rather than steps. Narration is mixed into the recording through the same audio
graph the score uses, which is precisely why this does not use the browser's built-in
speech synthesis: `speechSynthesis` cannot be captured by `MediaRecorder`, so a voiceover
made that way plays for you and is silently missing from the exported file.

| Provider | Backend needed | Notes |
| --- | --- | --- |
| OpenAI | `functions/api/voice.js` | Named voices, plus a delivery-notes field the current TTS models honour |
| ElevenLabs | `functions/api/voice.js` | Addressed by voice id, so you paste the id of a voice you have |

**Lip sync.** When a line is narrated, the app measures its loudness thirty times a second
and stores that envelope with the scene. Whichever character you mark as the speaker then
opens their mouth on the *actual syllables* of the recording rather than flapping on a
timer — and takes the *shape* of what is being said, from nine mouth positions: lips shut
for m, b and p, round for oo, wide for ee, teeth on the lip for f and v, and so on.

The shapes come from the words, the timing comes from the audio. There is no phoneme
recogniser here and no forced aligner — those need a model and a server. What the app has
instead is exactly two things, and between them they are enough: the text that was sent to
the voice, which gives the ORDER of the shapes, and the loudness of what came back, which
gives where the speech is, where the pauses are and how loud each moment is. Syllables are
laid across the audible frames in proportion, so the mouth tracks the real rhythm of the
reading. Watch a long word closely and a shape may lead or lag by a frame or two; at 30fps,
at the size a phone shows a face, it reads as someone talking.

With no narration at all, a character set to "talk" still shapes the words of their line —
the same shapes, spent at an ordinary speaking rate. That is a guess about rhythm, never
about content, which is the right way round.

Roughly 1–3¢ per scene — a little more now that a beat with dialogue in it is several
requests rather than one, because each line goes to the provider in its own character's
voice. Audio blobs live in IndexedDB beside the panels; the project file keeps each line's
length, speaker and id, which is what lets it stay small while the reel stays timed to the
voices.

## Drawing the panels

Open the **Art** tab, describe your cast, press **Draw every panel**. Each beat becomes a
prompt: one fixed house-style block, the characters named *in that beat* described exactly
as you wrote them, the beat itself, and a rule that the panel must contain no lettering
(the app draws the captions, and a model's attempt at text inside the picture is both
unreadable and off-brand).

**Style presets:** cinematic photorealism and portrait realism for reels with real-looking
people; Amar Chitra Katha, Tinkle cartoon, ink and wash and block print for drawn ones —
plus a free-text notes field appended to every prompt.

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
the whole timeline is scheduled up front as oscillator voices plus a filtered noise whoosh
on each cut. Re-cut the story and the music re-writes itself. It is mixed into the
recording, not just played locally.

**Mood is what the music is. The ensemble is who plays it.** Splitting those two is what
turns eight moods into forty: the same sad progression is a lone flute over a drone or a
string section with a drum under it, and those are different films. Four layers — a held
pad, a bass on the bar, an arpeggio on the beat, and percussion — are the smallest set that
sounds like a band rather than a synthesiser.

| Ensemble | What it does |
| --- | --- |
| Storybook | Soft pad, warm arpeggio, a light tick. The default. |
| Chamber | Sine pad, plucked line, no percussion at all. |
| Epic | Reedy low pad, a strong bass, kick and tick, a sparser arpeggio. |
| Folk drone | Root and fifth held under everything, hand drum, no chord changes. |
| Playful | Square-wave arpeggio, bouncy. |
| Hushed | Quiet drone, half-speed arpeggio, nothing else. |

The default is **Match the period**: a reel set in ancient India opens on a drone and a
hand drum, one set in Rome on the epic ensemble, one in the Industrial age on chamber
strings. Override it in the Sound tab whenever the story disagrees.

## Character voices

A reel with one narrator is a reel where everybody sounds the same. So the app works out
who says what, and gives each of them their own voice.

**Splitting the beat.** Before anything is spoken, each beat is cut into lines: quotation
marks settle it where they exist, and the speech tag does where they do not. *"You have
walked a long way, she said"* is two voices — the line and the tag — and reading the whole
sentence in one of them is what makes a reel sound like a robot. Description stays with the
narrator; *"said nothing at all"* is not speech.

**Two ways to hear them**, sharing everything except the sound — the same lines, the same
attribution, the same mouth shapes:

- **Spoken** (on by default, no key, no cost). A speech synthesiser, built here, that says
  the actual words — see below. Set it to *Syllables* instead and you get the cartoon
  version: pitched gibberish in the right rhythm, which never mispronounces anything
  because it never pronounces anything.
- **Narrated** (needs a TTS key). Each line is sent to the provider in that character's own
  voice, and the beat comes back as several recordings laid one after another. The mouth
  that moves is the one whose line is playing.

**Where a voice comes from.** Every name gets a pitch and a timbre derived from the name
itself, so Ashoka sounds like Ashoka in every scene and in every reel, and two names rarely
collide. The band it lands in comes from the character's age — a child sits about two
octaves above an old man and speaks a third faster — which is the same age you set for the
drawing. Five timbres (warm, bright, reedy, soft, gruff) and a pitch slider per character
are in the Sound tab, with a ▶ to hear each one.

### Saying the words

The words are synthesised from scratch, in two stages — the two stages every speech
synthesiser has had since the 1970s:

1. **Letters to sounds.** English spelling is a historical accident, so this is a rule
   engine with context on both sides (*c* is /k/ except before *e*, *i* or *y*; *ow* is
   different in *slowly* and in *howl*) plus a dictionary of about 640 words no rule will
   ever get right — *one*, *two*, *said*, *women*, *through*, *listen*, *castle*. Between
   them they cover most of an ordinary page of story. Endings agree with the sound before
   them, which is the giveaway when a synthesiser gets it wrong: *walked* ends in a t,
   *feared* in a d, *wanted* grows a syllable; *cats* hisses where *dogs* buzzes. A word
   that is an inflection of a word in the dictionary is looked up through it — including
   the letter the spelling dropped, so *waking* goes through *wake* and *carried* through
   *carry* — which is how *having* stays short while *waking* stays long.
2. **Sounds to sound.** A vowel is three resonances — the shape of the mouth making it — so
   speech here is a glottal buzz and a breath of noise pushed through a cascade of four
   tracking resonators, with a separate hiss for the sounds made of air alone,
   silence-then-burst for the stops, and formants that *glide* between neighbours, because
   those transitions are how a listener tells a /d/ from a /g/.
3. **Prosody**, which is where most of "robotic" actually lives. English is stress-timed:
   the stressed syllable of a word is longer, louder and higher, an unstressed one collapses
   towards a schwa, and function words — *the, a, of, was* — carry no stress at all. Pitch
   drifts down across a phrase, lifts on each stressed syllable, falls away at a full stop
   and climbs at a question mark, and *glides* between those targets rather than stepping.
   A comma is a shorter pause than a full stop, and the sound before either one stretches.

   **Which** syllable takes the stress is decided by the word's ending, because that is how
   English works, and the endings fall into four kinds: ones that pull the stress onto the
   syllable before them (na·TION, a·BIL·i·ty — counting back past however many syllables the
   ending itself has), ones that take it themselves (engi·NEER, Chi·NESE), ones that count
   back three (pho·TOG·ra·phy, bi·OL·o·gy), and the great majority that change nothing, so
   the stem keeps what it had (re·MEM·ber·ing, not RE·membering). Prefixes come last and are
   deliberately few: *be-*, *re-*, *un-*, *dis-* and their kin are real, while *a-*, *em-*
   and *en-* look like prefixes and mostly are not — ANcient, ANswer, EMperor. Where a
   dictionary word's stress still comes out wrong, the entry carries its own mark, in the
   notation every pronouncing dictionary uses: `machine: 'M AX SH IY1 N'`.

**It sounds like a robot.** It is a robot: three formants and a pulse train in a browser
tab. But it says the words, it costs nothing, it works offline, and — unlike the browser's
own `speechSynthesis`, which cannot be captured — it is Web Audio all the way, so it goes
into the recording instead of playing only for whoever is at the machine. For a studio
voice, record narration with a TTS key; the two paths share everything else.

Three things here had to be measured rather than reasoned about, and each was wrong the
first time:

- **A cascade of resonators must be a cascade of boosts, not of bands.** Four band-pass
  filters in series multiply their own skirts: almost nothing survives but the lowest
  formant, and the voice comes out as a hum with no vowels in it. Peaking filters lift each
  resonance and leave the rest of the spectrum alone, which is what a real tract does.
- **Formant bandwidth widens with frequency**, so the higher resonances are broader, not
  sharper. Backwards, that is precisely the hollow ring that says "computer".
- **Level has to be compensated by pitch.** A high voice pushes far more energy through the
  same filters, so without it a child is twice as loud as an old man saying the same line.
  The exponent was fitted by recording all three and measuring, not by algebra.

What a voice sounds *like* is mostly three numbers, and none of them is a formant: how fast
the glottal harmonics fall away (dark and soft, or bright and pressed), how much breath is
mixed into the tone, and how steady the pitch is. Those are what the five timbres set.

The lip sync gets better as a side effect: mouth shapes now come from the phonemes, which
is where they always wanted to come from. /m/ closes the lips because it *is* closed lips,
not because a spelling rule guessed it might be.

Whose mouth moves on a *narrator's* line? Nobody's, when the beat has dialogue in it — the
narrator is not in the picture. A beat that is nothing but description would then have every
mouth shut, so there the character marked as speaker reads it.

## Sound effects

Also synthesised, also from nothing: an oscillator and a burst of filtered noise per
effect, because a zero-asset app cannot ship a `footstep.wav`.

**Footsteps come off the walk itself.** They are not a timer. The cue list is read from the
same distance-driven walk cycle the legs are drawn from, sampled on the same grid, so a step
lands on the frame the foot lands on — speed a character up and the steps speed up, stop
them and the steps stop, and a child's shorter stride is audibly a patter rather than a
tread. That agreement is the only thing separating footsteps from a rhythm track.

Everything else follows the same rule: the sound comes from what is actually on the stage.

- **What people do.** A fall thuds, kneeling and sitting rustle.
- **What is standing there.** Fire crackles, wells drip, carts clop, banners flap, towers
  ring, doors creak.
- **Where it is.** Forest and village bring wind and birds, a city hums, the sea swells,
  rain sits still behind everything.
- **Where it stands.** Every effect is panned by its position on stage and scaled by how
  near it is drawn, so a fire on the right is on the right.

Effects have their own bus, and duck under a narrator half as far as the music does —
footsteps you cannot hear during the narration are footsteps nobody made. The cue list
(`sfxCuesFor`) is pure and seeded, like the renderer: the same reel sounds the same on every
playback and every recording. The Sound tab tells you what it will sound like before you
press play — "7 crackles, 5 footsteps, 2 birds, 1 scene of wind."

## Limitations, honestly

- **Recording is real-time.** A frame-accurate offline render would need to drop the live
  audio graph, so this trades exactness for a mixed soundtrack in one pass.
- **Narration needs a TTS key and a deployed function.** Browser speech synthesis cannot be
  captured into `MediaRecorder`, so a voiceover made that way would play locally and be
  silently missing from the file. Real TTS returns bytes that can be both played and mixed
  into the recording — which is why narration goes through `functions/api/voice.js` rather
  than through the browser. Without that, the reel is captions and score, and the exported
  `.srt` is your script.
- **Likeness.** Photoreal presets make convincing pictures of people who do not exist.
  Don't use them to depict a real, identifiable person saying or doing something they
  didn't — that is the one use of this app that is nobody's idea of a story.
- **The generation and narration adapters have never run against a live API.** They were written from
  each provider's current documentation, and the request shapes are asserted in tests, but
  no key exists in the environment they were built in. Every adapter therefore surfaces the
  provider's own error text verbatim, so a wrong field name is a one-run fix rather than a
  guessing game — but expect that first run to be where a shape problem shows up.
- **The characters are stylised, not photoreal.** They are flat vector cartoons with ink
  outlines — closer to an explainer-video cast than to Pixar.
- **The synthesiser is a synthesiser.** It says the words, with stress, breath and a real
  intonation contour, and you can follow it — but it will not be mistaken for a person.
  Stress is guessed from the shape of the word, not looked up, so long or unusual words land
  it on the wrong syllable; there is no rhythm above the phrase; and an unfamiliar proper
  noun is pronounced the way it is spelled. For a studio voice, use the TTS path.
- **A word the rules get wrong stays wrong.** The dictionary is about 640 words and the
  rules handle the rest; an unfamiliar name is pronounced the way it is spelled, and there
  is no way to correct a pronunciation from the interface yet — it needs an entry in the
  file. Stress on long or unusual words is a guess from the shape of the ending, and
  sometimes the wrong one.
- **Who says what is read from grammar, not meaning.** Quotation marks and speech tags are
  reliable; a line of dialogue with neither goes to the narrator. Every line's speaker is an
  ordinary setting you can change.
- **Synthesised effects sound synthesised.** A footstep built from noise and a sine is
  recognisably a footstep in place, on time, panned correctly — and recognisably not a
  recording of a boot on gravel. Surfaces do not vary, and nothing is layered per material.
  A library of samples would sound better and would cost the app its "no assets" property,
  which is the trade this file makes on purpose.
- **Ten periods is not a costume history.** Each era is a handful of silhouettes and a
  palette, chosen because they read at phone size — not a reconstruction, and not regional
  within an era. They are right enough that a child is not being taught something false;
  they are not right enough to cite.
- **Props are scenery, not furniture you interact with.** A character can stand beside a
  chair; there is no "sit on that chair" that snaps them into it, and no collision of any
  kind. You place both by hand.
- **Lip sync is aligned by proportion, not by recognition.** The mouth shapes are real —
  nine of them, taken from the words that were actually spoken — and the timing follows the
  measured loudness, so silences and pauses land exactly. But nothing here listens to the
  audio and identifies sounds: within a run of speech the syllables are spread evenly, so a
  long drawled word can put a shape a frame or two early or late. Frame-exact placement
  needs forced alignment against a transcript, which needs a model and a server.
- **Still pictures, not moving footage** in the *image-generation* path — A panel gets a Ken Burns move over it; nobody in
  it walks. Real motion means a video model (Veo, Kling, Runway and friends), which is a
  different kind of call — asynchronous jobs, minutes per clip, dollars rather than cents —
  and is not wired up.
- **Character drift is real.** A textual cast description gets you the same costume and
  broad look, not the same face. Reference-image conditioning (supported by Gemini and
  OpenAI, not by the Replicate path) would tighten this and is not wired up yet.
- **The director reads grammar, not meaning.** It matches verbs and names; it does not
  understand your story. Expect it to miss an implied action, cast a place as a person, or
  stage a scene flatly — it gets you a populated, blocked reel in one click, and the
  editing tools are there for the rest.
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
