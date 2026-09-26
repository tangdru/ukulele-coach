// Verifies History's per-song "Progress" block: a trend sparkline (one bar
// per recent Practice session, oldest to newest) and a per-line trouble
// heatmap (one cell per chart line, in chart order) -- replacing the old
// disconnected "Trouble spots" ranked list with something that lines up
// spatially with the sheet and shows whether timing is improving over time.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { isBenignTestEnvError } from './test_helpers.mjs';

// Sloppy timing so at least some hits land as off/miss and show up as
// non-clean heatmap cells.
const strumWav = path.join(os.tmpdir(), 'uke_progress_test_strums.wav');
execFileSync('node', ['gen_strum_wav.mjs', '10', '0.6', strumWav]);

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
await page.fill('#songSearch', 'Amazing Grace');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);

const lineCount = await page.locator('.song-line').count();
console.log('Amazing Grace line count:', lineCount);

await page.fill('#tempoInput', '90');

// Run Practice twice so the trend has two points.
for (let run = 0; run < 2; run++) {
  await page.click('#modeAnalyzeBtn');
  await page.waitForTimeout(6500);
  await page.click('#stopBtn');
  await page.waitForTimeout(150);
}

await page.click('#railHistory');
await page.waitForTimeout(300);

const progressBlockCount = await page.locator('.history-progress').count();
console.log('.history-progress blocks:', progressBlockCount);
if (progressBlockCount !== 1) throw new Error('Expected exactly one Progress block for the current song');

const barCount = await page.locator('.trend-bar').count();
console.log('trend bars:', barCount);
if (barCount !== 2) throw new Error(`Expected 2 trend bars (one per Practice run), found ${barCount}`);

const barHeights = await page.locator('.trend-bar').evaluateAll((els) => els.map((el) => el.style.height));
console.log('trend bar heights:', barHeights);
if (barHeights.some((h) => !/^\d+(\.\d+)?%$/.test(h))) throw new Error('Expected every trend bar to have a percentage height');

const heatCellCount = await page.locator('.heatmap-strip .heat-cell').count();
console.log('heatmap cells:', heatCellCount, '| chart lines:', lineCount);
if (heatCellCount !== lineCount) throw new Error(`Expected one heatmap cell per chart line (${lineCount}), found ${heatCellCount}`);

const nonUnpracticed = await page.locator('.heatmap-strip .heat-cell:not(.heat-unpracticed)').count();
console.log('heatmap cells actually practiced:', nonUnpracticed);
if (nonUnpracticed === 0) throw new Error('Expected at least one heatmap cell to reflect a practiced line');

const legendSwatches = await page.locator('.heatmap-legend .heat-cell').count();
console.log('legend swatches:', legendSwatches);
if (legendSwatches !== 5) throw new Error(`Expected 5 legend swatches (clean/low/medium/high/unpracticed), found ${legendSwatches}`);

// A song with no saved sessions yet should show no Progress block at all.
await page.click('#railUpload');
await page.fill('#songSearch', 'You Are My Sunshine');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.click('#railHistory');
await page.waitForTimeout(300);
const progressForFreshSong = await page.locator('.history-progress').count();
console.log('.history-progress blocks for a song with no sessions:', progressForFreshSong);
if (progressForFreshSong !== 0) throw new Error('Expected no Progress block for a song with no saved Practice sessions');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));
await browser.close();
console.log('OK: History shows a trend sparkline and a chart-aligned trouble heatmap for a practiced song, and neither for an unpracticed one');
