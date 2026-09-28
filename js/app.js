(function () {
  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let micSource = null;

  let currentSong = null;
  let metronome = null;
  let backingTrack = null;
  let tuner = null;
  let rhythmCoach = null;
  let keyDetector = null;
  let followScroll = null;
  let followActive = false;
  let analyzeActive = false;

  let flatLines = []; // { el, index } across the whole rendered song
  let scrollActive = false;
  let scrollRafId = null;
  let lineStartTimes = [];
  let scrollStartTime = 0;
  let activeLineIndex = -1;

  // Loop a section: repeat lines [loopStart, loopEnd] instead of playing
  // the whole song once -- the classic "isolate the rough spot and drill
  // it" practice technique. -1 means no loop set (play the whole chart).
  let loopStart = -1;
  let loopEnd = -1;
  let loopPicking = false;
  let loopPickFirst = null;

  const RATING_RANK = { perfect: 0, good: 1, off: 2, miss: 3 };
  let lineOnsetCounts = []; // per-line: how many timing hits landed on it, so
  // each new one maps to the next chord in that line
  let lineWorstRating = []; // per-line: worst rating seen, for the border color

  const $ = (id) => document.getElementById(id);

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  function showError(msg, durationMs = 6000) {
    const el = $('appError');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), durationMs);
  }
  // Mic errors get much longer on screen than other errors -- a 6s banner
  // is easy to miss entirely on a phone, especially if you're looking at
  // the permission prompt instead of the page right when it appears.
  const showMicError = (msg) => showError(msg, 20000);

  async function ensureMic() {
    if (micStream) return true;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      // iOS Safari can leave a freshly-created (or backgrounded-and-returned-to)
      // AudioContext in a "suspended" state even after mic permission is
      // granted -- the analyser then silently processes silence forever,
      // with no error, just a tuner/pitch-detection reading that never
      // updates. Resuming must happen inside a user-gesture handler (this
      // one, from the button tap), so it can't be deferred to later.
      await audioCtx.resume();
      // Browser defaults enable echo cancellation, noise suppression, and
      // auto-gain control -- all tuned for voice calls, and all liable to
      // dampen a strum's sharp transient (the very thing onset/pitch
      // detection looks for) or, worse, let AGC-boosted room noise drift
      // into false onsets. Every feature here (Tuner, Key detection,
      // Follow Me, Analyze Me) wants the raw signal instead.
      // `ideal`, not a bare `false` -- a bare boolean is a *mandatory*
      // constraint, and if a device can't satisfy it exactly (some iOS
      // Safari/hardware combinations can't disable these), getUserMedia
      // throws OverconstrainedError before ever reaching the mic, which
      // looks identical to "the mic just isn't picking anything up."
      // `ideal` asks for the same thing but degrades gracefully instead.
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false },
        },
      });
      micSource = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      micSource.connect(analyser);
      metronome = metronome || new Metronome(audioCtx);
      return true;
    } catch (err) {
      showMicError('Microphone access is needed for this feature: ' + (err.message || err));
      return false;
    }
  }

  function ensureMetronome() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume(); // see ensureMic's comment on iOS Safari
    if (!metronome) metronome = new Metronome(audioCtx);
    return metronome;
  }

  // ---------- Song loading & rendering ----------

  let songTitles = [];
  function refreshSongTitles() {
    songTitles = Object.keys(allAvailableSongs());
    // The library can finish an async load (Supabase, or falling back to
    // localStorage) after the panel's already open -- re-render live
    // rather than leaving the list stale until the panel is reopened.
    renderSongList();
  }

  // knownTitle: the title to use for a *notated* (MusicXML) song, which has
  // no {title:} directive of its own to parse out -- see loadNotatedSong.
  // Ignored for an ordinary ChordPro song, which derives its own title.
  function loadSong(chordproText, fromQueue, knownTitle) {
    // Finalize/save any in-progress Analyze Me session against the *old*
    // song before its chart lines are replaced -- stopScroll() (called
    // here) is what records session history, and it needs the outgoing
    // song's flatLines/ratings still in place to do that.
    stopScroll();
    stopFollow();
    clearLoop(); // line indices are song-specific, a leftover loop range wouldn't mean anything on a new chart

    if (isNotatedSongText(chordproText)) {
      loadNotatedSong(chordproText, knownTitle, fromQueue);
      return;
    }
    setNotatedMode(false);

    const song = parseChordPro(chordproText);
    currentSong = song;
    renderSong(song);
    setChartScale(1); // each new chart starts at the default size, not a previous chart's fit-to-screen level
    $('songTitle').textContent = song.title || 'Untitled';
    $('songTitle').title = [song.title, song.artist].filter(Boolean).join(' — ');
    $('keyDisplay').textContent = song.key || '—';
    $('timeSigDisplay').textContent = song.timeSig || '4/4';
    if (song.tempo) $('tempoInput').value = song.tempo;
    clearTimingMarks();

    if (song.title) {
      saveSongToLibrary(song.title, chordproText);
      refreshSongTitles();
    }
    closeUploadPanel();

    // A song loaded any way other than the active playlist queue's own
    // advance/prev/next logic (picked manually from the list, pasted,
    // uploaded) ends that queue -- it no longer describes what's playing.
    if (!fromQueue && activeQueue) {
      activeQueue = null;
      updateQueueStatus();
    }
  }

  // ---------- Real sheet music (MusicXML/.mxl, via OpenSheetMusicDisplay) ----------
  // A fundamentally different kind of "song" from everything else here --
  // ChordPro only ever encodes chord names and lyrics, never melody notes,
  // so there's no way to get real staff notation out of a pasted/PDF/Word
  // chord chart. This is the one import path that has actual note/rhythm
  // data (from a MusicXML file), rendered as-authored instead of parsed
  // into the chord-over-lyric chart. Stored in the same song library as
  // everything else (so it's browsable/playlist-able like any other song),
  // tagged with a prefix so loadSong can tell the two apart -- uncompressed
  // MusicXML is plain text and stored as-is, compressed .mxl is binary and
  // stored base64-encoded.
  const MUSICXML_TEXT_PREFIX = 'MUSICXML:';
  const MUSICXML_B64_PREFIX = 'MUSICXML-B64:';
  let osmd = null;

  function isNotatedSongText(text) {
    return text.startsWith(MUSICXML_TEXT_PREFIX) || text.startsWith(MUSICXML_B64_PREFIX);
  }

  function deriveTitleFromFilename(filename) {
    const stripped = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    return stripped || 'Untitled sheet music';
  }

  function arrayBufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000; // String.fromCharCode.apply chokes on very large argument lists
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // Practice modes, the loop, chord-tap diagrams, and chart zoom are all
  // built around the ChordPro chart's flatLines/chord-symbol DOM, none of
  // which exists for a MusicXML render -- rather than half-wire those to a
  // completely different rendering engine, a notated song is read-only:
  // shown full-screen with a note explaining why the controls are gone.
  function setNotatedMode(isNotated) {
    $('staffView').classList.toggle('hidden', !isNotated);
    $('songView').classList.toggle('hidden', isNotated);
    $('chartZoom').classList.toggle('hidden', isNotated);
    $('playModesRow').classList.toggle('hidden', isNotated);
    $('notatedNote').classList.toggle('hidden', !isNotated);
  }

  async function loadNotatedSong(prefixedText, knownTitle, fromQueue) {
    const title = knownTitle || 'Untitled sheet music';
    currentSong = { title, notated: true };
    flatLines = [];
    $('songTitle').textContent = title;
    $('songTitle').title = title;
    $('keyDisplay').textContent = '—';
    $('timeSigDisplay').textContent = '—';
    clearTimingMarks();
    setNotatedMode(true);
    closeUploadPanel();

    if (!fromQueue && activeQueue) {
      activeQueue = null;
      updateQueueStatus();
    }

    saveSongToLibrary(title, prefixedText);
    refreshSongTitles();

    try {
      const content = prefixedText.startsWith(MUSICXML_B64_PREFIX)
        ? base64ToArrayBuffer(prefixedText.slice(MUSICXML_B64_PREFIX.length))
        : prefixedText.slice(MUSICXML_TEXT_PREFIX.length);
      osmd = osmd || new opensheetmusicdisplay.OpenSheetMusicDisplay($('staffView'), { autoResize: true, backend: 'svg', drawTitle: true });
      await osmd.load(content);
      osmd.render();
    } catch (err) {
      showError(`Couldn't render sheet music for "${title}": ${err.message || err}`, 9000);
    }
  }

  function renderSong(song) {
    const view = $('songView');
    view.innerHTML = '';
    flatLines = [];
    let idx = 0;

    song.sections.forEach((section) => {
      if (section.name) {
        const header = document.createElement('div');
        header.className = 'section-header';
        header.textContent = section.name;
        view.appendChild(header);
      }
      section.lines.forEach((line) => {
        // Captured per-iteration: `idx` itself is one shared, mutating
        // variable across the whole render, so a closure over it directly
        // would see only its final value (one past the last line) once
        // rendering finishes and the user actually clicks something.
        const lineIdx = idx;
        const lineEl = document.createElement('div');
        lineEl.className = 'song-line';
        lineEl.dataset.index = String(lineIdx);

        const chordRow = document.createElement('div');
        chordRow.className = 'chord-row';
        const lyricRow = document.createElement('div');
        lyricRow.className = 'lyric-row';
        lyricRow.textContent = line.text || ' ';

        line.chords.forEach((c) => {
          const span = document.createElement('span');
          span.className = 'chord-sym';
          span.textContent = c.sym;
          span.style.left = c.offset + 'ch';
          span.addEventListener('click', () => showChordDiagram(c.sym));
          chordRow.appendChild(span);
        });
        if (!line.chords.length) chordRow.innerHTML = ' ';

        lineEl.appendChild(chordRow);
        lineEl.appendChild(lyricRow);
        lineEl.addEventListener('click', () => {
          if (loopPicking) handleLoopPick(lineIdx);
          else jumpToLine(lineIdx);
        });
        view.appendChild(lineEl);

        flatLines.push(lineEl);
        idx++;
      });
    });

    if (!flatLines.length) {
      view.innerHTML = '<p class="empty-hint">This song has no lines to show.</p>';
    }
  }

  // ---------- Chart zoom / fit-to-screen ----------
  // #songView's font-size is otherwise unset (inherits the page default),
  // and every chord's position is in `ch` units relative to that same
  // font-size (see span.style.left above) -- so scaling this one property
  // scales the whole chart uniformly, chords included, without needing to
  // touch anything else.

  let chartScale = 1;
  const CHART_MIN_SCALE = 0.4;
  const CHART_MAX_SCALE = 2.5;

  function setChartScale(scale) {
    chartScale = Math.max(CHART_MIN_SCALE, Math.min(CHART_MAX_SCALE, scale));
    $('songView').style.fontSize = chartScale + 'rem';
  }

  $('zoomInBtn').addEventListener('click', () => setChartScale(chartScale * 1.15));
  $('zoomOutBtn').addEventListener('click', () => setChartScale(chartScale / 1.15));

  $('fitScreenBtn').addEventListener('click', () => {
    if (!flatLines.length) return;
    const view = $('songView');
    if (view.scrollWidth <= view.clientWidth) {
      setChartScale(1); // already fits -- snap back to the default size rather than zooming in further
      return;
    }
    // scrollWidth/clientWidth are measured at the *current* scale, so this
    // ratio is the correction needed regardless of what that scale already
    // was -- but #songView's fixed-pixel padding/border don't shrink along
    // with the font, so content width isn't quite perfectly linear in
    // font-size and one application under-corrects slightly. Re-measuring
    // and re-applying a few times converges on a tight fit either way.
    for (let i = 0; i < 4 && view.scrollWidth > view.clientWidth; i++) {
      setChartScale(chartScale * (view.clientWidth / view.scrollWidth) * 0.98);
    }
  });

  function showChordDiagram(sym) {
    const modal = $('chordModal');
    const content = $('chordModalContent');
    currentInstrument().renderChordDiagram(content, sym);
    modal.classList.remove('hidden');
  }

  // ---------- Instrument selector ----------

  $('instrumentSelect').value = currentInstrumentId;
  $('instrumentSelect').addEventListener('change', (e) => {
    setCurrentInstrument(e.target.value);
  });

  $('chordModal').addEventListener('click', (e) => {
    if (e.target.id === 'chordModal' || e.target.classList.contains('chord-modal-backdrop')) {
      $('chordModal').classList.add('hidden');
    }
  });

  // ---------- Play modes: Metronome / Follow Me / Analyze Me ----------

  function beatsPerLine() {
    const sig = ($('timeSigDisplay').textContent || '4/4').split('/');
    return parseInt(sig[0], 10) || 4;
  }

  function setActiveMode(mode) {
    $('modeMetronomeBtn').classList.toggle('active', mode === 'metronome');
    $('modeFollowBtn').classList.toggle('active', mode === 'follow');
    $('modeAnalyzeBtn').classList.toggle('active', mode === 'analyze');
  }

  async function startScroll(scoring) {
    if (!flatLines.length) return;
    // Switching modes directly (e.g. Analyze Me -> Metronome) without
    // hitting Stop first should still save the session that was running.
    finalizeAnalyzeSession();
    stopFollow();

    if (scoring) {
      const ok = await ensureMic();
      if (!ok) return;
      clearTimingMarks();
      rhythmCoach = rhythmCoach || new RhythmCoach(audioCtx, analyser, ensureMetronome());
      rhythmCoach.onHit = handleTimingHit;
      $('analyzeStats').classList.remove('hidden');
      analyzeActive = true;
      // No backing track while Analyze Me is listening -- it's not
      // needed (Analyze Me is the practice-with-feedback step, not the
      // play-along step) and its own audio output could otherwise be
      // picked back up by the mic as false strums.
      metronome.onBeat = null;
    } else {
      ensureMetronome();
      if (rhythmCoach) rhythmCoach.stop();
      $('analyzeStats').classList.add('hidden');
      analyzeActive = false;
      // Metronome mode: something to actually play over, not just a
      // click -- softly strums whichever chord the clock is currently on,
      // using the real computed baritone voicing (same math behind the
      // fret diagrams), once per beat.
      backingTrack = backingTrack || new BackingTrack(audioCtx);
      metronome.onBeat = (beatIndex, time) => {
        const lineIdx = lineIndexAt(time);
        if (lineIdx < 0) return;
        const sym = chordSymbolAt(lineIdx, beatIndexInLine(lineIdx, time));
        if (sym) backingTrack.strum(sym, time);
      };
    }

    const bpm = parseInt($('tempoInput').value, 10) || 90;
    const secondsPerLine = (beatsPerLine() * 60) / bpm;

    metronome.start(bpm, beatsPerLine());
    if (scoring) {
      rhythmCoach.start();
      rhythmStatsLoop();
    }

    // With a loop range set, start there instead of at the top of the chart.
    const startIdx = loopStart >= 0 ? loopStart : 0;
    scrollStartTime = audioCtx.currentTime + 0.1 - startIdx * secondsPerLine;
    lineStartTimes = flatLines.map((_, i) => scrollStartTime + i * secondsPerLine);
    activeLineIndex = -1;
    scrollActive = true;
    setActiveMode(scoring ? 'analyze' : 'metronome');
    highlightLoop();
  }

  // Maps a timing hit's audio-clock timestamp to the line that was
  // playing at that moment (lineStartTimes is ascending), marks that
  // line with the worst rating seen on it, and maps onset order within
  // the line to that line's chords in order, marking the specific chord
  // that hit corresponds to.
  function handleTimingHit(hit) {
    let lineIdx = -1;
    for (let i = 0; i < lineStartTimes.length; i++) {
      if (lineStartTimes[i] <= hit.time) lineIdx = i;
      else break;
    }
    const el = flatLines[lineIdx];
    if (lineIdx < 0 || !el) return;

    const prevRating = lineWorstRating[lineIdx];
    if (!prevRating || RATING_RANK[hit.rating] > RATING_RANK[prevRating]) {
      if (prevRating) el.classList.remove('rated-' + prevRating);
      el.classList.add('rated-' + hit.rating);
      lineWorstRating[lineIdx] = hit.rating;
    }

    const chordIdx = lineOnsetCounts[lineIdx] || 0;
    lineOnsetCounts[lineIdx] = chordIdx + 1;
    const chordEls = el.querySelectorAll('.chord-sym');
    if (chordEls[chordIdx]) {
      chordEls[chordIdx].classList.remove('rated-perfect', 'rated-good', 'rated-off', 'rated-miss');
      chordEls[chordIdx].classList.add('rated-' + hit.rating);
    }
  }

  function clearTimingMarks() {
    flatLines.forEach((el) => {
      el.classList.remove('rated-perfect', 'rated-good', 'rated-off', 'rated-miss');
      el.querySelectorAll('.chord-sym').forEach((c) => {
        c.classList.remove('rated-perfect', 'rated-good', 'rated-off', 'rated-miss');
      });
    });
    lineOnsetCounts = new Array(flatLines.length).fill(0);
    lineWorstRating = new Array(flatLines.length).fill(null);
    $('analyzeStats').classList.add('hidden');
  }

  // Saves the just-finished Analyze Me run to session history (grade +
  // which lines timing was off on), if it actually produced any hits.
  // Guarded by analyzeActive so it only ever records once per run, no
  // matter which of the several code paths that end a scored session
  // (Stop button, switching modes, loading a new song, the scroll running
  // off the end of the chart) triggers it.
  function finalizeAnalyzeSession() {
    if (analyzeActive && rhythmCoach && rhythmCoach.hits.length > 0) {
      recordAnalyzeSession();
    }
    analyzeActive = false;
  }

  function recordAnalyzeSession() {
    const stats = rhythmCoach.allStats();
    const lines = [];
    lineWorstRating.forEach((rating, idx) => {
      if (!rating) return;
      const el = flatLines[idx];
      const lyricEl = el && el.querySelector('.lyric-row');
      lines.push({ index: idx, text: lyricEl ? lyricEl.textContent : '', rating });
    });
    saveSessionToHistory({
      songTitle: (currentSong && currentSong.title) || 'Untitled',
      createdAt: new Date().toISOString(),
      count: stats.count,
      onTimePct: stats.onTimePct,
      avgAbsMs: stats.avgAbsMs,
      grade: gradeForStats(stats.onTimePct, stats.count),
      lines,
    });
    if (!$('view-history').classList.contains('hidden')) renderHistoryView();
  }

  function rhythmStatsLoop() {
    if (!analyzeActive) return;
    const stats = rhythmCoach.stats();
    $('statOnTime').textContent = stats.count ? Math.round(stats.onTimePct) + '%' : '—';
    $('statAvgMs').textContent = stats.count ? Math.round(stats.avgAbsMs) + ' ms' : '—';
    $('statCount').textContent = String(rhythmCoach.hits.length);
    setTimeout(rhythmStatsLoop, 400);
  }

  // ---------- Current-chord "playhead" (Follow Me: what you're playing; Metronome/Analyze Me: what you should be) ----------

  let currentChordEl = null;

  function setCurrentChord(lineIdx, chordIdx) {
    const line = flatLines[lineIdx];
    const chordEls = line ? line.querySelectorAll('.chord-sym') : [];
    const target = chordEls.length ? chordEls[Math.max(0, Math.min(chordIdx, chordEls.length - 1))] : null;
    if (target === currentChordEl) return;
    if (currentChordEl) currentChordEl.classList.remove('current-chord');
    currentChordEl = target || null;
    if (currentChordEl) {
      currentChordEl.classList.add('current-chord');
      scrollChordHorizontallyIntoView(currentChordEl);
    }
  }

  // Auto-scroll's existing scrollIntoView calls (on the *line*) only
  // center vertically -- a chord partway across a line too wide for the
  // viewport (a long lyric line, or anything zoomed out) can still sit off
  // to the side. This nudges #songView's own horizontal scroll, on the
  // *chord*, whenever the playhead moves somewhere not already visible --
  // a plain scrollBy rather than the element's own scrollIntoView, so it
  // can't fight the line's vertical centering by also moving vertically.
  function scrollChordHorizontallyIntoView(chordEl) {
    if (!$('autoScrollToggle').checked) return;
    const view = $('songView');
    const viewRect = view.getBoundingClientRect();
    const chordRect = chordEl.getBoundingClientRect();
    const margin = 24;
    if (chordRect.left < viewRect.left + margin) {
      view.scrollBy({ left: chordRect.left - viewRect.left - margin, behavior: 'smooth' });
    } else if (chordRect.right > viewRect.right - margin) {
      view.scrollBy({ left: chordRect.right - viewRect.right + margin, behavior: 'smooth' });
    }
  }

  function clearCurrentChord() {
    if (currentChordEl) currentChordEl.classList.remove('current-chord');
    currentChordEl = null;
  }

  // Shared "where in the chart is the fixed clock at time T" math -- used
  // by the visual playhead (highlightLoop) and the audio one (the backing
  // track's per-beat chord lookup) alike, so what you see and what you
  // hear can never disagree about which chord is current.
  function lineIndexAt(time) {
    let idx = -1;
    for (let i = 0; i < lineStartTimes.length; i++) {
      if (lineStartTimes[i] <= time) idx = i;
      else break;
    }
    return idx;
  }

  function beatIndexInLine(lineIdx, time) {
    const bpm = parseInt($('tempoInput').value, 10) || 90;
    const secondsPerBeat = 60 / bpm;
    return Math.floor((time - lineStartTimes[lineIdx]) / secondsPerBeat);
  }

  function chordSymbolAt(lineIdx, chordIdx) {
    const line = flatLines[lineIdx];
    const chordEls = line ? line.querySelectorAll('.chord-sym') : [];
    if (!chordEls.length) return null;
    return chordEls[Math.max(0, Math.min(chordIdx, chordEls.length - 1))].textContent;
  }

  function highlightLoop() {
    if (!scrollActive) return;
    const now = audioCtx.currentTime;
    // Looping a section: once playback runs past the end of the loop
    // range, re-anchor the schedule back to loopStart -- same "shift
    // scrollStartTime so this index lands at now" trick jumpToLine()
    // already uses, so the metronome/backing track/scoring all just keep
    // running through the seam rather than needing a restart. Checked by
    // *time*, not by idx exceeding loopEnd -- if loopEnd is the chart's
    // very last line, idx can never go past it (lineStartTimes has no
    // further entries to return), so it would otherwise just sit there
    // instead of wrapping.
    let idx;
    if (loopStart >= 0) {
      const bpm = parseInt($('tempoInput').value, 10) || 90;
      const secondsPerLine = (beatsPerLine() * 60) / bpm;
      if (now >= lineStartTimes[loopEnd] + secondsPerLine) {
        scrollStartTime = now - loopStart * secondsPerLine;
        lineStartTimes = flatLines.map((_, i) => scrollStartTime + i * secondsPerLine);
        // The wrapped index is loopStart by construction -- re-deriving it
        // from lineIndexAt(now) here would compare `now` against the
        // timestamp just computed from it via a subtract-then-add
        // round-trip, which floating-point rounding doesn't always land
        // back on exactly `now`. When it rounds a hair high, the <= check
        // fails and idx falls back to loopStart-1 for a single frame --
        // a real, if rare, flicker at the seam. Skipping that re-derivation
        // avoids the rounding risk entirely instead of chasing it.
        idx = loopStart;
      } else {
        idx = lineIndexAt(now);
      }
    } else {
      idx = lineIndexAt(now);
    }
    if (idx !== activeLineIndex) {
      if (activeLineIndex >= 0 && flatLines[activeLineIndex]) {
        flatLines[activeLineIndex].classList.remove('active-line');
      }
      activeLineIndex = idx;
      if (flatLines[activeLineIndex]) {
        flatLines[activeLineIndex].classList.add('active-line');
        if ($('autoScrollToggle').checked) {
          flatLines[activeLineIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
    // Playhead: which chord the fixed clock says should be playing right
    // now within the active line -- same "Nth beat -> Nth chord" mapping
    // Analyze Me's scoring already uses, so a chord that holds across
    // several beats just keeps the highlight rather than needing one
    // chord per beat.
    if (idx >= 0) setCurrentChord(idx, beatIndexInLine(idx, now));
    if (loopStart < 0 && idx >= lineStartTimes.length - 1 && now > lineStartTimes[lineStartTimes.length - 1] + 2) {
      const endedMode = analyzeActive ? 'analyze' : 'metronome';
      stopScroll();
      handleSongEnd(endedMode);
      return;
    }
    scrollRafId = requestAnimationFrame(highlightLoop);
  }

  function stopScroll() {
    finalizeAnalyzeSession();
    scrollActive = false;
    analyzeActive = false;
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    if (metronome) metronome.stop();
    if (rhythmCoach) rhythmCoach.stop();
    // Timing marks (rated-* classes) deliberately survive Stop, so you can
    // review where the timing slipped after playing through -- only a
    // fresh scored Play, or loading a new song, clears them.
    flatLines.forEach((el) => el.classList.remove('active-line'));
    activeLineIndex = -1;
    clearCurrentChord();
    setActiveMode(null);
  }

  function jumpToLine(idx) {
    flatLines.forEach((el) => el.classList.remove('active-line'));
    if (flatLines[idx]) {
      flatLines[idx].classList.add('active-line');
      flatLines[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (scrollActive) {
      // Re-anchor the schedule so playback continues from this line.
      const bpm = parseInt($('tempoInput').value, 10) || 90;
      const secondsPerLine = (beatsPerLine() * 60) / bpm;
      const now = audioCtx.currentTime;
      scrollStartTime = now - idx * secondsPerLine;
      lineStartTimes = flatLines.map((_, i) => scrollStartTime + i * secondsPerLine);
      activeLineIndex = idx - 1;
    } else if (followActive) {
      activeLineIndex = idx;
      if (followScroll) followScroll.strumCount = 0;
      updateFollowStatus(0, beatsPerLine());
      setCurrentChord(idx, 0);
    }
  }

  // ---------- Follow My Playing (listens instead of running a clock) ----------

  function updateFollowStatus(count, total) {
    $('followStatus').classList.remove('hidden');
    $('followStatusText').textContent = `Listening… ${count}/${total} beats heard on this line`;
  }

  async function startFollow() {
    if (!flatLines.length) return;
    stopScroll();
    const ok = await ensureMic();
    if (!ok) return;

    followScroll = followScroll || new FollowScroll(audioCtx, analyser, beatsPerLine());
    followScroll.setBeatsPerLine(beatsPerLine());
    followScroll.onOnset = (count, total) => {
      updateFollowStatus(count, total);
      // The chord the player just played -- count is 1 after the first
      // strum, so it points at chord index 0, matching setCurrentChord's
      // own clamping for whatever's left once strums run past the chord
      // count on a line that holds a chord across several beats.
      setCurrentChord(activeLineIndex, count - 1);
    };
    followScroll.onAdvance = advanceFollowLine;

    // With a loop range set, start there instead of at the top of the chart.
    const startIdx = loopStart >= 0 ? loopStart : 0;
    flatLines.forEach((el) => el.classList.remove('active-line'));
    activeLineIndex = startIdx;
    if (flatLines[startIdx]) flatLines[startIdx].classList.add('active-line');
    updateFollowStatus(0, beatsPerLine());
    setCurrentChord(startIdx, 0);

    followScroll.start();
    followActive = true;
    setActiveMode('follow');
  }

  function advanceFollowLine() {
    let nextIdx = activeLineIndex + 1;
    if (loopStart >= 0 && nextIdx > loopEnd) nextIdx = loopStart;
    if (nextIdx >= flatLines.length) {
      stopFollow();
      handleSongEnd('follow');
      return;
    }
    if (flatLines[activeLineIndex]) flatLines[activeLineIndex].classList.remove('active-line');
    activeLineIndex = nextIdx;
    if (flatLines[activeLineIndex]) {
      flatLines[activeLineIndex].classList.add('active-line');
      if ($('autoScrollToggle').checked) {
        flatLines[activeLineIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    followScroll.setBeatsPerLine(beatsPerLine());
    updateFollowStatus(0, beatsPerLine());
    setCurrentChord(activeLineIndex, 0);
  }

  function stopFollow() {
    if (followScroll) followScroll.stop();
    followActive = false;
    $('followStatus').classList.add('hidden');
    flatLines.forEach((el) => el.classList.remove('active-line'));
    activeLineIndex = -1;
    clearCurrentChord();
    setActiveMode(null);
  }

  $('modeMetronomeBtn').addEventListener('click', () => startScroll(false));
  $('modeFollowBtn').addEventListener('click', startFollow);
  $('modeAnalyzeBtn').addEventListener('click', () => startScroll(true));
  $('stopBtn').addEventListener('click', () => {
    stopScroll();
    stopFollow();
    // A manual Stop is the player choosing to end the session -- unlike
    // reaching a song's natural end, it shouldn't auto-advance, but it
    // should still end the playlist queue rather than leave it stale.
    if (activeQueue) {
      activeQueue = null;
      updateQueueStatus();
    }
  });

  // ---------- Loop a section ----------

  function updateLoopRangeHighlight() {
    flatLines.forEach((el, i) => {
      el.classList.toggle('loop-range', loopStart >= 0 && i >= loopStart && i <= loopEnd);
    });
  }

  function updateLoopButtonLabel() {
    $('loopBtn').classList.toggle('active', loopPicking || loopStart >= 0);
    if (loopPicking) {
      $('loopBtnLabel').textContent = loopPickFirst === null ? 'Pick 1st…' : 'Pick 2nd…';
      $('loopStatus').classList.remove('hidden');
      $('loopStatusText').textContent =
        loopPickFirst === null
          ? 'Tap a line to start the loop…'
          : 'Tap the last line to loop (or the same line again for just one line)…';
      return;
    }
    if (loopStart >= 0) {
      const count = loopEnd - loopStart + 1;
      $('loopBtnLabel').textContent = `Loop: ${count} line${count === 1 ? '' : 's'}`;
      $('loopStatus').classList.add('hidden');
      return;
    }
    $('loopBtnLabel').textContent = 'Loop';
    $('loopStatus').classList.add('hidden');
  }

  function handleLoopPick(idx) {
    if (loopPickFirst === null) {
      loopPickFirst = idx;
      if (flatLines[idx]) flatLines[idx].classList.add('loop-picking');
      updateLoopButtonLabel();
      return;
    }
    if (flatLines[loopPickFirst]) flatLines[loopPickFirst].classList.remove('loop-picking');
    loopStart = Math.min(loopPickFirst, idx);
    loopEnd = Math.max(loopPickFirst, idx);
    loopPicking = false;
    loopPickFirst = null;
    updateLoopRangeHighlight();
    updateLoopButtonLabel();
  }

  function clearLoop() {
    if (loopPickFirst !== null && flatLines[loopPickFirst]) {
      flatLines[loopPickFirst].classList.remove('loop-picking');
    }
    loopStart = -1;
    loopEnd = -1;
    loopPicking = false;
    loopPickFirst = null;
    updateLoopRangeHighlight();
    updateLoopButtonLabel();
  }

  $('loopBtn').addEventListener('click', () => {
    if (loopStart >= 0 || loopPicking) {
      clearLoop();
      return;
    }
    if (!flatLines.length) return;
    loopPicking = true;
    loopPickFirst = null;
    updateLoopButtonLabel();
  });

  // ---------- Tap tempo ----------

  let tapTimes = [];
  $('tapTempoBtn').addEventListener('click', () => {
    const now = performance.now();
    tapTimes = tapTimes.filter((t) => now - t < 3000);
    tapTimes.push(now);
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const avgMs = intervals.reduce((s, x) => s + x, 0) / intervals.length;
      const bpm = Math.round(60000 / avgMs);
      if (bpm >= 30 && bpm <= 240) $('tempoInput').value = bpm;
    }
  });

  // ---------- Rail navigation (Upload / Play / Tuner) ----------

  function switchView(viewName) {
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    $('view-' + viewName).classList.remove('hidden');
    document.querySelectorAll('.rail-btn[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === viewName);
    });

    if (viewName !== 'tuner' && tuner) tuner.stop();
    if (viewName !== 'play') {
      stopScroll();
      stopFollow();
    }
  }

  $('railPlay').addEventListener('click', () => switchView('play'));
  $('railTuner').addEventListener('click', () => switchView('tuner'));
  $('railHistory').addEventListener('click', () => {
    switchView('history'); // finalizes any in-progress Analyze Me session first
    ensureSessionHistoryLoaded().then(renderHistoryView);
  });

  // ---------- History (static, read-only view of past Analyze Me sessions) ----------

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  // Bucket a line's problem ratio into a heat level. A line never rated by
  // Analyze Me is "unpracticed" rather than "clean" -- there's no evidence
  // either way, so it shouldn't read as a good sign.
  function heatBucket(cell) {
    if (!cell.timesSeen) return 'unpracticed';
    if (cell.ratio === 0) return 'clean';
    if (cell.ratio < 0.34) return 'low';
    if (cell.ratio < 0.67) return 'mid';
    return 'high';
  }

  // Trend sparkline (on-time% per recent session) plus a per-line trouble
  // heatmap, both scoped to one song and placed together in History --
  // the heatmap deliberately lives here, keyed to session data, rather
  // than as a persistent overlay on the Play chart.
  function renderSongProgress(title) {
    const trend = trendForSong(title, 10);
    const bars = trend
      .map((s) => {
        const pct = Math.max(0, Math.min(100, Math.round(s.onTimePct || 0)));
        const date = new Date(s.createdAt);
        const dateStr = isNaN(date.getTime()) ? '' : date.toLocaleDateString();
        const gradeClass = escapeHtml((s.grade || '—').toLowerCase());
        return `<div class="trend-bar grade-${gradeClass}" style="height:${Math.max(pct, 4)}%" title="${escapeHtml(dateStr)}: ${pct}% on-time (${escapeHtml(s.grade || '—')})"></div>`;
      })
      .join('');

    const heat = lineHeatForSong(title, flatLines.length);
    const cells = heat
      .map((cell, i) => {
        const bucket = heatBucket(cell);
        const label =
          bucket === 'unpracticed'
            ? `Line ${i + 1}: not yet practiced`
            : `Line ${i + 1}: rough in ${cell.timesProblem}/${cell.timesSeen} session${cell.timesSeen === 1 ? '' : 's'}`;
        return `<span class="heat-cell heat-${bucket}" title="${escapeHtml(label)}"></span>`;
      })
      .join('');

    return `<div class="history-progress">
      <h3>Progress on &ldquo;${escapeHtml(title)}&rdquo;</h3>
      <div class="trend-chart">${bars}</div>
      ${heat.length ? `<div class="heatmap-strip">${cells}</div>` : ''}
      <div class="heatmap-legend">
        <span class="heat-cell heat-clean"></span> clean
        <span class="heat-cell heat-low"></span> low
        <span class="heat-cell heat-mid"></span> medium
        <span class="heat-cell heat-high"></span> high
        <span class="heat-cell heat-unpracticed"></span> unpracticed
      </div>
    </div>`;
  }

  function renderHistoryView() {
    const container = $('historyContent');
    const history = sessionHistorySnapshot();
    if (!history.length) {
      container.innerHTML = '<p class="empty-hint">No Practice sessions recorded yet — run Practice, then Stop, to save your first grade.</p>';
      return;
    }

    let html = '';

    if (currentSong && currentSong.title) {
      const hasSongSessions = history.some((s) => s.songTitle === currentSong.title);
      if (hasSongSessions) {
        html += renderSongProgress(currentSong.title);
      }
    }

    html += '<h3>Session history</h3><ul class="history-sessions">';
    history.forEach((s) => {
      const date = new Date(s.createdAt);
      const dateStr = isNaN(date.getTime()) ? '' : date.toLocaleString();
      const problemLines = (s.lines || []).filter((l) => l.rating === 'off' || l.rating === 'miss');
      html += `<li class="history-session">
        <div class="history-session-head">
          <span class="grade-badge grade-${escapeHtml((s.grade || '—').toLowerCase())}">${escapeHtml(s.grade || '—')}</span>
          <span class="history-song-title">${escapeHtml(s.songTitle || 'Untitled')}</span>
          <span class="history-date">${escapeHtml(dateStr)}</span>
        </div>
        <div class="history-session-stats">
          <span>${s.count || 0} strums</span>
          <span>${Math.round(s.onTimePct || 0)}% on-time</span>
          <span>${Math.round(s.avgAbsMs || 0)} ms avg off</span>
        </div>
        ${
          problemLines.length
            ? `<div class="history-session-lines">${problemLines
                .map((l) => `<span class="rated-${l.rating}">${escapeHtml(l.text || '(blank line)')}</span>`)
                .join('')}</div>`
            : ''
        }
      </li>`;
    });
    html += '</ul>';

    container.innerHTML = html;
  }

  function openUploadPanel() {
    // Deliberately doesn't auto-focus the search box -- the song list is
    // already visible without typing anything, and focusing it would pop
    // the on-screen keyboard up over most of that list on a phone.
    $('uploadPanel').classList.remove('hidden');
  }
  function closeUploadPanel() {
    $('uploadPanel').classList.add('hidden');
  }
  $('railUpload').addEventListener('click', openUploadPanel);
  $('closeUploadBtn').addEventListener('click', closeUploadPanel);
  $('uploadPanel').addEventListener('click', (e) => {
    if (e.target.classList.contains('sheet-modal-backdrop')) closeUploadPanel();
  });

  // ---------- Tuner ----------

  // A live readout of what's actually reaching the analyser -- audioCtx
  // state, the mic track's own state, and its raw signal level -- so a
  // report of "the tuner isn't picking anything up" can be diagnosed from
  // what this line says instead of guessing blind at which stage failed
  // (permission never granted, context still suspended, a live but silent
  // track, or a real signal that just isn't being read as a clean pitch).
  let tunerDebugRafId = null;
  let tunerDebugBuf = null;
  function tunerDebugLoop() {
    if (!tunerRunning) return;
    if (analyser && !tunerDebugBuf) tunerDebugBuf = new Float32Array(analyser.fftSize);
    let rms = 0;
    if (analyser && tunerDebugBuf) {
      analyser.getFloatTimeDomainData(tunerDebugBuf);
      for (let i = 0; i < tunerDebugBuf.length; i++) rms += tunerDebugBuf[i] * tunerDebugBuf[i];
      rms = Math.sqrt(rms / tunerDebugBuf.length);
    }
    const track = micStream && micStream.getAudioTracks()[0];
    $('tunerDebug').textContent =
      `audio: ${audioCtx ? audioCtx.state : 'none'} | mic track: ${track ? `${track.readyState}${track.muted ? ' (muted)' : ''}` : 'none'} | level: ${rms.toFixed(4)}`;
    tunerDebugRafId = requestAnimationFrame(tunerDebugLoop);
  }

  let tunerRunning = false;
  $('tunerToggleBtn').addEventListener('click', async () => {
    if (tunerRunning) {
      tuner.stop();
      tunerRunning = false;
      if (tunerDebugRafId) cancelAnimationFrame(tunerDebugRafId);
      $('tunerDebug').innerHTML = '&nbsp;'; // keep the reserved line, just empty
      $('tunerToggleLabel').textContent = 'Start Tuner';
      return;
    }
    const ok = await ensureMic();
    if (!ok) return;
    tuner = tuner || new Tuner(audioCtx, analyser);
    tuner.onUpdate = (info) => {
      if (!info) {
        $('tunerNote').textContent = '—';
        $('tunerString').textContent = '';
        $('tunerNeedle').style.transform = 'translateX(-50%) rotate(0deg)';
        $('tunerNeedle').classList.remove('in-tune');
        $('tunerFlat').classList.remove('active');
        $('tunerSharp').classList.remove('active');
        return;
      }
      $('tunerNote').textContent = `${info.noteName}${info.octave}`;
      // sax-testing branch: the "nearest baritone string" hint doesn't mean
      // anything on a non-string instrument, and would be actively
      // misleading here (e.g. showing "G3" while a concert G4 plays) --
      // pitch detection itself is instrument-agnostic, so note name alone
      // is exactly what's needed to validate it against a real sax.
      $('tunerString').textContent = '';
      const angle = Math.max(-45, Math.min(45, info.cents * 0.9));
      $('tunerNeedle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
      const inTune = Math.abs(info.cents) <= 5;
      $('tunerNeedle').classList.toggle('in-tune', inTune);
      // Flat/sharp read off the same ±5-cent "in tune" band the needle
      // already uses, rather than a separate number to interpret.
      $('tunerFlat').classList.toggle('active', !inTune && info.cents < 0);
      $('tunerSharp').classList.toggle('active', !inTune && info.cents > 0);
    };
    tuner.start();
    tunerRunning = true;
    $('tunerToggleLabel').textContent = 'Stop Tuner';
    tunerDebugLoop();
  });

  // ---------- Key detection ----------

  $('detectKeyBtn').addEventListener('click', async () => {
    const ok = await ensureMic();
    if (!ok) return;
    keyDetector = keyDetector || new KeyDetector(audioCtx, analyser);
    const btn = $('detectKeyBtn');
    const progress = $('detectKeyProgress');
    btn.disabled = true;
    keyDetector.onProgress = (frac) => {
      progress.textContent = `${Math.round(frac * 100)}%`;
    };
    const result = await keyDetector.start(6);
    btn.disabled = false;
    progress.textContent = '';
    if (result) {
      $('keyDisplay').textContent = result.key;
      if (currentSong) currentSong.key = result.key;
    } else {
      showMicError("Couldn't detect a key — try playing/strumming more during the 6 seconds.");
    }
  });

  // ---------- Loading UI ----------

  // fromQueue: true when this load is the active playlist queue's own
  // advance/prev/next navigating -- everything else (picking a song by
  // hand, pasting, uploading) ends that queue, see loadSong().
  function loadByTitle(title, fromQueue) {
    const songs = allAvailableSongs();
    if (songs[title]) {
      loadSong(songs[title], fromQueue, title);
      return true;
    }
    return false;
  }

  // ---------- Song library: browse/search list + playlists ----------
  //
  // Always-visible (not popup-on-focus) so there's a way to see everything
  // available without typing anything -- a plain <input list>/<datalist>
  // (and, before that, a focus-triggered custom dropdown) both left iOS
  // Safari with no obvious way to just browse. Filtered live by the search
  // box and, when a playlist chip is selected, sorted with that playlist's
  // members first; a playlist's own "Play playlist" starts a sequenced
  // practice session that auto-advances through it (see handleSongEnd).

  let playlists = [];
  let activePlaylistId = ''; // '' = the "All Songs" chip
  let activeQueue = null; // { songs: [title, ...], index, name } while a playlist is playing sequenced

  function currentPlaylist() {
    return playlists.find((p) => p.id === activePlaylistId) || null;
  }

  function filterSongTitles(query) {
    const q = query.trim().toLowerCase();
    const list = q ? songTitles.filter((t) => t.toLowerCase().includes(q)) : songTitles.slice();
    const pl = currentPlaylist();
    if (pl) {
      const members = new Set(pl.songs);
      list.sort((a, b) => (members.has(a) === members.has(b) ? 0 : members.has(a) ? -1 : 1));
    }
    return list;
  }

  function renderSongList() {
    const list = $('songList');
    const matches = filterSongTitles($('songSearch').value);
    const pl = currentPlaylist();
    if (!matches.length) {
      list.innerHTML = '<li class="song-list-empty">No matching songs</li>';
      return;
    }
    list.innerHTML = matches
      .map((title) => {
        const esc = escapeHtml(title);
        let toggle = '';
        if (pl) {
          const inPlaylist = pl.songs.includes(title);
          toggle = `<button type="button" class="song-list-item-toggle${inPlaylist ? ' in-playlist' : ''}" data-title="${esc}" title="${inPlaylist ? 'Remove from' : 'Add to'} ${escapeHtml(pl.name)}">${inPlaylist ? '✓' : '+'}</button>`;
        }
        return `<li class="song-list-item" role="option" data-title="${esc}"><span class="song-list-item-title">${esc}</span>${toggle}</li>`;
      })
      .join('');
  }

  function selectSongTitle(title) {
    loadByTitle(title);
    $('songSearch').value = '';
    renderSongList();
  }

  $('songSearch').addEventListener('input', renderSongList);
  $('songSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const matches = filterSongTitles($('songSearch').value);
      if (matches.length) selectSongTitle(matches[0]);
    }
  });
  $('songList').addEventListener('click', (e) => {
    const toggle = e.target.closest('.song-list-item-toggle');
    if (toggle) {
      e.stopPropagation();
      toggleSongInPlaylist(toggle.dataset.title);
      return;
    }
    const item = e.target.closest('.song-list-item');
    if (item && item.dataset.title) selectSongTitle(item.dataset.title);
  });

  function toggleSongInPlaylist(title) {
    const pl = currentPlaylist();
    if (!pl) return;
    const idx = pl.songs.indexOf(title);
    if (idx >= 0) pl.songs.splice(idx, 1);
    else pl.songs.push(title);
    savePlaylist(pl.id, pl.name, pl.songs);
    renderSongList();
  }

  function refreshPlaylists() {
    playlists = allPlaylists();
    renderPlaylistChips();
    renderSongList();
  }

  function renderPlaylistChips() {
    const chips = [
      `<button class="playlist-chip${activePlaylistId === '' ? ' active' : ''}" type="button" data-playlist-id="" role="tab" aria-selected="${activePlaylistId === '' ? 'true' : 'false'}">All Songs</button>`,
    ];
    playlists.forEach((p) => {
      const active = activePlaylistId === p.id;
      chips.push(`<button class="playlist-chip${active ? ' active' : ''}" type="button" data-playlist-id="${escapeHtml(p.id)}" role="tab" aria-selected="${active ? 'true' : 'false'}">${escapeHtml(p.name)}</button>`);
    });
    chips.push('<button id="newPlaylistBtn" class="playlist-chip playlist-chip-new" type="button">+ New playlist</button>');
    $('playlistBar').innerHTML = chips.join('');
    $('playlistActions').classList.toggle('hidden', activePlaylistId === '');
  }

  function selectPlaylist(id) {
    activePlaylistId = id;
    renderPlaylistChips();
    renderSongList();
  }

  // Delegated on the container, not the buttons -- renderPlaylistChips()
  // replaces the chip buttons' innerHTML on every playlist change, which
  // would silently drop a listener bound directly to any one of them.
  $('playlistBar').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'newPlaylistBtn') {
      const name = (window.prompt('Name this playlist:') || '').trim();
      if (!name) return;
      const id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      playlists.push({ id, name, songs: [] });
      savePlaylist(id, name, []);
      selectPlaylist(id);
      return;
    }
    selectPlaylist(btn.dataset.playlistId || '');
  });

  $('renamePlaylistBtn').addEventListener('click', () => {
    const pl = currentPlaylist();
    if (!pl) return;
    const name = (window.prompt('Rename playlist:', pl.name) || '').trim();
    if (!name) return;
    pl.name = name;
    savePlaylist(pl.id, name, pl.songs);
    renderPlaylistChips();
  });

  $('deletePlaylistBtn').addEventListener('click', () => {
    const pl = currentPlaylist();
    if (!pl) return;
    if (!window.confirm(`Delete playlist "${pl.name}"? This won't delete the songs themselves.`)) return;
    deletePlaylist(pl.id);
    playlists = playlists.filter((p) => p.id !== pl.id);
    if (activeQueue && activeQueue.name === pl.name) {
      activeQueue = null;
      updateQueueStatus();
    }
    selectPlaylist('');
  });

  $('playPlaylistBtn').addEventListener('click', () => {
    const pl = currentPlaylist();
    if (!pl || !pl.songs.length) return;
    activeQueue = { songs: pl.songs.slice(), index: 0, name: pl.name };
    updateQueueStatus();
    loadByTitle(activeQueue.songs[0], true);
  });

  // ---------- Playlist queue: sequenced practice session ----------
  // A "Play playlist" session auto-advances to the next song once the
  // current one reaches its natural end (see handleSongEnd, called from
  // highlightLoop's/advanceFollowLine's own natural-end branches) --
  // never on a manual Stop, which is the player choosing to end things.

  function updateQueueStatus() {
    const bar = $('queueStatus');
    if (!activeQueue) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    $('queueStatusText').textContent = `${activeQueue.name} (${activeQueue.index + 1}/${activeQueue.songs.length})`;
    $('queuePrevBtn').disabled = activeQueue.index <= 0;
    $('queueNextBtn').disabled = activeQueue.index >= activeQueue.songs.length - 1;
  }

  function goToQueueIndex(newIndex) {
    if (!activeQueue || newIndex < 0 || newIndex >= activeQueue.songs.length) return;
    activeQueue.index = newIndex;
    loadByTitle(activeQueue.songs[newIndex], true);
    updateQueueStatus();
  }

  $('queuePrevBtn').addEventListener('click', () => activeQueue && goToQueueIndex(activeQueue.index - 1));
  $('queueNextBtn').addEventListener('click', () => activeQueue && goToQueueIndex(activeQueue.index + 1));
  $('queueExitBtn').addEventListener('click', () => {
    activeQueue = null;
    updateQueueStatus();
  });

  // Called when a song reaches its natural end (not a manual Stop) in
  // whichever mode was running. Advances the queue and resumes the same
  // mode on the next song, or just clears the (now-finished) queue.
  function handleSongEnd(mode) {
    if (!activeQueue || activeQueue.index >= activeQueue.songs.length - 1) {
      if (activeQueue) {
        activeQueue = null;
        updateQueueStatus();
      }
      return;
    }
    activeQueue.index++;
    loadByTitle(activeQueue.songs[activeQueue.index], true);
    updateQueueStatus();
    if (mode === 'metronome') startScroll(false);
    else if (mode === 'analyze') startScroll(true);
    else if (mode === 'follow') startFollow();
  }

  $('togglePasteBtn').addEventListener('click', () => {
    $('pasteArea').classList.toggle('hidden');
  });

  $('loadPastedBtn').addEventListener('click', () => {
    const text = $('pasteText').value.trim();
    if (!text) return;

    // An iReal Pro link pasted in here isn't ChordPro text -- convert it
    // first and land the result back in this same box for a look before
    // Load, same "never load a converted chart silently" rule as PDF/Word.
    if (isIRealText(text)) {
      try {
        $('pasteText').value = convertIRealToChordPro(text);
        setImportStatus('Converted from iReal Pro — review before Load (bars-only, no lyrics; placement is best-effort).');
      } catch (err) {
        setImportStatus('');
        showError(`Couldn't convert that iReal Pro link: ${err.message || err}`, 9000);
      }
      return;
    }

    loadSong(text);
    $('pasteText').value = '';
    $('pasteArea').classList.add('hidden');
    setImportStatus('');
  });

  function setImportStatus(msg) {
    const el = $('importStatus');
    if (!msg) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  $('chordproFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();

    if (name.endsWith('.pdf') || name.endsWith('.docx') || name.endsWith('.doc')) {
      setImportStatus(`Converting ${file.name}…`);
      try {
        const converted = await importLeadSheetFile(file);
        $('pasteText').value = converted;
        $('pasteArea').classList.remove('hidden');
        setImportStatus(`Converted from ${file.name} — review before Load (placement is best-effort).`);
        $('pasteText').focus();
      } catch (err) {
        setImportStatus('');
        showError(`Couldn't convert ${file.name}: ${err.message || err}`, 9000);
      }
      e.target.value = '';
      return;
    }

    // MusicXML has real note/rhythm data, loaded as-authored (see
    // loadNotatedSong) rather than run through the lossy chord-chart
    // reconstruction PDF/Word get -- so unlike those, there's no
    // review-before-load step here.
    if (name.endsWith('.musicxml') || name.endsWith('.xml')) {
      try {
        const text = await file.text();
        const titleMatch = text.match(/<movement-title>([^<]*)<\/movement-title>/) || text.match(/<work-title>([^<]*)<\/work-title>/);
        const title = (titleMatch && titleMatch[1].trim()) || deriveTitleFromFilename(file.name);
        loadSong(MUSICXML_TEXT_PREFIX + text, false, title);
      } catch (err) {
        showError(`Couldn't read ${file.name}: ${err.message || err}`, 9000);
      }
      e.target.value = '';
      return;
    }
    if (name.endsWith('.mxl')) {
      try {
        const buf = await file.arrayBuffer();
        loadSong(MUSICXML_B64_PREFIX + arrayBufferToBase64(buf), false, deriveTitleFromFilename(file.name));
      } catch (err) {
        showError(`Couldn't read ${file.name}: ${err.message || err}`, 9000);
      }
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      // iReal Pro exports are usually shared as a .html or .txt file
      // wrapping the irealb://... link -- content-sniffed here rather than
      // by extension, since that link can show up in either. Converted and
      // shown for review, same as PDF/Word, never loaded straight in.
      if (isIRealText(text)) {
        try {
          $('pasteText').value = convertIRealToChordPro(text);
          $('pasteArea').classList.remove('hidden');
          setImportStatus(`Converted from ${file.name} — review before Load (bars-only, no lyrics; placement is best-effort).`);
          $('pasteText').focus();
        } catch (err) {
          setImportStatus('');
          showError(`Couldn't convert ${file.name}: ${err.message || err}`, 9000);
        }
        return;
      }
      loadSong(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Demos are available instantly; the saved-song library and playlists
  // (Supabase, or localStorage if not configured) load asynchronously and
  // refresh the browsable list once they're in, rather than blocking on it.
  refreshSongTitles();
  ensureSongLibraryLoaded().then(refreshSongTitles);
  ensurePlaylistsLoaded().then(refreshPlaylists);
  ensureSessionHistoryLoaded();
})();
