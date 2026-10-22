import { describe, expect, test } from "bun:test";
import {
  afterStartupHold,
  holdPageRequestsUntil,
  isHeldRequest,
} from "./request-gate";

const page = { url: "https://example.com/", webContentsId: 3 };

describe("start-up request hold", () => {
  test("page requests wait until the start-up work finishes, then run in order", async () => {
    let finish: () => void = () => {};
    const released = holdPageRequestsUntil(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
      5_000,
    );
    const ran: string[] = [];
    afterStartupHold(page, () => ran.push("page 1"));
    afterStartupHold({ ...page, url: "https://example.com/ad.js" }, () =>
      ran.push("page 2"),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ran).toEqual([]);
    finish();
    await released;
    await Promise.resolve();
    expect(ran).toEqual(["page 1", "page 2"]);
    // Lifted for good: later requests run immediately.
    afterStartupHold(page, () => ran.push("later"));
    expect(ran.at(-1)).toBe("later");
  });

  test("requests without a page, and extension/local resources, never wait", async () => {
    let finish: () => void = () => {};
    const released = holdPageRequestsUntil(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
      5_000,
    );
    expect(isHeldRequest(page)).toBe(true);
    // Session.fetch (filter lists, favicons, extension downloads) has no web contents.
    expect(
      isHeldRequest({
        url: "https://easylist.to/list.txt",
        webContentsId: undefined,
      }),
    ).toBe(false);
    expect(
      isHeldRequest({ url: "https://example.com/", webContentsId: -1 }),
    ).toBe(false);
    expect(
      isHeldRequest({
        url: "chrome-extension://abc/popup.js",
        webContentsId: 4,
      }),
    ).toBe(false);
    expect(isHeldRequest({ url: "data:text/plain,x", webContentsId: 4 })).toBe(
      false,
    );
    const ran: string[] = [];
    afterStartupHold(
      { url: "https://easylist.to/list.txt", webContentsId: undefined },
      () => ran.push("fetch"),
    );
    expect(ran).toEqual(["fetch"]);
    finish();
    await released;
    expect(isHeldRequest(page)).toBe(false);
  });

  test("a stuck start-up lets requests through after the timeout; a failed one releases at once", async () => {
    const stuck = holdPageRequestsUntil(new Promise<void>(() => {}), 20);
    const ran: string[] = [];
    afterStartupHold(page, () => ran.push("page"));
    await stuck;
    await Promise.resolve();
    expect(ran).toEqual(["page"]);
    await holdPageRequestsUntil(
      Promise.reject(new Error("engine failed")),
      5_000,
    );
    expect(isHeldRequest(page)).toBe(false);
  });
});
