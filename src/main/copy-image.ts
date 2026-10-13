import { clipboard, ClipboardItem, nativeImage, type WebContents } from 'electron'

/** What the page has under the pointer: the image's src and whether that <img> is the topmost hit. */
interface ImageHit { src: string; topmost: boolean }

// Runs in an isolated world so page scripts can't spoof or observe it. Looks through the whole
// hit stack, since sites often lay a transparent div over their images (Instagram, Pinterest…).
const IMAGE_HIT_SCRIPT = (x: number, y: number): string => `(() => {
  const stack = document.elementsFromPoint(${x}, ${y});
  const img = stack.find((el) => el instanceof HTMLImageElement && (el.currentSrc || el.src));
  if (!img) return null;
  const top = stack[0];
  return { src: img.currentSrc || img.src, topmost: top === img || (top instanceof Element && top.closest('picture') === img.parentElement) };
})()`

const ISOLATED_WORLD_ID = 1999

export function isCopyImageClick(event: Electron.MouseInputEvent): boolean {
  if (event.type !== 'mouseDown' || event.button !== 'left' || (event.clickCount ?? 1) !== 1) return false
  const modifiers = new Set(event.modifiers ?? [])
  return modifiers.has('alt') && !modifiers.has('meta') && !modifiers.has('control') && !modifiers.has('shift')
}

async function imageFromSrc(contents: WebContents, src: string): Promise<Electron.NativeImage | null> {
  if (src.startsWith('data:')) {
    const image = nativeImage.createFromDataURL(src)
    return image.isEmpty() ? null : image
  }
  if (!/^https?:\/\//i.test(src)) return null
  // Same session as the tab: proxy, cookies and ad blocking all apply.
  const response = await contents.session.fetch(src, { headers: { Referer: contents.getURL() } })
  if (!response.ok) return null
  const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()))
  return image.isEmpty() ? null : image
}

/**
 * Option/Alt+click: copy the image under the pointer. `x`/`y` are view coordinates (DIP), as the
 * mouse and context-menu events give them. Resolves to whether something landed on the clipboard.
 */
export async function copyImageAtPoint(contents: WebContents, x: number, y: number): Promise<boolean> {
  if (contents.isDestroyed()) return false
  const zoom = contents.getZoomFactor() || 1
  const [result] = await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
    { code: IMAGE_HIT_SCRIPT(Math.round(x / zoom), Math.round(y / zoom)) }
  ]).then((value) => [value as ImageHit | null]).catch(() => [null])
  if (!result || contents.isDestroyed()) return false
  if (result.topmost) {
    // Chromium copies the decoded bitmap it already has, so blob: images and any format work.
    contents.copyImageAt(Math.round(x), Math.round(y))
    return true
  }
  try {
    const image = await imageFromSrc(contents, result.src)
    if (!image) return false
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
    return true
  } catch {
    return false
  }
}
