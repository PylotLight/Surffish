// Keep the cursor poll off so a real pointer hover can be sampled without the guard closing it.
process.env.SURFFISH_SIDEBAR_CURSOR_POLL ??= "off";
// Overlay sidebar legibility over busy live pages: which backdrop path is in force, that it is
// opaque enough (or blurred) to read, frame-by-frame hover reveal, and before/after screenshots.
//
//   SURFFISH_SIDEBAR_BACKDROP=solid|snapshot|native  path to test (default: the platform's own)
//   SURFFISH_SCREENSHOT_DIR=…                        save window captures (needs ffmpeg + X11)
//   SURFFISH_BACKDROP_LABEL=before                   only measure + capture (for an older build)
//   SURFFISH_SIDEBAR_HOVER_ONLY=1                    run just the pointer-driven hover regression
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { execFileSync, spawn } = require("node:child_process");
const { mkdirSync, readdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, nativeImage, screen } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(
  tmpdir(),
  `surffish-sidebar-backdrop-smoke-${process.pid}`,
);
const screenshotDirectory = process.env.SURFFISH_SCREENSHOT_DIR;
const label =
  process.env.SURFFISH_BACKDROP_LABEL ||
  process.env.SURFFISH_SIDEBAR_BACKDROP ||
  "default";
const measureOnly = label === "before";
const hoverOnly = process.env.SURFFISH_SIDEBAR_HOVER_ONLY === "1";
const coldHoverOnly =
  hoverOnly && process.env.SURFFISH_SIDEBAR_COLD_HOVER === "1";

// A YouTube-ish page: dense left nav text, thumbnails, light and dark variants.
// src/shared/sidebar-card.ts SIDEBAR_FLOAT.gap: the hover card's gap off the frame.
const SIDEBAR_FLOAT_GAP = 6;

function busyPage(theme) {
  const dark = theme === "dark";
  const nav = [
    "Home",
    "Shorts",
    "Subscriptions",
    "You",
    "History",
    "Playlists",
    "Your videos",
    "Watch later",
    "Liked videos",
    "Trending",
    "Shopping",
    "Music",
    "Movies & TV",
    "Live",
    "Gaming",
    "News",
    "Sports",
    "Courses",
    "Fashion",
    "Podcasts",
  ];
  const thumbs = Array.from(
    { length: 24 },
    (_, i) =>
      `<div class="t" style="background:hsl(${(i * 47) % 360} 70% ${dark ? 35 : 55}%)"><b>Video title number ${i + 1} with a long name</b></div>`,
  ).join("");
  return `<!doctype html><meta charset="utf-8"><title>Busy ${theme}</title><style>
    body{margin:0;font:15px/1.35 system-ui,sans-serif;background:${dark ? "#0f0f0f" : "#fff"};color:${dark ? "#f1f1f1" : "#0f0f0f"}}
    nav{position:fixed;top:0;left:0;width:240px;bottom:0;padding:12px;overflow:hidden}
    nav a{display:block;padding:9px 12px;font-weight:600;color:inherit;text-decoration:none;border-radius:10px}
    nav a:nth-child(1){background:${dark ? "#272727" : "#f2f2f2"}}
    main{margin-left:250px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:14px}
    .t{height:150px;border-radius:12px;padding:8px;color:#fff}
  </style><nav>${nav.map((item) => `<a href="#">${item}</a>`).join("")}${nav.map((item) => `<a href="#">${item} again</a>`).join("")}</nav><main>${thumbs}</main>`;
}

