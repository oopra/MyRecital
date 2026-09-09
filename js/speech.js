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

// The words English spelling will never yield to a rule. Short and common: between them
// these account for a large share of any page of ordinary prose, and every one of them
// would come out wrong from the rules below.
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
  love: 'L AH V', live: 'L IH V', give: 'G IH V', gave: 'G EY V', again: 'AX G EH N',
  against: 'AX G EH N S T', many: 'M EH N IY', any: 'EH N IY', money: 'M AH N IY',
  water: 'W AO T ER', walk: 'W AO K', walked: 'W AO K T', talk: 'T AO K', talked: 'T AO K T',
  laugh: 'L AE F', laughed: 'L AE F T', enough: 'IH N AH F', though: 'DH OW',
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
  another: 'AX N AH DH ER', mother: 'M AH DH ER', father: 'F AA DH ER', brother: 'B R AH DH ER',
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
  among: 'AX M AH NG', country: 'K AH N T R IY', trouble: 'T R AH B AX L',
  double: 'D AH B AX L', touch: 'T AH CH', queen: 'K W IY N',
  king: 'K IH NG', boy: 'B OY', girl: 'G ER L', man: 'M AE N', men: 'M EH N',
  sun: 'S AH N', moon: 'M UW N', star: 'S T AA R', sky: 'S K AY',
  fire: 'F AY ER', hour: 'AW ER'
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
  [null, 'ing', null, 'IH NG'], [null, 'ies', null, 'IY Z'], [null, 'ied', null, 'IY D'],
  [/[^aeiou]$/, 'y', /^$/, 'IY'], [/[^aeiou]$/, 'y', /^s$/, 'IY'],
  [null, 'ed', /^$/, 'D'],                     // voicing is fixed up afterwards
  [null, 'le', /^$/, 'AX L'],                  // temple, people, little
  [null, 'e', /^$/, ''],                       // the silent e, handled by the vowel rules
  [null, 'es', /^$/, 'IH Z'],
  [/^$/, 'be', /^[^aeiouy]/, 'B IH'],          // beside, begin, before

  // Consonant digraphs.
  [null, 'sch', null, 'S K'], [null, 'tch', null, 'CH'],
  [null, 'ch', null, 'CH'], [null, 'sh', null, 'SH'], [null, 'ph', null, 'F'],
  [null, 'th', null, 'TH'], [null, 'wh', null, 'W'], [null, 'qu', null, 'K W'],
  [null, 'ck', null, 'K'], [null, 'gh', /^t/, ''], [null, 'gh', null, 'G'],
  [null, 'ng', /^$/, 'NG'], [null, 'nk', null, 'NG K'],
  [/^$/, 'kn', null, 'N'], [/^$/, 'wr', null, 'R'], [/^$/, 'gn', null, 'N'],
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
  [null, 'ar', null, 'AA R'], [null, 'or', null, 'AO R'],
  [null, 'er', null, 'ER'], [null, 'ir', null, 'ER'], [null, 'ur', null, 'ER'],

  // Single vowels: long before a consonant and a silent e, short otherwise.
  [null, 'a', /^$/, 'AX'],                     // Aruna, India, a final a is a schwa
  [null, 'a', /^tion/, 'EY'],                  // nation, station
  [null, 'a', /^[^aeiouy]e$/, 'EY'], [null, 'e', /^[^aeiouy]e$/, 'IY'],
  [null, 'i', /^[^aeiouy]e$/, 'AY'], [null, 'o', /^[^aeiouy]e$/, 'OW'],
  [null, 'u', /^[^aeiouy]e$/, 'UW'],
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
  [null, 's', /^$/, 'Z'], [null, 's', null, 'S'],
  [null, 'x', null, 'K S'], [null, 'j', null, 'JH'], [null, 'z', null, 'Z'],
  [null, 'b', null, 'B'], [null, 'd', null, 'D'], [null, 'f', null, 'F'],
  [null, 'h', null, 'HH'], [null, 'k', null, 'K'], [null, 'l', null, 'L'],
  [null, 'm', null, 'M'], [null, 'n', null, 'N'], [null, 'p', null, 'P'],
  [null, 'r', null, 'R'], [null, 't', null, 'T'], [null, 'v', null, 'V'],
  [null, 'w', null, 'W'], [null, "'", null, '']
];

