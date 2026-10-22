import { expect, test } from "bun:test";
import {
  bridgeTransportOverride,
  chooseBridgeTransport,
  sandboxDisabled,
  WorkerEventQueue,
} from "./extension-worker-bridge";

test("worker transport only with a service worker, an active preload and no override", () => {
  expect(
    chooseBridgeTransport({
      hasServiceWorker: true,
      workerPreloadActive: true,
      forcePage: false,
    }),
  ).toBe("worker");
  expect(
    chooseBridgeTransport({
      hasServiceWorker: false,
      workerPreloadActive: true,
      forcePage: false,
    }),
  ).toBe("page");
  expect(
    chooseBridgeTransport({
      hasServiceWorker: true,
      workerPreloadActive: false,
      forcePage: false,
    }),
  ).toBe("page");
  expect(
    chooseBridgeTransport({
      hasServiceWorker: true,
      workerPreloadActive: true,
      forcePage: true,
    }),
  ).toBe("page");
});

test("SURFFISH_EXTENSION_BRIDGE override", () => {
  expect(bridgeTransportOverride("page")).toBe("page");
  expect(bridgeTransportOverride(" Worker ")).toBe("worker");
  expect(bridgeTransportOverride("")).toBeNull();
  expect(bridgeTransportOverride(undefined)).toBeNull();
  expect(bridgeTransportOverride("bogus")).toBeNull();
});

test("sandbox off disables the worker preload", () => {
  const switches = (names: string[]) => ({
    hasSwitch: (name: string) => names.includes(name),
  });
  expect(sandboxDisabled(switches([]), {})).toBe(false);
  expect(sandboxDisabled(switches(["no-sandbox"]), {})).toBe(true);
  expect(sandboxDisabled(switches([]), { ELECTRON_DISABLE_SANDBOX: "1" })).toBe(
    true,
  );
});

test("queue keeps everything until listeners are known, then only listened events", () => {
  const queue = new WorkerEventQueue(3);
  const event = (name: string) => ({
    type: "event" as const,
    name,
    details: {},
  });
  expect(queue.push(event("onCommitted"))).toBe(true);
  expect(queue.push(event("onCompleted"))).toBe(true);
  queue.setListening(["onCommitted"]);
  expect(queue.size).toBe(1);
  expect(queue.push(event("onCompleted"))).toBe(false);
  expect(queue.wants("onCompleted")).toBe(false);
  queue.addListening("onCompleted");
  expect(queue.push(event("onCompleted"))).toBe(true);
  expect(queue.push(event("onCommitted"))).toBe(true);
  expect(queue.push(event("onCommitted"))).toBe(false);
  expect(queue.dropped).toBe(1);
  expect(queue.drain().map((entry) => entry.name)).toEqual([
    "onCommitted",
    "onCompleted",
    "onCommitted",
  ]);
  expect(queue.size).toBe(0);
});