const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(busyPage(request.url.includes("dark") ? "dark" : "light"));
});
let mainWindow;

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitFor(predicate, description, timeout = 30000) {
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
function surface(name) {
  return mainWindow.contentView.children.find((view) => {
    try {
      return (
        view.webContents &&
        new URL(view.webContents.getURL()).searchParams.get("surface") === name
      );
    } catch {
      return false;
    }
  });
}
const evaluate = (view, expression) =>
  view.webContents.executeJavaScript(expression);

function pointerMove(x, y) {
  execFileSync("xdotool", [
    "mousemove",
    String(Math.round(x)),
    String(Math.round(y)),
  ]);
}

async function armSidebarHoverProbe(sidebar) {
  await evaluate(
    sidebar,
    `(() => {
      const probe = { active: true, frames: [], startedAt: performance.now() }
      window.__sidebarHoverRevealProbe = probe
      const rect = (element) => {
        if (!element) return null
        const r = element.getBoundingClientRect()
        return { left: r.left, right: r.right, width: r.width }
      }
      const tick = () => {
        if (!probe.active) return
        const card = document.querySelector('.browser-sidebar')
        const body = card?.querySelector('.sidebar-body')
        const panel = card?.querySelector('.sidebar-panel:not(.is-shape-hidden)')
        const title = panel?.querySelector('.tab-title')
        const cardStyle = card ? getComputedStyle(card) : null
        const bodyStyle = body ? getComputedStyle(body) : null
        const backdrop = card?.querySelector('.sidebar-backdrop')
        const backdropStyle = backdrop ? getComputedStyle(backdrop) : null
        const cardRect = rect(card)
        probe.frames.push({
          at: Number((performance.now() - probe.startedAt).toFixed(1)),
          epoch: Date.now(),
          viewportWidth: document.documentElement.clientWidth,
          reshaping: card?.getAttribute('data-reshaping') ?? null,
          card: cardRect,
          radius: cardStyle?.borderTopRightRadius ?? null,
          backgroundImage: cardStyle?.backgroundImage ?? 'none',
          backgroundColor: cardStyle?.backgroundColor ?? 'transparent',
          snapshotReady: Boolean(backdrop?.classList.contains('is-ready')),
          snapshotOpacity: backdropStyle?.opacity ?? '0',
          body: body ? { ...rect(body), overflowX: bodyStyle.overflowX, mask: bodyStyle.webkitMaskImage || bodyStyle.maskImage } : null,
          title: title ? rect(title) : null,
        })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      return true
    })()`,
  );
}

function captureHoverFrames(prefix) {
  const dir =
    screenshotDirectory || (coldHoverOnly ? join(userData, "shots") : null);
  if (!dir || process.platform !== "linux" || !process.env.DISPLAY)
    return Promise.resolve(null);
  mkdirSync(dir, { recursive: true });
  const { x, y, width, height } = mainWindow.getContentBounds();
  const display = screen.getDisplayMatching({ x, y, width, height }).bounds;
  const captureWidth = Math.min(width, display.x + display.width - x);
  const captureHeight = Math.min(height, display.y + display.height - y);
  if (captureWidth <= 0 || captureHeight <= 0)
    return Promise.reject(
      new Error("The browser content is outside the visible display"),
    );
  const filename = join(dir, `${prefix}-%02d.png`);
  return new Promise((resolvePromise, reject) => {
    let stderr = "";
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "x11grab",
        "-framerate",
        "60",
        "-video_size",
        `${captureWidth}x${captureHeight}`,
        "-i",
        `${process.env.DISPLAY}.0+${x},${y}`,
        "-vf",
        `fps=${coldHoverOnly ? 30 : 12}`,
        "-frames:v",
        String(coldHoverOnly ? 24 : 8),
        "-y",
        filename,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise(filename);
      else
        reject(
          new Error(`ffmpeg hover capture exited ${code}: ${stderr.trim()}`),
        );
    });
  });
}

async function finishSidebarHoverProbe(sidebar) {
  return evaluate(
    sidebar,
    `(() => { const probe = window.__sidebarHoverRevealProbe; if (!probe) return []; probe.active = false; return probe.frames })()`,
  );
}

function armNativeHoverProbe(sidebar) {
  const shellContents = new Set(
    ["content", "toolbar", "sidebar"]
      .map((name) => surface(name)?.webContents)
      .filter(Boolean),
  );
  const page = mainWindow.contentView.children.find(
    (view) => view.webContents && !shellContents.has(view.webContents),
  );
  if (!page) throw new Error("Could not find the live page WebContentsView");
  const frames = [];
  const startedAt = Date.now();
  const bounds = (view) => {
    const rect = view.getBounds();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  };
  const timer = setInterval(() => {
    const sidebarBounds = bounds(sidebar);
    const expectedCard = {
      x: sidebarBounds.x + SIDEBAR_FLOAT_GAP,
      y: sidebarBounds.y + SIDEBAR_FLOAT_GAP,
      width: Math.max(0, sidebarBounds.width - SIDEBAR_FLOAT_GAP),
      height: Math.max(0, sidebarBounds.height - SIDEBAR_FLOAT_GAP * 2),
    };
    const nativeViews = mainWindow.contentView.children.flatMap(
      (view, index) => {
        if (view.webContents) return [];
        try {
          return [{ index, visible: view.getVisible(), bounds: bounds(view) }];
        } catch {
          return [];
        }
      },
    );
    const backdrop = nativeViews.find(
      (view) =>
        view.visible &&
        Math.abs(view.bounds.x - expectedCard.x) <= 1 &&
        Math.abs(view.bounds.y - expectedCard.y) <= 1 &&
        Math.abs(view.bounds.width - expectedCard.width) <= 1 &&
        Math.abs(view.bounds.height - expectedCard.height) <= 1,
    );
    frames.push({
      at: Date.now() - startedAt,
      epoch: Date.now(),
      sidebarVisible: sidebar.getVisible(),
      sidebar: sidebarBounds,
      page: bounds(page),
      expectedCard,
      nativeViews,
      backdropMatched: Boolean(backdrop),
    });
  }, 8);
  return {
    stop() {
      clearInterval(timer);
      return frames;
    },
  };
}

