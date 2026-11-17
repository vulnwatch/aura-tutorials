// Generates the HyperFrames composition of a captured tutorial, 1920x1080:
// index.html mounts an intro, one scene for each chapter, and an outro, each a
// sub-composition of compositions/ with its own GSAP timeline. A chapter
// animates the screenshots of its steps in a window, with a camera that zooms
// and pans towards the target of each step, a synthetic pointer that moves
// and clicks, a keycap for each key press, highlights, captions, and
// crossfades; a tutorial of several chapters opens each with a card. Writes
// <out>/composition/, and <out>/compose.json and <out>/chapters.ffmeta, the
// duration and the chapters, which the render writes into the MP4.
//
// It also checks what it knows without judgment, and writes the findings into
// compose.json with the times of the steps and the cards (docs/authoring.md,
// Review): each step's target and ring in the view of the camera and clear of
// the caption, the keycap of a key press in view, and each caption short
// enough and on screen long enough to read. It reports them on stderr and
// succeeds; scripts/tutorials.sh render --strict fails on them.
//
// Usage: node src/compose.mjs <id> <out>

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadTutorial } from "./lib/script.mjs";

const [id, outDir] = process.argv.slice(2);
if (!id || !outDir) {
  console.error("usage: node src/compose.mjs <id> <out>");
  process.exit(2);
}

const tutorial = await loadTutorial(id);
const captureDir = join(outDir, "capture");
const capture = JSON.parse(await readFile(join(captureDir, "capture.json"), "utf8"));
if (capture.script !== tutorial.hash) {
  throw new Error(`the capture of ${id} is of another version of its script; capture it again`);
}
const compositionDir = join(outDir, "composition");

// The canvas, and the window that shows the UI on it: its title bar and its
// content, whose CSS pixels of the captured page scale by PAGE_SCALE.
const CANVAS = { width: 1920, height: 1080 };
const PAGE = capture.viewport;
const CONTENT_WIDTH = 1472;
const PAGE_SCALE = CONTENT_WIDTH / PAGE.width;
const CONTENT_HEIGHT = Math.round(PAGE.height * PAGE_SCALE);
const TITLE_BAR = 40;
const WINDOW_RADIUS = 14;
const WINDOW = { left: (CANVAS.width - CONTENT_WIDTH) / 2, top: 36 };
const CONTENT = {
  left: WINDOW.left,
  top: WINDOW.top + TITLE_BAR,
  right: WINDOW.left + CONTENT_WIDTH,
  bottom: WINDOW.top + TITLE_BAR + CONTENT_HEIGHT,
};
// The point of the canvas where the camera puts what it looks at: above the
// middle, clear of the captions.
const FOCUS = { x: CANVAS.width / 2, y: 470 };
// The host that the address bar shows, fictional.
const HOST = "sentinel.example.com";

// Aura's accent (Aura docs/design-system.md, Colors).
const ACCENT = "#0969DA";

// The timing of the film, in seconds.
const INTRO = 3.6;
const OUTRO = 4.6;
const CHAPTER_CARD = 2.6;
const WINDOW_RISE = 0.9;
const WINDOW_FALL = 0.7;
const CAMERA_MOVE = 1.0;
const POINTER_MOVE = 0.85;
const CROSSFADE = 0.45;
const TYPING_TIME = { min: 0.6, max: 1.4, perCharacter: 0.09 };
// How long each action holds after it ends, unless its step names a hold: the
// time to read its caption.
const ACTION_HOLD = { goto: 3.0, fill: 1.1, click: 1.0, press: 1.0, show: 2.6 };

// The zoom of the camera towards the target of each action, unless the step
// names one: 1 shows the whole window.
const ACTION_ZOOM = { goto: 1, fill: 1.75, click: 1.6, press: 1.5, show: 1.3 };

// A caption rises in after the start of its step and fades before its end.
const CAPTION_IN = { delay: 0.1, duration: 0.45 };
const CAPTION_OUT = 0.32;
// The box of a caption on the canvas, which its styles below decide: its top
// and bottom, and an upper estimate of its width, since the composition knows
// no text metrics: each character of its text takes at most about 0.52 em of
// Inter at 36 px, beside its number and its paddings.
const CAPTION_BOX = { top: 960, bottom: 1036, perCharacter: 0.52 * 36, frame: 16 + 18 + 30 };
// A caption holds about 0.5 s plus 0.3 s a word to be read (HyperFrames,
// references/motion.md, Holds), and has at most about eight words
// (docs/authoring.md, Style).
const READING = { base: 0.5, perWord: 0.3 };
const CAPTION_WORDS = 8;
// The ring around a target, outside its box, in CSS pixels of the page: its
// padding, its border, and its halo, the spread of its shadow (.ring).
const RING = { pad: 6, border: 3, halo: 6 };
// An upper estimate of the box of a keycap, in CSS pixels of the page.
const KEYCAP_BOX = { height: 48, perCharacter: 0.62 * 22, frame: 2 * 16 + 2 * 2 };

