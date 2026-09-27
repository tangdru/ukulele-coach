// A handful of bundled public-domain songs (traditional folk tunes and
// pre-1928 Stephen Foster) so there's something to play with immediately,
// and simple 3-chord charts good for a quick test of a new feature or
// instrument. Anything else you actually want to practice, paste or
// upload as ChordPro text -- see the README for the format.

const DEMO_SONGS = {
  'Amazing Grace': `{title: Amazing Grace}
{artist: Traditional}
{key: G}
{tempo: 76}
{time: 3/4}

[G]Amazing grace, how [G7]sweet the [C]sound
That [G]saved a [Em]wretch like [D]me
I [G]once was [G7]lost, but [C]now am [G]found
Was [Em]blind, but [D]now I [G]see

{start_of_chorus}
'Twas [G]grace that [G7]taught my [C]heart to [G]fear
And [Em]grace my [D]fears re[G]lieved
How [G]precious [G7]did that [C]grace ap[G]pear
The [Em]hour I [D]first be[G]lieved
{end_of_chorus}`,

  'You Are My Sunshine': `{title: You Are My Sunshine}
{artist: Traditional}
{key: C}
{tempo: 100}
{time: 4/4}

The [C]other night dear, as I [C7]lay sleeping
I [F]dreamed I [C]held you [G7]in my [C]arms
When I a[C]woke dear, I was mis[C7]taken
So I [F]hung my [C]head and [G7]cried

{start_of_chorus}
You are my [C]sunshine, my only [F]sunshine
You make me [C]happy when skies are [G7]gray
You'll never [C]know dear, how much I [C7]love you
Please don't [F]take my [C]sunshine [G7]a[C]way
{end_of_chorus}`,

  // Three chords (C/F/G7), well under a minute, and about as recognizable
  // a melody as exists -- good for a first pass at a new instrument or
  // feature without the chart itself being the hard part.
  'Twinkle Twinkle Little Star': `{title: Twinkle Twinkle Little Star}
{artist: Traditional}
{key: C}
{tempo: 100}
{time: 4/4}

[C]Twinkle, twinkle, [F]little [C]star
[C]How I [G7]wonder [C]what you [G7]are
[F]Up above the [C]world so [G7]high
[C]Like a [F]diamond [C]in the [G7]sky
[C]Twinkle, twinkle, [F]little [C]star
[C]How I [G7]wonder [C]what you [G7]are`,

  // Same three chords as the other two, brisker tempo, and a call-and-
  // response chorus structure -- a different feel to test against
  // without adding any new chord types.
  'When the Saints Go Marching In': `{title: When the Saints Go Marching In}
{artist: Traditional}
{key: C}
{tempo: 120}
{time: 4/4}

Oh, [C]when the [F]saints [C]go marching [G7]in
Oh, [C]when the [F]saints go [C]marching [G7]in
[C]Oh, how I [F]want to [C]be in that [G7]number
When the [C]saints go [G7]marching [C]in`,

  // Only the opening verse and chorus -- the still-commonly-performed
  // part of the song (later verses use dated dialect essentially no
  // modern songbook or method book still teaches, so they're left out
  // rather than included and never used).
  'Oh! Susanna': `{title: Oh! Susanna}
{artist: Stephen Foster}
{key: C}
{tempo: 132}
{time: 4/4}

[C]I come from Alabama with my [F]banjo on my [C]knee
I'm [C]going to Lou'siana, my [G7]true love for to [C]see
It [C]rained all night the day I left, the [F]weather it was [C]dry
The [C]sun so hot I froze to death, Su[G7]sanna don't you [C]cry

{start_of_chorus}
Oh, [C]Susanna, oh [F]don't you cry for [C]me
For I [C]come from Ala[G7]bama, with my [C]banjo on my [G7]knee[C]
{end_of_chorus}`,
};