function assertNativeHoverFrames(frames, theme) {
  const opening = frames.filter(
    (frame) => frame.sidebarVisible && frame.sidebar.width > 100,
  );
  assert.ok(
    opening.length >= 12,
    `${theme} cold hover samples native motion frames (got ${opening.length})`,
  );
  assert.ok(
    Math.max(...opening.map((frame) => frame.sidebar.width)) -
      Math.min(...opening.map((frame) => frame.sidebar.width)) >
      24,
    `${theme} native overlay edge moves across sampled frames`,
  );
  for (const frame of opening)
    assert.ok(
      frame.backdropMatched,
      `${theme} native backdrop bounds/radius frame stays registered to the moving floating card (${JSON.stringify({ sidebar: frame.sidebar, expected: frame.expectedCard, native: frame.nativeViews })})`,
    );
  const firstPage = frames[0]?.page;
  assert.ok(firstPage, `${theme} live page is sampled before reveal`);
  for (const frame of frames)
    assert.deepEqual(
      frame.page,
      firstPage,
      `${theme} floating sidebar keeps the separate live page frame stationary`,
    );
  console.log(
    `[sidebar-backdrop-smoke] ${theme} cold native reveal: ${opening.length} main-process frames; page stationary; native card backing aligned`,
  );
}

function assertFirstCoveredCardPixel(prefix, theme) {
  if (process.platform !== "linux" || !process.env.DISPLAY) return null;
  const dir = screenshotDirectory || join(userData, "shots");
  const files = readdirSync(dir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(".png"))
    .sort();
  assert.ok(
    files.length >= 3,
    `${theme} cold hover compositor frames were captured`,
  );
  let firstCovered = null;
  for (const name of files) {
    const image = nativeImage.createFromPath(join(dir, name));
    const { width, height } = image.getSize();
    const x = 100;
    const y = 250;
    if (x >= width || y >= height) continue;
    const bitmap = image.toBitmap();
    const index = (y * width + x) * 4;
    const rgb = {
      r: bitmap[index + 2],
      g: bitmap[index + 1],
      b: bitmap[index],
    };
    // The light synthetic page is white at this otherwise empty point. The first darker sample
    // means the moving native card has reached it; it should already be the opaque frame surface.
    if (rgb.r < 245 || rgb.g < 245 || rgb.b < 245) {
      firstCovered = { file: name, x, y, rgb };
      break;
    }
  }
  assert.ok(
    firstCovered,
    `${theme} compositor capture reaches the native card sample point`,
  );
  for (const [channel, expected] of Object.entries({ r: 25, g: 27, b: 31 }))
    assert.ok(
      Math.abs(firstCovered.rgb[channel] - expected) <= 12,
      `${theme} first covered pixel is the full native surface, not page text bleed (${JSON.stringify(firstCovered)})`,
    );
  return firstCovered;
}

function assertRendererNativeHoverFrames(rendererFrames, nativeFrames, theme) {
  const opening = rendererFrames.filter(
    (frame) => frame.reshaping === "expand",
  );
  assert.ok(
    opening.length >= 4,
    `${theme} renderer morph samples multiple native-bound frames`,
  );
  assert.ok(nativeFrames.length > 0, `${theme} native bounds are sampled`);
  for (const frame of opening) {
    const native = nativeFrames.reduce((nearest, candidate) =>
      Math.abs(candidate.epoch - frame.epoch) <
      Math.abs(nearest.epoch - frame.epoch)
        ? candidate
        : nearest,
    );
    assert.ok(
      Math.abs(native.epoch - frame.epoch) <= 24,
      `${theme} renderer sample has a nearby native frame sample`,
    );
    assert.ok(
      frame.card.right <= native.sidebar.width + 2,
      `${theme} rendered card/row-label edge never outruns the native sidebar clip (${frame.card.right}px vs ${native.sidebar.width}px at ${frame.at}ms)`,
    );
  }
}

function assertSidebarHoverRevealFrames(frames, theme) {
  const opening = frames.filter((frame) => frame.reshaping === "expand");
  assert.ok(
    opening.length >= 4,
    `${theme} hover reveal samples multiple rendered expansion frames (got ${opening.length}; phases=${JSON.stringify([...new Set(frames.map((frame) => frame.reshaping))])}, widths=${JSON.stringify(frames.slice(0, 8).map((frame) => frame.card?.width))})`,
  );
  assert.ok(
    Math.max(...opening.map((frame) => frame.card.width)) -
      Math.min(...opening.map((frame) => frame.card.width)) >
      24,
    `${theme} hover reveal samples the moving card edge`,
  );
  for (const frame of opening) {
    assert.ok(
      Math.abs(frame.card.right - frame.viewportWidth) <= 1,
      `${theme} card edge matches the native view clip (${frame.card.right}px / ${frame.viewportWidth}px)`,
    );
    assert.ok(
      Math.abs(frame.body.right - frame.card.right) <= 1,
      `${theme} clipped body ends at the moving card edge`,
    );
    assert.equal(
      frame.body.overflowX,
      "clip",
      `${theme} body clips to the moving edge`,
    );
    assert.match(
      frame.body.mask,
      /linear-gradient/,
      `${theme} content fades at the moving edge`,
    );
    assert.equal(
      frame.radius,
      "12px",
      `${theme} floating-card radius is present from the first expanding frame`,
    );
  }
  assert.ok(
    opening.some(
      (frame) =>
        frame.title &&
        frame.title.left < frame.card.right &&
        frame.title.right > frame.card.right - 32,
    ),
    `${theme} tab labels traverse the active moving-edge fade zone`,
  );
  console.log(
    `[sidebar-backdrop-smoke] ${theme} hover reveal: ${opening.length} rendered frames; card edge and radius aligned; content clipped and edge-faded`,
  );
}