// One word to phonemes. The dictionary first, then the rules, then the endings that the
// rules deliberately leave for last because they depend on the sound before them.
function phonemesForWord(word) {
  const clean = String(word || '').toLowerCase().replace(/[^a-z']/g, '');
  if (!clean) return [];
  if (MR_LEXICON[clean]) return MR_LEXICON[clean].split(' ');

  // A plural or a past tense of something in the dictionary is still in the dictionary.
  for (const [suffix, sound] of [['s', 'S'], ['ed', 'D'], ['ing', 'IH NG']]) {
    if (clean.length > suffix.length + 2 && clean.endsWith(suffix)) {
      const stem = clean.slice(0, -suffix.length);
      if (MR_LEXICON[stem]) {
        const base = MR_LEXICON[stem].split(' ');
        return base.concat(mrInflect(base[base.length - 1], suffix, sound));
      }
    }
  }

  const out = [];
  let at = 0;
  const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AX', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
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
  const collapsed = sounds.filter((p, i) => p !== sounds[i - 1] || VOWELS.indexOf(p) >= 0);
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

// A whole line to phonemes, with the pauses punctuation asks for.
function phonemesFor(text) {
  const out = [];
  const words = String(text || '').split(/(\s+|[,;:.!?—-]+)/);
  for (const chunk of words) {
    if (!chunk || /^\s+$/.test(chunk)) continue;
    if (/^[,;:.!?—-]+$/.test(chunk)) {
      if (out[out.length - 1] !== '_') out.push('_');
      continue;
    }
    const sounds = phonemesForWord(chunk);
    if (!sounds.length) continue;
    if (out.length && out[out.length - 1] !== '_') out.push('_');
    out.push(...sounds);
  }
  return out;
}

// ---------------------------------------------------------------- sounds to sound

// The phoneme list as a plan: what to do, for how long, at what pitch. Kept separate from
// the audio graph so it can be tested, and so the mouth can be driven from the same plan.
function speechPlan(text, opts) {
  const o = opts || {};
  const rate = o.rate || 1;
  const phonemes = o.phonemes || phonemesFor(text);
  const question = /\?\s*$/.test(String(text || ''));
  const plan = [];
  let at = 0;

  phonemes.forEach((name, i) => {
    const spec = MR_PHONEMES[name];
    if (!spec) return;
    // A syllable at the end of a phrase is longer, which is most of what makes speech
    // sound like phrases rather than like a list of words.
    const last = i >= phonemes.length - 2;
    const seconds = (spec.dur / 1000) * (last ? 1.25 : 1) / rate;
    plan.push({ phoneme: name, type: spec.type, at, dur: seconds, spec });
    at += seconds;
  });

  // Intonation: down across a statement, up at the end of a question. Applied to the plan
  // rather than to the graph so a test can read it.
  const total = at || 1;
  for (const step of plan) {
    const progress = step.at / total;
    step.pitch = question ? 1 + progress * 0.3 : 1.06 - progress * 0.22;
  }
  return { steps: plan, seconds: at, phonemes };
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
    const spec = step.spec;
    const open = step.type === 'silence' ? 0
      : step.type === 'vowel' ? 1
        : step.type === 'stop' ? 0.25
          : spec.amp != null ? Math.min(1, spec.amp + 0.15) : 0.5;
    return { open, viseme };
  }
  return { open: 0, viseme: 'rest' };
}

// ---------------------------------------------------------------- the voice

// A glottal pulse: harmonics falling at about 12 dB per octave, which is what a voice
// actually does. A plain sawtooth is close but buzzier, and this costs one array.
let mrGlottalWave = null;
function mrGlottal(ctx) {
  if (mrGlottalWave && mrGlottalWave.ctx === ctx) return mrGlottalWave.wave;
  const size = 30;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let n = 1; n < size; n++) imag[n] = 1 / (n * n * 0.6 + n * 0.4);
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  mrGlottalWave = { ctx, wave };
  return wave;
}

// Speak one line. Three tracking resonators fed by a buzz and a hiss: the buzz is the
// vocal folds, the hiss is everything made with air, and the resonators are the mouth.
// Everything is scheduled up front, like the score, so playback and recording agree.
function mrSpeakWords(text, at, profile, rate, gainValue) {
  const ctx = mrAudio.ctx;
  if (!ctx) return 0;
  const plan = speechPlan(text, { rate });
  if (!plan.steps.length) return 0;

  // A voice's pitch also scales its formants: a small head makes a small mouth, and a
  // child whose formants stayed where an adult's are sounds like an adult on helium.
  const pitchHz = mrMidiToHz(profile.pitch || 52);
  const size = Math.pow(2, (52 - (profile.pitch || 52)) / 34);   // taller voice, longer tract
  // High voices push far more energy through the resonators than low ones, so the level is
  // compensated by pitch. Without this a child is twice as loud as an old man saying the
  // same line, and every reel with both in it needs mixing by hand.
  const level = (gainValue == null ? 1 : gainValue) * 0.55 * Math.pow(2, (52 - (profile.pitch || 52)) / 40);
  const end = at + plan.seconds + 0.08;

  const buzz = ctx.createOscillator();
  buzz.setPeriodicWave(mrGlottal(ctx));
  const buzzGain = ctx.createGain();
  buzzGain.gain.value = 0;
  buzz.connect(buzzGain);

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

  // Three resonators in parallel, mixed: the standard cheap vocal tract. The Q is lower
  // than a textbook would suggest on purpose. A deep voice has its harmonics far apart, and
  // a sharp resonator sitting between two of them passes almost nothing — which is how the
  // first version of this ended up with a loud child and an inaudible old man.
  const formants = [0, 1, 2].map((n) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = n === 0 ? 5 : n === 1 ? 6.5 : 8;
    const gain = ctx.createGain();
    gain.gain.value = n === 0 ? 1 : n === 1 ? 0.7 : 0.4;
    buzzGain.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    return filter;
  });

  // The voice bar: the fundamental and its first harmonics, straight through. It carries no
  // vowel information at all — it is there so every voice has a body and a pitch you can
  // hear, whatever the formants happen to be doing.
  const bar = ctx.createBiquadFilter();
  bar.type = 'lowpass';
  bar.frequency.value = Math.max(220, pitchHz * 2.4);
  const barGain = ctx.createGain();
  barGain.gain.value = 0.6;
  buzzGain.connect(bar); bar.connect(barGain); barGain.connect(out);

  hissGain.connect(out);

  const setTargets = (time, target, glide) => {
    for (let n = 0; n < 3; n++) {
      const hz = Math.max(120, target[n] * size);
      if (glide) formants[n].frequency.linearRampToValueAtTime(hz, time);
      else formants[n].frequency.setValueAtTime(hz, time);
    }
  };

  let previous = null;
  for (const step of plan.steps) {
    const start = at + step.at;
    const stop = start + step.dur;
    const spec = step.spec;
    buzz.frequency.setValueAtTime(pitchHz * step.pitch, start);

    if (step.type === 'silence') {
      buzzGain.gain.setTargetAtTime(0.0001, start, 0.01);
      hissGain.gain.setTargetAtTime(0.0001, start, 0.01);
      previous = null;
      continue;
    }

    if (step.type === 'vowel' || step.type === 'nasal' || step.type === 'liquid') {
      const amp = (spec.amp != null ? spec.amp : 1) * 0.9;
      // Formants glide from wherever the last sound left them: those transitions are how
      // a listener tells a /d/ from a /g/, so they matter more than the steady parts.
      if (previous) setTargets(start + Math.min(0.045, step.dur * 0.4), spec.f, true);
      else setTargets(start, spec.f, false);
      if (spec.to) setTargets(stop, spec.to, true);          // a diphthong glides on
      buzzGain.gain.setTargetAtTime(amp, start, 0.012);
      hissGain.gain.setTargetAtTime(0.0001, start, 0.02);
      previous = spec.to || spec.f;
      continue;
    }

    if (step.type === 'fric') {
      hissBand.frequency.setValueAtTime(spec.band[0] * (size * 0.5 + 0.5), start);
      hissBand.Q.setValueAtTime(spec.band[1], start);
      hissGain.gain.setTargetAtTime(spec.amp * 0.5, start, 0.01);
      buzzGain.gain.setTargetAtTime(spec.voiced ? 0.25 : 0.0001, start, 0.012);
      continue;
    }

    if (step.type === 'stop') {
      // Silence, then the burst. The silence is the sound.
      const hold = Math.min(spec.hold / 1000, step.dur * 0.6);
      buzzGain.gain.setTargetAtTime(spec.voiced ? 0.08 : 0.0001, start, 0.008);
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

  buzzGain.gain.setTargetAtTime(0.0001, at + plan.seconds, 0.02);
  hissGain.gain.setTargetAtTime(0.0001, at + plan.seconds, 0.02);
  buzz.start(at); buzz.stop(end);
  hiss.start(at); hiss.stop(end);
  mrAudio.nodes.push(buzz, hiss);
  return plan.seconds;
}
