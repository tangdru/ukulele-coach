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
- **iReal Pro import** — paste an iReal Pro chord chart link
  (`irealb://…` / `irealbook://…`) into the paste box, or upload the
  `.html`/`.txt` file iReal Pro's Share sheet produces, and it's decoded
  into the same ChordPro-ish text everything else here understands —
  chord qualities (`^`, `-`, `o`, `ø`/`h`, `+`, altered extensions),
  section markers, and 1st/2nd endings all translate over. iReal Pro
  charts are bars of changes with **no lyrics at all**, a genuinely
  different shape than this app's chord-over-lyric charts, so each bar
  renders as `[Chord]|` — the barline stands in for the lyric line a
  chord would otherwise be anchored to. Like PDF/Word import, the result
  lands in the paste box for a look before Load, never straight in — this
  is a community-reverse-engineered format (iReal Pro doesn't publish an
  official spec), verified against the documented grammar and a real
  example chart, but an exotic real-world export could still convert
  imperfectly. Only the first song converts out of a multi-song playlist
  link.
- **Zoom / fit to screen** — a small floating control in the corner of the
  chart lets you shrink or enlarge the text (`−`/`+`), or tap the fit icon
  to auto-shrink until the widest line on screen no longer needs
  horizontal scrolling (clamped to a minimum readable size — it won't
  shrink text into illegibility on a pathologically wide line, and stops
  short of a perfect fit rather than doing that). Tapping fit again on a
  chart that already fits snaps back to the default size instead of
  zooming in further. Chords are positioned in the same unit (`ch`) the
  font itself scales in, so they stay correctly aligned at any zoom level.
  Resets to the default size whenever a new song loads.
- **Baritone chord diagrams** — fingerings are *computed*, not hand-typed:
  each chord symbol is parsed into a root + interval set, and the app
  searches fret positions on the D/G/B/E strings for a valid voicing
  containing the chord's root, third (or sus tone), and — for 7th/6th
  chords — the defining 4th tone. This avoids the common mistake of reusing
  guitar chord shapes as-is, which can silently drop the root when it lived
  on the low E/A strings a baritone doesn't have.
- **Three equal-weight play modes, in a Learn → Practice → Perform
  progression** (Play view, above the chart; the buttons are laid out left
  to right in that order):
  - **▶ Learn** (Metronome under the hood) — a Web-Audio-scheduled
    metronome at the song's tempo, auto-scrolling/highlighting the chart
    line by line on that fixed clock, whether or not you're actually
    keeping up. Also highlights the specific chord the clock says should
    be playing right now within that line (holding on a chord across
    several beats until the next one is due, rather than needing exactly
    one chord per beat), and softly strums that chord's actual computed
    baritone voicing along with the click — the same fingering math
    behind the chord diagrams, so it's a real, correct-for-the-instrument
    backing to play over, not a generic pad. There's no melody in a
    ChordPro chart (chords + lyrics only), so this plays the harmony
    under the tune, not the tune itself — the listen-and-play-along first
    step, before Practice (feedback) and Perform (no net).
  - **🎯 Practice** (Analyze Me under the hood) — runs the metronome
    (needed as the timing reference) *and* listens, scoring each strum
    against the nearest beat and marking it directly on the chart: a
    colored left border on the line that was playing (the worst rating
    heard on it, so a rough spot isn't overwritten by a later clean hit)
    and a colored mark under the specific chord that strum lines up with
    (matching strum order to chord order within the line). A compact
    on-time% / avg-ms-off / strum count row tracks the running session.
    Marks stay on the chart after Stop so you can review the whole run; a
    fresh Practice run or a new song load clears them. Also highlights,
    same as Learn, the chord the fixed clock says you should be playing
    right now — so a glance shows both *what to play next* and *how the
    last few chords actually went*, at once.
  - **🎤 Perform** (Follow Me under the hood) — listens through the mic
    (onset/strum detection) and only advances to the next line once it's
    heard enough strums to match that line's beat count, so the chart
    genuinely tracks your pace instead of assuming you're locked to the
    tempo dial. Highlights the chord your strums say you're currently on,
    advancing only in response to real detected playing — it stays put
    through silence, never on a clock of its own. Not fully unassisted
    (it still turns the page for you, just without grading or a forced
    tempo) — closer to "play it through at your own pace" than a true
    no-help performance.
- **Practice history, graded** — every Practice run you finish (Stop,
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
  later chords on it off past the edge. Perform and Practice don't
  combine — Practice needs the metronome's fixed clock to score against,
  which is exactly what Perform deliberately doesn't run.
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

Perform's and Practice's onset counting have the same practical
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
`smoke_test_hscroll.mjs`, `smoke_test_ireal.mjs`, `smoke_test_backing.mjs`,
and `smoke_test_zoom.mjs` are Playwright scripts (not part of the
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
Auto-scroll unchecked; `smoke_test_ireal.mjs`
pastes a real iReal Pro chord-chart link (a well-known jazz standard, taken
from iReal Pro's own protocol documentation), confirms it converts to
ChordPro for review rather than loading straight in, then loads it and
checks the chord count, a real fingering diagram, the same conversion via
an uploaded file, and a clean error for an unparseable link;
`smoke_test_backing.mjs` instruments
`AudioContext.createOscillator` from inside the page (headless Chromium
can't literally be listened to) and asserts Metronome mode schedules real
chord-tone notes -- not just the click -- once per beat, matching the
actual voicing the chord diagrams would show, and that none of that
plays during Analyze Me; `smoke_test_zoom.mjs`
checks that the zoom buttons actually resize the chart (chords included,
without drifting out of alignment), that Fit to Screen eliminates
horizontal overflow on a wide line without crossing the minimum-readable
floor, and that zoom resets on a new song load -- in this
project's own CI/sandbox, Supabase is unreachable, so the library/history
tests specifically exercise the localStorage fallback path (`test_helpers.mjs`
filters those expected network failures out of each test's error checks;
see its comments). Run a static server first, then:

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
node smoke_test_ireal.mjs
node smoke_test_backing.mjs
node smoke_test_zoom.mjs
node smoke_test_import.mjs   # uses the committed sample_leadsheet.pdf/.docx fixtures
```
