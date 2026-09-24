// Soft chord-tone backing for Metronome mode: strums the actual computed
// baritone voicing for whichever chord is active, once per beat -- the
// same fingering math that draws the chord diagrams, so what you hear is
// what the instrument would really sound like, not a generic pad. There's
// no melody in a ChordPro chart (chords + lyrics only), so this can't play
// "the tune" -- it plays the harmony underneath it, soft enough to sit
// under a click and under your own playing rather than lead either.

class BackingTrack {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.gainNode = audioCtx.createGain();
    this.gainNode.gain.value = 0.08;
    this.gainNode.connect(audioCtx.destination);
  }

  // Plucks a chord at the given audio-clock time: each string gets its own
  // short pluck envelope, with a slight low-to-high stagger so it reads as
  // one soft strum rather than four notes landing at once.
  strum(sym, time) {
    const freqs = chordFrequencies(sym);
    if (!freqs) return;
    freqs.forEach((freq, i) => {
      const startAt = time + i * 0.012;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle'; // rounder/softer than a saw or square -- meant to sit in the background
      osc.frequency.value = freq;
      const noteGain = this.ctx.createGain();
      noteGain.gain.setValueAtTime(0.0001, startAt);
      noteGain.gain.exponentialRampToValueAtTime(1, startAt + 0.01);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.5);
      osc.connect(noteGain).connect(this.gainNode);
      osc.start(startAt);
      osc.stop(startAt + 0.55);
    });
  }
}
