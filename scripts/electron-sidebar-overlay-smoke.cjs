const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { execFileSync } = require("node:child_process");
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  dialog,
  nativeImage,
  session,
  webContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(
  tmpdir(),
  `surffish-basewindow-overlay-smoke-${process.pid}`,
);
const screenshotDirectory = process.env.SURFFISH_SCREENSHOT_DIR;
const fixtureTitle = "Surffish BaseWindow overlay fixture";
const server = createServer((request, response) => {
  if (request.url === "/favicon.svg") {
    response.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
    });
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#45b37c"/></svg>',
    );
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(
    `<!doctype html><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>${fixtureTitle}</title><style>html,body{margin:0;width:100%;min-height:180vh;font:20px system-ui;color:#fff;background:repeating-linear-gradient(135deg,#145b55 0 56px,#2f8e78 56px 112px)}h1{margin:0;padding:18px;background:#b21e35;font-size:20px}#target{position:absolute;top:112px;left:68vw;width:230px;height:78px;display:grid;place-items:center;background:#192e4a;border:3px solid #fff;border-radius:12px;cursor:pointer}#target strong{font-size:20px}#count{position:absolute;top:205px;left:68vw}#edge-target{position:absolute;top:230px;left:8px;width:28px;height:48px;padding:0;background:#f0c419;color:#000;cursor:pointer}#page-input{position:absolute;top:270px;left:58vw;width:280px;height:42px;font:18px system-ui}</style><h1>LIVE SYNTHETIC PAGE — FULL-WIDTH OVERLAY TEST</h1><button id="target" onclick="window.clickCount=(window.clickCount||0)+1;document.querySelector('#count').textContent='Clicks: '+window.clickCount"><strong>Click page under overlay</strong></button><button id="edge-target" aria-label="Edge click target" onclick="window.edgeClickCount=(window.edgeClickCount||0)+1">edge</button><div id="count">Clicks: 0</div><input id="page-input" aria-label="Page input" placeholder="Real keyboard input test"><p style="margin-top:420px">Synthetic full-width web content</p>`,
  );
});
let mainWindow;
// shared/page-view-bounds.ts PAGE_FRAME_GAP: the page card's gap from the browser frame on every side.
const PAGE_FRAME_GAP = 6;
// The sidebar view starts at the toolbar's bottom line (the browser frame) and runs to the bottom.
const sidebarReachesBottom = (height) => {
  const bounds = rendererViews.sidebar.getBounds();
  return bounds.y > 0 && bounds.y + bounds.height === height;
};
let fixtureUrl;
let rendererViews = {};
let fixturePageView;
let closeWindowConfirmationOptions = null;
const showMessageBox = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  if (options?.message === "Close the window?") {
    closeWindowConfirmationOptions = options;
    return { response: options.cancelId ?? 1, checkboxChecked: false };
  }
  return showMessageBox(...args);
};

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function waitFor(
  predicate,
  description,
  timeout = Number(process.env.SMOKE_WAIT_MS || 30000),
) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `Timed out while waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

function surfaceFor(view) {
  if (!view?.webContents || view.webContents.isDestroyed()) return null;
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
}

function nativeViewState() {
  return mainWindow.contentView.children.map((view, index) => ({
    index,
    kind: view.constructor?.name ?? "unknown",
    bounds: view.getBounds(),
    visible: view.getVisible(),
    url:
      view.webContents && !view.webContents.isDestroyed()
        ? view.webContents.getURL()
        : null,
    surface: surfaceFor(view),
  }));
}

function collapsedRailVisible() {
  const view = rendererViews.sidebar;
  if (!view?.getVisible()) return false;
  const bounds = view.getBounds();
  return bounds.x === 0 && bounds.width >= 83 && bounds.width <= 85;
}

async function evaluate(view, expression) {
  assert.ok(
    view?.webContents && !view.webContents.isDestroyed(),
    "the requested renderer surface must be available",
  );
  return view.webContents.executeJavaScript(expression);
}

function sampleSidebarPinMorph(view, direction) {
  const directionLiteral = JSON.stringify(direction);
  return evaluate(
    view,
    `(() => {
      const direction = ${directionLiteral}
      const card = document.querySelector('.browser-sidebar')
      if (!card) throw new Error('sidebar card is unavailable for pin sampling')
      const marks = (root, selector) => [...(root?.querySelectorAll(selector) ?? [])].map((element) => {
        const mark = element.querySelector('.tab-favicon, .pinned-site-mark') ?? element
        const rect = mark.getBoundingClientRect()
        return { key: element.dataset.motionKey ?? null, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })
      const rail = card.querySelector('.sidebar-rail')
      const panel = card.querySelector('.sidebar-panel')
      const railButton = rail?.querySelector('.sidebar-rail-pins-row [data-rail-align="pins"]')
      const rect = (element) => {
        if (!element) return null
        const value = element.getBoundingClientRect()
        return { x: value.x, y: value.y, width: value.width, height: value.height }
      }
      const before = {
        rail: marks(rail, '.sidebar-rail-pins-slot'),
        panel: marks(panel, '.sidebar-pinned-list > [data-motion-key]'),
        railDebug: {
          card: rect(card),
          body: rect(card.querySelector('.sidebar-body')),
          rail: rect(rail),
          button: rect(railButton),
          buttonMargin: railButton?.style.marginTop ?? null,
          buttonMarkDx: railButton?.style.getPropertyValue('--sidebar-rail-mark-dx') ?? null,
          columnMarkShift: rail?.style.getPropertyValue('--sidebar-rail-mark-shift') ?? null,
          buttonTranslate: railButton ? getComputedStyle(railButton).translate : null,
        },
      }
      const activeSelector = direction === 'expand'
        ? '.sidebar-panel:not(.is-shape-hidden)'
        : '.sidebar-rail:not(.is-shape-hidden)'
      const activeMarksSelector = direction === 'expand'
        ? '.sidebar-pinned-list > [data-motion-key]'
        : '.sidebar-rail-pins-slot'
      return new Promise((resolve, reject) => {
        const frames = []
        const startedAt = performance.now()
        const tick = () => {
          const phase = card.getAttribute('data-reshaping')
          if (phase === direction) {
            frames.push({ phase, at: performance.now(), marks: marks(card.querySelector(activeSelector), activeMarksSelector) })
          } else if (frames.length) {
            frames.push({ phase, at: performance.now(), marks: marks(card.querySelector(activeSelector), activeMarksSelector) })
            resolve({ before, frames })
            return
          }
          if (performance.now() - startedAt > 5000) {
            reject(new Error('timed out sampling the ' + direction + ' pin morph'))
            return
          }
          requestAnimationFrame(tick)
        }
        const patch = direction === 'expand'
          ? { sidebarPinned: true, sidebarHovered: false, sidebarFocused: false }
          : { sidebarPinned: false, sidebarHovered: false, sidebarFocused: false }
        Promise.resolve(window.api.browser.chrome.set(patch)).catch(reject)
        requestAnimationFrame(tick)
      })
    })()`,
  );
}

function assertSidebarPinMorph(sample, direction) {
  const from =
    direction === "expand" ? sample.before.rail : sample.before.panel;
  const target =
    direction === "expand" ? sample.before.panel : sample.before.rail;
  const targetKeys = new Set(target.map((pin) => pin.key));
  const common = from.filter((pin) => targetKeys.has(pin.key));
  assert.ok(
    common.length >= 2,
    `${direction} has multiple pinned marks to glide`,
  );
  assert.deepEqual(
    common.map((pin) => pin.key),
    target
      .filter((pin) => common.some((item) => item.key === pin.key))
      .map((pin) => pin.key),
    `${direction} keeps the rail and panel pin order`,
  );
  assert.ok(
    sample.frames.length >= 4,
    `${direction} samples several rendered animation frames`,
  );
  assert.deepEqual(
    sample.frames.at(-1).marks.map((pin) => pin.key),
    target.map((pin) => pin.key),
    `${direction} ends with the target shape's pin order`,
  );

  const first = common[0];
  const firstTarget = target.find((pin) => pin.key === first.key);
  assert.ok(firstTarget);
  assert.ok(
    Math.abs(first.x - firstTarget.x) <= 1 &&
      Math.abs(first.y - firstTarget.y) <= 1,
    `${direction} starts with the first pin aligned to its counterpart (rail ${JSON.stringify(first)}, target ${JSON.stringify(firstTarget)}, layout ${JSON.stringify(sample.before.railDebug)})`,
  );
  for (const frame of sample.frames) {
    const pin = frame.marks.find((item) => item.key === first.key);
    assert.ok(pin, `${direction} keeps the first pin in every sampled frame`);
    assert.ok(
      Math.abs(pin.x - first.x) <= 1 && Math.abs(pin.y - first.y) <= 1,
      `${direction} keeps the first pin fixed through the morph (x=${pin.x}, y=${pin.y})`,
    );
  }

  for (const start of common.slice(1)) {
    const end = target.find((pin) => pin.key === start.key);
    assert.ok(end);
    const travel = end.x - start.x;
    assert.ok(
      Math.abs(travel) > 1,
      `${direction} gives ${start.key} a sideways glide`,
    );
    assert.ok(
      Math.abs(travel) < 100,
      `${direction} keeps ${start.key}'s glide under 100px`,
    );
    const path = sample.frames.map((frame) =>
      frame.marks.find((pin) => pin.key === start.key),
    );
    assert.ok(
      path.every(Boolean),
      `${direction} samples ${start.key} throughout the morph`,
    );
    let maxStep = 0;
    let maxStepIndex = 0;
    for (let index = 1; index < path.length; index += 1) {
      const step = path[index].x - path[index - 1].x;
      if (Math.abs(step) > maxStep) {
        maxStep = Math.abs(step);
        maxStepIndex = index;
      }
      assert.ok(
        travel > 0 ? step >= -1 : step <= 1,
        `${direction} moves ${start.key} monotonically toward its target`,
      );
    }
    const worstIntervalMs =
      maxStepIndex > 0
        ? sample.frames[maxStepIndex].at - sample.frames[maxStepIndex - 1].at
        : 0;
    assert.ok(
      maxStep <= 12,
      `${direction} glides ${start.key} without a jump (max ${maxStep.toFixed(2)}px over ${worstIntervalMs.toFixed(1)}ms; x=${path.map((pin) => pin.x.toFixed(1)).join("→")})`,
    );
    assert.ok(
      Math.abs(path.at(-1).x - end.x) <= 1 &&
        Math.abs(path.at(-1).y - end.y) <= 1,
      `${direction} lands ${start.key} on its panel/rail target`,
    );
  }
  console.log(
    `[sidebar-overlay-smoke] ${direction} pin morph: ${sample.frames.length} rendered frames; first pin fixed; remaining pins glide and land on target`,
  );
}

