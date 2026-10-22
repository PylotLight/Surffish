import { describe, expect, test } from "bun:test";
import {
  classifySwipeIntent,
  DEFAULT_SWIPE_INTENT,
  parseSwipeIntentOverride,
  shouldCommitSwipe,
  swipeIntentForRequest,
} from "./swipe-intent";

describe("swipe intent", () => {
  test("a deliberate flick is accepted within the first few events", () => {
    // ~0.25 pt/ms: 4pt, 8pt, 12pt at 16ms intervals.
    expect(classifySwipeIntent({ dx: 4, dy: 0.5, elapsedMs: 16 })).toBe("wait");
    expect(classifySwipeIntent({ dx: 8, dy: 1, elapsedMs: 32 })).toBe("wait");
    expect(classifySwipeIntent({ dx: 12, dy: 1, elapsedMs: 48 })).toBe(
      "accept",
    );
    // Either direction.
    expect(classifySwipeIntent({ dx: -12, dy: -1, elapsedMs: 48 })).toBe(
      "accept",
    );
  });

  test("a single big first event (fast swipe) counts as one frame, not a division by zero", () => {
    expect(classifySwipeIntent({ dx: 14, dy: 0, elapsedMs: 0 })).toBe("accept");
  });

  test("deadzone: tiny sideways movement never starts a swipe", () => {
    expect(classifySwipeIntent({ dx: 3, dy: 0, elapsedMs: 10 })).toBe("wait");
    expect(classifySwipeIntent({ dx: 9.9, dy: 0, elapsedMs: 40 })).toBe("wait");
  });

  test("slow drift waits and then gives up", () => {
    // 12pt over 300ms = 0.04 pt/ms.
    expect(classifySwipeIntent({ dx: 12, dy: 1, elapsedMs: 300 })).toBe("wait");
    expect(classifySwipeIntent({ dx: 18, dy: 1, elapsedMs: 500 })).toBe(
      "refuse",
    );
  });

  test("a slow start that speeds up still gets through", () => {
    expect(classifySwipeIntent({ dx: 10, dy: 0, elapsedMs: 200 })).toBe("wait");
    expect(classifySwipeIntent({ dx: 24, dy: 1, elapsedMs: 260 })).toBe(
      "accept",
    );
  });

  test("mostly vertical scrolls are not swipes", () => {
    // Diagonal wobble: not dominant enough yet.
    expect(classifySwipeIntent({ dx: 12, dy: 8, elapsedMs: 40 })).toBe("wait");
    // Clearly a scroll.
    expect(classifySwipeIntent({ dx: 12, dy: 20, elapsedMs: 40 })).toBe(
      "refuse",
    );
    expect(classifySwipeIntent({ dx: 30, dy: 15, elapsedMs: 60 })).toBe(
      "refuse",
    );
  });

  test("garbage input never accepts", () => {
    expect(classifySwipeIntent({ dx: Number.NaN, dy: 0, elapsedMs: 10 })).toBe(
      "wait",
    );
    expect(
      classifySwipeIntent({
        dx: Number.POSITIVE_INFINITY,
        dy: 0,
        elapsedMs: 10,
      }),
    ).toBe("wait");
  });

  test("commit needs a minimum of travel", () => {
    expect(shouldCommitSwipe(true, 0.5)).toBe(true);
    expect(
      shouldCommitSwipe(true, DEFAULT_SWIPE_INTENT.minCommitProgress),
    ).toBe(true);
    expect(shouldCommitSwipe(true, 0.05)).toBe(false);
    expect(shouldCommitSwipe(false, 1)).toBe(false);
    expect(shouldCommitSwipe(true, Number.NaN)).toBe(false);
  });

  test("override parsing", () => {
    const tuned = parseSwipeIntentOverride(
      "minDistance=6, minRatio=1.5,bogus=3,minVelocity=abc,maxVertical=-1",
    );
    expect(tuned.minDistance).toBe(6);
    expect(tuned.minRatio).toBe(1.5);
    expect(tuned.minVelocity).toBe(DEFAULT_SWIPE_INTENT.minVelocity);
    expect(tuned.maxVertical).toBe(DEFAULT_SWIPE_INTENT.maxVertical);
    expect(parseSwipeIntentOverride(undefined)).toEqual({
      ...DEFAULT_SWIPE_INTENT,
    });
    expect(parseSwipeIntentOverride("minDistance=")).toEqual({
      ...DEFAULT_SWIPE_INTENT,
    });
  });

  test("requests from an older native module (no totals) keep the old behaviour", () => {
    expect(swipeIntentForRequest({})).toBe("accept");
    expect(swipeIntentForRequest({ dx: 3, dy: 0, elapsedMs: 5 })).toBe("wait");
    expect(swipeIntentForRequest({ dx: 12, dy: 0, elapsedMs: 40 })).toBe(
      "accept",
    );
  });
});
