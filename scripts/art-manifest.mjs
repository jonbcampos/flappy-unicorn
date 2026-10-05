/**
 * What art to generate, and the prompt for each piece.
 *
 * This file is the art direction; `generate-art.mjs` is plumbing. The plan it
 * implements, and the reasoning behind every rule, is ART-PLAN.md.
 *
 * Rules inherited from ../tower-defense and ../slingshot, each learned the
 * hard way:
 *
 *  1. **One shared style paragraph** and one subject per piece.
 *  2. **A character's poses are ONE image.** Two calls are two characters.
 *  3. **Say the grid as a count**, loudly. The model draws the grid it likes.
 *  4. **Pose sheets face RIGHT**, which is the way the unicorn flies anyway.
 *  5. **Anything green goes on magenta**, because a green key would eat it.
 *
 * And this game's own (ART-PLAN.md F1-F5): gates are textures clipped to their
 * hitbox, the bomb is near-black, the fairy is bright, and nothing in the
 * background looks like a gate, a bomb or a fairy.
 */

// --- Shared prompt parts -----------------------------------------------------

const KEY_BACKGROUND = [
  'THE BACKGROUND MUST BE FLAT SOLID CHROMA-KEY GREEN, hex #00FF00, pure saturated green,',
  'covering every pixel that is not the subject. No white, no gradient, no vignette,',
  'no shadow cast onto the background, no floor, no scenery, no border.',
].join(' ');

const MAGENTA_SKY = [
  'EVERYTHING ABOVE THE SCENERY MUST BE FLAT SOLID MAGENTA, hex #FF00FF, pure saturated',
  'magenta-pink: no sky colour, no clouds, no sun, no gradient, no haze above the scenery.',
].join(' ');

const DRAW_STYLE = [
  "children's picture book illustration, soft rounded shapes,",
  'thick clean dark outlines, flat bright colours with simple soft shading, dreamy and cheerful,',
  'pastel palette of sky blue, candy pink, lilac, sunny yellow and cream,',
  'no text, no letters, no watermark',
].join(' ');

const NO_GREEN = 'The subject contains NO green anywhere: no grass, no leaves, no green clothing or trim.';

const CUT_OUT = 'clean crisp edges suitable for cutting out against pure green #00FF00.';

function gridRules(cols, rows) {
  const cells = cols * rows;
  return [
    `A SPRITE SHEET laid out as a grid of ${cols} columns by ${rows} rows.`,
    `THE GRID IS EXACTLY ${cols} CELLS ACROSS AND ${rows} CELLS DOWN: ${cells} figures in total, no more and no fewer.`,
    `Do NOT add another row. Do NOT repeat a row. Do NOT draw more than ${cells} figures.`,
    'Read each row left to right, top row first.',
    'The character is IDENTICAL in every single cell: same face, same hair, same size, same',
    'build, same clothes, same colours. It must be impossible to tell that any two cells were drawn',
    'separately, because they were not. ONLY THE POSE AND EXPRESSION CHANGE from cell to cell.',
    'Centre each figure in its own cell, at the same size. EVERY figure must fit ENTIRELY INSIDE its',
    'own cell with a clear band of plain background on all four sides; nothing may touch or cross',
    'the boundary between cells, and nothing may run off the edge of the picture.',
    'Draw NO lines, borders, boxes, numbers or dividers between the cells: one single continuous',
    'flat #00FF00 background behind and between all the figures.',
    'NEVER mirror or turn the character around between cells.',
    'Draw NOTHING except the character: no ground line, no shadow, no motion lines, no stray marks.',
  ].join(' ');
}

function cellList(cells) {
  return cells.map((text, i) => `Cell ${i + 1}: ${text}`).join(' ');
}

// --- Characters ---------------------------------------------------------------

/**
 * Ellie, word for word as ../tower-defense describes her, so she's the same
 * girl in every game in the set. Here she rides the unicorn (ART-PLAN.md F4).
 */
const ELLIE_LOOK =
  'a little girl about five years old, long wavy dark brown hair past her shoulders, ' +
  'warm honey-tan skin, big brown eyes, a bright coral-pink sleeveless sundress with white trim ' +
  'at the neck and hem';

