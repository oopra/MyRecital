// speech.js — actual words, spoken, with no key and no audio files.
//
// The app had two ways to make a character talk and neither of them said anything. Pitched
// syllables carry rhythm and character but no words; real text-to-speech says words but
// needs a key, a deployed function and a network round trip per line.
//
// So this is the third way: a formant speech synthesiser, of the kind that shipped in
// 1980s speech chips and still runs inside eSpeak today. Two stages, and they are the two
// stages every speech synthesiser has ever had:
//
//   1. Letters to sounds. English spelling is a historical accident, so this is a rule
//      engine with context on both sides ("c" is /k/ except before e, i or y) plus a
//      dictionary of the words the rules will never get right (one, two, said, women).
//   2. Sounds to sound. Every vowel is three resonances — the shape of the mouth making
//      it — so speech is a buzzing glottal source pushed through three tracking filters,
//      with noise for the hisses and silence-then-burst for the stops.
//
// It sounds like a robot. It is a robot: three formants and a pulse train, generated live
// in a browser tab. But it says the words, it costs nothing, it works offline, and — the
// thing browser speech synthesis cannot do — it is Web Audio all the way, so it mixes into
// the recording instead of playing only for whoever is sitting at the machine.
//
// The lip sync gets better as a side effect. Mouth shapes now come from phonemes, which is
// what they always wanted to come from: /m/ closes the lips because it IS a closed lip, not
// because a letter-frequency rule guessed it might be.

// ---------------------------------------------------------------- the sounds
//
// Formants in hertz for an adult male tract; a voice's own pitch and size scale them. F1
// is roughly how open the mouth is, F2 how far forward the tongue, F3 does the r-colouring.
// `dur` is milliseconds at an ordinary speaking rate.
const MR_PHONEMES = {
  // Vowels ---------------------------------------------------------------
  AA: { type: 'vowel', f: [730, 1090, 2440], dur: 150 },              // father
  AE: { type: 'vowel', f: [660, 1720, 2410], dur: 150 },              // cat
  AH: { type: 'vowel', f: [640, 1190, 2390], dur: 100 },              // but
  AO: { type: 'vowel', f: [570, 840, 2410], dur: 150 },               // thought
  EH: { type: 'vowel', f: [530, 1840, 2480], dur: 120 },              // bed
  ER: { type: 'vowel', f: [490, 1350, 1690], dur: 150 },              // bird
  IH: { type: 'vowel', f: [390, 1990, 2550], dur: 95 },               // bit
  IY: { type: 'vowel', f: [270, 2290, 3010], dur: 140 },              // see
  UH: { type: 'vowel', f: [440, 1020, 2240], dur: 100 },              // book
  UW: { type: 'vowel', f: [300, 870, 2240], dur: 140 },               // too
  AX: { type: 'vowel', f: [500, 1400, 2400], dur: 70 },               // the schwa
  // Diphthongs glide from one target to another, which is all a diphthong is.
  AY: { type: 'vowel', f: [730, 1090, 2440], to: [270, 2290, 3010], dur: 190 },   // my
  AW: { type: 'vowel', f: [730, 1090, 2440], to: [300, 870, 2240], dur: 190 },    // how
  EY: { type: 'vowel', f: [530, 1840, 2480], to: [270, 2290, 3010], dur: 175 },   // day
  OW: { type: 'vowel', f: [530, 900, 2400], to: [300, 870, 2240], dur: 175 },     // go
  OY: { type: 'vowel', f: [570, 840, 2410], to: [270, 2290, 3010], dur: 200 },    // boy

  // Nasals — voiced, with the mouth shut, so quiet and low.
  M:  { type: 'nasal', f: [250, 1100, 2200], dur: 80, amp: 0.5 },
  N:  { type: 'nasal', f: [250, 1700, 2600], dur: 75, amp: 0.5 },
  NG: { type: 'nasal', f: [250, 2000, 2800], dur: 80, amp: 0.45 },

  // Liquids and glides — vowel-like, so they simply have their own formants.
  L:  { type: 'liquid', f: [400, 1000, 2600], dur: 70, amp: 0.75 },
  R:  { type: 'liquid', f: [400, 1000, 1600], dur: 75, amp: 0.75 },   // the low F3 is the r
  W:  { type: 'liquid', f: [300, 700, 2200], dur: 65, amp: 0.7 },
  Y:  { type: 'liquid', f: [270, 2300, 3000], dur: 60, amp: 0.7 },

  // Fricatives — noise, shaped. Voiced ones keep a little buzz underneath.
  F:  { type: 'fric', band: [1400, 0.6], dur: 105, amp: 0.35, voiced: 0 },
  V:  { type: 'fric', band: [1400, 0.6], dur: 75, amp: 0.3, voiced: 0.5 },
  TH: { type: 'fric', band: [2600, 0.5], dur: 100, amp: 0.28, voiced: 0 },
  DH: { type: 'fric', band: [2600, 0.5], dur: 60, amp: 0.25, voiced: 0.5 },
  S:  { type: 'fric', band: [5500, 1.4], dur: 115, amp: 0.85, voiced: 0 },
  Z:  { type: 'fric', band: [5000, 1.4], dur: 90, amp: 0.7, voiced: 0.45 },
  SH: { type: 'fric', band: [2800, 1.6], dur: 120, amp: 0.9, voiced: 0 },
  ZH: { type: 'fric', band: [2600, 1.6], dur: 90, amp: 0.7, voiced: 0.45 },
  HH: { type: 'fric', band: [1600, 0.4], dur: 70, amp: 0.22, voiced: 0 },

  // Stops — a silence and then a burst. The silence is not optional: it is most of what
  // makes a /p/ a /p/ rather than a click.
  P:  { type: 'stop', hold: 55, burst: [1000, 1.2], dur: 90, amp: 0.5, voiced: 0 },
  B:  { type: 'stop', hold: 45, burst: [900, 1.2], dur: 75, amp: 0.4, voiced: 0.6 },
  T:  { type: 'stop', hold: 55, burst: [3800, 1.4], dur: 90, amp: 0.6, voiced: 0 },
  D:  { type: 'stop', hold: 45, burst: [3200, 1.4], dur: 75, amp: 0.45, voiced: 0.6 },
  K:  { type: 'stop', hold: 60, burst: [2200, 1], dur: 95, amp: 0.6, voiced: 0 },
  G:  { type: 'stop', hold: 45, burst: [1900, 1], dur: 80, amp: 0.45, voiced: 0.6 },

  // Affricates are a stop and a fricative, and are written here as exactly that.
  CH: { type: 'stop', hold: 55, burst: [2800, 1.6], dur: 130, amp: 0.75, voiced: 0, tail: 'SH' },
  JH: { type: 'stop', hold: 45, burst: [2600, 1.6], dur: 115, amp: 0.6, voiced: 0.5, tail: 'ZH' },

  // A gap: end of a word, or a comma.
  '_': { type: 'silence', dur: 60 }
};

// The mouth shape each phoneme makes, so the lips come from the sounds rather than from a
// second, cruder guess about the spelling.
const MR_PHONEME_VISEME = {
  AA: 'AA', AE: 'AA', AH: 'UH', AO: 'OO', AW: 'AA', AY: 'AA', EH: 'EE', ER: 'UH',
  EY: 'EE', IH: 'EE', IY: 'EE', OW: 'OO', OY: 'OO', UH: 'OO', UW: 'OO', AX: 'UH',
  B: 'MBP', P: 'MBP', M: 'MBP',
  F: 'FV', V: 'FV',
  TH: 'L', DH: 'L', L: 'L', R: 'UH', W: 'OO', Y: 'EE',
  S: 'S', Z: 'S', SH: 'S', ZH: 'S', CH: 'S', JH: 'S', T: 'S', D: 'S', N: 'S',
  K: 'UH', G: 'UH', NG: 'UH', HH: 'UH', '_': 'rest'
};

