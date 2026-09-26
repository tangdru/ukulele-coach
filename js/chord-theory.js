// Shared chord-symbol parsing and pitch-class theory used by every
// instrument's chord module (ukulele fretboard search, piano voicing,
// saxophone note spelling) -- one parser and one interval table, so
// "Bbm7" means the exact same set of pitch classes everywhere instead of
// each instrument module re-deriving (and possibly disagreeing on) it.

const ROOT_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const CHORD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
};

// Generic name for each interval size, for labeling a chord tone's role
// (root/3rd/5th/...) the same way regardless of which quality it came
// from -- a minor chord's "3rd" and a major chord's "3rd" are different
// intervals but the same role.
const INTERVAL_ROLE = {
  0: 'root', 1: 'b2', 2: '2nd', 3: 'b3', 4: '3rd', 5: '4th',
  6: 'b5', 7: '5th', 8: '#5', 9: '6th', 10: 'b7', 11: '7th',
};

function parseChordSymbol(sym) {
  if (!sym) return null;
  const cleaned = sym.replace(/\(.*?\)/g, '').split('/')[0].trim();
  const m = cleaned.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return null;
  const rootKey = m[1].toUpperCase() + m[2];
  const rootPc = ROOT_PC[rootKey];
  if (rootPc === undefined) return null;

  const rest = m[3].toLowerCase();
  let quality = 'major';
  if (/^(maj7|maj9|Δ)/.test(rest)) quality = 'maj7';
  else if (/^maj/.test(rest)) quality = 'major';
  else if (/^(dim|°)/.test(rest)) quality = 'dim';
  else if (/^(aug|\+)/.test(rest)) quality = 'aug';
  else if (/^sus4/.test(rest)) quality = 'sus4';
  else if (/^sus2/.test(rest)) quality = 'sus2';
  else if (/^(m6|min6)/.test(rest)) quality = 'm6';
  else if (/^(m7|min7|m9|min9)/.test(rest)) quality = 'm7';
  else if (/^(m|min)(?!aj)/.test(rest)) quality = 'minor';
  else if (/^(7|9|11|13)/.test(rest)) quality = '7';
  else if (/^6/.test(rest)) quality = '6';

  // A root spelled with a flat (Bb, Eb, ...) means the rest of the chord's
  // notes should probably be spelled with flats too, for anything that
  // needs to print note names rather than just pitch classes.
  return { rootPc, quality, label: cleaned, flatPreferred: m[2] === 'b' };
}

// Every pitch class in a chord -- root plus all interval tones for its
// quality -- each labeled with its generic role. The one fact every
// instrument's chord module builds its own voicing/diagram from.
function chordTones(sym) {
  const parsed = parseChordSymbol(sym);
  if (!parsed) return null;
  const intervals = CHORD_INTERVALS[parsed.quality] || CHORD_INTERVALS.major;
  const tones = intervals.map((iv) => ({
    pc: (parsed.rootPc + iv) % 12,
    interval: iv,
    role: INTERVAL_ROLE[iv] || `${iv}`,
  }));
  return { rootPc: parsed.rootPc, quality: parsed.quality, label: parsed.label, flatPreferred: parsed.flatPreferred, tones };
}

function pcName(pc, preferFlat) {
  const names = preferFlat ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return names[((pc % 12) + 12) % 12];
}