const UNICORN =
  'a small chubby flying unicorn seen from the SIDE, flying to the RIGHT with its legs tucked up: ' +
  'a snowy white coat with soft pink cheeks, a flowing mane and tail in candy pink, lilac and sky ' +
  'blue, a shiny golden spiral horn, golden hooves, big friendly dark eyes, and two small feathered ' +
  'white wings with pink tips growing from its shoulders. Riding on its back, sitting astride and ' +
  `holding the mane, is ${ELLIE_LOOK}. The girl is small compared with the unicorn. ` +
  'Silhouette: a horse body flying level to the right, a girl on its back, wings above.';

export const PIECES = [
  {
    // Row 1 is the flap cycle; row 2 the moods, picked by game state.
    id: 'unicorn.motion',
    aspect: '16:9',
    size: '2K',
    sheet: { cols: 4, rows: 2, align: 'center', rowIds: ['fly', 'pose'] },
    subject: UNICORN,
    cells: [
      'GLIDING: wings spread out level, both happy, the girl smiling.',
      'WINGS UP: both wings raised high above its back, mid-flap.',
      'WINGS HALFWAY: wings level and swept back, pushing down.',
      'WINGS DOWN: both wings pushed down below its belly, the end of the flap; the girl is smiling with ' +
        'big round brown eyes exactly like cell 1.',
      'MAGIC ZAP: the horn glowing bright yellow with a little sparkle at its tip, the girl pointing ' +
        'straight ahead to the RIGHT, excited.',
      'OOPS: the unicorn startled with its eyes squeezed shut and ears back, the girl hugging its neck ' +
        'tight with an "uh-oh!" face.',
      'CHEERING: the girl throwing one arm high in the air with a huge grin, the unicorn smiling with ' +
        'its wings spread wide.',
      'DIZZY: both with swirly dizzy eyes and silly wobbly smiles, the wings drooping.',
    ],
    extra:
      'Every cell shows the WHOLE unicorn AND the girl on its back, the same size, flying to the ' +
      'RIGHT. In the top row (cells 1-4) both are happy with ordinary round eyes and the horn is ' +
      'plain gold with no glow and no sparkles; only the WINGS change. NO words, NO labels, NO captions ' +
      'anywhere in the picture. ' +
      NO_GREEN,
  },
  {
    id: 'fairy.motion',
    aspect: '1:1',
    size: '1K',
    sheet: { cols: 2, rows: 2, align: 'center', rowIds: ['fly', 'saved'] },
    subject:
      'a tiny glowing fairy, seen from the front: a round happy face, golden-yellow hair in a bun, ' +
      'a sunny yellow and warm orange petal dress, and big pale-blue see-through-looking wings ' +
      '(drawn opaque, pale sky blue with white edges). Bright and cheerful. NO glow, NO aura, NO halo ' +
      'around her: a crisp dark outline directly against the flat green. ' +
      'Silhouette: a small figure with two big round wings.',
    cells: [
      'flying with both wings raised up high, waving one hand.',
      'flying with both wings swept down low, waving the other hand.',
      'calling for help: both hands cupped round her mouth, wings up.',
      'SAVED: jumping for joy with both arms up and eyes squeezed shut in a huge smile, wings wide.',
    ],
    extra: NO_GREEN,
  },
  {
    id: 'kid.motion',
    aspect: '1:1',
    size: '1K',
    sheet: { cols: 2, rows: 2, align: 'center', rowIds: ['wave', 'saved'] },
    subject:
      'a small child about four years old with short curly red hair, rosy cheeks, a bright blue ' +
      't-shirt and blue shorts, sitting on a small fluffy white cloud, seen from the front. ' +
      'Silhouette: a child perched on top of a little round cloud.',
    cells: [
      'waving one arm high above the head, smiling hopefully.',
      'waving the same arm the other way, mouth open calling "over here!".',
      'reaching both arms up as if to be picked up.',
      'SAVED: both arms thrown up, eyes squeezed shut, a huge happy grin.',
    ],
    extra: 'The cloud is the same in every cell. ' + NO_GREEN,
  },
  {
    // Near-black, so it stays the darkest thing on screen (ART-PLAN.md F2). The
    // red pulse ring and the spark are drawn by the game on top.
    id: 'bomb.motion',
    aspect: '16:9',
    size: '2K',
    sheet: { cols: 4, rows: 2, align: 'center', rowIds: ['fuse', 'fizzle'] },
    subject:
      'a round cartoon bomb: a near-black dark navy ball with a small shiny highlight, a grumpy ' +
      'little scowling face, a short metal cap on top with a curly fuse. A naughty cartoon ' +
      'troublemaker, funny and never scary.',
    cells: [
      'the fuse sparking with a small orange spark, grumpy face.',
      'the fuse sparking with a bigger orange-yellow spark, grumpy face.',
      'the fuse sparking with a small spark, the bomb puffing out its cheeks, cross.',
      'the fuse sparking with a big spark, scowling harder.',
      'ZAPPED: the same bomb with a surprised face and wide eyes, little yellow sparkles all around it.',
      'FIZZLING: the bomb melting into a soft round puff of pink and lilac smoke, a few sparkles.',
      'POOF: only a fluffy pastel smoke puff full of colourful confetti pieces and little yellow stars.',
      'GONE: a few last pieces of confetti and two tiny stars floating apart, nothing else.',
    ],
    extra:
      'In EVERY cell the bomb is the SAME near-black dark navy colour, never light blue, never ' +
      'pale: it is the darkest thing in the picture. No fire, no flames, no explosion, nothing violent: a zapped bomb just fizzles into confetti. ' +
      NO_GREEN,
  },

  // --- Gates: textures clipped to the hitbox (ART-PLAN.md F1). -------------------
  {
    id: 'gate.arch',
    aspect: '9:16',
    subject:
      'ONE tall straight vertical pillar standing upright, filling the picture from the very top ' +
      'to the very bottom, about a fifth as wide as the picture: made of six vertical rainbow ' +
      'stripes side by side running its whole length (pink, orange, yellow, soft mint, sky blue, ' +
      'lilac), glossy like candy, with a thick dark outline down both sides. At its TOP end it has a ' +
      'rounded decorative cap with a white frosted rim. The bottom end simply runs off the bottom ' +
      'edge of the picture. Straight-sided, the same width all the way down.',
    pillar: true,
  },
  {
    id: 'gate.tower',
    aspect: '9:16',
    subject:
      'ONE tall straight vertical pillar standing upright, filling the picture from the very top ' +
      'to the very bottom, about a fifth as wide as the picture: a tower made of stacked soft ' +
      'fluffy white and pale-blue cloud puffs, with a dark blue-grey outline down both sides. At ' +
      'its TOP end it has a big round puffy cloud cap edged in white. The bottom end simply runs ' +
      'off the bottom edge of the picture. Straight-sided, the same width all the way down.',
    pillar: true,
  },
  {
    id: 'gate.brick',
    aspect: '9:16',
    subject:
      'ONE tall straight vertical pillar standing upright, filling the picture from the very top ' +
      'to the very bottom, about a fifth as wide as the picture: a castle tower of warm sandstone ' +
      'bricks in tidy staggered rows, with a thick dark brown outline down both sides. At its TOP ' +
      'end it has square battlements (crenellations) and a small pink pennant painted on the stone. ' +
      'The bottom end simply runs off the bottom edge of the picture. Straight-sided, the same width ' +
      'all the way down. No windows, no doors.',
    pillar: true,
  },

  // --- The world ---------------------------------------------------------------------
  {
    id: 'sky.day',
    aspect: '21:9',
    size: '2K',
    background: 'none',
    subject:
      'A FLAT side-on GAME BACKGROUND SKY for a 2D flying game: a bright soft blue sky that is ' +
      'deeper blue at the top and pale peachy-pink near the bottom, with a few soft fluffy white ' +
      'clouds spread apart across the upper half. NOTHING ELSE: no ground, no hills, no sun, no ' +
      'rainbow, no birds, no people.',
  },
  {
    id: 'sky.dusk',
    aspect: '21:9',
    size: '2K',
    background: 'none',
    subject:
      'A FLAT side-on GAME BACKGROUND SKY for a 2D flying game at sunset: deep lavender at the ' +
      'top fading to warm peach and golden pink near the bottom, with a few soft glowing pink and ' +
      'gold clouds spread apart across the upper half and two or three tiny twinkling stars near ' +
      'the top. NOTHING ELSE: no ground, no hills, no sun disc, no rainbow, no birds, no people.',
  },
  {
    id: 'far.meadow',
    aspect: '21:9',
    size: '2K',
    background: 'magenta',
    subject:
      'A FLAT side-on strip of distant scenery for a 2D game background, filling the BOTTOM ' +
      'THIRD of the picture edge to edge: soft rolling far-away hills in hazy pale blue-green and ' +
      'lilac, faded with distance, a few tiny round trees on the ridges. Low and gentle.',
  },
  {
    id: 'far.town',
    aspect: '21:9',
    size: '2K',
    background: 'magenta',
    subject:
      'A FLAT side-on strip of distant scenery for a 2D game background, filling the BOTTOM ' +
      'THIRD of the picture edge to edge: the hazy skyline of a far-away storybook medieval town ' +
      'on a low hill, pale lilac and dusty rose, with steep roofs, a couple of thin spires and a ' +
      'small fairy-tale castle, all faded with distance. Low and gentle.',
  },
  {
    id: 'mid.meadow',
    aspect: '21:9',
    size: '2K',
    background: 'magenta',
    subject:
      'A FLAT side-on strip of nearer scenery for a 2D game background, filling only the BOTTOM ' +
      'QUARTER of the picture edge to edge: low soft rounded grassy green hills with patches of ' +
      'tiny pink and yellow flowers and a few round fluffy trees. Soft and slightly faded. Nothing ' +
      'tall; no fences, no houses, no rocks, no animals, no people.',
  },
  {
    id: 'mid.town',
    aspect: '21:9',
    size: '2K',
    background: 'magenta',
    subject:
      'A FLAT side-on strip of nearer scenery for a 2D game background, filling only the BOTTOM ' +
      'QUARTER of the picture edge to edge: a row of low cosy storybook cottages side by side, ' +
      'pale cream and peach plaster walls with timber beams, steep lavender and rose roofs, warm lit ' +
      'yellow windows, little flower boxes. All about the same low height. No towers, no people.',
  },
  {
    id: 'ground.meadow',
    aspect: '21:9',
    size: '1K',
    background: 'none',
    subject:
      'A side-on cross-section of the ground filling the ENTIRE picture edge to edge, like a 2D game ' +
      'ground tile: a strip of bright green grass along the very top edge with little grass blades ' +
      'and tiny pink and yellow flowers, and below it warm brown soil with small pebbles and a few ' +
      'roots. Flat and side-on, no perspective, no sky.',
  },
  {
    id: 'ground.town',
    aspect: '21:9',
    size: '1K',
    background: 'none',
    subject:
      'A side-on cross-section of a storybook town street filling the ENTIRE picture edge to edge, ' +
      'like a 2D game ground tile: a neat top edge of pale stone kerb, and below it rows of rounded ' +
      'cobblestones in soft grey, lilac and warm beige. Flat and side-on, no perspective, no sky.',
  },
  {
    // No characters: Ellie, the unicorn and the fairies are drawn over it from
    // their own sheets, so they're the same ones as in the game.
    id: 'title',
    aspect: '16:9',
    size: '2K',
    background: 'none',
    subject:
      "The cover picture of a children's game, a dreamy meadow at golden hour seen side-on: soft " +
      'rolling hills with flowers along the bottom, a fairy-tale town with a little castle far away ' +
      'on the right, a big soft pastel rainbow arching across the far background, and fluffy pink ' +
      'clouds. The whole CENTRE of the picture is open sky, left empty for a title and buttons. No ' +
      'people, no animals, no text.',
  },
];

