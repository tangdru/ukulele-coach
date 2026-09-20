// Persists Analyze Me session results (a letter grade plus which lines
// timing was off on) to a shared Supabase table, so practice history and
// "which parts of the chart keep giving you trouble" survive page
// reloads and are visible across devices. Falls back to this browser's
// localStorage only if Supabase isn't configured or a request fails --
// same optimistic-local-write-then-background-sync pattern as
// js/songlibrary.js.

const SESSION_HISTORY_LOCAL_KEY = 'ukeCoachSessionHistory';
const SESSIONS_TABLE = 'uke_sessions';
const HISTORY_LOAD_LIMIT = 200;

let sessionSupabaseClient = null;
if (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.anonKey && window.supabase) {
  sessionSupabaseClient = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
}

let sessionHistoryCache = null; // array of session records, most recent first, null until first loaded

function loadLocalSessionHistory() {
  try {
    const raw = localStorage.getItem(SESSION_HISTORY_LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSessionHistory(history) {
  try {
    localStorage.setItem(SESSION_HISTORY_LOCAL_KEY, JSON.stringify(history));
  } catch {
    // Storage full or unavailable (private browsing, quota) -- not worth
    // interrupting the user over; Supabase (if configured) still has it.
  }
}

function withHistoryTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

// Simple letter grade from the session's on-time percentage. Ungraded
// (no strums detected at all) shows as an em dash rather than an F --
// there's nothing to grade, not a failing performance.
function gradeForStats(onTimePct, count) {
  if (!count) return '—';
  if (onTimePct >= 90) return 'A';
  if (onTimePct >= 75) return 'B';
  if (onTimePct >= 60) return 'C';
  if (onTimePct >= 40) return 'D';
  return 'F';
}

function normalizeSessionRow(row) {
  return {
    songTitle: row.song_title,
    createdAt: row.created_at,
    count: row.count,
    onTimePct: row.on_time_pct,
    avgAbsMs: row.avg_abs_ms,
    grade: row.grade,
    lines: row.lines || [],
  };
}

// Fetches session history once (from Supabase if configured, else
// localStorage) and caches it in memory. Call this once at startup and
// again (it's a no-op after the first successful load) before rendering
// the history view.
async function ensureSessionHistoryLoaded() {
  if (sessionHistoryCache !== null) return sessionHistoryCache;

  if (sessionSupabaseClient) {
    try {
      const { data, error } = await withHistoryTimeout(
        sessionSupabaseClient
          .from(SESSIONS_TABLE)
          .select('*')
          .order('created_at', { ascending: false })
          .limit(HISTORY_LOAD_LIMIT),
        4000
      );
      if (error) throw error;
      sessionHistoryCache = (data || []).map(normalizeSessionRow);
      saveLocalSessionHistory(sessionHistoryCache); // keep an offline mirror
      return sessionHistoryCache;
    } catch (err) {
      console.warn('Could not load session history from database, using local copy:', err);
    }
  }

  sessionHistoryCache = loadLocalSessionHistory();
  return sessionHistoryCache;
}

function sessionHistorySnapshot() {
  return sessionHistoryCache || [];
}

// Optimistically adds to the in-memory cache and local mirror immediately
// so the UI never waits on the network, then syncs to Supabase in the
// background if configured.
function saveSessionToHistory(record) {
  if (sessionHistoryCache === null) sessionHistoryCache = [];
  sessionHistoryCache.unshift(record);
  saveLocalSessionHistory(sessionHistoryCache);

  if (sessionSupabaseClient) {
    sessionSupabaseClient
      .from(SESSIONS_TABLE)
      .insert({
        song_title: record.songTitle,
        created_at: record.createdAt,
        count: record.count,
        on_time_pct: record.onTimePct,
        avg_abs_ms: record.avgAbsMs,
        grade: record.grade,
        lines: record.lines,
      })
      .then(({ error }) => {
        if (error) console.warn('Could not sync session to database, saved locally only:', error);
      });
  }
}

// Aggregates per-line trouble across every saved session for a song, so
// "which part of the sheet music" answers across practice history, not
// just the most recent run. Only "off"/"miss" ratings count as a problem;
// ranked by how many sessions flagged it, ties broken by total severity.
function problemLinesForSong(title, topN = 5) {
  const RANK = { perfect: 0, good: 1, off: 2, miss: 3 };
  const byLine = new Map(); // line text -> { text, sessionsFlagged, weight }

  sessionHistorySnapshot()
    .filter((s) => s.songTitle === title)
    .forEach((s) => {
      (s.lines || []).forEach((l) => {
        if ((RANK[l.rating] || 0) < 2) return;
        const key = l.text || `line ${l.index}`;
        const entry = byLine.get(key) || { text: l.text, sessionsFlagged: 0, weight: 0 };
        entry.sessionsFlagged += 1;
        entry.weight += RANK[l.rating];
        byLine.set(key, entry);
      });
    });

  return [...byLine.values()].sort((a, b) => b.sessionsFlagged - a.sessionsFlagged || b.weight - a.weight).slice(0, topN);
}
