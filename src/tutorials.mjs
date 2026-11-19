// The tutorials as a set: their scripts and flows, the catalog of tasks that
// they cover, and tutorials.lock.json, which records for each video what it
// was rendered from: the version of Aura, the hash of its resolved script, the
// hash of the generator, the code that captures and composes, the hash of its
// narration, the clips that its voice reads (src/lib/narration.mjs), the hash
// of the tooling, and the fingerprints of its screenshots; and its title, subtitle,
// duration, chapters, and steps, with their captions and times, which
// describe it to the website (src/site.mjs) and in videos.json of a release.
// A video is up to date
// while its script, the generator, its narration, and the version of Aura are
// current; a
// capture of a new version of Aura whose fingerprints equal the recorded ones
// needs no new video. The tooling, the image and the dependencies, only shows
// what the video was rendered with: an update of it that leaves the screens
// unchanged needs no new video either (docs/authoring.md, Update the Tools).
//
// Usage: node src/tutorials.mjs <command> [args]
//   list                 The tutorials, with their chapters, user, and tasks
//   validate             Check every script, flow, and the catalog
//   status [--ids]       The state of each video against the lock; --ids
//                        prints only the ids of those that are not up to date
//   coverage             The tasks of the catalog and the tutorials that cover
//                        them
//   hashes               The id of each tutorial and the hash of its resolved
//                        script, separated by a tab
//   changes-data <id>    Succeed when the tutorial changes data
//   captured <id>        Succeed when out/<id>/capture holds a capture of the
//                        current script and version of Aura
//   compare <id>         Compare the capture in out/<id>/capture with the
//                        lock, and with out/<id>/capture.previous when it
//                        exists; write out/<id>/compare.json
//   verify <id>          Record that the video is current for this version of
//                        Aura, once compare found its screens unchanged
//   lock <id>            Record the video just rendered from out/<id>/
//   report <id>...       Write out/report/check.md from the comparisons
//   findings <id>...     Print the findings of the checks of the composition
//                        of each tutorial, from out/<id>/compose.json; fails
//                        when there is one
//   frames <id> [<s>...] Extract frames of the video out/<id>/<id>.mp4 into
//                        out/<id>/frames/: each step at its focus and before
//                        its end, a contact sheet of each chapter, one of the
//                        cards, and frames.md, which lists them; with times in
//                        seconds, only the frames at those times, at-<s>.png
//
// AURA_VERSION names the version of Aura that the submodule holds.

import { execFile } from "node:child_process";
import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadClips, loadVoice, narrationHash } from "./lib/narration.mjs";
import {
  CATALOG_PATH,
  FLOWS_DIR,
  loadCatalog,
  loadTutorial,
  sha256,
  tutorialIds,
} from "./lib/script.mjs";

const execFileAsync = promisify(execFile);
const LOCK_PATH = "tutorials.lock.json";
// The generator, which decides how a video looks besides its resolved script,
// whose hash covers it, and its screenshots: the code that captures and
// composes. A change of it makes every video stale.
const GENERATOR_FILES = ["src/capture.mjs", "src/compose.mjs"];
// The tooling, which the lock records without making a video stale: the image
// of the tools and the dependencies.
const TOOLING_FILES = ["Containerfile", "package-lock.json"];
const STATUSES = ["available", "partial", "not-in-aura"];

const aura = process.env.AURA_VERSION;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error.code === "ENOENT") return fallback;
    throw new Error(`${path}: ${error.message}`);
  }
}

async function readLock() {
  const lock = await readJson(LOCK_PATH, {});
  return { tutorials: lock.tutorials ?? {} };
}

async function writeLock(lock) {
  const sorted = Object.fromEntries(Object.keys(lock.tutorials).sort().map((key) => [key, lock.tutorials[key]]));
  await writeFile(LOCK_PATH, `${JSON.stringify({ tutorials: sorted }, null, 2)}\n`);
}

