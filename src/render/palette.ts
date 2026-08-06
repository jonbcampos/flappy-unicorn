/**
 * The colour set the whole game draws with.
 *
 * `PALETTE` is a *mutable* object rather than a frozen constant so that a
 * future second skin can swap its contents in place and every module that
 * already reads `PALETTE.bomb` keeps working. The alternative — threading a
 * palette argument through every draw call — is a lot of plumbing for no
 * benefit, since exactly one palette is ever active at a time.
 *
 * One hard rule when picking colours here: **the bomb must be the darkest
 * object on screen and the fairy the brightest.** They are the two things you
 * respond to with opposite verbs at speed, and hue alone is not enough of a
 * difference when a five-year-old is panicking. Value is.
 */
export interface Palette {
  skyTop: string;
  skyBottom: string;

  cloudFar: string;
  midHill: string;
  nearHill: string;
  petal: string;

  meadow: string;
  floorLip: string;
  ceiling: string;
  ceilingLip: string;

  player: string;
  playerCore: string;
  playerDim: string;
  mane: string;
  horn: string;

  shot: string;
  shotCore: string;

  /** Six bands, outer to inner, for a rainbow arch gate. */
  gateBand: readonly string[];
  /** The lip drawn exactly on the hitbox boundary. The instruction. */
  gateLip: string;
  gateTower: string;

  /** The medieval town. Warm stone against the cool sky, so it reads as built. */
  brick: string;
  brickDark: string;
  brickMortar: string;
  roof: string;
  roofDark: string;
  townFar: string;
  /** Background masonry. Deliberately NOT the same stone as a gate. */
  buildingWall: string;
  buildingRoof: string;
  buildingWindow: string;
  cobble: string;
  cobbleDark: string;
  banner: string;

  bomb: string;
  bombShade: string;
  bombFuse: string;
  bombSpark: string;
  bombWarn: string;

  fairy: string;
  fairyHalo: string;
  fairyWing: string;
  personDress: string;
  personSkin: string;

  hudText: string;
  hudDim: string;
  hudAccent: string;
  heart: string;
  heartEmpty: string;

  buttonIdle: string;
  buttonEdge: string;
  buttonActive: string;

  /**
   * Colour laid over the world behind menus. Its own entry rather than reusing
   * the sky, because tinting a daylight scene with pale blue washes it out
   * instead of pushing it back. A scrim always has to be darker than what it
   * covers.
   */
  scrim: string;
}

export const RAINBOW_PALETTE: Palette = {
  skyTop: '#7fc7ff',
  skyBottom: '#ffd9ee',

  cloudFar: '#ffffff',
  midHill: '#a8dcae',
  nearHill: '#79c78a',
  petal: '#ffc7e0',

  meadow: '#57ad68',
  floorLip: '#fff6d8',
  ceiling: '#e8f4ff',
  ceilingLip: '#ffffff',

  player: '#ff7eb3',
  playerCore: '#fff3f8',
  playerDim: '#c2648c',
  mane: '#8f5cff',
  horn: '#ffd166',

  shot: '#fff06a',
  shotCore: '#ffffff',

  gateBand: ['#ff5d8f', '#ff9f4d', '#ffe14d', '#5fd97a', '#4db8ff', '#a97bff'],
  gateLip: '#ffffff',
  gateTower: '#cfe4f7',

  // Warm sandstone rather than grey granite: it has to sit under the same pale
  // sky as the meadow without turning the whole screen gloomy.
  brick: '#c9885f',
  brickDark: '#9c6343',
  brickMortar: '#e8c4a8',
  roof: '#7a4a6b',
  roofDark: '#5c3550',
  townFar: '#b09ec4',
  // Hazed toward the sky so the town recedes. A gate is saturated sandstone
  // with a hard dark edge; a house is pale and soft. They must not be the same
  // brick, or the player is reading brickwork to find the one that kills them.
  buildingWall: '#dcb7a0',
  buildingRoof: '#a3849b',
  buildingWindow: '#b8907c',
  cobble: '#9a8f9e',
  cobbleDark: '#7d7382',
  banner: '#e05a7a',

  // Deep navy. Nothing else in the palette is within reach of this value.
  bomb: '#1f2440',
  bombShade: '#3a4166',
  bombFuse: '#8b7f6b',
  bombSpark: '#ff8a2b',
  bombWarn: '#ff3b5c',

  // Warm and saturated, not pale. The sky is already pale blue and pink, so a
  // near-white fairy disappears into it — and the one object in the game the
  // player is meant to *aim for* cannot be the hardest one to see.
  fairy: '#fff8d0',
  fairyHalo: '#ffb02e',
  fairyWing: '#8fd8ff',
  personDress: '#2f8fd6',
  personSkin: '#ffcf9e',

  hudText: '#43305a',
  hudDim: '#9a86ad',
  hudAccent: '#ff4f9c',
  heart: '#ff4f7c',
  heartEmpty: '#c9b3d6',

  buttonIdle: '#ffffff',
  buttonEdge: '#ff9ec7',
  buttonActive: '#ff4f9c',
  scrim: '#3a2450',
};

/** The live palette. */
export const PALETTE: Palette = { ...RAINBOW_PALETTE, gateBand: [...RAINBOW_PALETTE.gateBand] };

export function applyPalette(next: Palette): void {
  Object.assign(PALETTE, next);
  PALETTE.gateBand = [...next.gateBand];
}

/** rgba() helper for the glow and scrim passes. */
export function alpha(hex: string, a: number): string {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${a})`;
}