// ---------------------------------------------------------------- letters to sounds

// The words English spelling will never yield to a rule. Between them these account for a
// large share of any page of ordinary prose, and every one of them would come out wrong
// from the rules below.
//
// A `1` on a vowel marks the stressed syllable, in the notation every pronouncing
// dictionary uses. It is only needed where the stress rules would guess wrong — machine,
// himself, understand — because for most words they guess right, and an entry that repeats
// what the rules already know is one more thing to keep correct.
const MR_LEXICON = {
  a: 'AX', the: 'DH AX', to: 'T UW', of: 'AH V', and: 'AE N D', is: 'IH Z', was: 'W AH Z',
  are: 'AA R', were: 'W ER', been: 'B IH N', do: 'D UW', does: 'D AH Z', done: 'D AH N',
  said: 'S EH D', says: 'S EH Z', one: 'W AH N', two: 'T UW', four: 'F AO R', who: 'HH UW',
  what: 'W AH T', where: 'W EH R', when: 'W EH N', why: 'W AY', how: 'HH AW',
  there: 'DH EH R', their: 'DH EH R', they: 'DH EY', them: 'DH EH M', these: 'DH IY Z',
  those: 'DH OW Z', this: 'DH IH S', that: 'DH AE T', than: 'DH AE N', then: 'DH EH N',
  you: 'Y UW', your: 'Y AO R', yours: 'Y AO R Z', my: 'M AY', her: 'HH ER', his: 'HH IH Z',
  our: 'AW ER', from: 'F R AH M', have: 'HH AE V', has: 'HH AE Z', had: 'HH AE D',
  come: 'K AH M', came: 'K EY M', some: 'S AH M', son: 'S AH N', once: 'W AH N S',
  love: 'L AH V', live: 'L IH V', give: 'G IH V', gave: 'G EY V', again: 'AX G EH1 N',
  against: 'AX G EH1 N S T', many: 'M EH N IY', any: 'EH N IY', money: 'M AH N IY',
  water: 'W AO T ER', walk: 'W AO K', walked: 'W AO K T', talk: 'T AO K', talked: 'T AO K T',
  laugh: 'L AE F', laughed: 'L AE F T', enough: 'IH N AH1 F', though: 'DH OW',
  through: 'TH R UW', thought: 'TH AO T', bought: 'B AO T', brought: 'B R AO T',
  ought: 'AO T', caught: 'K AO T', taught: 'T AO T', daughter: 'D AO T ER',
  eye: 'AY', eyes: 'AY Z', people: 'P IY P AX L', women: 'W IH M IH N', woman: 'W UH M AX N',
  child: 'CH AY L D', children: 'CH IH L D R AX N', old: 'OW L D', gold: 'G OW L D',
  cold: 'K OW L D', told: 'T OW L D', hold: 'HH OW L D', both: 'B OW TH',
  door: 'D AO R', floor: 'F L AO R', poor: 'P UH R', foot: 'F UH T', good: 'G UH D',
  book: 'B UH K', look: 'L UH K', looked: 'L UH K T', took: 'T UH K', stood: 'S T UH D',
  could: 'K UH D', would: 'W UH D', should: 'SH UH D', put: 'P UH T', full: 'F UH L',
  because: 'B IH K AO Z', friend: 'F R EH N D', great: 'G R EY T', break: 'B R EY K',
  heart: 'HH AA R T', earth: 'ER TH', early: 'ER L IY', learn: 'L ER N', work: 'W ER K',
  world: 'W ER L D', word: 'W ER D', words: 'W ER D Z', very: 'V EH R IY',
  every: 'EH V R IY', river: 'R IH V ER', over: 'OW V ER', other: 'AH DH ER',
  another: 'AX N AH1 DH ER', mother: 'M AH DH ER', father: 'F AA DH ER', brother: 'B R AH DH ER',
  nothing: 'N AH TH IH NG', something: 'S AH M TH IH NG', anything: 'EH N IY TH IH NG',
  i: 'AY', 'i\'m': 'AY M', 'don\'t': 'D OW N T', 'can\'t': 'K AE N T', 'it\'s': 'IH T S',
  'you\'re': 'Y UW R', 'we\'re': 'W IY R', 'i\'ll': 'AY L',
  no: 'N OW', go: 'G OW', so: 'S OW', he: 'HH IY', she: 'SH IY', we: 'W IY', be: 'B IY',
  me: 'M IY', by: 'B AY', off: 'AO F', on: 'AA N', in: 'IH N', it: 'IH T',
  at: 'AE T', as: 'AE Z', an: 'AE N', or: 'AO R', for: 'F AO R', but: 'B AH T',
  not: 'N AA T', with: 'W IH DH', into: 'IH N T UW', out: 'AW T', up: 'AH P',
  down: 'D AW N', now: 'N AW', new: 'N UW', know: 'N OW', knew: 'N UW', knee: 'N IY',
  night: 'N AY T', light: 'L AY T', right: 'R AY T', might: 'M AY T', sight: 'S AY T',
  high: 'HH AY', sign: 'S AY N', island: 'AY L AX N D', answer: 'AE N S ER',
  half: 'HH AE F', calm: 'K AA M', palm: 'P AA M', wind: 'W IH N D', mind: 'M AY N D',
  find: 'F AY N D', kind: 'K AY N D', behind: 'B IH HH AY N D', blood: 'B L AH D',
  flood: 'F L AH D', bread: 'B R EH D', head: 'HH EH D', dead: 'D EH D', read: 'R EH D',
  ready: 'R EH D IY', heard: 'HH ER D', hear: 'HH IH R', here: 'HH IH R', near: 'N IH R',
  year: 'Y IH R', years: 'Y IH R Z', ear: 'IH R', dear: 'D IH R', fear: 'F IH R',
  eat: 'IY T', sea: 'S IY', tea: 'T IY', each: 'IY CH', speak: 'S P IY K',
  spoke: 'S P OW K', wrote: 'R OW T', write: 'R AY T', wrong: 'R AO NG', sword: 'S AO R D',
  war: 'W AO R', warm: 'W AO R M', want: 'W AA N T', watch: 'W AA CH', wash: 'W AA SH',
  city: 'S IH T IY', busy: 'B IH Z IY', build: 'B IH L D', built: 'B IH L T',
  guard: 'G AA R D', guide: 'G AY D', tongue: 'T AH NG', young: 'Y AH NG',
  among: 'AX M AH1 NG', country: 'K AH N T R IY', trouble: 'T R AH B AX L',
  double: 'D AH B AX L', touch: 'T AH CH', queen: 'K W IY N',
  king: 'K IH NG', boy: 'B OY', girl: 'G ER L', man: 'M AE N', men: 'M EH N',
  sun: 'S AH N', moon: 'M UW N', star: 'S T AA R', sky: 'S K AY',
  fire: 'F AY ER', hour: 'AW ER',

  // The rest of the common few hundred. Ordinary words, but ordinary words are what a
  // story is mostly made of, and a synthesiser that mispronounces "little" or "answer"
  // sounds broken however well it handles the rare ones.
  about: 'AX B AW1 T', above: 'AX B AH1 V', across: 'AX K R AO1 S', after: 'AE F T ER',
  away: 'AX W EY1', alone: 'AX L OW1 N', ago: 'AX G OW1', around: 'AX R AW1 N D',
  asleep: 'AX S L IY1 P', awake: 'AX W EY1 K', aside: 'AX S AY1 D', apart: 'AX P AA1 R T',
  appear: 'AX P IH1 R', arrive: 'AX R AY1 V', afraid: 'AX F R EY1 D',
  elephant: 'EH L IH F AX N T', enemy: 'EH N AX M IY',
  almost: 'AO L M OW S T', along: 'AX L AO1 NG', already: 'AO L R EH1 D IY',
  also: 'AO L S OW', although: 'AO L DH OW1', always: 'AO L W EY Z', am: 'AE M',
  before: 'B IH F AO1 R', began: 'B IH G AE1 N', begin: 'B IH G IH1 N', below: 'B IH L OW1',
  between: 'B IH T W IY1 N', beyond: 'B IH Y AA1 N D', bring: 'B R IH NG', buy: 'B AY',
  call: 'K AO L', called: 'K AO L D', can: 'K AE N', cannot: 'K AE N AA T',
  carry: 'K AE R IY', change: 'CH EY N JH', close: 'K L OW Z', course: 'K AO R S',
  cut: 'K AH T', different: 'D IH F R AX N T', during: 'D UH R IH NG', eight: 'EY T',
  either: 'IY DH ER', else: 'EH L S', end: 'EH N D', even: 'IY V AX N',
  evening: 'IY V N IH NG', ever: 'EH V ER', example: 'IH G Z AE1 M P AX L',
  face: 'F EY S', fall: 'F AO L', family: 'F AE M AX L IY', far: 'F AA R', feet: 'F IY T',
  few: 'F Y UW', field: 'F IY L D', fight: 'F AY T', fill: 'F IH L',
  finally: 'F AY N AX L IY', fine: 'F AY N', first: 'F ER S T', five: 'F AY V',
  follow: 'F AA L OW', food: 'F UW D', forest: 'F AO R AX S T', forward: 'F AO R W ER D',
  front: 'F R AH N T', gone: 'G AO N', ground: 'G R AW N D', group: 'G R UW P',
  grow: 'G R OW', guess: 'G EH S', hand: 'HH AE N D', happen: 'HH AE P AX N',
  hard: 'HH AA R D', heavy: 'HH EH V IY', help: 'HH EH L P', himself: 'HH IH M S EH1 L F',
  herself: 'HH ER S EH1 L F', home: 'HH OW M', horse: 'HH AO R S', house: 'HH AW S',
  however: 'HH AW EH1 V ER', hundred: 'HH AH N D R AX D', hurry: 'HH ER IY',
  idea: 'AY D IY1 AX', important: 'IH M P AO1 R T AX N T', inside: 'IH N S AY1 D',
  instead: 'IH N S T EH1 D', keep: 'K IY P', kept: 'K EH P T', known: 'N OW N',
  lady: 'L EY D IY', large: 'L AA R JH', last: 'L AE S T', later: 'L EY T ER',
  leave: 'L IY V', left: 'L EH F T', less: 'L EH S', letter: 'L EH T ER', lie: 'L AY',
  life: 'L AY F', lion: 'L AY AX N', listen: 'L IH S AX N', listened: 'L IH S AX N D',
  little: 'L IH T AX L', lost: 'L AO S T', loud: 'L AW D', machine: 'M AX SH IY1 N',
  made: 'M EY D', make: 'M EY K', mean: 'M IY N', meant: 'M EH N T',
  measure: 'M EH ZH ER', meet: 'M IY T', middle: 'M IH D AX L', million: 'M IH L Y AX N',
  minute: 'M IH N IH T', moment: 'M OW M AX N T', more: 'M AO R', morning: 'M AO R N IH NG',
  most: 'M OW S T', move: 'M UW V', much: 'M AH CH', music: 'M Y UW Z IH K',
  must: 'M AH S T', name: 'N EY M', never: 'N EH V ER', next: 'N EH K S T', nine: 'N AY N',
  none: 'N AH N', north: 'N AO R TH', note: 'N OW T', number: 'N AH M B ER',
  ocean: 'OW SH AX N', often: 'AO F AX N', oil: 'OY L', only: 'OW N L IY',
  open: 'OW P AX N', order: 'AO R D ER', others: 'AH DH ER Z', outside: 'AW T S AY1 D',
  own: 'OW N', page: 'P EY JH', paper: 'P EY P ER', part: 'P AA R T', party: 'P AA R T IY',
  pass: 'P AE S', perhaps: 'P ER HH AE1 P S', piece: 'P IY S', place: 'P L EY S',
  plant: 'P L AE N T', play: 'P L EY', point: 'P OY N T', power: 'P AW ER',
  present: 'P R EH Z AX N T', pretty: 'P R IH T IY', probably: 'P R AA B AX B L IY',
  problem: 'P R AA B L AX M', quick: 'K W IH K', quiet: 'K W AY AX T', quite: 'K W AY T',
  rain: 'R EY N', reach: 'R IY CH', real: 'R IY L', remember: 'R IH M EH1 M B ER',
  rest: 'R EH S T', return: 'R IH T ER1 N', rock: 'R AA K', room: 'R UW M',
  round: 'R AW N D', run: 'R AH N', same: 'S EY M', saw: 'S AO', school: 'S K UW L',
  second: 'S EH K AX N D', seem: 'S IY M', seen: 'S IY N', sense: 'S EH N S',
  seven: 'S EH V AX N', several: 'S EH V R AX L', shall: 'SH AE L', ship: 'SH IH P',
  short: 'SH AO R T', shoulder: 'SH OW L D ER', side: 'S AY D', since: 'S IH N S',
  six: 'S IH K S', size: 'S AY Z', sleep: 'S L IY P', small: 'S M AO L',
  smile: 'S M AY L', smiled: 'S M AY L D', soft: 'S AO F T', sound: 'S AW N D',
  south: 'S AW TH', space: 'S P EY S', stand: 'S T AE N D', start: 'S T AA R T',
  state: 'S T EY T', stay: 'S T EY', step: 'S T EH P', still: 'S T IH L',
  stone: 'S T OW N', stop: 'S T AA P', strange: 'S T R EY N JH', street: 'S T R IY T',
  strong: 'S T R AO NG', study: 'S T AH D IY', such: 'S AH CH', sudden: 'S AH D AX N',
  summer: 'S AH M ER', sure: 'SH UH R', surprise: 'S ER P R AY1 Z', table: 'T EY B AX L',
  take: 'T EY K', taken: 'T EY K AX N', teach: 'T IY CH', tell: 'T EH L', ten: 'T EH N',
  thank: 'TH AE NG K', thing: 'TH IH NG', things: 'TH IH NG Z', think: 'TH IH NG K',
  third: 'TH ER D', three: 'TH R IY', throw: 'TH R OW', till: 'T IH L', time: 'T AY M',
  today: 'T AX D EY1', together: 'T AX G EH1 DH ER', tomorrow: 'T AX M AA1 R OW',
  tonight: 'T AX N AY1 T', top: 'T AA P', toward: 'T AO R D', towards: 'T AO R D Z',
  town: 'T AW N', travel: 'T R AE V AX L', tree: 'T R IY', true: 'T R UW', turn: 'T ER N',
  under: 'AH N D ER', understand: 'AH N D ER S T AE1 N D', until: 'AH N T IH1 L',
  upon: 'AX P AA1 N', use: 'Y UW Z', usually: 'Y UW ZH AX L IY', voice: 'V OY S',
  wait: 'W EY T', waited: 'W EY T IH D', wall: 'W AO L', wear: 'W EH R', week: 'W IY K',
  weight: 'W EY T', west: 'W EH S T', wheel: 'W IY L', while: 'W AY L', white: 'W AY T',
  whole: 'HH OW L', whose: 'HH UW Z', wide: 'W AY D', wife: 'W AY F', wild: 'W AY L D',
  window: 'W IH N D OW', wish: 'W IH SH', within: 'W IH DH IH1 N', without: 'W IH TH AW1 T',
  wonder: 'W AH N D ER', wondered: 'W AH N D ER D', wood: 'W UH D', wooden: 'W UH D AX N',
  yes: 'Y EH S', yesterday: 'Y EH S T ER D EY', yet: 'Y EH T',

  // The words a history story is built out of.
  ancient: 'EY N SH AX N T', army: 'AA R M IY', arrow: 'AE R OW', battle: 'B AE T AX L',
  brave: 'B R EY V', bronze: 'B R AA N Z', castle: 'K AE S AX L', cave: 'K EY V',
  century: 'S EH N CH ER IY', chariot: 'CH AE R IY AX T', chief: 'CH IY F',
  clay: 'K L EY', coin: 'K OY N', court: 'K AO R T', desert: 'D EH Z ER T',
  discover: 'D IH S K AH1 V ER', distant: 'D IH S T AX N T', east: 'IY S T',
  emperor: 'EH M P ER ER', empire: 'EH M P AY ER', famous: 'F EY M AX S',
  farmer: 'F AA R M ER', festival: 'F EH S T AX V AX L', fort: 'F AO R T', gate: 'G EY T',
  goddess: 'G AA D AX S', gods: 'G AA D Z', golden: 'G OW L D AX N', grain: 'G R EY N',
  harvest: 'HH AA R V AX S T', helmet: 'HH EH L M AX T', honour: 'AA N ER',
  honor: 'AA N ER', journey: 'JH ER N IY', kingdom: 'K IH NG D AX M', knight: 'N AY T',
  kneel: 'N IY L', knelt: 'N EH L T', market: 'M AA R K AX T', merchant: 'M ER CH AX N T',
  monk: 'M AH NG K', palace: 'P AE L AX S', pharaoh: 'F EH R OW', priest: 'P R IY S T',
  prince: 'P R IH N S', princess: 'P R IH N S EH S', pyramid: 'P IH R AX M IH D',
  ruler: 'R UW L ER', sacred: 'S EY K R AX D', scholar: 'S K AA L ER', scroll: 'S K R OW L',
  shield: 'SH IY L D', silk: 'S IH L K', silver: 'S IH L V ER', soldier: 'S OW L JH ER',
  statue: 'S T AE CH UW', throne: 'TH R OW N', tomb: 'T UW M', trade: 'T R EY D',
  treasure: 'T R EH ZH ER', tribe: 'T R AY B', village: 'V IH L AX JH',
  warrior: 'W AO R IY ER', wheat: 'W IY T', wisdom: 'W IH Z D AX M',
  rome: 'R OW M', roman: 'R OW M AX N', greece: 'G R IY S', greek: 'G R IY K',
  egypt: 'IY JH IH P T', egyptian: 'IH JH IH1 P SH AX N', china: 'CH AY N AX',
  chinese: 'CH AY N IY1 Z', india: 'IH N D IY AX', indian: 'IH N D IY AX N',
  mughal: 'M UW G AX L', sanskrit: 'S AE N S K R IH T',

  // Silent letters, and the spellings that lie about themselves.
  comb: 'K OW M', debt: 'D EH T', doubt: 'D AW T', honest: 'AA N AX S T', lamb: 'L AE M',
  muscle: 'M AH S AX L', salmon: 'S AE M AX N', scene: 'S IY N', subtle: 'S AH T AX L',
  thumb: 'TH AH M', whistle: 'W IH S AX L', wrist: 'R IH S T', chaos: 'K EY AA S',
  character: 'K EH R AX K T ER', echo: 'EH K OW', monarch: 'M AA N ER K',
  scheme: 'S K IY M', stomach: 'S T AH M AX K', ache: 'EY K', chef: 'SH EH F',
  ghost: 'G OW S T', height: 'HH AY T', weird: 'W IH R D',
  thousand: 'TH AW Z AX N D', rule: 'R UW L', wake: 'W EY K', woke: 'W OW K',
  hundreds: 'HH AH N D R AX D Z', thousands: 'TH AW Z AX N D Z',

  // A few names, because a story is mostly names and the rules cannot know them. Anything
  // not listed is pronounced the way it is spelled, which is the honest failure.
  ashoka: 'AX SH OW1 K AX', aruna: 'AX R UW1 N AX', arjuna: 'AA R JH UW1 N AX',
  krishna: 'K R IH SH N AX', ravi: 'R AA V IY', meera: 'M IY R AX', sita: 'S IY T AX',
  rama: 'R AA M AX', akbar: 'AE K B AA R', ganges: 'G AE N JH IY Z',
  caesar: 'S IY Z ER', athens: 'AE TH AX N Z', cairo: 'K AY R OW', delhi: 'D EH L IY'
};