function assertSnapshotHoverFrames(frames, theme) {
  const opening = frames.filter((frame) => frame.reshaping === "expand");
  assert.ok(
    opening.length >= 4,
    `${theme} snapshot reveal samples multiple in-flight frames`,
  );
  const fallbackFrames = opening.filter(
    (frame) => !frame.snapshotReady || Number(frame.snapshotOpacity) < 1,
  );
  assert.ok(
    fallbackFrames.length > 0,
    `${theme} reveal samples fallback frames while its snapshot is unavailable or fading in`,
  );
  for (const frame of fallbackFrames) {
    const fallbackAlpha = minAlpha(
      frame.backgroundImage,
      frame.backgroundColor,
    );
    assert.ok(
      fallbackAlpha >= 0.94,
      `${theme} snapshot card stays nearly opaque while its image is unavailable or fading in (${fallbackAlpha})`,
    );
  }
  console.log(
    `[sidebar-backdrop-smoke] ${theme} snapshot reveal: ${opening.length} frames, ${fallbackFrames.length} fallback frames; first-frame tint prevents sharp page bleed`,
  );
}

/** The whole window as X11 draws it (every native view composited), as a NativeImage. */
function captureWindow(name) {
  const dir = screenshotDirectory || join(userData, "shots");
  mkdirSync(dir, { recursive: true });
  const { x, y, width, height } = mainWindow.getContentBounds();
  const display = screen.getDisplayMatching({ x, y, width, height }).bounds;
  const captureWidth = Math.min(width, display.x + display.width - x);
  const captureHeight = Math.min(height, display.y + display.height - y);
  if (captureWidth <= 0 || captureHeight <= 0)
    throw new Error(
      "The browser content is outside the visible display bounds",
    );
  const file = join(dir, name);
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "x11grab",
    "-video_size",
    `${captureWidth}x${captureHeight}`,
    "-i",
    `${process.env.DISPLAY}.0+${x},${y}`,
    "-frames:v",
    "1",
    "-y",
    file,
  ]);
  return nativeImage.createFromPath(file);
}

async function captureSidebarSurface(sidebar) {
  return sidebar.webContents.capturePage();
}

function nativeImageScale(image) {
  const scales = image
    .getScaleFactors()
    .filter((scale) => Number.isFinite(scale) && scale > 0);
  return scales.length > 0 ? Math.max(...scales) : 1;
}

function pixelData(image) {
  const scale = nativeImageScale(image);
  const { width, height } = image.getSize(scale);
  return {
    scale,
    width,
    height,
    bitmap: image.toBitmap({ scaleFactor: scale }),
  };
}

function luminance(bitmap, width, x, y) {
  const index = (y * width + x) * 4;
  return (
    0.0722 * bitmap[index] +
    0.7152 * bitmap[index + 1] +
    0.2126 * bitmap[index + 2]
  );
}

/** Luminance spread inside a rect: how much page detail shows through an empty bit of the sidebar. */
function luminanceStdDev(image, rect) {
  const { scale, width, height, bitmap } = pixelData(image);
  const left = Math.max(0, Math.floor(rect.x * scale));
  const top = Math.max(0, Math.floor(rect.y * scale));
  const right = Math.min(width, Math.ceil((rect.x + rect.width) * scale));
  const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * scale));
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const lum = luminance(bitmap, width, x, y);
      sum += lum;
      sumSquares += lum * lum;
      count++;
    }
  }
  const mean = sum / count;
  return {
    mean,
    std: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)),
  };
}

/** Mean adjacent-pixel luminance difference: high values expose sharp page glyphs and edges. */
function edgeEnergy(image, rect) {
  const { scale, width, height, bitmap } = pixelData(image);
  const left = Math.max(0, Math.floor((rect?.x ?? 0) * scale));
  const top = Math.max(0, Math.floor((rect?.y ?? 0) * scale));
  const right = Math.min(
    width,
    Math.ceil(((rect?.x ?? 0) + (rect?.width ?? width / scale)) * scale),
  );
  const bottom = Math.min(
    height,
    Math.ceil(((rect?.y ?? 0) + (rect?.height ?? height / scale)) * scale),
  );
  let total = 0;
  let count = 0;
  for (let y = top; y + 1 < bottom; y += 2) {
    for (let x = left; x + 1 < right; x += 2) {
      const here = luminance(bitmap, width, x, y);
      total += Math.abs(luminance(bitmap, width, x + 1, y) - here);
      total += Math.abs(luminance(bitmap, width, x, y + 1) - here);
      count += 2;
    }
  }
  return count > 0 ? total / count : 0;
}

