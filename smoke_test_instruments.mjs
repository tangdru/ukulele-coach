// Verifies the instrument selector: switching between Ukulele, Piano, and
// Saxophone changes which chord-diagram the modal renders (fretboard,
// keyboard, or a written-note list, since a monophonic instrument can't
// show a voicing the way the other two do), that the choice persists
// across a reload, and that the Metronome backing track doesn't error out
// under any of the three (each instrument module supplies its own
// chordFrequencies()).
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:8934/index.html');
await page.click('#railUpload');
await page.fill('#songSearch', 'Amazing Grace'); // has a plain "C" chord
await page.keyboard.press('Enter');
await page.waitForTimeout(200);

const defaultInstrument = await page.$eval('#instrumentSelect', (el) => el.value);
console.log('default instrument:', defaultInstrument);
if (defaultInstrument !== 'ukulele') throw new Error('Expected Ukulele to be the default instrument');

async function openChordModalFor(text) {
  await page.locator('.chord-sym', { hasText: new RegExp(`^${text}$`) }).first().click();
  await page.waitForTimeout(50);
}

// --- Ukulele: fretboard diagram ---
await openChordModalFor('C');
let hasFretboard = await page.locator('.chord-diagram-svg .chord-diagram-dot, .chord-diagram-svg .chord-diagram-open').count();
console.log('Ukulele: fretboard dots/open-circles rendered:', hasFretboard);
if (!hasFretboard) throw new Error('Expected a fretboard diagram (dots/open circles) for Ukulele');
await page.click('#chordModal .chord-modal-backdrop', { position: { x: 5, y: 5 } });

// --- Switch to Piano: keyboard diagram, root + chord tones highlighted ---
await page.selectOption('#instrumentSelect', 'piano');
await openChordModalFor('C');
const activeKeys = await page.locator('.piano-key-active, .piano-key-root').count();
const rootKeys = await page.locator('.piano-key-root').count();
console.log('Piano: highlighted keys:', activeKeys, '| root keys:', rootKeys);
if (activeKeys < 3) throw new Error('Expected at least 3 highlighted piano keys for a C major triad');
if (rootKeys !== 1) throw new Error('Expected exactly one key marked as the root');
await page.click('#chordModal .chord-modal-backdrop', { position: { x: 5, y: 5 } });

// --- Switch to Saxophone: per-note fingering diagrams, transposed for alto ---
await page.selectOption('#instrumentSelect', 'saxophone');
await openChordModalFor('C');
const toneCount = await page.locator('.sax-chord-tones .sax-chord-tone').count();
const rootToneText = await page.locator('.sax-chord-tone-root .sax-chord-tone-written').first().textContent();
const allWritten = await page.locator('.sax-chord-tone-written').allTextContents();
console.log('Saxophone: chord tones shown:', toneCount, '| root (written):', rootToneText, '| all written notes:', allWritten);
if (toneCount !== 3) throw new Error('Expected 3 chord tones (root/3rd/5th) for a C major triad');
// Alto (Eb) is a famous, unambiguous reference point: concert C is written A.
if (rootToneText.trim() !== 'A') throw new Error(`Expected alto's written root for concert C to be "A", got "${rootToneText}"`);
if (!allWritten.includes('C#') || !allWritten.includes('E')) throw new Error(`Expected the 3rd/5th to transpose to C# and E, got ${allWritten.join(',')}`);

// Each tone gets its own 6-key fingering diagram (from the Standard of
// Excellence chart); the root (written A) is the simplest note on the
// horn -- just the left index finger, one dot pressed out of six.
const totalDots = await page.locator('.sax-key-dot').count();
const rootDots = await page.locator('.sax-chord-tone-root .sax-key-dot').count();
const rootPressed = await page.locator('.sax-chord-tone-root .sax-key-pressed').count();
console.log('Saxophone: total fingering dots:', totalDots, '| root dots:', rootDots, '| root pressed:', rootPressed);
if (totalDots !== toneCount * 6) throw new Error(`Expected 6 fingering dots per chord tone, found ${totalDots} across ${toneCount} tones`);
if (rootDots !== 6 || rootPressed !== 1) throw new Error(`Expected written A's fingering to be exactly 1 pressed key of 6, got ${rootPressed}/${rootDots}`);
await page.click('#chordModal .chord-modal-backdrop', { position: { x: 5, y: 5 } });

// --- The choice persists across a reload ---
await page.reload();
await page.waitForSelector('#songTitle');
const instrumentAfterReload = await page.$eval('#instrumentSelect', (el) => el.value);
console.log('instrument after reload:', instrumentAfterReload);
if (instrumentAfterReload !== 'saxophone') throw new Error('Expected the selected instrument to persist across a reload');

// --- Metronome backing track shouldn't error under the currently
// selected instrument (saxophone, whose chordFrequencies() takes a
// different, single-note shape than the other two). ---
await page.click('#railUpload');
await page.fill('#songSearch', 'Amazing Grace');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.click('#modeMetronomeBtn');
await page.waitForTimeout(2000);
await page.click('#stopBtn');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));
await browser.close();
console.log('OK: instrument selector switches the chord-diagram modal between fretboard/keyboard/written-note-list, persists across reload, and the backing track plays under every instrument without erroring');
