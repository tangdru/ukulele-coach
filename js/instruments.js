// Which instrument's chord module is active -- shared, global state (not
// wrapped in app.js's IIFE) because both the chord-diagram modal (app.js)
// and the Metronome backing track (backing.js) need to look it up, and
// they're separate script-scope files.

const INSTRUMENTS = {
  ukulele: { id: 'ukulele', label: 'Ukulele', ...window.ChordsUkulele },
  piano: { id: 'piano', label: 'Piano', ...window.ChordsPiano },
  saxophone: { id: 'saxophone', label: 'Saxophone', ...window.ChordsSaxophone },
};

const INSTRUMENT_STORAGE_KEY = 'ukeCoachInstrument';

function loadSavedInstrumentId() {
  try {
    const saved = localStorage.getItem(INSTRUMENT_STORAGE_KEY);
    return INSTRUMENTS[saved] ? saved : 'ukulele';
  } catch {
    return 'ukulele';
  }
}

let currentInstrumentId = loadSavedInstrumentId();

function currentInstrument() {
  return INSTRUMENTS[currentInstrumentId];
}

function setCurrentInstrument(id) {
  if (!INSTRUMENTS[id] || id === currentInstrumentId) return;
  currentInstrumentId = id;
  try {
    localStorage.setItem(INSTRUMENT_STORAGE_KEY, id);
  } catch {
    // Private browsing / storage disabled -- the choice just won't persist
    // across reloads, which isn't worth interrupting the user over.
  }
}
