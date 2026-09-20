# Baritone Uke Coach

A browser-based practice companion for baritone ukulele (tuned D G B E, the
same as a guitar's top 4 strings). No build step, no framework, no account —
open `index.html` (served, not `file://`, so the microphone works) and go.

**Live:** `https://tangdru.github.io/ukulele-coach/`

## What it does

- **Song chart** — paste or upload a [ChordPro](https://www.chordpro.org/chordpro/chordpro-introduction/)-style
  chord chart, upload a PDF or Word (.docx) lead sheet, or pick one of two
  bundled demo songs (Amazing Grace, You Are My Sunshine). Chords render
  above the lyrics; tap any chord to see its fingering.
- **PDF/Word lead sheet import** — reconstructs the chord-above-lyric
  layout from the file's text positions (PDF) or paragraph order (Word),
  detects lines that are made up entirely of chord symbols, and merges
  each onto the lyric line below it as inline ChordPro chords. This is a
  heuristic, not exact, so the result is shown in the paste box for you to
  check and fix before loading — see limitations below.
- **Baritone chord diagrams** — fingerings are *computed*, not hand-typed:
  each chord symbol is parsed into a root + interval set, and the app
  searches fret positions on the D/G/B/E strings for a valid voicing
  containing the chord's root, third (or sus tone), and — for 7th/6th
  chords — the defining 4th tone. This avoids the common mistake of reusing
  guitar chord shapes as-is, which can silently drop the root when it lived
  on the low E/A strings a baritone doesn't have.
- **Scrolling view, two ways** — **Play (metronome)** starts a Web-Audio-
  scheduled metronome at the song's tempo and auto-scrolls/highlights the
  chart line by line on that fixed clock, whether or not you're actually
  keeping up. **Follow My Playing** instead listens through the mic (the
  same onset/strum detection the Rhythm Coach uses) and only advances to
  the next line once it's heard enough strums to match that line's beat
  count — so the chart genuinely tracks your pace rather than assuming
  you're locked to the tempo dial. Tap any line to jump there in either
  mode; auto-scroll can be toggled off if you just want the beat/line
  tracking without the page moving under you.
- **Tuner** — continuous pitch detection (autocorrelation) with a note name,
  cents-off needle, and nearest-open-string hint (D3/G3/B3/E4). It picks up
  any clear pitch in range, not just a baritone uke specifically — a pitch
  detector can't tell a plucked string from a sung note at the same pitch,
  nothing short of a real instrument-timbre classifier can, so this
  doesn't try to filter by source. The cents reading is smoothed (eased
  toward each new reading rather than jumping straight to it, snapping
  instantly on an actual note change) so the needle settles instead of
  jittering frame-to-frame.
- **Key** — read from the chart's `{key: ...}` directive, or tap "Detect
  from mic" to listen for 6 seconds and estimate the key via a chroma
  histogram + Krumhansl-Schmuckler key-profile correlation.
- **Rhythm Coach** — starts the metronome and listens for your strums
  (energy-flux onset detection), scoring each one against the nearest beat
  (perfect / good / off / miss) with a running on-time % and average timing
  error.
- **Score my timing, on the chart itself** — check this box alongside
  **Play (metronome)** and each timing hit gets mapped onto the actual
  song: a colored left border on the line that was playing when it
  happened (the worst rating heard on that line, so a rough spot doesn't
  get overwritten by a later clean one), and a colored mark under the
  specific chord that hit lines up with (matching onset order within the
  line to chord order — so with one strum per chord, the mark lands on
  the actual chord you were slow/early/on-time on). Marks stay on the
  chart after Stop so you can look back over the whole run; a fresh
  scored Play or loading a different song clears them. (Score my timing
  needs a real clock to compare against, which is what Play (metronome)
  provides — Follow My Playing has no fixed clock to score against, so
  the two don't combine.)

Follow My Playing's onset counting has the same practical limits as
Rhythm Coach's: it's listening for a strum/pick attack loud and sharp
enough to stand out from the recent average level, not specifically a
baritone uke, so it can pick up other sharp sounds too, and a very soft
or sustained strum might not register as a distinct onset. It assumes
one detected onset per beat, which matches strumming a chord once per
beat but not other rhythms (fingerpicking multiple notes per beat,
sustained whole-line chords, etc.).

## What it deliberately doesn't do

- **No "name a song and it finds the chords" lookup.** That needs an
  external song/chord database (or real audio fingerprinting, Shazam-style)
  this app doesn't have access to. Bring your own ChordPro chart, PDF, or
  Word lead sheet instead.
- **No pitch-accuracy grading** ("was that the right note"), only *timing*
  feedback — matching played notes to expected pitches would need the chart
  to encode a full melody/tab, not just chords+lyrics.

### PDF/Word import limitations

- Needs a real text layer — a **scanned or image-only PDF has no text to
  read** and will be rejected. (A "Print to PDF" or Word-exported PDF has a
  text layer; a photographed/scanned chart doesn't, short of adding OCR,
  which isn't in scope here.)
- Only **.docx** is supported, not the old binary **.doc** format — re-save
  from Word as .docx first.
- Chord/lyric alignment is column-position guesswork: it works well for
  the common "one line of chords directly above one line of lyrics"
  layout, less well for chords inside a table, multi-column layouts, or
  chords wrapped mid-word. That's why the converted result lands in the
  paste box instead of loading straight away — check it, nudge a `[Chord]`
  left or right if it landed mid-word, fill in Key/Tempo (not extracted),
  then Load.

## Format for your own songs

Plain text, ChordPro-flavored:

```
{title: Song Name}
{artist: Someone}
{key: G}
{tempo: 96}
{time: 4/4}

[G]Some lyrics [D]with chords [Em]inline
{start_of_chorus}
More [C]lyrics [G]here
{end_of_chorus}
```

Blank lines start a new section. Unrecognized `{directives}` are ignored
rather than rejected, so a real-world ChordPro file mostly still works even
if it uses features (tabs, capo, etc.) this app doesn't render.

## Running it

Needs a real HTTP server (mic access requires a secure context — `file://`
won't work):

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Built with

Plain HTML/JS/CSS, no build step. `vendor/` has two locally-hosted
libraries (not loaded from a CDN, so the app doesn't depend on one being
reachable): [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) for
reading PDF text, and [mammoth.js](https://github.com/mwilliamson/mammoth.js)
(BSD-2-Clause) for reading .docx text.

## Testing

`smoke_test.mjs`, `smoke_test_mic.mjs`, `smoke_test_import.mjs`,
`smoke_test_tuner.mjs`, `smoke_test_follow.mjs`, and `smoke_test_scoring.mjs`
are Playwright scripts (not part of the served app) that load the page in
headless Chromium and click through song loading, chord diagrams,
scrolling playback, the mic-gated tuner/rhythm-coach/key-detect flows
(using Chromium's fake audio device), and PDF/Word lead sheet import.
Three of them go a step further than "does it start without errors", by
feeding the fake audio device real synthesized audio and checking the
*behavior* it should produce: `smoke_test_tuner.mjs` (via
`gen_test_tone.mjs`, a small dependency-free WAV writer) asserts the
tuner stably identifies a clean tone with a smooth cents reading;
`smoke_test_follow.mjs` (via `gen_strum_wav.mjs`) feeds a set number of
synthesized strum bursts at a tempo that a clock-based scroll couldn't
possibly keep up with, and asserts Follow My Playing still lands on the
correct line purely by counting them; `smoke_test_scoring.mjs` feeds
strums during a scored Play and asserts real timing hits reach the DOM
as rated-* marks on the correct line and chord, that they survive Stop,
and that a new song load clears them. Run a static server first, then:

```
node smoke_test.mjs
node smoke_test_mic.mjs
node smoke_test_tuner.mjs
node smoke_test_follow.mjs
node smoke_test_scoring.mjs
node smoke_test_import.mjs   # uses the committed sample_leadsheet.pdf/.docx fixtures
```
