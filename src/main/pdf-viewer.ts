import type { WebContents, WebFrameMain } from "electron";

/**
 * Chromium's built-in PDF viewer (a component extension Electron ships). A tab showing a PDF keeps
 * the document's own http(s)/file URL in its main frame; the viewer UI runs in an out-of-process
 * child frame from this origin. Ad blocking already leaves chrome-extension:// requests alone, and
 * the ad-filter frame preload only runs in http(s) frames, so the viewer is never filtered.
 */
export const PDF_VIEWER_EXTENSION_ID = "mhjfbmdgcfjbbpaeojofohoefgiehjai";
const PDF_VIEWER_ORIGIN = `chrome-extension://${PDF_VIEWER_EXTENSION_ID}/`;

/** The viewer's own frame inside a PDF tab (also used by Read Aloud to find the page it's on). */
export function pdfViewerFrame(contents: WebContents): WebFrameMain | null {
  if (contents.isDestroyed()) return null;
  try {
    return (
      contents.mainFrame.frames.find(
        (frame) => !frame.detached && frame.url.startsWith(PDF_VIEWER_ORIGIN),
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** True when the tab's top-level document is a PDF rendered by the built-in viewer. */
export function isShowingPdf(contents: WebContents): boolean {
  return pdfViewerFrame(contents) !== null;
}

/**
 * webContents.print()/printToPDF() render the embedder document (printToPDF comes out blank in
 * testing), so print through the viewer's own toolbar button, which hands the PDF to Chromium's
 * print path. Falls back to a plain print when the viewer isn't reachable.
 */
export async function printPdf(contents: WebContents): Promise<void> {
  const frame = pdfViewerFrame(contents);
  if (frame) {
    const clicked: unknown = await frame
      .executeJavaScript(
        `(() => {
      const toolbar = document.querySelector('pdf-viewer')?.shadowRoot?.querySelector('viewer-toolbar')
      const button = toolbar?.shadowRoot?.querySelector('#print')
      if (!button) return false
      button.click()
      return true
    })()`,
        true,
      )
      .catch(() => false);
    if (clicked === true) return;
  }
  if (!contents.isDestroyed()) contents.print();
}
