// Verifies "Loop a section": tapping the Loop button then two chart lines
// sets a repeat range, and Metronome (clock-driven) and Follow Me
// (strum-driven) playback both wrap back to the start of that range once
// they pass its end -- including the edge case where the range's end is
// the chart's very last line, which is the exact bug caught and fixed
// before this test was written (idx can never exceed lineStartTimes'
// bounds, so the wrap has to be detected by time, not by idx > loopEnd).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

async function sampleActiveLine(page, times, intervalMs) {
  const seen = [];
  for (let i = 0; i < times; i++) {
    await page.waitForTimeout(intervalMs);
    const idx = await page.evaluate(() => document.querySelector('.song-line.active-line')?.dataset.index ?? null);
    seen.push(idx);
  }
  return seen;
}

// --- Part 1: picking a range, and Metronome-mode wrap at the last line ---
{
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://127.0.0.1:8934/index.html');
  await page.click('#railUpload');
  await page.fill('#songSearch', 'Amazing Grace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  const total = await page.locator('.song-line').count();
  const lastIdx = total - 1;
  const secondLastIdx = total - 2;
  console.log(`Amazing Grace has ${total} lines; looping the last two (${secondLastIdx}, ${lastIdx})`);

  // Tap Loop, then the two boundary lines.
  await page.click('#loopBtn');
  let label = await page.textContent('#loopBtnLabel');
  let statusHidden = await page.evaluate(() => document.getElementById('loopStatus').classList.contains('hidden'));
  console.log('After tapping Loop:', label, '| status hidden:', statusHidden);
  if (label !== 'Pick 1st…' || statusHidden) throw new Error('Expected "Pick 1st…" label and a visible status line after tapping Loop');

  await page.locator(`.song-line[data-index="${secondLastIdx}"]`).click();
  const pickingClass = await page.evaluate(
    (i) => document.querySelector(`.song-line[data-index="${i}"]`).classList.contains('loop-picking'),
    secondLastIdx
  );
  label = await page.textContent('#loopBtnLabel');
  console.log('After first pick:', label, '| loop-picking class present:', pickingClass);
  if (label !== 'Pick 2nd…' || !pickingClass) throw new Error('Expected "Pick 2nd…" label and a .loop-picking highlight on the first-tapped line');

  await page.locator(`.song-line[data-index="${lastIdx}"]`).click();
  label = await page.textContent('#loopBtnLabel');
  statusHidden = await page.evaluate(() => document.getElementById('loopStatus').classList.contains('hidden'));
  const rangeClasses = await page.evaluate(
    ([a, b]) => [a, b].map((i) => document.querySelector(`.song-line[data-index="${i}"]`).classList.contains('loop-range')),
    [secondLastIdx, lastIdx]
  );
  const stillPicking = await page.evaluate(
    (i) => document.querySelector(`.song-line[data-index="${i}"]`).classList.contains('loop-picking'),
    secondLastIdx
  );
  console.log('After second pick:', label, '| status hidden:', statusHidden, '| range highlighted:', rangeClasses, '| still picking:', stillPicking);
  if (label !== 'Loop: 2 lines') throw new Error('Expected the button label to read "Loop: 2 lines"');
  if (!statusHidden) throw new Error('Expected the status line to hide once the range is set');
  if (!rangeClasses[0] || !rangeClasses[1]) throw new Error('Expected both boundary lines to carry .loop-range');
  if (stillPicking) throw new Error('Expected .loop-picking to be cleared once the range is set');

  // Metronome mode with the loop covering the chart's very last line --
  // the exact case the time-based wrap check exists for.
  await page.fill('#tempoInput', '240'); // fast so several wraps happen quickly
  await page.click('#modeMetronomeBtn');
  const seen = await sampleActiveLine(page, 20, 200); // ~4s
  console.log('Metronome active-line samples while looping last two lines:', seen.join(','));
  const outOfRange = seen.filter((v) => v !== null && v !== String(secondLastIdx) && v !== String(lastIdx));
  if (outOfRange.length) throw new Error('Playback left the loop range: saw line(s) ' + outOfRange.join(','));
  const wrapped = seen.some((v, i) => i > 0 && seen[i - 1] === String(lastIdx) && v === String(secondLastIdx));
  if (!wrapped) throw new Error('Never saw playback wrap from the last line of the loop back to the first -- the last-line edge case is broken');
  await page.click('#stopBtn');
  await page.waitForTimeout(150);

  // Clearing the loop.
  await page.click('#loopBtn');
  label = await page.textContent('#loopBtnLabel');
  const anyRangeLeft = await page.evaluate(() => document.querySelectorAll('.song-line.loop-range').length);
  console.log('After clearing loop:', label, '| .loop-range elements left:', anyRangeLeft);
  if (label !== 'Loop') throw new Error('Expected the button label to reset to "Loop" after clearing');
  if (anyRangeLeft !== 0) throw new Error('Expected .loop-range to be removed from every line after clearing the loop');

  // Loop state must not survive a new song load.
  await page.click('#loopBtn');
  await page.locator(`.song-line[data-index="${secondLastIdx}"]`).click();
  await page.locator(`.song-line[data-index="${lastIdx}"]`).click();
  label = await page.textContent('#loopBtnLabel');
  console.log('Loop re-armed before reload:', label);
  if (label !== 'Loop: 2 lines') throw new Error('Expected the loop to be re-armed before testing reset-on-reload');

  await page.click('#railUpload');
  await page.fill('#songSearch', 'Amazing Grace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  label = await page.textContent('#loopBtnLabel');
  const rangeAfterReload = await page.evaluate(() => document.querySelectorAll('.song-line.loop-range').length);
  console.log('After reloading the song:', label, '| .loop-range elements:', rangeAfterReload);
  if (label !== 'Loop') throw new Error('Expected loading a song to clear any previously set loop range');
  if (rangeAfterReload !== 0) throw new Error('Expected no .loop-range elements after loading a fresh song');

  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  await browser.close();
}

// --- Part 2: Follow Me (strum-driven) wrap, also at the chart's last line ---
{
  const strumWav = path.join(os.tmpdir(), 'uke_loop_test_strums.wav');
  execFileSync('node', ['gen_strum_wav.mjs', '50', '0.3', strumWav]); // ~16s of strums, well past several wraps

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${strumWav}`,
    ],
  });
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://127.0.0.1:8934/index.html');
  await page.click('#railUpload');
  await page.fill('#songSearch', 'Amazing Grace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  const total = await page.locator('.song-line').count();
  const lastIdx = total - 1;
  const secondLastIdx = total - 2;

  await page.click('#loopBtn');
  await page.locator(`.song-line[data-index="${secondLastIdx}"]`).click();
  await page.locator(`.song-line[data-index="${lastIdx}"]`).click();
  const label = await page.textContent('#loopBtnLabel');
  console.log('Loop set for Follow Me test:', label);
  if (label !== 'Loop: 2 lines') throw new Error('Expected the loop range to be set before starting Follow Me');

  await page.click('#modeFollowBtn');
  const seen = await sampleActiveLine(page, 20, 700); // ~14s, several strums/line at 0.3s apart with 3 beats/line
  console.log('Follow Me active-line samples while looping last two lines:', seen.join(','));

  const followStatusHidden = await page.evaluate(() => document.getElementById('followStatus').classList.contains('hidden'));
  console.log('Follow status hidden at end (should still be false/active, not stopped):', followStatusHidden);
  if (followStatusHidden) throw new Error('Follow Me stopped -- it should have kept looping the range instead of running off the end of the chart');

  const outOfRange = seen.filter((v) => v !== null && v !== String(secondLastIdx) && v !== String(lastIdx));
  if (outOfRange.length) throw new Error('Follow Me left the loop range: saw line(s) ' + outOfRange.join(','));
  const wrapped = seen.some((v, i) => i > 0 && seen[i - 1] === String(lastIdx) && v === String(secondLastIdx));
  if (!wrapped) throw new Error('Follow Me never wrapped from the last line of the loop back to the first');

  await page.click('#stopBtn');
  await page.waitForTimeout(150);

  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  await browser.close();
}

console.log('OK: Loop range picking, highlighting, clearing, and reset-on-reload all work; Metronome and Follow Me both wrap correctly at the loop end, including when the loop end is the chart\'s very last line');
