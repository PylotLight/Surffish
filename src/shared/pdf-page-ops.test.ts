import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import {
  applyPageOps,
  checkPageOp,
  normalizeRotation,
  PageOpError,
  pageOrderAfter,
  type PageOp,
} from "./pdf-page-ops.ts";

// Each generated page has a distinct width (100, 110, 120, ...) so tests can tell pages apart.
async function generatedPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([100 + index * 10, 200]);
    page.drawText(`Page ${index + 1}`, { x: 10, y: 100, size: 12, font });
  }
  return document.save();
}

async function pageWidths(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => Math.round(page.getWidth()));
}

async function pageRotations(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getRotation().angle);
}

test("page order follows deletes and moves in sequence", () => {
  assert.deepEqual(pageOrderAfter(4, []), [0, 1, 2, 3]);
  assert.deepEqual(
    pageOrderAfter(4, [{ type: "move", from: 3, to: 0 }]),
    [3, 0, 1, 2],
  );
  assert.deepEqual(
    pageOrderAfter(4, [
      { type: "delete", page: 1 },
      { type: "move", from: 0, to: 2 },
    ]),
    [2, 3, 0],
  );
  assert.deepEqual(
    pageOrderAfter(3, [{ type: "rotate", page: 1, by: 90 }]),
    [0, 1, 2],
  );
});

test("invalid page ops are rejected before touching the document", () => {
  assert.equal(
    checkPageOp({ type: "delete", page: 0 }, 1),
    "A PDF needs at least one page.",
  );
  assert.equal(
    checkPageOp({ type: "delete", page: 3 }, 3),
    "That page does not exist.",
  );
  assert.equal(
    checkPageOp({ type: "move", from: 0, to: -1 }, 3),
    "That page does not exist.",
  );
  assert.equal(
    checkPageOp({ type: "rotate", page: 0, by: 45 as 90 }, 3),
    "Pages rotate in quarter turns.",
  );
  assert.equal(
    checkPageOp({ type: "rotate", page: 0.5, by: 90 }, 3),
    "That page does not exist.",
  );
  assert.throws(
    () =>
      pageOrderAfter(2, [
        { type: "delete", page: 0 },
        { type: "delete", page: 0 },
      ]),
    PageOpError,
  );
});

test("rotation normalises to quarter turns", () => {
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(360), 0);
});

test("applyPageOps rotates, deletes and reorders a generated PDF", async () => {
  const source = await generatedPdf(4);
  const ops: PageOp[] = [
    { type: "rotate", page: 0, by: 90 },
    { type: "rotate", page: 0, by: 270 },
    { type: "rotate", page: 2, by: 180 },
    { type: "delete", page: 1 },
    { type: "move", from: 2, to: 0 },
  ];
  const result = await applyPageOps(source, ops);
  // Original widths 100,110,120,130 → delete 110 → [100,120,130] → move last first → [130,100,120].
  assert.deepEqual(await pageWidths(result), [130, 100, 120]);
  assert.deepEqual(await pageRotations(result), [0, 0, 180]);
  assert.deepEqual(
    pageOrderAfter(4, ops).map((index) => 100 + index * 10),
    [130, 100, 120],
  );
});

test("applyPageOps keeps page annotations with their page", async () => {
  const document = await PDFDocument.create();
  document.addPage([100, 200]);
  const annotated = document.addPage([110, 200]);
  const annotation = document.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [10, 10, 30, 30],
    Contents: "note",
  });
  annotated.node.set(
    PDFName.of("Annots"),
    document.context.obj([document.context.register(annotation)]),
  );
  const result = await applyPageOps(await document.save(), [
    { type: "move", from: 1, to: 0 },
  ]);
  const reloaded = await PDFDocument.load(result);
  const first = reloaded.getPage(0);
  assert.equal(Math.round(first.getWidth()), 110);
  assert.equal(first.node.Annots()?.size(), 1);
  assert.equal(reloaded.getPage(1).node.Annots(), undefined);
});

test("applyPageOps returns the input untouched when there is nothing to do", async () => {
  const source = await generatedPdf(1);
  assert.equal(await applyPageOps(source, []), source);
});

test("applyPageOps refuses bytes that are not a PDF", async () => {
  await assert.rejects(
    applyPageOps(new TextEncoder().encode("<html>login</html>"), [
      { type: "rotate", page: 0, by: 90 },
    ]),
    PageOpError,
  );
});
