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

// A pitch detector can't tell a plucked string from a sung note at the
// same pitch -- both are clean periodic tones, so there's no way to
// filter by "instrument" as such. What it can do: only trust frequencies
// in a baritone uke's actual playing range (cuts a lot of stray
// background noise outside that band), require a strong, clean,
// sustained tone (autoCorrelate's clarity score -- rejects taps,
// breath noise, chatter, anything non-tonal), and only commit to
// displaying a note once it's held steady for a few frames rather than
// re-displaying every single frame's raw (and noisy) estimate.
const TUNER_MIN_FREQ = 110; // below the lowest open string (D3, 146.8Hz), with headroom
const TUNER_MAX_FREQ = 900; // above typical fretted range (up to ~15th fret on the E string)
const TUNER_MIN_CLARITY = 0.9;
const NOTE_STREAK_NEEDED = 5; // consecutive good frames before switching displayed note
const SILENCE_HOLD_SEC = 0.35; // how long to keep showing the last note through a brief gap
const CENTS_SMOOTHING = 0.3; // higher = follows pitch bends faster, lower = calmer needle

class Tuner {
  constructor(audioCtx, analyser) {
    this.ctx = audioCtx;
    this.analyser = analyser;
    this.buf = new Float32Array(analyser.fftSize);
    this.running = false;
    this.onUpdate = null;
    this._raf = null;
    this._reset();
  }

  _reset() {
    this.candidateKey = null;
    this.candidateCount = 0;
    this.displayedKey = null;
    this.displayedNote = null;
    this.smoothedCents = null;
    this.lastGoodTime = -Infinity;
  }

  start() {
    this.running = true;
    this._reset();
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _loop() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const { freq, clarity } = autoCorrelate(this.buf, this.ctx.sampleRate);
    const now = this.ctx.currentTime;

    const usable = freq !== -1 && clarity >= TUNER_MIN_CLARITY && freq >= TUNER_MIN_FREQ && freq <= TUNER_MAX_FREQ;

    if (usable) {
      const info = noteFromFrequency(freq);
      const key = info.noteName + info.octave;

      if (key === this.candidateKey) {
        this.candidateCount++;
      } else {
        this.candidateKey = key;
        this.candidateCount = 1;
      }

      // Commit to this note once it's held steady, or immediately if it's
      // the same note we're already showing (so pitch bends stay smooth).
      if (this.candidateCount >= NOTE_STREAK_NEEDED || key === this.displayedKey) {
        this.displayedKey = key;
        this.displayedNote = info;
        this.smoothedCents =
          this.smoothedCents === null
            ? info.cents
            : this.smoothedCents + CENTS_SMOOTHING * (info.cents - this.smoothedCents);
        this.lastGoodTime = now;

        if (this.onUpdate) {
          this.onUpdate({
            freq,
            ...info,
            cents: Math.round(this.smoothedCents),
            nearestString: nearestOpenString(info.midi),
          });
        }
      }
      // else: a new, not-yet-confirmed note candidate is still
      // accumulating its streak -- leave the current display alone
      // (don't fall through to the silence check below, or the streak
      // could never reach its threshold).
    } else if (now - this.lastGoodTime > SILENCE_HOLD_SEC) {
      // No usable pitch this frame, and it's been a while -- hold the
      // last good reading briefly rather than flickering to blank, since
      // a real strum has natural gaps and decay, then clear it.
      this._reset();
      if (this.onUpdate) this.onUpdate(null);
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }
}
