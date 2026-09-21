// Verifies the "current chord" playhead highlight: in Metronome/Analyze
// Me, the fixed clock advances it chord by chord within the active line;
// in Follow Me, it's driven by actual detected strums, never by silence
// alone -- directly targeting the reported bug ("Follow Me just plays
// through like Metronome, it doesn't listen and advance").
//
// Chord *text* repeats constantly in the demo songs ("G" appears many
// times), so movement is tracked by each chord-sym's stable position
// among every chord-sym on the page, not by its text.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const strumWav = path.join(os.tmpdir(), 'uke_playhead_test_strums.wav');
execFileSync('node', ['gen_strum_wav.mjs', '6', '1.0', strumWav]);
// One burst at t=0, then several seconds of true silence -- lets a test
// wait out a long silent stretch and confirm nothing advances on its own.
const mostlySilentWav = path.join(os.tmpdir(), 'uke_playhead_test_silence.wav');
execFileSync('node', ['gen_strum_wav.mjs', '1', '6.0', mostlySilentWav]);

async function currentChordGlobalIndex(page) {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.chord-sym'));
    return all.indexOf(document.querySelector('.chord-sym.current-chord'));
  });
}

async function runWithAudio(wavPath, testFn) {
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
  await testFn(page);
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  await browser.close();
}

// --- Metronome mode: playhead should move on the fixed clock alone ---
await runWithAudio(mostlySilentWav, async (page) => {
  await page.click('#railUpload');
  await page.fill('#songSearch', 'Amazing Grace'); // 3/4 time, 3 chords in the first line
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.fill('#tempoInput', '120');
  await page.click('#modeMetronomeBtn');
  await page.waitForTimeout(150);

  const startCount = await page.locator('.chord-sym.current-chord').count();
  const startIdx = await currentChordGlobalIndex(page);
  console.log('Metronome: current-chord count at start:', startCount, '| global index:', startIdx);
  if (startCount !== 1 || startIdx !== 0) throw new Error('Expected the playhead to start on the very first chord');

  // 3 beats/line at 120bpm = 1.5s/line -- 3.5s comfortably crosses into a
  // later line no matter which chord in line 1 it starts on.
  await page.waitForTimeout(3500);
  const laterCount = await page.locator('.chord-sym.current-chord').count();
  const laterIdx = await currentChordGlobalIndex(page);
  console.log('Metronome: current-chord count after 3.5s:', laterCount, '| global index:', laterIdx);
  if (laterCount !== 1) throw new Error('Expected the playhead to stay on exactly one chord at a time');
  if (laterIdx <= startIdx) throw new Error('Expected the Metronome-mode playhead to advance forward on the fixed clock');

  await page.click('#stopBtn');
  await page.waitForTimeout(150);
  const afterStopCount = await page.locator('.chord-sym.current-chord').count();
  console.log('Metronome: current-chord count after Stop:', afterStopCount);
  if (afterStopCount !== 0) throw new Error('Playhead highlight should clear on Stop');
});

// --- Follow Me + silence: this is the reported bug, directly tested ---
await runWithAudio(mostlySilentWav, async (page) => {
  await page.click('#railUpload');
  await page.fill('#songSearch', 'Amazing Grace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.click('#modeFollowBtn');
  await page.waitForTimeout(150);

  const startIdx = await currentChordGlobalIndex(page);
  console.log('Follow Me + silence: starting global index:', startIdx);
  if (startIdx !== 0) throw new Error('Expected Follow Me to start on the first chord');

  // The one burst in this file is at t=0; wait well past it into the pure
  // silent tail, then confirm nothing has moved -- Follow Me must never
  // advance on silence alone, which is exactly the reported symptom.
  await page.waitForTimeout(4500);
  const silentIdx = await currentChordGlobalIndex(page);
  const activeLineAfterSilence = await page.evaluate(() =>
    document.querySelector('.song-line.active-line')?.dataset.index
  );
  console.log('Follow Me + silence: global index after 4.5s of silence:', silentIdx, '| active line:', activeLineAfterSilence);
  if (silentIdx !== startIdx || activeLineAfterSilence !== '0') {
    throw new Error('Follow Me advanced during silence -- this is the reported bug (it should never move without real strums)');
  }
  await page.click('#stopBtn');
});

// --- Follow Me + real strums: confirm it DOES advance in response ---
await runWithAudio(strumWav, async (page) => {
  await page.click('#railUpload');
  await page.fill('#songSearch', 'Amazing Grace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.click('#modeFollowBtn');
  await page.waitForTimeout(150);

  const startIdx = await currentChordGlobalIndex(page);
  await page.waitForTimeout(5000); // let several of the 1-strum/sec bursts land
  const afterStrumsIdx = await currentChordGlobalIndex(page);
  const afterStrumsCount = await page.locator('.chord-sym.current-chord').count();
  console.log('Follow Me + real strums: index went from', startIdx, 'to', afterStrumsIdx, '| still exactly one highlighted:', afterStrumsCount === 1);
  if (afterStrumsCount !== 1) throw new Error('Expected the playhead to stay on exactly one chord in Follow Me');
  if (afterStrumsIdx <= startIdx) throw new Error('Follow Me playhead did not advance in response to real detected strums');

  await page.click('#stopBtn');
  await page.waitForTimeout(150);
  const afterStopCount = await page.locator('.chord-sym.current-chord').count();
  console.log('Follow Me + real strums: current-chord count after Stop:', afterStopCount);
  if (afterStopCount !== 0) throw new Error('Playhead highlight should clear when Follow Me stops');
});

console.log('OK: playhead advances on the clock in Metronome mode, never advances on silence in Follow Me, advances in response to real strums, and clears on Stop');
