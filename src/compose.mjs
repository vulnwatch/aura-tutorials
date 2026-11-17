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
      border: 3px solid ${ACCENT};
      border-radius: 10px;
      box-shadow: 0 0 0 6px rgba(9, 105, 218, 0.18);
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
// file and its duration.
function chapterScene(chapterIndex, steps, numbers, withCard) {
  const p = `c${chapterIndex + 1}`;
  const compositionId = `chapter-${chapterIndex + 1}`;
  const frames = [];
  const captions = [];
  const rings = [];
  const ripples = [];
  const keycaps = [];
  const tweens = [];
  let pointerShown = false;
  let pointer = POINTER_START;

  const tween = (method, selector, vars, at, extra) => tweens.push({ method, selector, vars, at, extra });
  const moveCamera = (zoom, point, at, duration = CAMERA_MOVE) =>
    tween("to", `#${p}-world`, { ...camera(zoom, point), duration, ease: "power3.inOut" }, at);
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
  const keycap = (step, at, end) => {
    const keyId = `${p}-key-${step.id}`;
    const position = step.box
      ? { x: step.box.x + step.box.width - 90, y: step.box.y + step.box.height + 14 }
      : { x: PAGE.width / 2 - 45, y: PAGE.height - 160 };
    keycaps.push({ id: keyId, key: step.key, ...position });
    tween("fromTo", `#${keyId}`, { opacity: 0, y: 10 }, at, { opacity: 1, y: 0, duration: 0.25, ease: "back.out(2)" });
    tween("fromTo", `#${keyId}`, { scale: 1 }, at + 0.35, { scale: 0.9, duration: 0.08, yoyo: true, repeat: 1 });
    tween("to", `#${keyId}`, { opacity: 0, duration: 0.25 }, end - 0.25);
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
  for (const step of steps) {
    const zoom = step.zoom ?? ACTION_ZOOM[step.action];
    const target = center(step.box);
    const stepStart = time;
    const files = step.frames;
    switch (step.action) {
      case "goto": {
        showFrame(files[0], time, frames.length ? CROSSFADE : 0);
        hidePointer(time);
        let actionEnd = time + 0.6;
        if (target && zoom > 1) {
          moveCamera(zoom, target, time + 0.6, 1.4);
          actionEnd = time + 2.0;
        }
        time = stepEnd(step, stepStart, actionEnd);
        break;
      }
      case "fill": {
        const [before, focus, ...typed] = files;
        showFrame(before, time);
        moveCamera(zoom, target, time);
        movePointer(target, time + 0.2);
        const clickAt = time + 0.2 + POINTER_MOVE + 0.05;
        click(clickAt);
        showFrame(focus, clickAt + 0.05);
        const typing = Math.min(TYPING_TIME.max, Math.max(TYPING_TIME.min, typed.length * TYPING_TIME.perCharacter));
        const typingStart = clickAt + 0.35;
        typed.forEach((frame, character) => showFrame(frame, typingStart + (typing * character) / typed.length));
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
        click(clickAt);
        showFrame(after, clickAt + 0.3, CROSSFADE);
        moveCamera(1, null, clickAt + 0.4, 1.1);
        time = stepEnd(step, stepStart, clickAt + 1.5);
        break;
      }
      case "press": {
        const [before, after] = files;
        showFrame(before, time);
        if (target) moveCamera(zoom, target, time);
        const pressAt = time + (target ? 0.9 : 0.4);
        keycap(step, pressAt - 0.35, pressAt + 1.0);
        showFrame(after, pressAt + 0.15, CROSSFADE);
        moveCamera(1, null, pressAt + 0.4, 1.1);
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
        if (step.box) ring(step, step.box, time + 1.2, end);
        time = end;
        break;
      }
      default:
        throw new Error(`unknown action ${step.action} of step ${step.id}`);
    }
    captions.push({ id: `${p}-caption-${step.id}`, number: numbers.get(step.id), step, start: stepStart, end: time });
  }
  // The chapter ends with the whole window, which recedes.
  const stepsEnd = time;
  moveCamera(1, null, stepsEnd, 0.6);
  hidePointer(stepsEnd);
  tween("to", `#${p}-window`, { opacity: 0, scale: 0.94, y: 30, duration: WINDOW_FALL - 0.1, ease: "power2.in" }, stepsEnd);
  const duration = round(stepsEnd + WINDOW_FALL);
  frames.at(-1).end = duration;

  // The captions: each rises in as its step starts and fades before it ends.
  for (const caption of captions) {
    tween("fromTo", `#${caption.id} .caption-inner`, { opacity: 0, y: 24 }, caption.start + 0.1, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" });
    tween("to", `#${caption.id} .caption-inner`, { opacity: 0, y: -10, duration: 0.3, ease: "power2.in" }, caption.end - 0.32);
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
  const pad = 6;
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
  return { compositionId, file: sceneFile(compositionId, CHAPTER_STYLES, markup, tweens), duration, frames };
}

// --- The film -----------------------------------------------------------

const withCards = tutorial.chapters.length > 1;
const numbers = new Map(capture.steps.map((step, index) => [step.id, index + 1]));
const scenes = [{ compositionId: "intro", file: introScene(), duration: INTRO }];
const chapters = [];
let time = INTRO;
for (const [index, chapter] of tutorial.chapters.entries()) {
  const steps = capture.steps.filter((step) => step.chapter === index);
  if (steps.length !== chapter.steps.length) {
    throw new Error(`the capture of ${id} lacks steps of chapter ${index + 1}; capture it again`);
  }
  const scene = chapterScene(index, steps, numbers, withCards);
  scenes.push(scene);
  chapters.push({ title: chapter.title, start: index === 0 ? 0 : round(time) });
  time += scene.duration;
}
scenes.push({ compositionId: "outro", file: outroScene(), duration: OUTRO });
const duration = round(time + OUTRO);

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
await writeFile(join(outDir, "compose.json"), `${JSON.stringify({ tutorial: id, script: tutorial.hash, duration, chapters }, null, 2)}\n`);

console.error(
  `compose: ${capture.steps.length} steps in ${chapters.length} chapter(s), ${duration} s, in ${compositionDir}`,
);
