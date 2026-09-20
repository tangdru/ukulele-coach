// Verifies the tuner's actual pitch-detection behavior using real
// synthesized audio through Chromium's fake-audio-capture device --
// not just that the UI wires up, but that it correctly (a) stabilizes on
// a clean tone without flickering, and (b) stays blank against noise.
// Regression coverage for two real bugs this caught during development:
// browsers' default echoCancellation/noiseSuppression/autoGainControl
// silently decaying a sustained tone to near-silence, and a note-
// confirmation-streak bug that reset itself every frame and could never
// actually confirm a note.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const toneWav = path.join(os.tmpdir(), 'uke_tuner_test_d3.wav');
const noiseWav = path.join(os.tmpdir(), 'uke_tuner_test_noise.wav');
execFileSync('node', ['gen_test_tone.mjs', '146.83', toneWav, '4']);
writeNoiseWav(noiseWav, 3);

function writeNoiseWav(outPath, durationSec) {
  const sampleRate = 44100;
  const N = Math.floor(sampleRate * durationSec);
  const dataSize = N * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < N; i++) buf.writeInt16LE(Math.round((Math.random() - 0.5) * 20000), 44 + i * 2);
  fs.writeFileSync(outPath, buf);
}

async function runWithAudio(wavPath, readCount) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`,
    ],
  });
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://127.0.0.1:8934/index.html');
  await page.click('.tab-btn[data-tab="tuner"]');
  await page.click('#tunerToggleBtn');

  const readings = [];
  for (let i = 0; i < readCount; i++) {
    await page.waitForTimeout(300);
    readings.push(await page.textContent('#tunerNote'));
  }
  await browser.close();
  return { readings, errors };
}

const { readings: toneReadings, errors: toneErrors } = await runWithAudio(toneWav, 16);
console.log('D3 tone readings:', toneReadings.join(' '));
if (toneErrors.length) throw new Error('page errors during tone test: ' + toneErrors.join('; '));

const distinctTone = new Set(toneReadings.filter((n) => n !== '—'));
if (distinctTone.size !== 1 || !distinctTone.has('D3')) {
  throw new Error(`Expected a stable, exclusive "D3" reading, got: ${[...distinctTone]}`);
}
// First couple of frames are still accumulating the confirmation streak.
const blankCount = toneReadings.filter((n) => n === '—').length;
if (blankCount > 3) throw new Error(`Took too long to confirm the note: ${blankCount} blank readings`);

const { readings: noiseReadings, errors: noiseErrors } = await runWithAudio(noiseWav, 10);
console.log('White noise readings:', noiseReadings.join(' '));
if (noiseErrors.length) throw new Error('page errors during noise test: ' + noiseErrors.join('; '));
if (noiseReadings.some((n) => n !== '—')) {
  throw new Error(`Tuner should stay blank against white noise, got: ${[...new Set(noiseReadings)]}`);
}

console.log('OK: tuner stabilizes cleanly on a real tone and rejects white noise');
