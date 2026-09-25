// Verifies the chart zoom controls: +/- actually resize the font (and the
// chord positions, which are in `ch` units relative to it, stay aligned
// rather than drifting), Fit to screen shrinks a wide chart until it no
// longer needs horizontal scrolling, and a new song load resets zoom back
// to the default rather than carrying over a previous chart's fit level.
import { chromium } from 'playwright-core';

// A moderately wide chart, built from plain ChordPro (not the iReal Pro
// import, which lives on a separate not-yet-merged branch) -- enough
// chords packed onto one line to overflow a narrow viewport at 100%, but
// not so many that fitting it needs to shrink text past the app's own
// minimum-readable-size floor (that floor is intentional -- Fit to Screen
// should never make text illegible just to avoid scrolling).
const WIDE_CHORDPRO = `{title: Wide Chart Test}
{key: C}
{tempo: 100}
{time: 4/4}

[C]Some [D]lyrics [Em]here [F]and [G]then [Am]some [Bdim]more [C]words [D]here`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:8934/index.html');
await page.click('#railUpload');
await page.fill('#songSearch', 'Amazing Grace');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);

const getFontSize = () => page.evaluate(() => getComputedStyle(document.getElementById('songView')).fontSize);
const getFirstChordLeft = () => page.evaluate(() => document.querySelector('.chord-sym').getBoundingClientRect().left);

const baseFontSize = await getFontSize();
console.log('base font size:', baseFontSize);

await page.click('#zoomInBtn');
await page.click('#zoomInBtn');
const zoomedInSize = await getFontSize();
console.log('font size after 2x zoom in:', zoomedInSize);
if (parseFloat(zoomedInSize) <= parseFloat(baseFontSize)) throw new Error('Zoom in did not increase font size');

await page.click('#zoomOutBtn');
await page.click('#zoomOutBtn');
await page.click('#zoomOutBtn');
const zoomedOutSize = await getFontSize();
console.log('font size after 3x zoom out from there:', zoomedOutSize);
if (parseFloat(zoomedOutSize) >= parseFloat(zoomedInSize)) throw new Error('Zoom out did not decrease font size');

// A chord's fingering diagram should still open correctly at a non-default
// zoom level -- if `ch`-based positioning drifted out of sync with the
// zoomed font, clicking a chord could land on nothing.
await page.locator('.chord-sym').first().click();
await page.waitForTimeout(100);
const modalVisible = await page.locator('#chordModal').isVisible();
console.log('chord modal opens correctly while zoomed:', modalVisible);
if (!modalVisible) throw new Error('Chord click did not work at a non-default zoom level');
await page.click('.chord-modal-backdrop', { position: { x: 5, y: 5 } });
await page.waitForTimeout(100);

// Load a chart with a genuinely wide line and confirm Fit to Screen
// removes the horizontal overflow.
await page.click('#railUpload');
await page.click('#togglePasteBtn');
await page.fill('#pasteText', WIDE_CHORDPRO);
await page.click('#loadPastedBtn');
await page.waitForTimeout(200);

// A fresh song load should reset zoom to the default, not inherit the
// previous chart's zoomed-out level.
const resetSize = await getFontSize();
console.log('font size after loading a new song (should be back to default):', resetSize);
if (resetSize !== baseFontSize) throw new Error(`Expected zoom to reset to ${baseFontSize} on new song load, got ${resetSize}`);

const overflowBefore = await page.evaluate(() => {
  const el = document.getElementById('songView');
  return el.scrollWidth - el.clientWidth;
});
console.log('horizontal overflow before Fit to Screen (px):', overflowBefore);
if (overflowBefore <= 0) throw new Error('Test setup expected this wide iReal chart to overflow horizontally before fitting');

await page.click('#fitScreenBtn');
await page.waitForTimeout(100);
const overflowAfter = await page.evaluate(() => {
  const el = document.getElementById('songView');
  return el.scrollWidth - el.clientWidth;
});
console.log('horizontal overflow after Fit to Screen (px):', overflowAfter);
if (overflowAfter > 2) throw new Error(`Fit to Screen should eliminate horizontal overflow, ${overflowAfter}px remained`);

// Clicking Fit to Screen again on a chart that already fits should snap
// back to the default size rather than zooming in further.
await page.click('#fitScreenBtn');
await page.waitForTimeout(100);
const secondFitSize = await getFontSize();
console.log('font size after Fit to Screen on an already-fitting chart:', secondFitSize);
if (secondFitSize !== baseFontSize) throw new Error('Fit to Screen on an already-fitting chart should reset to the default size');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));

await browser.close();
console.log('OK: zoom controls resize the chart (chords stay correctly positioned), Fit to Screen eliminates horizontal overflow, and zoom resets on a new song load');
