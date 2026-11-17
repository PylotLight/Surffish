import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  pageIsExpanded,
  VIEWPORT_COVER_MARGIN,
  videoCoversViewport,
  type VideoRect,
} from "./page-fullscreen";

const vp = { width: 1280, height: 800 };
const margin = VIEWPORT_COVER_MARGIN;

test("a small embedded video does not count as expanded", () => {
  const video: VideoRect = { x: 40, y: 60, width: 320, height: 180 };
  assert.equal(pageIsExpanded(false, [video], vp, margin), false);
});

test("a full-width-but-short embedded video does not count as expanded", () => {
  // Wide (touches left and near-right) but short: not covering the viewport's height.
  const video: VideoRect = { x: 0, y: 600, width: 1280, height: 160 };
  assert.equal(pageIsExpanded(false, [video], vp, margin), false);
});

test("a video covering the whole viewport counts as expanded", () => {
  // Fills the viewport within the margin on every edge.
  const video: VideoRect = { x: 0, y: 0, width: 1280, height: 800 };
  assert.equal(pageIsExpanded(false, [video], vp, margin), true);
});

test("a video covering the viewport with an inward offset within the margin still counts", () => {
  const video: VideoRect = { x: 10, y: 10, width: 1260, height: 780 };
  assert.equal(videoCoversViewport(video, vp, margin), true);
});

test("a video offset beyond the margin on any edge does not count", () => {
  // Pushed down past the margin: top edge is more than `margin` from the viewport top.
  const video: VideoRect = { x: 0, y: 40, width: 1280, height: 780 };
  assert.equal(videoCoversViewport(video, vp, margin), false);
});

test("the fullscreen API being active counts as expanded regardless of video size", () => {
  const tiny: VideoRect = { x: 40, y: 60, width: 200, height: 120 };
  assert.equal(pageIsExpanded(true, [tiny], vp, margin), true);
});

test("a viewport wider than tall (portrait) can still be covered", () => {
  const portrait = { width: 500, height: 900 };
  const video: VideoRect = { x: 0, y: 0, width: 500, height: 900 };
  assert.equal(pageIsExpanded(false, [video], portrait, margin), true);
});

test("a zero-size viewport is never expanded", () => {
  const zero = { width: 0, height: 0 };
  const video: VideoRect = { x: 0, y: 0, width: 1280, height: 800 };
  assert.equal(pageIsExpanded(false, [video], zero, margin), false);
});

test("no videos and no fullscreen element is not expanded", () => {
  assert.equal(pageIsExpanded(false, [], vp, margin), false);
});
