// Generates the HyperFrames composition of a captured tutorial: one
// 1920x1080 composition whose single GSAP timeline animates the screenshots
// of the capture in a window, with a camera that zooms and pans towards the
// target of each step, a synthetic pointer that moves and clicks, highlights,
// captions, transitions, and a title at the start and at the end. Writes
// <out>/composition/index.html and its assets.
//
// Usage: node src/compose.mjs <script> <out>

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [scriptPath, outDir] = process.argv.slice(2);
if (!scriptPath || !outDir) {
  console.error("usage: node src/compose.mjs <script> <out>");
  process.exit(2);
}

const script = JSON.parse(await readFile(scriptPath, "utf8"));
const captureDir = join(outDir, "capture");
const capture = JSON.parse(await readFile(join(captureDir, "capture.json"), "utf8"));
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
const WINDOW = {
  left: (CANVAS.width - CONTENT_WIDTH) / 2,
  top: 36,
};
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
const CAMERA_MOVE = 1.0;
const POINTER_MOVE = 0.85;
const CROSSFADE = 0.45;
const TYPING_TIME = { min: 0.6, max: 1.4, perCharacter: 0.09 };

// The zoom of the camera towards the target of each action, unless the step
// names one: 1 shows the whole window.
const ACTION_ZOOM = { goto: 1, fill: 1.75, click: 1.6, show: 1.3 };

const round = (value) => Math.round(value * 1000) / 1000;

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

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// The film as data: the clips, with their start and duration, and the tweens
// of the timeline, each a GSAP call at an absolute time.
const frames = [];
const captions = [];
const rings = [];
const ripples = [];
const tweens = [];
let pointerShown = false;
// Where the pointer enters, in CSS pixels of the page.
const POINTER_START = { x: PAGE.width * 0.72, y: PAGE.height * 0.82 };
let pointer = POINTER_START;

function tween(method, selector, vars, at, extra) {
  tweens.push({ method, selector, vars, at: round(at), extra });
}

function moveCamera(zoom, point, at, duration = CAMERA_MOVE) {
  tween("to", "#world", { ...camera(zoom, point), duration, ease: "power3.inOut" }, at);
}

// Hides the pointer, which the next move shows again where it was.
function hidePointer(at) {
  if (!pointerShown) return;
  tween("to", "#pointer-shape", { opacity: 0, duration: 0.3 }, at);
  pointerShown = false;
}

function movePointer(to, at) {
  if (!pointerShown) {
    tween("fromTo", "#pointer-shape", { opacity: 0 }, at, { opacity: 1, duration: 0.3 });
    pointerShown = true;
  }
  tween("to", "#pointer", { x: round(to.x), y: round(to.y), duration: POINTER_MOVE, ease: "power2.inOut" }, at);
  pointer = to;
}

function click(at) {
  const id = `ripple-${ripples.length + 1}`;
  ripples.push({ id, x: pointer.x, y: pointer.y });
  tween("fromTo", "#pointer-shape", { scale: 1 }, at, { scale: 0.82, duration: 0.09, yoyo: true, repeat: 1, ease: "power1.inOut" });
  tween("fromTo", `#${id}`, { scale: 0.2, opacity: 0.55 }, at, { scale: 1, opacity: 0, duration: 0.6, ease: "power2.out" });
}

