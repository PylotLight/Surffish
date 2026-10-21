import type { WebContents, WebFrameMain } from 'electron'

/**
 * Chromium's built-in PDF viewer (a component extension Electron ships). A tab showing a PDF keeps
 * the document's own http(s)/file URL in its main frame; the viewer UI runs in an out-of-process
 * child frame from this origin. Ad blocking already leaves chrome-extension:// requests alone, and
 * the ad-filter frame preload only runs in http(s) frames, so the viewer is never filtered.
 */
export const PDF_VIEWER_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai'
const PDF_VIEWER_ORIGIN = `chrome-extension://${PDF_VIEWER_EXTENSION_ID}/`

function pdfViewerFrame(contents: WebContents): WebFrameMain | null {
  if (contents.isDestroyed()) return null
  try {
    return contents.mainFrame.frames.find((frame) => !frame.detached && frame.url.startsWith(PDF_VIEWER_ORIGIN)) ?? null
  } catch {
    return null
  }
}

/** True when the tab's top-level document is a PDF rendered by the built-in viewer. */
export function isShowingPdf(contents: WebContents): boolean {
  return pdfViewerFrame(contents) !== null
}

/**
 * webContents.print()/printToPDF() render the embedder document (printToPDF comes out blank in
 * testing), so print through the viewer's own toolbar button, which hands the PDF to Chromium's
 * print path. Falls back to a plain print when the viewer isn't reachable.
 */
export async function printPdf(contents: WebContents): Promise<void> {
  const frame = pdfViewerFrame(contents)
  if (frame) {
    const clicked: unknown = await frame.executeJavaScript(`(() => {
      const toolbar = document.querySelector('pdf-viewer')?.shadowRoot?.querySelector('viewer-toolbar')
      const button = toolbar?.shadowRoot?.querySelector('#print')
      if (!button) return false
      button.click()
      return true
    })()`, true).catch(() => false)
    if (clicked === true) return
  }
  if (!contents.isDestroyed()) contents.print()
}

/**
 * The page the built-in viewer is on (1-based), from its toolbar's page box (inside nested shadow
 * roots), else a #page=N in the URL. Null when neither is there.
 */
export async function pdfViewerPage(contents: WebContents): Promise<number | null> {
  const frame = pdfViewerFrame(contents)
  if (frame) {
    const value: unknown = await frame.executeJavaScript(`(() => {
      const find = (root, selector, depth = 0) => {
        if (!root || depth > 6) return null
        const hit = root.querySelector(selector)
        if (hit) return hit
        for (const element of root.querySelectorAll('*')) {
          if (element.shadowRoot) {
            const inner = find(element.shadowRoot, selector, depth + 1)
            if (inner) return inner
          }
        }
        return null
      }
      const selector = find(document, 'viewer-page-selector')
      const input = selector?.shadowRoot?.querySelector('input') ?? null
      const page = Number(input?.value)
      return Number.isInteger(page) && page > 0 ? page : null
    })()`, true).catch(() => null)
    if (typeof value === 'number') return value
  }
  try {
    const match = /[#&]page=(\d+)/i.exec(new URL(contents.getURL()).hash)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}
