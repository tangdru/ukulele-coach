# Baritone Uke Coach

A browser-based practice companion for baritone ukulele (tuned D G B E, the
same as a guitar's top 4 strings). No build step, no framework, no account —
open `index.html` (served, not `file://`, so the microphone works) and go.

**Live:** `https://tangdru.github.io/ukulele-coach/`

## Layout

The screen is the chart — nothing else competes for space. A thin top bar
carries song title / key / tempo; a left icon rail (**Upload**, **Play**,
**Tuner**, **History**) is the only navigation. Tapping **Upload** opens a
sheet over the chart to load a song; it closes itself the moment a song
loads.
There's no standing explainer text in the UI by design — the paragraphs
below are the explanations, kept in this README instead of on screen.

## What it does

- **Song chart** — paste or upload a [ChordPro](https://www.chordpro.org/chordpro/chordpro-introduction/)-style
  chord chart, upload a PDF or Word (.docx) lead sheet, or search/pick a
  previously loaded song (see Song library below). Chords render above
  the lyrics; tap any chord to see its fingering. Long lines scroll
  horizontally within the chart rather than wrapping (wrapping would
  break chord-to-lyric column alignment) or getting clipped.
- **Song library, shared across devices** — every song you paste or
  upload gets saved to a [Supabase](https://supabase.com) table
  (`uke_songs`, see `config.js`) under its title, so next time — on this
  device or any other — it's just a search-and-select in the Upload sheet
  instead of uploading or pasting again. The search box is a native
  `<input list>` / `<datalist>` combo: type to filter, matching both the
  two bundled demos and everything saved. There's no login, so like the
  Supabase table this shares its project with (see
  [tangdru/familytree](https://github.com/tangdru/familytree)'s README
  for the pattern this follows), **anyone with the site link can see, add,
  or overwrite songs by title** — fine for chord charts, not a place to
  put anything sensitive. If `config.js` is left blank or Supabase is
  unreachable, it falls back to this browser's local storage only (same
  behavior, just private to this device, and the database attempt is
  capped at 4 seconds so an unreachable database doesn't stall loading).
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
- **Three equal-weight play modes** (Play view, above the chart):
  - **▶ Metronome** — a Web-Audio-scheduled metronome at the song's tempo,
    auto-scrolling/highlighting the chart line by line on that fixed
    clock, whether or not you're actually keeping up. Also highlights the
    specific chord the clock says should be playing right now within that
    line (holding on a chord across several beats until the next one is
    due, rather than needing exactly one chord per beat).
  - **🎤 Follow Me** — listens through the mic (onset/strum detection) and
    only advances to the next line once it's heard enough strums to match
    that line's beat count, so the chart genuinely tracks your pace
    instead of assuming you're locked to the tempo dial. Highlights the
    chord your strums say you're currently on, advancing only in response
    to real detected playing — it stays put through silence, never on a
    clock of its own.
  - **🎯 Analyze Me** — runs the metronome (needed as the timing reference)
    *and* listens, scoring each strum against the nearest beat and
    marking it directly on the chart: a colored left border on the line
    that was playing (the worst rating heard on it, so a rough spot isn't
    overwritten by a later clean hit) and a colored mark under the
    specific chord that strum lines up with (matching strum order to
    chord order within the line). A compact on-time% / avg-ms-off / strum
    count row tracks the running session. Marks stay on the chart after
    Stop so you can review the whole run; a fresh Analyze Me run or a new
    song load clears them. Also highlights, same as Metronome mode, the
    chord the fixed clock says you should be playing right now — so a
    glance shows both *what to play next* and *how the last few chords
    actually went*, at once.
- **Practice history, graded** — every Analyze Me run you finish (Stop,
  switching modes, loading a new song, or letting it run to the end of the
  chart all count as "finishing") is graded A–F from its on-time
  percentage and saved to the **History** rail view — a static, read-only
  list, not something that updates live while you're looking at it. Each
  entry shows the grade, song, date, and the specific lines that were off
  or missed that run; when the currently loaded song has history, the top
  of the view also shows which lines have been flagged across the *most*
  past sessions for that song — the parts actually worth spending practice
  time on, not just this run's rough patch. Saved the same way as the song
  library (`uke_sessions` table, see `config.js`; falls back to local
  storage if Supabase isn't configured or reachable).

  Tap any line to jump there in any mode; auto-scroll can be toggled off
  if you just want the beat/line tracking without the page moving under
  you. It scrolls both ways — vertically to keep the active line centered,
  and horizontally to keep the current playhead chord in view on a line
  too wide for the screen, rather than just centering the line and leaving
  later chords on it off past the edge. Follow Me and Analyze Me don't
  combine — Analyze Me needs the metronome's fixed clock to score against,
  which is exactly what Follow Me deliberately doesn't run.
- **Tuner** — continuous pitch detection (autocorrelation) with a note name,
  cents-off needle, and nearest-open-string hint (D3/G3/B3/E4). It picks up
  any clear pitch in range, not just a baritone uke specifically — a pitch
  detector can't tell a plucked string from a sung note at the same pitch,
  nothing short of a real instrument-timbre classifier can, so this
  doesn't try to filter by source. The cents reading is smoothed (eased
  toward each new reading rather than jumping straight to it, snapping
  instantly on an actual note change) so the needle settles instead of
  jittering frame-to-frame.
- **Key** — read from the chart's `{key: ...}` directive, or tap the 🔑
  icon in the top bar to listen for 6 seconds and estimate the key via a
  chroma histogram + Krumhansl-Schmuckler key-profile correlation.

Follow Me's and Analyze Me's onset counting have the same practical
limits: they're listening for a strum/pick attack loud and sharp enough
to stand out from the recent average level, not specifically a baritone
uke, so they can pick up other sharp sounds too, and a very soft or
sustained strum might not register as a distinct onset. Both assume one
detected onset per beat, which matches strumming a chord once per beat
but not other rhythms (fingerpicking multiple notes per beat, sustained
whole-line chords, etc.). The mic is requested with echo cancellation,
noise suppression, and auto-gain control all explicitly turned off —
browser defaults enable all three for voice calls, and they can damp a
strum's sharp attack (or let auto-gain-boosted room noise drift into
false onsets) enough to make onset detection feel disconnected from
actual playing.

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

Plain HTML/JS/CSS, no build step. `vendor/` has three locally-hosted
libraries (not loaded from a CDN, so the app doesn't depend on one being
reachable): [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) for
reading PDF text, [mammoth.js](https://github.com/mwilliamson/mammoth.js)
(BSD-2-Clause) for reading .docx text, and
[supabase-js](https://github.com/supabase/supabase-js) (MIT) for the song
library's database.

## Testing

`smoke_test.mjs`, `smoke_test_mic.mjs`, `smoke_test_import.mjs`,
`smoke_test_tuner.mjs`, `smoke_test_follow.mjs`, `smoke_test_scoring.mjs`,
`smoke_test_library.mjs`, `smoke_test_history.mjs`, `smoke_test_playhead.mjs`,
and `smoke_test_hscroll.mjs` are Playwright scripts (not part of the
served app) that load the page in headless Chromium and click through
song loading, the rail/upload-sheet navigation, chord diagrams, all three
play modes, and PDF/Word lead sheet import. Several go a step further
than "does it start without errors", by checking the actual *behavior*:
`smoke_test_tuner.mjs` (via `gen_test_tone.mjs`, a small dependency-free
WAV writer) feeds a real synthesized tone through Chromium's fake audio
device and asserts the tuner stably identifies it with a smooth cents
reading; `smoke_test_follow.mjs` (via `gen_strum_wav.mjs`) feeds
synthesized strum bursts at a tempo that a clock-based scroll couldn't
possibly keep up with, and asserts Follow Me still lands on the correct
line purely by counting them; `smoke_test_scoring.mjs` feeds strums
during Analyze Me and asserts real timing hits reach the DOM as rated-*
marks on the correct line and chord, that they survive Stop, and that a
new song load clears them; `smoke_test_library.mjs` pastes a song, does a
real full page reload (not just in-page navigation), and asserts the
song is still there in the search list and loadable by name;
`smoke_test_history.mjs` runs a sloppy-timing Analyze Me session, stops
it, and asserts a graded entry with the specific off/missed lines shows
up in the History view, survives a real reload, and a second run adds a
second entry rather than replacing the first; `smoke_test_playhead.mjs`
checks the current-chord playhead: it advances on the clock alone in
Metronome mode, it never advances through several seconds of true
silence in Follow Me (this is the direct regression test for "Follow Me
just plays through like Metronome" -- it feeds a mostly-silent WAV and
asserts the highlighted chord and active line never move), and it does
advance once real strum bursts land; `smoke_test_hscroll.mjs` checks
that auto-scroll follows the playhead chord horizontally on a line too
wide for the viewport, and that it does neither axis of scrolling with
Auto-scroll unchecked -- in this
project's own CI/sandbox, Supabase is unreachable, so the library/history
tests specifically exercise the localStorage fallback path
(`test_helpers.mjs` filters those expected network failures out of each
test's error checks; see its comments). Run a static server first, then:

```
node smoke_test.mjs
node smoke_test_mic.mjs
node smoke_test_tuner.mjs
node smoke_test_follow.mjs
node smoke_test_scoring.mjs
node smoke_test_library.mjs
node smoke_test_history.mjs
node smoke_test_playhead.mjs
node smoke_test_hscroll.mjs
node smoke_test_import.mjs   # uses the committed sample_leadsheet.pdf/.docx fixtures
```