function ring(step, box, at, end) {
  const id = `ring-${step.id}`;
  rings.push({ id, box });
  tween("fromTo", `#${id}`, { opacity: 0, scale: 1.08 }, at, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" });
  tween("to", `#${id}`, { opacity: 0, duration: 0.3 }, end - 0.3);
}

// Shows a frame from `at`: a cut, or a crossfade over the previous one.
function showFrame(file, path, at, fade = 0) {
  const previous = frames.at(-1);
  if (previous) previous.end = at + fade;
  frames.push({ file, path, start: at, end: null, fade });
}

let time = INTRO;
const start = time;
for (const [index, step] of capture.steps.entries()) {
  const scriptStep = script.steps.find((candidate) => candidate.id === step.id) ?? {};
  const zoom = scriptStep.zoom ?? ACTION_ZOOM[step.action];
  const target = center(step.box);
  const stepStart = time;
  const files = step.frames;
  switch (step.action) {
    case "goto": {
      showFrame(files[0].file, files[0].path, time, frames.length ? CROSSFADE : 0);
      if (target && zoom > 1) moveCamera(zoom, target, time + 0.6, 1.4);
      time += scriptStep.duration ?? 3.6;
      break;
    }
    case "fill": {
      const [before, focus, ...typed] = files;
      if (frames.at(-1)?.file !== before.file) showFrame(before.file, before.path, time);
      moveCamera(zoom, target, time);
      movePointer(target, time + 0.2);
      const clickAt = time + 0.2 + POINTER_MOVE + 0.05;
      click(clickAt);
      showFrame(focus.file, focus.path, clickAt + 0.05);
      const typing = Math.min(
        TYPING_TIME.max,
        Math.max(TYPING_TIME.min, typed.length * TYPING_TIME.perCharacter),
      );
      const typingStart = clickAt + 0.35;
      typed.forEach((frame, character) => {
        showFrame(frame.file, frame.path, typingStart + (typing * character) / typed.length);
      });
      time = typingStart + typing + (scriptStep.hold ?? 1.1);
      break;
    }
    case "click": {
      const [before, after] = files;
      if (frames.at(-1)?.file !== before.file) showFrame(before.file, before.path, time);
      moveCamera(zoom, target, time);
      movePointer(target, time + 0.2);
      const clickAt = time + 0.2 + POINTER_MOVE + 0.15;
      ring(step, step.box, time + 0.5, clickAt + 0.25);
      click(clickAt);
      showFrame(after.file, after.path, clickAt + 0.3, CROSSFADE);
      moveCamera(1, null, clickAt + 0.4, 1.1);
      time = clickAt + 0.4 + 1.1 + (scriptStep.hold ?? 1.0);
      break;
    }
    case "show": {
      const [current] = files;
      hidePointer(time);
      if (frames.at(-1)?.file !== current.file) showFrame(current.file, current.path, time, CROSSFADE);
      if (target && zoom > 1) moveCamera(zoom, target, time + 0.2, 1.4);
      const duration = scriptStep.duration ?? 4.2;
      if (step.box) ring(step, step.box, time + 1.2, time + duration);
      time += duration;
      break;
    }
    default:
      throw new Error(`unknown action ${step.action} of step ${step.id}`);
  }
  captions.push({
    id: `caption-${step.id}`,
    number: index + 1,
    text: step.caption,
    narration: step.narration,
    start: stepStart,
    end: time,
  });
}
const end = time;
// The outro: the camera returns to the whole window, which recedes.
moveCamera(1, null, end, 0.8);
hidePointer(end);
tween("to", "#window", { opacity: 0, scale: 0.94, y: 30, duration: 0.7, ease: "power2.in" }, end + 0.5);
const duration = round(end + OUTRO);
frames.at(-1).end = duration;

// The intro: the title, then the window rises into view.
tween("fromTo", "#window", { opacity: 0, scale: 0.9, y: 60 }, INTRO - 0.9, { opacity: 1, scale: 1, y: 0, duration: 0.9, ease: "power3.out" });

// The captions: each rises in as its step starts and fades before it ends.
for (const caption of captions) {
  tween("fromTo", `#${caption.id} .caption-inner`, { opacity: 0, y: 24 }, caption.start + 0.1, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" });
  tween("to", `#${caption.id} .caption-inner`, { opacity: 0, y: -10, duration: 0.3, ease: "power2.in" }, caption.end - 0.32);
}

// The address bar: one clip for each run of frames with the same path.
const addresses = [];
for (const frame of frames) {
  const last = addresses.at(-1);
  if (last && last.path === frame.path) {
    last.end = frame.end;
  } else {
    addresses.push({ path: frame.path, start: frame.start, end: frame.end });
  }
}

// --- Assets -------------------------------------------------------------

await rm(compositionDir, { recursive: true, force: true });
await mkdir(join(compositionDir, "assets", "frames"), { recursive: true });
await mkdir(join(compositionDir, "assets", "fonts"), { recursive: true });
await mkdir(join(compositionDir, "assets", "vendor"), { recursive: true });
for (const frame of frames) {
  await copyFile(join(captureDir, frame.file), join(compositionDir, "assets", "frames", frame.file));
}
await copyFile(
  "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  join(compositionDir, "assets", "fonts", "inter.woff2"),
);
await copyFile("node_modules/gsap/dist/gsap.min.js", join(compositionDir, "assets", "vendor", "gsap.min.js"));
// The Sentinel mark of the UI under capture (Aura src/favicon.svg).
const mark = (await readFile("aura/src/favicon.svg", "utf8")).match(/<path d="([^"]+)"/)[1];

// --- HTML ---------------------------------------------------------------

const clip = (start, end, className = "") =>
  `class="${`clip ${className}`.trim()}" data-start="${round(start)}" data-duration="${round(end - start)}"`;

const frameHtml = frames
  .map(
    (frame, index) =>
      `        <img id="frame-${index + 1}" ${clip(frame.start, frame.end, "frame")} data-track-index="2" src="assets/frames/${frame.file}" alt="" />`,
  )
  .join("\n");

const addressHtml = addresses
  .map(
    (address, index) =>
      `          <span id="address-${index + 1}" ${clip(address.start, address.end)} data-track-index="3"><span class="host">${HOST}</span>${escapeHtml(address.path)}</span>`,
  )
  .join("\n");

const ringHtml = rings
  .map(({ id, box }) => {
    const pad = 6;
    return `          <div id="${id}" class="ring" style="left: ${round(box.x - pad)}px; top: ${round(box.y - pad)}px; width: ${round(box.width + 2 * pad)}px; height: ${round(box.height + 2 * pad)}px"></div>`;
  })
  .join("\n");

const rippleHtml = ripples
  .map(
    ({ id, x, y }) =>
      `          <div id="${id}" class="ripple" style="left: ${round(x - 36)}px; top: ${round(y - 36)}px"></div>`,
  )
  .join("\n");

const captionHtml = captions
  .map(
    (caption) => `    <div id="${caption.id}" ${clip(caption.start, caption.end, "caption")} data-track-index="4" data-narration="${escapeHtml(caption.narration ?? "")}">
      <div class="caption-inner"><span class="caption-number">${caption.number}</span><span class="caption-text">${escapeHtml(caption.text)}</span></div>
    </div>`,
  )
  .join("\n");

// No fromTo renders its start values when the timeline is built: the styles
// hold the state of each element before its first tween runs, such as a
// ripple that shows only once its click comes.
const tweenJs = tweens
  .sort((a, b) => a.at - b.at)
  .map(({ method, selector, vars, at, extra }) => {
    if (method !== "fromTo") {
      return `      tl.${method}(${JSON.stringify(selector)}, ${JSON.stringify(vars)}, ${at});`;
    }
    const to = { ...extra, immediateRender: false };
    return `      tl.fromTo(${JSON.stringify(selector)}, ${JSON.stringify(vars)}, ${JSON.stringify(to)}, ${at});`;
  })
  .join("\n");

const crossfadeJs = frames
  .map((frame, index) =>
    frame.fade > 0
      ? `      tl.fromTo("#frame-${index + 1}", { opacity: 0 }, { opacity: 1, duration: ${frame.fade}, ease: "power1.inOut" }, ${round(frame.start)});`
      : null,
  )
  .filter(Boolean)
  .join("\n");

const html = `<!doctype html>
<!-- Generated by src/compose.mjs from ${scriptPath}; do not edit. -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(script.title)}</title>
    <style>
      @font-face {
        font-family: "Inter Variable";
        src: url("assets/fonts/inter.woff2") format("woff2");
        font-weight: 100 900;
        font-style: normal;
      }
      * {
        box-sizing: border-box;
      }
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
        font-family: "Inter Variable", sans-serif;
        color: #f4f7fb;
      }
      #backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(1100px 700px at 18% 12%, rgba(9, 105, 218, 0.38), transparent 60%),
          radial-gradient(900px 600px at 88% 92%, rgba(31, 111, 235, 0.22), transparent 60%),
          linear-gradient(160deg, #0b1220 0%, #101b31 55%, #0a1020 100%);
      }
      #world {
        position: absolute;
        left: 0;
        top: 0;
        width: ${CANVAS.width}px;
        height: ${CANVAS.height}px;
        transform-origin: 0 0;
      }
      #window {
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
      #title-bar {
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
      #address-bar {
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
      #address-bar > span {
        position: absolute;
        inset: 0;
        line-height: 24px;
        text-align: center;
        font-size: 14px;
        color: #1f2328;
      }
      #address-bar .host {
        color: #59636e;
      }
      #content {
        position: absolute;
        left: 0;
        top: ${TITLE_BAR}px;
        width: ${CONTENT_WIDTH}px;
        height: ${CONTENT_HEIGHT}px;
        overflow: hidden;
      }
      #page {
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
      #pointer {
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
      }
      #pointer-shape {
        position: absolute;
        left: -3px;
        top: -2px;
        width: 26px;
        height: 34px;
        opacity: 0;
        transform-origin: 3px 2px;
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35));
      }
      .card {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
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
      .card h1 {
        margin: 34px 0 0;
        font-size: 84px;
        font-weight: 750;
        letter-spacing: -0.02em;
        line-height: 1.05;
      }
      .card p {
        margin: 22px 0 0;
        font-size: 34px;
        font-weight: 400;
        color: #b4c2d8;
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
        width: 44px;
        height: 44px;
        border-radius: 50%;
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
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${CANVAS.width}" data-height="${CANVAS.height}">
      <div id="backdrop"></div>
      <div id="world" data-layout-allow-overflow>
        <div id="window">
          <div id="title-bar">
            <div class="light" style="left: 16px; background: #ff5f57"></div>
            <div class="light" style="left: 36px; background: #febc2e"></div>
            <div class="light" style="left: 56px; background: #28c840"></div>
            <div id="address-bar" data-layout-ignore>
${addressHtml}
            </div>
          </div>
          <div id="content">
            <div id="page">
${frameHtml}
${ringHtml}
${rippleHtml}
              <div id="pointer">
                <svg id="pointer-shape" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 2 L3 27 L9.5 21 L14 31.5 L18.5 29.5 L14 19.5 L23 19.5 Z" fill="#111827" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="intro" ${clip(0, INTRO)} data-track-index="1">
        <div class="card"><div class="card-inner" id="intro-inner">
          <div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${mark}" /></svg>Sentinel Aura</div>
          <h1>${escapeHtml(script.title)}</h1>
          <p>${escapeHtml(script.subtitle ?? "")}</p>
        </div></div>
      </div>
      <div id="outro" ${clip(end + 0.9, duration)} data-track-index="1">
        <div class="card"><div class="card-inner" id="outro-inner">
          <div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${mark}" /></svg>Sentinel Aura</div>
          <h1>${escapeHtml(script.outro?.title ?? "")}</h1>
          <p>${escapeHtml(script.outro?.subtitle ?? "")}</p>
        </div></div>
      </div>
${captionHtml}
    </div>
    <script src="assets/vendor/gsap.min.js"></script>
    <script>
      const tl = gsap.timeline({ paused: true });
      // The title is on screen from the first frame, the thumbnail of a player.
      tl.fromTo("#intro-inner", { scale: 0.97 }, { scale: 1, duration: 1.6, ease: "power2.out" }, 0);
      tl.fromTo("#intro-inner p", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.4);
      tl.to("#intro-inner", { opacity: 0, y: -30, duration: 0.5, ease: "power2.in" }, ${round(INTRO - 0.95)});
      tl.fromTo("#outro-inner", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, ${round(end + 1.0)});
      tl.fromTo("#world", { x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 1, duration: 0.01 }, 0);
      tl.set("#pointer", { x: ${round(POINTER_START.x)}, y: ${round(POINTER_START.y)} }, 0);
${crossfadeJs}
${tweenJs}
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

await writeFile(join(compositionDir, "index.html"), html);
console.error(
  `compose: ${frames.length} frames, ${captions.length} steps, ${duration} s in ${compositionDir}`,
);