// The frame's opaque surface colour (src/shared/sidebar-card.ts BROWSER_FRAME_SURFACE_ARGB): on
// Linux (no vibrancy) the toolbar strip, rail, docked panel and the floating hover card all paint
// exactly this. macOS paints glass instead; these pixel checks run on the Linux path only.
const FRAME_SURFACE_RGB = [25, 27, 31];
// src/shared/sidebar-card.ts SIDEBAR_FLOAT: the hover card's gap off the frame and its radius.
const SIDEBAR_FLOAT = { gap: 6, radius: 12 };

/**
 * Toolbar, frame and sidebar meet at the toolbar's bottom line as one surface (no seam): grab the
 * composited window (every native view, as X11 shows it) a few px above and below that line at x
 * and require the same colour, the frame's surface colour, on both sides.
 */
async function assertFrameJunction(what, x = 40) {
  if (process.platform !== "linux" || !process.env.DISPLAY) return;
  const toolbarBottom = Math.round(
    await evaluate(
      rendererViews.toolbar,
      'document.querySelector(".browser-chrome").getBoundingClientRect().bottom',
    ),
  );
  const content = mainWindow.getContentBounds();
  const top = toolbarBottom - 4;
  const file = join(userData, `frame-junction-${Date.now()}.png`);
  const sample = () => {
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "x11grab",
      "-video_size",
      "1x9",
      "-i",
      `${process.env.DISPLAY}.0+${content.x + x},${content.y + top}`,
      "-frames:v",
      "1",
      "-y",
      file,
    ]);
    const bitmap = nativeImage.createFromPath(file).toBitmap(); // BGRA, 1 px wide
    const at = (row) => [
      bitmap[row * 4 + 2],
      bitmap[row * 4 + 1],
      bitmap[row * 4],
    ];
    return { above: at(0), below: at(8) };
  };
  const close = (a, b) => a.every((value, i) => Math.abs(value - b[i]) <= 2);
  // A fresh layout may still be compositing; poll briefly before judging the colours.
  let last = null;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    last = sample();
    if (close(last.above, last.below) && close(last.above, FRAME_SURFACE_RGB))
      break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  console.log(
    `[sidebar-overlay-smoke] frame junction (${what}) at x=${x}: above ${last.above.join(",")} below ${last.below.join(",")}`,
  );
  assert.ok(
    close(last.above, last.below),
    `${what}: the toolbar (${last.above}) and the sidebar (${last.below}) are one surface at the toolbar's bottom line`,
  );
  assert.ok(
    close(last.above, FRAME_SURFACE_RGB),
    `${what}: the frame paints its surface colour (${last.above}, want ${FRAME_SURFACE_RGB})`,
  );
}

/** One composited window pixel (content coordinates) as X11 shows it: [r, g, b]. */
function grabWindowPixel(x, y) {
  const content = mainWindow.getContentBounds();
  const file = join(userData, `frame-pixel-${Date.now()}.png`);
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "x11grab",
    "-video_size",
    "1x1",
    "-i",
    `${process.env.DISPLAY}.0+${content.x + Math.round(x)},${content.y + Math.round(y)}`,
    "-frames:v",
    "1",
    "-y",
    file,
  ]);
  const bitmap = nativeImage.createFromPath(file).toBitmap(); // BGRA
  return [bitmap[2], bitmap[1], bitmap[0]];
}

/**
 * The page card's inner corner is rounded against the frame (PAGE_FRAME_RADIUS): the pixel just
 * inside the corner is the frame's surface colour, a pixel further in along the diagonal is the
 * page. `corner` is the card's top-left, in the rail and docked states.
 */
async function assertRoundedCardCorner(what, corner) {
  if (process.platform !== "linux" || !process.env.DISPLAY) return;
  const close = (a, b) => a.every((value, i) => Math.abs(value - b[i]) <= 3);
  let cut = null;
  let inside = null;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    cut = grabWindowPixel(corner.x + 1, corner.y + 1);
    inside = grabWindowPixel(corner.x + 8, corner.y + 8);
    if (close(cut, FRAME_SURFACE_RGB) && !close(inside, FRAME_SURFACE_RGB))
      break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  console.log(
    `[sidebar-overlay-smoke] card corner (${what}) at ${corner.x},${corner.y}: corner ${cut.join(",")} inside ${inside.join(",")}`,
  );
  assert.ok(
    close(cut, FRAME_SURFACE_RGB),
    `${what}: the page card's inner corner is rounded, the frame shows in it (${cut}, want ${FRAME_SURFACE_RGB})`,
  );
  assert.ok(
    !close(inside, FRAME_SURFACE_RGB),
    `${what}: inside the rounded corner the page shows (${inside})`,
  );
}

/**
 * The floating hover card's corner over the page is rounded (SIDEBAR_FLOAT.radius): the pixel in
 * the corner is the page (not the card's surface), the pixel further in is the card's surface.
 */
async function assertFloatingCardCorner(
  what,
  { corner, inside, fillTolerance = 3 },
) {
  if (process.platform !== "linux" || !process.env.DISPLAY) return;
  const close = (a, b, tolerance = 3) =>
    a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
  let cut = null;
  let fill = null;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    cut = grabWindowPixel(corner.x, corner.y);
    fill = grabWindowPixel(inside.x, inside.y);
    if (
      !close(cut, FRAME_SURFACE_RGB) &&
      close(fill, FRAME_SURFACE_RGB, fillTolerance)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  console.log(
    `[sidebar-overlay-smoke] ${what} at ${corner.x},${corner.y}: corner ${cut.join(",")} inside ${fill.join(",")}`,
  );
  assert.ok(
    !close(cut, FRAME_SURFACE_RGB),
    `${what}: the card's corner is rounded, the page shows in it (${cut})`,
  );
  assert.ok(
    close(fill, FRAME_SURFACE_RGB, fillTolerance),
    `${what}: inside its corner the card paints the frame surface (${fill}, want ${FRAME_SURFACE_RGB})`,
  );
}

function captureFullWindow(name) {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  const display = process.env.DISPLAY;
  assert.ok(display, "DISPLAY is required when SURFFISH_SCREENSHOT_DIR is set");
  const { x, y, width, height } = mainWindow.getBounds();
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "x11grab",
    "-video_size",
    `${width}x${height}`,
    "-i",
    `${display}.0+${x},${y}`,
    "-frames:v",
    "1",
    "-y",
    join(screenshotDirectory, basename(name)),
  ]);
}

function seedIsolatedProfile() {
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const blocker = ElectronBlocker.parse(
    "||surffish-smoke-never-match.invalid^",
    smoke.ADBLOCK_CONFIG,
  );
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), {
    mode: 0o600,
  });
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
    { mode: 0o600 },
  );
}

function pointerMove(x, y) {
  execFileSync("xdotool", [
    "mousemove",
    String(Math.round(x)),
    String(Math.round(y)),
  ]);
}

function pointerClick(x, y) {
  execFileSync("xdotool", [
    "mousemove",
    String(Math.round(x)),
    String(Math.round(y)),
    "click",
    "1",
  ]);
}
function pointerDown(x, y) {
  execFileSync("xdotool", [
    "mousemove",
    String(Math.round(x)),
    String(Math.round(y)),
    "mousedown",
    "1",
  ]);
}
function pointerUp() {
  execFileSync("xdotool", ["mouseup", "1"]);
}

function pointerType(value) {
  execFileSync("xdotool", ["type", "--clearmodifiers", "--delay", "4", value]);
}

function pointerScrollDown(x, y) {
  execFileSync("xdotool", [
    "mousemove",
    String(Math.round(x)),
    String(Math.round(y)),
    "click",
    "5",
  ]);
}

function screenPointForElement(view, rect) {
  const content = mainWindow.getContentBounds();
  const native = view.getBounds();
  return {
    x: content.x + native.x + rect.x + rect.width / 2,
    y: content.y + native.y + rect.y + rect.height / 2,
  };
}

async function waitForStableScroll(accept, description) {
  let last = null;
  let stableSince = 0;
  await waitFor(async () => {
    const y =
      await fixturePageView.webContents.executeJavaScript("window.scrollY");
    if (y !== last) {
      last = y;
      stableSince = Date.now();
      return false;
    }
    return accept(y) && Date.now() - stableSince >= 300;
  }, description);
}

