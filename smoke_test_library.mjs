// Verifies the song library actually persists across a real page reload
// (localStorage), not just within the same in-memory page session --
// pasting/uploading a song should mean never needing to paste/upload it
// again on a later visit.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !/Failed to load resource.*404/.test(msg.text())) {
    errors.push('console.error: ' + msg.text());
  }
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.click('#railUpload');
await page.click('#togglePasteBtn');
await page.fill('#pasteText', '{title: Persisted Song}\n{key: C}\n\n[C]Testing [G]persistence\n');
await page.click('#loadPastedBtn');
await page.waitForTimeout(200);

// A full reload -- a fresh page load, not just re-navigating within the
// already-running page -- is the real test of persistence.
await page.reload();
await page.waitForSelector('#songTitle');
await page.click('#railUpload');
const options = await page.locator('#songDatalist option').evaluateAll((opts) => opts.map((o) => o.value));
console.log('datalist after reload:', options);
if (!options.includes('Persisted Song')) throw new Error('Saved song did not survive a page reload');

await page.fill('#songSearch', 'Persisted Song');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const title = await page.textContent('#songTitle');
console.log('reloaded and reselected title:', title);
if (title !== 'Persisted Song') throw new Error('Could not reload the persisted song by name after a fresh page load');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));

await browser.close();
console.log('OK: song library persists across a real page reload');
