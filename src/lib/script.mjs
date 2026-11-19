// Tutorial scripts (docs/authoring.md): loading, the inclusion of flows, the
// variables, the validation, and the hash that identifies the content of a
// script once resolved, which tutorials.lock.json records.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const TUTORIALS_DIR = "tutorials";
export const FLOWS_DIR = "flows";
export const CATALOG_PATH = "catalog/tasks.json";

// The published password of every user of Sentinel's example dataset (Sentinel
// docs/features/platform/example-dataset.md, Credentials), whose data is
// fictional.
export const DATASET_PASSWORD = "example-dataset-password";

export const ACTIONS = ["goto", "fill", "click", "press", "show"];

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VARIABLE = /\{([A-Za-z][\w-]*)\}/g;

const SCRIPT_KEYS = ["title", "subtitle", "outro", "user", "covers", "changesData", "vars", "setup", "chapters"];
const OUTRO_KEYS = ["title", "subtitle"];
const CHAPTER_KEYS = ["title", "steps"];
const INCLUDE_KEYS = ["include", "with"];
const STEP_KEYS = [
  "id", "action", "path", "target", "value", "key", "waitFor", "waitForUrl",
  "zoom", "duration", "hold", "caption", "narration",
];
const LOCATOR_KEYS = ["role", "name", "level", "exact", "label", "text", "nth", "child", "allHaveText"];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

async function idsIn(dir) {
  const files = await readdir(dir).catch(() => []);
  return files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).sort();
}

export function tutorialIds() {
  return idsIn(TUTORIALS_DIR);
}

export function loadCatalog() {
  return readJson(CATALOG_PATH);
}

// --- Validation ---------------------------------------------------------

class Problems {
  constructor() {
    this.list = [];
  }
  add(where, message) {
    this.list.push(`${where}: ${message}`);
  }
  unknownKeys(where, object, allowed) {
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) this.add(where, `unknown key "${key}"`);
    }
  }
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";

function checkLocator(problems, where, spec) {
  const parts = Array.isArray(spec) ? spec : [spec];
  if (parts.length === 0) problems.add(where, "an empty locator chain");
  parts.forEach((part, index) => {
    const at = Array.isArray(spec) ? `${where}[${index}]` : where;
    if (!isObject(part)) {
      problems.add(at, "a locator is an object");
      return;
    }
    problems.unknownKeys(at, part, LOCATOR_KEYS);
    const kinds = ["role", "label", "text"].filter((key) => part[key] !== undefined);
    if (kinds.length !== 1) problems.add(at, "a locator has one of role, label, or text");
    if (part.child !== undefined) checkLocator(problems, `${at}.child`, part.child);
    if (part.allHaveText !== undefined) {
      try {
        new RegExp(part.allHaveText);
      } catch {
        problems.add(at, "allHaveText is not a regular expression");
      }
    }
  });
}

