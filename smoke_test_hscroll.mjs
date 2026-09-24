// Verifies auto-scroll also follows the playhead chord horizontally, not
// just the line vertically: on a line too wide for the viewport, #songView
// should scroll right as the playhead advances past what's currently
// visible, and should NOT do that when Auto-scroll is unchecked.
import { chromium } from 'playwright-core';

// One line, 8 beats, 8 different chords spread across it -- wide enough
// that later chords start off past a narrow viewport's right edge.
const WIDE_CHORDPRO = `{title: Wide Line Test}
{key: C}
{tempo: 200}
{time: 8/4}

[C]One [D]two [Em]three [F]four [G]five [Am]six [Bdim]seven [C]eight of some long lyric line that keeps going well past a narrow phone screen`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 380, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:8934/index.html');
await page.click('#railUpload');
await page.click('#togglePasteBtn');
await page.fill('#pasteText', WIDE_CHORDPRO);
await page.click('#loadPastedBtn');
await page.waitForTimeout(200);

const scrollLeft = () => page.evaluate(() => document.getElementById('songView').scrollLeft);

// --- Auto-scroll ON (default checked) ---
await page.click('#modeMetronomeBtn');
await page.waitForTimeout(150);
const startLeft = await scrollLeft();
console.log('scrollLeft right after starting Metronome:', startLeft);

await page.waitForTimeout(2200); // ~7-8 beats at 200bpm -- playhead should reach the later, off-screen chords
const laterLeft = await scrollLeft();
console.log('scrollLeft after waiting for the playhead to reach later chords:', laterLeft);
if (laterLeft <= startLeft) {
  throw new Error('Expected #songView to scroll right as the playhead moved past the initially-visible chords');
}

await page.click('#stopBtn');
await page.waitForTimeout(150);

// --- Auto-scroll OFF: horizontal scroll should not happen either ---
await page.evaluate(() => { document.getElementById('songView').scrollLeft = 0; });
await page.click('#autoScrollToggle'); // uncheck
await page.click('#modeMetronomeBtn');
await page.waitForTimeout(150);
const offStartLeft = await scrollLeft();
await page.waitForTimeout(2200);
const offLaterLeft = await scrollLeft();
console.log('scrollLeft with Auto-scroll unchecked: start', offStartLeft, '-> after wait', offLaterLeft);
if (offLaterLeft !== offStartLeft) {
  throw new Error('#songView should not auto-scroll horizontally while Auto-scroll is unchecked');
}

await page.click('#stopBtn');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));

await browser.close();
console.log('OK: auto-scroll follows the playhead chord horizontally when enabled, and does not scroll at all when disabled');
