import test from "node:test";
import assert from "node:assert/strict";
import {
  getQuickLinkBackgroundIndex,
  newTabBackgroundIndexOnOpen,
  nextQuickLinkBackgroundIndex,
  OFFLINE_NEW_TAB_BACKGROUNDS,
  QUICK_LINK_BACKGROUND_ROTATION_MS,
  withOfflinePhotoFallbacks,
} from "./quick-links-backgrounds.ts";

test("rotates one locally bundled background every fifteen-minute slot and wraps", () => {
  const rotation = QUICK_LINK_BACKGROUND_ROTATION_MS;
  assert.equal(getQuickLinkBackgroundIndex(0, 4), 0);
  assert.equal(getQuickLinkBackgroundIndex(rotation - 1, 4), 0);
  assert.equal(getQuickLinkBackgroundIndex(rotation, 4), 1);
  assert.equal(getQuickLinkBackgroundIndex(rotation * 3, 4), 3);
  assert.equal(getQuickLinkBackgroundIndex(rotation * 4, 4), 0);
});

test("manual next-background navigation wraps and normalizes its index", () => {
  assert.equal(nextQuickLinkBackgroundIndex(0, 4), 1);
  assert.equal(nextQuickLinkBackgroundIndex(3, 4), 0);
  assert.equal(nextQuickLinkBackgroundIndex(-1, 4), 0);
  assert.equal(nextQuickLinkBackgroundIndex(Number.NaN, 4), 1);
});

test("invalid time or image counts safely select the first background", () => {
  assert.equal(getQuickLinkBackgroundIndex(Number.NaN, 4), 0);
  assert.equal(getQuickLinkBackgroundIndex(0, 0), 0);
  assert.equal(getQuickLinkBackgroundIndex(0, -1), 0);
  assert.equal(nextQuickLinkBackgroundIndex(0, 0), 0);
});

test("the offline photos top up the cached ones to two, cached first, never twice", () => {
  const offline = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(
    withOfflinePhotoFallbacks([], offline).map((p) => p.id),
    ["a", "b"],
  );
  assert.deepEqual(
    withOfflinePhotoFallbacks([{ id: "x" }], offline).map((p) => p.id),
    ["x", "a"],
  );
  assert.deepEqual(
    withOfflinePhotoFallbacks(
      [{ id: "x" }, { id: "y" }, { id: "z" }],
      offline,
    ).map((p) => p.id),
    ["x", "y"],
  );
  assert.deepEqual(
    withOfflinePhotoFallbacks([{ id: "b" }], offline).map((p) => p.id),
    ["b", "a"],
  );
  assert.equal(OFFLINE_NEW_TAB_BACKGROUNDS.length, 2);
});

test("a New Tab opens on the newest cached photo, else the offline photo of its slot", () => {
  const offlineIds = OFFLINE_NEW_TAB_BACKGROUNDS.map((p) => p.id);
  const offline: Array<{ id: string }> = OFFLINE_NEW_TAB_BACKGROUNDS.map(
    ({ id }) => ({ id }),
  );
  assert.equal(
    newTabBackgroundIndexOnOpen(
      QUICK_LINK_BACKGROUND_ROTATION_MS * 5,
      withOfflinePhotoFallbacks([{ id: "x" }], offline),
      offlineIds,
    ),
    0,
  );
  assert.equal(
    newTabBackgroundIndexOnOpen(
      0,
      withOfflinePhotoFallbacks([], offline),
      offlineIds,
    ),
    0,
  );
  assert.equal(
    newTabBackgroundIndexOnOpen(
      QUICK_LINK_BACKGROUND_ROTATION_MS,
      withOfflinePhotoFallbacks([], offline),
      offlineIds,
    ),
    1,
  );
  assert.equal(newTabBackgroundIndexOnOpen(0, [], offlineIds), 0);
});
