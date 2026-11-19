// Makes the clips of the narration (src/lib/narration.mjs): for the narration
// of every shown step of every tutorial, the clip that the voice of
// narration/voice.json reads, unless narration/clips/ holds it; and removes
// the clips that no tutorial uses any more. Only a new or changed sentence, or
// another voice, calls the speech service, with the key of
// OPENROUTER_API_KEY: without one, it fails when a clip is to make, and
// needs no network otherwise, as in CI, where it removes nothing and fails
// instead when narration/ holds a clip that no tutorial uses.
//
// The service returns PCM, which FFmpeg encodes once, to MP3 at 48 kbit/s,
// mono, without the metadata that would differ between two encoders.
//
// Usage: node src/narrate.mjs

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CLIPS_DIR, CLIPS_PATH, clipFile, clipKey, loadClips, loadVoice } from "./lib/narration.mjs";
import { loadCatalog, loadTutorial, shownSteps, tutorialIds } from "./lib/script.mjs";

const execFileAsync = promisify(execFile);
const BITRATE = "48k";
// The speech service, which receives the key: in the code, not in
// narration/voice.json, so that no change of data sends the key elsewhere.
const ENDPOINT = "https://openrouter.ai/api/v1/audio/speech";

// Reads `text` with the voice: the PCM of the service and its sample rate.
async function speak(voice, text, key) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: voice.model, voice: voice.voice, input: text, response_format: "pcm" }),
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("audio/")) {
    throw new Error(`the speech service answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return { pcm: Buffer.from(await response.arrayBuffer()), rate: Number(type.match(/rate=(\d+)/)?.[1] ?? 24000) };
}

// Encodes the PCM, 16 bits, mono, into the file, and returns its duration.
async function encode({ pcm, rate }, file) {
  const ffmpeg = execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0",
    "-codec:a", "libmp3lame", "-b:a", BITRATE, "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
    file,
  ]);
  ffmpeg.child.stdin.end(pcm);
  await ffmpeg;
  // Its duration is that of its decoded samples, which the render plays: the
  // file has no header that states it, and FFprobe would estimate it.
  const decoded = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(rate), "pipe:1"],
    { encoding: "buffer", maxBuffer: 1 << 28 },
  );
  return Math.round((decoded.stdout.length / 2 / rate) * 1000) / 1000;
}

const voice = await loadVoice();
const catalog = await loadCatalog();
const needed = new Map();
for (const id of await tutorialIds()) {
  for (const step of shownSteps(await loadTutorial(id, catalog))) needed.set(clipKey(voice, step.narration), step.narration);
}

const clips = await loadClips();
const kept = {};
const missing = [];
for (const [key, text] of needed) {
  if (clips[key]) kept[key] = { text, duration: clips[key].duration };
  else missing.push([key, text]);
}

// The keys that narration/clips.json lists, with or without their files.
async function loadListed() {
  return JSON.parse(await readFile(CLIPS_PATH, "utf8").catch(() => "{}")).clips ?? {};
}

// Writes the list of the clips, in the order of their keys.
async function writeClips() {
  const sorted = Object.fromEntries(Object.keys(kept).sort().map((key) => [key, kept[key]]));
  await writeFile(CLIPS_PATH, `${JSON.stringify({ clips: sorted }, null, 2)}\n`);
}

const characters = missing.reduce((count, [, text]) => count + text.length, 0);
if (missing.length > 0) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    for (const [, text] of missing) console.error(`narrate: no clip of: ${text}`);
    console.error(`narrate: ${missing.length} clip(s) to make, ${characters} characters; they need the key of the speech service, in its file or in OPENROUTER_API_KEY (docs/authoring.md, Narration, The key)`);
    process.exit(1);
  }
  await mkdir(CLIPS_DIR, { recursive: true });
  for (const [key, text] of missing) {
    const duration = await encode(await speak(voice, text, apiKey), clipFile(key));
    kept[key] = { text, duration };
    // After each clip, so that a failure keeps those already paid for.
    await writeClips();
    console.error(`narrate: ${key} ${duration} s: ${text}`);
  }
}

const unused = (await readdir(CLIPS_DIR).catch(() => [])).filter((file) => !(file.slice(0, -4) in kept) || !file.endsWith(".mp3"));
const listed = Object.keys(await loadListed()).filter((key) => !(key in kept));
// In CI, narration/ must be as a render leaves it: nothing to remove.
if (process.env.CI && unused.length + listed.length > 0) {
  console.error(`narrate: narration/ holds ${unused.length} file(s) and lists ${listed.length} clip(s) that no tutorial uses; run scripts/tooling.sh narrate and commit narration/`);
  process.exit(1);
}
for (const file of unused) await rm(join(CLIPS_DIR, file));
const removed = unused.length;
if (removed > 0 || listed.length > 0) await writeClips();
console.error(
  `narrate: ${needed.size} clip(s) of ${voice.model}, ${voice.voice}: made ${missing.length} (${characters} characters), removed ${removed}`,
);