// Checks a step of a chapter, or of the setup when `shown` is false, which
// needs neither caption nor narration.
function checkStep(problems, where, step, shown) {
  if (!isObject(step)) {
    problems.add(where, "a step is an object");
    return;
  }
  if (step.include !== undefined) {
    problems.unknownKeys(where, step, INCLUDE_KEYS);
    if (!ID.test(step.include)) problems.add(where, "include names a flow of flows/");
    if (step.with !== undefined && !Object.values(step.with ?? {}).every((value) => typeof value === "string")) {
      problems.add(where, "with maps variables to strings");
    }
    return;
  }
  problems.unknownKeys(where, step, STEP_KEYS);
  if (!ID.test(step.id ?? "")) problems.add(where, "id is lowercase words joined by hyphens");
  if (!ACTIONS.includes(step.action)) problems.add(where, `action is one of ${ACTIONS.join(", ")}`);
  if (step.action === "goto" && !isText(step.path)) problems.add(where, "goto needs a path");
  if (["fill", "click"].includes(step.action) && step.target === undefined) {
    problems.add(where, `${step.action} needs a target`);
  }
  if (step.action === "fill" && typeof step.value !== "string") problems.add(where, "fill needs a value");
  if (step.action === "press" && !isText(step.key)) problems.add(where, "press needs a key, such as Enter");
  if (step.target !== undefined) checkLocator(problems, `${where}.target`, step.target);
  for (const condition of [step.waitFor ?? []].flat()) {
    checkLocator(problems, `${where}.waitFor`, condition);
  }
  if (step.waitForUrl !== undefined) {
    try {
      new RegExp(step.waitForUrl);
    } catch {
      problems.add(where, "waitForUrl is not a regular expression");
    }
  }
  if (step.zoom !== undefined && !(typeof step.zoom === "number" && step.zoom >= 1 && step.zoom <= 3)) {
    problems.add(where, "zoom is a number from 1 to 3");
  }
  for (const key of ["duration", "hold"]) {
    if (step[key] !== undefined && !(typeof step[key] === "number" && step[key] >= 0)) {
      problems.add(where, `${key} is a number of seconds`);
    }
  }
  if (shown) {
    if (!isText(step.caption)) problems.add(where, "a shown step needs a caption");
    if (!isText(step.narration)) problems.add(where, "a shown step needs a narration");
  }
  // The click lands early in the sentence of its step (src/compose.mjs,
  // CLICK_AFTER_VOICE_START), so the sentence names the action first.
  if (step.action === "click" && isText(step.narration) && !/^(Select|Open) /.test(step.narration)) {
    problems.add(where, 'the narration of a click starts with its action, "Select" or "Open" (docs/authoring.md, Style)');
  }
}

function checkFlow(problems, where, flow) {
  if (!isObject(flow)) {
    problems.add(where, "a flow is an object");
    return;
  }
  problems.unknownKeys(where, flow, ["description", "steps"]);
  if (!isText(flow.description)) problems.add(where, "a flow needs a description");
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
    problems.add(where, "a flow needs steps");
    return;
  }
  // Whether a step of a flow is shown depends on where it is included, so a
  // flow gives every step a caption and a narration.
  flow.steps.forEach((step, index) => {
    if (step?.include !== undefined) problems.add(`${where}.steps[${index}]`, "a flow includes no other flow");
    else checkStep(problems, `${where}.steps[${index}]`, step, true);
  });
}

function checkScript(problems, where, script, taskIds) {
  if (!isObject(script)) {
    problems.add(where, "a script is an object");
    return;
  }
  problems.unknownKeys(where, script, SCRIPT_KEYS);
  if (!isText(script.title)) problems.add(where, "title is required");
  if (script.subtitle !== undefined && !isText(script.subtitle)) problems.add(where, "subtitle is a text");
  if (script.outro !== undefined) {
    if (!isObject(script.outro)) problems.add(`${where}.outro`, "outro is an object");
    else {
      problems.unknownKeys(`${where}.outro`, script.outro, OUTRO_KEYS);
      if (!isText(script.outro.title)) problems.add(`${where}.outro`, "title is required");
    }
  }
  if (!isText(script.user)) problems.add(where, "user names a user of the example dataset");
  if (!Array.isArray(script.covers) || script.covers.length === 0) {
    problems.add(where, "covers lists the tasks of catalog/tasks.json that the tutorial shows");
  } else {
    for (const task of script.covers) {
      if (!taskIds.has(task)) problems.add(`${where}.covers`, `no task "${task}" in ${CATALOG_PATH}`);
    }
  }
  if (script.changesData !== undefined && typeof script.changesData !== "boolean") {
    problems.add(where, "changesData is true or false");
  }
  if (script.vars !== undefined && !(isObject(script.vars) && Object.values(script.vars).every((value) => typeof value === "string"))) {
    problems.add(where, "vars maps names to strings");
  }
  (script.setup ?? []).forEach((step, index) => checkStep(problems, `${where}.setup[${index}]`, step, false));
  if (!Array.isArray(script.chapters) || script.chapters.length === 0) {
    problems.add(where, "chapters lists at least one chapter");
    return;
  }
  script.chapters.forEach((chapter, index) => {
    const at = `${where}.chapters[${index}]`;
    if (!isObject(chapter)) {
      problems.add(at, "a chapter is an object");
      return;
    }
    problems.unknownKeys(at, chapter, CHAPTER_KEYS);
    if (!isText(chapter.title)) problems.add(at, "a chapter needs a title");
    if (!Array.isArray(chapter.steps) || chapter.steps.length === 0) problems.add(at, "a chapter needs steps");
    else chapter.steps.forEach((step, stepIndex) => checkStep(problems, `${at}.steps[${stepIndex}]`, step, true));
  });
}

