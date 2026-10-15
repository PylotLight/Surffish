import type { NativeImage, Rectangle, WebContents } from 'electron'

/** Long enough for a busy page on a loaded machine; a capture that takes longer is stale anyway. */
const CAPTURE_TIMEOUT_MS = 4_000

/**
 * `contents.capturePage()` that always settles: null when the page is destroyed, the capture fails,
 * comes back empty, or takes longer than `timeoutMs`.
 *
 * Electron 44's capturePage never resolves for a view that is detached (a tab switched away while
 * the capture was pending) or whose renderer is gone. Awaiting it directly left callers stuck for
 * good: the sidebar backdrop stopped refreshing for the rest of the window's life (its `capturing`
 * flag never cleared), and every pending thumbnail kept its tab and image alive.
 */
export function capturePageWithin(
  contents: WebContents,
  rect?: Rectangle,
  options?: { stayHidden?: boolean; stayAwake?: boolean },
  timeoutMs = CAPTURE_TIMEOUT_MS
): Promise<NativeImage | null> {
  if (contents.isDestroyed()) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (image: NativeImage | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!contents.isDestroyed()) contents.removeListener('destroyed', onDestroyed)
      resolve(image && !image.isEmpty() ? image : null)
    }
    const onDestroyed = (): void => finish(null)
    const timer = setTimeout(() => finish(null), timeoutMs)
    contents.once('destroyed', onDestroyed)
    let capture: Promise<NativeImage>
    try {
      capture = rect ? contents.capturePage(rect, options) : contents.capturePage(undefined, options)
    } catch {
      finish(null)
      return
    }
    capture.then(finish, () => finish(null))
  })
}

/**
 * A captured image's width in bitmap pixels. Electron 46 marks capturePage() images with the page's
 * scale factor, so getSize() is in DIPs on a Retina screen (Electron 44/45 always marked them 1x, so
 * getSize() was pixels); resize({ width }) still yields that many pixels. Size maths that wants
 * pixels (wake snapshots, thumbnails, the sidebar backdrop) uses this instead of getSize().width.
 */
export function capturedPixelWidth(image: NativeImage): number {
  return Math.round(image.getSize().width * Math.max(1, ...image.getScaleFactors()))
}
