// period.js — when the story happens.
//
// A history reel is wrong in a way a fable never is: if the people in it are dressed for
// the wrong century, the video teaches something false before it says a word. So the era
// is a setting of the project, and it dresses the whole cast, tints the scenery, picks the
// palette and tells the director which landmark belongs on the skyline.
//
// What a period does NOT do is assign anyone a face or a skin colour. Every era on this
// list held every kind of person; deciding otherwise from a date would be both crude and
// false. Clothing, buildings and colour are the parts a date can honestly settle, and they
// are the parts that carry the century anyway.
//
// The pools are deliberately small. Ten sets of clothes drawn as silhouettes will never be
// a costume history — they are the difference between "someone in a robe" and "someone in
// jeans in ancient Egypt", which is the difference that matters to a child watching.

const MR_PERIODS = {
  egypt: {
    name: 'Ancient Egypt', when: 'about 3000–30 BCE',
    note: 'Linen kilts and long shifts, broad collars, striped nemes headcloths. Sun, sand and river.',
    palette: 'sand', backgrounds: ['flatland', 'village'],
    costumes: ['kilt', 'kilt', 'robe'], headwear: ['nemes', 'none', 'nemes', 'crown'],
    hair: ['bald', 'long', 'short'],
    cloth: ['#f2ead6', '#e8dcc0', '#ded0b0', '#e0b23c'], trim: '#e0b23c',
    landmark: 'pyramid', props: ['pyramid', 'pot', 'well', 'banner', 'spear']
  },
  india: {
    name: 'Ancient India', when: 'about 1500–200 BCE',
    note: 'Dhotis, draped sarees, unstitched cloth and turbans. Forest, river and village.',
    palette: 'comicday', backgrounds: ['village', 'flatland'],
    costumes: ['dhoti', 'saree', 'kurta'], headwear: ['none', 'turban', 'none', 'crown'],
    hair: ['long', 'bun', 'braid', 'short'],
    cloth: ['#f0e2c4', '#e2b45a', '#c2452d', '#e8ddc8'], trim: '#c9962e',
    landmark: 'house', props: ['tree', 'pot', 'well', 'fire', 'cart', 'spear']
  },
  greece: {
    name: 'Ancient Greece', when: 'about 800–300 BCE',
    note: 'Pinned chitons, wreaths, crested helmets. White stone and blue sea.',
    palette: 'marble', backgrounds: ['flatland', 'village'],
    costumes: ['chiton', 'chiton', 'robe'], headwear: ['none', 'laurel', 'none', 'helmet'],
    hair: ['short', 'long', 'bun'],
    cloth: ['#f6f1e2', '#e8e0cc', '#d8cdb4', '#b8452f', '#3f6b8a'], trim: '#b8452f',
    landmark: 'column', props: ['column', 'pot', 'spear', 'tree', 'table']
  },
  rome: {
    name: 'Ancient Rome', when: 'about 500 BCE–476 CE',
    note: 'Tunics under draped togas, laurel, legionary helmets. Marble, red and gold.',
    palette: 'marble', backgrounds: ['village', 'flatland'],
    costumes: ['toga', 'chiton', 'toga'], headwear: ['none', 'laurel', 'helmet', 'none'],
    hair: ['short', 'bun', 'long'],
    cloth: ['#f4ece0', '#e6dcc8', '#c8543c'], trim: '#c9962e',
    landmark: 'column', props: ['column', 'banner', 'spear', 'cart', 'table']
  },
  china: {
    name: 'Imperial China', when: 'about 200 BCE–1900 CE',
    note: 'Long crossed robes with wide sleeves, sashes, scholar caps.',
    palette: 'bloom', backgrounds: ['flatland', 'village'],
    costumes: ['robe', 'robe', 'gown'], headwear: ['cap', 'none', 'cap', 'crown'],
    hair: ['bun', 'long', 'bun'],
    cloth: ['#c23b3b', '#2e5b8a', '#e0d2b4', '#3f6b4a'], trim: '#e0b23c',
    landmark: 'tower', props: ['tree', 'banner', 'table', 'pot', 'door']
  },
  medieval: {
    name: 'Medieval Europe', when: 'about 500–1500 CE',
    note: 'Belted tunics and long gowns, hoods, mail and helms. Grey stone and forest.',
    palette: 'stone', backgrounds: ['village', 'forest'],
    costumes: ['gown', 'chiton', 'gown', 'robe'], headwear: ['hood', 'none', 'helmet', 'crown'],
    hair: ['long', 'short', 'braid'],
    cloth: ['#7a4a3a', '#4a5f7a', '#5f6b4a', '#8a6a3f'], trim: '#c9a24a',
    landmark: 'tower', props: ['tower', 'tree', 'banner', 'cart', 'fire', 'spear']
  },
  mughal: {
    name: 'Mughal India', when: '1526–1857',
    note: 'Flared jamas over churidar, sashes, sarees, turbans. Arches, gardens and gold.',
    palette: 'mughal', backgrounds: ['village', 'flatland'],
    costumes: ['jama', 'saree', 'jama', 'kurta'], headwear: ['turban', 'none', 'turban', 'crown'],
    hair: ['bun', 'braid', 'long'],
    cloth: ['#f0e6d2', '#3f6b7a', '#8a3f5f', '#e2c07a'], trim: '#d8a63c',
    landmark: 'door', props: ['door', 'tree', 'pot', 'banner', 'table']
  },
  sail: {
    name: 'Age of Sail', when: 'about 1600–1800',
    note: 'Frock coats and three-cornered hats, long gowns, buckles and brass.',
    palette: 'sepia', backgrounds: ['village', 'waves'],
    costumes: ['coat', 'gown', 'coat'], headwear: ['tricorn', 'bonnet', 'none', 'tricorn'],
    hair: ['long', 'bun', 'short'],
    cloth: ['#3f4f6b', '#6b3f3f', '#4a5f4a', '#8a7a5e'], trim: '#d8c07a',
    landmark: 'house', props: ['house', 'cart', 'banner', 'table', 'pot']
  },
  victorian: {
    name: 'Industrial age', when: 'about 1800–1900',
    note: 'Frock coats and top hats, bonnets and full skirts. Brick, smoke and gaslight.',
    palette: 'sepia', backgrounds: ['city', 'village'],
    costumes: ['coat', 'gown', 'coat'], headwear: ['tophat', 'bonnet', 'none', 'cap'],
    hair: ['bun', 'short', 'long'],
    cloth: ['#2f3542', '#4a3a32', '#5f4a5a', '#6b6b5a'], trim: '#b49a6a',
    landmark: 'house', props: ['house', 'cart', 'door', 'table', 'fire']
  },
  modern: {
    name: 'Modern', when: '1900 to now',
    note: 'Ordinary clothes. The default, and the only period that needs no research.',
    palette: 'comicday', backgrounds: ['city', 'flatland'],
    costumes: ['modern'], headwear: ['none', 'none', 'cap'],
    hair: ['short', 'long', 'bun', 'braid'],
    // No cloth list: modern clothes are any colour, so this period leaves colour alone and
    // characters keep whatever they were given.
    cloth: null, trim: '#e8c46a',
    landmark: 'house', props: ['house', 'chair', 'table', 'tree', 'door']
  }
};

