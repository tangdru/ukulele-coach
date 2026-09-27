// Verifies the Tuner view's layout: the display fills most of the view
// (not the toggle button, which used to stretch full-height because it
// reused .mode-btn's flex:1 sizing meant for a horizontal row of
// buttons), and nothing reflows when a reading actually appears -- a
// fresh note/cents value must not change the display or button's size.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const toneWav = path.join(os.tmpdir(), 'uke_layout_test_tone.wav');
execFileSync('node', ['gen_test_tone.mjs', '146.83', toneWav, '5']);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${toneWav}`,
  ],
});
const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:8934/index.html');
await page.click('#railTuner');
await page.waitForTimeout(150);

// The display should dominate the view -- the button is a small control,
// not another full-height panel like it used to render as.
const displayBoxBefore = await page.locator('.tuner-display').boundingBox();
const btnBox = await page.locator('#tunerToggleBtn').boundingBox();
console.log('display height:', displayBoxBefore.height, '| button height:', btnBox.height);
if (displayBoxBefore.height < btnBox.height * 5) {
  throw new Error(`Expected the tuner display to dominate the view, got display=${displayBoxBefore.height}px vs button=${btnBox.height}px`);
}
if (btnBox.height > 50) {
  throw new Error(`Expected the toggle button to be a normal small button, got height=${btnBox.height}px`);
}

await page.click('#tunerToggleBtn');
await page.waitForTimeout(300); // mic granted, debug line now visible, but no note detected yet
const displayBoxNoNote = await page.locator('.tuner-display').boundingBox();
const btnBoxNoNote = await page.locator('#tunerToggleBtn').boundingBox();

await page.waitForTimeout(1200); // now a note should be detected
const note = await page.textContent('#tunerNote');
const cents = await page.textContent('#tunerCents');
const displayBoxWithNote = await page.locator('.tuner-display').boundingBox();
const btnBoxWithNote = await page.locator('#tunerToggleBtn').boundingBox();

console.log('note:', note, cents);
console.log('display height before note:', displayBoxNoNote.height, '| after note:', displayBoxWithNote.height);
console.log('button height before note:', btnBoxNoNote.height, '| after note:', btnBoxWithNote.height);

if (note === '—' || !cents) throw new Error('Expected a note to actually be detected for this check to be meaningful');
if (Math.abs(displayBoxWithNote.height - displayBoxNoNote.height) > 1) {
  throw new Error(`Tuner display reflowed when a note appeared: ${displayBoxNoNote.height}px -> ${displayBoxWithNote.height}px`);
}
if (Math.abs(btnBoxWithNote.height - btnBoxNoNote.height) > 1 || Math.abs(btnBoxWithNote.y - btnBoxNoNote.y) > 1) {
  throw new Error(`Toggle button moved/resized when a note appeared: y=${btnBoxNoNote.y}/h=${btnBoxNoNote.height} -> y=${btnBoxWithNote.y}/h=${btnBoxWithNote.height}`);
}

if (errors.length) throw new Error('page errors: ' + errors.join('; '));
await browser.close();
console.log('OK: the tuner display dominates the view, the toggle button is a normal small control, and nothing reflows when a reading appears');
