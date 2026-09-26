// Saxophone is monophonic -- there's no "voicing" or fingering diagram to
// draw the way there is for ukulele/piano, since a sax plays one note at
// a time, not a stack of them. So instead of a diagram, this shows the
// chord spelled out as individual written notes (transposed for the
// player's actual horn) to read or improvise from, and the backing track
// only ever sounds the root -- the one note a saxophonist could actually
// hold against the harmony.
//
// A real per-note fingering-key diagram (like the fretboard/keyboard) was
// deliberately left out: getting saxophone key combinations wrong would
// actively teach bad technique, and that data wasn't available to verify
// in this environment. This can be added later against a confirmed
// reference chart.

// Alto (Eb) saxophone sounds a major sixth below what's written, so to
// get the note a player should read/finger from a concert (sounding)
// pitch class, shift it up a major sixth (9 semitones).
const SAX_TRANSPOSE = { alto: 9 };
let saxInstrumentKey = 'alto'; // only alto is supported for now (see chords-saxophone.js header)

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

  const list = document.createElement('ul');
  list.className = 'sax-chord-tones';
  chord.tones.forEach((t) => {
    const item = document.createElement('li');
    item.className = 'sax-chord-tone' + (t.pc === chord.rootPc ? ' sax-chord-tone-root' : '');
    const written = document.createElement('span');
    written.className = 'sax-chord-tone-written';
    written.textContent = pcName(t.writtenPc, chord.flatPreferred);
    const role = document.createElement('span');
    role.className = 'sax-chord-tone-role';
    role.textContent = t.role;
    const sounds = document.createElement('span');
    sounds.className = 'sax-chord-tone-sounds';
    sounds.textContent = `sounds ${pcName(t.pc, chord.flatPreferred)}`;
    item.appendChild(written);
    item.appendChild(role);
    item.appendChild(sounds);
    list.appendChild(item);
  });
  container.appendChild(list);
}

window.ChordsSaxophone = {
  renderChordDiagram: renderSaxChordDiagram,
  chordFrequencies: saxChordFrequencies,
};
