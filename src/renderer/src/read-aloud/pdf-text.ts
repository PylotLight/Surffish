// Read Aloud for PDFs, in the hidden engine page: pdf.js (the same pdfjs-dist build the PDF editor
// ships, worker included) reads the text of a PDF main hands over as bytes, and
// shared/read-aloud-pdf.ts turns it into sentences. A lazy chunk of the engine page, loaded on the
// first PDF reading only. Text extraction only: no rendering, no fonts loaded into the page, no
// form scripts, no network (cmaps and standard font data come from the app's own files).
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MAX_READ_ALOUD_CHARS } from "../../../shared/read-aloud-text";
import {
  pdfReadingText,
  pdfTextItem,
  type PdfPageText,
  type PdfReadingText,
  type PdfTextItem,
} from "../../../shared/read-aloud-pdf";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(workerUrl, location.href).href;

/** Pages whose text items add up past this many characters are not read (≈ MAX_READ_ALOUD_CHARS with room for noise). */
const MAX_RAW_CHARS = MAX_READ_ALOUD_CHARS * 1.5;

export interface PdfText extends PdfReadingText {
  title: string;
  pages: number;
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const task = pdfjsLib.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    cMapUrl: new URL("pdfjs/cmaps/", location.href).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("pdfjs/standard_fonts/", location.href).href,
  });
  const document = await task.promise;
  try {
    let title = "";
    try {
      const metadata = await document.getMetadata();
      const info = metadata.info as { Title?: unknown } | undefined;
      title = typeof info?.Title === "string" ? info.Title.trim() : "";
    } catch {
      /* no metadata */
    }
    const pages: PdfPageText[] = [];
    let chars = 0;
    for (
      let number = 1;
      number <= document.numPages && chars < MAX_RAW_CHARS;
      number += 1
    ) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({
        includeMarkedContent: false,
      });
      const items: PdfTextItem[] = [];
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str) continue;
        const item = pdfTextItem(
          raw.str,
          raw.transform as number[],
          viewport.transform,
          raw.width,
        );
        if (!item) continue;
        items.push(item);
        chars += raw.str.length;
      }
      pages.push({ width: viewport.width, height: viewport.height, items });
      page.cleanup();
    }
    return { ...pdfReadingText(pages), title, pages: document.numPages };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