// Letters to sounds, with context. Each rule is [left, letters, right, phonemes] where the
// contexts are regular expressions anchored at the join — left matches what came before,
// right matches what follows. Order matters: the first match at each position wins, so the
// long and specific ones come first.
//
// This is the compact descendant of the NRL ruleset every synthesiser has cribbed since
// 1976. It gets ordinary English mostly right and unusual English wrong, which is what the
// dictionary above is for.
const MR_LTS = [
  // Suffixes and endings, which are where naive rules embarrass themselves.
  [null, 'tion', null, 'SH AX N'], [null, 'sion', /^s/, 'SH AX N'], [null, 'sion', null, 'ZH AX N'],
  [null, 'ture', null, 'CH ER'], [null, 'ough', null, 'AH F'],
  [null, 'ight', null, 'AY T'], [null, 'augh', null, 'AO'],
  // Unstressed endings, spelled out so their vowels come out as the schwas they are:
  // careFUL is not care-FULL, and kindNESS is not kind-NESS.
  [null, 'ful', /^(ly)?$/, 'F AX L'], [null, 'less', /^(ly)?$/, 'L AX S'],
  [null, 'ness', /^$/, 'N AX S'], [null, 'ment', /^s?$/, 'M AX N T'],
  [null, 'ous', /^(ly)?$/, 'AX S'], [null, 'able', /^$/, 'AX B AX L'],
  [null, 'ing', null, 'IH NG'],
  // A one-syllable stem keeps its long vowel: tried and cried are not carried and hurried,
  // and the difference is whether there is another vowel in front of the ending.
  [/^[^aeiou]{0,3}$/, 'ied', /^$/, 'AY D'], [/^[^aeiou]{0,3}$/, 'ies', /^$/, 'AY Z'],
  [null, 'ies', null, 'IY Z'], [null, 'ied', null, 'IY D'],
  [/[^aeiou]$/, 'y', /^$/, 'IY'], [/[^aeiou]$/, 'y', /^s$/, 'IY'],
  [null, 'ed', /^$/, 'D'],                     // voicing is fixed up afterwards
  [null, 'le', /^$/, 'AX L'],                  // temple, people, little
  [null, 'e', /^$/, ''],                       // the silent e, handled by the vowel rules
  [null, 'e', /^(ful|less|ly|ness)$/, ''],     // and it stays silent under an ending
  [null, 'es', /^$/, 'IH Z'],
  [/^$/, 'be', /^[^aeiouy]/, 'B IH'],          // beside, begin, before

  // Consonant digraphs.
  [null, 'sch', null, 'S K'], [null, 'tch', null, 'CH'],
  [null, 'ch', null, 'CH'], [null, 'sh', null, 'SH'], [null, 'ph', null, 'F'],
  [null, 'th', null, 'TH'], [null, 'wh', null, 'W'], [null, 'qu', null, 'K W'],
  [null, 'ck', null, 'K'], [null, 'gh', /^t/, ''], [null, 'gh', null, 'G'],
  [null, 'ng', /^$/, 'NG'], [null, 'nk', null, 'NG K'],
  [/^$/, 'kn', null, 'N'], [/^$/, 'wr', null, 'R'], [/^$/, 'gn', null, 'N'],
  [/^$/, 'won', null, 'W AH N'],               // wonder, wonderful, wonderland
  [null, 'dge', null, 'JH'], [null, 'ge', /^$/, 'JH'],

  // Vowel digraphs.
  [null, 'eigh', null, 'EY'], [null, 'ee', null, 'IY'], [null, 'ea', /^r/, 'IH'],
  [null, 'ea', null, 'IY'], [null, 'ie', null, 'IY'], [null, 'ei', null, 'EY'],
  [null, 'oo', /^[kd]/, 'UH'], [null, 'oo', null, 'UW'],
  [null, 'ou', /^r/, 'AO'], [null, 'ou', null, 'AW'],
  // ow is the coin-toss of English spelling: slowly is OW, howl is AW, and only what
  // follows the l tells them apart. Before n it goes to AW (down, town, crown) and the
  // OW words that break that — own, known, grown — are in the dictionary.
  [null, 'ow', /^l[aeiouy]/, 'OW'], [null, 'ow', /^[nl]/, 'AW'], [null, 'ow', null, 'OW'], [null, 'oi', null, 'OY'], [null, 'oy', null, 'OY'],
  [null, 'au', null, 'AO'], [null, 'aw', null, 'AO'], [null, 'ai', null, 'EY'],
  [null, 'ay', null, 'EY'], [null, 'oa', null, 'OW'], [null, 'ue', null, 'UW'],
  [null, 'ui', null, 'UW'], [null, 'eu', null, 'UW'], [null, 'ew', null, 'UW'],

  // Vowel plus r, which changes everything about it. Unconditional: story and glory take
  // the same AO R as storm and fort, and the conditional version got them wrong.
  [null, 'are', /^($|[^aeiouy])/, 'EH R'],     // care, careful, share, bare
  [null, 'ar', null, 'AA R'], [null, 'or', null, 'AO R'],
  [null, 'er', null, 'ER'], [null, 'ir', null, 'ER'], [null, 'ur', null, 'ER'],

  // Single vowels: long before a consonant and a silent e, short otherwise.
  [null, 'a', /^$/, 'AX'],                     // Aruna, India, a final a is a schwa
  [null, 'a', /^tion/, 'EY'],                  // nation, station
  // The silent e that lengthens the vowel before it — and it goes on doing that when an
  // ending is stuck on the end: rule, ruled, ruler. Spelling drops the e before -ing
  // (wake, waking) so that gets its own line, and the words where it lies about the vowel
  // (have, give, come, live) are caught earlier, in the dictionary.
  [null, 'a', /^[^aeiouy]e(d|s|r|st|ful|less|ly|ness)?$/, 'EY'],
  [null, 'e', /^[^aeiouy]e(d|s|r|st|ful|less|ly|ness)?$/, 'IY'],
  [null, 'i', /^[^aeiouy]e(d|s|r|st|ful|less|ly|ness)?$/, 'AY'],
  [null, 'o', /^[^aeiouy]e(d|s|r|st|ful|less|ly|ness)?$/, 'OW'],
  [null, 'u', /^[^aeiouy]e(d|s|r|st|ful|less|ly|ness)?$/, 'UW'],
  [null, 'a', /^[^aeiouy]ing$/, 'EY'], [null, 'i', /^[^aeiouy]ing$/, 'AY'],
  [null, 'o', /^[^aeiouy]ing$/, 'OW'], [null, 'u', /^[^aeiouy]ing$/, 'UW'],
  [null, 'a', /^[^aeiouy]{2}/, 'AE'], [null, 'a', null, 'AE'],
  [null, 'e', /^$/, ''], [null, 'e', null, 'EH'],
  [null, 'i', /^gh/, 'AY'], [null, 'i', /^nd$/, 'AY'], [null, 'i', null, 'IH'],
  [null, 'o', /^ld$|^lt$|^st$/, 'OW'], [null, 'o', /^ng/, 'AO'], [null, 'o', null, 'AA'],
  [null, 'u', /^[^aeiouy]{2}/, 'AH'], [null, 'u', null, 'AH'],
  [/^$/, 'y', null, 'Y'], [null, 'y', null, 'IH'],

  // Single consonants.
  [null, 'c', /^[eiy]/, 'S'], [null, 'c', null, 'K'],
  [null, 'g', /^[eiy]/, 'JH'], [null, 'g', null, 'G'],
  [/[aeiou]$/, 's', /^e$/, 'Z'],               // wise, rose, those — but not beside
  [/[^s]$/, 's', /^$/, 'Z'], [null, 's', null, 'S'],   // dogs buzzes, happiness does not
  [null, 'x', null, 'K S'], [null, 'j', null, 'JH'], [null, 'z', null, 'Z'],
  [null, 'b', null, 'B'], [null, 'd', null, 'D'], [null, 'f', null, 'F'],
  [null, 'h', null, 'HH'], [null, 'k', null, 'K'], [null, 'l', null, 'L'],
  [null, 'm', null, 'M'], [null, 'n', null, 'N'], [null, 'p', null, 'P'],
  [null, 'r', null, 'R'], [null, 't', null, 'T'], [null, 'v', null, 'V'],
  [null, 'w', null, 'W'], [null, "'", null, '']
];

