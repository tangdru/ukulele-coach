// Verifies Follow My Playing actually tracks the player instead of
// running a clock: sets a very slow tempo (which a timer-based scroll
// would crawl through), then feeds 12 synthesized "strum" bursts (0.8s
// apart -- much faster than the slow tempo) through Chromium's fake
// audio device and checks the chart advances by strum count, landing on
// line index 3 (12 strums / 4 beats-per-line) well before a timer at the
// slow tempo could have gotten anywhere close.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const strumWav = path.join(os.tmpdir(), 'uke_follow_test_strums.wav');
execFileSync('node', ['gen_strum_wav.mjs', '12', '0.8', strumWav]);

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
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:8934/index.html');
await page.selectOption('#demoSongSelect', 'Amazing Grace'); // 3/4 time, 8 lines
await page.waitForTimeout(200);

// A deliberately slow tempo: if Follow mode were secretly still just a
// clock, waiting this long wouldn't get anywhere near line 3.
await page.fill('#tempoInput', '20');

await page.click('#followBtn');
await page.waitForTimeout(300);
const btnTextAfterStart = await page.textContent('#followBtn');
console.log('button after start:', btnTextAfterStart);
if (!btnTextAfterStart.includes('Stop Following')) throw new Error('Follow mode did not start');

const line0Active = await page.locator('.song-line').nth(0).evaluate((el) => el.classList.contains('active-line'));
console.log('line 0 active at start:', line0Active);
if (!line0Active) throw new Error('Expected line 0 to be active immediately on starting Follow mode');

// Wait for all 12 strums to play out (12 * 0.8s + margin).
await page.waitForTimeout(11000);

const activeIndex = await page.evaluate(() => {
  const lines = [...document.querySelectorAll('.song-line')];
  return lines.findIndex((el) => el.classList.contains('active-line'));
});
console.log('active line index after 12 strums (3/4 time -> 3 beats/line):', activeIndex);

if (errors.length) throw new Error('page errors: ' + errors.join('; '));
// 12 strums / 3 beats-per-line (Amazing Grace is 3/4) = should land on
// line index 4 (0-indexed: lines 0,1,2,3 each consumed 3 strums).
if (activeIndex !== 4) {
  throw new Error(`Expected Follow mode to advance to line index 4 after 12 strums in 3/4 time, got ${activeIndex}`);
}

await page.click('#stopBtn');
await page.waitForTimeout(150);
const stillActive = await page.evaluate(() => document.querySelectorAll('.song-line.active-line').length);
if (stillActive !== 0) throw new Error('Stop button did not clear Follow mode highlighting');

await browser.close();
console.log('OK: Follow My Playing advances by counting real strums, not a fixed-tempo clock');