const round = (value) => Math.round(value * 1000) / 1000;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// The transform of the camera, on the world that holds the window, that puts
// the point of the page at FOCUS at the zoom, without showing past the edges
// of the window, its rounded corners included, once it is larger than the
// canvas.
function camera(zoom, point) {
  if (zoom <= 1 || !point) return { x: 0, y: 0, scale: 1 };
  const worldX = CONTENT.left + point.x * PAGE_SCALE;
  const worldY = CONTENT.top + point.y * PAGE_SCALE;
  const axis = (focus, world, start, end, size) => {
    if (zoom * (end - start) <= size) {
      return size / 2 - (zoom * (start + end)) / 2;
    }
    const wanted = focus - zoom * world;
    const inner = [start + WINDOW_RADIUS, end - WINDOW_RADIUS];
    return Math.min(-zoom * inner[0], Math.max(size - zoom * inner[1], wanted));
  };
  return {
    x: round(axis(FOCUS.x, worldX, CONTENT.left, CONTENT.right, CANVAS.width)),
    y: round(axis(FOCUS.y, worldY, WINDOW.top, CONTENT.bottom, CANVAS.height)),
    scale: zoom,
  };
}

function center(box) {
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

// --- Geometry of the checks ----------------------------------------------

// A rectangle { left, top, right, bottom } of the page from a box of the
// capture, grown by `outset` on every side.
const rectOf = (box, outset = 0) => ({
  left: box.x - outset,
  top: box.y - outset,
  right: box.x + box.width + outset,
  bottom: box.y + box.height + outset,
});

// The rectangle of the canvas where the transform of the camera puts a
// rectangle of the page.
function onCanvas(transform, rect) {
  const x = (pageX) => transform.x + transform.scale * (CONTENT.left + pageX * PAGE_SCALE);
  const y = (pageY) => transform.y + transform.scale * (CONTENT.top + pageY * PAGE_SCALE);
  return { left: x(rect.left), top: y(rect.top), right: x(rect.right), bottom: y(rect.bottom) };
}

// The part of the canvas that shows the page under a transform of the camera:
// the content of the window, which clips what lies beyond it, within the
// canvas.
function viewOf(transform) {
  const page = onCanvas(transform, { left: 0, top: 0, right: PAGE.width, bottom: PAGE.height });
  return {
    left: Math.max(0, page.left),
    top: Math.max(0, page.top),
    right: Math.min(CANVAS.width, page.right),
    bottom: Math.min(CANVAS.height, page.bottom),
  };
}

// Half a pixel of the canvas absorbs the rounding of the boxes.
const inside = (inner, outer) =>
  inner.left >= outer.left - 0.5 &&
  inner.top >= outer.top - 0.5 &&
  inner.right <= outer.right + 0.5 &&
  inner.bottom <= outer.bottom + 0.5;
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// The box of a caption on the canvas, from CAPTION_BOX and the styles of
// .caption-number.
function captionBox(number, text) {
  const numberWidth = Math.max(44, 20 + 13 * String(number).length);
  const width = CAPTION_BOX.frame + numberWidth + text.length * CAPTION_BOX.perCharacter;
  return { left: (CANVAS.width - width) / 2, top: CAPTION_BOX.top, right: (CANVAS.width + width) / 2, bottom: CAPTION_BOX.bottom };
}

// The findings of the checks of a shown step, at the times of its chapter.
// `timing` holds its start, end, and focus, the moment when the camera has
// settled on what it points at; whether it rings its target; and its keycap,
// if any. `cameraAt` gives the transform of the camera at a time.
function checkStep(step, number, timing, cameraAt) {
  const findings = [];
  const add = (check, at, message) => findings.push({ check, step: step.id, number, at, message });
  const words = step.caption.split(/\s+/).filter(Boolean).length;
  if (words > CAPTION_WORDS) {
    add("caption-too-long", timing.start, `the caption has ${words} words, more than the ${CAPTION_WORDS} of the Style; shorten it`);
  }
  const shown = timing.end - timing.start - CAPTION_IN.delay - CAPTION_IN.duration - CAPTION_OUT;
  const needed = READING.base + READING.perWord * words;
  if (shown < needed - 0.005) {
    add("caption-unread", timing.start, `the caption is whole on screen ${round(shown)} s, under the ${round(needed)} s that ${words} words need; give the step a longer hold`);
  }
  const caption = captionBox(number, step.caption);
  if (step.box) {
    const transform = cameraAt(timing.focus);
    const view = viewOf(transform);
    const target = onCanvas(transform, rectOf(step.box));
    const ring = timing.ring ? onCanvas(transform, rectOf(step.box, RING.pad + RING.border + RING.halo)) : target;
    if (!inside(target, view)) {
      add("target-outside-view", timing.focus, "the target is not whole in the view of the camera; lower the zoom, or point at a smaller target");
    } else if (!inside(ring, view)) {
      add("ring-outside-view", timing.focus, "the ring around the target is cut by the edge of the window or of the video; lower the zoom, or point at a smaller target");
    }
    if (overlaps(ring, caption)) {
      add("caption-covers-target", timing.focus, "the caption covers the target; raise the zoom so that the camera brings the target up, or point at a smaller target");
    }
  }
  if (timing.keycap) {
    const transform = cameraAt(timing.keycap.at);
    const keycap = onCanvas(transform, timing.keycap.rect);
    if (!inside(keycap, viewOf(transform))) {
      add("keycap-outside-view", timing.keycap.at, "the keycap is not whole in the view of the camera");
    }
    if (overlaps(keycap, caption)) {
      add("caption-covers-target", timing.keycap.at, "the caption covers the keycap");
    }
  }
  return findings;
}

// The end of a step: its action's end, plus its hold, and at least its
// duration. The one place that times a step, which a narration will extend.
function stepEnd(step, start, actionEnd) {
  return Math.max(actionEnd + (step.hold ?? ACTION_HOLD[step.action]), start + (step.duration ?? 0));
}

// A timed element of a composition.
const clip = (start, end, className = "") =>
  `class="${`clip ${className}`.trim()}" data-start="${round(start)}" data-duration="${round(end - start)}"`;

// The GSAP calls of a timeline, in order of time. No fromTo renders its start
// values when the timeline is built: the styles hold the state of each element
// before its first tween runs, such as a ripple that shows only once its click
// comes.
function timelineJs(tweens) {
  return tweens
    .sort((a, b) => a.at - b.at)
    .map(({ method, selector, vars, at, extra }) => {
      if (method !== "fromTo") {
        return `    tl.${method}(${JSON.stringify(selector)}, ${JSON.stringify(vars)}, ${round(at)});`;
      }
      const to = { ...extra, immediateRender: false };
      return `    tl.fromTo(${JSON.stringify(selector)}, ${JSON.stringify(vars)}, ${JSON.stringify(to)}, ${round(at)});`;
    })
    .join("\n");
}

// A scene file: its styles, markup, and timeline inside a template, its root
// styled as #root (HyperFrames, references/format.md).
function sceneFile(compositionId, styles, markup, tweens) {
  return `<!-- Generated by src/compose.mjs from tutorials/${id}.json; do not edit. -->
<template>
  <style>
${FONT_FACE}
    #root {
      position: absolute;
      inset: 0;
      font-family: "Inter Variable", sans-serif;
      color: #f4f7fb;
    }
${styles}
  </style>
  <div id="root" data-composition-id="${compositionId}" data-width="${CANVAS.width}" data-height="${CANVAS.height}">
${markup}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
${timelineJs(tweens)}
    window.__timelines = window.__timelines || {};
    window.__timelines[${JSON.stringify(compositionId)}] = tl;
  </script>
</template>
`;
}

const FONT_FACE = `    @font-face {
      font-family: "Inter Variable";
      src: url("assets/fonts/inter.woff2") format("woff2");
      font-weight: 100 900;
      font-style: normal;
    }`;

// --- The cards: the intro, the chapters, and the outro ------------------

const CARD_STYLES = `    .card {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .card-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 30px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: #c9d6ea;
    }
    .brand svg {
      width: 40px;
      height: 40px;
    }
    .eyebrow {
      font-size: 30px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7fb2f0;
    }
    .card h1 {
      margin: 34px 0 0;
      font-size: 84px;
      font-weight: 750;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .card h2 {
      margin: 26px 0 0;
      font-size: 72px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .card p {
      margin: 22px 0 0;
      font-size: 34px;
      font-weight: 400;
      color: #b4c2d8;
    }`;

// The Sentinel mark of the UI under capture (Aura src/favicon.svg).
const mark = (await readFile("aura/src/favicon.svg", "utf8")).match(/<path d="([^"]+)"/)[1];
const brand = `<div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${mark}" /></svg>Sentinel Aura</div>`;

