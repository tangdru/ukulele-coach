// Verifies iReal Pro import: pasting an iReal Pro link converts it to
// ChordPro (shown for review, never loaded straight in -- same rule as
// PDF/Word import), the converted chart actually loads with real,
// fingering-diagram-able chords, and the same conversion also works when
// the link arrives as an uploaded file (iReal Pro typically shares as a
// .html/.txt file wrapping the link).
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { isBenignTestEnvError } from './test_helpers.mjs';

const IREAL_LINK =
  "irealbook://A Walkin Thing=Carter Benny=Medium Swing=D-=n={*AT44D- D-/C |Bh7, Bb7(A7b9) |D-/A G-7 |D-/F sEh,A7,|Y|lD- D-/C |Bh7, Bb7(A7b9) |D-/A G-7 |N1D-/F sEh,A7} Y|N2sD-,G-,lD- ][*BC-7 F7 |Bb^7 |C-7 F7 |Bb^7 n ||C-7 F7 |Bb^7 |B-7 E7 |A7,p,p,p,][*AD- D-/C |Bh7, Bb7(A7b9) |D-/A G-7 |D-/F sEh,A7,||lD- D-/C |Bh7, Bb7(A7b9) |D-/A G-7 |D-/F sEh,A7Z";

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

// Paste the raw iReal Pro link and click Load -- should convert and land
// back in the paste box for review, NOT load immediately.
await page.fill('#pasteText', IREAL_LINK);
await page.click('#loadPastedBtn');
await page.waitForTimeout(150);

const songTitleAfterPaste = await page.textContent('#songTitle');
console.log('song title right after pasting the link (should still be unloaded):', songTitleAfterPaste);
if (songTitleAfterPaste !== 'No song loaded') throw new Error('iReal Pro paste should convert for review, not load immediately');

const converted = await page.inputValue('#pasteText');
console.log('--- converted ChordPro (first 200 chars) ---');
console.log(converted.slice(0, 200));
if (!converted.includes('{title: A Walkin Thing}')) throw new Error('Converted text missing expected title directive');
if (!/\[Bm7b5\]/.test(converted)) throw new Error('Converted text missing expected half-diminished chord (Bh7 -> Bm7b5)');
if (!/\[Dm\/C\]/.test(converted)) throw new Error('Converted text missing expected slash chord');

const statusText = await page.textContent('#importStatus');
console.log('import status:', statusText);
if (!/review before Load/.test(statusText)) throw new Error('Expected a review-before-load status message');

// Now actually load the converted chart.
await page.click('#loadPastedBtn');
await page.waitForTimeout(200);
const title = await page.textContent('#songTitle');
console.log('title after loading converted chart:', title);
if (title !== 'A Walkin Thing') throw new Error(`Expected "A Walkin Thing" to load, got "${title}"`);

const chordCount = await page.locator('.chord-sym').count();
console.log('rendered chord symbols:', chordCount);
if (chordCount < 30) throw new Error(`Expected a substantial number of rendered chords, got ${chordCount}`);

// Tap a chord and confirm a real fingering diagram renders (not the
// "couldn't work out a fingering" fallback), same check smoke_test.mjs
// uses for ChordPro-sourced charts.
await page.locator('.chord-sym').first().click();
await page.waitForTimeout(100);
const modalVisible = await page.locator('#chordModal').isVisible();
const svgCount = await page.locator('.chord-diagram-svg').count();
console.log('chord modal visible:', modalVisible, '| diagram svg rendered:', svgCount);
if (!modalVisible || svgCount !== 1) throw new Error('Expected a real chord fingering diagram for an iReal-sourced chord');
await page.click('.chord-modal-backdrop', { position: { x: 5, y: 5 } });
await page.waitForTimeout(100);

// Same conversion via an uploaded file (iReal Pro's own "Share" typically
// exports as a .html/.txt file wrapping the link).
await page.click('#railUpload');
const tmpFile = path.join(os.tmpdir(), 'ireal_test_link.txt');
fs.writeFileSync(tmpFile, IREAL_LINK, 'utf8');
await page.setInputFiles('#chordproFile', tmpFile);
await page.waitForTimeout(300);
const pasteAreaVisible = await page.locator('#pasteArea').isVisible();
const convertedFromFile = await page.inputValue('#pasteText');
console.log('paste area visible after file upload:', pasteAreaVisible, '| converted from file has title:', convertedFromFile.includes('{title: A Walkin Thing}'));
if (!pasteAreaVisible || !convertedFromFile.includes('{title: A Walkin Thing}')) {
  throw new Error('iReal Pro link uploaded as a file did not convert correctly');
}
fs.unlinkSync(tmpFile);

// A garbage "iReal-looking" string (has the scheme but no real chords)
// should fail cleanly with an error, not crash the page.
await page.fill('#pasteText', 'irealbook://Nothing Here=Nobody=Ballad=C=n=');
await page.click('#loadPastedBtn');
await page.waitForTimeout(200);
const appErrorVisible = await page.locator('#appError').isVisible();
console.log('clean error shown for an unparseable iReal link:', appErrorVisible);
if (!appErrorVisible) throw new Error('Expected a clean error for an iReal link with no recognizable chords');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));

await browser.close();
console.log('OK: iReal Pro links (pasted or uploaded) convert to a real, loadable, fingering-diagram-able chart');
