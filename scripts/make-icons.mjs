/**
 * Generates the PWA icons.
 *
 * Written as a script rather than committing PNGs by hand so the icon stays
 * editable: it's drawn from the same palette as the game, so when the art
 * direction changes (the 16-bit renderer is planned), you change these numbers
 * and re-run instead of trying to hand-edit a binary.
 *
 *   node scripts/make-icons.mjs
 *
 * No dependencies — it rasterises into an RGBA buffer and writes the PNG with
 * Node's built-in zlib.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---------------------------------------------------------------- raster ---

class Raster {
  constructor(size) {
    this.size = size;
    this.data = new Uint8Array(size * size * 4);
  }

  /** Source-over blend of a solid colour, so translucent glow layers stack. */
  fillRect(x, y, w, h, [r, g, b], a = 1) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.size, Math.round(x + w));
    const y1 = Math.min(this.size, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this.size + px) * 4;
        this.data[i] = this.data[i] * (1 - a) + r * a;
        this.data[i + 1] = this.data[i + 1] * (1 - a) + g * a;
        this.data[i + 2] = this.data[i + 2] * (1 - a) + b * a;
        this.data[i + 3] = 255;
      }
    }
  }

  verticalGradient(top, bottom) {
    for (let y = 0; y < this.size; y++) {
      const t = y / (this.size - 1);
      const c = [0, 1, 2].map((k) => top[k] + (bottom[k] - top[k]) * t);
      this.fillRect(0, y, this.size, 1, c, 1);
    }
  }
}

// ------------------------------------------------------------------ png ----

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])));
  return Buffer.concat([length, typeBytes, body, crc]);
}

function encodePng(raster) {
  const { size, data } = raster;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay 0: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter type; 0 (none) is fine here
  // because the image is flat colour blocks and compresses well regardless.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----------------------------------------------------------------- icon ----

// Straight from RAINBOW_PALETTE in src/render/palette.ts — the icon should
// match what the game actually looks like, since it sits on the home screen
// next to everything else and is the only preview anyone gets.
const SKY_TOP = [127, 199, 255];
const SKY_BOTTOM = [255, 217, 238];
const GRASS = [87, 173, 104];
const TRIM = [255, 246, 216];
const BODY = [255, 126, 179];
const BODY_DIM = [194, 100, 140];
const MANE = [143, 92, 255];
const HORN = [255, 209, 102];
const WING = [255, 243, 248];
const EYE = [67, 48, 90];
const GATE_BANDS = [
  [255, 93, 143],
  [255, 159, 77],
  [255, 225, 77],
  [95, 217, 122],
  [77, 184, 255],
  [169, 123, 255],
];

/**
 * The icon is authored on a 512 grid and scaled, with everything kept inside
 * the middle ~80%. Android crops maskable icons to a circle or squircle, so
 * anything near the edge is liable to be sliced off.
 *
 * It shows the actual moment of play — a unicorn about to thread a rainbow gate
 * — rather than a portrait. At 48px on a home screen you can't read a face, but
 * you can read "pink thing, rainbow bars, gap between them".
 */
function drawIcon(size) {
  const r = new Raster(size);
  const u = size / 512;
  r.verticalGradient(SKY_TOP, SKY_BOTTOM);

  // Faint scenery arc, same role as in the game: depth, not an object.
  const cx = 200 * u;
  const cy = 470 * u;
  for (let i = 0; i < GATE_BANDS.length; i++) {
    const radius = (250 - i * 16) * u;
    const band = 16 * u;
    for (let a = 20; a <= 160; a += 2) {
      const rad = (a * Math.PI) / 180;
      r.fillRect(
        cx - Math.cos(rad) * radius - band / 2,
        cy - Math.sin(rad) * radius - band / 2,
        band, band, GATE_BANDS[i], 0.22,
      );
    }
  }

  // Meadow with its bright lip, exactly as the game draws the floor.
  r.fillRect(0, 424 * u, size, size - 424 * u, GRASS, 1);
  r.fillRect(0, 424 * u, size, 8 * u, TRIM, 0.95);

  // A gate on the right: two saturated rainbow columns with a gap between them.
  // The gap is the whole game, so it gets a third of the icon's height.
  const gx = 348 * u;
  const gw = 84 * u;
  const bandW = gw / GATE_BANDS.length;
  const gapTop = 190 * u;
  const gapBottom = 330 * u;
  for (let i = 0; i < GATE_BANDS.length; i++) {
    const bx = gx + i * bandW;
    r.fillRect(bx, 40 * u, bandW + 1, gapTop - 40 * u, GATE_BANDS[i], 1);
    r.fillRect(bx, gapBottom, bandW + 1, 424 * u - gapBottom, GATE_BANDS[i], 1);
  }
  // The white lips — the most important pixels in the game, and in the icon.
  r.fillRect(gx, gapTop - 12 * u, gw, 12 * u, [255, 255, 255], 1);
  r.fillRect(gx, gapBottom, gw, 12 * u, [255, 255, 255], 1);

  // The unicorn, in level flight, aimed at the gap.
  const px = 96 * u;
  const py = 232 * u;

  // Wings, up-stroke, behind the body.
  r.fillRect(px + 20 * u, py - 54 * u, 76 * u, 30 * u, WING, 0.95);
  r.fillRect(px + 34 * u, py - 78 * u, 52 * u, 28 * u, WING, 0.8);

  // Tail streaming back.
  r.fillRect(px - 32 * u, py + 4 * u, 40 * u, 22 * u, MANE, 1);
  r.fillRect(px - 52 * u, py + 18 * u, 32 * u, 20 * u, MANE, 1);

  // Barrel.
  r.fillRect(px, py, 116 * u, 56 * u, BODY, 1);
  // Legs tucked under.
  r.fillRect(px + 16 * u, py + 52 * u, 22 * u, 22 * u, BODY_DIM, 1);
  r.fillRect(px + 72 * u, py + 52 * u, 22 * u, 22 * u, BODY_DIM, 1);

  // Neck and head, forward and slightly up.
  r.fillRect(px + 88 * u, py - 30 * u, 34 * u, 46 * u, BODY, 1);
  r.fillRect(px + 96 * u, py - 52 * u, 46 * u, 34 * u, BODY, 1);

  // Mane along the neck.
  r.fillRect(px + 74 * u, py - 34 * u, 22 * u, 54 * u, MANE, 1);

  // Horn. The only gold in the icon.
  r.fillRect(px + 130 * u, py - 74 * u, 18 * u, 24 * u, HORN, 1);
  r.fillRect(px + 136 * u, py - 92 * u, 12 * u, 20 * u, HORN, 1);

  // Eye.
  r.fillRect(px + 118 * u, py - 42 * u, 12 * u, 12 * u, EYE, 1);

  return r;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512, 180]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(drawIcon(size)));
  console.log(`wrote ${file}`);
}
