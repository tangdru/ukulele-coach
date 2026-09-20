// Follow Scroll: advances the song chart by *listening to actual
// playing* instead of running a fixed-tempo clock. Counts onsets
// (detected strums/note attacks, via the shared OnsetDetector) and moves
// to the next line once enough of them have been heard to match that
// line's beat count -- so the chart genuinely tracks the player's pace
// rather than assuming they're locked to the tempo dial.

class FollowScroll {
  constructor(audioCtx, analyser, beatsPerLine) {
    this.beatsPerLine = beatsPerLine || 4;
    this.strumCount = 0;
    this.detector = new OnsetDetector(audioCtx, analyser);
    this.detector.onOnset = (time) => this._onOnset(time);
    this.onOnset = null; // (strumCount, beatsPerLine) => void -- fires every detected onset
    this.onAdvance = null; // () => void -- fires once enough onsets have landed on this line
  }

  setBeatsPerLine(n) {
    this.beatsPerLine = n || 4;
  }

  start() {
    this.strumCount = 0;
    this.detector.start();
  }

  stop() {
    this.detector.stop();
  }

  _onOnset(time) {
    this.strumCount++;
    if (this.onOnset) this.onOnset(this.strumCount, this.beatsPerLine);
    if (this.strumCount >= this.beatsPerLine) {
      this.strumCount = 0;
      if (this.onAdvance) this.onAdvance();
    }
  }
}
