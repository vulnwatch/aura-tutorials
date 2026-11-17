// Captures the steps of a tutorial script from the UI under capture: for each
// step, high-resolution screenshots of the window and the bounding box of the
// element that the step acts on, in CSS pixels of the window. It records no
// video. Writes <out>/capture/*.png and <out>/capture/capture.json.
//
// Usage: node src/capture.mjs <script> <out>
//
// The UI is on http://localhost:5173 (scripts/tooling.sh capture runs this in
// the network namespace of the development server).

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:5173";
const VIEWPORT = { width: 1440, height: 900 };
const DEVICE_SCALE_FACTOR = 2;
// Where the pointer rests while a screenshot is taken: the empty part of the
// sidebar, as in Aura's end-to-end tests, so that it marks nothing.
const POINTER_REST = { x: 100, y: 500 };
const TIMEOUT = 15_000;

const [scriptPath, outDir] = process.argv.slice(2);
if (!scriptPath || !outDir) {
  console.error("usage: node src/capture.mjs <script> <out>");
  process.exit(2);
}

const script = JSON.parse(await readFile(scriptPath, "utf8"));
const captureDir = join(outDir, "capture");

// Replaces each {path.to.value} of a text with the value of the script.
function interpolate(text) {
  return text.replace(/\{([\w.]+)\}/g, (_, path) => {
    const value = path.split(".").reduce((object, key) => object?.[key], script);
    if (typeof value !== "string") {
      throw new Error(`the script has no value ${path}`);
    }
    return value;
  });
}

// Resolves a locator spec of the script, an object or a chain of objects,
// each found inside the previous one: by role (name, level, exact), by label,
// or by text, then the nth match when it names one.
function locate(root, spec) {
  if (Array.isArray(spec)) {
    return spec.reduce((parent, part) => locate(parent, part), root);
  }
  let locator;
  if (spec.role) {
    const options = {};
    if (spec.name !== undefined) options.name = spec.name;
    if (spec.level !== undefined) options.level = spec.level;
    if (spec.exact !== undefined) options.exact = spec.exact;
    locator = root.getByRole(spec.role, options);
  } else if (spec.label) {
    locator = root.getByLabel(spec.label, { exact: spec.exact });
  } else if (spec.text) {
    locator = root.getByText(spec.text, { exact: spec.exact });
  } else {
    throw new Error(`a locator needs a role, a label, or a text: ${JSON.stringify(spec)}`);
  }
  return spec.nth !== undefined ? locator.nth(spec.nth) : locator;
}

// Waits until a condition of the script holds: the element is visible, and,
// with child and allHaveText, each of its children of that spec has a text
// that matches, such as the views once their counts have arrived.
async function waitFor(page, condition) {
  const locator = locate(page, condition);
  await locator.first().waitFor({ state: "visible", timeout: TIMEOUT });
  if (!condition.child) return;
  const children = locate(locator, condition.child);
  await children.first().waitFor({ state: "visible", timeout: TIMEOUT });
  if (!condition.allHaveText) return;
  const pattern = new RegExp(condition.allHaveText);
  const deadline = Date.now() + TIMEOUT;
  for (;;) {
    const texts = await children.allTextContents();
    if (texts.length > 0 && texts.every((text) => pattern.test(text.trim()))) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${JSON.stringify(condition)}: ${JSON.stringify(texts)}`);
    }
    await page.waitForTimeout(100);
  }
}

// Waits until the page is still: no requests in flight, the fonts loaded,
// the pointer at rest, and a moment for the last layout.
async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.mouse.move(POINTER_REST.x, POINTER_REST.y);
  await page.waitForTimeout(400);
}

async function boxOf(locator) {
  await locator.waitFor({ state: "visible", timeout: TIMEOUT });
  const box = await locator.boundingBox();
  if (!box) throw new Error("the target has no bounding box");
  return {
    x: Math.round(box.x * 100) / 100,
    y: Math.round(box.y * 100) / 100,
    width: Math.round(box.width * 100) / 100,
    height: Math.round(box.height * 100) / 100,
  };
}

let shots = 0;

// Takes a screenshot of the window and returns its record.
async function shoot(page, step, kind) {
  shots += 1;
  const file = `${String(shots).padStart(3, "0")}-${step.id}-${kind}.png`;
  await page.screenshot({
    path: join(captureDir, file),
    caret: "hide",
    animations: "disabled",
  });
  return { file, kind, path: new URL(page.url()).pathname };
}

async function waitForStep(page, step) {
  if (step.waitForUrl) {
    const pattern = new RegExp(step.waitForUrl);
    await page.waitForURL((url) => pattern.test(url.pathname), { timeout: TIMEOUT });
  }
  const conditions = [step.waitFor ?? []].flat();
  for (const condition of conditions) {
    await waitFor(page, condition);
  }
  await settle(page);
}

async function captureStep(page, step) {
  const frames = [];
  let box = null;
  const target = step.target ? locate(page, step.target).first() : null;
  switch (step.action) {
    case "goto": {
      await page.goto(step.path);
      await waitForStep(page, step);
      if (target) box = await boxOf(target);
      frames.push(await shoot(page, step, "after"));
      break;
    }
    case "fill": {
      box = await boxOf(target);
      frames.push(await shoot(page, step, "before"));
      await target.click();
      await settle(page);
      frames.push(await shoot(page, step, "focus"));
      // One screenshot for each character, so that the video types with the
      // pixels of the UI.
      for (const character of interpolate(step.value)) {
        await target.pressSequentially(character);
        frames.push(await shoot(page, step, `type-${frames.length - 1}`));
      }
      break;
    }
    case "click": {
      box = await boxOf(target);
      frames.push(await shoot(page, step, "before"));
      await target.click();
      await waitForStep(page, step);
      frames.push(await shoot(page, step, "after"));
      break;
    }
    case "show": {
      await waitForStep(page, step);
      if (target) box = await boxOf(target);
      frames.push(await shoot(page, step, "current"));
      break;
    }
    default:
      throw new Error(`unknown action ${step.action} of step ${step.id}`);
  }
  return {
    id: step.id,
    action: step.action,
    caption: step.caption,
    narration: step.narration,
    box,
    frames,
  };
}

await rm(captureDir, { recursive: true, force: true });
await mkdir(captureDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: BASE_URL,
  viewport: VIEWPORT,
  deviceScaleFactor: DEVICE_SCALE_FACTOR,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "en-US",
});
const page = await context.newPage();
const steps = [];
try {
  for (const step of script.steps) {
    console.error(`capture: ${step.id}`);
    steps.push(await captureStep(page, step));
  }
} catch (error) {
  await page.screenshot({ path: join(captureDir, "failure.png") }).catch(() => {});
  console.error(`capture: failed; ${join(captureDir, "failure.png")} shows the page`);
  throw error;
} finally {
  await browser.close();
}

await writeFile(
  join(captureDir, "capture.json"),
  `${JSON.stringify({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR, steps }, null, 2)}\n`,
);
console.error(`capture: ${shots} screenshots in ${captureDir}`);
