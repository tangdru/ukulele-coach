// Persists user-provided songs (pasted, uploaded, or converted from a
// PDF/Word lead sheet) to a shared Supabase table, so they're available
// again next time -- on this device or any other -- without re-uploading
// or re-converting. Falls back to this browser's localStorage only if
// Supabase isn't configured (see config.js) or a request fails, so the
// app still works offline or without a database.
//
// Demo songs (js/songs.js) aren't stored here -- they're already always
// available -- but they're merged in wherever this module lists
// "everything available."

const SONG_LIBRARY_LOCAL_KEY = 'ukeCoachSongLibrary';
const SONGS_TABLE = 'uke_songs';

let supabaseClient = null;
if (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.anonKey && window.supabase) {
  supabaseClient = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
}

let libraryCache = null; // array of {title, text}, null until first loaded

function loadLocalLibrary() {
  try {
    const raw = localStorage.getItem(SONG_LIBRARY_LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalLibrary(library) {
  try {
    localStorage.setItem(SONG_LIBRARY_LOCAL_KEY, JSON.stringify(library));
  } catch {
    // Storage full or unavailable (private browsing, quota) -- not worth
    // interrupting the user over; Supabase (if configured) still has it.
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

// Fetches the library once (from Supabase if configured, else
// localStorage) and caches it in memory. Call this once at startup,
// before relying on allAvailableSongs() -- everything after that reads
// the cache synchronously and stays in sync via saveSongToLibrary's
// optimistic update.
async function ensureSongLibraryLoaded() {
  if (libraryCache !== null) return libraryCache;

  if (supabaseClient) {
    try {
      // A genuinely unreachable Supabase (network down, project paused)
      // can otherwise hang on the underlying fetch for a long time before
      // the browser gives up -- cap it so the localStorage fallback kicks
      // in promptly instead of stalling the whole library load.
      const { data, error } = await withTimeout(
        supabaseClient.from(SONGS_TABLE).select('title, text'),
        4000
      );
      if (error) throw error;
      libraryCache = data || [];
      saveLocalLibrary(libraryCache); // keep an offline mirror
      return libraryCache;
    } catch (err) {
      console.warn('Could not load song library from database, using local copy:', err);
    }
  }

  libraryCache = loadLocalLibrary();
  return libraryCache;
}

function allAvailableSongs() {
  const combined = { ...DEMO_SONGS };
  (libraryCache || []).forEach((s) => {
    combined[s.title] = s.text;
  });
  return combined;
}

// Optimistically updates the in-memory cache (and local mirror)
// immediately, so the UI never waits on the network, then syncs to
// Supabase in the background if configured.
function saveSongToLibrary(title, chordproText) {
  if (!title || !title.trim()) return;
  if (libraryCache === null) libraryCache = [];

  const idx = libraryCache.findIndex((s) => s.title === title);
  const entry = { title, text: chordproText };
  if (idx >= 0) libraryCache[idx] = entry;
  else libraryCache.push(entry);
  saveLocalLibrary(libraryCache);

  if (supabaseClient) {
    supabaseClient
      .from(SONGS_TABLE)
      .upsert({ title, text: chordproText, updated_at: new Date().toISOString() }, { onConflict: 'title' })
      .then(({ error }) => {
        if (error) console.warn('Could not sync song to database, saved locally only:', error);
      });
  }
}

function deleteSongFromLibrary(title) {
  if (libraryCache !== null) libraryCache = libraryCache.filter((s) => s.title !== title);
  saveLocalLibrary(libraryCache || []);

  if (supabaseClient) {
    supabaseClient
      .from(SONGS_TABLE)
      .delete()
      .eq('title', title)
      .then(({ error }) => {
        if (error) console.warn('Could not delete song from database:', error);
      });
  }
}
