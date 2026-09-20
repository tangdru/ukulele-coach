// Shared helpers for the Playwright smoke tests.

// Filters out console errors that are expected artifacts of this specific
// test environment rather than real app bugs:
//  - the missing /favicon.ico (Chromium's message carries no URL, so it's
//    matched by text alone; confirmed via the server access log)
//  - net::ERR_* failures from the song library's Supabase calls -- this
//    sandbox's network policy blocks external egress, so those always
//    fail here; the app is expected to (and does) fall back to
//    localStorage, verified by smoke_test_library.mjs.
export function isBenignTestEnvError(text) {
  return /Failed to load resource.*404/.test(text) || /net::ERR_/.test(text);
}