// --- Prompt assembly ---------------------------------------------------------------

/** Composed from named parts, never by editing a finished string. */
export function promptFor(piece) {
  if (piece.background === 'magenta') {
    return [
      MAGENTA_SKY,
      piece.subject,
      'There is NO magenta or bright pink in the scenery itself.',
      `${DRAW_STYLE}, a crisp clean top edge to the scenery against the flat magenta.`,
      MAGENTA_SKY,
    ].join(' ');
  }
  if (piece.background === 'none') {
    return `${piece.subject} ${DRAW_STYLE}. This is a full-bleed background image: it must fill the entire frame edge to edge, with no border and no chroma-key colour anywhere.`;
  }
  if (piece.sheet) {
    const { cols, rows } = piece.sheet;
    return [
      KEY_BACKGROUND,
      gridRules(cols, rows),
      `The character: ${piece.subject}`,
      cellList(piece.cells),
      piece.extra ?? '',
      `${DRAW_STYLE}, ${CUT_OUT}`,
    ].join(' ');
  }
  return [
    KEY_BACKGROUND,
    `Subject: ${piece.subject}`,
    piece.pillar ? 'Lit evenly from the front: no cast shadow, no light from one side.' : '',
    `${DRAW_STYLE}, ${CUT_OUT}`,
  ].join(' ');
}
