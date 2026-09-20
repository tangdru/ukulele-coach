// Verifies the song library actually persists across a real page reload,
// not just within the same in-memory page session -- pasting/uploading a
// song should mean never needing to paste/upload it again on a later
// visit. In this sandboxed test environment, Supabase (if config.js is
// pointed at a real project) is unreachable -- external network egress is
// blocked here -- so this specifically exercises and confirms the
// localStorage fallback path; against a reachable Supabase project the
// same assertions confirm the shared-database path instead, since both
// go through the identical ensureSongLibraryLoaded()/saveSongToLibrary()
// code path in js/songlibrary.js.
import { chromium } from 'playwright-core';
import { isBenignTestEnvError } from './test_helpers.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignTestEnvError(msg.text())) {
    errors.push('console.error: ' + msg.text());
  }
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.click('#railUpload');
await page.click('#togglePasteBtn');
await page.fill('#pasteText', '{title: Persisted Song}\n{key: C}\n\n[C]Testing [G]persistence\n');
await page.click('#loadPastedBtn');
await page.waitForTimeout(200);

// A full reload -- a fresh page load, not just re-navigating within the
// already-running page -- is the real test of persistence.
await page.reload();
await page.waitForSelector('#songTitle');
await page.click('#railUpload');

// The library load has an internal 4s timeout before falling back to
// localStorage (see songlibrary.js), so poll for the option to appear
// rather than guessing a fixed wait.
await page.waitForFunction(
  () => [...document.querySelectorAll('#songDatalist option')].some((o) => o.value === 'Persisted Song'),
  { timeout: 8000 }
);
const options = await page.locator('#songDatalist option').evaluateAll((opts) => opts.map((o) => o.value));
console.log('datalist after reload:', options);

await page.fill('#songSearch', 'Persisted Song');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const title = await page.textContent('#songTitle');
console.log('reloaded and reselected title:', title);
if (title !== 'Persisted Song') throw new Error('Could not reload the persisted song by name after a fresh page load');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));

await browser.close();
console.log('OK: song library persists across a real page reload');
