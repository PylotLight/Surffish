import assert from "node:assert/strict";
import test from "node:test";
import {
  formatZoomPercent,
  isDefaultZoom,
  isPinchZoomed,
  normalizeZoomFactor,
  PINCH_ZOOM_MAX_SCALE,
  stepZoomFactor,
  zoomActionForWheel,
} from "./zoom.ts";

test("zoom steps walk the preset list and stop at the ends", () => {
  assert.equal(stepZoomFactor(1, 1), 1.1);
  assert.equal(stepZoomFactor(1.1, 1), 1.25);
  assert.equal(stepZoomFactor(1, -1), 0.9);
  assert.equal(stepZoomFactor(5, 1), 5);
  assert.equal(stepZoomFactor(0.25, -1), 0.25);
});

test("zoom steps from an in-between factor land on the neighbouring preset", () => {
  assert.equal(stepZoomFactor(1.05, 1), 1.1);
  assert.equal(stepZoomFactor(1.05, -1), 1);
});

test("zoom factors are validated, clamped and formatted", () => {
  assert.equal(normalizeZoomFactor("1.5"), null);
  assert.equal(normalizeZoomFactor(Number.NaN), null);
  assert.equal(normalizeZoomFactor(0), null);
  assert.equal(normalizeZoomFactor(9), 5);
  assert.equal(normalizeZoomFactor(1.333), 1.33);
  assert.equal(isDefaultZoom(1.001), true);
  assert.equal(formatZoomPercent(1.1), "110%");
  assert.equal(formatZoomPercent(0.67), "67%");
});

test("Ctrl+wheel zoom directions map to zoom steps; anything else is ignored", () => {
  assert.equal(zoomActionForWheel("in"), "in");
  assert.equal(zoomActionForWheel("out"), "out");
  assert.equal(zoomActionForWheel("sideways"), null);
  assert.equal(zoomActionForWheel(undefined), null);
});

test("pinch zoom allows magnifying past 1x (Electron defaults the visual zoom limits to 1,1)", () => {
  assert.ok(PINCH_ZOOM_MAX_SCALE > 1);
});

test("only a page actually pinch-zoomed past 1x counts as zoomed", () => {
  assert.equal(isPinchZoomed(1), false);
  assert.equal(isPinchZoomed(1.005), false);
  assert.equal(isPinchZoomed(1.02), true);
  assert.equal(isPinchZoomed(PINCH_ZOOM_MAX_SCALE), true);
  assert.equal(isPinchZoomed(undefined), false);
  assert.equal(isPinchZoomed(Number.NaN), false);
});
