// Regression test for a real bug: the tuner worked perfectly against a
// loud synthesized test tone (smoke_test_tuner.mjs's ~0.35 RMS) but
// never detected anything on a real phone, where a raw (no auto-gain)
// mic signal from an actual acoustic instrument a few inches/feet away
// measured ~0.0012 RMS on the device -- both the silence gate (0.008)
// and the buffer-trim step's fixed absolute threshold (0.2, which at
// this signal level trims almost the entire buffer to nothing) were
// tuned against a signal roughly 300x louder than this. This test feeds
// a synthetic tone at that exact measured amplitude, so the class of bug
// ("only tested against a loud clean signal") can't silently return.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// Amplitude fraction ~0.0017 of full scale -> ~0.0012 RMS, matching the
// exact real-device reading reported while actively playing a note.
const toneWav = path.join(os.tmpdir(), 'uke_tuner_quiet_test.wav');
execFileSync('node', ['gen_test_tone.mjs', '146.83', toneWav, '6', '0.0017']);

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
  readings.push(note);
}
await browser.close();

console.log('Readings at ~0.0012 RMS (a real measured quiet-signal level):', readings.join(' '));
if (errors.length) throw new Error('page errors: ' + errors.join('; '));

const blanks = readings.filter((n) => n === '—').length;
if (blanks > 2) {
  throw new Error(`Tuner failed to detect a quiet-but-real signal: ${blanks}/${readings.length} blank readings at ~0.0012 RMS`);
}
if (!readings.includes('D3')) {
  throw new Error(`Expected at least some "D3" readings at this quiet level, got: ${[...new Set(readings)]}`);
}

console.log('OK: tuner detects a note even at a real measured quiet raw-mic signal level (~0.0012 RMS), not just a loud synthetic tone');
