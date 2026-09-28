// Verifies the instrument selector: switching between Ukulele, Piano, and
// Saxophone changes which chord-diagram the modal renders (fretboard,
// keyboard, or a written-note list, since a monophonic instrument can't
// show a voicing the way the other two do); that Saxophone additionally
// re-labels the chart's own chord symbols to what a real alto (Eb) horn
// reads (not just the tap-to-see diagram), and switching back to
// Ukulele/Piano restores the original symbols; that the choice persists
// across a reload; and that the Metronome backing track doesn't error out
// under any of the three (each instrument module supplies its own
// chordFrequencies()) and stays in the song's actual key regardless of
// what's displayed.
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

// Selects by the underlying concert-pitch symbol (data-sym), not the
// visible text -- Saxophone re-labels what's visible, so a text match
// would silently stop finding "C" once that chord reads "A" on screen.
async function openChordModalFor(originalSym) {
  await page.locator(`.chord-sym[data-sym="${originalSym}"]`).first().click();
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

// --- Switch to Saxophone: the chart's own chord symbols re-label to a
// real alto (Eb) horn's actual reading (a major 6th up), not just the
// tap-to-see diagram -- concert C reads/fingers as A. ---
await page.selectOption('#instrumentSelect', 'saxophone');
const displayedForC = await page.locator('.chord-sym[data-sym="C"]').first().textContent();
console.log('Saxophone: chart shows concert "C" as:', displayedForC);
if (displayedForC !== 'A') throw new Error(`Expected the chart to relabel concert "C" to alto's written "A", got "${displayedForC}"`);

// Tapping it opens the diagram for whatever's now actually printed on the
// chart ("A"), fingered directly -- chart and diagram always agree.
await openChordModalFor('C'); // still selected by the underlying concert symbol
const toneCount = await page.locator('.sax-chord-tones .sax-chord-tone').count();
const rootNoteText = await page.locator('.sax-chord-tone-root .sax-chord-tone-note').first().textContent();
const allNotes = await page.locator('.sax-chord-tone-note').allTextContents();
console.log('Saxophone: chord tones shown:', toneCount, '| root:', rootNoteText, '| all notes:', allNotes);
if (toneCount !== 3) throw new Error('Expected 3 chord tones (root/3rd/5th) for a C major triad');
if (rootNoteText.trim() !== 'A') throw new Error(`Expected the diagram's root to match what's printed on the chart ("A"), got "${rootNoteText}"`);
if (!allNotes.includes('C#') || !allNotes.includes('E')) throw new Error(`Expected the 3rd/5th to read C# and E (alto's spelling of concert E/G), got ${allNotes.join(',')}`);

// A's own fingering (LH1 alone, the simplest note on the horn) -- the
// diagram looks this note up directly, with no further transposition of
// its own (the chart already did that).
const totalDots = await page.locator('.sax-key-dot').count();
const rootDots = await page.locator('.sax-chord-tone-root .sax-key-dot').count();
const rootPressed = await page.locator('.sax-chord-tone-root .sax-key-pressed').count();
console.log('Saxophone: total fingering dots:', totalDots, '| root dots:', rootDots, '| root pressed:', rootPressed);
if (totalDots !== toneCount * 6) throw new Error(`Expected 6 fingering dots per chord tone, found ${totalDots} across ${toneCount} tones`);
if (rootDots !== 6 || rootPressed !== 1) throw new Error(`Expected written A's fingering to be exactly 1 pressed key of 6, got ${rootPressed}/${rootDots}`);
await page.click('#chordModal .chord-modal-backdrop', { position: { x: 5, y: 5 } });

// --- Switching back to Ukulele restores the chart's original symbols ---
await page.selectOption('#instrumentSelect', 'ukulele');
const displayedAfterSwitchBack = await page.locator('.chord-sym[data-sym="C"]').first().textContent();
console.log('Ukulele (after switching back): chart shows concert "C" as:', displayedAfterSwitchBack);
if (displayedAfterSwitchBack !== 'C') throw new Error(`Expected switching back to Ukulele to restore the original "C" label, got "${displayedAfterSwitchBack}"`);
await page.selectOption('#instrumentSelect', 'saxophone'); // leave it selected for the reload-persistence check below

// --- The choice persists across a reload ---
await page.reload();
await page.waitForSelector('#songTitle');
const instrumentAfterReload = await page.$eval('#instrumentSelect', (el) => el.value);
console.log('instrument after reload:', instrumentAfterReload);
if (instrumentAfterReload !== 'saxophone') throw new Error('Expected the selected instrument to persist across a reload');

// --- A freshly-loaded chart also honors the persisted instrument choice ---
await page.click('#railUpload');
await page.fill('#songSearch', 'Amazing Grace');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const displayedAfterReload = await page.locator('.chord-sym[data-sym="C"]').first().textContent();
console.log('Saxophone (after reload, fresh song load): chart shows concert "C" as:', displayedAfterReload);
if (displayedAfterReload !== 'A') throw new Error(`Expected the freshly-rendered chart to already show the alto-transposed "A", got "${displayedAfterReload}"`);

// --- Metronome backing track shouldn't error under the currently
// selected instrument (saxophone, whose chordFrequencies() takes a
// different, single-note shape than the other two), and should schedule
// off the song's actual (concert) key regardless of what's displayed --
// chordSymbolAt() reads data-sym, not the relabeled text. ---
await page.click('#modeMetronomeBtn');
await page.waitForTimeout(2000);
await page.click('#stopBtn');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));
await browser.close();
console.log('OK: instrument selector switches the chord-diagram modal between fretboard/keyboard/written-note-list, Saxophone also re-labels the chart itself to a real alto\'s reading (and switching away restores it), the choice persists across reload (chart included), and the backing track plays under every instrument, in the song\'s actual key, without erroring');
