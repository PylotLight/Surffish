import { nativeImage, type WebContents } from "electron";
import { regionToImagePixels, type Rect } from "../shared/screenshot";
import {
  captureBand,
  clampScrollRange,
  maxCaptureCssHeight,
  scrollEndAt,
  scrollingClip,
  sliceRowsInPixels,
  stitchSlice,
  stitchTargetScroll,
} from "../shared/screenshot-scrolling";

/**
 * Scrolling screenshot: the user marks where the capture starts (the top of the view, or a dragged
 * region's top edge and width), then scrolls the live page (wheel, keys or auto-scroll) and stops
 * where it should end: Done / Enter takes everything down to the bottom of the view, a click on the
 * page ends it at that row.
 *
 * While the user scrolls, a small script in an isolated world draws the start line, the size limit
 * and a "click to end here" guide on a pointer-events:none layer, swallows clicks (so links don't
 * fire), and works out which scroller is being scrolled: the document, or the innermost scroll
 * container under the starting point. Nothing is captured until the end is chosen; then:
 *   - document scroller: one CDP Page.captureScreenshot with a clip over the chosen rows
 *     (captureBeyondViewport), so there are no seams;
 *   - inner scroll container (or CDP unavailable): scroll back to the start and capture the box a
 *     screen at a time, hiding fixed / sticky elements after the first frame so headers don't
 *     repeat, then stitch the new rows of each frame.
 * The user's own scroll position is put back afterwards.
 */

export const SCROLL_SHOT_WORLD_ID = 2027;
const SETTLE_MS = 90;
const KEY = "__surffishScrollShot";

export interface PixelImage {
  png: Buffer;
  width: number;
  height: number;
}

