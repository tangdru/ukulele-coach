// Shared onset (strum/note-attack) detector: a simple energy-flux
// approach -- flag a frame as an onset when its RMS energy jumps well
// above the recent rolling average, with a refractory period so one
// strum doesn't fire twice. Used by both the Rhythm Coach (compares each
// onset to the metronome beat grid) and Follow Scroll (just counts them).

class OnsetDetector {
  constructor(audioCtx, analyser) {
    this.ctx = audioCtx;
    this.analyser = analyser;
    this.buf = new Float32Array(analyser.fftSize);
    this.energyHistory = [];
    this.lastOnsetTime = 0;
    this.refractorySec = 0.15;
    this.running = false;
    this.onOnset = null; // (audioTime) => void
    this._raf = null;
  }

  start() {
    this.energyHistory = [];
    this.lastOnsetTime = 0;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _loop() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sumSq = 0;
    for (let i = 0; i < this.buf.length; i++) sumSq += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sumSq / this.buf.length);
    const now = this.ctx.currentTime;

    this.energyHistory.push({ t: now, e: rms });
    while (this.energyHistory.length && this.energyHistory[0].t < now - 1) this.energyHistory.shift();
    const avg = this.energyHistory.reduce((s, x) => s + x.e, 0) / this.energyHistory.length;

    if (rms > avg * 1.8 && rms > 0.02 && now - this.lastOnsetTime > this.refractorySec) {
      this.lastOnsetTime = now;
      if (this.onOnset) this.onOnset(now);
    }

    this._raf = requestAnimationFrame(() => this._loop());
  }
}
