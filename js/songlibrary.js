// Persists user-provided songs (pasted, uploaded, or converted from a
// PDF/Word lead sheet) to localStorage, so they're available again next
// time without re-uploading or re-converting. Demo songs (js/songs.js)
// aren't stored here -- they're already always available -- but they're
// merged in wherever this module lists "everything available."

const SONG_LIBRARY_KEY = 'ukeCoachSongLibrary';

function loadSongLibrary() {
  try {
    const raw = localStorage.getItem(SONG_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSongToLibrary(title, chordproText) {
  if (!title || !title.trim()) return;
  const library = loadSongLibrary();
  const existingIdx = library.findIndex((s) => s.title === title);
  const entry = { title, text: chordproText, savedAt: Date.now() };
  if (existingIdx >= 0) library[existingIdx] = entry;
  else library.push(entry);
  try {
    localStorage.setItem(SONG_LIBRARY_KEY, JSON.stringify(library));
  } catch {
    // Storage full or unavailable (private browsing, quota) -- the song
    // still loaded fine this session, it just won't persist. Not worth
    // interrupting the user over.
  }
}

function deleteSongFromLibrary(title) {
  const library = loadSongLibrary().filter((s) => s.title !== title);
  try {
    localStorage.setItem(SONG_LIBRARY_KEY, JSON.stringify(library));
  } catch {
    // See saveSongToLibrary.
  }
}

// Returns { title: chordproText } for every song available: bundled
// demos plus everything saved. A library entry with the same title as a
// demo overrides it (the user's own edited version wins).
function allAvailableSongs() {
  const combined = { ...DEMO_SONGS };
  for (const s of loadSongLibrary()) combined[s.title] = s.text;
  return combined;
}
