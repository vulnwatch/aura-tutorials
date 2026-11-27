// Captures a tutorial from the UI under capture: runs its setup without
// screenshots, then, for each step of its chapters, takes high-resolution
// screenshots of the window and the bounding box of the element that the step
// acts on, in CSS pixels of the window. It records no video. Each screenshot
// also has a fingerprint: the hash of a screenshot whose dates and generated
// avatars are masked, which change with each load of the example dataset, so
// that two captures of the same screens have the same fingerprints. Writes
// <out>/capture/*.png and <out>/capture/capture.json.
//
// Usage: node src/capture.mjs <id> <out>
//
// The UI is on http://localhost:5173 (scripts/tooling.sh capture runs this in
// the network namespace of the development server).

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { loadTutorial, sha256 } from "./lib/script.mjs";

const BASE_URL = "http://localhost:5173";
const VIEWPORT = { width: 1440, height: 900 };
const DEVICE_SCALE_FACTOR = 2;
// Where the pointer rests while a screenshot is taken: the empty part of the
// sidebar, as in Aura's end-to-end tests, so that it marks nothing.
const POINTER_REST = { x: 100, y: 500 };
// How long a wait of a step lasts at most: as long as Aura's end-to-end tests
// wait for the Bugzilla needinfo count to show as not available, the slowest
// read of the landing, since the backend cannot reach Bugzilla (Aura
// test/e2e/fixtures.ts, NEEDINFO_TIMEOUT; keep in sync).
const TIMEOUT = 20_000;
// How long the page has sent and received no request before a screenshot:
// longer than the pause after which a field of Aura that searches as the user
// types sends its search, 250 ms (Aura docs/design-system.md, Forms), so that
// each character typed shows the outcome of its search.
const QUIET = 500;

// What the fingerprints mask, as the reference screenshots of Aura's
// end-to-end tests do (Aura test/e2e/fixtures.ts, avatars, dateTimes, and
// DATE_TIMES_STYLE; keep in sync): the generated avatars, the dates and
// times, whose texts take fixed widths while masked so that the layout around
// them does not depend on the date of the load.
const AVATARS = 'svg[viewBox="0 0 6 6"]';
const DATE_TIMES = "time, [role=spinbutton][data-type]:not([data-placeholder])";
const DATE_TIMES_STYLE = `
  time { display: inline-block; width: 7em; white-space: nowrap; color: transparent; }
  time[datetime*="T"] { width: 10em; }
  time:not([datetime*="-"]) { width: 3.5em; }
`;

const [id, outDir] = process.argv.slice(2);
if (!id || !outDir) {
  console.error("usage: node src/capture.mjs <id> <out>");
  process.exit(2);
}

