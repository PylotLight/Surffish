// pdfjs-dist's viewer components (web/pdf_viewer.mjs) read the core library from globalThis.pdfjsLib,
// so publish it before that module is evaluated (imported first from main.ts).
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  workerUrl,
  window.location.href,
).href;
(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib;

export { pdfjsLib };