function introScene() {
  const markup = `    <div id="intro-card" ${clip(0, INTRO, "card")} data-track-index="1">
      <div class="card-inner" id="intro-inner">
        ${brand}
        <h1>${escapeHtml(tutorial.title)}</h1>
        <p id="intro-subtitle">${escapeHtml(tutorial.subtitle)}</p>
      </div>
    </div>`;
  // The title is on screen from the first frame, the thumbnail of a player.
  const tweens = [
    { method: "fromTo", selector: "#intro-inner", vars: { scale: 0.97 }, at: 0, extra: { scale: 1, duration: 1.6, ease: "power2.out" } },
    { method: "fromTo", selector: "#intro-subtitle", vars: { opacity: 0, y: 16 }, at: 0.4, extra: { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" } },
    { method: "to", selector: "#intro-inner", vars: { opacity: 0, y: -30, duration: 0.5, ease: "power2.in" }, at: INTRO - 0.6 },
  ];
  return sceneFile("intro", CARD_STYLES, markup, tweens);
}

function outroScene() {
  const outro = tutorial.outro ?? { title: "That's it", subtitle: "" };
  const markup = `    <div id="outro-card" ${clip(0, OUTRO, "card")} data-track-index="1">
      <div class="card-inner" id="outro-inner">
        ${brand}
        <h1>${escapeHtml(outro.title)}</h1>
        <p>${escapeHtml(outro.subtitle ?? "")}</p>
      </div>
    </div>`;
  const tweens = [
    { method: "fromTo", selector: "#outro-inner", vars: { opacity: 0, y: 30 }, at: 0.1, extra: { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" } },
  ];
  return sceneFile("outro", CARD_STYLES, markup, tweens);
}

// --- A chapter ----------------------------------------------------------

const CHAPTER_STYLES = `${CARD_STYLES}
    .world {
      position: absolute;
      left: 0;
      top: 0;
      width: ${CANVAS.width}px;
      height: ${CANVAS.height}px;
      transform-origin: 0 0;
    }
    .window {
      position: absolute;
      left: ${WINDOW.left}px;
      top: ${WINDOW.top}px;
      width: ${CONTENT_WIDTH}px;
      height: ${TITLE_BAR + CONTENT_HEIGHT}px;
      border-radius: ${WINDOW_RADIUS}px;
      overflow: hidden;
      background: #f6f8fa;
      box-shadow:
        0 40px 90px rgba(0, 0, 0, 0.45),
        0 0 0 1px rgba(255, 255, 255, 0.08);
      opacity: 0;
    }
    .title-bar {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: ${TITLE_BAR}px;
      background: #e9edf2;
      border-bottom: 1px solid #d5dbe2;
    }
    .light {
      position: absolute;
      top: 14px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .address-bar {
      position: absolute;
      left: 50%;
      top: 7px;
      width: 560px;
      height: 26px;
      margin-left: -280px;
      border-radius: 7px;
      background: #ffffff;
      border: 1px solid #d5dbe2;
    }
    .address-bar > span {
      position: absolute;
      inset: 0;
      line-height: 24px;
      text-align: center;
      font-size: 14px;
      color: #1f2328;
    }
    .address-bar .host {
      color: #59636e;
    }
    .content {
      position: absolute;
      left: 0;
      top: ${TITLE_BAR}px;
      width: ${CONTENT_WIDTH}px;
      height: ${CONTENT_HEIGHT}px;
      overflow: hidden;
    }
    .page {
      position: absolute;
      left: 0;
      top: 0;
      width: ${PAGE.width}px;
      height: ${PAGE.height}px;
      transform: scale(${round(PAGE_SCALE)});
      transform-origin: 0 0;
    }
    .frame {
      position: absolute;
      left: 0;
      top: 0;
      width: ${PAGE.width}px;
      height: ${PAGE.height}px;
    }
    .ring {
      position: absolute;
      border: ${RING.border}px solid ${ACCENT};
      border-radius: 10px;
      box-shadow: 0 0 0 ${RING.halo}px rgba(9, 105, 218, 0.18);
      opacity: 0;
    }
    .ripple {
      position: absolute;
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: rgba(9, 105, 218, 0.45);
      opacity: 0;
    }
    .keycap {
      position: absolute;
      padding: 6px 16px;
      border-radius: 10px;
      background: #0b1220;
      border: 2px solid #3b4a63;
      box-shadow: 0 4px 0 #3b4a63, 0 12px 24px rgba(0, 0, 0, 0.3);
      font-size: 22px;
      font-weight: 650;
      color: #ffffff;
      white-space: nowrap;
      opacity: 0;
    }
    .pointer {
      position: absolute;
      left: 0;
      top: 0;
      width: 0;
      height: 0;
    }
    .pointer-shape {
      position: absolute;
      left: -3px;
      top: -2px;
      width: 26px;
      height: 34px;
      opacity: 0;
      transform-origin: 3px 2px;
      filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35));
    }
    .caption {
      position: absolute;
      left: 0;
      bottom: 44px;
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .caption-inner {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 16px 30px 16px 16px;
      border-radius: 999px;
      background: rgba(11, 18, 32, 0.9);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
      opacity: 0;
    }
    .caption-number {
      min-width: 44px;
      height: 44px;
      padding: 0 10px;
      border-radius: 22px;
      background: ${ACCENT};
      color: #ffffff;
      font-size: 22px;
      font-weight: 700;
      line-height: 44px;
      text-align: center;
    }
    .caption-text {
      font-size: 36px;
      font-weight: 550;
      color: #ffffff;
    }`;

// Where the pointer enters, in CSS pixels of the page.
const POINTER_START = { x: PAGE.width * 0.72, y: PAGE.height * 0.82 };

// Builds the scene of a chapter from its captured steps. `numbers` gives the
// number of each step's caption, which counts across the tutorial. Returns its
// file and its duration, and the times of its steps and the findings of their
// checks, at the times of the chapter.
function chapterScene(chapterIndex, steps, numbers, withCard) {
  const p = `c${chapterIndex + 1}`;
  const compositionId = `chapter-${chapterIndex + 1}`;
  const frames = [];
  const captions = [];
  const rings = [];
  const ripples = [];
  const keycaps = [];
  const tweens = [];
  // The moves of the camera, in order of time, for the checks.
  const moves = [];
  let pointerShown = false;
  let pointer = POINTER_START;

  const tween = (method, selector, vars, at, extra) => tweens.push({ method, selector, vars, at, extra });
  const moveCamera = (zoom, point, at, duration = CAMERA_MOVE) => {
    const transform = camera(zoom, point);
    moves.push({ at, transform });
    tween("to", `#${p}-world`, { ...transform, duration, ease: "power3.inOut" }, at);
  };
  // Where the camera is, or goes, by the time `at`: the last move that has
  // started.
  const cameraAt = (at) => moves.filter((move) => move.at <= at + 1e-6).at(-1)?.transform ?? { x: 0, y: 0, scale: 1 };
  // Hides the pointer, which the next move shows again where it was.
  const hidePointer = (at) => {
    if (!pointerShown) return;
    tween("to", `#${p}-pointer-shape`, { opacity: 0, duration: 0.3 }, at);
    pointerShown = false;
  };
  const movePointer = (to, at) => {
    if (!pointerShown) {
      tween("fromTo", `#${p}-pointer-shape`, { opacity: 0 }, at, { opacity: 1, duration: 0.3 });
      pointerShown = true;
    }
    tween("to", `#${p}-pointer`, { x: round(to.x), y: round(to.y), duration: POINTER_MOVE, ease: "power2.inOut" }, at);
    pointer = to;
  };
  const click = (at) => {
    const rippleId = `${p}-ripple-${ripples.length + 1}`;
    ripples.push({ id: rippleId, x: pointer.x, y: pointer.y });
    tween("fromTo", `#${p}-pointer-shape`, { scale: 1 }, at, { scale: 0.82, duration: 0.09, yoyo: true, repeat: 1, ease: "power1.inOut" });
    tween("fromTo", `#${rippleId}`, { scale: 0.2, opacity: 0.55 }, at, { scale: 1, opacity: 0, duration: 0.6, ease: "power2.out" });
  };
  const ring = (step, box, at, end) => {
    const ringId = `${p}-ring-${step.id}`;
    rings.push({ id: ringId, box });
    tween("fromTo", `#${ringId}`, { opacity: 0, scale: 1.08 }, at, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" });
    tween("to", `#${ringId}`, { opacity: 0, duration: 0.3 }, end - 0.3);
  };
  // A keycap below the end of the target, or above the caption without one.
  // Returns its box for the checks, at the time that it is pressed.
  const keycap = (step, at, end) => {
    const keyId = `${p}-key-${step.id}`;
    const position = step.box
      ? { x: step.box.x + step.box.width - 90, y: step.box.y + step.box.height + 14 }
      : { x: PAGE.width / 2 - 45, y: PAGE.height - 160 };
    keycaps.push({ id: keyId, key: step.key, ...position });
    tween("fromTo", `#${keyId}`, { opacity: 0, y: 10 }, at, { opacity: 1, y: 0, duration: 0.25, ease: "back.out(2)" });
    tween("fromTo", `#${keyId}`, { scale: 1 }, at + 0.35, { scale: 0.9, duration: 0.08, yoyo: true, repeat: 1 });
    tween("to", `#${keyId}`, { opacity: 0, duration: 0.25 }, end - 0.25);
    const width = KEYCAP_BOX.frame + step.key.length * KEYCAP_BOX.perCharacter;
    return {
      at: at + 0.35,
      rect: { left: position.x, top: position.y, right: position.x + width, bottom: position.y + KEYCAP_BOX.height },
    };
  };
  // Shows a frame from `at`: a cut, or a crossfade over the previous one.
  const showFrame = (frame, at, fade = 0) => {
    const previous = frames.at(-1);
    if (previous) previous.end = at + fade;
    frames.push({ ...frame, start: at, end: null, fade });
  };

  const start = withCard ? CHAPTER_CARD - 0.3 : 0.3;
  tween("fromTo", `#${p}-window`, { opacity: 0, scale: 0.9, y: 60 }, start - 0.3, { opacity: 1, scale: 1, y: 0, duration: WINDOW_RISE, ease: "power3.out" });
  let time = start;
  const timings = [];
  for (const step of steps) {
    const zoom = step.zoom ?? ACTION_ZOOM[step.action];
    const target = center(step.box);
    const stepStart = time;
    const files = step.frames;
    // The moment when the camera has settled on what the step points at,
    // whether it rings its target, and its keycap.
    let focus;
    let ringed = false;
    let pressed = null;
    switch (step.action) {
      case "goto": {
        showFrame(files[0], time, frames.length ? CROSSFADE : 0);
        hidePointer(time);
        let actionEnd = time + 0.6;
        if (target && zoom > 1) {
          moveCamera(zoom, target, time + 0.6, 1.4);
          actionEnd = time + 2.0;
        }
        focus = actionEnd;
        time = stepEnd(step, stepStart, actionEnd);
        break;
      }
      case "fill": {
        const [before, focused, ...typed] = files;
        showFrame(before, time);
        moveCamera(zoom, target, time);
        movePointer(target, time + 0.2);
        const clickAt = time + 0.2 + POINTER_MOVE + 0.05;
        click(clickAt);
        showFrame(focused, clickAt + 0.05);
        const typing = Math.min(TYPING_TIME.max, Math.max(TYPING_TIME.min, typed.length * TYPING_TIME.perCharacter));
        const typingStart = clickAt + 0.35;
        typed.forEach((frame, character) => showFrame(frame, typingStart + (typing * character) / typed.length));
        focus = typingStart + typing;
        time = stepEnd(step, stepStart, typingStart + typing);
        break;
      }
      case "click": {
        const [before, after] = files;
        showFrame(before, time);
        moveCamera(zoom, target, time);
        movePointer(target, time + 0.2);
        const clickAt = time + 0.2 + POINTER_MOVE + 0.15;
        ring(step, step.box, time + 0.5, clickAt + 0.25);
        ringed = true;
        click(clickAt);
        showFrame(after, clickAt + 0.3, CROSSFADE);
        moveCamera(1, null, clickAt + 0.4, 1.1);
        focus = clickAt;
        time = stepEnd(step, stepStart, clickAt + 1.5);
        break;
      }
      case "press": {
        const [before, after] = files;
        showFrame(before, time);
        // Without a target, the keycap shows above the caption, which the
        // whole window frames, whatever the step before left in view.
        moveCamera(target ? zoom : 1, target, time);
        const pressAt = time + 0.9;
        pressed = keycap(step, pressAt - 0.35, pressAt + 1.0);
        showFrame(after, pressAt + 0.15, CROSSFADE);
        moveCamera(1, null, pressAt + 0.4, 1.1);
        focus = time + CAMERA_MOVE;
        time = stepEnd(step, stepStart, pressAt + 1.5);
        break;
      }
      case "show": {
        const [current] = files;
        hidePointer(time);
        showFrame(current, time, CROSSFADE);
        let actionEnd = time + CROSSFADE;
        if (target && zoom > 1) {
          moveCamera(zoom, target, time + 0.2, 1.4);
          actionEnd = time + 1.6;
        }
        const end = stepEnd(step, stepStart, actionEnd);
        focus = actionEnd;
        if (step.box) {
          ring(step, step.box, time + 1.2, end);
          ringed = true;
          focus = Math.max(actionEnd, time + 1.55);
        }
        time = end;
        break;
      }
      default:
        throw new Error(`unknown action ${step.action} of step ${step.id}`);
    }
    captions.push({ id: `${p}-caption-${step.id}`, number: numbers.get(step.id), step, start: stepStart, end: time });
    timings.push({ step, start: stepStart, focus, end: time, ring: ringed, keycap: pressed });
  }
  const findings = timings.flatMap((timing) => checkStep(timing.step, numbers.get(timing.step.id), timing, cameraAt));
  // The chapter ends with the whole window, which recedes.
  const stepsEnd = time;
  moveCamera(1, null, stepsEnd, 0.6);
  hidePointer(stepsEnd);
  tween("to", `#${p}-window`, { opacity: 0, scale: 0.94, y: 30, duration: WINDOW_FALL - 0.1, ease: "power2.in" }, stepsEnd);
  const duration = round(stepsEnd + WINDOW_FALL);
  frames.at(-1).end = duration;

  // The captions: each rises in as its step starts and fades before it ends.
  for (const caption of captions) {
    tween("fromTo", `#${caption.id} .caption-inner`, { opacity: 0, y: 24 }, caption.start + CAPTION_IN.delay, { opacity: 1, y: 0, duration: CAPTION_IN.duration, ease: "power3.out" });
    tween("to", `#${caption.id} .caption-inner`, { opacity: 0, y: -10, duration: 0.3, ease: "power2.in" }, caption.end - CAPTION_OUT);
  }
  // The crossfades of the frames.
  frames.forEach((frame, index) => {
    if (frame.fade > 0) {
      tween("fromTo", `#${p}-frame-${index + 1}`, { opacity: 0 }, frame.start, { opacity: 1, duration: frame.fade, ease: "power1.inOut" });
    }
  });
  tween("set", `#${p}-pointer`, { x: round(POINTER_START.x), y: round(POINTER_START.y) }, 0);

  // The address bar: one clip for each run of frames with the same path,
  // which cuts to the next path as its frame starts, also under a crossfade,
  // so that two paths never show at once.
  const addresses = [];
  for (const frame of frames) {
    const last = addresses.at(-1);
    if (last && last.path === frame.path) continue;
    if (last) last.end = frame.start;
    addresses.push({ path: frame.path, start: frame.start, end: null });
  }
  addresses.at(-1).end = duration;

  const chapter = tutorial.chapters[chapterIndex];
  const cardMarkup = withCard
    ? `    <div id="${p}-card" ${clip(0, CHAPTER_CARD, "card")} data-track-index="1">
      <div class="card-inner" id="${p}-card-inner">
        <div class="eyebrow">Chapter ${chapterIndex + 1}</div>
        <h2>${escapeHtml(chapter.title)}</h2>
      </div>
    </div>
`
    : "";
  if (withCard) {
    tween("fromTo", `#${p}-card-inner`, { opacity: 0, y: 24 }, 0.1, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" });
    tween("to", `#${p}-card-inner`, { opacity: 0, y: -24, duration: 0.45, ease: "power2.in" }, CHAPTER_CARD - 0.55);
  }
  const pad = RING.pad;
  const markup = `${cardMarkup}    <div id="${p}-world" class="world" data-layout-allow-overflow>
      <div id="${p}-window" class="window">
        <div class="title-bar">
          <div class="light" style="left: 16px; background: #ff5f57"></div>
          <div class="light" style="left: 36px; background: #febc2e"></div>
          <div class="light" style="left: 56px; background: #28c840"></div>
          <div class="address-bar" data-layout-ignore>
${addresses
  .map(
    (address, index) =>
      `            <span id="${p}-address-${index + 1}" ${clip(address.start, address.end)} data-track-index="3"><span class="host">${HOST}</span>${escapeHtml(address.path)}</span>`,
  )
  .join("\n")}
          </div>
        </div>
        <div class="content">
          <div class="page">
${frames
  .map(
    (frame, index) =>
      `            <img id="${p}-frame-${index + 1}" ${clip(frame.start, frame.end, "frame")} data-track-index="2" src="assets/frames/${frame.file}" alt="" />`,
  )
  .join("\n")}
${rings
  .map(
    ({ id: ringId, box }) =>
      `            <div id="${ringId}" class="ring" style="left: ${round(box.x - pad)}px; top: ${round(box.y - pad)}px; width: ${round(box.width + 2 * pad)}px; height: ${round(box.height + 2 * pad)}px"></div>`,
  )
  .join("\n")}
${ripples
  .map(({ id: rippleId, x, y }) => `            <div id="${rippleId}" class="ripple" style="left: ${round(x - 36)}px; top: ${round(y - 36)}px"></div>`)
  .join("\n")}
${keycaps
  .map(({ id: keyId, key, x, y }) => `            <div id="${keyId}" class="keycap" style="left: ${round(x)}px; top: ${round(y)}px">${escapeHtml(key)}</div>`)
  .join("\n")}
            <div id="${p}-pointer" class="pointer">
              <svg id="${p}-pointer-shape" class="pointer-shape" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2 L3 27 L9.5 21 L14 31.5 L18.5 29.5 L14 19.5 L23 19.5 Z" fill="#111827" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
${captions
  .map(
    (caption) => `    <div id="${caption.id}" ${clip(caption.start, caption.end, "caption")} data-track-index="4" data-narration="${escapeHtml(caption.step.narration ?? "")}">
      <div class="caption-inner"><span class="caption-number">${caption.number}</span><span class="caption-text">${escapeHtml(caption.step.caption)}</span></div>
    </div>`,
  )
  .join("\n")}`;
  return {
    compositionId,
    file: sceneFile(compositionId, CHAPTER_STYLES, markup, tweens),
    duration,
    frames,
    card: withCard ? { title: `Chapter ${chapterIndex + 1}: ${chapter.title}`, start: 0, end: CHAPTER_CARD } : null,
    steps: timings.map(({ step, start: stepStart, focus, end }) => ({
      id: step.id,
      number: numbers.get(step.id),
      chapter: chapterIndex + 1,
      action: step.action,
      caption: step.caption,
      start: stepStart,
      focus,
      end,
    })),
    findings,
  };
}

// --- The film -----------------------------------------------------------

const withCards = tutorial.chapters.length > 1;
const numbers = new Map(capture.steps.map((step, index) => [step.id, index + 1]));
const scenes = [{ compositionId: "intro", file: introScene(), duration: INTRO }];
const chapters = [];
// The times of the cards and of the steps in the film, and the findings of
// the checks, which compose.json records for the review (docs/authoring.md,
// Review).
const cards = [{ title: tutorial.title, start: 0, end: INTRO }];
const steps = [];
const findings = [];
const shift = (offset, item, keys) => ({ ...item, ...Object.fromEntries(keys.map((key) => [key, round(offset + item[key])])) });
let time = INTRO;
for (const [index, chapter] of tutorial.chapters.entries()) {
  const captured = capture.steps.filter((step) => step.chapter === index);
  if (captured.length !== chapter.steps.length) {
    throw new Error(`the capture of ${id} lacks steps of chapter ${index + 1}; capture it again`);
  }
  const scene = chapterScene(index, captured, numbers, withCards);
  scenes.push(scene);
  chapters.push({ title: chapter.title, start: index === 0 ? 0 : round(time) });
  if (scene.card) cards.push(shift(time, scene.card, ["start", "end"]));
  steps.push(...scene.steps.map((step) => shift(time, step, ["start", "focus", "end"])));
  findings.push(...scene.findings.map((finding) => shift(time, finding, ["at"])));
  time += scene.duration;
}
scenes.push({ compositionId: "outro", file: outroScene(), duration: OUTRO });
const duration = round(time + OUTRO);
cards.push({ title: tutorial.outro?.title ?? "That's it", start: round(time), end: duration });

// --- Files --------------------------------------------------------------

await rm(compositionDir, { recursive: true, force: true });
for (const dir of ["compositions", "assets/frames", "assets/fonts", "assets/vendor"]) {
  await mkdir(join(compositionDir, dir), { recursive: true });
}
for (const scene of scenes) {
  for (const frame of scene.frames ?? []) {
    await copyFile(join(captureDir, frame.file), join(compositionDir, "assets", "frames", frame.file));
  }
  await writeFile(join(compositionDir, "compositions", `${scene.compositionId}.html`), scene.file);
}
await copyFile(
  "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  join(compositionDir, "assets", "fonts", "inter.woff2"),
);
await copyFile("node_modules/gsap/dist/gsap.min.js", join(compositionDir, "assets", "vendor", "gsap.min.js"));

let start = 0;
const hosts = scenes
  .map((scene) => {
    const host = `      <div id="${scene.compositionId}" data-composition-id="${scene.compositionId}" data-composition-src="compositions/${scene.compositionId}.html" data-start="${round(start)}" data-duration="${round(scene.duration)}" data-track-index="1" data-track-kind="graphics" data-width="${CANVAS.width}" data-height="${CANVAS.height}"></div>`;
    start += scene.duration;
    return host;
  })
  .join("\n");

await writeFile(
  join(compositionDir, "index.html"),
  `<!doctype html>
<!-- Generated by src/compose.mjs from tutorials/${id}.json; do not edit. -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(tutorial.title)}</title>
    <style>
${FONT_FACE}
      html,
      body {
        margin: 0;
        background: #0b1220;
      }
      #root {
        position: relative;
        width: ${CANVAS.width}px;
        height: ${CANVAS.height}px;
        overflow: hidden;
      }
      #backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(1100px 700px at 18% 12%, rgba(9, 105, 218, 0.38), transparent 60%),
          radial-gradient(900px 600px at 88% 92%, rgba(31, 111, 235, 0.22), transparent 60%),
          linear-gradient(160deg, #0b1220 0%, #101b31 55%, #0a1020 100%);
      }
    </style>
    <script src="assets/vendor/gsap.min.js"></script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${CANVAS.width}" data-height="${CANVAS.height}">
      <div id="backdrop"></div>
${hosts}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`,
);

// The chapters of the MP4, which a player lists, and its title.
const ffmeta = [";FFMETADATA1", `title=${tutorial.title.replace(/[=;#\\\n]/g, (c) => `\\${c}`)}`];
if (chapters.length > 1) {
  chapters.forEach((chapter, index) => {
    const end = index + 1 < chapters.length ? chapters[index + 1].start : duration;
    ffmeta.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(chapter.start * 1000)}`, `END=${Math.round(end * 1000)}`);
    ffmeta.push(`title=${chapter.title.replace(/[=;#\\\n]/g, (c) => `\\${c}`)}`);
  });
}
await writeFile(join(outDir, "chapters.ffmeta"), `${ffmeta.join("\n")}\n`);
await writeFile(
  join(outDir, "compose.json"),
  `${JSON.stringify({ tutorial: id, script: tutorial.hash, duration, chapters, cards, steps, findings }, null, 2)}\n`,
);

console.error(
  `compose: ${capture.steps.length} steps in ${chapters.length} chapter(s), ${duration} s, in ${compositionDir}`,
);
for (const finding of findings) {
  console.error(`compose: ${id}: step ${finding.number} (${finding.step}) at ${finding.at} s: ${finding.check}: ${finding.message}`);
}
if (findings.length > 0) {
  console.error(`compose: ${id}: ${findings.length} finding(s) of the checks (docs/authoring.md, Review)`);
}
