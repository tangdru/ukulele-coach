// Saxophone is monophonic -- a chord isn't one shape to hold the way it is
// on ukulele/piano, it's several individual notes to read or improvise
// from. So the "diagram" here is a row of small fingering diagrams, one
// per chord tone, each labeled with its written note (transposed for the
// player's actual horn) and role (root/3rd/5th/...). The backing track
// only ever sounds the root -- the one note a saxophonist could actually
// hold against the harmony.
//
// Fingerings below are transcribed from the Standard of Excellence Eb
// alto saxophone fingering chart (the primary/first-listed fingering for
// each note only, no alternates), covering one full chromatic octave with
// no register/octave key needed (written Bb3 up to A4) -- deliberately
// the one range simple enough to transcribe with real confidence from a
// reference image, the same way the ukulele/piano diagrams each show one
// representative octave rather than a specific performance passage. A
// chord tone's pitch class maps directly onto this table regardless of
// which octave it'd actually be played in.

// Alto (Eb) saxophone sounds a major sixth below what's written, so to
// get the note a player should read/finger from a concert (sounding)
// pitch class, shift it up a major sixth (9 semitones).
const SAX_TRANSPOSE = { alto: 9 };
let saxInstrumentKey = 'alto'; // only alto is supported for now

// Main left-hand (LH1-3) and right-hand (RH1-3) keys pressed for each
// written pitch class, plus any low-register pinky key or the dedicated
// G# key ("extra"). D4 (no extra key) and A4 (LH1 alone) anchor the
// table -- both are the simplest, least ambiguous fingerings on the horn
// and match the reference chart exactly, which is why this octave
// (Bb3-A4) was chosen over any other.
const SAX_FINGERINGS = {
  0: { keys: ['LH1', 'LH2', 'LH3', 'RH1', 'RH2', 'RH3'], extra: ['low C'] }, // C
  1: { keys: ['LH1', 'LH2', 'LH3', 'RH1', 'RH2', 'RH3'], extra: ['low C#'] }, // C#/Db
  2: { keys: ['LH1', 'LH2', 'LH3', 'RH1', 'RH2', 'RH3'], extra: [] }, // D
  3: { keys: ['LH1', 'LH2', 'LH3', 'RH1', 'RH2', 'RH3'], extra: ['low Eb'] }, // D#/Eb
  4: { keys: ['LH1', 'LH2', 'LH3', 'RH1', 'RH2'], extra: [] }, // E
  5: { keys: ['LH1', 'LH2', 'LH3', 'RH1'], extra: [] }, // F
  6: { keys: ['LH1', 'LH2', 'LH3'], extra: [] }, // F#/Gb
  7: { keys: ['LH1', 'LH2'], extra: [] }, // G
  8: { keys: ['LH1', 'LH2'], extra: ['G#'] }, // G#/Ab
  9: { keys: ['LH1'], extra: [] }, // A
  10: { keys: ['LH1', 'LH2', 'LH3', 'RH1', 'RH2', 'RH3'], extra: ['low Bb'] }, // A#/Bb
  11: { keys: ['LH1', 'LH2', 'LH3', 'RH1', 'RH2', 'RH3'], extra: ['low B'] }, // B/Cb
};
const SAX_ALL_KEYS = ['LH1', 'LH2', 'LH3', 'RH1', 'RH2', 'RH3'];

function saxChordSpelling(sym) {
  const chord = chordTones(sym);
  if (!chord) return null;
  const transpose = SAX_TRANSPOSE[saxInstrumentKey] || 0;
  return {
    ...chord,
    tones: chord.tones.map((t) => ({ ...t, writtenPc: (t.pc + transpose) % 12 })),
  };
}

// The backing track's one playable note: the root, at concert pitch (the
// actual sound, regardless of what a sax player would read/finger for it).
function saxChordFrequencies(sym) {
  const chord = chordTones(sym);
  if (!chord) return null;
  return [440 * Math.pow(2, (60 + chord.rootPc - 69) / 12)];
}

function renderSaxFingeringDot(svg, svgNS, cx, cy, pressed) {
  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('cx', cx);
  circle.setAttribute('cy', cy);
  circle.setAttribute('r', 5);
  circle.setAttribute('class', 'sax-key-dot' + (pressed ? ' sax-key-pressed' : ' sax-key-open'));
  svg.appendChild(circle);
}

function renderSaxTone(writtenPc) {
  const wrap = document.createElement('div');
  wrap.className = 'sax-tone';

  const fingering = SAX_FINGERINGS[writtenPc];
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 30 96');
  svg.setAttribute('class', 'sax-tone-svg');
  const pressedKeys = new Set(fingering ? fingering.keys : []);
  SAX_ALL_KEYS.forEach((key, i) => {
    const groupGap = i >= 3 ? 8 : 0; // small visual gap between the LH and RH groups of three
    renderSaxFingeringDot(svg, svgNS, 15, 8 + i * 14 + groupGap, pressedKeys.has(key));
  });
  wrap.appendChild(svg);

  if (fingering && fingering.extra.length) {
    const extra = document.createElement('div');
    extra.className = 'sax-tone-extra';
    extra.textContent = fingering.extra.join(' + ');
    wrap.appendChild(extra);
  }

  return wrap;
}

function renderSaxChordDiagram(container, sym) {
  const chord = saxChordSpelling(sym);
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'chord-diagram-title';
  title.textContent = sym;
  container.appendChild(title);

  if (!chord) {
    const unknown = document.createElement('div');
    unknown.className = 'chord-diagram-unknown';
    unknown.textContent = "Couldn't work out this chord.";
    container.appendChild(unknown);
    return;
  }

  const subtitle = document.createElement('div');
  subtitle.className = 'sax-diagram-subtitle';
  subtitle.textContent = 'Alto (Eb) — written pitch';
  container.appendChild(subtitle);

  const row = document.createElement('div');
  row.className = 'sax-chord-tones';
  chord.tones.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'sax-chord-tone' + (t.pc === chord.rootPc ? ' sax-chord-tone-root' : '');

    const written = document.createElement('div');
    written.className = 'sax-chord-tone-written';
    written.textContent = pcName(t.writtenPc, chord.flatPreferred);
    card.appendChild(written);

    card.appendChild(renderSaxTone(t.writtenPc));

    const role = document.createElement('div');
    role.className = 'sax-chord-tone-role';
    role.textContent = t.role;
    card.appendChild(role);

    const sounds = document.createElement('div');
    sounds.className = 'sax-chord-tone-sounds';
    sounds.textContent = `sounds ${pcName(t.pc, chord.flatPreferred)}`;
    card.appendChild(sounds);

    row.appendChild(card);
  });
  container.appendChild(row);
}

window.ChordsSaxophone = {
  renderChordDiagram: renderSaxChordDiagram,
  chordFrequencies: saxChordFrequencies,
};
