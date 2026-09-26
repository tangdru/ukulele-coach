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

// The most recent `limit` Practice sessions for a song, oldest first, for
// plotting a "getting better over time" trend -- storage order is
// newest-first, so this both filters and reverses.
function trendForSong(title, limit = 10) {
  return sessionHistorySnapshot()
    .filter((s) => s.songTitle === title)
    .slice(0, limit)
    .reverse();
}

// Aggregates per-line trouble across every saved session for a song,
// indexed to match the currently loaded chart's line positions -- lets
// History render a heatmap strip that lines up with the sheet itself,
// rather than a ranked list disconnected from where the lines actually
// are. Only lines that were actually rated at least once (i.e. Analyze Me
// reached them) count as "seen"; a never-seen line is a gap in practice
// coverage, not a clean line.
function lineHeatForSong(title, lineCount) {
  const RANK = { perfect: 0, good: 1, off: 2, miss: 3 };
  const heat = Array.from({ length: lineCount }, () => ({ timesSeen: 0, timesProblem: 0 }));

  sessionHistorySnapshot()
    .filter((s) => s.songTitle === title)
    .forEach((s) => {
      (s.lines || []).forEach((l) => {
        if (l.index < 0 || l.index >= lineCount) return;
        const cell = heat[l.index];
        cell.timesSeen += 1;
        if ((RANK[l.rating] || 0) >= 2) cell.timesProblem += 1;
      });
    });

  return heat.map((c) => ({ ...c, ratio: c.timesSeen ? c.timesProblem / c.timesSeen : 0 }));
}
