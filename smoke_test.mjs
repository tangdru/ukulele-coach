import { chromium } from 'playwright-core';
import { isBenignTestEnvError } from './test_helpers.mjs';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignTestEnvError(msg.text())) errors.push('console.error: ' + msg.text());
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.waitForSelector('#songTitle');

// Load a demo song via the searchable song selector
await page.click('#railUpload');
await page.fill('#songSearch', 'Amazing Grace');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const title = await page.textContent('#songTitle');
const key = await page.textContent('#keyDisplay');
const lineCount = await page.locator('.song-line').count();
console.log('title:', title, '| key:', key, '| lines:', lineCount);
if (title !== 'Amazing Grace') throw new Error('title mismatch');
if (lineCount < 4) throw new Error('expected rendered lines');

const panelClosedAfterLoad = await page.locator('#uploadPanel').evaluate((el) => el.classList.contains('hidden'));
console.log('upload panel auto-closed after load:', panelClosedAfterLoad);
if (!panelClosedAfterLoad) throw new Error('upload panel should auto-close after loading a song');

// Click a chord to open the diagram modal
await page.locator('.chord-sym').first().click();
await page.waitForTimeout(100);
const modalVisible = await page.locator('#chordModal').isVisible();
const diagramSvg = await page.locator('.chord-diagram-svg').count();
console.log('modal visible:', modalVisible, '| svg rendered:', diagramSvg);
if (!modalVisible || !diagramSvg) throw new Error('chord diagram did not render');
await page.locator('.chord-modal-backdrop').click({ position: { x: 5, y: 5 } });

// Metronome play & auto-scroll (no mic needed)
await page.click('#modeMetronomeBtn');
await page.waitForTimeout(600);
const activeLines = await page.locator('.song-line.active-line').count();
const metronomeActive = await page.locator('#modeMetronomeBtn').evaluate((el) => el.classList.contains('active'));
console.log('active lines after play:', activeLines, '| metronome button marked active:', metronomeActive);
if (activeLines !== 1) throw new Error('expected exactly one active line during scroll');
if (!metronomeActive) throw new Error('metronome mode button should show as active while running');
await page.click('#stopBtn');
const activeAfterStop = await page.locator('.mode-btn.active').count();
if (activeAfterStop !== 0) throw new Error('no mode button should be active after Stop');

// Rail navigation: Tuner view
await page.click('#railTuner');
await page.waitForTimeout(100);
const tunerVisible = await page.locator('#view-tuner').isVisible();
const playHiddenNow = await page.locator('#view-play').isHidden();
console.log('tuner view visible:', tunerVisible, '| play view hidden:', playHiddenNow);
if (!tunerVisible || !playHiddenNow) throw new Error('rail navigation to tuner did not work');

// Paste-your-own-chords path
await page.click('#railPlay');
await page.click('#railUpload');
await page.click('#togglePasteBtn');
await page.fill('#pasteText', '{title: Pasted Song}\n{key: Am}\n\n[Am]Testing [G]paste [F]flow\n');
await page.click('#loadPastedBtn');
await page.waitForTimeout(200);
const pastedTitle = await page.textContent('#songTitle');
console.log('pasted title:', pastedTitle);
if (pastedTitle !== 'Pasted Song') throw new Error('paste-load did not work');

// Loading it again should now be possible from the datalist-backed search,
// without re-pasting -- this is the song library persistence.
await page.click('#railUpload');
const datalistOptions = await page.locator('#songDatalist option').evaluateAll((opts) => opts.map((o) => o.value));
console.log('datalist options include pasted song:', datalistOptions.includes('Pasted Song'));
if (!datalistOptions.includes('Pasted Song')) throw new Error('pasted song should be saved to the library and listed');

await browser.close();

if (errors.length) {
  console.error('CONSOLE/PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK: no console/page errors, all smoke checks passed');
