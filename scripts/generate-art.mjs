/**
 * Generates the game's art with the Gemini image API.
 *
 *   cp .env.example .env.local     # then put your key in it, once
 *   npm run art                    # everything that's missing
 *
 * Or, equivalently:
 *
 *   node scripts/generate-art.mjs                 # everything that's missing
 *   node scripts/generate-art.mjs --only=unicorn.motion,gate.arch
 *   node scripts/generate-art.mjs --force         # redo pieces that already exist
 *   node scripts/generate-art.mjs --model=gemini-3-pro-image-preview
 *   node scripts/generate-art.mjs --dry-run       # print the prompts, call nothing
 *   node scripts/generate-art.mjs --reindex       # rewrite index.json, call nothing
 *
 * No dependencies: Node's built-in fetch and fs, same rule as the rest of the
 * project.
 *
 * Three things worth knowing before you run it:
 *
 * **It costs money and it is resumable.** Every piece is one billed API call.
 * Existing files are skipped unless you pass `--force`, so an interrupted run
 * costs nothing to restart, and regenerating one piece you don't like is
 * `--only=that-piece` rather than redoing the set.
 *
 * **The game does not need any of this.** Every sprite is optional. The
 * procedural painters in `src/render/` are the fallback and stay the fallback:
 * if a file is missing, malformed, or you never run this script at all, the
 * game looks exactly as it did before. Nothing here can break the game.
 *
 * **Backgrounds are removed at load time, not here.** The prompts ask for a
 * flat green background and `src/render/sprites.ts` floods it away in the
 * browser. Doing it here would mean decoding and re-encoding PNGs without
 * dependencies, which is a lot of code to save a few milliseconds once.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIECES, promptFor } from './art-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const INDEX_FILE = join(OUT_DIR, 'index.json');

const ENDPOINT =
  process.env.GEMINI_ENDPOINT ?? 'https://generativelanguage.googleapis.com/v1beta/interactions';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const has = (name) => args.includes(`--${name}`);

// `fileEnv` isn't read until below, so model/size are resolved after it.
let MODEL = flag('model') ?? process.env.GEMINI_MODEL ?? '';
let SIZE = flag('size') ?? process.env.GEMINI_IMAGE_SIZE ?? '';
const ONLY = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const FORCE = has('force');
const DRY = has('dry-run');
/**
 * Modes that draw nothing, and so must not demand a key.
 *
 * `--reindex` in particular: rebuilding the index is how a correction to the
 * way a sheet is READ gets published, and a key requirement there would mean
 * the person best placed to fix a bad slice is the person who cannot.
 */
const OFFLINE = DRY || has('reindex') || has('list');

const ENV_FILE = join(ROOT, '.env.local');

/**
 * Read the key from `.env.local`, falling back to the environment.
 *
 * A file rather than an exported variable because a variable has to be re-set
 * every new shell and ends up pasted into shell history, and history is the
 * single most common way an API key gets somewhere it shouldn't.
 *
 * The parser is deliberately about ten lines. This is a two-key file that one
 * person edits by hand, not a config format, and a dependency for it would cost
 * more than it saves.
 */
function readEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Tolerate quotes, because a key pasted out of a web page often arrives
    // wrapped in them and a mysterious 401 is a horrible way to find that out.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

/**
 * Refuse to run if `.env.local` is not actually being ignored by git.
 *
 * The whole point of putting the key in a file is that it cannot be committed.
 * That guarantee is one careless `.gitignore` edit away from being false, and
 * it fails SILENTLY — you would find out when the key appeared on GitHub. So it
 * is checked every run, and a failed check stops the script rather than warning
 * into a scrollback nobody reads.
 */
