import { degrees, PDFDocument } from "pdf-lib";

// Page tools for the PDF editor. Each op uses 0-based page indexes in the document as it is when
// the op runs, so a list of ops is replayed in order (what the user saw is what gets saved).

export type PageRotation = 90 | 180 | 270;
export type PageOp =
  | { type: "rotate"; page: number; by: PageRotation }
  | { type: "delete"; page: number }
  | { type: "move"; from: number; to: number };

export class PageOpError extends Error {}

function isIndex(value: unknown, count: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < count
  );
}

/** Validate one op against a page count. Deleting the last remaining page is refused. */
export function checkPageOp(op: PageOp, pageCount: number): string | null {
  switch (op.type) {
    case "rotate":
      if (!isIndex(op.page, pageCount)) return "That page does not exist.";
      return op.by === 90 || op.by === 180 || op.by === 270
        ? null
        : "Pages rotate in quarter turns.";
    case "delete":
      if (!isIndex(op.page, pageCount)) return "That page does not exist.";
      return pageCount > 1 ? null : "A PDF needs at least one page.";
    case "move":
      return isIndex(op.from, pageCount) && isIndex(op.to, pageCount)
        ? null
        : "That page does not exist.";
    default:
      return "Unknown page action.";
  }
}

/**
 * What the ops do to page order, as original page indexes: [2, 0, 1] means the first page is the
 * original third page. Lets the UI and tests reason about ops without touching a PDF.
 */
export function pageOrderAfter(
  pageCount: number,
  ops: readonly PageOp[],
): number[] {
  const order = Array.from({ length: pageCount }, (_value, index) => index);
  for (const op of ops) {
    const problem = checkPageOp(op, order.length);
    if (problem) throw new PageOpError(problem);
    if (op.type === "delete") order.splice(op.page, 1);
    else if (op.type === "move" && op.from !== op.to) {
      const [page] = order.splice(op.from, 1);
      order.splice(op.to, 0, page!);
    }
  }
  return order;
}

/** Normalise a rotation in degrees to 0, 90, 180 or 270. */
export function normalizeRotation(angle: number): number {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

/**
 * Apply page ops with pdf-lib and return the new file. `bytes` should already contain the
 * annotation/form edits (pdf.js saveDocument()); pdf-lib keeps each page's annotations with it.
 */
export async function applyPageOps(
  bytes: Uint8Array,
  ops: readonly PageOp[],
): Promise<Uint8Array> {
  if (ops.length === 0) return bytes;
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PageOpError(
      /encrypt/i.test(message)
        ? "This PDF is encrypted, so its pages cannot be changed."
        : "Could not read this PDF to change its pages.",
    );
  }
  // pdf-lib's getPage()/getPages() cache is not invalidated by removePage(), so keep our own
  // mirror of the page list and only use the page tree (removePage/insertPage) for mutation.
  // getPages() hands back the cache array itself: copy it, and pin pageCount before mutating.
  document.getPageCount();
  const pages = [...document.getPages()];
  for (const op of ops) {
    const problem = checkPageOp(op, pages.length);
    if (problem) throw new PageOpError(problem);
    if (op.type === "rotate") {
      const page = pages[op.page]!;
      page.setRotation(
        degrees(normalizeRotation(page.getRotation().angle + op.by)),
      );
    } else if (op.type === "delete") {
      document.removePage(op.page);
      pages.splice(op.page, 1);
    } else if (op.from !== op.to) {
      const [page] = pages.splice(op.from, 1);
      document.removePage(op.from);
      document.insertPage(op.to, page!);
      pages.splice(op.to, 0, page!);
    }
  }
  return document.save({ updateFieldAppearances: false });
}
