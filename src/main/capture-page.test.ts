import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { NativeImage, WebContents } from "electron";
import {
  capturePageWithin,
  nativeImagePixelScaleFactor,
  nativeImagePixelSize,
  nativeImagePixelWidthToDip,
} from "./capture-page";

function fakeImage(empty = false): NativeImage {
  return { isEmpty: () => empty } as unknown as NativeImage;
}

function fakeContents(
  capture: () => Promise<NativeImage>,
): WebContents & { destroy(): void } {
  const emitter = new EventEmitter() as EventEmitter & { destroyed?: boolean };
  return Object.assign(emitter, {
    isDestroyed: () => emitter.destroyed === true,
    capturePage: capture,
    destroy: () => {
      emitter.destroyed = true;
      emitter.emit("destroyed");
    },
  }) as unknown as WebContents & { destroy(): void };
}

describe("captured image dimensions", () => {
  const image = (
    factors: number[],
    sizes: Record<number, { width: number; height: number }>,
  ): NativeImage =>
    ({
      getScaleFactors: () => factors,
      getSize: (scale = 1) => sizes[scale] ?? sizes[1],
    }) as unknown as NativeImage;

  test("uses the highest representation for physical pixels and converts resize widths to DIPs", () => {
    const retina = image([1, 2], {
      1: { width: 800, height: 600 },
      2: { width: 1600, height: 1200 },
    });
    expect(nativeImagePixelScaleFactor(retina)).toBe(2);
    expect(nativeImagePixelSize(retina)).toEqual({ width: 1600, height: 1200 });
    expect(nativeImagePixelWidthToDip(retina, 420)).toBe(210);
  });

  test("supports fractional scale factors and falls back safely when absent", () => {
    const fractional = image([1.25], {
      1.25: { width: 1250, height: 750 },
    });
    expect(nativeImagePixelScaleFactor(fractional)).toBe(1.25);
    expect(nativeImagePixelSize(fractional)).toEqual({
      width: 1250,
      height: 750,
    });
    expect(nativeImagePixelWidthToDip(fractional, 420)).toBe(336);

    const unscaled = image([], { 1: { width: 100, height: 50 } });
    expect(nativeImagePixelScaleFactor(unscaled)).toBe(1);
    expect(nativeImagePixelWidthToDip(unscaled, 420)).toBe(420);
    expect(nativeImagePixelWidthToDip(unscaled, Number.NaN)).toBe(0);
  });
});

describe("capturePageWithin", () => {
  test("resolves with the image", async () => {
    const image = fakeImage();
    expect(await capturePageWithin(fakeContents(async () => image))).toBe(
      image,
    );
  });

  test("empty or failed captures are null", async () => {
    expect(
      await capturePageWithin(fakeContents(async () => fakeImage(true))),
    ).toBeNull();
    expect(
      await capturePageWithin(
        fakeContents(async () => {
          throw new Error("navigating");
        }),
      ),
    ).toBeNull();
    expect(
      await capturePageWithin(
        fakeContents(() => {
          throw new Error("sync");
        }),
      ),
    ).toBeNull();
  });

  test("a capture that never settles (detached view) times out to null", async () => {
    const started = Date.now();
    expect(
      await capturePageWithin(
        fakeContents(() => new Promise(() => {})),
        undefined,
        undefined,
        30,
      ),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("destroyed mid-capture settles at once; destroyed before is null without capturing", async () => {
    const contents = fakeContents(() => new Promise(() => {}));
    const pending = capturePageWithin(contents, undefined, undefined, 60_000);
    contents.destroy();
    expect(await pending).toBeNull();
    let called = false;
    const gone = fakeContents(async () => {
      called = true;
      return fakeImage();
    });
    gone.destroy();
    expect(await capturePageWithin(gone)).toBeNull();
    expect(called).toBe(false);
  });
});