// --- Resolution ---------------------------------------------------------

// Replaces each {name} of the strings of a value with its variable.
function interpolate(value, vars, where) {
  if (typeof value === "string") {
    return value.replace(VARIABLE, (match, name) => {
      if (!(name in vars)) throw new Error(`${where}: no variable "${name}"`);
      return vars[name];
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, vars, where));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, vars, where)]));
  }
  return value;
}

// Expands the includes of a list of steps with the steps of their flows, each
// id prefixed with the flow's, and interpolates the variables.
async function expand(steps, vars, where, flows) {
  const expanded = [];
  for (const [index, step] of steps.entries()) {
    if (step.include === undefined) {
      expanded.push(interpolate(step, vars, `${where}[${index}]`));
      continue;
    }
    const flow = flows.get(step.include) ?? (await readJson(join(FLOWS_DIR, `${step.include}.json`)));
    flows.set(step.include, flow);
    const flowVars = { ...vars, ...(step.with ?? {}) };
    for (const flowStep of flow.steps) {
      expanded.push(
        interpolate({ ...flowStep, id: `${step.include}-${flowStep.id}` }, flowVars, `${FLOWS_DIR}/${step.include}.json`),
      );
    }
  }
  return expanded;
}

// Serializes a value with its keys in order, so that equal content gives an
// equal hash.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(data) {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

// Loads, checks, and resolves the tutorial `id`: its flows included, its
// variables replaced, and its step ids unique. Throws with every problem.
export async function loadTutorial(id, catalog) {
  const path = join(TUTORIALS_DIR, `${id}.json`);
  const script = await readJson(path);
  const taskIds = new Set((catalog ?? (await loadCatalog())).tasks.map((task) => task.id));
  const problems = new Problems();
  checkScript(problems, path, script, taskIds);
  const flowIds = new Set(
    [...(script.setup ?? []), ...(script.chapters ?? []).flatMap((chapter) => chapter.steps ?? [])]
      .filter((step) => step?.include !== undefined)
      .map((step) => step.include),
  );
  const flows = new Map();
  for (const flowId of flowIds) {
    const flowPath = join(FLOWS_DIR, `${flowId}.json`);
    try {
      const flow = await readJson(flowPath);
      checkFlow(problems, flowPath, flow);
      flows.set(flowId, flow);
    } catch (error) {
      problems.list.push(error.message);
    }
  }
  if (problems.list.length > 0) throw new Error(problems.list.join("\n"));

  const vars = { ...(script.vars ?? {}), user: script.user, password: DATASET_PASSWORD };
  const resolved = {
    id,
    title: script.title,
    subtitle: script.subtitle ?? "",
    outro: script.outro ?? null,
    user: script.user,
    covers: script.covers,
    changesData: script.changesData ?? false,
    setup: await expand(script.setup ?? [], vars, `${path}.setup`, flows),
    chapters: [],
  };
  for (const [index, chapter] of script.chapters.entries()) {
    resolved.chapters.push({
      title: chapter.title,
      steps: await expand(chapter.steps, vars, `${path}.chapters[${index}].steps`, flows),
    });
  }
  const seen = new Set();
  for (const step of [...resolved.setup, ...resolved.chapters.flatMap((chapter) => chapter.steps)]) {
    if (seen.has(step.id)) problems.add(path, `step id "${step.id}" is used twice; a flow included twice needs steps of its own`);
    seen.add(step.id);
  }
  if (problems.list.length > 0) throw new Error(problems.list.join("\n"));
  resolved.hash = sha256(canonical(resolved));
  return resolved;
}

// The steps that the video shows, in order, each with its chapter's index.
export function shownSteps(tutorial) {
  return tutorial.chapters.flatMap((chapter, chapterIndex) =>
    chapter.steps.map((step) => ({ ...step, chapter: chapterIndex })),
  );
}
