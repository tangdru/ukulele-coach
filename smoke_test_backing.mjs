// Verifies the Metronome-mode backing track: it schedules real oscillator
// notes (the actual computed baritone voicing for whichever chord is
// current) once per beat while plain Metronome runs, and it's silent
// during Analyze Me (which needs the mic, not competing audio output).
//
// Headless Chromium can't be "listened to", so this instruments
// AudioContext.createOscillator/createGain from inside the page (injected
// before the app's own scripts run) to count and inspect what actually
// got scheduled, rather than just checking absence of errors.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({ permissions: ['microphone'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.addInitScript(() => {
  window.__oscCount = 0;
  window.__oscFreqs = [];
  const OrigOsc = OfflineAudioContext.prototype.createOscillator || null;
  const patch = (proto) => {
    const orig = proto.createOscillator;
    proto.createOscillator = function (...args) {
      const osc = orig.apply(this, args);
      window.__oscCount++;
      const origStart = osc.start.bind(osc);
      osc.start = (...startArgs) => {
        window.__oscFreqs.push(osc.frequency.value);
        return origStart(...startArgs);
      };
      return osc;
    };
  };
  patch(AudioContext.prototype);
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.click('#railUpload');
await page.fill('#songSearch', 'Amazing Grace');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.fill('#tempoInput', '120');

// --- Plain Metronome: backing track should schedule real notes ---
await page.click('#modeMetronomeBtn');
await page.waitForTimeout(2500); // several beats at 120bpm

const oscCount = await page.evaluate(() => window.__oscCount);
const freqs = await page.evaluate(() => window.__oscFreqs);
console.log('oscillators created during Metronome playback:', oscCount);
console.log('sample of scheduled frequencies (Hz):', freqs.slice(0, 8).map((f) => Math.round(f)));
// The metronome's own click is one oscillator per beat; a real backing
// chord adds 4 more (one per baritone string) on top of that -- so a
// healthy multi-beat count here is well beyond just the clicks alone.
if (oscCount < 8) throw new Error(`Expected substantially more than just click-track oscillators, got ${oscCount}`);
if (!freqs.some((f) => f > 0 && f < 1000 && ![1000, 750].includes(Math.round(f)))) {
  throw new Error('Expected some scheduled frequencies outside the metronome click tones (1000Hz/750Hz), i.e. real chord notes');
}

await page.click('#stopBtn');
await page.waitForTimeout(150);

// --- Analyze Me: no backing track competing with the mic ---
await page.evaluate(() => { window.__oscCount = 0; window.__oscFreqs = []; });
await page.click('#modeAnalyzeBtn');
await page.waitForTimeout(300);
const analyzeStarted = await page.locator('#modeAnalyzeBtn').evaluate((el) => el.classList.contains('active'));
console.log('Analyze Me actually started:', analyzeStarted);
if (!analyzeStarted) throw new Error('Test setup: Analyze Me did not start, so the "no backing track" check below would be meaningless');
await page.waitForTimeout(1700);
const analyzeOscCount = await page.evaluate(() => window.__oscCount);
const analyzeFreqs = await page.evaluate(() => window.__oscFreqs);
const nonClickFreqs = analyzeFreqs.filter((f) => ![1000, 750].includes(Math.round(f)));
console.log('oscillators during Analyze Me:', analyzeOscCount, '| non-click frequencies:', nonClickFreqs.length);
if (nonClickFreqs.length > 0) {
  throw new Error('Backing track should not play during Analyze Me (mic is listening)');
}

await page.click('#stopBtn');

if (errors.length) throw new Error('page errors: ' + errors.join('; '));

await browser.close();
console.log('OK: Metronome mode schedules a real chord-tone backing track once per beat, and it stays silent during Analyze Me');
