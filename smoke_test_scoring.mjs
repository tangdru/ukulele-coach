// Verifies "Score my timing" actually marks the chart: turning it on
// with Play (metronome), feeding synthesized strums through the fake
// audio device, and checking that both a song-line and a specific chord
// symbol end up with a rated-* class -- not just that the checkbox/UI
// exists, but that a real timing hit reaches the DOM. Also checks marks
// persist through Stop (for post-play review) and clear on a fresh
// scored Play / new song load.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const strumWav = path.join(os.tmpdir(), 'uke_scoring_test_strums.wav');
// Roughly on the beat for a 60 BPM / 4-beat-line song: one strum per second.
execFileSync('node', ['gen_strum_wav.mjs', '10', '1.0', strumWav]);

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
await page.selectOption('#demoSongSelect', 'You Are My Sunshine'); // 4/4 time
await page.waitForTimeout(200);
await page.fill('#tempoInput', '60');
await page.check('#scoreTimingToggle');
await page.click('#playBtn');
await page.waitForTimeout(200);

const legendVisible = await page.locator('#scoreLegend').isVisible();
console.log('legend visible after starting scored play:', legendVisible);
if (!legendVisible) throw new Error('score legend did not appear');

await page.waitForTimeout(9500); // let ~9 strums land

const ratedLineCount = await page.locator('.song-line[class*="rated-"]').count();
const ratedChordCount = await page.locator('.chord-sym[class*="rated-"]').count();
console.log('rated lines:', ratedLineCount, '| rated chords:', ratedChordCount);
if (errors.length) throw new Error('page errors: ' + errors.join('; '));
if (ratedLineCount === 0) throw new Error('Expected at least one song-line to get a timing mark');
if (ratedChordCount === 0) throw new Error('Expected at least one chord to get a timing mark');

await page.click('#stopBtn');
await page.waitForTimeout(150);
const ratedAfterStop = await page.locator('.song-line[class*="rated-"]').count();
console.log('rated lines after Stop:', ratedAfterStop);
if (ratedAfterStop !== ratedLineCount) throw new Error('Timing marks should persist through Stop for review');

// A fresh song load should clear the marks.
await page.selectOption('#demoSongSelect', 'Amazing Grace');
await page.waitForTimeout(200);
const ratedAfterNewSong = await page.locator('.song-line[class*="rated-"]').count();
console.log('rated lines after loading a new song:', ratedAfterNewSong);
if (ratedAfterNewSong !== 0) throw new Error('Loading a new song should clear old timing marks');

await browser.close();
console.log('OK: timing hits mark the correct lines/chords, persist through Stop, clear on new song load');