async function filesHash(files) {
  const parts = [];
  for (const file of files) {
    parts.push(`${file}\n${await readFile(file, "utf8")}`);
  }
  return sha256(parts.join("\n"));
}

const generatorHash = () => filesHash(GENERATOR_FILES);
const toolingHash = () => filesHash(TOOLING_FILES);

function requireAura() {
  if (!aura) throw new Error("AURA_VERSION is not set");
  return aura;
}

// The state of a video against its entry of the lock.
function stateOf(tutorial, entry, generator, narration) {
  if (!entry) return "new";
  if (entry.script !== tutorial.hash) return "script-changed";
  if (entry.generator !== generator) return "generator-changed";
  if (entry.narration !== narration) return "narration-changed";
  if (entry.aura !== aura) return "aura-changed";
  return "up-to-date";
}

async function loadAll() {
  const catalog = await loadCatalog();
  const tutorials = [];
  for (const id of await tutorialIds()) {
    tutorials.push(await loadTutorial(id, catalog));
  }
  return { catalog, tutorials };
}

// --- Commands -----------------------------------------------------------

async function list() {
  const { tutorials } = await loadAll();
  for (const tutorial of tutorials) {
    const steps = tutorial.chapters.reduce((count, chapter) => count + chapter.steps.length, 0);
    console.log(
      `${tutorial.id}\t${tutorial.title}\t${tutorial.chapters.length} chapter(s), ${steps} steps\tas ${tutorial.user}${tutorial.changesData ? ", changes data" : ""}\tcovers ${tutorial.covers.join(", ")}`,
    );
  }
}

