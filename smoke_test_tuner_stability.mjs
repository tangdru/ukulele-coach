// Verifies the Tuner's note-display stability logic (js/tuner.js): a
// single noisy frame shouldn't flicker the displayed note, but a real,
// sustained pitch change should still switch it after a few confirming
// frames. Drives the Tuner class directly with a scripted sequence of
// frequencies via a stubbed autoCorrelate, rather than synthesized audio
// -- this is about the note-lock/median-filter logic itself, not pitch
// detection, so there's no need to round-trip through a fake mic device.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:8934/index.html');

const seen = await page.evaluate(async () => {
  const fakeAnalyser = { fftSize: 2048, getFloatTimeDomainData: () => {} };
  const fakeCtx = { sampleRate: 44100 };

  // D3 = 146.83Hz, D#3 = 155.56Hz, E3 = 164.81Hz.
  const script = [
    146.83, 146.83, 146.83, 146.83, // stable D3
    155.56, // a single noisy outlier frame -- should never reach the display
    146.83, 146.83, 146.83, // back to D3 -- should read as an uninterrupted D3
    164.81, 164.81, 164.81, 164.81, 164.81, // a real, sustained move to E3
  ];
  let i = 0;
  window.autoCorrelate = () => (i < script.length ? script[i++] : -1);

  const tuner = new Tuner(fakeCtx, fakeAnalyser);
  const readings = [];
  tuner.onUpdate = (info) => readings.push(info ? `${info.noteName}${info.octave}` : '—');
  tuner.running = true;
  for (let n = 0; n < script.length; n++) tuner._loop();
  return readings;
});

console.log('Displayed note sequence:', seen.join(' '));
if (errors.length) throw new Error('page errors: ' + errors.join('; '));

if (seen.some((n) => n === 'D#3' || n === 'Eb3')) {
  throw new Error(`A single noisy frame flickered the display to a neighboring note: ${seen.join(' ')}`);
}
if (seen[0] !== 'D3' || seen[seen.length - 1] !== 'E3') {
  throw new Error(`Expected to start on D3 and end on E3 after the sustained move, got: ${seen.join(' ')}`);
}
// The single outlier frame should produce no update at all (display held
// steady) rather than a spurious reading -- fewer onUpdate calls than
// scripted frames.
if (seen.length >= 13) {
  throw new Error(`Expected some frames to be held (no update) around the outlier/transition, got ${seen.length} updates for 13 frames`);
}

console.log('OK: a single noisy frame never reaches the display, and a real sustained pitch change still switches the note after a few confirming frames');
await browser.close();
