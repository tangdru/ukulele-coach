// Verifies the tuner's actual pitch-detection behavior using real
// synthesized audio through Chromium's fake-audio-capture device -- not
// just that the UI wires up, but that it correctly identifies a clean
// tone and that the displayed cents value stays reasonably smooth
// frame-to-frame (regression coverage for the "jumpy dial" fix: cents
// are eased toward each new reading rather than snapping to it).
//
// Earlier versions of this test also asserted the tuner stays blank
// against white noise. That relied on a stricter clarity/frequency-range
// gate and a note-confirmation streak that, on a real device, turned out
// to reject real playing too (see the "revert to previous, just fix the
// jumpiness" follow-up) -- so noise-rejection isn't a guarantee this
// version makes, and isn't asserted here.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const toneWav = path.join(os.tmpdir(), 'uke_tuner_test_d3.wav');
execFileSync('node', ['gen_test_tone.mjs', '146.83', toneWav, '4']);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${toneWav}`,
  ],
});
const context = await browser.newContext({ permissions: ['microphone'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:8934/index.html');
await page.click('#railTuner');
await page.click('#tunerToggleBtn');

const readings = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(300);
  const note = await page.textContent('#tunerNote');
  const centsText = await page.textContent('#tunerCents');
  const cents = centsText ? parseInt(centsText, 10) : null;
  readings.push({ note, cents });
}
await browser.close();

console.log('Readings:', readings.map((r) => `${r.note}(${r.cents ?? '—'})`).join(' '));
if (errors.length) throw new Error('page errors: ' + errors.join('; '));

const distinctNotes = new Set(readings.map((r) => r.note).filter((n) => n !== '—'));
if (distinctNotes.size !== 1 || !distinctNotes.has('D3')) {
  throw new Error(`Expected a stable, exclusive "D3" reading, got: ${[...distinctNotes]}`);
}

const centsValues = readings.map((r) => r.cents).filter((c) => c !== null);
const maxJump = Math.max(...centsValues.slice(1).map((c, i) => Math.abs(c - centsValues[i])));
console.log('Largest frame-to-frame cents jump:', maxJump);
if (maxJump > 15) throw new Error(`Cents display looks jumpy: a ${maxJump}-cent jump between consecutive readings`);

console.log('OK: tuner stably identifies a real tone with a smooth (non-jumpy) cents reading');