/** Smallest alpha among the rgba() stops of a computed background-image (1 when none). */
function minAlpha(backgroundImage, backgroundColor) {
  // The gradient is the card's paint; a transparent background-color under it doesn't count.
  const source =
    backgroundImage && backgroundImage !== "none"
      ? backgroundImage
      : backgroundColor;
  const alphas = [
    ...`${source}`.matchAll(
      /rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\)/g,
    ),
  ].map((match) => Number(match[1]));
  return alphas.length > 0 ? Math.min(...alphas) : 1;
}

async function assertSnapshotBlurPixels(sidebar, theme, localRect, label) {
  const page = mainWindow.contentView.children.find(
    (view) =>
      view.webContents && view.webContents.getURL().endsWith(`/${theme}`),
  );
  assert.ok(page, `${theme} live page view is available for pixel comparison`);
  const sidebarBounds = sidebar.getBounds();
  const pageBounds = page.getBounds();
  const screenRect = {
    x: sidebarBounds.x + localRect.x,
    y: sidebarBounds.y + localRect.y,
    width: localRect.width,
    height: localRect.height,
  };
  const left = Math.max(screenRect.x, pageBounds.x);
  const top = Math.max(screenRect.y, pageBounds.y);
  const right = Math.min(
    screenRect.x + screenRect.width,
    pageBounds.x + pageBounds.width,
  );
  const bottom = Math.min(
    screenRect.y + screenRect.height,
    pageBounds.y + pageBounds.height,
  );
  assert.ok(
    right - left >= 40 && bottom - top >= 20,
    "sample overlaps the live page",
  );

  const pageRect = {
    x: left - pageBounds.x,
    y: top - pageBounds.y,
    width: right - left,
    height: bottom - top,
  };
  const sidebarRect = {
    x: left - sidebarBounds.x,
    y: top - sidebarBounds.y,
    width: right - left,
    height: bottom - top,
  };
  const rawPage = await page.webContents.capturePage(pageRect);
  assert.ok(!rawPage.isEmpty(), `${theme} raw page pixels were captured`);

  let rendered;
  let renderedRect;
  if (process.platform === "linux" && process.env.DISPLAY) {
    rendered = captureWindow(`sidebar-snapshot-pixels-${label}-${theme}.png`);
    renderedRect = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  } else {
    // The Mac CI runner stays off-screen; capture the actual sidebar WebContents paint, which now
    // contains the blurred page snapshot instead of depending on a sibling native View layer.
    rendered = await captureSidebarSurface(sidebar);
    renderedRect = sidebarRect;
  }
  const rawEdges = edgeEnergy(rawPage);
  const renderedEdges = edgeEnergy(rendered, renderedRect);
  assert.ok(
    rawEdges > 1,
    `${theme} fixture contains sharp page detail (${rawEdges.toFixed(2)})`,
  );
  assert.ok(
    renderedEdges < rawEdges * 0.8,
    `${theme} sidebar snapshot softens sharp page edges (${renderedEdges.toFixed(2)} vs ${rawEdges.toFixed(2)})`,
  );
  console.log(
    `[sidebar-backdrop-smoke] ${theme} snapshot pixel edge energy: raw ${rawEdges.toFixed(2)}, sidebar ${renderedEdges.toFixed(2)}`,
  );
  return { rawEdges, renderedEdges };
}

