// Converts an iReal Pro chord chart (the irealbook:// / irealb:// link the
// app shares, or that a user pastes/uploads) into the same ChordPro-ish
// text the rest of the app already understands -- same spirit as
// js/leadsheet-import.js's PDF/Word conversion: best-effort, shown in the
// paste box for review before loading, never loaded silently.
//
// iReal Pro's link format isn't officially published as a spec page you can
// just read, but its chord-progression grammar is well documented by the
// community (irealb:///irealbook:// URL with 6 "="-separated fields --
// title, composer, style, key, an unused field, then the chord string --
// and a compact per-cell token language for barlines, chord qualities,
// section markers, repeats and endings). This implements that documented
// grammar. iReal Pro charts are bars of chords with no lyrics at all (a
// genuinely different shape than this app's chord-over-lyric-line charts),
// so each bar is rendered here as "[Chord]| " -- the barline itself stands
// in for lyric text, giving the chord something to anchor its position to.
//
// Known limitation: the *exported* irealb:// links (the ones iReal Pro's
// own "Share" button produces) sometimes use a more compact/optimized
// encoding for runs of blank cells than the plain irealbook:// form shown
// in the official examples this was built against. This best-effort
// converter is verified against the documented grammar and a real example
// from iReal Pro's own docs, but an exotic real-world export could still
// convert imperfectly -- which is exactly why, like the PDF/Word path, the
// result always lands in the paste box for a look before Load, never
// auto-loads.

function isIRealText(text) {
  return /ireal(b|book):\/\//i.test(text);
}

// Longest-token-first list so e.g. "maj7" style multi-char runs aren't cut
// short by a shorter prefix match.
const IREAL_BARLINE_TOKENS = ['LZ', '[', ']', '{', '}', 'Z', '|'];
const IREAL_REPEAT_BAR_TOKENS = ['XyQKcl', 'Kcl', 'XyQ', 'x'];

// Translates one *known* iReal quality suffix (matched whole, from the
// list below -- never a partial/ambiguous scan) into a suffix
// chords-baritone.js's lenient parseChordSymbol() already recognizes. Only
// the prefix needs to classify correctly -- trailing alterations (b9, #11,
// ...) ride along in the displayed text even though the fingering solver
// ignores them, same simplification that parser already makes for e.g.
// "Bm7b5" -> plain m7.
function translateIRealQuality(q) {
  if (!q) return '';
  if (/^[hø]/.test(q)) return 'm7b5' + q.slice(1).replace(/^\d+/, '');
  if (/^\^/.test(q)) return 'maj7' + q.slice(1).replace(/^\d+/, '');
  if (/^o/.test(q)) return (q.startsWith('o7') ? 'dim7' : 'dim') + q.slice(q.startsWith('o7') ? 2 : 1);
  if (/^-/.test(q)) return 'm' + q.slice(1);
  return q; // 7, 9, 11, 13, 6, 6/9, sus, sus4, add9, alt, + ... already readable as-is
}

// The documented "Chord qualities full list" (doc/irealpro.md), plus the
// bare quality-marker characters (^, -, o, ø, +) on their own. Matched
// longest-first against the literal text right after a chord's root, so
// e.g. "7" in "A7Z" stops before the unrelated "Z" barline token that
// follows with no separator -- a loose character-class scan would
// (and did, before this) swallow "Z" into the chord by mistake.
const IREAL_QUALITIES = [
  '^7#11', '^9#11', '-b6', '-#5', '^7#5', 'add9', '-7b5', '7b9sus', '7b13sus',
  '7add3sus', '7b9b13', '7b9#5', '7b9b5', '7b9#9', '7#9#5', '7#9b5', '7#9#11',
  '7b9#11', '13#11', '9#11', '7alt', '7sus', '-^7', '-^9', '6/9', '-6/9',
  '13sus', '9sus', '13b9', '13#9', '7b9', '7#9', '7b5', '7#5', '7b13', '7#11',
  'ø9', 'ø7', 'h9', 'h7', 'o7', '9b5', '9#5', '^13', '-11', '^9', '-9', '^7',
  '-7', '-6', 'sus4', 'sus2', 'sus', '13', '11', 'add', 'alt', '6', '7', '9',
  '2', '5', '^', '-', 'o', 'ø', 'h', '+',
];

