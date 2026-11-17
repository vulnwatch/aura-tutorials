// The tutorials as a set: their scripts and flows, the catalog of tasks that
// they cover, and tutorials.lock.json, which records for each video what it
// was rendered from: the version of Aura, the hash of its resolved script, the
// hash of the generator, and the fingerprints of its screenshots. A video is
// up to date while all of them are current; a capture of a new version of Aura
// whose fingerprints equal the recorded ones needs no new video.
//
// Usage: node src/tutorials.mjs <command> [args]
//   list                 The tutorials, with their chapters, user, and tasks
//   validate             Check every script, flow, and the catalog
//   status [--ids]       The state of each video against the lock; --ids
//                        prints only the ids of those that are not up to date
//   coverage             The tasks of the catalog and the tutorials that cover
//                        them
//   changes-data <id>    Succeed when the tutorial changes data
//   compare <id>         Compare the capture in out/<id>/capture with the
//                        lock, and with out/<id>/capture.previous when it
//                        exists; write out/<id>/compare.json
//   verify <id>          Record that the video is current for this version of
//                        Aura, once compare found its screens unchanged
//   lock <id>            Record the video just rendered from out/<id>/
//   report <id>...       Write out/report/check.md from the comparisons
//
// AURA_VERSION names the version of Aura that the submodule holds.

import { execFile } from "node:child_process";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
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
// What a video depends on besides its resolved script, whose hash covers it,
// and its screenshots: the image of the tools, the dependencies, and the code
// that captures and composes.
const GENERATOR_FILES = ["Containerfile", "package-lock.json", "src/capture.mjs", "src/compose.mjs"];
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

async function generatorHash() {
  const parts = [];
  for (const file of GENERATOR_FILES) {
    parts.push(`${file}\n${await readFile(file, "utf8")}`);
  }
  return sha256(parts.join("\n"));
}

function requireAura() {
  if (!aura) throw new Error("AURA_VERSION is not set");
  return aura;
}

// The state of a video against its entry of the lock.
function stateOf(tutorial, entry, generator) {
  if (!entry) return "new";
  if (entry.script !== tutorial.hash) return "script-changed";
  if (entry.generator !== generator) return "generator-changed";
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
  for (const tutorial of tutorials) {
    const state = stateOf(tutorial, lock.tutorials[tutorial.id], generator);
    if (args.includes("--ids")) {
      if (state !== "up-to-date") console.log(tutorial.id);
    } else {
      console.log(`${tutorial.id}\t${state}`);
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

async function changesData([id]) {
  const tutorial = await loadTutorial(id);
  process.exitCode = tutorial.changesData ? 0 : 1;
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
  if (entry.script !== tutorial.hash || entry.generator !== (await generatorHash())) {
    throw new Error(`verify: ${id} has another script or generator than its video; render it`);
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
  const lock = await readLock();
  lock.tutorials[id] = {
    title: tutorial.title,
    aura,
    script: tutorial.hash,
    generator: await generatorHash(),
    duration: composed.duration,
    chapters: composed.chapters,
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

const [command, ...args] = process.argv.slice(2);
const commands = {
  list,
  validate,
  status,
  coverage,
  "changes-data": changesData,
  compare,
  verify,
  lock: lockCommand,
  report,
};
if (!commands[command]) {
  console.error("usage: node src/tutorials.mjs list|validate|status|coverage|changes-data|compare|verify|lock|report");
  process.exit(2);
}
try {
  await commands[command](args);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