async function validate() {
  const problems = [];
  let catalog;
  try {
    catalog = await loadCatalog();
    const profiles = new Set(catalog.profiles.map((profile) => profile.id));
    const ids = new Set();
    for (const task of catalog.tasks) {
      if (ids.has(task.id)) problems.push(`${CATALOG_PATH}: task "${task.id}" twice`);
      ids.add(task.id);
      if (!profiles.has(task.profile)) problems.push(`${CATALOG_PATH}: task "${task.id}" of no profile "${task.profile}"`);
      if (!STATUSES.includes(task.status)) problems.push(`${CATALOG_PATH}: task "${task.id}" has status "${task.status}", not one of ${STATUSES.join(", ")}`);
      if (task.status !== "available" && !task.notes) problems.push(`${CATALOG_PATH}: task "${task.id}" is ${task.status} and needs notes`);
    }
  } catch (error) {
    problems.push(error.message);
  }
  const ids = await tutorialIds();
  for (const id of ids) {
    try {
      await loadTutorial(id, catalog);
    } catch (error) {
      problems.push(error.message);
    }
  }
  // A flow that no tutorial includes is checked through a tutorial of its own
  // only, so each flow must be included somewhere.
  const used = new Set();
  for (const id of ids) {
    const script = await readJson(join("tutorials", `${id}.json`));
    for (const step of [...(script.setup ?? []), ...(script.chapters ?? []).flatMap((chapter) => chapter.steps ?? [])]) {
      if (step?.include) used.add(step.include);
    }
  }
  for (const file of await readdir(FLOWS_DIR).catch(() => [])) {
    const flow = file.replace(/\.json$/, "");
    if (!used.has(flow)) problems.push(`${FLOWS_DIR}/${file}: no tutorial includes it`);
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.error(`validate: ${ids.length} tutorials, their flows, and the catalog are valid`);
}

async function status(args) {
  requireAura();
  const { tutorials } = await loadAll();
  const lock = await readLock();
  const generator = await generatorHash();
  const tooling = await toolingHash();
  const voice = await loadVoice();
  const clips = await loadClips();
  for (const tutorial of tutorials) {
    const entry = lock.tutorials[tutorial.id];
    // Null while a clip is to make, which no entry records.
    const state = stateOf(tutorial, entry, generator, narrationHash(tutorial, voice, clips));
    if (args.includes("--ids")) {
      if (state !== "up-to-date") console.log(tutorial.id);
    } else {
      const note = state === "up-to-date" && entry.tooling !== tooling ? "\trendered with earlier tooling" : "";
      console.log(`${tutorial.id}\t${state}${note}`);
    }
  }
  for (const id of Object.keys(lock.tutorials)) {
    if (!tutorials.some((tutorial) => tutorial.id === id)) console.error(`status: ${LOCK_PATH} records ${id}, which has no script`);
  }
}

async function coverage() {
  const { catalog, tutorials } = await loadAll();
  const byTask = new Map(catalog.tasks.map((task) => [task.id, []]));
  for (const tutorial of tutorials) {
    for (const task of tutorial.covers) byTask.get(task).push(tutorial.id);
  }
  for (const profile of catalog.profiles) {
    console.log(`${profile.name}`);
    for (const task of catalog.tasks.filter((candidate) => candidate.profile === profile.id)) {
      const covered = byTask.get(task.id);
      const mark = covered.length > 0 ? "covered" : task.status === "not-in-aura" ? "not in Aura" : "UNCOVERED";
      console.log(`  ${mark.padEnd(11)} ${task.id} (${task.status})${covered.length ? `: ${covered.join(", ")}` : ""}`);
    }
  }
  const uncovered = catalog.tasks.filter((task) => task.status !== "not-in-aura" && byTask.get(task.id).length === 0);
  console.log(`\n${uncovered.length} task(s) that Aura shows, at least in part, have no tutorial.`);
}

async function hashes() {
  const { tutorials } = await loadAll();
  for (const tutorial of tutorials) console.log(`${tutorial.id}\t${tutorial.hash}`);
}

async function changesData([id]) {
  const tutorial = await loadTutorial(id);
  process.exitCode = tutorial.changesData ? 0 : 1;
}

async function captured([id]) {
  requireAura();
  const tutorial = await loadTutorial(id);
  const capture = await readJson(join("out", id, "capture", "capture.json"), null);
  process.exitCode = capture && capture.script === tutorial.hash && capture.aura === aura ? 0 : 1;
}

// The frames of a capture, keyed by step and kind, in order.
function framesOf(capture) {
  return capture.steps.flatMap((step) => step.frames.map((frame) => ({ key: `${step.id}/${frame.kind}`, step: step.id, ...frame })));
}

async function compare([id]) {
  const tutorial = await loadTutorial(id);
  const capture = await readJson(join("out", id, "capture", "capture.json"));
  if (capture.script !== tutorial.hash) throw new Error(`the capture of ${id} is of another version of its script`);
  const entry = (await readLock()).tutorials[id];
  const after = framesOf(capture);
  const previous = await readJson(join("out", id, "capture.previous", "capture.json"), null);
  const beforeFiles = new Map((previous ? framesOf(previous) : []).map((frame) => [frame.key, frame.file]));
  const result = { tutorial: id, aura, status: "new", changed: [] };
  if (entry) {
    const recorded = entry.frames ?? [];
    const same = recorded.length === after.length && after.every((frame, index) => frame.fingerprint === recorded[index]);
    result.status = same ? "unchanged" : "changed";
    if (!same) {
      result.frames = { recorded: recorded.length, captured: after.length };
      after.forEach((frame, index) => {
        if (frame.fingerprint !== recorded[index]) {
          result.changed.push({ index, step: frame.step, kind: frame.kind, after: frame.file, before: beforeFiles.get(frame.key) ?? null });
        }
      });
    }
  }
  await writeFile(join("out", id, "compare.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(result.status);
}

async function verify([id]) {
  requireAura();
  const tutorial = await loadTutorial(id);
  const lock = await readLock();
  const entry = lock.tutorials[id];
  const result = await readJson(join("out", id, "compare.json"));
  if (!entry || result.status !== "unchanged") throw new Error(`verify: the screens of ${id} changed or were never rendered`);
  const narration = narrationHash(tutorial, await loadVoice(), await loadClips());
  if (entry.script !== tutorial.hash || entry.generator !== (await generatorHash()) || entry.narration !== narration) {
    throw new Error(`verify: ${id} has another script, generator, or narration than its video; render it`);
  }
  entry.aura = aura;
  await writeLock(lock);
  console.error(`verify: the video of ${id} is current for Aura ${aura}`);
}

async function lockCommand([id]) {
  requireAura();
  const tutorial = await loadTutorial(id);
  const capture = await readJson(join("out", id, "capture", "capture.json"));
  const composed = await readJson(join("out", id, "compose.json"));
  if (capture.script !== tutorial.hash || composed.script !== tutorial.hash) {
    throw new Error(`lock: the capture or the composition of ${id} is of another version of its script`);
  }
  if (capture.aura !== aura) throw new Error(`lock: ${id} was captured from Aura ${capture.aura}, not ${aura}`);
  const narration = narrationHash(tutorial, await loadVoice(), await loadClips());
  if (!narration || composed.narration !== narration) {
    throw new Error(`lock: the composition of ${id} has another narration than narration/; render it again`);
  }
  const lock = await readLock();
  lock.tutorials[id] = {
    title: tutorial.title,
    subtitle: tutorial.subtitle,
    aura,
    script: tutorial.hash,
    generator: await generatorHash(),
    narration,
    tooling: await toolingHash(),
    duration: composed.duration,
    chapters: composed.chapters,
    // The steps of the video: their captions, which the search of the site
    // looks in, and their times, for the readers of videos.json.
    steps: composed.steps.map(({ id: step, chapter, caption, start, end }) => ({ id: step, chapter, caption, start, end })),
    covers: tutorial.covers,
    frames: framesOf(capture).map((frame) => frame.fingerprint),
  };
  await writeLock(lock);
  console.error(`lock: recorded the video of ${id}`);
}

// Writes the earlier and the current screenshot of a changed screen side by
// side, at half their size.
async function sideBySide(id, frame) {
  const output = join("out", "report", id, `${String(frame.index).padStart(3, "0")}.png`);
  await mkdir(join("out", "report", id), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", join("out", id, "capture.previous", frame.before),
    "-i", join("out", id, "capture", frame.after),
    "-filter_complex", "[0][1]hstack,scale=iw/2:-1",
    output,
  ]);
}

async function report(ids) {
  const lines = [`# Check of the tutorials against Aura ${aura ?? "?"}`, ""];
  const groups = { unchanged: [], changed: [], new: [], broken: [] };
  for (const id of ids) {
    const result = await readJson(join("out", id, "compare.json"), { tutorial: id, status: "broken" });
    groups[result.status].push(result);
    for (const frame of result.changed ?? []) {
      if (frame.before) await sideBySide(id, frame);
    }
  }
  const describe = {
    unchanged: "Unchanged: the screens are the same, the videos stay",
    changed: "Changed: the screens differ, render the videos again",
    new: "New: never rendered",
    broken: "Broken: the capture failed, the script needs a change",
  };
  for (const [status, results] of Object.entries(groups)) {
    if (results.length === 0) continue;
    lines.push(`## ${describe[status]}`, "");
    for (const result of results) {
      lines.push(`- \`${result.tutorial}\``);
      if (status === "changed") {
        if (result.frames.recorded !== result.frames.captured) {
          lines.push(`  - ${result.frames.captured} screenshots instead of ${result.frames.recorded}`);
        }
        for (const frame of result.changed) {
          lines.push(
            frame.before
              ? `  - ${frame.step} (${frame.kind}): \`out/report/${result.tutorial}/${String(frame.index).padStart(3, "0")}.png\`, earlier on the left`
              : `  - ${frame.step} (${frame.kind}): \`out/${result.tutorial}/capture/${frame.after}\`, no earlier capture to compare`,
          );
        }
      }
      if (status === "broken") lines.push(`  - \`out/${result.tutorial}/capture/failure.png\` shows where it stopped`);
    }
    lines.push("");
  }
  await mkdir(join("out", "report"), { recursive: true });
  await writeFile(join("out", "report", "check.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  if (groups.changed.length + groups.new.length + groups.broken.length > 0) process.exitCode = 1;
}

// --- The review of a video ------------------------------------------------

// The composition of a tutorial, out/<id>/compose.json, which must be of its
// current script and hold the times and the findings of src/compose.mjs.
async function composedOf(id) {
  const tutorial = await loadTutorial(id);
  const composed = await readJson(join("out", id, "compose.json"));
  if (composed.script !== tutorial.hash) {
    throw new Error(`the composition of ${id} is of another version of its script; render it again`);
  }
  if (!Array.isArray(composed.steps) || !Array.isArray(composed.findings)) {
    throw new Error(`the composition of ${id} has no times or findings; render it again`);
  }
  return composed;
}

async function findings(ids) {
  if (ids.length === 0) throw new Error("findings: name the tutorials");
  let count = 0;
  for (const id of ids) {
    for (const finding of (await composedOf(id)).findings) {
      console.error(`${id}: step ${finding.number} (${finding.step}) at ${finding.at} s: ${finding.check}: ${finding.message}`);
      count += 1;
    }
  }
  if (count > 0) {
    console.error(`findings: ${count} finding(s) of the checks (docs/authoring.md, Review)`);
    process.exitCode = 1;
  } else {
    console.error(`findings: the checks found nothing in ${ids.join(", ")}`);
  }
}

// The tiles of a contact sheet, two to a row.
const TILE = { width: 800, height: 450 };
// How long before the end of a step its last frame is taken: the result of
// its action shows, before the next step moves the camera.
const BEFORE_END = 0.5;

const round = (value) => Math.round(value * 1000) / 1000;

function ffmpeg(args) {
  return execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

function extractFrame(video, at, output) {
  return ffmpeg(["-ss", String(at), "-i", video, "-frames:v", "1", "-update", "1", output]);
}

// Writes a contact sheet of the frames, two to a row, each with its label,
// which holds only letters, digits, spaces, hyphens, and periods.
function contactSheet(frames, output) {
  const tiles = frames.map(
    (frame, index) =>
      `[${index}]scale=${TILE.width}:${TILE.height},drawtext=text='${frame.label}':x=14:y=14:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=8[t${index}]`,
  );
  const layout = frames.map((_, index) => `${(index % 2) * TILE.width}_${Math.floor(index / 2) * TILE.height}`).join("|");
  const sheet =
    frames.length === 1
      ? "[t0]null[sheet]"
      : `${frames.map((_, index) => `[t${index}]`).join("")}xstack=inputs=${frames.length}:layout=${layout}:fill=black[sheet]`;
  return ffmpeg([
    ...frames.flatMap((frame) => ["-i", frame.file]),
    "-filter_complex", [...tiles, sheet].join(";"),
    "-map", "[sheet]", "-frames:v", "1", "-update", "1", output,
  ]);
}

async function frames([id, ...times]) {
  if (!id) throw new Error("frames: name a tutorial");
  const composed = await composedOf(id);
  const video = join("out", id, `${id}.mp4`);
  const rendered = await stat(video).catch(() => null);
  if (!rendered || rendered.mtimeMs < (await stat(join("out", id, "compose.json"))).mtimeMs) {
    throw new Error(`the video of ${id} is missing or older than its composition; render it again`);
  }
  const dir = join("out", id, "frames");
  if (times.length > 0) {
    await mkdir(dir, { recursive: true });
    for (const time of times) {
      const at = Number(time);
      if (!Number.isFinite(at) || at < 0 || at > composed.duration) {
        throw new Error(`frames: ${time} is not a time of the video, from 0 to ${composed.duration} s`);
      }
      await extractFrame(video, at, join(dir, `at-${at}.png`));
    }
    console.error(`frames: ${times.length} frame(s) of ${id} in ${dir}/at-<s>.png`);
    return;
  }

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const pad = (number) => String(number).padStart(2, "0");
  const lines = [
    `# Frames of ${id}`,
    "",
    `The video \`out/${id}/${id}.mp4\`, ${composed.duration} s, from the current script; the times are in seconds of the video. Each step has a frame at its focus, when the camera has settled on what it points at, and one ${BEFORE_END} s before its end, with the result of its action. The contact sheets hold every frame below at a smaller size, each labeled with its step, moment, and time, for where only they are kept, as in the artifact of CI.`,
    "",
    "## Cards (`cards.png`)",
    "",
    "| Card | Start | End | Frame |",
    "|---|---|---|---|",
  ];
  const cardFrames = [];
  for (const [index, card] of composed.cards.entries()) {
    const kind = index === 0 ? "intro" : index === composed.cards.length - 1 ? "outro" : `chapter-${index}`;
    const file = join(dir, `card-${kind}.png`);
    const at = round((card.start + card.end) / 2);
    await extractFrame(video, at, file);
    cardFrames.push({ file, label: `${kind.replace("-", " ")} ${at}s` });
    lines.push(`| ${card.title} | ${card.start} | ${card.end} | \`card-${kind}.png\` |`);
  }
  await contactSheet(cardFrames, join(dir, "cards.png"));

  for (const [index, chapter] of composed.chapters.entries()) {
    const steps = composed.steps.filter((step) => step.chapter === index + 1);
    lines.push(
      "",
      `## Chapter ${index + 1}: ${chapter.title} (\`chapter-${index + 1}.png\`)`,
      "",
      "| Step | Caption | Start | Focus | End | Frames |",
      "|---|---|---|---|---|---|",
    );
    const sheet = [];
    for (const step of steps) {
      const moments = [
        ["focus", step.focus],
        ["end", round(step.end - BEFORE_END)],
      ];
      const names = [];
      for (const [moment, at] of moments) {
        const name = `${pad(step.number)}-${step.id}-${moment}.png`;
        await extractFrame(video, at, join(dir, name));
        sheet.push({ file: join(dir, name), label: `${step.number} ${step.id} ${moment} ${at}s` });
        names.push(`\`${name}\``);
      }
      lines.push(`| ${step.number} \`${step.id}\` | ${step.caption} | ${step.start} | ${step.focus} | ${step.end} | ${names.join(", ")} |`);
    }
    await contactSheet(sheet, join(dir, `chapter-${index + 1}.png`));
  }

  lines.push("", "## Findings of the checks", "");
  if (composed.findings.length === 0) lines.push("None.");
  for (const finding of composed.findings) {
    lines.push(`- Step ${finding.number} (\`${finding.step}\`) at ${finding.at} s: \`${finding.check}\`: ${finding.message}`);
  }
  await writeFile(join(dir, "frames.md"), `${lines.join("\n")}\n`);
  console.error(`frames: the frames and contact sheets of ${id} are in ${dir}; ${dir}/frames.md lists them`);
}

const [command, ...args] = process.argv.slice(2);
const commands = {
  list,
  validate,
  status,
  coverage,
  hashes,
  "changes-data": changesData,
  captured,
  compare,
  verify,
  lock: lockCommand,
  report,
  findings,
  frames,
};
if (!commands[command]) {
  console.error("usage: node src/tutorials.mjs list|validate|status|coverage|hashes|changes-data|captured|compare|verify|lock|report|findings|frames");
  process.exit(2);
}
try {
  await commands[command](args);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
