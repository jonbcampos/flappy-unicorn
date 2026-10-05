/**
 * Generates the voice lines (Gemini TTS) and music (Lyria).
 *
 *   npm run sound                       # everything missing
 *   npm run sound -- --only=e.whee,f.thanks # just those
 *   npm run sound -- --force            # redo what exists
 *   npm run sound -- --dry-run          # print prompts, call nothing
 *   npm run sound -- --reindex          # rewrite index.json, call nothing
 *
 * Same rules as generate-art.mjs: the key comes from the gitignored
 * `.env.local` (and the script refuses to run if that file isn't ignored),
 * every piece is resumable, and the game never needs any of this. Without a
 * file, a moment is simply silent apart from its synthesised sounds.
 *
 * Output is AAC in .m4a, via `afconvert`, which ships with macOS, for the same
 * no-dependency reason `art:shrink` uses `sips`. Voices are trimmed of leading
 * and trailing silence and peak-normalised first, so every line starts on the
 * frame it's triggered and they all sit at the same loudness.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SOUNDS, voicePrompt } from './sound-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sounds');
const INDEX_FILE = join(OUT_DIR, 'index.json');
const ENV_FILE = join(ROOT, '.env.local');
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const has = (name) => args.includes(`--${name}`);
const ONLY = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const FORCE = has('force');
const DRY = has('dry-run');

const TTS_MODEL = flag('tts-model') ?? 'gemini-3.8-flash-tts';
const MUSIC_MODEL = flag('music-model') ?? 'lyria-3-clip-preview';

// --- Key handling: the same guard as generate-art.mjs ---------------------------

function readEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

if (existsSync(ENV_FILE)) {
  try {
    execFileSync('git', ['check-ignore', '-q', '.env.local'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    console.error('\nREFUSING TO RUN: .env.local is not gitignored, so your API key could be committed.\n');
    process.exit(1);
  }
}
const KEY = process.env.GEMINI_API_KEY ?? readEnvFile(ENV_FILE).GEMINI_API_KEY;
if (!KEY && !DRY && !has('reindex')) {
  console.error('\nNo API key. Put GEMINI_API_KEY in .env.local (see .env.example).\n');
  process.exit(1);
}

// --- Calls -------------------------------------------------------------------------

async function call(model, body, attempt = 1) {
  let response;
  try {
    response = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    return call(model, body, attempt + 1);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      return call(model, body, attempt + 1);
    }
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const json = await response.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(`no audio in response: ${JSON.stringify(json).slice(0, 300)}`);
  return { bytes: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType };
}

function speak(s) {
  return call(TTS_MODEL, {
    contents: [{ parts: [{ text: voicePrompt(s) }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: s.who.voice } } },
    },
  });
}

function compose(s) {
  return call(MUSIC_MODEL, { contents: [{ parts: [{ text: s.prompt }] }] });
}

// --- WAV handling: trim silence, normalise -------------------------------------------

/** Find the PCM data in a WAV. TTS returns 16-bit mono; anything else is passed through. */
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    } else if (id === 'data' && fmt) {
      return { ...fmt, data: buf.subarray(pos + 8, Math.min(buf.length, pos + 8 + size)) };
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

function writeWav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i], i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/**
 * Trim leading/trailing silence (keeping a few ms so consonants aren't
 * clipped) and normalise the peak to about -1 dB. Returns null if the WAV
 * isn't the 16-bit mono the TTS model returns, in which case it's used as is.
 */
function tidyVoice(buf) {
  const wav = parseWav(buf);
  if (!wav || wav.bits !== 16 || wav.channels !== 1) return null;
  const n = wav.data.length / 2;
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = wav.data.readInt16LE(i * 2);
  const threshold = 600;
  let start = 0;
  while (start < n && Math.abs(s[start]) < threshold) start++;
  let end = n - 1;
  while (end > start && Math.abs(s[end]) < threshold) end--;
  const pad = Math.round(wav.rate * 0.02);
  start = Math.max(0, start - pad);
  end = Math.min(n - 1, end + pad * 3);
  let peak = 1;
  for (let i = start; i <= end; i++) peak = Math.max(peak, Math.abs(s[i]));
  const gain = Math.min(4, 29000 / peak);
  const out = new Int16Array(end - start + 1);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(s[start + i] * gain)));
  return writeWav(out, wav.rate);
}

function toM4a(bytes, ext, outFile, bitrate) {
  const tmp = join(tmpdir(), `flappy-sound-${process.pid}.${ext}`);
  writeFileSync(tmp, bytes);
  try {
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(bitrate), tmp, outFile], { stdio: 'ignore' });
  } finally {
    rmSync(tmp, { force: true });
  }
}

function writeIndex() {
  const present = (kind) =>
    SOUNDS.filter((s) => s.kind === kind && existsSync(join(OUT_DIR, `${s.id}.m4a`))).map((s) => s.id);
  // Playback rates per voice line (see sound-manifest.mjs): applied by the
  // game, so a voice can be made squeakier without re-recording it.
  const rates = Object.fromEntries(
    SOUNDS.filter((s) => s.kind === 'voice' && s.who.rate).map((s) => [s.id, s.who.rate]),
  );
  const index = { ext: 'm4a', voices: present('voice'), music: present('music'), rates };
  writeFileSync(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

// --- Main --------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (has('reindex')) {
    const index = writeIndex();
    console.log(`index.json: ${index.voices.length} voice lines, ${index.music.length} music tracks.`);
    return;
  }
  const wanted = ONLY ? SOUNDS.filter((s) => ONLY.includes(s.id)) : SOUNDS;
  if (DRY) {
    for (const s of wanted) console.log(`\n--- ${s.id} ---\n${s.kind === 'voice' ? voicePrompt(s) : s.prompt}`);
    return;
  }
  try {
    execFileSync('afconvert', ['-h'], { stdio: 'ignore' });
  } catch {
    // afconvert -h exits non-zero but exists; only a missing binary matters.
  }

  const failed = [];
  for (const s of wanted) {
    const out = join(OUT_DIR, `${s.id}.m4a`);
    if (existsSync(out) && !FORCE) {
      console.log(`  skip  ${s.id}`);
      continue;
    }
    process.stdout.write(`  ...   ${s.id}`);
    try {
      if (s.kind === 'voice') {
        const { bytes } = await speak(s);
        toM4a(tidyVoice(bytes) ?? bytes, 'wav', out, 48000);
      } else {
        const { bytes, mime } = await compose(s);
        toM4a(bytes, mime.includes('wav') ? 'wav' : 'mp3', out, 96000);
      }
      console.log(`\r  ok    ${s.id}`);
    } catch (error) {
      console.log(`\r  FAIL  ${s.id}: ${error.message}`);
      failed.push(s.id);
    }
  }
  const index = writeIndex();
  console.log(
    `\n${index.voices.length} voice lines, ${index.music.length} music tracks on disk.` +
      (failed.length ? `\nRetry: --only=${failed.join(',')}` : ''),
  );
}

await main();
