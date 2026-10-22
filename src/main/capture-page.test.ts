import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { NativeImage, WebContents } from "electron";
import { capturePageWithin } from "./capture-page";

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
