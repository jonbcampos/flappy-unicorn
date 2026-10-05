/**
 * What to ask Gemini to SAY and PLAY: voice lines (text-to-speech) and music
 * (Lyria). Effects stay synthesised in src/core/sfx.ts and audio.ts; no model
 * makes sound effects (slingshot asked Lyria for an explosion and got a polka).
 *
 * Lessons carried over from ../slingshot (DECISIONS.md 16, 18, 19):
 *
 *  - **Direction must not be spoken.** A director's-notes prompt where only the
 *    TRANSCRIPT is read aloud; plain-text stage directions get read out.
 *  - **Cartoonish = short and high.** Two or three words a line.
 *  - **Characters shouldn't talk too much.** A handful of lines, and the game
 *    rate-limits them (see `Chatter` in src/main.ts).
 *  - **Ellie plays at natural speed** (rate 1), with slingshot's profile, so
 *    she's the same girl in both games. The fairy and the kid are the sped-up,
 *    squeaky ones, which keeps them clearly different from her.
 */

const ELLIE = {
  voice: 'Zephyr',
  rate: 1,
  profile:
    'a little cartoon girl from a children\'s TV cartoon, about five years old: high, bright, squeaky ' +
    'and bouncy, innocent and goofy, like an animated kid sidekick. NOT grown-up, NOT breathy, NOT ' +
    'soft or sultry: a loud happy little kid',
};

const FAIRY = {
  voice: 'Leda',
  rate: 1.4,
  profile:
    'a teeny-tiny fairy from a children\'s TV cartoon, no bigger than a thumb: a very high, tinkly, ' +
    'squeaky little voice, sweet and breathless with excitement',
};

const KID = {
  voice: 'Puck',
  rate: 1.3,
  profile:
    'a small cartoon kid from a children\'s TV cartoon, about four years old: a high, chirpy, ' +
    'excited little voice, bouncy and silly',
};

function line(id, who, style, text) {
  return { id, kind: 'voice', who, style, text };
}

export const SOUNDS = [
  // --- Ellie: a few, short, and rate-limited by the game. -----------------------
  line('e.go', ELLIE, 'excited, starting an adventure', "Let's fly!"),
  line('e.whee', ELLIE, 'thrilled, swooping through the air', 'Wheee!'),
  line('e.yay', ELLIE, 'delighted, cheering', 'Yay!'),
  line('e.gotit', ELLIE, 'triumphant, giggly', 'Got it!'),
  line('e.uhoh', ELLIE, 'suddenly startled, two quick syllables', 'Uh-oh!'),
  line('e.ohno', ELLIE, 'disappointed but cheerful, ready to try again', 'Oh no!'),

  // --- The ones she saves: one squeaky line each. --------------------------------
  line('f.thanks', FAIRY, 'overjoyed and grateful, quick', 'Thank you!'),
  line('k.yippee', KID, 'overjoyed, bouncing', 'Yippee!'),

  // --- Music (Lyria) -----------------------------------------------------------------
  // About thirty seconds each; the player in src/core/audio.ts finds the steady
  // part and crossfades it into a loop.
  {
    id: 'music.title',
    kind: 'music',
    prompt:
      "A dreamy, magical title theme for a children's cartoon game about a little girl flying a " +
      'unicorn through rainbows: sparkling celesta and harp arpeggios, soft strings, a gentle flute ' +
      'melody, a little glockenspiel shimmer, 92 bpm, wonder and warmth. Steady the whole way ' +
      'through: no long intro, no ending, no fade-out. Instrumental, no vocals.',
  },
  {
    id: 'music.meadow',
    kind: 'music',
    prompt:
      "Light, airy, happy background music for a children's cartoon game, flying a unicorn over a " +
      'sunny flower meadow: plucked harp, ukulele, flute, soft glockenspiel and light hand percussion, ' +
      'floating and bouncy, 108 bpm. Gentle enough to play under sound effects. A steady groove the ' +
      'whole way through: no intro, no build-up, no ending and no fade-out, so it can loop. ' +
      'Instrumental, no vocals.',
  },
  {
    id: 'music.town',
    kind: 'music',
    prompt:
      "Jaunty, playful background music for a children's cartoon game, flying a unicorn over a " +
      'storybook medieval town: lute, recorder, a little hurdy-gurdy drone, tambourine and frame ' +
      'drum, a merry fairy-tale market dance, 108 bpm. Gentle enough to play under sound effects. A ' +
      'steady groove the whole way through: no intro, no ending and no fade-out, so it can loop. ' +
      'Instrumental, no vocals.',
  },
];

/** The TTS prompt. Only the TRANSCRIPT section is spoken. */
export function voicePrompt(s) {
  return [
    `# AUDIO PROFILE: ${s.who.profile}`,
    "## DIRECTOR'S NOTES",
    `Style: ${s.style}. Cartoon voice acting, short, punchy and high-pitched.`,
    '#### TRANSCRIPT',
    s.text,
  ].join('\n');
}
