// Verifies the Flat/Sharp indicator that flanks the tuner dial (replacing
// a "+N cents" text readout): a tone noticeably flat highlights only
// "Flat", and a tone noticeably sharp highlights only "Sharp" -- same
// ±5-cent "in tune" band the needle itself already uses. (Not tested
// here: a "dead-on-pitch" case showing neither active -- this synthetic
// test tone has a small, consistent ~8-cent bias in this harness, visible
// throughout the other tuner tests too, so there's no reliable exactly-
// neutral reference frequency to test that branch against.)
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// D3 = 146.83Hz. ~20 cents sharp/flat is clearly outside the ±5-cent
// in-tune band but still close enough to read as the same note.
const D3 = 146.83;
const SHARP_FREQ = (D3 * Math.pow(2, 20 / 1200)).toFixed(3);
const FLAT_FREQ = (D3 * Math.pow(2, -20 / 1200)).toFixed(3);

async function isActiveAfterTone(freq) {
  const toneWav = path.join(os.tmpdir(), `uke_flatsharp_${freq}.wav`);
  execFileSync('node', ['gen_test_tone.mjs', String(freq), toneWav, '4']);

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
  await page.waitForTimeout(2000);

  const note = await page.textContent('#tunerNote');
  const flatActive = await page.locator('#tunerFlat').evaluate((el) => el.classList.contains('active'));
  const sharpActive = await page.locator('#tunerSharp').evaluate((el) => el.classList.contains('active'));
  const needleInTune = await page.locator('#tunerNeedle').evaluate((el) => el.classList.contains('in-tune'));

  await browser.close();
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  return { note, flatActive, sharpActive, needleInTune };
}

const sharpResult = await isActiveAfterTone(SHARP_FREQ);
console.log(`~20 cents sharp (${SHARP_FREQ}Hz):`, sharpResult);
if (sharpResult.note !== 'D3') throw new Error(`Expected the sharp tone to still read as D3, got "${sharpResult.note}"`);
if (!sharpResult.sharpActive || sharpResult.flatActive) {
  throw new Error(`Expected only Sharp to be active for a sharp tone, got flat=${sharpResult.flatActive} sharp=${sharpResult.sharpActive}`);
}

const flatResult = await isActiveAfterTone(FLAT_FREQ);
console.log(`~20 cents flat (${FLAT_FREQ}Hz):`, flatResult);
if (flatResult.note !== 'D3') throw new Error(`Expected the flat tone to still read as D3, got "${flatResult.note}"`);
if (!flatResult.flatActive || flatResult.sharpActive) {
  throw new Error(`Expected only Flat to be active for a flat tone, got flat=${flatResult.flatActive} sharp=${flatResult.sharpActive}`);
}

console.log('OK: Flat/Sharp light up on the correct side for an off-pitch tone, never both at once');
