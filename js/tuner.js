// Continuous pitch -> note/cents readout, plus a nearest-string helper for
// the baritone's open strings (D3 G3 B3 E4) so the tuner can tell you which
// string you're probably tuning.

const BARITONE_OPEN_STRINGS = [
  { name: 'D3', midi: 50 },
  { name: 'G3', midi: 55 },
  { name: 'B3', midi: 59 },
  { name: 'E4', midi: 64 },
];

function nearestOpenString(midi) {
  let best = BARITONE_OPEN_STRINGS[0];
  let bestDist = Infinity;
  for (const s of BARITONE_OPEN_STRINGS) {
    const d = Math.abs(s.midi - midi);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

// How much each new reading pulls the displayed needle toward it (0-1):
// lower = calmer/slower-following, higher = snappier/jumpier.
const CENTS_SMOOTHING = 0.2;

// Raw per-frame frequency estimates from a real acoustic signal (as
// opposed to a clean synthesized test tone) are noisy -- string/room
// noise, harmonics, an occasional octave error -- enough that a single
// bad frame can misfire to a neighboring note and reset the display.
// Two standard tuner techniques for this, on top of the cents smoothing
// above (which only ever smoothed the needle *within* an already-locked
// note): median-filter the raw frequency over a short rolling window
// before doing anything else with it, and require several consecutive
// frames to agree on a *different* note before actually switching the
// display to it, rather than snapping on the first one.
const FREQ_MEDIAN_WINDOW = 5;
const NOTE_LOCK_FRAMES = 3;

class Tuner {
  constructor(audioCtx, analyser) {
    this.ctx = audioCtx;
    this.analyser = analyser;
    this.buf = new Float32Array(analyser.fftSize);
    this.running = false;
    this.onUpdate = null;
    this._raf = null;
    this.smoothedCents = null;
    this.lastNoteKey = null;
    this.freqHistory = [];
    this.candidateKey = null;
    this.candidateCount = 0;
  }

  start() {
    this.running = true;
    this.smoothedCents = null;
    this.lastNoteKey = null;
    this.freqHistory = [];
    this.candidateKey = null;
    this.candidateCount = 0;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _loop() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const freq = autoCorrelate(this.buf, this.ctx.sampleRate);

    if (freq === -1) {
      this.smoothedCents = null;
      this.lastNoteKey = null;
      this.freqHistory = [];
      this.candidateKey = null;
      this.candidateCount = 0;
      if (this.onUpdate) this.onUpdate(null);
      this._raf = requestAnimationFrame(() => this._loop());
      return;
    }

    this.freqHistory.push(freq);
    if (this.freqHistory.length > FREQ_MEDIAN_WINDOW) this.freqHistory.shift();
    const sorted = [...this.freqHistory].sort((a, b) => a - b);
    const medianFreq = sorted[Math.floor(sorted.length / 2)];
    const info = noteFromFrequency(medianFreq);
    const key = info.noteName + info.octave;

    if (this.lastNoteKey === null) {
      // Nothing locked in yet -- lock onto the first reading immediately.
      this.lastNoteKey = key;
      this.smoothedCents = info.cents;
    } else if (key === this.lastNoteKey) {
      // Still the locked-in note -- ease the displayed cents toward each
      // new reading instead of jumping straight to it.
      this.candidateKey = null;
      this.candidateCount = 0;
      this.smoothedCents += CENTS_SMOOTHING * (info.cents - this.smoothedCents);
    } else {
      // A different note than the one currently locked in. Don't switch
      // on a single reading -- hold the display steady and only actually
      // change it once several consecutive frames agree.
      if (key === this.candidateKey) this.candidateCount++;
      else {
        this.candidateKey = key;
        this.candidateCount = 1;
      }
      if (this.candidateCount >= NOTE_LOCK_FRAMES) {
        this.lastNoteKey = key;
        this.smoothedCents = info.cents;
        this.candidateKey = null;
        this.candidateCount = 0;
      } else {
        this._raf = requestAnimationFrame(() => this._loop());
        return; // hold the current display until the candidate note is confirmed
      }
    }

    const string = nearestOpenString(info.midi);
    if (this.onUpdate) {
      this.onUpdate({ freq: medianFreq, ...info, cents: Math.round(this.smoothedCents), nearestString: string });
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }
}
