// Piano chord voicing: unlike the ukulele fretboard, there's no fingering
// search to do -- piano keys are laid out by pitch class already, so a
// chord's diagram is just "light up every chord tone within one octave"
// using the same shared theory (chord-theory.js) the other instruments
// build from.

const PIANO_WHITE_PC = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const PIANO_BLACK_PC = [1, 3, null, 6, 8, 10, null]; // C# D# (gap) F# G# A# (gap), aligned to the white key each sits after

function pianoVoicing(sym) {
  return chordTones(sym); // { rootPc, quality, label, flatPreferred, tones }
}

// The actual playable pitches (Hz) for a chord: the root doubled an
// octave down as a bass note, plus every chord tone in the octave above
// -- a plain "bass note + block chord" piano voicing, for anything that
// wants to *sound* the chord (the Metronome mode backing track).
function pianoChordFrequencies(sym) {
  const chord = pianoVoicing(sym);
  if (!chord) return null;
  const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const bass = midiToHz(48 + chord.rootPc); // one octave below middle C's octave
  const upper = chord.tones.map((t) => midiToHz(60 + t.pc));
  return [bass, ...upper];
}

function renderPianoChordDiagram(container, sym) {
  const chord = pianoVoicing(sym);
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

  const activePc = new Set(chord.tones.map((t) => t.pc));
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 140 112');
  svg.setAttribute('class', 'chord-diagram-svg piano-diagram-svg');

  // One octave of white keys, C to B.
  PIANO_WHITE_PC.forEach((pc, i) => {
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', i * 20);
    rect.setAttribute('y', 0);
    rect.setAttribute('width', 19);
    rect.setAttribute('height', 90);
    rect.setAttribute('class', 'piano-key piano-key-white' + (activePc.has(pc) ? (pc === chord.rootPc ? ' piano-key-root' : ' piano-key-active') : ''));
    svg.appendChild(rect);

    if (activePc.has(pc)) {
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', i * 20 + 9.5);
      label.setAttribute('y', 102);
      label.setAttribute('class', 'chord-diagram-string-label');
      label.textContent = pcName(pc, chord.flatPreferred);
      svg.appendChild(label);
    }
  });

  // The 5 black keys, each sitting between the two white keys it's named
  // after (skipping the E-F and B-C gaps where there is no black key).
  PIANO_BLACK_PC.forEach((pc, i) => {
    if (pc === null) return;
    const x = (i + 1) * 20 - 6;
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', 0);
    rect.setAttribute('width', 12);
    rect.setAttribute('height', 55);
    rect.setAttribute('class', 'piano-key piano-key-black' + (activePc.has(pc) ? (pc === chord.rootPc ? ' piano-key-root' : ' piano-key-active') : ''));
    svg.appendChild(rect);

    if (activePc.has(pc)) {
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', x + 6);
      label.setAttribute('y', 66);
      label.setAttribute('class', 'chord-diagram-fret-label');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = pcName(pc, chord.flatPreferred);
      svg.appendChild(label);
    }
  });

  container.appendChild(svg);
}

window.ChordsPiano = {
  renderChordDiagram: renderPianoChordDiagram,
  chordFrequencies: pianoChordFrequencies,
};
