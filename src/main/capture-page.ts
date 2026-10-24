import type { NativeImage, Rectangle, WebContents } from "electron";

/** Long enough for a busy page on a loaded machine; a capture that takes longer is stale anyway. */
const CAPTURE_TIMEOUT_MS = 4_000;

/** Electron 46 NativeImage dimensions are DIPs by default; use its largest representation for bitmap pixels. */
export function nativeImagePixelScaleFactor(
  image: Pick<NativeImage, "getScaleFactors">,
): number {
  const factors = image
    .getScaleFactors()
    .filter((factor) => Number.isFinite(factor) && factor > 0);
  return factors.length > 0 ? Math.max(...factors) : 1;
}

/** Bitmap dimensions in pixels, rather than the default DIP dimensions returned by getSize(). */
export function nativeImagePixelSize(
  image: Pick<NativeImage, "getSize" | "getScaleFactors">,
): { width: number; height: number } {
  return image.getSize(nativeImagePixelScaleFactor(image));
}

/** Convert a desired bitmap width back to the DIP width accepted by NativeImage.resize(). */
export function nativeImagePixelWidthToDip(
  image: Pick<NativeImage, "getScaleFactors">,
  pixelWidth: number,
): number {
  if (!(pixelWidth > 0) || !Number.isFinite(pixelWidth)) return 0;
  return Math.max(
    1,
    Math.round(pixelWidth / nativeImagePixelScaleFactor(image)),
  );
}

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
  timeoutMs = CAPTURE_TIMEOUT_MS,
): Promise<NativeImage | null> {
  if (contents.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (image: NativeImage | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!contents.isDestroyed())
        contents.removeListener("destroyed", onDestroyed);
      resolve(image && !image.isEmpty() ? image : null);
    };
    const onDestroyed = (): void => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    contents.once("destroyed", onDestroyed);
    let capture: Promise<NativeImage>;
    try {
      capture = rect
        ? contents.capturePage(rect, options)
        : contents.capturePage(undefined, options);
    } catch {
      finish(null);
      return;
    }
    capture.then(finish, () => finish(null));
  });
}
