import { describe, expect, test } from "bun:test";
import { retryOnce } from "./retry";

describe("retryOnce", () => {
  test("a first success is returned without retrying", async () => {
    let calls = 0;
    expect(
      await retryOnce(async () => {
        calls += 1;
        return "ok";
      }),
    ).toBe("ok");
    expect(calls).toBe(1);
  });

  test("one failure is retried after the delay", async () => {
    let calls = 0;
    const retried: unknown[] = [];
    const started = Date.now();
    const value = await retryOnce(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("ERR_FAILED (-2)");
        return "second";
      },
      { delayMs: 20, onRetry: (error) => retried.push(error) },
    );
    expect(value).toBe("second");
    expect(calls).toBe(2);
    expect(retried).toHaveLength(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  test("a second failure is thrown; never a third try", async () => {
    let calls = 0;
    await expect(
      retryOnce(async () => {
        calls += 1;
        throw new Error(`fail ${calls}`);
      }),
    ).rejects.toThrow("fail 2");
    expect(calls).toBe(2);
  });

  test("shouldRetry can refuse (e.g. the window closed meanwhile)", async () => {
    let calls = 0;
    let alive = true;
    await expect(
      retryOnce(
        async () => {
          calls += 1;
          alive = false;
          throw new Error("gone");
        },
        { delayMs: 5, shouldRetry: () => alive },
      ),
    ).rejects.toThrow("gone");
    expect(calls).toBe(1);
  });
});
