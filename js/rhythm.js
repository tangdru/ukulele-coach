// Rhythm Coach: uses the shared OnsetDetector (js/onset.js) to catch note
// onsets from the mic, then scores each one against the nearest
// metronome beat time to give live timing feedback.

class RhythmCoach {
  constructor(audioCtx, analyser, metronome) {
    this.ctx = audioCtx;
    this.metronome = metronome;
    this.hits = [];
    this.onHit = null;
    this._detector = new OnsetDetector(audioCtx, analyser);
    this._detector.onOnset = (time) => this._registerOnset(time);
  }

  start() {
    this.hits = [];
    this._detector.start();
  }

  stop() {
    this._detector.stop();
  }

  _registerOnset(time) {
    const beats = this.metronome.beatLog;
    if (!beats.length) return;
    let nearest = null;
    let best = Infinity;
    for (const b of beats) {
      const d = Math.abs(b.time - time);
      if (d < best) {
        best = d;
        nearest = b;
      }
    }
    if (!nearest) return;

    const deltaMs = (time - nearest.time) * 1000;
    const abs = Math.abs(deltaMs);
    let rating;
    if (abs <= 40) rating = 'perfect';
    else if (abs <= 100) rating = 'good';
    else if (abs <= 200) rating = 'off';
    else rating = 'miss';

    const hit = { time, beat: nearest.beat, deltaMs, rating };
    this.hits.push(hit);
    if (this.hits.length > 300) this.hits.shift();
    if (this.onHit) this.onHit(hit);
  }

  stats(windowSec = 20) {
    const now = this.ctx.currentTime;
    const recent = this.hits.filter((h) => h.time > now - windowSec);
    return this._summarize(recent);
  }

  // Stats over every hit this session, not just a recent rolling window --
  // used for the end-of-session grade, since that should reflect the whole
  // run rather than however it happened to be trending at the last poll.
  allStats() {
    return this._summarize(this.hits);
  }

  _summarize(hits) {
    if (!hits.length) return { count: 0, avgAbsMs: 0, onTimePct: 0 };
    const avgAbsMs = hits.reduce((s, h) => s + Math.abs(h.deltaMs), 0) / hits.length;
    const onTimePct = (hits.filter((h) => h.rating === 'perfect' || h.rating === 'good').length / hits.length) * 100;
    return { count: hits.length, avgAbsMs, onTimePct };
  }
}