async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(userData, smoke.ADBLOCK_CACHE_FILE),
    ElectronBlocker.parse(
      "||surffish-smoke-never-match.invalid^",
      smoke.ADBLOCK_CONFIG,
    ).serialize(),
  );
  // This smoke measures the floating hover card's own background (blur, tint, snapshot) over a
  // busy page, so it runs with Settings → Appearance → Sidebar pushes page off: pushing (the
  // default), the panel has no background of its own and the page slides aside instead
  // (electron-sidebar-overlay-smoke covers that path).
  writeFileSync(
    join(userData, "sidebar-appearance.json"),
    JSON.stringify({ sidebarPushesPage: false }),
  );
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
  );
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () =>
      BaseWindow.getAllWindows().find(
        (window) => !window.isDestroyed() && window.isVisible(),
      ),
    "the main window",
    45000,
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  if (coldHoverOnly && process.platform === "linux" && process.env.DISPLAY)
    pointerMove(1200, 750);
  await waitFor(
    () => surface("content") && surface("toolbar") && surface("sidebar"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar");
  const sidebar = surface("sidebar");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );

  let mode = "unknown";
  if (!measureOnly) {
    const reported = await evaluate(
      toolbar,
      "window.api.browser.sidebarBackdrop.get()",
    );
    mode = reported.state.mode;
    assert.equal(reported.settings.blur, true, "Sidebar blur is on by default");
    const expected =
      process.env.SURFFISH_SIDEBAR_BACKDROP ||
      (process.platform === "darwin" ? "snapshot" : "solid");
    assert.equal(mode, expected, "the expected backdrop path is in force");
  }

  const results = [];
  for (const theme of ["light", "dark"]) {
    await evaluate(
      toolbar,
      `window.api.browser.navigate(${JSON.stringify(`${origin}/${theme}`)})`,
    );
    await waitFor(async () => {
      const state = await evaluate(toolbar, "window.api.browser.state()");
      return state.url.endsWith(`/${theme}`) && !state.loading;
    }, `the ${theme} busy page`);
    const content = mainWindow.getContentBounds();
    const toolbarBottom = await evaluate(
      toolbar,
      'Math.round(document.querySelector(".browser-chrome").getBoundingClientRect().bottom)',
    );
    let capture = Promise.resolve(null);
    let captureError;
    let nativeProbe;
    if (hoverOnly) {
      if (process.platform === "linux" && process.env.DISPLAY)
        pointerMove(
          content.x + content.width - 40,
          content.y + toolbarBottom + 150,
        );
      if (!coldHoverOnly)
        await evaluate(
          toolbar,
          "window.api.browser.chrome.set({ sidebarPinned: false, sidebarHovered: false, sidebarFocused: false })",
        );
      await waitFor(() => {
        const bounds = sidebar.getBounds();
        return sidebar.getVisible() && bounds.width > 0 && bounds.width <= 100;
      }, "the live-page sidebar to settle to its collapsed rail");
      if (coldHoverOnly && process.platform === "linux" && process.env.DISPLAY)
        captureWindow(`sidebar-${mode}-cold-before-${label}-${theme}.png`);
      else await delay(500);
      if (coldHoverOnly && mode === "native")
        nativeProbe = armNativeHoverProbe(sidebar);
      await armSidebarHoverProbe(sidebar);
      const capturePrefix = `sidebar-hover-${label}-${theme}`;
      capture = captureHoverFrames(capturePrefix).catch((error) => {
        captureError = error;
        return null;
      });
      // A real pointer move on X11 exercises the collapsed-rail hover handler end to end.
      if (process.platform === "linux" && process.env.DISPLAY) {
        pointerMove(
          content.x + 40,
          content.y +
            toolbarBottom +
            Math.min(150, content.height - toolbarBottom - 20),
        );
      } else {
        await evaluate(
          toolbar,
          "window.api.browser.chrome.set({ sidebarHovered: true })",
        );
      }
    } else {
      await evaluate(
        toolbar,
        "window.api.browser.chrome.set({ sidebarHovered: true })",
      );
    }
    await waitFor(
      () => sidebar.getVisible() && sidebar.getBounds().width > 0,
      "the overlay sidebar to show",
    );
    if (mode === "snapshot")
      await waitFor(
        () =>
          evaluate(
            sidebar,
            'Boolean(document.querySelector(".sidebar-backdrop.is-ready"))',
          ),
        "the blurred page snapshot",
      );
    await delay(700);
    if (hoverOnly) {
      const hoverFrames = await finishSidebarHoverProbe(sidebar);
      if (!measureOnly) assertSidebarHoverRevealFrames(hoverFrames, theme);
      if (!measureOnly && mode === "snapshot")
        assertSnapshotHoverFrames(hoverFrames, theme);
      await capture;
      if (captureError) throw captureError;
      if (coldHoverOnly) {
        const nativeFrames = nativeProbe?.stop() ?? [];
        if (!measureOnly && mode === "native")
          assertRendererNativeHoverFrames(hoverFrames, nativeFrames, theme);
        const firstCoveredPixel =
          measureOnly || mode !== "native"
            ? null
            : assertFirstCoveredCardPixel(
                `sidebar-hover-${label}-${theme}`,
                theme,
              );
        if (!measureOnly && mode === "native")
          assertNativeHoverFrames(nativeFrames, theme);
        const dir = screenshotDirectory || join(userData, "shots");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, `sidebar-${mode}-cold-${label}-${theme}-frames.json`),
          `${JSON.stringify({ rendererFrames: hoverFrames, nativeFrames, firstCoveredPixel }, null, 2)}\n`,
        );
        if (process.platform === "linux" && process.env.DISPLAY)
          captureWindow(`sidebar-${mode}-cold-after-${label}-${theme}.png`);
      }
    }
    const sidebarBounds = sidebar.getBounds();
    const card = await evaluate(
      sidebar,
      `(() => { const el = document.querySelector('.browser-sidebar'); const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { backgroundImage: s.backgroundImage, backgroundColor: s.backgroundColor, backdropFilter: s.backdropFilter || s.webkitBackdropFilter, className: el.className, top: r.top, bottom: r.bottom, tabsBottom: Math.max(0, ...[...el.querySelectorAll('.tab-item, .sidebar-new-tab-row, .sidebar-pinned-sites, .sidebar-archived')].map((node) => node.getBoundingClientRect().bottom)), footerTop: el.querySelector('.sidebar-footer')?.getBoundingClientRect().top ?? r.bottom } })()`,
    );
    const windowCapture = process.platform === "linux" && process.env.DISPLAY;
    const image = windowCapture
      ? captureWindow(`sidebar-backdrop-${label}-${theme}.png`)
      : await captureSidebarSurface(sidebar);
    // An empty stretch of the card between the tab list and the footer, clear of the edges.
    const localRect = {
      x: 24,
      y: Math.round(card.tabsBottom + 24),
      width: Math.max(40, Math.min(sidebarBounds.width - 48, 200)),
      height: Math.max(20, Math.round(card.footerTop - card.tabsBottom - 48)),
    };
    const rect = {
      ...localRect,
      y: localRect.y + (windowCapture ? sidebarBounds.y : 0),
    };
    const behind = luminanceStdDev(image, rect);
    const snapshotPixels =
      !measureOnly && mode === "snapshot"
        ? await assertSnapshotBlurPixels(sidebar, theme, localRect, label)
        : null;
    results.push({
      theme,
      label,
      mode,
      std: Number(behind.std.toFixed(1)),
      mean: Number(behind.mean.toFixed(1)),
      minAlpha: minAlpha(card.backgroundImage, card.backgroundColor),
      backdropFilter: card.backdropFilter,
      bounds: sidebarBounds,
      snapshotPixels,
    });

    if (!measureOnly) {
      assert.ok(
        !card.backdropFilter || card.backdropFilter === "none",
        "no CSS backdrop-filter on the overlay sidebar (it can only see its own transparent view)",
      );
      assert.match(
        card.className,
        new RegExp(`has-backdrop-${mode}`),
        "the card styles itself for the active path",
      );
      if (mode === "solid")
        assert.ok(
          results.at(-1).minAlpha >= 0.9,
          `solid tint is near-opaque (min alpha ${results.at(-1).minAlpha})`,
        );
      if (mode === "snapshot") {
        const tint = await evaluate(
          sidebar,
          'getComputedStyle(document.querySelector(".sidebar-backdrop-tint")).backgroundImage',
        );
        assert.ok(
          minAlpha(tint, "") >= 0.65,
          "the snapshot is darkened enough to read on",
        );
        assert.ok(
          await evaluate(
            sidebar,
            'document.querySelector(".sidebar-backdrop-canvas").width > 0',
          ),
          "the snapshot canvas is drawn",
        );
        assert.ok(
          results.at(-1).minAlpha >= 0.94,
          `the snapshot fallback blocks unblurred page pixels while refreshing (min alpha ${results.at(-1).minAlpha})`,
        );
      }
      if (mode === "native") {
        const toolbarBottom = await evaluate(
          toolbar,
          'Math.round(document.querySelector(".browser-chrome").getBoundingClientRect().bottom)',
        );
        const nativeState = await evaluate(
          toolbar,
          "window.api.browser.sidebarBackdrop.get()",
        );
        assert.equal(
          nativeState.state.nativeOverlay,
          true,
          "the floating overlay has a separate native background View over live page pixels",
        );
        // Background-only Views: the card's glass layer on top, the shadow layers stacked under it.
        const nativeViews = mainWindow.contentView.children.filter(
          (view) => !view.webContents,
        );
        assert.ok(
          nativeViews.length >= 1,
          "a background-only native View is attached",
        );
        const nativeBackdrop = nativeViews.at(-1);
        const childViews = mainWindow.contentView.children;
        const pageIndex = childViews.findIndex(
          (view) =>
            view.webContents && view.webContents.getURL().includes(`/${theme}`),
        );
        assert.ok(
          pageIndex >= 0,
          "the live page view is present underneath the sidebar",
        );
        assert.ok(
          pageIndex < childViews.indexOf(nativeBackdrop) &&
            childViews.indexOf(nativeBackdrop) < childViews.indexOf(toolbar) &&
            childViews.indexOf(nativeBackdrop) < childViews.indexOf(sidebar),
          "the native material is above live page pixels but behind toolbar and sidebar content",
        );
        assert.equal(nativeBackdrop.getVisible(), true);
        // The hover panel is a floating card (src/shared/sidebar-card.ts SIDEBAR_FLOAT): its glass
        // layer is the overlay view's bounds inset by the float gap, rounded.
        const floatCard = (bounds) => ({
          x: bounds.x + SIDEBAR_FLOAT_GAP,
          y: bounds.y + SIDEBAR_FLOAT_GAP,
          width: bounds.width - SIDEBAR_FLOAT_GAP,
          height: bounds.height - SIDEBAR_FLOAT_GAP * 2,
        });
        assert.deepEqual(
          nativeBackdrop.getBounds(),
          floatCard(sidebar.getBounds()),
          "the native material View is the floating card inside the sidebar's live bounds",
        );
        assert.equal(
          card.backgroundImage,
          "none",
          "the native view supplies blur and tint without a CSS glass layer",
        );
        assert.equal(
          card.backgroundColor,
          "rgba(0, 0, 0, 0)",
          "native material shows through the transparent sidebar surface",
        );
        assert.equal(
          sidebarBounds.y,
          toolbarBottom,
          "the floating overlay starts at the toolbar's bottom edge without a second frame inset",
        );
        assert.equal(
          sidebarBounds.height,
          mainWindow.getContentBounds().height - toolbarBottom,
          "the overlay fills the remaining area below the toolbar",
        );
        const { sidebarWidth: originalWidth } = await evaluate(
          toolbar,
          "window.api.browser.chrome.get()",
        );
        const resizedWidth = Math.min(
          originalWidth + 32,
          mainWindow.getContentBounds().width - 48,
        );
        await evaluate(
          toolbar,
          `window.api.browser.chrome.set({ sidebarWidth: ${resizedWidth} })`,
        );
        await waitFor(
          () => sidebar.getBounds().width === resizedWidth + SIDEBAR_FLOAT_GAP,
          "the floating sidebar to apply its resized width",
        );
        assert.deepEqual(
          nativeBackdrop.getBounds(),
          floatCard(sidebar.getBounds()),
          "a width-only layout update keeps native material aligned without a progress change",
        );
        await evaluate(
          toolbar,
          `window.api.browser.chrome.set({ sidebarWidth: ${originalWidth} })`,
        );
        await waitFor(
          () => sidebar.getBounds().width === originalWidth + SIDEBAR_FLOAT_GAP,
          "the floating sidebar to restore its original width",
        );
      }
      // The page's nav text and thumbnails must not read through sharply. The snapshot's graduated
      // tint contributes some low-frequency luminance spread, so its pixel edge comparison above
      // is the primary blur assertion and this remains a looser overall-variance guard.
      if (mode !== "native" || process.platform === "darwin")
        assert.ok(
          results.at(-1).std <
            (mode === "snapshot"
              ? 16
              : mode === "native" && process.platform === "darwin"
                ? 14
                : 8),
          `page detail bleeds through the sidebar (${theme}: luminance std ${results.at(-1).std})`,
        );
      else
        console.log(
          "Skipping native-blur contrast assertion: this platform does not provide the macOS compositor layer.",
        );
    }
    await evaluate(
      toolbar,
      "window.api.browser.chrome.set({ sidebarHovered: false })",
    );
    await waitFor(() => {
      const bounds = sidebar.getBounds();
      return sidebar.getVisible() && bounds.width > 0 && bounds.width <= 100;
    }, "the hover panel to collapse back to its visible tab rail");
    if (mode === "snapshot") {
      // Collapsed: no full-panel snapshot is kept around (and none is taken).
      await waitFor(
        () =>
          evaluate(
            sidebar,
            '!document.querySelector(".sidebar-backdrop.is-ready")',
          ),
        "the snapshot to be dropped when hidden",
        5000,
      ).catch(() => undefined);
    }
    if (hoverOnly && process.platform === "linux" && process.env.DISPLAY) {
      const content = mainWindow.getContentBounds();
      pointerMove(
        content.x + Math.max(120, content.width - 24),
        content.y + sidebar.getBounds().y + 120,
      );
    }
  }

  if (hoverOnly) {
    console.log("Electron sidebar hover-frame smoke passed.");
    return;
  }

  if (!measureOnly) {
    // Settings → Appearance → Sidebar blur off: always the solid tint.
    await evaluate(
      toolbar,
      "window.api.browser.sidebarBackdrop.set({ blur: false })",
    );
    await waitFor(
      async () =>
        (await evaluate(toolbar, "window.api.browser.sidebarBackdrop.get()"))
          .state.mode === "solid",
      "blur off to switch to solid",
    );
    const solidState = await evaluate(
      toolbar,
      "window.api.browser.sidebarBackdrop.get()",
    );
    assert.equal(
      solidState.state.nativeOverlay,
      false,
      "the solid fallback hides the separate native overlay View",
    );
    await evaluate(
      toolbar,
      "window.api.browser.chrome.set({ sidebarHovered: true })",
    );
    await waitFor(
      () =>
        evaluate(
          sidebar,
          'document.querySelector(".browser-sidebar").className.includes("has-backdrop-solid")',
        ),
      "the solid card",
    );
    // Switching to a solid fallback removes the native overlay layer; the sidebar stays below the toolbar.
    const toolbarBottom = await evaluate(
      toolbar,
      'Math.round(document.querySelector(".browser-chrome").getBoundingClientRect().bottom)',
    );
    assert.equal(
      sidebar.getBounds().y,
      toolbarBottom,
      "the sidebar view remains aligned to the toolbar after turning blur off",
    );
    await delay(700);
    // Switched at runtime (e.g. native → solid): the card must still paint, over the dark page.
    const offImage = captureWindow(`sidebar-backdrop-${label}-blur-off.png`);
    const off = luminanceStdDev(offImage, {
      x: 24,
      y: 300,
      width: 200,
      height: 200,
    });
    assert.ok(
      off.std < 8,
      `blur off: page detail bleeds through (${off.std.toFixed(1)})`,
    );
    const offPage = luminanceStdDev(offImage, {
      x: 340,
      y: 300,
      width: 200,
      height: 200,
    });
    assert.ok(
      Math.abs(off.mean - offPage.mean) > 5 || off.std < offPage.std,
      "blur off: the sidebar card is drawn",
    );
    await evaluate(
      toolbar,
      "window.api.browser.chrome.set({ sidebarHovered: false })",
    );
    await evaluate(
      toolbar,
      "window.api.browser.sidebarBackdrop.set({ blur: true })",
    );
  }
  console.log(`SIDEBAR_BACKDROP_RESULTS ${JSON.stringify(results)}`);
  console.log("Electron sidebar backdrop smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron sidebar backdrop smoke failed:", error);
    app.exit(1);
  },
);