function assertKeyFileIsIgnored() {
  if (!existsSync(ENV_FILE)) return;
  try {
    execFileSync('git', ['check-ignore', '-q', '.env.local'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    console.error(
      '\nREFUSING TO RUN: .env.local is not gitignored, so your API key could be committed.\n' +
        '\nAdd this line to .gitignore and try again:\n\n  .env.local\n',
    );
    process.exit(1);
  }
  try {
    const tracked = execFileSync('git', ['ls-files', '--error-unmatch', '.env.local'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (tracked) {
      console.error(
        '\nREFUSING TO RUN: .env.local is already TRACKED by git — your key is in the repo.\n' +
          '\nRemove it from tracking, then rotate the key:\n\n' +
          '  git rm --cached .env.local\n\n' +
          'Assume any key that has been committed is compromised, even if it was never pushed.\n',
      );
      process.exit(1);
    }
  } catch {
    // Not tracked. This is the good path — `ls-files --error-unmatch` exits
    // non-zero for a file git doesn't know about.
  }
}

assertKeyFileIsIgnored();
const fileEnv = readEnvFile(ENV_FILE);

// Deliberately no `--key=` flag. A key on the command line goes into shell
// history, which is the exact leak the file is here to prevent.
const KEY =
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  fileEnv.GEMINI_API_KEY ??
  fileEnv.GOOGLE_API_KEY;

if (!KEY && !OFFLINE) {
  console.error(
    '\nNo API key found.\n\n' +
      '  cp .env.example .env.local\n' +
      '  # then put your key in .env.local\n\n' +
      'Get one at https://aistudio.google.com/apikey\n' +
      '(.env.local is gitignored, so the key stays out of the repo.)\n',
  );
  process.exit(1);
}
if (KEY === 'paste-your-key-here' && !OFFLINE) {
  console.error('\n.env.local still has the placeholder in it. Put your real key in.\n');
  process.exit(1);
}

MODEL = MODEL || fileEnv.GEMINI_MODEL || 'gemini-3.1-flash-image';
SIZE = SIZE || fileEnv.GEMINI_IMAGE_SIZE || '1K';

/**
 * Validate the size BEFORE spending anything.
 *
 * A bad value here is rejected identically by all 26 calls, so without this
 * check a typo costs 26 round trips and a wall of identical red text. Asking
 * for '512px' — which is what the documentation calls it — did exactly that.
 * The `px` suffix is accepted and normalised rather than rejected, because
 * being right about the concept and wrong about the spelling should not be
 * a failure mode.
 */
const SIZES = ['512', '1K', '2K', '4K'];
SIZE = String(SIZE).replace(/px$/i, '').replace(/^(\d)k$/i, '$1K');
if (!SIZES.includes(SIZE)) {
  console.error(`\nimage_size "${SIZE}" is not valid. Use one of: ${SIZES.join(', ')}\n`);
  process.exit(1);
}
for (const piece of PIECES) {
  if (piece.size && !SIZES.includes(piece.size)) {
    console.error(`\nPiece "${piece.id}" has size "${piece.size}"; use one of: ${SIZES.join(', ')}\n`);
    process.exit(1);
  }
}

/**
 * One image.
 *
 * Retries on 429 and 5xx with exponential backoff, because a rate limit part
 * way through a 27-piece run should cost you a pause rather than the run.
 * A refusal or a bad request is NOT retried — it will fail the same way again,
 * and burning three more calls to prove it just costs money.
 */
async function generate(piece, attempt = 1) {
  const body = {
    model: MODEL,
    input: [{ type: 'text', text: promptFor(piece) }],
    response_format: {
      // JPEG, not PNG: the image endpoint rejects 'image/png' outright with
      // "Supported values: 'image/jpeg'". That is also why the prompts ask for
      // a flat green background instead of transparency — JPEG has no alpha
      // channel to ask for, so the cut-out has to happen at load time. See
      // `cutOutBackground` in src/render/sprites.ts.
      type: 'image',
      mime_type: 'image/jpeg',
      aspect_ratio: piece.aspect ?? '1:1',
      image_size: piece.size ?? SIZE,
    },
  };

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (attempt >= 4) throw error;
    await backoff(attempt, `network error: ${error.message}`);
    return generate(piece, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 4) {
      await backoff(attempt, `HTTP ${response.status}`);
      return generate(piece, attempt + 1);
    }
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const json = await response.json();
  const base64 = extractImage(json);
  if (!base64) {
    throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Pull the image bytes out, tolerating more than one response shape.
 *
 * The Gemini image API has moved between an `interactions` shape and a
 * `generateContent` shape, and the field names differ. Checking for all of them
 * is a dozen lines and means this script doesn't break the next time the
 * endpoint is revised — which matters, because the person running it is not
 * going to want to debug a JSON path.
 */
function extractImage(json) {
  if (json?.output_image?.data) return json.output_image.data;

  for (const step of json?.steps ?? []) {
    for (const item of step?.content ?? []) {
      if (item?.type === 'image' && item?.data) return item.data;
    }
  }
  // Legacy generateContent shape.
  for (const candidate of json?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (part?.inlineData?.data) return part.inlineData.data;
      if (part?.inline_data?.data) return part.inline_data.data;
    }
  }
  return null;
}

function backoff(attempt, why) {
  const seconds = 2 ** attempt;
  console.log(`      ${why} — retrying in ${seconds}s`);
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Rewrite `index.json` from the manifest and whatever is on disk. Returns the
 * ids that are present.
 *
 * The index is what the game loads. Only pieces that exist on disk go in it, so
 * a partial run gives a partly-illustrated game rather than a broken one:
 * anything absent simply keeps its hand-drawn version.
 *
 * Split out from `main` so `--reindex` can call it. Everything in here is
 * derived — the manifest plus a directory listing — so rebuilding the index is
 * not something that should require an API key, and until this existed it did.
 * A correction to how a sheet is READ (a grid, an alignment, a row the model
 * drew badly) is a manifest edit that costs nothing to apply, and paying to
 * redraw art that is already on disk in order to publish it would be an
 * excellent way to talk yourself out of the correction.
 */
function writeIndex() {
  const present = PIECES.map((p) => p.id).filter((id) => existsSync(join(OUT_DIR, `${id}.jpg`)));
  const index = {
    generated: present,
    /** Extension is recorded rather than assumed, so a future model that can
     *  return PNG doesn't need a matching change in the loader. */
    ext: 'jpg',
    // `keyed` pieces get their flat background removed at load time. Full-bleed
    // images must not be touched.
    opaque: PIECES.filter((p) => p.background === 'none').map((p) => p.id),
    // Painted on BLACK and drawn with additive blending: never keyed, and the
    // loader clamps near-black to black so JPEG haze doesn't glow. Explosions.
    additive: PIECES.filter((p) => p.background === 'black').map((p) => p.id),
    // Scenery strips: the scenery runs off the bottom and both sides, so the
    // key colour is read from the TOP corners only. See sprites.ts.
    keyTop: PIECES.filter((p) => p.background === 'magenta').map((p) => p.id),
    // Pieces that are grids of animation frames rather than single subjects.
    // The loader needs the grid shape to cut them up, and putting it here rather
    // than in the loader means adding a cycle is still a manifest-only edit.
    sheets: Object.fromEntries(
      PIECES.filter((p) => p.sheet && present.includes(p.id)).map((p) => [p.id, p.sheet]),
    ),
  };
  writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);
  return present;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const wanted = ONLY ? PIECES.filter((p) => ONLY.includes(p.id)) : PIECES;
  if (ONLY) {
    const missing = ONLY.filter((id) => !PIECES.some((p) => p.id === id));
    if (missing.length) console.warn(`Unknown piece(s): ${missing.join(', ')}`);
  }

  if (DRY) {
    for (const piece of wanted) {
      console.log(`\n--- ${piece.id} (${piece.aspect ?? '1:1'}) ---\n${promptFor(piece)}`);
    }
    console.log(`\n${wanted.length} pieces. No API calls made.`);
    return;
  }

  console.log(`Model ${MODEL} at ${SIZE}, ${wanted.length} piece(s) requested.\n`);

  const done = [];
  const failed = [];

  for (const piece of wanted) {
    const file = join(OUT_DIR, `${piece.id}.jpg`);
    if (existsSync(file) && !FORCE) {
      console.log(`  skip  ${piece.id} (already exists — pass --force to redo)`);
      done.push(piece.id);
      continue;
    }
    process.stdout.write(`  ...   ${piece.id}`);
    try {
      const bytes = await generate(piece);
      writeFileSync(file, bytes);
      console.log(`\r  ok    ${piece.id}  (${(bytes.length / 1024).toFixed(0)} kB)`);
      done.push(piece.id);
    } catch (error) {
      console.log(`\r  FAIL  ${piece.id}: ${error.message}`);
      failed.push(piece.id);
    }
  }

  const present = writeIndex();

  console.log(
    `\n${done.length} ok, ${failed.length} failed. ${present.length} sprite(s) on disk.` +
      (failed.length ? `\nRetry just those: --only=${failed.join(',')}` : ''),
  );
  if (present.length) {
    console.log('Reload the game — anything generated is picked up automatically.');
  }
}

/** Rebuild the index from the manifest and the files on disk. No API calls. */
if (has('reindex')) {
  mkdirSync(OUT_DIR, { recursive: true });
  const present = writeIndex();
  console.log(`index.json rewritten from the manifest: ${present.length} sprite(s) on disk.`);
  console.log('Reload the game — no API calls were made and nothing was redrawn.');
} else if (has('list')) {
  const index = existsSync(INDEX_FILE) ? JSON.parse(readFileSync(INDEX_FILE, 'utf8')) : null;
  const generated = index?.generated ?? [];
  console.log(
    generated.length
      ? `${generated.length} of ${PIECES.length} generated:\n  ${generated.join('\n  ')}`
      : `nothing generated yet (${PIECES.length} pieces available) — run: npm run art`,
  );
} else {
  await main();
}