const MR_PERIOD_KEYS = Object.keys(MR_PERIODS);
// Each period knows its own key, so a character can record which era they are dressed for.
for (const key of MR_PERIOD_KEYS) MR_PERIODS[key].key = key;

// The handful of garments in these pools that a story would not put on anyone: a saree on
// a boy reads as a mistake even when the drawing is fine. Everything not listed here is
// worn by anybody, which is most of it — and the story has to actually say which before
// any of this applies.
const MR_COSTUME_GENDER = { saree: 'f', gown: 'f', dhoti: 'm', kilt: 'm', toga: 'm', coat: 'm', jama: 'm' };
const MR_HEADWEAR_GENDER = { bonnet: 'f', tophat: 'm', tricorn: 'm', turban: 'm', nemes: 'm', helmet: 'm' };

function mrSuitable(list, table, gender) {
  if (!gender) return list;
  const kept = list.filter((item) => !table[item] || table[item] === gender);
  return kept.length ? kept : list;
}

function periodOf(key) {
  return MR_PERIODS[key] || MR_PERIODS.modern;
}

function projectPeriod(project) {
  return periodOf(project && project.style && project.style.period);
}

// A stable choice from a list for a given name: the same character gets the same clothes
// in every scene, and two characters usually get different ones. Re-running the wardrobe
// is therefore idempotent, which matters because it is a button anyone can press twice.
function mrPickFor(list, name, salt) {
  if (!list || !list.length) return null;
  const text = String(name || '') + '|' + (salt || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return list[Math.abs(hash) % list.length];
}

// Dress one character for the era. A character remembers which era they were dressed for,
// which is what makes the button safe to press twice: dressing for the period you are
// already in changes nothing, so the hat you picked by hand afterwards survives. Changing
// period re-dresses from scratch, because half a Roman is worse than none.
function dressActorForPeriod(actor, period, opts) {
  const o = opts || {};
  if (!o.force && actor.period === period.key) return actor;
  const key = actor.name || actor.id || 'someone';
  const gender = o.gender || actor.gender || null;
  actor.costume = mrPickFor(mrSuitable(period.costumes, MR_COSTUME_GENDER, gender), key, 'costume');
  actor.headwear = mrPickFor(mrSuitable(period.headwear, MR_HEADWEAR_GENDER, gender), key, 'hat');
  actor.hairStyle = mrPickFor(period.hair, key, 'hair');
  // Cloth colour is period work too: a Roman in neon is as wrong as a Roman in jeans.
  if (o.colours !== false && period.cloth) {
    actor.top = mrPickFor(period.cloth, key, 'top');
    actor.bottom = mrPickFor(period.cloth, key, 'bottom');
    actor.trim = period.trim;
    actor.headwearColour = mrPickFor(period.cloth, key, 'hatcolour');
  }
  actor.period = period.key;
  if (gender) actor.gender = gender;   // remembered, so re-dressing does not undo it
  return actor;
}

// The whole era, applied to a whole reel, as one edit: clothes, colours, palette and the
// flat scenery behind everyone. Every part of it is an ordinary setting afterwards.
function applyPeriod(project, key, opts) {
  const o = opts || {};
  const period = periodOf(key);
  project.style = Object.assign({}, project.style, { period: key });
  if (o.palette !== false) project.style.palette = period.palette;
  project.scenes.forEach((scene, i) => {
    if (scene.kind !== 'title' && o.backgrounds !== false) {
      scene.background = period.backgrounds[i % period.backgrounds.length];
    }
    for (const actor of (scene.stage && scene.stage.actors) || []) {
      dressActorForPeriod(actor, period, o);
    }
  });
  return period;
}