async function waitForSidebarPinControl() {
  // The integrated rail stays at x=0; expansion is complete when the panel is wider than the rail and settles.
  await waitFor(async () => {
    const bounds = rendererViews.sidebar.getBounds();
    if (
      !rendererViews.sidebar.getVisible() ||
      bounds.x !== 0 ||
      bounds.width <= 100
    ) {
      return false;
    }
    await delay(80);
    const settled = rendererViews.sidebar.getBounds();
    return settled.x === 0 && settled.width === bounds.width;
  }, "the integrated sidebar to finish expanding from its rail to a stable panel width");
  await waitFor(
    () =>
      evaluate(
        rendererViews.sidebar,
        `(() => {
    const button = document.querySelector('[aria-label="Keep sidebar open"]')
    if (!button) return false
    const r = button.getBoundingClientRect()
    if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) return false
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[aria-label="Keep sidebar open"]') === button
  })()`,
      ),
    "the sidebar slide-in to finish with the footer pin control hit-testable",
  );
}

async function clickElement(view, selector) {
  const rect = await evaluate(
    view,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  assert.ok(rect, `the ${selector} control must exist`);
  const point = screenPointForElement(view, rect);
  pointerClick(point.x, point.y);
  return point;
}

async function run() {
  app.setPath("userData", userData);
  seedIsolatedProfile();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;
  writeFileSync(
    join(userData, "browser-preferences.json"),
    `${JSON.stringify({
      version: 1,
      pinnedSites: [
        {
          title: "YouTube",
          url: "https://www.youtube.com/",
          faviconUrl: "https://www.youtube.com/favicon.ico",
        },
        {
          title: "Google",
          url: "https://www.google.com/",
          faviconUrl: "https://www.google.com/favicon.ico",
        },
        {
          title: "Gmail",
          url: "https://mail.google.com/",
          faviconUrl: "https://mail.google.com/favicon.ico",
        },
        {
          title: "Maps",
          url: "https://maps.google.com/",
          faviconUrl: "https://maps.google.com/favicon.ico",
        },
      ],
    })}\n`,
    { mode: 0o600 },
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => {
      const candidate = BaseWindow.getAllWindows().find(
        (window) => !window.isDestroyed(),
      );
      return candidate && candidate.isVisible() ? candidate : null;
    },
    "the production Surffish BaseWindow",
    45000,
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 620 });
  mainWindow.focus();

  await waitFor(
    () => {
      rendererViews = Object.fromEntries(
        mainWindow.contentView.children
          .filter((view) => view.webContents && !view.webContents.isDestroyed())
          .map((view) => [surfaceFor(view), view])
          .filter(([surface]) => surface),
      );
      return (
        rendererViews.content && rendererViews.toolbar && rendererViews.sidebar
      );
    },
    "all three trusted renderer surfaces",
    45000,
  );
  await waitFor(
    () =>
      evaluate(
        rendererViews.content,
        'Boolean(document.querySelector(".new-tab-page"))',
      ),
    "the renderer-owned New Tab page",
  );
  assert.equal(
    await evaluate(
      rendererViews.content,
      'document.querySelector(".sidebar-heading .sidebar-icon-button")',
    ),
    null,
    "the header New Tab plus button is removed",
  );
  assert.equal(
    await evaluate(
      rendererViews.content,
      '(() => { const card = document.querySelector(".browser-sidebar"); const shape = card?.classList.contains("is-collapsed") ? card.querySelector(".sidebar-rail:not(.is-shape-hidden)") : card?.querySelector(".sidebar-panel:not(.is-shape-hidden)"); return shape?.querySelector("[aria-label=\\"New tab\\"]")?.getAttribute("aria-label") ?? null; })()',
    ),
    "New tab",
    "the bottom New Tab action is available in the sidebar",
  );
  assert.equal(
    await evaluate(
      rendererViews.content,
      'document.querySelector(".sidebar-collapse-button")',
    ),
    null,
    "the duplicate sidebar-header pin control is removed",
  );
  assert.ok(
    await evaluate(
      rendererViews.content,
      'document.querySelector(".toolbar-brand-icon")?.getBoundingClientRect().width >= 32',
    ),
    "the app brand mark is prominent in the top toolbar",
  );
  // The rail skips alignment during a shape morph and realigns on the next frame; sample only
  // after that geometry has stopped moving, without relaxing the 1px assertion below.
  let stableRailOffset = null;
  let stableRailOffsetSince = 0;
  const sidebarActions = await waitFor(async () => {
    const state = await evaluate(
      rendererViews.content,
      `(() => {
        const card = document.querySelector('.browser-sidebar')
        const collapsed = Boolean(card?.classList.contains('is-collapsed'))
        const shape = card?.querySelector(collapsed ? '.sidebar-rail:not(.is-shape-hidden)' : '.sidebar-panel:not(.is-shape-hidden)')
        if (!shape) return null
        const selector = collapsed ? '.sidebar-rail-footer .sidebar-footer-icon-button' : '.sidebar-footer-icon-button'
        const controls = [...shape.querySelectorAll(selector)].map((button) => ({ label: button.getAttribute('aria-label'), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }))
        const labels = [...shape.querySelectorAll('[aria-label]')].map((element) => element.getAttribute('aria-label'))
        const iconRect = (root, selector) => {
          const icon = root?.querySelector(selector)
          if (!icon || icon.getClientRects().length === 0) return null
          const rect = icon.getBoundingClientRect()
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        }
        const railPlus = collapsed ? iconRect(shape, '.sidebar-rail-new-tab .sidebar-new-tab-row-icon') : null
        const panelPlus = collapsed ? iconRect(card.querySelector('.sidebar-panel'), '.sidebar-new-tab-row .sidebar-new-tab-row-icon') : null
        const pins = collapsed ? [...shape.querySelectorAll('.sidebar-rail-pins-slot, .sidebar-rail-pins-more')].map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, more: el.classList.contains('sidebar-rail-pins-more') ? el.textContent : null } }) : null
        const markRect = (el) => { const mark = el.querySelector('.tab-favicon, .pinned-site-mark') ?? el; const r = mark.getBoundingClientRect(); return { key: el.dataset.motionKey ?? null, x: r.x + r.width / 2, y: r.y + r.height / 2 } }
        const railPinMarks = collapsed ? [...shape.querySelectorAll('.sidebar-rail-pins-slot')].map(markRect) : null
        const panelPinMarks = collapsed ? [...(card.querySelector('.sidebar-panel')?.querySelectorAll('.sidebar-pinned-list > [data-motion-key]') ?? [])].map(markRect) : null
        const railPinButton = collapsed ? shape.querySelector('.sidebar-rail-pins-row [data-rail-align="pins"]') : null
        const railPinAlign = railPinButton ? { marginTop: railPinButton.style.marginTop, shift: railPinButton.style.getPropertyValue('--sidebar-rail-mark-shift'), dx: railPinButton.style.getPropertyValue('--sidebar-rail-mark-dx'), reshaping: card.getAttribute('data-reshaping') } : null
        const railFirstTab = collapsed ? iconRect(shape, '[data-motion-key^="tab:"] .tab-favicon') : null
        const panelFirstTab = collapsed ? iconRect(card.querySelector('.sidebar-panel'), '[data-motion-key^="tab:"] .tab-favicon') : null
        return {
          collapsed,
          reshaping: card?.getAttribute('data-reshaping') ?? null,
          controls,
          labels,
          newTab: shape.querySelector('[aria-label="New tab"]')?.getAttribute('aria-label') ?? null,
          newTabOffset: railPlus && panelPlus ? { dx: railPlus.x - panelPlus.x, dy: railPlus.y - panelPlus.y } : null,
          pins,
          railPinMarks,
          panelPinMarks,
          railPinAlign,
          railFirstTab,
          panelFirstTab,
        }
      })()`,
    );
    if (!state?.controls.length) {
      stableRailOffset = null;
      stableRailOffsetSince = 0;
      return null;
    }
    if (!state.collapsed) {
      stableRailOffset = null;
      stableRailOffsetSince = 0;
      return state;
    }
    if (state.reshaping !== null || !state.newTabOffset) {
      stableRailOffset = null;
      stableRailOffsetSince = 0;
      return null;
    }
    const offset = `${state.newTabOffset.dx.toFixed(2)}:${state.newTabOffset.dy.toFixed(2)}`;
    if (offset !== stableRailOffset) {
      stableRailOffset = offset;
      stableRailOffsetSince = Date.now();
      return null;
    }
    return Date.now() - stableRailOffsetSince >= 100 ? state : null;
  }, "the active sidebar shape, actions, and settled rail alignment");
  const sidebarControlLabels = sidebarActions.controls.map(
    ({ label }) => label,
  );
  if (sidebarActions.collapsed) {
    // Hovering the rail reveals the panel over it, so the rail carries only the pin.
    assert.deepEqual(
      sidebarControlLabels,
      ["Keep sidebar open"],
      "the collapsed rail exposes only the sidebar pin",
    );
    // The rail keeps its own New tab +, keyed to and lined up on the panel's New Tab row.
    assert.equal(
      sidebarActions.newTab,
      "New tab",
      "the collapsed rail has its New Tab + action",
    );
    for (const absent of ["New private tab", "Settings"])
      assert.ok(
        !sidebarActions.labels.includes(absent),
        `the collapsed rail has no ${absent} action`,
      );
    if (sidebarActions.newTabOffset) {
      const { dx, dy } = sidebarActions.newTabOffset;
      console.log(
        `[sidebar-overlay-smoke] rail New tab + vs panel row: dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`,
      );
      // The column shifts onto the panel's favicon line and nudges each mark onto its counterpart.
      assert.ok(
        Math.abs(dx) <= 1,
        `the rail New tab + sits on the panel row's + horizontally (dx=${dx})`,
      );
    }
    // Pins are one row of stacked marks (shared/rail-pin-cluster.ts), so the tabs start right below.
    const pins = sidebarActions.pins ?? [];
    console.log(
      `[sidebar-overlay-smoke] rail pins: ${JSON.stringify(pins)} first tab: ${JSON.stringify(sidebarActions.railFirstTab)} panel first tab: ${JSON.stringify(sidebarActions.panelFirstTab)}`,
    );
    console.log(
      `[sidebar-overlay-smoke] rail pin alignment: ${JSON.stringify(sidebarActions.railPinAlign)}`,
    );
    assert.ok(pins.length >= 1, "the collapsed rail draws its pins");
    assert.ok(pins.length <= 4, "the rail draws at most four pin slots");
    for (const pin of pins)
      assert.ok(
        Math.abs(pin.top - pins[0].top) <= 1,
        `every rail pin shares one row (${JSON.stringify(pins)})`,
      );
    // The cluster is the panel's pins row folded up (shared/rail-pin-cluster.ts): the same order,
    // never reordered for the active pin, its first pin exactly on the row's first pin and every
    // mark on the row's line, so a shape change only spreads or gathers them horizontally.
    const railPinMarks = sidebarActions.railPinMarks ?? [];
    const panelPinMarks = sidebarActions.panelPinMarks ?? [];
    console.log(
      `[sidebar-overlay-smoke] rail pin marks: ${JSON.stringify(railPinMarks)} panel pin marks: ${JSON.stringify(panelPinMarks)}`,
    );
    assert.ok(
      railPinMarks.length >= 1 && panelPinMarks.length >= railPinMarks.length,
      "the panel's pins row draws every pin the cluster draws",
    );
    assert.deepEqual(
      railPinMarks.map((pin) => pin.key),
      panelPinMarks.slice(0, railPinMarks.length).map((pin) => pin.key),
      "the rail's pin cluster keeps the panel row's order",
    );
    if (pins.some((pin) => pin.more !== null))
      assert.ok(
        pins.at(-1).more !== null,
        "the +N chip is the cluster's last slot",
      );
    {
      const dx = railPinMarks[0].x - panelPinMarks[0].x;
      const dy = railPinMarks[0].y - panelPinMarks[0].y;
      assert.ok(
        Math.abs(dx) <= 1 && Math.abs(dy) <= 1,
        `the cluster's first pin sits on the panel row's first pin within 1px (dx=${dx}, dy=${dy})`,
      );
      for (const pin of railPinMarks)
        assert.ok(
          Math.abs(pin.y - panelPinMarks[0].y) <= 1,
          `every cluster pin is on the panel pins row's y (${pin.key}: ${pin.y} vs ${panelPinMarks[0].y})`,
        );
    }
    if (sidebarActions.railFirstTab) {
      const pinCentre = (pins[0].top + pins[0].bottom) / 2;
      const below = sidebarActions.railFirstTab.y - pinCentre;
      assert.ok(
        sidebarActions.railFirstTab.y > pins[0].bottom && below <= 80,
        `the first tab sits one row below the pins (${below}px)`,
      );
      if (sidebarActions.panelFirstTab) {
        const dx =
          sidebarActions.railFirstTab.x - sidebarActions.panelFirstTab.x;
        const dy =
          sidebarActions.railFirstTab.y - sidebarActions.panelFirstTab.y;
        assert.ok(
          Math.abs(dx) <= 1 && Math.abs(dy) <= 1,
          `the rail's first tab favicon sits on the panel's within 1px (dx=${dx}, dy=${dy})`,
        );
      }
    }
  } else {
    assert.equal(
      sidebarActions.newTab,
      "New tab",
      "the expanded panel exposes a New Tab action",
    );
    assert.ok(
      sidebarControlLabels.includes("Keep sidebar open") &&
        sidebarControlLabels.includes("Settings") &&
        sidebarControlLabels.includes("Quit Surffish"),
      "the expanded panel exposes pin, Settings and Quit controls",
    );
  }
  const maxActionSize = 36;
  assert.ok(
    sidebarActions.controls.every(
      ({ width, height }) => width <= maxActionSize && height <= maxActionSize,
    ),
    "the active rail hit targets or panel controls fit their expected size",
  );
  assert.ok(
    await evaluate(
      rendererViews.toolbar,
      'Boolean(document.querySelector(".browser-toolbar-leading") && document.querySelector(".browser-toolbar-trailing"))',
    ),
    "toolbar controls use distinct left and right groups",
  );
  // Startup briefly holds a transient fourth view under load; settle instead of single-sampling.
  console.log(
    "[overlay-smoke] initial children:",
    JSON.stringify(
      mainWindow.contentView.children.map((view) => {
        try {
          return view.webContents && !view.webContents.isDestroyed()
            ? view.webContents.getURL() || "(blank)"
            : "(no contents)";
        } catch {
          return "(gone)";
        }
      }),
    ),
  );
  // The hidden tab-overview view is preloaded ~1.5s after the window opens (a data: URL), so it is not
  // counted as a page view. Background-only native Views have no WebContents and are not renderer
  // surfaces; only the three shell surfaces may remain for New Tab.
  const pageLevelChildren = () =>
    mainWindow.contentView.children.filter((view) => {
      if (!view.webContents) return false;
      try {
        return !(
          view.webContents &&
          !view.webContents.isDestroyed() &&
          view.webContents.getURL().startsWith("data:text/html") &&
          !view.getVisible()
        );
      } catch {
        return true;
      }
    });
  await waitFor(
    () => pageLevelChildren().length === 3,
    "the initial New Tab to settle on three app surfaces",
  );
  const initialShell = nativeViewState();
  assert.equal(
    pageLevelChildren().length,
    3,
    "the initial New Tab has three app surfaces and no remote page view",
  );
  assert.equal(
    rendererViews.content.getVisible(),
    true,
    "the full React content surface remains visible for New Tab",
  );
  assert.equal(rendererViews.toolbar.getVisible(), false);
  assert.equal(rendererViews.sidebar.getVisible(), false);

  if (screenshotDirectory) {
    mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 712 });
    await delay(250);
    await evaluate(
      rendererViews.content,
      'window.api.browser.chrome.set({ sidebarMode: "tabs", sidebarPinned: true, sidebarHovered: false, sidebarFocused: false })',
    );
    await waitFor(
      () =>
        evaluate(
          rendererViews.content,
          'document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")',
        ),
      "the New Tab sidebar for the product screenshot",
    );
    await delay(350);
    pointerMove(
      mainWindow.getContentBounds().x + 1260,
      mainWindow.getContentBounds().y + 780,
    );
    await delay(200);
    captureFullWindow("surffish-cover-new-tab.png");
    await evaluate(
      rendererViews.content,
      "window.api.browser.chrome.set({ sidebarPinned: false, sidebarHovered: false, sidebarFocused: false })",
    );
    await waitFor(
      () =>
        evaluate(
          rendererViews.content,
          '!document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")',
        ),
      "the New Tab sidebar to close after the screenshot",
    );
    mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 620 });
    await delay(250);
  }

  const firstTab = (
    await evaluate(rendererViews.content, "window.api.browser.tabs.get()")
  ).find((tab) => tab.active);
  assert.ok(firstTab, "the initial New Tab should be active");
  mainWindow.focus();
  rendererViews.content.webContents.focus();
  execFileSync("xdotool", ["key", "ctrl+w"]);
  await waitFor(
    () => closeWindowConfirmationOptions,
    "the last-tab close confirmation prompt",
  );
  assert.deepEqual(
    closeWindowConfirmationOptions.buttons,
    ["Close Window", "Cancel"],
    "the prompt offers an explicit cancel choice",
  );
  assert.equal(
    closeWindowConfirmationOptions.cancelId,
    1,
    "cancel is the safe default for the smoke test",
  );
  await waitFor(async () => {
    if (mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
    const tabs = await evaluate(
      rendererViews.content,
      "window.api.browser.tabs.get()",
    );
    return tabs.length === 1 && tabs[0]?.id === firstTab.id;
  }, "canceling the last-tab prompt keeps the original New Tab and window open");

  const replacementTab = (
    await evaluate(rendererViews.content, "window.api.browser.tabs.get()")
  ).find((tab) => tab.active);
  assert.ok(replacementTab);
  rendererViews.content.webContents.focus();
  execFileSync("xdotool", ["key", "ctrl+t"]);
  await waitFor(async () => {
    const tabs = await evaluate(
      rendererViews.content,
      "window.api.browser.tabs.get()",
    );
    return (
      tabs.length === 2 &&
      tabs.some((tab) => tab.active && tab.id !== replacementTab.id)
    );
  }, "Command-T creates and activates a new tab");
  await waitFor(
    () =>
      evaluate(
        rendererViews.content,
        'document.activeElement === document.querySelector(".omnibox > input[type=text]")',
      ),
    "the address field receives focus on the new tab",
  );
  rendererViews.content.webContents.focus();
  execFileSync("xdotool", ["key", "ctrl+w"]);
  await waitFor(async () => {
    const tabs = await evaluate(
      rendererViews.content,
      "window.api.browser.tabs.get()",
    );
    return tabs.length === 1 && tabs[0]?.id === replacementTab.id;
  }, "Command-W closes the active tab without closing the window");

  assert.equal(
    await evaluate(
      rendererViews.content,
      `window.api.browser.navigate(${JSON.stringify(fixtureUrl)}).then((result) => result.ok)`,
    ),
    true,
    "the app should open a synthetic loopback page",
  );
  await waitFor(
    async () =>
      (await evaluate(rendererViews.toolbar, "window.api.browser.state()"))
        .url === fixtureUrl,
    "the synthetic page navigation",
  );
  await waitFor(async () => {
    const tabs = await evaluate(
      rendererViews.toolbar,
      "window.api.browser.tabs.get()",
    );
    // The app inlines fetched favicons as data: URLs in the tab summary; accept the
    // declared URL or its inlined form.
    const icon = tabs.find((tab) => tab.url === fixtureUrl)?.faviconUrl;
    return (
      typeof icon === "string" &&
      (icon === `${new URL(fixtureUrl).origin}/favicon.svg` ||
        icon.startsWith("data:image/"))
    );
  }, "the page-declared favicon to appear in the active tab summary");
  await waitFor(
    () => {
      fixturePageView = mainWindow.contentView.children.find(
        (view) =>
          view.webContents &&
          !view.webContents.isDestroyed() &&
          view.webContents.getURL() === fixtureUrl,
      );
      return fixturePageView && fixturePageView.getBounds().width > 0;
    },
    "the native page view with full-width bounds",
    45000,
  );
  await delay(250);
  assert.equal(
    fixturePageView.webContents.session,
    session.fromPartition("persist:surffish-browser"),
    "live pages use Surffish’s namespaced persistent site session",
  );
  await fixturePageView.webContents.executeJavaScript(
    "document.cookie = 'surffish-overlay-smoke=cookie-preserved; path=/; SameSite=Lax'",
  );

  const contentSizeBeforeResize = mainWindow.getContentSize();
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  await waitFor(() => {
    const [width, height] = mainWindow.getContentSize();
    const siteBounds = fixturePageView.getBounds();
    return (
      width > contentSizeBeforeResize[0] &&
      height > contentSizeBeforeResize[1] &&
      rendererViews.content.getBounds().width === width &&
      rendererViews.toolbar.getBounds().width === width &&
      sidebarReachesBottom(height) &&
      siteBounds.x + siteBounds.width === width - PAGE_FRAME_GAP &&
      siteBounds.y + siteBounds.height === height - PAGE_FRAME_GAP
    );
  }, "all native shell layers and the live page resize with the window");
  const toolbarLayout = await evaluate(
    rendererViews.toolbar,
    `(() => {
    const toolbar = document.querySelector('.browser-toolbar').getBoundingClientRect()
    const address = document.querySelector('.omnibox-wrap').getBoundingClientRect()
    const actions = document.querySelector('.browser-toolbar-trailing').getBoundingClientRect()
    return { toolbar: { left: toolbar.left, right: toolbar.right }, address: { left: address.left, right: address.right }, actions: { left: actions.left, right: actions.right } }
  })()`,
  );
  // Single-sample centering flakes under load (flex rounding lands a px off while the
  // resize settles); poll briefly instead. 2px keeps the intent while absorbing rounding.
  await waitFor(async () => {
    const layout = await evaluate(
      rendererViews.toolbar,
      `(() => {
      const toolbar = document.querySelector('.browser-toolbar').getBoundingClientRect()
      const address = document.querySelector('.omnibox-wrap').getBoundingClientRect()
      return { toolbar: { left: toolbar.left, right: toolbar.right }, address: { left: address.left, right: address.right } }
    })()`,
    );
    return (
      Math.abs(
        (layout.toolbar.left + layout.toolbar.right) / 2 -
          (layout.address.left + layout.address.right) / 2,
      ) <= 2
    );
  }, "the address bar to settle centered in the toolbar");
  assert.ok(
    toolbarLayout.actions.right <= toolbarLayout.toolbar.right,
    "toolbar icons stay within the right edge",
  );
  assert.ok(
    toolbarLayout.address.right < toolbarLayout.actions.left,
    "a gap separates the address bar from the right-aligned icons",
  );

  mainWindow.maximize();
  await delay(250);
  await waitFor(() => {
    const [width, height] = mainWindow.getContentSize();
    const siteBounds = fixturePageView.getBounds();
    return (
      width > 0 &&
      height > 0 &&
      rendererViews.content.getBounds().width === width &&
      rendererViews.toolbar.getBounds().width === width &&
      sidebarReachesBottom(height) &&
      siteBounds.x + siteBounds.width === width - PAGE_FRAME_GAP &&
      siteBounds.y + siteBounds.height === height - PAGE_FRAME_GAP
    );
  }, "native shell layers and the live page match the size after maximize");
  const contentSize = mainWindow.getContentSize();
  pointerMove(
    mainWindow.getContentBounds().x + Math.floor(contentSize[0] / 2),
    mainWindow.getContentBounds().y + Math.floor(contentSize[1] / 2),
  );
  await waitFor(
    collapsedRailVisible,
    "the collapsed sidebar rail to remain visible after the pointer leaves its reveal edge",
  );
  const pageHiddenSidebar = fixturePageView.getBounds();
  const sidebarHiddenState = nativeViewState();
  // The auto-hiding sidebar's rail stays on screen, so the page sits beside it rather than under it,
  // as a card inset from the frame (and the window's right and bottom edges) by the frame gap.
  assert.equal(
    contentSize[0] - (pageHiddenSidebar.x + pageHiddenSidebar.width),
    PAGE_FRAME_GAP,
    "the live page card keeps the frame gap from the window's right edge",
  );
  assert.equal(
    contentSize[1] - (pageHiddenSidebar.y + pageHiddenSidebar.height),
    PAGE_FRAME_GAP,
    "the live page card keeps the frame gap from the window's bottom edge",
  );
  assert.equal(
    rendererViews.content.getVisible(),
    false,
    "the full React renderer is hidden above the page and cannot intercept its input",
  );
  assert.equal(rendererViews.toolbar.getVisible(), true);
  // In tabs mode the panel collapses to a persistent 84px rail; the inset live-page card stays beside it.
  assert.equal(
    rendererViews.sidebar.getVisible(),
    true,
    "the collapsed sidebar rail remains visible",
  );
  const collapsedSidebarBounds = sidebarHiddenState.find(
    (view) => view.surface === "sidebar",
  ).bounds;
  assert.equal(collapsedSidebarBounds.x, 0);
  assert.ok(
    collapsedSidebarBounds.width >= 83 && collapsedSidebarBounds.width <= 85,
    `the collapsed sidebar is rail-width (${JSON.stringify(collapsedSidebarBounds)})`,
  );
  assert.equal(
    pageHiddenSidebar.x -
      (collapsedSidebarBounds.x + collapsedSidebarBounds.width),
    PAGE_FRAME_GAP,
    `the live page card keeps the frame gap from the collapsed rail's right edge (page ${JSON.stringify(pageHiddenSidebar)}, rail ${JSON.stringify(collapsedSidebarBounds)})`,
  );
  // The browser frame: the toolbar strip runs the full width and the sidebar lives only below its
  // bottom line; the page card starts the frame gap below it.
  const toolbarBottom = await evaluate(
    rendererViews.toolbar,
    'document.querySelector(".browser-chrome").getBoundingClientRect().bottom',
  );
  assert.ok(
    collapsedSidebarBounds.y >= toolbarBottom - 0.5 &&
      collapsedSidebarBounds.y - toolbarBottom <= 1,
    `the collapsed rail starts at the toolbar's bottom line, never over the toolbar (rail y ${collapsedSidebarBounds.y}, toolbar bottom ${toolbarBottom})`,
  );
  await assertFrameJunction("collapsed rail");
  await assertRoundedCardCorner("collapsed rail", pageHiddenSidebar);
  assert.ok(
    Math.abs(pageHiddenSidebar.y - toolbarBottom - PAGE_FRAME_GAP) <= 1,
    `the live page card keeps the frame gap below the toolbar (page y ${pageHiddenSidebar.y}, toolbar bottom ${toolbarBottom})`,
  );
  assert.ok(
    await evaluate(
      rendererViews.toolbar,
      '(() => { const style = getComputedStyle(document.querySelector(".browser-chrome")); return style.borderBottomColor === "rgba(0, 0, 0, 0)" && style.backgroundColor === "rgba(0, 0, 0, 0)" })()',
    ),
    "the toolbar strip draws no seam or ground of its own over the frame's material",
  );
  assert.ok(
    sidebarHiddenState.find((view) => view.surface === "toolbar").index >
      sidebarHiddenState.find((view) => view.url === fixtureUrl).index,
    "the toolbar is layered above the live page",
  );
  assert.ok(
    sidebarHiddenState.find((view) => view.surface === "sidebar").index >
      sidebarHiddenState.find((view) => view.url === fixtureUrl).index,
    "the sidebar is layered above the live page",
  );
  captureFullWindow("sidebar-overlay-live-page-collapsed-rail.png");

  const expandPinSample = await sampleSidebarPinMorph(
    rendererViews.sidebar,
    "expand",
  );
  assertSidebarPinMorph(expandPinSample, "expand");
  await waitFor(
    () => rendererViews.sidebar.getBounds().width >= 300,
    "the pinned sidebar to finish expanding after its pin morph",
  );
  const dockedSidebarBounds = rendererViews.sidebar.getBounds();
  const dockedPageBounds = fixturePageView.getBounds();
  const dockedBackdropState = await evaluate(
    rendererViews.toolbar,
    "window.api.browser.sidebarBackdrop.get()",
  );
  assert.equal(
    dockedBackdropState.state.nativeOverlay,
    false,
    "the docked panel hides the hover-only backdrop and exposes the window material",
  );
  assert.equal(
    dockedSidebarBounds.y,
    toolbarBottom,
    "the docked panel begins at the toolbar's bottom edge",
  );
  assert.equal(
    dockedPageBounds.x - (dockedSidebarBounds.x + dockedSidebarBounds.width),
    PAGE_FRAME_GAP,
    "the live page remains an inset card beside the docked sidebar",
  );
  assert.ok(
    Math.abs(dockedPageBounds.y - toolbarBottom - PAGE_FRAME_GAP) <= 1,
    "the live page card keeps its top inset below the toolbar",
  );
  const overlaySurfaceStyle = await evaluate(
    rendererViews.sidebar,
    '(() => { const style = getComputedStyle(document.querySelector(".browser-sidebar")); return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, backdropFilter: style.backdropFilter }; })()',
  );
  assert.deepEqual(
    overlaySurfaceStyle,
    {
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      boxShadow: "none",
      backdropFilter: "none",
    },
    "the overlay sidebar relies on one native glass surface instead of layering CSS tint on top",
  );
  const toolbarSurfaceStyle = await evaluate(
    rendererViews.toolbar,
    '(() => { const style = getComputedStyle(document.querySelector(".browser-chrome")); return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, backdropFilter: style.backdropFilter }; })()',
  );
  assert.deepEqual(
    toolbarSurfaceStyle,
    {
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      backdropFilter: "none",
    },
    "the overlay toolbar relies on the same native frame material without a CSS glass layer",
  );
  // Nothing between the window root's ground (macOS: the vibrancy under its glass wash) and the
  // eye may paint: every ancestor of the toolbar strip and of the docked panel is see-through, so
  // the toolbar, rail and docked panel are the window's one glass and not a flat layer over it.
  const opaqueAncestors = (view, selector) =>
    evaluate(
      view,
      `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return ['missing ' + ${JSON.stringify(selector)}]
    const painted = []
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      const alpha = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1].split(',')[3]
      const name = node.tagName.toLowerCase() + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).join('.') : '')
      if (alpha === undefined || Number(alpha) > 0) painted.push(name + ' ' + style.backgroundColor)
      if (style.backgroundImage !== 'none') painted.push(name + ' ' + style.backgroundImage)
    }
    return painted
  })()`,
    );
  assert.deepEqual(
    await opaqueAncestors(rendererViews.toolbar, ".browser-toolbar"),
    [],
    "the toolbar strip and every layer under it in its view are transparent (the frame's glass shows)",
  );
  assert.deepEqual(
    await opaqueAncestors(rendererViews.sidebar, ".browser-sidebar"),
    [],
    "the docked panel and every layer under it in its view are transparent (the frame's glass shows)",
  );
  // The see-through strip still moves the window: its empty area is a drag region, the controls on
  // it are not.
  const regions = await evaluate(
    rendererViews.toolbar,
    `(() => {
    const region = (selector) => { const el = document.querySelector(selector); if (!el) return null; const s = getComputedStyle(el); return s.getPropertyValue('app-region') || s.getPropertyValue('-webkit-app-region') || s.webkitAppRegion || null }
    return { toolbar: region('.browser-toolbar'), button: region('.toolbar-button'), omnibox: region('.omnibox') }
  })()`,
  );
  console.log(
    `[sidebar-overlay-smoke] toolbar app regions ${JSON.stringify(regions)}`,
  );
  assert.deepEqual(
    regions,
    { toolbar: "drag", button: "no-drag", omnibox: "no-drag" },
    "the transparent toolbar strip drags the window; its buttons and omnibox do not",
  );
  captureFullWindow("sidebar-overlay-live-page-expanded.png");
  const collapsePinSample = await sampleSidebarPinMorph(
    rendererViews.sidebar,
    "collapse",
  );
  assertSidebarPinMorph(collapsePinSample, "collapse");
  await waitFor(
    collapsedRailVisible,
    "the sidebar to return to its collapsed rail after pin morph validation",
  );

  // The old toolbar Tabs toggle is gone; the leftmost toolbar control (Back) and the brand mark must stay inert on hover.
  for (const selector of [
    '.browser-nav-buttons [aria-label="Back"]',
    ".toolbar-brand",
  ]) {
    const hoverRect = await evaluate(
      rendererViews.toolbar,
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    const hoverPoint = screenPointForElement(rendererViews.toolbar, hoverRect);
    pointerMove(hoverPoint.x, hoverPoint.y);
    await delay(350);
    assert.ok(
      collapsedRailVisible(),
      `hovering ${selector} must leave the sidebar at the collapsed rail`,
    );
  }

  // The rail occupies the left edge; a click just beyond it must still reach the full-width live page.
  const edgePoint = {
    x: mainWindow.getContentBounds().x + 104,
    y: mainWindow.getContentBounds().y + pageHiddenSidebar.y + 245,
  };
  pointerClick(edgePoint.x, edgePoint.y);
  await waitFor(
    () =>
      fixturePageView.webContents.executeJavaScript(
        "window.edgeClickCount || 0",
      ),
    "the page click just beyond the collapsed rail",
  );
  await delay(250);
  assert.equal(
    await fixturePageView.webContents.executeJavaScript(
      "window.edgeClickCount",
    ),
    1,
    "the collapsed rail must not intercept a click just beyond its edge",
  );
  assert.ok(
    collapsedRailVisible(),
    "a page click beyond the rail does not expand the sidebar",
  );

  // Hover the persistent rail with the real pointer to expand it, then pin the
  // glass sidebar open from its footer control, all with native mouse input.
  pointerMove(
    mainWindow.getContentBounds().x + 5,
    mainWindow.getContentBounds().y + pageHiddenSidebar.y + 150,
  );
  await waitFor(
    () =>
      rendererViews.sidebar.getVisible() &&
      rendererViews.sidebar.getBounds().width >= 300 &&
      rendererViews.sidebar.getBounds().x === 0,
    "hover over the live-page edge to reveal (and finish sliding in) the sidebar before pinning",
  );
  await waitForSidebarPinControl();
  await clickElement(rendererViews.sidebar, '[aria-label="Keep sidebar open"]');
  await waitFor(
    () =>
      evaluate(
        rendererViews.sidebar,
        'Boolean(document.querySelector("[aria-label=\\"Auto-hide sidebar\\"]"))',
      ),
    "the sidebar pin control to show pinned",
  );
  await waitFor(
    () =>
      rendererViews.sidebar.getBounds().width === Math.min(320, contentSize[0]),
    "the pinned sidebar overlay to expand",
  );
  await waitFor(
    () =>
      evaluate(
        rendererViews.toolbar,
        'document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")',
      ),
    "shared visible sidebar state on the toolbar",
  );
  await delay(300);

  // The drag keeps its implicit mouse capture on the sidebar view, so the view (whose own background
  // is the native blur/tint underlay) follows the live width instead of widening for the drag.
  const resizeRect = await evaluate(
    rendererViews.sidebar,
    `(() => { const r = document.querySelector('.sidebar-resize-handle').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  const resizeStart = screenPointForElement(rendererViews.sidebar, resizeRect);
  const widthBeforeResize = rendererViews.sidebar.getBounds().width;
  const widthAfterResize = Math.min(392, contentSize[0]);
  pointerMove(resizeStart.x, resizeStart.y + 100);
  pointerDown(resizeStart.x, resizeStart.y + 100);
  await waitFor(
    async () =>
      (await evaluate(rendererViews.toolbar, "window.api.browser.chrome.get()"))
        .sidebarResizing === true,
    "the drag to start",
  );
  assert.equal(
    rendererViews.sidebar.getBounds().width,
    widthBeforeResize,
    "starting a drag must not widen the overlay view (its underlay would show at full size)",
  );
  const widthMidResize = widthBeforeResize + 30;
  pointerMove(resizeStart.x + 30, resizeStart.y + 100);
  await waitFor(
    () =>
      evaluate(
        rendererViews.sidebar,
        `document.querySelector('.sidebar-resize-handle')?.getAttribute('aria-valuenow') === ${JSON.stringify(String(widthMidResize))}`,
      ),
    "the sidebar width to follow the drag mid-way",
  );
  await waitFor(
    () => rendererViews.sidebar.getBounds().width === widthMidResize,
    "the overlay view (and its underlay) to track the live drag width",
  );
  pointerMove(
    resizeStart.x + widthAfterResize - widthBeforeResize,
    resizeStart.y + 100,
  );
  await waitFor(
    () =>
      evaluate(
        rendererViews.sidebar,
        `document.querySelector('.sidebar-resize-handle')?.getAttribute('aria-valuenow') === ${JSON.stringify(String(widthAfterResize))}`,
      ),
    "the sidebar width to follow the captured drag",
  );
  pointerUp();
  await waitFor(
    () => rendererViews.sidebar.getBounds().width === widthAfterResize,
    "the native overlay bounds to match the resized panel",
  );
  await waitFor(
    async () =>
      (
        await evaluate(
          rendererViews.toolbar,
          "window.api.browser.preferences.get()",
        )
      ).sidebarWidth === widthAfterResize,
    "the resized sidebar width to persist",
  );

  // Docked open, the panel is part of the browser frame: the page card sits to its right with the
  // same frame gap on every side, and the panel starts at the toolbar's bottom line.
  const dockedToolbarBottom = await evaluate(
    rendererViews.toolbar,
    'document.querySelector(".browser-chrome").getBoundingClientRect().bottom',
  );
  const pageVisibleSidebar = await waitFor(() => {
    const page = fixturePageView.getBounds();
    return page.x === widthAfterResize + PAGE_FRAME_GAP ? page : null;
  }, "the live page card to sit beside the docked sidebar");
  const sidebarView = rendererViews.sidebar.getBounds();
  assert.equal(
    pageVisibleSidebar.x - (sidebarView.x + sidebarView.width),
    PAGE_FRAME_GAP,
    "the docked sidebar keeps the frame gap from the page card",
  );
  assert.equal(
    contentSize[0] - (pageVisibleSidebar.x + pageVisibleSidebar.width),
    PAGE_FRAME_GAP,
    "beside the docked sidebar the page card keeps the gap from the right edge",
  );
  assert.equal(
    contentSize[1] - (pageVisibleSidebar.y + pageVisibleSidebar.height),
    PAGE_FRAME_GAP,
    "beside the docked sidebar the page card keeps the gap from the bottom edge",
  );
  assert.ok(
    Math.abs(pageVisibleSidebar.y - dockedToolbarBottom - PAGE_FRAME_GAP) <= 1,
    `beside the docked sidebar the page card keeps the gap below the toolbar (page y ${pageVisibleSidebar.y}, toolbar bottom ${dockedToolbarBottom})`,
  );
  assert.equal(sidebarView.width, widthAfterResize);
  assert.ok(
    sidebarView.y >= dockedToolbarBottom - 0.5 &&
      sidebarView.y - dockedToolbarBottom <= 1,
    `the docked sidebar starts at the toolbar's bottom line, never over it (sidebar y ${sidebarView.y}, toolbar bottom ${dockedToolbarBottom})`,
  );
  assert.equal(
    sidebarView.y + sidebarView.height,
    contentSize[1],
    "the docked sidebar runs to the window's bottom edge",
  );
  await assertFrameJunction("docked panel");
  await assertRoundedCardCorner("docked panel", pageVisibleSidebar);
  captureFullWindow("sidebar-overlay-live-page-visible.png");
  // This is an authentic app-window capture over the harness's loopback-only synthetic page.
  captureFullWindow("surffish-current-app.png");

  // A physical click on the live page outside the glass panel must reach the page while the sidebar is open.
  mainWindow.focus();
  const targetRect = await fixturePageView.webContents.executeJavaScript(
    `(() => { const r = document.querySelector('#target').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  const targetPoint = screenPointForElement(fixturePageView, targetRect);
  pointerClick(targetPoint.x, targetPoint.y);
  await waitFor(
    () =>
      fixturePageView.webContents.executeJavaScript("window.clickCount || 0"),
    "the live page click behind the sidebar",
  );
  assert.equal(
    await fixturePageView.webContents.executeJavaScript(
      "window.clickCount || 0",
    ),
    1,
    "the full-width site WebContentsView receives clicks with the sidebar above it",
  );

  // Type into a focused site input; the native page keeps keyboard focus during the overlay.
  const inputRect = await fixturePageView.webContents.executeJavaScript(
    `(() => { const r = document.querySelector('#page-input').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  const inputPoint = screenPointForElement(fixturePageView, inputRect);
  pointerClick(inputPoint.x, inputPoint.y);
  pointerType("native-page-input");
  await waitFor(
    () =>
      fixturePageView.webContents.executeJavaScript(
        'document.querySelector("#page-input").value',
      ),
    "real keyboard input in the live page",
  );
  assert.equal(
    await fixturePageView.webContents.executeJavaScript(
      'document.querySelector("#page-input").value',
    ),
    "native-page-input",
  );
  const scrollBounds = fixturePageView.getBounds();
  const scrollPoint = {
    x: mainWindow.getContentBounds().x + contentSize[0] - 80,
    y:
      mainWindow.getContentBounds().y +
      scrollBounds.y +
      Math.floor(scrollBounds.height * 0.7),
  };
  pointerScrollDown(scrollPoint.x, scrollPoint.y);
  await waitFor(
    () => fixturePageView.webContents.executeJavaScript("window.scrollY > 0"),
    "real mouse-wheel scrolling through the overlay",
  );
  // Chromium animates wheel scrolls, so a scrollTo(0, 0) issued mid-animation can be overtaken by the
  // rest of the wheel delta and leave the page scrolled (moving #target out from under the next click).
  // Let the wheel animation settle first, then reset and require the top position to hold.
  await waitForStableScroll(
    (y) => y > 0,
    "the wheel scroll animation to settle",
  );
  await fixturePageView.webContents.executeJavaScript("window.scrollTo(0, 0)");
  await waitForStableScroll(
    (y) => y === 0,
    "returning the synthetic page to its top before the remaining pointer checks",
  );

  // The pin control now lives in the sidebar footer: ensure it is unpinned so the panel auto-hides on pointer exit.
  await evaluate(
    rendererViews.sidebar,
    `(() => { const unpin = document.querySelector('[aria-label="Auto-hide sidebar"]'); if (unpin) { unpin.click(); return true; } return Boolean(document.querySelector('[aria-label="Keep sidebar open"]')); })()`,
  );
  await waitFor(
    () =>
      evaluate(
        rendererViews.sidebar,
        'Boolean(document.querySelector("[aria-label=\\"Keep sidebar open\\"]"))',
      ),
    "the sidebar pin control to show unpinned",
  );
  // Undocked, the page card goes back beside the rail; let its page lay out there before aiming.
  await waitFor(
    () => fixturePageView.getBounds().x === pageHiddenSidebar.x,
    "the live page card to return beside the rail once the sidebar is unpinned",
  );
  await delay(250);
  pointerMove(
    mainWindow.getContentBounds().x + Math.min(700, contentSize[0] - 10),
    mainWindow.getContentBounds().y + pageVisibleSidebar.y + 350,
  );
  const resetTargetRect = await fixturePageView.webContents.executeJavaScript(
    `(() => { const r = document.querySelector('#target').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  const resetTargetPoint = screenPointForElement(
    fixturePageView,
    resetTargetRect,
  );
  pointerClick(resetTargetPoint.x, resetTargetPoint.y);
  await waitFor(
    async () =>
      (await fixturePageView.webContents.executeJavaScript(
        "window.clickCount || 0",
      )) >= 2,
    "the live page to receive a click after the sidebar releases focus",
  );
  assert.equal(
    await fixturePageView.webContents.executeJavaScript(
      "window.clickCount || 0",
    ),
    2,
  );
  await evaluate(
    rendererViews.toolbar,
    "window.api.browser.chrome.set({ sidebarFocused: false })",
  );
  await waitFor(
    collapsedRailVisible,
    "the expanded panel to collapse to its persistent rail after pointer exit and focus release",
  );

  // The rail owns the left edge; hovering it reveals the panel without changing page bounds.
  const pageAfterHide = fixturePageView.getBounds();
  pointerMove(
    mainWindow.getContentBounds().x + 5,
    mainWindow.getContentBounds().y + pageAfterHide.y + 150,
  );
  await waitFor(
    () =>
      rendererViews.sidebar.getVisible() &&
      rendererViews.sidebar.getBounds().width >= 300 &&
      rendererViews.sidebar.getBounds().x === 0,
    "hover over the live-page edge to reopen the sidebar",
  );
  assert.deepEqual(
    fixturePageView.getBounds(),
    pageAfterHide,
    "hover reveal overlays the page without moving or resizing it",
  );
  assert.ok(
    pageAfterHide.x >= 83,
    `the collapsed page sits beside the rail (${JSON.stringify(pageAfterHide)})`,
  );
  // The hover-revealed panel slides out within the frame: from the toolbar's bottom line, over the
  // page card, never over the toolbar.
  {
    const revealed = rendererViews.sidebar.getBounds();
    assert.ok(
      revealed.y >= dockedToolbarBottom - 0.5 &&
        revealed.y + revealed.height === contentSize[1],
      `the hover-revealed panel starts at the toolbar's bottom line (${JSON.stringify(revealed)}, toolbar bottom ${dockedToolbarBottom})`,
    );
  }
  // The hover panel is a floating card, not part of the frame: the toolbar's bottom line still
  // runs over one frame surface (the card stands SIDEBAR_FLOAT.gap below it).
  await assertFrameJunction("hover panel");
  {
    // The overlay view keeps its frame bounds, one float gap wider so the card keeps the sidebar
    // width; wait for the slide to land before reading the card.
    const revealed = await waitFor(() => {
      const bounds = rendererViews.sidebar.getBounds();
      return bounds.x === 0 &&
        bounds.width === widthAfterResize + SIDEBAR_FLOAT.gap
        ? bounds
        : null;
    }, "the hover-revealed panel to finish opening as a floating card");
    const card = await waitFor(
      () =>
        evaluate(
          rendererViews.sidebar,
          `(() => {
      const card = document.querySelector('.browser-sidebar')
      if (!card || card.classList.contains('is-collapsed')) return null
      const r = card.getBoundingClientRect()
      const style = getComputedStyle(card)
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: innerHeight - r.bottom,
        radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius] }
    })()`,
        ),
      "the floating hover card in the sidebar surface",
    );
    console.log(
      `[sidebar-overlay-smoke] hover card ${JSON.stringify(card)} in view ${JSON.stringify(revealed)}`,
    );
    assert.equal(
      card.x,
      SIDEBAR_FLOAT.gap,
      "the hover card floats the gap off the window's left edge",
    );
    assert.equal(
      card.y,
      SIDEBAR_FLOAT.gap,
      "the hover card floats the gap below the toolbar's bottom line",
    );
    assert.equal(
      card.bottom,
      SIDEBAR_FLOAT.gap,
      "the hover card floats the gap off the window's bottom edge",
    );
    assert.equal(
      card.width,
      widthAfterResize,
      "the floating card keeps the sidebar width",
    );
    assert.deepEqual(
      card.radius,
      Array(4).fill(`${SIDEBAR_FLOAT.radius}px`),
      "the hover card has its own rounded corners on every side",
    );
    // On screen (the opaque Linux path): the card's corners over the page are rounded, so the page
    // shows in the corner and the card's own surface a little further in.
    const right = revealed.x + SIDEBAR_FLOAT.gap + widthAfterResize;
    const top = revealed.y + SIDEBAR_FLOAT.gap;
    const bottom = revealed.y + revealed.height - SIDEBAR_FLOAT.gap;
    await assertFloatingCardCorner("hover card top-right", {
      corner: { x: right - 1, y: top + 1 },
      inside: { x: right - 9, y: top + 9 },
    });
    captureFullWindow("sidebar-overlay-live-page-hover-card.png");
    // The panel's footer sits there and shades the card a touch.
    await assertFloatingCardCorner("hover card bottom-right", {
      corner: { x: right - 1, y: bottom - 2 },
      inside: { x: right - 9, y: bottom - 10 },
      fillTolerance: 8,
    });
  }
  pointerMove(
    mainWindow.getContentBounds().x + Math.min(700, contentSize[0] - 10),
    mainWindow.getContentBounds().y + pageVisibleSidebar.y + 350,
  );
  await waitFor(
    collapsedRailVisible,
    "the hover-only panel to collapse back to the visible rail",
  );

  // Reveal locks main releases on its own (src/main/sidebar-reveal-guard.ts).
  const chromeState = () =>
    evaluate(rendererViews.toolbar, "window.api.browser.chrome.get()");
  const pagePoint = {
    x: mainWindow.getContentBounds().x + Math.min(700, contentSize[0] - 10),
    y: mainWindow.getContentBounds().y + pageVisibleSidebar.y + 350,
  };
  // 1) A drag whose mouseup the sidebar never saw (released outside the window) plus keyboard focus
  //    in the sidebar: the view stays at the panel width, and one click on the page lets go of both.
  pointerMove(
    mainWindow.getContentBounds().x + 5,
    mainWindow.getContentBounds().y + pageAfterHide.y + 150,
  );
  await waitFor(
    () =>
      rendererViews.sidebar.getVisible() &&
      rendererViews.sidebar.getBounds().width >= 300 &&
      rendererViews.sidebar.getBounds().x === 0,
    "hover to reopen the sidebar for the stuck-drag check",
  );
  await waitForSidebarPinControl();
  const widthBeforeStuckDrag = rendererViews.sidebar.getBounds().width;
  rendererViews.sidebar.webContents.focus();
  await evaluate(
    rendererViews.sidebar,
    `(() => { document.querySelector('.sidebar-resize-handle')?.focus(); return window.api.browser.chrome.set({ sidebarResizing: true }) })()`,
  );
  await waitFor(async () => {
    const state = await chromeState();
    return state.sidebarResizing && state.sidebarFocused;
  }, "a stuck drag and sidebar focus");
  assert.equal(
    rendererViews.sidebar.getBounds().width,
    widthBeforeStuckDrag,
    "a drag in progress never widens the current panel overlay (no full-size underlay)",
  );
  pointerMove(pagePoint.x, pagePoint.y);
  await delay(700);
  assert.equal(
    rendererViews.sidebar.getBounds().width,
    widthBeforeStuckDrag,
    "keyboard focus keeps the expanded panel open after the pointer leaves",
  );
  pointerClick(pagePoint.x, pagePoint.y);
  await waitFor(async () => {
    const state = await chromeState();
    return (
      !state.sidebarResizing && !state.sidebarFocused && !state.sidebarHovered
    );
  }, "a click on the page to release the drag, focus and hover holds");
  await waitFor(
    collapsedRailVisible,
    "the expanded panel to collapse to its persistent rail after a click on the page",
  );
  // 2) A hover the sidebar never saw the pointer leave (it exited over the toolbar, an iframe, or
  //    the hover was set while the pointer was elsewhere): no view reports a move, the cursor poll does.
  const toolbarPoint = {
    x: mainWindow.getContentBounds().x + Math.min(700, contentSize[0] - 10),
    y: mainWindow.getContentBounds().y + 20,
  };
  pointerMove(toolbarPoint.x, toolbarPoint.y);
  await delay(300);
  await evaluate(
    rendererViews.content,
    "window.api.browser.chrome.set({ sidebarFocused: false, sidebarHovered: true })",
  );
  await waitFor(
    () =>
      rendererViews.sidebar.getVisible() &&
      rendererViews.sidebar.getBounds().width >= 300,
    "a hover reveal with the pointer over the toolbar",
  );
  await waitFor(
    async () => !(await chromeState()).sidebarHovered && collapsedRailVisible(),
    "the cursor poll to collapse the panel to its rail after a hover whose mouseleave never came",
    5000,
  );

  // Create and return from the bottom sidebar action to verify the local React surface/tab lifecycle.
  // Keep the physical cursor over the rail while dispatching the in-page reveal event, then pin the panel.
  pointerMove(
    mainWindow.getContentBounds().x + 5,
    mainWindow.getContentBounds().y + 200,
  );
  assert.ok(
    await evaluate(
      rendererViews.content,
      '(() => { const layout = document.querySelector(".browser-layout"); if (!layout) return false; layout.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 200 })); return true; })()',
    ),
    "the browser layout should accept a hover at the reveal edge",
  );
  await waitFor(
    () =>
      rendererViews.sidebar.getVisible() &&
      rendererViews.sidebar.getBounds().width >= 300 &&
      rendererViews.sidebar.getBounds().x === 0,
    "the in-page synthetic reveal-edge mousemove to expand the overlay panel",
  );
  await waitForSidebarPinControl();
  await clickElement(rendererViews.sidebar, '[aria-label="Keep sidebar open"]');
  await waitFor(
    () =>
      rendererViews.sidebar.getVisible() &&
      rendererViews.sidebar.getBounds().width === widthAfterResize &&
      rendererViews.sidebar.getBounds().x === 0,
    "the sidebar to open for its bottom New Tab action",
  );
  await waitFor(
    () =>
      evaluate(
        rendererViews.sidebar,
        `(() => {
    const layout = document.querySelector('.browser-layout')
    const sidebar = document.querySelector('.browser-sidebar')
    const button = document.querySelector('.sidebar-new-tab-row')
    if (!layout?.classList.contains('is-sidebar-visible') || !sidebar || !button) return false
    const sidebarRect = sidebar.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    if (Math.abs(sidebarRect.left) > 0.5 || buttonRect.top < 0 || buttonRect.bottom > innerHeight) return false
    const hitTarget = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2)
    return hitTarget?.closest('.sidebar-new-tab-row') === button
  })()`,
      ),
    "the sidebar slide-in to finish with the bottom New Tab button hit-testable",
  );
  const priorTabIds = new Set(
    (
      await evaluate(rendererViews.sidebar, "window.api.browser.tabs.get()")
    ).map((tab) => tab.id),
  );
  await evaluate(
    rendererViews.sidebar,
    `(() => {
    const button = document.querySelector('.sidebar-new-tab-row')
    window.__bottomNewTabClickCount = 0
    button?.addEventListener('click', () => { window.__bottomNewTabClickCount += 1 }, { once: true })
  })()`,
  );
  await clickElement(rendererViews.sidebar, ".sidebar-new-tab-row");
  await waitFor(
    () =>
      evaluate(rendererViews.sidebar, "window.__bottomNewTabClickCount === 1"),
    "the native pointer click to reach the bottom New Tab button",
  );
  const newTabId = await waitFor(async () => {
    const tabs = await evaluate(
      rendererViews.sidebar,
      "window.api.browser.tabs.get()",
    );
    const active = tabs.find((tab) => tab.active);
    return active && !priorTabIds.has(active.id) ? active.id : null;
  }, "the bottom New Tab action to create and activate a tab");
  assert.ok(newTabId, "the bottom New Tab control activates its new tab");
  await waitFor(
    async () =>
      (
        await evaluate(rendererViews.content, "window.api.browser.state()")
      ).url.includes("surffish://quick-links"),
    "the local New Tab",
  );
  await waitFor(
    () =>
      rendererViews.content.getVisible() &&
      !rendererViews.toolbar.getVisible() &&
      !rendererViews.sidebar.getVisible(),
    "the original full-app surface when the active tab is New Tab",
  );
  // Background tabs are detached from the window (so Chromium throttles them) but stay alive.
  assert.ok(
    webContents
      .getAllWebContents()
      .some(
        (contents) =>
          !contents.isDestroyed() && contents.getURL() === fixtureUrl,
      ),
    "the original live page tab remains alive",
  );
  assert.ok(
    !mainWindow.contentView.children.some(
      (view) => view.webContents && view.webContents.getURL() === fixtureUrl,
    ),
    "the background page is detached while New Tab shows",
  );
  assert.equal(
    await evaluate(
      rendererViews.content,
      `(async () => { const tab = (await window.api.browser.tabs.get()).find((candidate) => candidate.url === ${JSON.stringify(fixtureUrl)}); return tab ? window.api.browser.tabs.activate(tab.id) : false })()`,
    ),
    true,
  );
  await waitFor(
    () =>
      rendererViews.toolbar.getVisible() && !rendererViews.content.getVisible(),
    "return to the live page overlay with its inset card",
  );
  await waitFor(() => {
    const actual = fixturePageView.getBounds();
    return (
      actual.x === pageVisibleSidebar.x &&
      actual.y === pageVisibleSidebar.y &&
      actual.width === pageVisibleSidebar.width &&
      actual.height === pageVisibleSidebar.height
    );
  }, "the inset page card after tab activation");
  assert.match(
    await fixturePageView.webContents.executeJavaScript("document.cookie"),
    /surffish-overlay-smoke=cookie-preserved/,
    "site cookies remain intact through the New Tab/tab lifecycle",
  );
  captureFullWindow("sidebar-overlay-live-page-restored.png");

  assert.deepEqual(
    fixturePageView.getBounds(),
    pageVisibleSidebar,
    "the restored live page keeps its inset-card geometry",
  );
  console.log(
    `BaseWindow app integration passed: initial shell views=${initialShell.length}; resized live page card=${JSON.stringify(fixturePageView.getBounds())}; persisted sidebar width=${sidebarView.width}; last-tab Command-W keeps the window open, Command-T focuses the address bar, and hover stability, pointer resize/persistence, x=5 click-through, overlay page input/wheel, delayed edge reveal, and tab/New Tab lifecycle verified.`,
  );
}

async function cleanup() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await delay(300);
    if (!mainWindow.isDestroyed()) mainWindow.destroy();
  }
  if (server.listening)
    await new Promise((resolvePromise) => {
      server.closeAllConnections?.();
      server.close(() => resolvePromise());
    });
  if (app.isReady()) app.quit();
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* Profile removal is best-effort and must not mask the test result. */
  }
}

run()
  .then(cleanup)
  .catch(async (error) => {
    console.error(
      "Electron sidebar overlay integration smoke failed:",
      error instanceof Error ? error.stack : error,
    );
    await cleanup();
    app.exit(1);
  });