export interface ScrollShotDeps {
  captureVisible(contents: WebContents): Promise<PixelImage | null>;
  pixelImageFromPng(png: Buffer): PixelImage | null;
  withPageDebugger<T>(
    contents: WebContents,
    task: (
      send: (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<unknown>,
    ) => Promise<T>,
  ): Promise<T | null>;
}

/** Live readout while the user scrolls (polled by main for the control bar). */
export interface ScrollShotState {
  /** Capture size so far, CSS px. */
  width: number;
  height: number;
  dpr: number;
  maxCss: number;
  auto: boolean;
  /** Viewport row the user clicked to end the capture, once they have. */
  clickY: number | null;
  /** Capturing an inner scroll container rather than the document. */
  inner: boolean;
}

/** Everything the capture needs, read from the page when the user stops. */
export interface ScrollShotGeometry {
  doc: boolean;
  /** Content row the capture starts at. */
  start: number;
  scrollTop: number;
  maxScroll: number;
  contentHeight: number;
  /** Scroller's content box top in viewport CSS px (negative when it starts above the view). */
  contentTop: number;
  /** Visible part of that box, viewport CSS px. */
  visTop: number;
  visBottom: number;
  visLeft: number;
  visRight: number;
  region: { x: number; width: number } | null;
  clickY: number | null;
  viewportWidth: number;
  viewportHeight: number;
  dpr: number;
  scrollX: number;
  /** Document scroll when the capture started (fixed headers sit where they were then). */
  startDocScroll: number;
}

// Runs in the page's isolated world. Only DOM APIs; nothing is shared with page scripts except the
// overlay layer element itself.
const PAGE_SCRIPT = String.raw`(() => {
  const KEY = '${KEY}'
  if (window[KEY]) { try { window[KEY].teardown() } catch {} }
  const docEl = document.scrollingElement || document.documentElement
  let st = null

  const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
  function scrollable(el) {
    const style = getComputedStyle(el)
    return /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
  }
  function cur(c) { return c.doc ? window.scrollY : c.el.scrollTop }
  function maxScroll(c) { return Math.max(0, (c.doc ? docEl.scrollHeight - docEl.clientHeight : c.el.scrollHeight - c.el.clientHeight)) }
  function box(c) {
    if (c.doc) return { contentTop: 0, top: 0, bottom: docEl.clientHeight || innerHeight, left: 0, right: docEl.clientWidth || innerWidth }
    const rect = c.el.getBoundingClientRect()
    const contentTop = rect.top + c.el.clientTop
    const contentLeft = rect.left + c.el.clientLeft
    return {
      contentTop,
      top: Math.max(0, contentTop),
      bottom: Math.min(innerHeight, contentTop + c.el.clientHeight),
      left: Math.max(0, contentLeft),
      right: Math.min(innerWidth, contentLeft + c.el.clientWidth)
    }
  }
  function active() {
    let best = null
    let bestDelta = 0
    for (const c of st.candidates) {
      const delta = Math.abs(cur(c) - c.startScroll)
      if (delta > bestDelta) { best = c; bestDelta = delta }
    }
    return best || st.candidates.find((c) => maxScroll(c) > 0) || st.candidates[st.candidates.length - 1]
  }
  function band(b) {
    const r = st.region
    const left = r ? Math.max(b.left, r.x) : b.left
    const right = r ? Math.min(b.right, r.x + r.width) : b.right
    return { left, right: Math.max(left, right) }
  }
  function onScrollbar(event) {
    if (event.clientX >= (docEl.clientWidth || innerWidth) || event.clientY >= (docEl.clientHeight || innerHeight)) return true
    const target = event.target
    if (target instanceof Element && target !== docEl && target !== document.body && scrollable(target)) {
      const rect = target.getBoundingClientRect()
      return event.clientX >= rect.left + target.clientLeft + target.clientWidth || event.clientY >= rect.top + target.clientTop + target.clientHeight
    }
    return false
  }

  // ---- overlay layer (pointer-events: none; removed before anything is captured)
  function part(css) {
    const el = document.createElement('div')
    el.style.cssText = 'all: initial; position: fixed; display: none; pointer-events: none; box-sizing: border-box;' + css
    st.shadow.appendChild(el)
    return el
  }
  function buildLayer() {
    const host = document.createElement('div')
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;'
    st.layer = host
    st.shadow = host.attachShadow({ mode: 'closed' })
    st.parts = {
      above: part('background: rgba(0,0,0,.42);'),
      left: part('background: rgba(0,0,0,.42);'),
      right: part('background: rgba(0,0,0,.42);'),
      start: part('height: 0; border-top: 2px solid #1684ff; box-shadow: 0 0 0 1px rgba(255,255,255,.6);'),
      startLabel: part('padding: 2px 7px; border-radius: 5px; background: #1684ff; color: #fff; font: 600 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; white-space: nowrap;'),
      limit: part('background: repeating-linear-gradient(135deg, rgba(255,59,48,.30) 0 10px, rgba(255,59,48,.16) 10px 20px); border-top: 2px solid #ff3b30;'),
      guide: part('height: 0; border-top: 2px dashed #ffcc00;'),
      guideLabel: part('padding: 2px 7px; border-radius: 5px; background: rgba(0,0,0,.78); color: #ffcc00; font: 600 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; white-space: nowrap;')
    }
    st.parts.startLabel.textContent = 'Capture starts here'
    st.parts.guideLabel.textContent = 'Click to end here'
    document.documentElement.appendChild(host)
  }
  function place(el, x, y, width, height) {
    if (!(width > 0) || !(height >= 0)) { el.style.display = 'none'; return }
    el.style.display = 'block'
    el.style.left = x + 'px'
    el.style.top = y + 'px'
    el.style.width = width + 'px'
    el.style.height = height + 'px'
  }
  function label(el, x, y) {
    el.style.display = 'block'
    el.style.left = x + 'px'
    el.style.top = y + 'px'
  }
  function draw() {
    st.raf = 0
    if (!st || !st.layer) return
    if (!st.layer.isConnected) document.documentElement.appendChild(st.layer)
    const c = active()
    const b = box(c)
    const { left, right } = band(b)
    const p = st.parts
    const startY = b.contentTop + c.startOffset - cur(c)
    const vh = innerHeight
    const vw = innerWidth
    place(p.left, 0, 0, left, vh)
    place(p.right, right, 0, vw - right, vh)
    const shadeBottom = Math.min(b.bottom, Math.max(b.top, startY))
    place(p.above, left, b.top, right - left, shadeBottom - b.top)
    if (startY >= b.top - 1 && startY <= b.bottom) {
      place(p.start, left, startY - 1, right - left, 0)
      label(p.startLabel, left + 6, Math.min(b.bottom - 22, startY + 4))
    } else { p.start.style.display = 'none'; p.startLabel.style.display = 'none' }
    const limitY = startY + st.maxCss
    if (limitY < b.bottom) place(p.limit, left, Math.max(b.top, limitY), right - left, b.bottom - Math.max(b.top, limitY))
    else p.limit.style.display = 'none'
    const my = st.mouseY
    if (my !== null && my > Math.max(b.top, startY) && my < Math.min(b.bottom, limitY)) {
      place(p.guide, left, my - 1, right - left, 0)
      label(p.guideLabel, Math.min(right - 120, Math.max(left + 6, st.mouseX + 12)), Math.max(b.top, my - 24))
    } else { p.guide.style.display = 'none'; p.guideLabel.style.display = 'none' }
  }
  function schedule() { if (st && !st.raf) st.raf = requestAnimationFrame(draw) }

  // ---- input while scrolling
  function swallow(event) {
    if (!st || st.finished || event.button !== 0 || onScrollbar(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === 'click') st.clickY = event.clientY
  }
  function swallowAny(event) {
    if (!st || st.finished) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  function onMove(event) { st.mouseX = event.clientX; st.mouseY = event.clientY; schedule() }
  function onLeave() { st.mouseY = null; schedule() }
  function onWheel() { stopAuto() }
  const listeners = [
    ['scroll', schedule, { capture: true, passive: true }],
    ['resize', schedule, { passive: true }],
    ['wheel', onWheel, { capture: true, passive: true }],
    ['pointermove', onMove, { capture: true, passive: true }],
    ['mouseout', (event) => { if (!event.relatedTarget) onLeave() }, { capture: true, passive: true }],
    ['pointerdown', swallow, { capture: true }],
    ['mousedown', swallow, { capture: true }],
    ['pointerup', swallow, { capture: true }],
    ['mouseup', swallow, { capture: true }],
    ['click', swallow, { capture: true }],
    ['dblclick', swallowAny, { capture: true }],
    ['auxclick', swallowAny, { capture: true }],
    ['contextmenu', swallowAny, { capture: true }],
    ['dragstart', swallowAny, { capture: true }],
    ['selectstart', swallowAny, { capture: true }]
  ]

  // ---- auto-scroll
  function stopAuto() {
    if (st && st.autoRaf) cancelAnimationFrame(st.autoRaf)
    if (st) { st.autoRaf = 0; st.autoLast = 0 }
  }
  function autoStep(time) {
    if (!st) return
    let c = active()
    if (maxScroll(c) - cur(c) < 1) c = st.candidates.find((other) => maxScroll(other) - cur(other) >= 1) || c
    const b = box(c)
    const dt = st.autoLast ? Math.min(64, time - st.autoLast) : 16
    st.autoLast = time
    const speed = Math.max(300, (b.bottom - b.top) * 0.8)
    const capturedBottom = cur(c) + (b.bottom - b.contentTop)
    if (cur(c) >= maxScroll(c) - 0.5 || capturedBottom - c.startOffset >= st.maxCss) { stopAuto(); return }
    st.autoPos = (st.autoTarget === c ? st.autoPos : cur(c)) + (speed * dt) / 1000
    st.autoTarget = c
    const top = Math.min(maxScroll(c), st.autoPos)
    if (c.doc) window.scrollTo({ left: window.scrollX, top, behavior: 'instant' })
    else c.el.scrollTo({ top, behavior: 'instant' })
    st.autoRaf = requestAnimationFrame(autoStep)
  }

  function removeLayer() {
    if (!st) return
    stopAuto()
    if (st.raf) cancelAnimationFrame(st.raf)
    st.raf = 0
    for (const [type, fn, options] of listeners) window.removeEventListener(type, fn, options)
    if (st.layer) st.layer.remove()
    st.layer = null
  }

  const api = {
    start(params) {
      const viewWidth = num(params && params.viewWidth, 0)
      const scale = viewWidth > 0 ? innerWidth / viewWidth : 1
      const raw = params && params.rect
      const region = raw ? { x: raw.x * scale, y: raw.y * scale, width: raw.width * scale, height: raw.height * scale } : null
      const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
      st = {
        region, dpr, maxCss: Math.max(1, Math.floor(num(params && params.maxSidePx, 16384) / dpr)),
        candidates: [], layer: null, shadow: null, parts: null, raf: 0, autoRaf: 0, autoLast: 0, autoPos: 0, autoTarget: null,
        mouseX: 0, mouseY: null, clickY: null, finished: false, hidden: [], final: null,
        startDocScroll: window.scrollY
      }
      const startY = region ? region.y : 0
      const px = region ? region.x + region.width / 2 : innerWidth / 2
      const py = region ? region.y + Math.min(region.height / 2, 8) : innerHeight / 2
      let el = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, px)), Math.max(0, Math.min(innerHeight - 1, py)))
      while (el && el !== docEl && el !== document.documentElement) {
        if (scrollable(el)) st.candidates.push({ el, doc: false })
        el = el.parentElement
      }
      st.candidates.push({ el: docEl, doc: true })
      for (const c of st.candidates) {
        c.startScroll = cur(c)
        const b = box(c)
        c.startOffset = c.startScroll + Math.max(0, startY - b.contentTop)
      }
      buildLayer()
      for (const [type, fn, options] of listeners) window.addEventListener(type, fn, options)
      schedule()
      return true
    },
    state() {
      if (!st) return null
      const c = active()
      const b = box(c)
      const { left, right } = band(b)
      return {
        width: right - left,
        height: Math.max(1, cur(c) + (b.bottom - b.contentTop) - c.startOffset),
        dpr: st.dpr, maxCss: st.maxCss, auto: Boolean(st.autoRaf), clickY: st.clickY, inner: !c.doc
      }
    },
    auto(on) {
      if (!st) return false
      if (on && !st.autoRaf) { st.autoTarget = null; st.autoRaf = requestAnimationFrame(autoStep) } else if (!on) stopAuto()
      return Boolean(st.autoRaf)
    },
    finish() {
      if (!st) return null
      st.finished = true
      const c = active()
      const b = box(c)
      removeLayer()
      st.target = c
      st.final = { x: window.scrollX, y: window.scrollY, el: c.doc ? null : c.el.scrollTop }
      return {
        doc: c.doc, start: c.startOffset, scrollTop: cur(c), maxScroll: maxScroll(c),
        contentHeight: c.doc ? docEl.scrollHeight : c.el.scrollHeight,
        contentTop: b.contentTop, visTop: b.top, visBottom: b.bottom, visLeft: b.left, visRight: b.right,
        region: st.region ? { x: st.region.x, width: st.region.width } : null,
        clickY: st.clickY, viewportWidth: innerWidth, viewportHeight: innerHeight, dpr: st.dpr,
        scrollX: window.scrollX, startDocScroll: st.startDocScroll
      }
    },
    scrollTo(top) {
      if (!st || !st.target) return Promise.resolve(null)
      const c = st.target
      if (c.doc) window.scrollTo({ left: window.scrollX, top, behavior: 'instant' })
      else c.el.scrollTo({ top, behavior: 'instant' })
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(cur(c)))))
    },
    hideFloating() {
      if (!st || !st.target) return 0
      const scroller = st.target.el
      const all = document.body ? document.body.getElementsByTagName('*') : []
      const limit = Math.min(all.length, 40000)
      for (let index = 0; index < limit; index += 1) {
        const el = all[index]
        if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue
        const position = getComputedStyle(el).position
        if (position !== 'fixed' && position !== 'sticky') continue
        if (el.contains(scroller)) continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1 || rect.bottom <= 0 || rect.top >= innerHeight) continue
        st.hidden.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')])
        el.style.setProperty('visibility', 'hidden', 'important')
      }
      return st.hidden.length
    },
    restore() {
      if (!st) return
      for (const [el, value, priority] of st.hidden) {
        if (value) el.style.setProperty('visibility', value, priority)
        else el.style.removeProperty('visibility')
      }
      st.hidden = []
      const f = st.final
      if (f) {
        if (f.el !== null && st.target && !st.target.doc) st.target.el.scrollTo({ top: f.el, behavior: 'instant' })
        window.scrollTo({ left: f.x, top: f.y, behavior: 'instant' })
      }
    },
    teardown() {
      removeLayer()
      if (st && st.final) api.restore()
      st = null
      if (window[KEY] === api) delete window[KEY]
    }
  }
  window[KEY] = api
  return true
})()`;

async function run(contents: WebContents, code: string): Promise<unknown> {
  if (contents.isDestroyed()) return null;
  return contents.executeJavaScriptInIsolatedWorld(SCROLL_SHOT_WORLD_ID, [
    { code },
  ]);
}

const call = (method: string, ...args: unknown[]): string =>
  `(window.${KEY} ? window.${KEY}.${method}(${args.map((arg) => JSON.stringify(arg)).join(", ")}) : null)`;

/** Put the start line and guides on the page and start tracking the scroll. False if the page refused. */
export async function startScrollShot(
  contents: WebContents,
  rect: Rect | null,
  viewWidth: number,
  maxSidePx: number,
): Promise<boolean> {
  try {
    await run(contents, PAGE_SCRIPT);
    return (
      (await run(contents, call("start", { rect, viewWidth, maxSidePx }))) ===
      true
    );
  } catch (error) {
    console.warn(
      "[screenshot] scrolling capture could not start:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

function asState(value: unknown): ScrollShotState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const n = (key: string): number =>
    typeof v[key] === "number" && Number.isFinite(v[key])
      ? (v[key] as number)
      : 0;
  return {
    width: n("width"),
    height: n("height"),
    dpr: n("dpr") || 1,
    maxCss: n("maxCss") || 1,
    auto: v.auto === true,
    clickY:
      typeof v.clickY === "number" && Number.isFinite(v.clickY)
        ? v.clickY
        : null,
    inner: v.inner === true,
  };
}

export async function readScrollShotState(
  contents: WebContents,
): Promise<ScrollShotState | null> {
  try {
    return asState(await run(contents, call("state")));
  } catch {
    return null;
  }
}

export async function setScrollShotAuto(
  contents: WebContents,
  on: boolean,
): Promise<boolean> {
  try {
    return (await run(contents, call("auto", on))) === true;
  } catch {
    return false;
  }
}

/** Remove the layer and listeners and put the scroll back. Safe to call on a page that navigated. */
export async function teardownScrollShot(contents: WebContents): Promise<void> {
  await run(contents, call("teardown")).catch(() => undefined);
}

function asGeometry(value: unknown): ScrollShotGeometry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const numbers = [
    "start",
    "scrollTop",
    "maxScroll",
    "contentHeight",
    "contentTop",
    "visTop",
    "visBottom",
    "visLeft",
    "visRight",
    "viewportWidth",
    "viewportHeight",
    "dpr",
    "scrollX",
    "startDocScroll",
  ];
  if (
    !numbers.every(
      (key) => typeof v[key] === "number" && Number.isFinite(v[key]),
    )
  )
    return null;
  const region =
    v.region && typeof v.region === "object"
      ? (v.region as Record<string, unknown>)
      : null;
  return {
    ...(Object.fromEntries(
      numbers.map((key) => [key, v[key] as number]),
    ) as Omit<ScrollShotGeometry, "doc" | "region" | "clickY">),
    doc: v.doc === true,
    region:
      region && typeof region.x === "number" && typeof region.width === "number"
        ? { x: region.x, width: region.width }
        : null,
    clickY:
      typeof v.clickY === "number" && Number.isFinite(v.clickY)
        ? v.clickY
        : null,
  };
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ScrollShotResult {
  image: PixelImage;
  truncated: boolean;
}

/**
 * The user stopped: read where, take the capture, put the page back. `forceStitch` (smoke tests)
 * skips CDP for document scrollers.
 */
export async function finishScrollShot(
  contents: WebContents,
  deps: ScrollShotDeps,
  maxSidePx: number,
  forceStitch = false,
): Promise<ScrollShotResult | null> {
  let geometry: ScrollShotGeometry | null;
  try {
    geometry = asGeometry(await run(contents, call("finish")));
    if (!geometry) return null;
    const end = Math.min(
      scrollEndAt(
        geometry.scrollTop,
        geometry.contentTop,
        geometry.visBottom,
        geometry.clickY,
      ),
      geometry.contentHeight,
    );
    const range = clampScrollRange(
      geometry.start,
      end,
      maxCaptureCssHeight(geometry.dpr, maxSidePx),
    );
    const band = captureBand(
      { x: geometry.visLeft, width: geometry.visRight - geometry.visLeft },
      geometry.region,
    );
    if (!band) return null;
    if (geometry.doc && !forceStitch) {
      const viaCdp = await captureWithCdp(
        contents,
        deps,
        geometry,
        range,
        band,
        maxSidePx,
      );
      if (viaCdp) return viaCdp;
      console.info(
        "[screenshot] CDP scrolling capture unavailable; scrolling and stitching instead",
      );
    }
    return await captureByStitching(contents, deps, geometry, range, band);
  } catch (error) {
    console.warn(
      "[screenshot] scrolling capture failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    await teardownScrollShot(contents);
  }
}

async function captureWithCdp(
  contents: WebContents,
  deps: ScrollShotDeps,
  geometry: ScrollShotGeometry,
  range: { start: number; end: number; truncated: boolean },
  band: { x: number; width: number },
  maxSidePx: number,
): Promise<ScrollShotResult | null> {
  const plan = scrollingClip(
    range,
    band,
    geometry.scrollX,
    geometry.dpr,
    maxSidePx,
  );
  if (!plan) return null;
  // Fixed and sticky headers are laid out against the scroll position; put it back where the
  // capture started so they show once at the top rather than in the middle of the image.
  await run(contents, call("scrollTo", Math.round(geometry.startDocScroll)));
  await delay(SETTLE_MS);
  return deps.withPageDebugger(contents, async (send) => {
    const result = (await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      fromSurface: true,
      clip: plan.clip,
    })) as { data?: string };
    if (typeof result?.data !== "string") return null;
    const image = deps.pixelImageFromPng(Buffer.from(result.data, "base64"));
    return image
      ? { image, truncated: plan.truncated || range.truncated }
      : null;
  });
}

async function captureByStitching(
  contents: WebContents,
  deps: ScrollShotDeps,
  geometry: ScrollShotGeometry,
  range: { start: number; end: number; truncated: boolean },
  band: { x: number; width: number },
): Promise<ScrollShotResult | null> {
  // Content rows hidden above the view when an inner scroller starts above the viewport top.
  const offset = geometry.visTop - geometry.contentTop;
  const boxHeight = geometry.visBottom - geometry.visTop;
  if (!(boxHeight >= 1)) return null;
  const viewport = {
    width: geometry.viewportWidth,
    height: geometry.viewportHeight,
  };
  const chunks: Buffer[] = [];
  let width = 0;
  let height = 0;
  let columns: Rect | null = null;
  let position = range.start;
  let truncated = range.truncated;
  let floatingHidden = false;
  const guard = Math.ceil((range.end - range.start) / boxHeight) + 3;
  for (let step = 0; position < range.end; step += 1) {
    if (step > guard || contents.isDestroyed()) {
      truncated = true;
      break;
    }
    const asked = stitchTargetScroll(position - offset, geometry.maxScroll);
    const actual = await run(contents, call("scrollTo", asked));
    if (typeof actual !== "number") return null;
    await delay(SETTLE_MS);
    const slice = stitchSlice(position, range.end, actual + offset, boxHeight);
    if (!slice) {
      truncated = true;
      break;
    }
    const frame = await deps.captureVisible(contents);
    if (!frame) return null;
    if (!columns) {
      columns = regionToImagePixels(
        { x: band.x, y: 0, width: band.width, height: viewport.height },
        viewport,
        frame,
      );
      if (!columns) return null;
      width = columns.width;
    }
    const bitmap = nativeImage.createFromBuffer(frame.png).toBitmap();
    const stride = frame.width * 4;
    if (
      bitmap.length < stride * frame.height ||
      columns.x + width > frame.width
    )
      return null;
    const rows = sliceRowsInPixels(
      geometry.visTop,
      slice,
      viewport.height,
      frame.height,
    );
    const chunk = Buffer.allocUnsafe(rows.height * width * 4);
    for (let row = 0; row < rows.height; row += 1) {
      const from = (rows.top + row) * stride + columns.x * 4;
      bitmap.copy(chunk, row * width * 4, from, from + width * 4);
    }
    chunks.push(chunk);
    height += rows.height;
    position += slice.height;
    if (!floatingHidden && position < range.end) {
      // Headers and other fixed / sticky bits stay in the first frame only.
      await run(contents, call("hideFloating")).catch(() => 0);
      floatingHidden = true;
    }
  }
  if (height < 1 || width < 1) return null;
  const stitched = nativeImage.createFromBitmap(Buffer.concat(chunks), {
    width,
    height,
  });
  const image = deps.pixelImageFromPng(stitched.toPNG());
  return image ? { image, truncated } : null;
}