function matchQuality(str) {
  for (const q of IREAL_QUALITIES) {
    if (str.startsWith(q)) return q;
  }
  return '';
}

// Scans one chord token (root + quality + optional /bass) starting at
// position i. Returns { text, next } or null if position i isn't a chord.
function scanChord(str, i) {
  const m = /^([A-G])(#|b)?/.exec(str.slice(i));
  if (!m) return null;
  let j = i + m[0].length;
  const q = matchQuality(str.slice(j));
  j += q.length;
  let bass = '';
  const bassM = /^\/([A-G])(#|b)?/.exec(str.slice(j));
  if (bassM) {
    bass = bassM[0];
    j += bassM[0].length;
  }
  const root = m[1] + (m[2] || '');
  const quality = translateIRealQuality(q);
  return { text: root + quality + bass, next: j };
}

// Splits the raw "irealbook://Title=Composer=Style=Key=n=ChordString" (or
// irealb:// variant) into its 6 documented fields. Multiple songs in a
// playlist are joined with "===" -- only the first is converted here (a
// playlist picker is more than this import step needs to take on).
function splitIRealFields(rawAfterScheme) {
  const firstSong = rawAfterScheme.split('===')[0];
  const parts = firstSong.split('=');
  const title = parts[0] || '';
  const composer = parts[1] || '';
  const key = parts[3] || '';
  const chordString = parts.slice(5).join('=');
  return { title, composer, key, chordString };
}

function decodeField(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

const TIME_SIG_MAP = {
  24: '2/4', 34: '3/4', 44: '4/4', 54: '5/4', 64: '6/4', 74: '7/4',
  38: '3/8', 58: '5/8', 68: '6/8', 78: '7/8', 98: '9/8',
  12: '12/8', 22: '2/2', 32: '3/2',
};

function convertChordString(chordString) {
  const lines = []; // array of { section, bars: [ {chords: [...], notes: [...]} or null, ... ] }
  let section = '';
  let timeSig = '4/4';
  let curBars = [];
  let curBar = { chords: [], notes: [] };
  let lastBarChords = [];
  let barsThisLine = 0;
  const BARS_PER_LINE = 4;

  const barIsEmpty = (b) => b.chords.length === 0 && b.notes.length === 0;

  const flushBar = () => {
    if (curBar.chords.length) lastBarChords = curBar.chords;
    curBars.push(barIsEmpty(curBar) ? null : curBar);
    curBar = { chords: [], notes: [] };
    barsThisLine++;
    if (barsThisLine >= BARS_PER_LINE) {
      lines.push({ section, bars: curBars });
      section = '';
      curBars = [];
      barsThisLine = 0;
    }
  };

  let i = 0;
  const s = chordString;
  while (i < s.length) {
    // Comments / repeat directives ("D.C. al Coda", etc.) -- surface as a
    // section-style label rather than losing them.
    if (s[i] === '<') {
      const end = s.indexOf('>', i);
      if (end !== -1) {
        const note = s.slice(i + 1, end).replace(/^\*\d+/, '').trim();
        if (note) curBar.notes.push(note);
        i = end + 1;
        continue;
      }
    }
    // Alternate/small chord shown above the main one -- decorative, skip.
    if (s[i] === '(') {
      const end = s.indexOf(')', i);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    // Section markers: *A, *B, *i, *v, or *NN (vertical offset -- no label).
    const sectionM = /^\*([A-Za-z])/.exec(s.slice(i));
    if (sectionM) {
      section = section ? section + ' / ' + sectionM[1] : sectionM[1];
      i += sectionM[0].length;
      continue;
    }
    if (/^\*\d+/.test(s.slice(i))) {
      i += /^\*\d+/.exec(s.slice(i))[0].length;
      continue;
    }
    // Time signature.
    const tM = /^T(\d\d)/.exec(s.slice(i));
    if (tM) {
      timeSig = TIME_SIG_MAP[tM[1]] || timeSig;
      i += tM[0].length;
      continue;
    }
    // Endings: N1/N2/N3, one bar each -- label it, then fall through to
    // parse the chord that follows in the normal way.
    const nM = /^N([123])/.exec(s.slice(i));
    if (nM) {
      curBar.notes.push(`${nM[1]}${nM[1] === '1' ? 'st' : nM[1] === '2' ? 'nd' : 'rd'} ending`);
      i += nM[0].length;
      continue;
    }
    // Barlines.
    const barline = IREAL_BARLINE_TOKENS.find((t) => s.startsWith(t, i));
    if (barline) {
      flushBar();
      i += barline.length;
      continue;
    }
    // Repeat-previous-bar tokens.
    const repeatBar = IREAL_REPEAT_BAR_TOKENS.find((t) => s.startsWith(t, i));
    if (repeatBar) {
      curBar.chords = curBar.chords.concat(lastBarChords);
      i += repeatBar.length;
      continue;
    }
    // Repeat previous 2 bars.
    if (s[i] === 'r') {
      curBar.chords = curBar.chords.concat(lastBarChords);
      i += 1;
      continue;
    }
    // Repeat previous chord (slash).
    if (s[i] === 'p') {
      if (curBar.chords.length) curBar.chords.push(curBar.chords[curBar.chords.length - 1]);
      else if (lastBarChords.length) curBar.chords.push(lastBarChords[lastBarChords.length - 1]);
      i += 1;
      continue;
    }
    if (s[i] === 'n') {
      curBar.notes.push('N.C.');
      i += 1;
      continue;
    }
    if (s[i] === 'Y') {
      // Vertical spacer / forced line break.
      if (!barIsEmpty(curBar) || curBars.length) flushBar();
      if (curBars.length || section) {
        lines.push({ section, bars: curBars });
        section = '';
        curBars = [];
        barsThisLine = 0;
      }
      i += 1;
      continue;
    }
    if (s[i] === ',') {
      i += 1; // space-equivalent, no new bar
      continue;
    }
    // Size markers immediately before a chord -- decorative, skip the
    // marker itself.
    if ((s[i] === 's' || s[i] === 'l') && /^[A-GnWp]/.test(s[i + 1] || '')) {
      i += 1;
      continue;
    }
    if (s[i] === 'W' || s[i] === 'S' || s[i] === 'Q' || s[i] === 'U' || s[i] === 'f') {
      i += 1; // invisible chord / segno / coda / end / fermata -- no chart-reading equivalent
      continue;
    }
    // Chord symbol.
    const chord = scanChord(s, i);
    if (chord) {
      curBar.chords.push(chord.text);
      i = chord.next;
      continue;
    }
    // Anything else (stray whitespace, unrecognized token) -- skip one char
    // rather than getting stuck or throwing.
    i += 1;
  }
  flushBar();
  if (curBars.length || section) lines.push({ section, bars: curBars });

  return { timeSig, lines };
}

function convertIRealToChordPro(rawText) {
  const m = /ireal(b|book):\/\/(.*)/is.exec(rawText);
  if (!m) throw new Error("Couldn't find an iReal Pro link (irealb:// or irealbook://) in that text.");
  const { title, composer, key, chordString } = splitIRealFields(m[2]);
  const decodedChords = decodeField(chordString);
  const { timeSig, lines } = convertChordString(decodedChords);

  if (!lines.some((l) => l.bars.some((b) => b && b.chords.length))) {
    throw new Error("Found an iReal Pro link, but couldn't make out any chords in it -- this export format may not be fully supported yet.");
  }

  let out = '';
  if (title) out += `{title: ${decodeField(title)}}\n`;
  if (composer) out += `{artist: ${decodeField(composer)}}\n`;
  out += `{key: ${decodeField(key).replace(/-$/, 'm')}}\n{tempo: }\n{time: ${timeSig}}\n\n`;

  // The chart renderer positions each [Chord] by counting plain *lyric*
  // characters before it (bracket markup itself doesn't count) -- so
  // adjacent chords need real text between them or their columns collide
  // and overlap on screen. Pad each chord's own text width plus a couple
  // of characters, rather than a single fixed space, so a wide chord like
  // "Dm7b5" still leaves the next one enough room.
  const pad = (chordText) => ' '.repeat(chordText.length + 2);

  const renderBar = (b) => {
    if (!b) return '|' + pad('');
    let text = b.notes.length ? `(${b.notes.join(', ')})` + pad('') : '';
    b.chords.forEach((c) => {
      text += `[${c}]` + pad(c);
    });
    return text + '|' + pad('');
  };

  lines.forEach((line) => {
    if (line.section) out += `{comment: Section ${line.section}}\n`;
    const rowText = line.bars.map(renderBar).join('');
    if (rowText.trim()) out += rowText.replace(/ +$/, '') + '\n';
  });

  return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