// A dictionary entry, parsed once: the sounds, and which of them carries the stress.
const mrEntries = new Map();
function mrEntry(clean) {
  if (mrEntries.has(clean)) return mrEntries.get(clean);
  const raw = MR_LEXICON[clean];
  if (!raw) { mrEntries.set(clean, null); return null; }
  const phonemes = [];
  let stress = null;
  for (const part of raw.split(' ')) {
    if (part.endsWith('1')) { stress = phonemes.length; phonemes.push(part.slice(0, -1)); }
    else phonemes.push(part);
  }
  const entry = { phonemes, stress };
  mrEntries.set(clean, entry);
  return entry;
}

// One word to sounds, and to the syllable it is said with. `stress` is null when the
// dictionary has no opinion, which is most of the time — then the rules decide.
function pronounce(word) {
  const clean = String(word || '').toLowerCase().replace(/[^a-z']/g, '');
  if (!clean) return { phonemes: [], stress: null, word: clean };
  const listed = mrEntry(clean);
  if (listed) return { phonemes: listed.phonemes, stress: listed.stress, word: clean };

  // A plural or a past tense of something in the dictionary is still in the dictionary,
  // and keeps the stem's stressed syllable: remembered is stressed where remember is.
  // `rebuild` puts back the letter the spelling dropped: waking is wake, carried is carry.
  for (const [suffix, sound, rebuild] of [['s', 'S', ''], ['ed', 'D', ''], ['ing', 'IH NG', ''],
    ['ly', 'L IY', ''], ['ness', 'N AX S', ''], ['ful', 'F AX L', ''], ['less', 'L AX S', ''],
    ['er', 'ER', ''], ['est', 'AX S T', ''],
    ['ing', 'IH NG', 'e'], ['ed', 'D', 'e'], ['ied', 'D', 'y'], ['ies', 'Z', 'y']]) {
    if (clean.length > suffix.length + 2 && clean.endsWith(suffix)) {
      const stem = mrEntry(clean.slice(0, -suffix.length) + rebuild);
      if (stem) {
        const base = stem.phonemes;
        return {
          phonemes: base.concat(mrInflect(base[base.length - 1], suffix, sound)),
          stress: stem.stress, word: clean
        };
      }
    }
  }
  return { phonemes: mrSpell(clean), stress: null, word: clean };
}

function phonemesForWord(word) {
  return pronounce(word).phonemes;
}

// The rules, for everything the dictionary has never heard of.
function mrSpell(clean) {

  const out = [];
  let at = 0;
  while (at < clean.length) {
    let matched = null;
    for (const [left, letters, right, phonemes] of MR_LTS) {
      if (!clean.startsWith(letters, at)) continue;
      if (left && !left.test(clean.slice(0, at))) continue;
      if (right && !right.test(clean.slice(at + letters.length))) continue;
      matched = { letters, phonemes };
      break;
    }
    if (!matched) { at++; continue; }
    if (matched.phonemes) out.push(...matched.phonemes.split(' '));
    at += matched.letters.length;
  }

  const sounds = out.filter((p) => MR_PHONEMES[p]);
  // A doubled letter is one sound: well is not spoken well-l, and traveller has one l in
  // the middle of it however many are written.
  const collapsed = sounds.filter((p, i) => p !== sounds[i - 1] || MR_VOWEL_SET.has(p));
  // English -ed agrees with the sound before it: walked ends in t, feared ends in d, and
  // wanted grows a syllable. The rule above always says d; this is where that is repaired.
  if (clean.endsWith('ed') && collapsed[collapsed.length - 1] === 'D' && collapsed.length > 1) {
    collapsed.splice(-1, 1, ...mrInflect(collapsed[collapsed.length - 2], 'ed', 'D'));
  }
  // And the plural does the same: cats hisses where dogs buzzes.
  if (clean.endsWith('s') && !clean.endsWith('ss') && collapsed[collapsed.length - 1] === 'Z' && collapsed.length > 1) {
    collapsed.splice(-1, 1, ...mrInflect(collapsed[collapsed.length - 2], 's', 'Z'));
  }
  return collapsed;
}

// English endings agree with the sound before them: cats has an s, dogs has a z, and
// wanted has a whole extra syllable. Getting this wrong is instantly audible.
function mrInflect(last, suffix, fallback) {
  const sibilant = ['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].indexOf(last) >= 0;
  const voiceless = ['P', 'T', 'K', 'F', 'TH', 'S', 'SH', 'CH', 'HH'].indexOf(last) >= 0;
  if (suffix === 's') return sibilant ? ['IH', 'Z'] : [voiceless ? 'S' : 'Z'];
  if (suffix === 'ed') {
    if (last === 'T' || last === 'D') return ['IH', 'D'];
    return [voiceless ? 'T' : 'D'];
  }
  return fallback.split(' ');
}

// ---------------------------------------------------------------- stress
//
// English is stress-timed: a stressed syllable is longer, louder and higher, and an
// unstressed one collapses towards a schwa. Give every syllable equal weight and you get
// the flat machine-gun delivery that is most of what people mean by "robotic" — more of it
// than the timbre is.

const MR_VOWEL_SET = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AX', 'AY', 'EH', 'ER',
  'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

// Words that carry no stress of their own in a sentence. Reducing them is what makes the
// words around them stand out, which is how a listener finds the meaning.
const MR_FUNCTION_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in',
  'on', 'at', 'for', 'from', 'with', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'am',
  'do', 'does', 'did', 'has', 'have', 'had', 'he', 'she', 'it', 'they', 'we', 'you', 'him',
  'her', 'them', 'us', 'my', 'your', 'his', 'its', 'their', 'our', 'that', 'this', 'these',
  'those', 'there', 'then', 'than', 'so', 'if', 'by', 'into', 'upon', 'over', 'under',
  'all', 'which']);

// Prefixes that are never the stressed syllable: beside, again, return, unless. Only
// counted when the word is long enough for the prefix to be a prefix rather than the whole
// of it — "any" does not begin with the a- of "again", and "recent" is not re-cent.
// Left out on purpose: a-, em- and en-. They look like prefixes and mostly are not —
// ancient, answer, army, emperor, enemy — and the handful of real ones (about, again,
// enough) are in the dictionary anyway.
const MR_UNSTRESSED_PREFIX = /^(be|re|de|un|in|im|dis|mis|ex|con|com|ad|ac|pro|per|sur|pre|sub)(?=[a-z]{3})/;

// English stress is decided by the ENDING of a word far more than by its beginning, and
// the endings fall into three kinds. This is the standard three-way split every rule-based
// synthesiser uses, and it is worth more than any amount of work on the vowels: stress on
// the wrong syllable makes a familiar word unrecognisable in a way a wrong vowel does not.

// Endings that pull the stress onto the syllable before them. Split by how many syllables
// the ending itself is, because "before the ending" has to count back past all of them:
// naTION is one syllable back, aBILity is two.
const MR_STRESS_BEFORE_ONE = /(tion|sions?|cion|ian|ial|ic|ics)$/;
const MR_STRESS_BEFORE_TWO = /(ity|ety|ify|itude|ical|ically|ially|iously|ious|ular|uous)$/;

// Endings that take the stress themselves. engiNEER, JapanESE, cigarETTE, picturESQUE.
const MR_STRESS_ON = /(eer|ee|ese|ette|esque|oon|aire)$/;

// Endings that count back three syllables: phoTOGraphy, geOLogy, deMOCracy, geOMetry.
const MR_STRESS_THIRD = /(graphy|logy|ology|ometry|onomy|ocracy|opathy|ivity)$/;

// Endings that change nothing at all: the stem keeps whatever stress it had. Nearly every
// ending in ordinary prose is one of these, which is why the default is so often right.
const MR_STRESS_NEUTRAL = /(ing|ings|ed|es|s|er|ers|est|ly|ness|ful|fully|less|ment|ments|able|ish|hood|ship|dom|like)$/;

// Which vowel in a word takes the stress. Rough, and rough is enough: the gap between the
// right syllable and any syllable at all is enormous; the gap between the right syllable
// and the second-best is small.
function mrStressIndex(word, phonemes) {
  const vowels = [];
  phonemes.forEach((p, i) => { if (MR_VOWEL_SET.has(p)) vowels.push(i); });
  if (!vowels.length) return -1;
  if (MR_FUNCTION_WORDS.has(word)) return -1;
  if (vowels.length === 1) return vowels[0];

  const pick = (n) => vowels[Math.max(0, Math.min(vowels.length - 1, n))];
  if (MR_STRESS_ON.test(word)) return pick(vowels.length - 1);
  if (MR_STRESS_THIRD.test(word)) return pick(vowels.length - 3);
  if (MR_STRESS_BEFORE_TWO.test(word)) return pick(vowels.length - 3);
  if (MR_STRESS_BEFORE_ONE.test(word)) return pick(vowels.length - 2);

  // A stress-neutral ending is stripped and the question asked again of the stem, so that
  // "remembering" is stressed where "remember" is rather than on its first syllable.
  const neutral = word.match(MR_STRESS_NEUTRAL);
  if (neutral && word.length - neutral[0].length >= 3) {
    const stem = word.slice(0, word.length - neutral[0].length);
    if (MR_STRESS_ON.test(stem) || MR_STRESS_THIRD.test(stem) ||
        MR_STRESS_BEFORE_ONE.test(stem) || MR_STRESS_BEFORE_TWO.test(stem)) {
      return mrStressIndex(stem, phonemes);
    }
    if (MR_UNSTRESSED_PREFIX.test(stem)) return pick(1);
    return vowels[0];
  }

  if (MR_UNSTRESSED_PREFIX.test(word)) return pick(1);
  return vowels[0];
}

// A whole line to phonemes, each carrying whether it is stressed, and with the pauses
// punctuation asks for — a comma is not the same length as a full stop.
function phonemeTokens(text) {
  const out = [];
  const parts = String(text || '').split(/(\s+|[,;:.!?—-]+)/);
  for (const chunk of parts) {
    if (!chunk || /^\s+$/.test(chunk)) continue;
    if (/^[,;:.!?—-]+$/.test(chunk)) {
      const pause = /[.!?]/.test(chunk) ? 0.34 : 0.18;
      const last = out[out.length - 1];
      if (last && last.p === '_') last.pause = Math.max(last.pause, pause);
      else out.push({ p: '_', pause, stress: 0 });
      continue;
    }
    const said = pronounce(chunk);
    const sounds = said.phonemes;
    if (!sounds.length) continue;
    if (out.length && out[out.length - 1].p !== '_') out.push({ p: '_', pause: 0.055, stress: 0 });
    const word = said.word;
    // The dictionary's own stress mark wins; without one, the rules decide.
    const stressAt = said.stress != null ? said.stress : mrStressIndex(word, sounds);
    sounds.forEach((p, i) => out.push({
      p, word,
      // 1 stressed, -1 an unstressed vowel to be reduced, 0 everything else.
      stress: i === stressAt ? 1 : (MR_VOWEL_SET.has(p) ? -1 : 0)
    }));
  }
  return out;
}

function phonemesFor(text) {
  return phonemeTokens(text).map((token) => token.p);
}

// ---------------------------------------------------------------- sounds to sound

// The phoneme list as a plan: what to do, for how long, at what pitch. Kept separate from
// the audio graph so it can be tested, and so the mouth can be driven from the same plan.
// The formants of a completely relaxed mouth. Everything unstressed slides towards it.
const MR_SCHWA_F = [500, 1400, 2400];

function mrTowardsSchwa(f, amount) {
  return [0, 1, 2].map((i) => f[i] + (MR_SCHWA_F[i] - f[i]) * amount);
}

function speechPlan(text, opts) {
  const o = opts || {};
  const rate = o.rate || 1;
  const tokens = o.tokens || phonemeTokens(text);
  const question = /\?\s*$/.test(String(text || ''));
  const plan = [];
  let at = 0;

  tokens.forEach((token, i) => {
    const spec = MR_PHONEMES[token.p];
    if (!spec) return;
    if (spec.type === 'silence') {
      const seconds = (token.pause || 0.06) / rate;
      plan.push({ phoneme: '_', type: 'silence', at, dur: seconds, spec, stress: 0, amp: 0 });
      at += seconds;
      return;
    }

    let f = spec.f;
    let to = spec.to;
    let amp = spec.amp != null ? spec.amp : 1;
    let seconds = spec.dur / 1000;

    if (spec.type === 'vowel') {
      if (token.stress < 0) {
        // Reduction. An unstressed vowel in English is shorter, quieter and closer to a
        // schwa than the dictionary says — "a long way" is not ay long way.
        seconds *= 0.62;
        amp *= 0.82;
        f = mrTowardsSchwa(f, 0.45);
        if (to) to = mrTowardsSchwa(to, 0.45);
      } else if (token.stress > 0) {
        seconds *= 1.18;
        amp *= 1.12;
      }
    }
    // A sound at the end of a phrase stretches. Speech slows into a pause; a synthesiser
    // that does not is the one that sounds like it is reading a list.
    const next = tokens[i + 1];
    if (!next || next.p === '_') seconds *= next && next.pause > 0.2 ? 1.3 : 1.12;

    plan.push({ phoneme: token.p, type: spec.type, at, dur: seconds / rate, spec, f, to, amp, stress: token.stress });
    at += seconds / rate;
  });

  // Intonation. Three things at once, which is roughly what a speaker does: the pitch
  // drifts down across the whole phrase (declination), rises on each stressed syllable
  // (accent), and falls away at the end — or climbs, if it is a question.
  // Measured across the SPEECH, not across the clip: a long pause at the end of a question
  // would otherwise push every syllable's progress down and swallow the rise.
  let spoken = 0;
  for (const step of plan) if (step.type !== 'silence') spoken = step.at + step.dur;
  const total = spoken || at || 1;
  plan.forEach((step, i) => {
    const progress = Math.min(1, step.at / total);
    let pitch = 1.05 - progress * 0.17;
    if (step.stress > 0) pitch *= 1.09;
    else if (step.stress < 0) pitch *= 0.98;
    if (progress > 0.8) pitch *= question ? 1 + (progress - 0.8) * 1.5 : 1 - (progress - 0.8) * 0.8;
    step.pitch = pitch;
    void i;
  });
  // Where the pitch is heading, so the voice can glide between targets instead of stepping
  // between them. A stair of held pitches is the single most robotic thing a synthesiser
  // can do, and it is the one nobody notices they are doing.
  plan.forEach((step, i) => {
    const next = plan[i + 1];
    step.pitchTo = next ? next.pitch : step.pitch * (question ? 1.06 : 0.93);
  });

  return { steps: plan, seconds: at, phonemes: tokens.map((t) => t.p), tokens };
}

// How long a line takes to say, for laying lines out before any of them is scheduled.
function speechPlanSeconds(text, rate) {
  return speechPlan(text, { rate }).seconds;
}

// The mouth, straight from the sounds. This is what phonemes were always for: /m/ closes
// the lips because it is a closed lip, not because a rule guessed from the spelling.
function mouthFromPlan(plan, into) {
  if (!plan || !plan.steps.length) return { open: 0, viseme: 'rest' };
  if (into < 0 || into > plan.seconds) return { open: 0, viseme: 'rest' };
  for (const step of plan.steps) {
    if (into < step.at || into > step.at + step.dur) continue;
    const viseme = MR_PHONEME_VISEME[step.phoneme] || 'UH';
    // A reduced vowel is a smaller mouth as well as a shorter one.
    const open = step.type === 'silence' ? 0
      : step.type === 'vowel' ? (step.stress < 0 ? 0.7 : 1)
        : step.type === 'stop' ? 0.25
          : step.amp != null ? Math.min(1, step.amp + 0.15) : 0.5;
    return { open, viseme };
  }
  return { open: 0, viseme: 'rest' };
}

// ---------------------------------------------------------------- the voice

// The source: a glottal pulse, not a sawtooth. `tilt` is voice quality — how fast the
// harmonics fall away. A low tilt is a bright, pressed voice; a high one is soft and dark.
// This one number does more for how a person sounds than the formants do.
const mrGlottalWaves = new Map();
function mrGlottal(ctx, tilt) {
  const key = Math.round(tilt * 10) / 10;
  const cached = mrGlottalWaves.get(key);
  if (cached && cached.ctx === ctx) return cached.wave;
  const size = 40;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  const fall = 1 + key * 1.7;
  for (let n = 1; n < size; n++) imag[n] = 1 / Math.pow(n, fall);
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  mrGlottalWaves.set(key, { ctx, wave });
  return wave;
}

// Formant bandwidths widen with frequency in a real mouth, and Q is frequency over
// bandwidth — so the higher resonators are not sharper, they are broader. Getting this
// backwards is what gives cheap synthesis its hollow, ringing quality.
const MR_FORMANT_BW = [80, 110, 170, 250];

// Speak one line. A glottal buzz and a breath of noise through a cascade of four
// resonators — the mouth — with a separate hiss path for the sounds made with air alone.
// Everything is scheduled up front, like the score, so playback and recording agree.
function mrSpeakWords(text, at, profile, rate, gainValue) {
  const ctx = mrAudio.ctx;
  if (!ctx) return 0;
  const plan = speechPlan(text, { rate });
  if (!plan.steps.length) return 0;

  const timbre = (typeof MR_TIMBRES !== 'undefined' && MR_TIMBRES[profile.timbre]) || {};
  const tilt = timbre.tilt != null ? timbre.tilt : 0.45;
  const breath = timbre.breath != null ? timbre.breath : 0.12;
  const jitter = timbre.jitter != null ? timbre.jitter : 0.01;

  const pitchHz = mrMidiToHz(profile.pitch || 52);
  // A voice's pitch also scales its formants: a small head makes a small mouth, and a
  // child whose formants stayed where an adult's are sounds like an adult on helium.
  const size = Math.pow(2, (52 - (profile.pitch || 52)) / 34);
  // High voices push far more energy through the resonators than low ones, so the level is
  // compensated by pitch. Without this a child is twice as loud as an old man saying the
  // same line, and every reel with both in it needs mixing by hand.
  const level = (gainValue == null ? 1 : gainValue) * 0.22 * Math.pow(2, (52 - (profile.pitch || 52)) / 9);
  const end = at + plan.seconds + 0.1;
  // Seeded from the words, so a line sounds the same every time it is played and different
  // from the line beside it.
  const random = typeof mrRandom === 'function' ? mrRandom(mrVoiceHash(text) % 9973) : Math.random;

  const buzz = ctx.createOscillator();
  buzz.setPeriodicWave(mrGlottal(ctx, tilt));
  const buzzGain = ctx.createGain();
  buzzGain.gain.value = 0;
  buzz.connect(buzzGain);

  // Breath: a little noise through the same mouth, always, while the voice is sounding.
  // A voice with no breath in it at all is the sound of a synthesiser.
  const aspirate = ctx.createBufferSource();
  aspirate.buffer = mrSfxNoise();
  aspirate.loop = true;
  const aspGain = ctx.createGain();
  aspGain.gain.value = 0;
  aspirate.connect(aspGain);

  // The hiss path, for the sounds that are nothing but air: s, sh, f, and the bursts.
  const hiss = ctx.createBufferSource();
  hiss.buffer = mrSfxNoise();
  hiss.loop = true;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0;
  const hissBand = ctx.createBiquadFilter();
  hissBand.type = 'bandpass';
  hissBand.frequency.value = 3000;
  hissBand.Q.value = 1;
  hiss.connect(hissBand); hissBand.connect(hissGain);

  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(mrAudio.voice);

  // The tract, as a cascade of BOOSTS rather than of bands. This is the one place the
  // textbook diagram has to be read carefully: a cascade of band-pass filters multiplies
  // its own skirts, so four of them in series pass almost nothing but the lowest formant,
  // and the voice comes out as a hum with no vowels in it. Peaking filters lift each
  // resonance and leave the rest of the spectrum — including the fundamental — alone,
  // which is what a real tract does to the sound going through it.
  const formants = [0, 1, 2, 3].map((n) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.gain.value = n === 0 ? 17 : n === 1 ? 16 : n === 2 ? 11 : 7;
    filter.Q.value = 3;
    return filter;
  });
  for (let n = 0; n < formants.length - 1; n++) formants[n].connect(formants[n + 1]);
  // The mouth is not a bright loudspeaker: everything above the formants falls away.
  const lips = ctx.createBiquadFilter();
  lips.type = 'lowpass';
  lips.frequency.value = 5200;
  lips.Q.value = 0.6;
  const tract = ctx.createGain();
  tract.gain.value = 0.9;
  formants[formants.length - 1].connect(lips);
  lips.connect(tract);
  tract.connect(out);
  buzzGain.connect(formants[0]);
  aspGain.connect(formants[0]);

  // The voice bar: the fundamental and its first harmonics, straight through. It carries no
  // vowel information at all — it is there so every voice has a body and a pitch you can
  // hear, whatever the formants happen to be doing.
  const bar = ctx.createBiquadFilter();
  bar.type = 'lowpass';
  bar.frequency.value = Math.max(220, pitchHz * 2.4);
  const barGain = ctx.createGain();
  barGain.gain.value = 0.3;
  buzzGain.connect(bar); bar.connect(barGain); barGain.connect(out);

  hissGain.connect(out);

  const setTargets = (time, target, glide) => {
    for (let n = 0; n < 3; n++) {
      const hz = Math.max(120, target[n] * size);
      if (glide) formants[n].frequency.linearRampToValueAtTime(hz, time);
      else formants[n].frequency.setValueAtTime(hz, time);
      // Bandwidth widens with frequency in a real mouth, and Q is frequency over
      // bandwidth — so the higher resonances are broader, not sharper. Backwards, this is
      // exactly the hollow ring that says "computer".
      formants[n].Q.setValueAtTime(Math.max(1.2, hz / MR_FORMANT_BW[n] * 0.5), time);
    }
    const f4 = 3400 * size;
    formants[3].frequency.setValueAtTime(f4, time);
    formants[3].Q.setValueAtTime(Math.max(1.2, f4 / MR_FORMANT_BW[3] * 0.5), time);
  };

  let previous = null;
  for (const step of plan.steps) {
    const start = at + step.at;
    const stop = start + step.dur;
    const spec = step.spec;

    // Pitch glides to the next target across the sound, with a little jitter on the way.
    // Speech is never on a steady note; a voice that is reads as a machine within a word.
    const wobble = 1 + (random() - 0.5) * jitter * 2;
    buzz.frequency.setValueAtTime(pitchHz * step.pitch * wobble, start);
    if (step.dur > 0.01) {
      buzz.frequency.linearRampToValueAtTime(pitchHz * step.pitchTo * (1 + (random() - 0.5) * jitter), stop);
    }

    if (step.type === 'silence') {
      buzzGain.gain.setTargetAtTime(0.0001, start, 0.012);
      aspGain.gain.setTargetAtTime(0.0001, start, 0.012);
      hissGain.gain.setTargetAtTime(0.0001, start, 0.012);
      previous = null;
      continue;
    }

    if (step.type === 'vowel' || step.type === 'nasal' || step.type === 'liquid') {
      // Shimmer: syllables are not all exactly as loud as each other either.
      const amp = (step.amp != null ? step.amp : 1) * 0.9 * (1 + (random() - 0.5) * 0.12);
      // Formants glide from wherever the last sound left them: those transitions are how
      // a listener tells a /d/ from a /g/, so they matter more than the steady parts.
      if (previous) setTargets(start + Math.min(0.05, step.dur * 0.45), step.f, true);
      else setTargets(start, step.f, false);
      if (step.to) setTargets(stop, step.to, true);          // a diphthong glides on
      // A syllable swells and falls away rather than switching on: the attack is fast, the
      // release is slower, and neither is instant.
      buzzGain.gain.setTargetAtTime(amp, start, Math.max(0.008, step.dur * 0.14));
      buzzGain.gain.setTargetAtTime(amp * 0.72, start + step.dur * 0.7, 0.05);
      aspGain.gain.setTargetAtTime(amp * breath, start, 0.02);
      hissGain.gain.setTargetAtTime(0.0001, start, 0.02);
      previous = step.to || step.f;
      continue;
    }

    if (step.type === 'fric') {
      hissBand.frequency.setValueAtTime(spec.band[0] * (size * 0.5 + 0.5), start);
      hissBand.Q.setValueAtTime(spec.band[1], start);
      hissGain.gain.setTargetAtTime(spec.amp * 0.5, start, 0.012);
      buzzGain.gain.setTargetAtTime(spec.voiced ? 0.28 : 0.0001, start, 0.014);
      aspGain.gain.setTargetAtTime(0.0001, start, 0.02);
      continue;
    }

    if (step.type === 'stop') {
      // Silence, then the burst. The silence is the sound.
      const hold = Math.min(spec.hold / 1000, step.dur * 0.6);
      buzzGain.gain.setTargetAtTime(spec.voiced ? 0.1 : 0.0001, start, 0.008);
      aspGain.gain.setTargetAtTime(0.0001, start, 0.01);
      hissGain.gain.setTargetAtTime(0.0001, start, 0.008);
      const burstAt = start + hold;
      hissBand.frequency.setValueAtTime(spec.burst[0] * (size * 0.5 + 0.5), burstAt);
      hissBand.Q.setValueAtTime(spec.burst[1], burstAt);
      hissGain.gain.setValueAtTime(0.0001, burstAt);
      hissGain.gain.linearRampToValueAtTime(spec.amp * 0.55, burstAt + 0.006);
      hissGain.gain.setTargetAtTime(spec.tail ? spec.amp * 0.4 : 0.0001, burstAt + 0.012,
        spec.tail ? 0.05 : 0.018);
      if (spec.tail) {
        const tail = MR_PHONEMES[spec.tail];
        hissBand.frequency.setValueAtTime(tail.band[0] * (size * 0.5 + 0.5), burstAt + 0.02);
      }
      previous = null;
      continue;
    }
  }

  buzzGain.gain.setTargetAtTime(0.0001, at + plan.seconds, 0.025);
  aspGain.gain.setTargetAtTime(0.0001, at + plan.seconds, 0.025);
  hissGain.gain.setTargetAtTime(0.0001, at + plan.seconds, 0.02);
  buzz.start(at); buzz.stop(end);
  aspirate.start(at); aspirate.stop(end);
  hiss.start(at); hiss.stop(end);
  mrAudio.nodes.push(buzz, aspirate, hiss);
  return plan.seconds;
}
