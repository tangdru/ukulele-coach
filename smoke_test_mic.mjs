import { chromium } from 'playwright-core';
import { isBenignTestEnvError } from './test_helpers.mjs';

const errors = [];
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--allow-file-access-from-files',
  ],
});
const context = await browser.newContext({ permissions: ['microphone'] });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignTestEnvError(msg.text())) errors.push('console.error: ' + msg.text());
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.waitForSelector('#songTitle');

// Need a song loaded for Analyze Me (the mic-driven timing-scoring mode).
await page.click('#railUpload');
await page.fill('#songSearch', 'Amazing Grace');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);

// Tuner
await page.click('#railTuner');
await page.click('#tunerToggleBtn');
await page.waitForTimeout(1500);
const tunerBtnText = await page.textContent('#tunerToggleBtn');
console.log('tuner button after start:', tunerBtnText);
if (!tunerBtnText.includes('Stop')) throw new Error('tuner did not start');
await page.click('#tunerToggleBtn');

// Analyze Me (mic-driven timing scoring -- what used to be the separate
// Rhythm Coach tab, now folded into Play as an equal-weight mode)
await page.click('#railPlay');
await page.click('#modeAnalyzeBtn');
await page.waitForTimeout(2000);
const analyzeActive = await page.locator('#modeAnalyzeBtn').evaluate((el) => el.classList.contains('active'));
const statsVisible = await page.locator('#analyzeStats').isVisible();
console.log('analyze mode active:', analyzeActive, '| stats row visible:', statsVisible);
if (!analyzeActive) throw new Error('Analyze Me did not start');
if (!statsVisible) throw new Error('analyze stats row should be visible once Analyze Me starts');
await page.click('#stopBtn');

// Key detect (short-circuit by checking it starts without throwing; full 6s wait is slow)
await page.click('#detectKeyBtn');
await page.waitForTimeout(500);
const detectBtnText = await page.textContent('#detectKeyBtn');
console.log('detect key button mid-listen:', detectBtnText);
if (!/%$/.test(detectBtnText.trim())) throw new Error('key detect did not show listening progress');

await browser.close();

if (errors.length) {
  console.error('CONSOLE/PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK: mic-based features start/stop without errors');
