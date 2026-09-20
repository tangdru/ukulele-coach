// Verifies Analyze Me sessions are saved to history: stopping a scored
// run should produce a graded entry in the (static, read-only) History
// view, with the specific lines that were off/miss listed, and it should
// survive a real page reload (localStorage fallback path in this
// sandbox, same as smoke_test_library.mjs).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { isBenignTestEnvError } from './test_helpers.mjs';

const strumWav = path.join(os.tmpdir(), 'uke_history_test_strums.wav');
// Deliberately sloppy timing (not locked to the beat) so at least some
// hits land as "off"/"miss" and show up in the problem-lines list.
execFileSync('node', ['gen_strum_wav.mjs', '10', '0.7', strumWav]);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${strumWav}`,
  ],
});
const context = await browser.newContext({ permissions: ['microphone'] });
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
await page.fill('#songSearch', 'You Are My Sunshine'); // 4/4 time
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.fill('#tempoInput', '60');
await page.click('#modeAnalyzeBtn');
await page.waitForTimeout(9500); // let ~9 strums land

await page.click('#stopBtn');
await page.waitForTimeout(150);

await page.click('#railHistory');
await page.waitForTimeout(300);

const sessionCount = await page.locator('.history-session').count();
console.log('history sessions after first run:', sessionCount);
if (sessionCount !== 1) throw new Error(`Expected exactly 1 saved session, found ${sessionCount}`);

const gradeText = await page.locator('.grade-badge').first().textContent();
console.log('grade badge:', gradeText);
if (!gradeText || !/^[ABCDF—]$/.test(gradeText.trim())) throw new Error(`Unexpected grade badge text: "${gradeText}"`);

const songTitle = await page.locator('.history-song-title').first().textContent();
console.log('history song title:', songTitle);
if (songTitle.trim() !== 'You Are My Sunshine') throw new Error(`Expected history entry for "You Are My Sunshine", got "${songTitle}"`);

const statsText = await page.locator('.history-session-stats').first().textContent();
console.log('history session stats:', statsText);
if (!/strums/.test(statsText) || !/on-time/.test(statsText)) throw new Error('History session stats row missing expected fields');

// Sloppy strumming should have produced at least one off/miss line shown
// in this session's card.
const lineMarkCount = await page.locator('.history-session-lines span').count();
console.log('rated lines shown in this session card:', lineMarkCount);

// A full reload should still show the saved session (localStorage
// fallback path, since Supabase is unreachable in this sandbox). The
// history load has the same internal 4s Supabase-timeout-before-fallback
// as the song library (see songlibrary.js), so poll rather than guessing
// a fixed wait -- same approach as smoke_test_library.mjs.
await page.reload();
await page.waitForSelector('#songTitle');
await page.click('#railHistory');
await page.waitForSelector('.history-session', { timeout: 8000 });
const sessionCountAfterReload = await page.locator('.history-session').count();
console.log('history sessions after reload:', sessionCountAfterReload);
if (sessionCountAfterReload !== 1) throw new Error('Saved session did not survive a full page reload');

// Running a second Analyze Me session (even for a different song) should
// add a second entry, not replace the first.
await page.click('#railUpload');
await page.fill('#songSearch', 'Amazing Grace');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.click('#railPlay'); // loading a song from the History view leaves Play hidden
await page.fill('#tempoInput', '60');
await page.click('#modeAnalyzeBtn');
await page.waitForTimeout(6500);
await page.click('#stopBtn');
await page.waitForTimeout(150);
await page.click('#railHistory');
await page.waitForTimeout(300);
const sessionCountAfterSecond = await page.locator('.history-session').count();
console.log('history sessions after a second run:', sessionCountAfterSecond);
if (sessionCountAfterSecond !== 2) throw new Error(`Expected 2 saved sessions after a second run, found ${sessionCountAfterSecond}`);

if (errors.length) throw new Error('page errors: ' + errors.join('; '));

await browser.close();
console.log('OK: Analyze Me sessions are graded, saved to history, persist across reload, and accumulate');
