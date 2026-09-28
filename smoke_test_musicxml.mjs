// Verifies real staff-notation import: a MusicXML (.musicxml, plain XML)
// or compressed (.mxl, a zip) file renders actual sheet music via
// OpenSheetMusicDisplay, instead of being run through the lossy
// chord-chart reconstruction PDF/Word import uses -- there's no melody
// data in a ChordPro chord chart to reconstruct notation *from*, so this
// is a genuinely different kind of "song". Also checks that it's still a
// first-class citizen of the song library (browsable, loadable by title,
// persists, badged "Notation" in the list so it's distinguishable from an
// ordinary "Chords" chart at a glance), that switching back to an
// ordinary chord chart restores the normal chart/play-modes UI, and that
// the practice-mode controls are hidden (not wired up to staff notation)
// while one is showing.
import { chromium } from 'playwright-core';
import path from 'node:path';
import { isBenignTestEnvError } from './test_helpers.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignTestEnvError(msg.text())) errors.push('console.error: ' + msg.text());
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.waitForSelector('#songTitle');

// --- Uncompressed .musicxml: title comes from <work-title>, real notation renders ---
await page.click('#railUpload');
await page.setInputFiles('#chordproFile', path.resolve('sample_sheet.musicxml'));
await page.waitForTimeout(500);
let title = await page.textContent('#songTitle');
console.log('musicxml title:', title);
if (title !== 'Test Sheet Song') throw new Error(`Expected title from <work-title>, got "${title}"`);
if (await page.locator('#staffView').isHidden()) throw new Error('Staff view should be visible for a notated song');
if (!(await page.locator('#songView').isHidden())) throw new Error('The chord-chart view should be hidden for a notated song');
if (!(await page.locator('#playModesRow').isHidden())) throw new Error('Practice modes should be hidden for a notated song (not wired up to staff notation)');
if (await page.locator('#notatedNote').isHidden()) throw new Error('The read-only notated-song note should be showing');
const svgCount = await page.locator('#staffView svg').count();
console.log('rendered staff SVGs:', svgCount);
if (svgCount < 1) throw new Error('Expected OpenSheetMusicDisplay to render at least one SVG');

// --- Compressed .mxl: title falls back to the filename (no <work-title> extracted from inside the zip) ---
await page.click('#railUpload');
await page.setInputFiles('#chordproFile', path.resolve('sample_sheet.mxl'));
await page.waitForTimeout(500);
title = await page.textContent('#songTitle');
console.log('mxl title:', title);
if (title !== 'sample sheet') throw new Error(`Expected the filename-derived title, got "${title}"`);
if (await page.locator('#staffView svg').count() < 1) throw new Error('Expected the compressed .mxl to also render real notation');

// --- Both are first-class library entries: browsable, and loadable by title from the list ---
await page.click('#railUpload');
let listed = await page.locator('#songList .song-list-item').evaluateAll((els) => els.map((el) => el.dataset.title));
console.log('song list:', listed);
if (!listed.includes('Test Sheet Song') || !listed.includes('sample sheet')) {
  throw new Error('Both notated songs should be saved to the library and listed like any other song');
}

// --- The list badges each song by type, so it's obvious at a glance
// which ones are real notation (read-only) vs. an ordinary chord chart. ---
const badges = await page.locator('#songList .song-list-item').evaluateAll((els) =>
  Object.fromEntries(els.map((el) => [el.dataset.title, el.querySelector('.song-list-item-type')?.textContent]))
);
console.log('badges:', badges);
if (badges['Test Sheet Song'] !== 'Notation' || badges['sample sheet'] !== 'Notation') {
  throw new Error(`Expected both notated songs badged "Notation", got ${JSON.stringify(badges)}`);
}
if (badges['Amazing Grace'] !== 'Chords') {
  throw new Error(`Expected an ordinary chord chart badged "Chords", got "${badges['Amazing Grace']}"`);
}
const notationBadgeIsAccented = await page
  .locator('#songList .song-list-item', { hasText: 'Test Sheet Song' })
  .locator('.song-list-item-type')
  .evaluate((el) => el.classList.contains('song-list-item-type-notation'));
if (!notationBadgeIsAccented) throw new Error('The "Notation" badge should be visually distinct (accent color), not styled like "Chords"');

await page.locator('#songList .song-list-item', { hasText: 'Test Sheet Song' }).click();
await page.waitForTimeout(300);
title = await page.textContent('#songTitle');
if (title !== 'Test Sheet Song') throw new Error('Should be able to reload a notated song by picking it from the list');
if (await page.locator('#staffView').isHidden()) throw new Error('Reloading a notated song from the list should show staff notation again');

// --- Switching back to an ordinary chord chart restores the normal UI ---
await page.click('#railUpload');
await page.locator('#songList .song-list-item', { hasText: 'Amazing Grace' }).click();
await page.waitForTimeout(300);
title = await page.textContent('#songTitle');
if (title !== 'Amazing Grace') throw new Error(`Expected "Amazing Grace" loaded, got "${title}"`);
if (!(await page.locator('#staffView').isHidden())) throw new Error('Staff view should hide again for an ordinary chord chart');
if (await page.locator('#songView').isHidden()) throw new Error('The chord chart should be visible again');
if (await page.locator('#playModesRow').isHidden()) throw new Error('Practice modes should be visible again for an ordinary chord chart');
if (!(await page.locator('#notatedNote').isHidden())) throw new Error('The notated-song note should hide again');
const lineCount = await page.locator('.song-line').count();
if (lineCount < 4) throw new Error('Expected the chord chart to actually re-render');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));
await browser.close();
console.log('OK: MusicXML/.mxl import renders real staff notation, stays part of the browsable song library badged "Notation" (vs. "Chords" for an ordinary chart), and switching back to a chord chart restores the normal practice UI');
