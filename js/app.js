(function () {
  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let micSource = null;

  let currentSong = null;
  let metronome = null;
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
  const showMicError = showError;

  async function ensureMic() {
    if (micStream) return true;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    if (!metronome) metronome = new Metronome(audioCtx);
    return metronome;
  }

  // ---------- Song loading & rendering ----------

  function populateSongDatalist() {
    const list = $('songDatalist');
    list.innerHTML = '';
    Object.keys(allAvailableSongs()).forEach((title) => {
      const opt = document.createElement('option');
      opt.value = title;
      list.appendChild(opt);
    });
  }

  function loadSong(chordproText) {
    // Finalize/save any in-progress Analyze Me session against the *old*
    // song before its chart lines are replaced -- stopScroll() (called
    // here) is what records session history, and it needs the outgoing
    // song's flatLines/ratings still in place to do that.
    stopScroll();
    stopFollow();

    const song = parseChordPro(chordproText);
    currentSong = song;
    renderSong(song);
    $('songTitle').textContent = song.title || 'Untitled';
    $('songTitle').title = [song.title, song.artist].filter(Boolean).join(' — ');
    $('keyDisplay').textContent = song.key || '—';
    $('timeSigDisplay').textContent = song.timeSig || '4/4';
    if (song.tempo) $('tempoInput').value = song.tempo;
    clearTimingMarks();

    if (song.title) {
      saveSongToLibrary(song.title, chordproText);
      populateSongDatalist();
    }
    closeUploadPanel();
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
        const lineEl = document.createElement('div');
        lineEl.className = 'song-line';
        lineEl.dataset.index = String(idx);

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
        lineEl.addEventListener('click', () => jumpToLine(idx));
        view.appendChild(lineEl);

        flatLines.push(lineEl);
        idx++;
      });
    });

    if (!flatLines.length) {
      view.innerHTML = '<p class="empty-hint">This song has no lines to show.</p>';
    }
  }

  function showChordDiagram(sym) {
    const modal = $('chordModal');
    const content = $('chordModalContent');
    renderChordDiagram(content, sym);
    modal.classList.remove('hidden');
  }

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
    } else {
      ensureMetronome();
      if (rhythmCoach) rhythmCoach.stop();
      $('analyzeStats').classList.add('hidden');
      analyzeActive = false;
    }

    const bpm = parseInt($('tempoInput').value, 10) || 90;
    const secondsPerLine = (beatsPerLine() * 60) / bpm;

    metronome.start(bpm, beatsPerLine());
    if (scoring) {
      rhythmCoach.start();
      rhythmStatsLoop();
    }

    scrollStartTime = audioCtx.currentTime + 0.1;
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

  function highlightLoop() {
    if (!scrollActive) return;
    const now = audioCtx.currentTime;
    let idx = activeLineIndex;
    while (idx + 1 < lineStartTimes.length && lineStartTimes[idx + 1] <= now) idx++;
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
    if (idx >= lineStartTimes.length - 1 && now > lineStartTimes[lineStartTimes.length - 1] + 2) {
      stopScroll();
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
    followScroll.onOnset = (count, total) => updateFollowStatus(count, total);
    followScroll.onAdvance = advanceFollowLine;

    flatLines.forEach((el) => el.classList.remove('active-line'));
    activeLineIndex = 0;
    if (flatLines[0]) flatLines[0].classList.add('active-line');
    updateFollowStatus(0, beatsPerLine());

    followScroll.start();
    followActive = true;
    setActiveMode('follow');
  }

  function advanceFollowLine() {
    const nextIdx = activeLineIndex + 1;
    if (nextIdx >= flatLines.length) {
      stopFollow();
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
  }

  function stopFollow() {
    if (followScroll) followScroll.stop();
    followActive = false;
    $('followStatus').classList.add('hidden');
    flatLines.forEach((el) => el.classList.remove('active-line'));
    activeLineIndex = -1;
    setActiveMode(null);
  }

  $('modeMetronomeBtn').addEventListener('click', () => startScroll(false));
  $('modeFollowBtn').addEventListener('click', startFollow);
  $('modeAnalyzeBtn').addEventListener('click', () => startScroll(true));
  $('stopBtn').addEventListener('click', () => {
    stopScroll();
    stopFollow();
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

  function renderHistoryView() {
    const container = $('historyContent');
    const history = sessionHistorySnapshot();
    if (!history.length) {
      container.innerHTML = '<p class="empty-hint">No Analyze Me sessions recorded yet — run Analyze Me, then Stop, to save your first grade.</p>';
      return;
    }

    let html = '';

    if (currentSong && currentSong.title) {
      const problems = problemLinesForSong(currentSong.title, 5);
      if (problems.length) {
        html += `<div class="history-problems">
          <h3>Trouble spots in &ldquo;${escapeHtml(currentSong.title)}&rdquo;</h3>
          <ol>${problems
            .map(
              (p) =>
                `<li>${escapeHtml(p.text || '(blank line)')} <span class="problem-count">flagged in ${p.sessionsFlagged} session${p.sessionsFlagged === 1 ? '' : 's'}</span></li>`
            )
            .join('')}</ol>
        </div>`;
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
    $('uploadPanel').classList.remove('hidden');
    $('songSearch').focus();
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

  let tunerRunning = false;
  $('tunerToggleBtn').addEventListener('click', async () => {
    if (tunerRunning) {
      tuner.stop();
      tunerRunning = false;
      $('tunerToggleLabel').textContent = 'Start Tuner';
      return;
    }
    const ok = await ensureMic();
    if (!ok) return;
    tuner = tuner || new Tuner(audioCtx, analyser);
    tuner.onUpdate = (info) => {
      if (!info) {
        $('tunerNote').textContent = '—';
        $('tunerCents').textContent = '';
        $('tunerString').textContent = '';
        $('tunerNeedle').style.transform = 'translateX(-50%) rotate(0deg)';
        return;
      }
      $('tunerNote').textContent = `${info.noteName}${info.octave}`;
      $('tunerCents').textContent = (info.cents > 0 ? '+' : '') + info.cents + ' cents';
      $('tunerString').textContent = `Nearest baritone string: ${info.nearestString.name}`;
      const angle = Math.max(-45, Math.min(45, info.cents * 0.9));
      $('tunerNeedle').style.transform = `translateX(-50%) rotate(${angle}deg)`;
      $('tunerNeedle').classList.toggle('in-tune', Math.abs(info.cents) <= 5);
    };
    tuner.start();
    tunerRunning = true;
    $('tunerToggleLabel').textContent = 'Stop Tuner';
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

  function loadByTitle(title) {
    const songs = allAvailableSongs();
    if (songs[title]) {
      loadSong(songs[title]);
      return true;
    }
    return false;
  }

  $('songSearch').addEventListener('change', (e) => {
    if (loadByTitle(e.target.value.trim())) e.target.value = '';
  });
  $('songSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && loadByTitle(e.target.value.trim())) e.target.value = '';
  });

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

  // Demos are available instantly; the saved-song library (Supabase, or
  // localStorage if not configured) loads asynchronously and re-populates
  // the datalist once it's in, rather than blocking on it.
  populateSongDatalist();
  ensureSongLibraryLoaded().then(populateSongDatalist);
  ensureSessionHistoryLoaded();
})();