const tutorial = await loadTutorial(id);
const captureDir = join(outDir, "capture");

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
  } else {
    locator = root.getByText(spec.text, { exact: spec.exact });
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

// The requests of the page in flight, and when the last one started or ended:
// the load state networkidle tracks the load of a page alone, not the requests
// that the page sends later, such as a search.
let requests = 0;
let activity = Date.now();
const track = (delta) => () => {
  requests += delta;
  activity = Date.now();
};

// Waits until no request is in flight and none has started or ended for QUIET.
async function quiet(page) {
  const deadline = Date.now() + TIMEOUT;
  while (requests > 0 || Date.now() - activity < QUIET) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${requests} request(s) of the page to end`);
    await page.waitForTimeout(50);
  }
}

// Waits until the page is still: no requests in flight, the fonts loaded,
// the pointer at rest, and a moment for the last layout.
async function settle(page) {
  await page.waitForLoadState("networkidle");
  await quiet(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.mouse.move(POINTER_REST.x, POINTER_REST.y);
  await page.waitForTimeout(400);
}

// The box of what a cell of a table holds, its text and its images, within
// the cell: a cell is as wide as its column, so that a ring around the cell
// would lie off what it points at, to one side of it. Nothing for another
// element, whose own box is what a viewer sees, or for a cell that holds
// nothing to see. Text that only assistive technologies read, clipped to a
// pixel, does not count.
const CELLS = "th, td, [role=columnheader], [role=rowheader], [role=gridcell], [role=cell]";
async function contentBoxOf(locator) {
  return locator.evaluate((element, cells) => {
    if (!element.matches(cells)) return null;
    const cell = element.getBoundingClientRect();
    const rects = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...range.getClientRects());
      } else if (node.matches("svg, img")) {
        rects.push(node.getBoundingClientRect());
      }
    }
    const seen = rects
      .filter((rect) => rect.width > 1 && rect.height > 1)
      .map((rect) => ({
        left: Math.max(rect.left, cell.left),
        top: Math.max(rect.top, cell.top),
        right: Math.min(rect.right, cell.right),
        bottom: Math.min(rect.bottom, cell.bottom),
      }))
      .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
    if (seen.length === 0) return null;
    const left = Math.min(...seen.map((rect) => rect.left));
    const top = Math.min(...seen.map((rect) => rect.top));
    return {
      x: left,
      y: top,
      width: Math.max(...seen.map((rect) => rect.right)) - left,
      height: Math.max(...seen.map((rect) => rect.bottom)) - top,
    };
  }, CELLS);
}

// The box of a target, scrolled into view first, so that the screenshot
// shows it: its bounding box, or, for a cell of a table, the box of what it
// holds.
async function boxOf(page, locator) {
  await locator.waitFor({ state: "visible", timeout: TIMEOUT });
  if (!(await locator.isVisible()) || !(await inViewport(locator))) {
    await locator.scrollIntoViewIfNeeded();
    await settle(page);
  }
  const box = (await contentBoxOf(locator)) ?? (await locator.boundingBox());
  if (!box) throw new Error("the target has no bounding box");
  return {
    x: Math.round(box.x * 100) / 100,
    y: Math.round(box.y * 100) / 100,
    width: Math.round(box.width * 100) / 100,
    height: Math.round(box.height * 100) / 100,
  };
}

async function inViewport(locator) {
  const box = await locator.boundingBox();
  return Boolean(box) && box.y >= 0 && box.y + box.height <= VIEWPORT.height;
}

// The fingerprint of the window as it shows: the hash of a screenshot at one
// pixel per CSS pixel with the dates and the avatars masked. The style of the
// dates comes from a stylesheet of the CSS object model, which Aura's Content
// Security Policy allows, and goes before the next action.
async function fingerprint(page) {
  const sheet = await page.evaluateHandle((style) => {
    const added = new CSSStyleSheet();
    added.replaceSync(style);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, added];
    return added;
  }, DATE_TIMES_STYLE);
  try {
    const image = await page.screenshot({
      scale: "css",
      caret: "hide",
      animations: "disabled",
      mask: [page.locator(AVATARS), page.locator(DATE_TIMES)],
      maskColor: "#FF00FF",
    });
    return sha256(image);
  } finally {
    await sheet.evaluate((added) => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((adopted) => adopted !== added);
    });
    await sheet.dispose();
  }
}

let shots = 0;

// Takes a screenshot of the window and returns its record, or nothing while
// the setup runs.
async function shoot(page, step, kind, recording) {
  if (!recording) return null;
  await quiet(page);
  shots += 1;
  const file = `${String(shots).padStart(3, "0")}-${step.id}-${kind}.png`;
  await page.screenshot({ path: join(captureDir, file), caret: "hide", animations: "disabled" });
  return { file, kind, path: new URL(page.url()).pathname, fingerprint: await fingerprint(page) };
}

async function waitForStep(page, step) {
  if (step.waitForUrl) {
    const pattern = new RegExp(step.waitForUrl);
    await page.waitForURL((url) => pattern.test(url.pathname), { timeout: TIMEOUT });
  }
  for (const condition of [step.waitFor ?? []].flat()) {
    await waitFor(page, condition);
  }
  await settle(page);
}

// Runs a step: with screenshots when `recording`, without during the setup.
async function runStep(page, step, recording) {
  const frames = [];
  const record = async (kind) => {
    const frame = await shoot(page, step, kind, recording);
    if (frame) frames.push(frame);
  };
  let box = null;
  const target = step.target ? locate(page, step.target).first() : null;
  switch (step.action) {
    case "goto": {
      await page.goto(step.path);
      await waitForStep(page, step);
      if (target) box = await boxOf(page, target);
      await record("after");
      break;
    }
    case "fill": {
      box = await boxOf(page, target);
      await record("before");
      await target.click();
      await settle(page);
      await record("focus");
      // One screenshot for each character, so that the video types with the
      // pixels of the UI. Each goes where the click left the focus, as a
      // user types: a field of parts, such as a date and time, moves the
      // focus from part to part, which a focus of the target would undo.
      for (const character of step.value) {
        await page.keyboard.type(character);
        // A search that the character starts follows after a pause, which
        // the screenshot waits for.
        activity = Date.now();
        await record(`type-${frames.length - 1}`);
      }
      if (!recording) await settle(page);
      break;
    }
    case "click": {
      box = await boxOf(page, target);
      await record("before");
      await target.click();
      await waitForStep(page, step);
      await record("after");
      break;
    }
    case "press": {
      if (target) {
        box = await boxOf(page, target);
        await target.focus();
        await settle(page);
      }
      await record("before");
      await page.keyboard.press(step.key);
      await waitForStep(page, step);
      await record("after");
      break;
    }
    case "show": {
      await waitForStep(page, step);
      if (target) box = await boxOf(page, target);
      await record("current");
      break;
    }
    default:
      throw new Error(`unknown action ${step.action} of step ${step.id}`);
  }
  return { box, frames };
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
page.on("request", track(1));
page.on("requestfinished", track(-1));
page.on("requestfailed", track(-1));
const steps = [];
try {
  for (const step of tutorial.setup) {
    console.error(`capture: setup ${step.id}`);
    await runStep(page, step, false);
  }
  for (const [chapterIndex, chapter] of tutorial.chapters.entries()) {
    for (const step of chapter.steps) {
      console.error(`capture: ${step.id}`);
      const { box, frames } = await runStep(page, step, true);
      steps.push({
        id: step.id,
        chapter: chapterIndex,
        action: step.action,
        key: step.key,
        zoom: step.zoom,
        duration: step.duration,
        hold: step.hold,
        caption: step.caption,
        narration: step.narration,
        box,
        frames,
      });
    }
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
  `${JSON.stringify(
    {
      tutorial: id,
      script: tutorial.hash,
      aura: process.env.AURA_VERSION ?? null,
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      steps,
    },
    null,
    2,
  )}\n`,
);
console.error(`capture: ${shots} screenshots in ${captureDir}`);
