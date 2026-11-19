// The narration of the tutorials (docs/authoring.md, Narration): the voice
// that reads the narration of each shown step, narration/voice.json, and its
// clips, narration/clips/<key>.mp3, one for each sentence, which
// narration/clips.json lists with their text and duration. The key of a clip
// is the hash of its text and of the model and the voice that read it, so a
// changed sentence or voice needs a new clip, and an unchanged one never does.
// src/narrate.mjs makes the clips; a speech service returns another reading
// of the same text each time, so the repository keeps them.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonical, sha256, shownSteps } from "./script.mjs";

export const VOICE_PATH = "narration/voice.json";
export const CLIPS_PATH = "narration/clips.json";
export const CLIPS_DIR = "narration/clips";

// The voice: the model of the speech service, and its voice.
export async function loadVoice() {
  const voice = JSON.parse(await readFile(VOICE_PATH, "utf8"));
  for (const key of ["model", "voice"]) {
    if (typeof voice[key] !== "string" || voice[key] === "") throw new Error(`${VOICE_PATH}: ${key} is required`);
  }
  return voice;
}

// The clips that the repository holds, by key: { text, duration }, in seconds,
// each with the hash of its file. A clip that the list names without its file
// is to make again.
export async function loadClips() {
  let listed;
  try {
    listed = JSON.parse(await readFile(CLIPS_PATH, "utf8")).clips ?? {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`${CLIPS_PATH}: ${error.message}`);
  }
  const held = {};
  for (const [key, clip] of Object.entries(listed)) {
    const file = await readFile(clipFile(key)).catch(() => null);
    if (file) held[key] = { ...clip, hash: sha256(file) };
  }
  return held;
}

export function clipKey(voice, text) {
  return sha256(canonical({ model: voice.model, voice: voice.voice, text })).slice("sha256:".length, "sha256:".length + 24);
}

export const clipFile = (key) => join(CLIPS_DIR, `${key}.mp3`);

// The clip of each shown step of a tutorial, in order: the id of the step,
// its key, its text, and its duration, null while the clip is to make.
export function narrationOf(tutorial, voice, clips) {
  return shownSteps(tutorial).map((step) => {
    const key = clipKey(voice, step.narration);
    return { step: step.id, key, text: step.narration, duration: clips[key]?.duration ?? null, hash: clips[key]?.hash ?? null };
  });
}

// The hash of the narration of a tutorial, which tutorials.lock.json records:
// the keys, the durations, and the files of its clips, so that another voice,
// or another reading of a sentence, makes its video stale. Null while a clip
// is to make.
export function narrationHash(tutorial, voice, clips) {
  const narration = narrationOf(tutorial, voice, clips);
  if (narration.some((clip) => clip.duration === null)) return null;
  return sha256(canonical(narration.map(({ key, duration, hash }) => [key, duration, hash])));
}
