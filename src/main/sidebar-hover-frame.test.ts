import { expect, test } from "bun:test";
import type { Rectangle, View, WebContentsView } from "electron";
import { SIDEBAR_MOTION_MS } from "../shared/sidebar-motion";
import { applyPageViewFrame } from "./page-view-frame";
import { applySidebarBackdropFrame } from "./sidebar-native-frame";
import {
  SidebarOverlayMotion,
  type SidebarMotionFrame,
} from "./sidebar-motion";

test("page corner radius is configured before the page bounds move", () => {
  const calls: string[] = [];
  const view = {
    setBorderRadius: (_radius: number) => calls.push("radius"),
    setBounds: (_bounds: Rectangle) => calls.push("bounds"),
  } as unknown as View;

  applyPageViewFrame(view, { x: 10, y: 20, width: 500, height: 400 }, 10);
  expect(calls).toEqual(["radius", "bounds"]);

  calls.length = 0;
  applyPageViewFrame(view, { x: 40, y: 20, width: 500, height: 400 }, 10);
  expect(calls).toEqual(["bounds"]);

  calls.length = 0;
  applyPageViewFrame(view, { x: 40, y: 20, width: 500, height: 400 }, 0);
  expect(calls).toEqual(["radius", "bounds"]);
});

test("floating native backdrop radius is configured before its moving bounds", () => {
  const calls: { type: string; value: unknown }[] = [];
  const view = {
    setBorderRadius: (radius: number) =>
      calls.push({ type: "radius", value: radius }),
    setBounds: (bounds: Rectangle) =>
      calls.push({ type: "bounds", value: bounds }),
  } as unknown as Pick<View, "setBorderRadius" | "setBounds">;

  const result = applySidebarBackdropFrame(
    view,
    { x: 0, y: 24, width: 320, height: 600 },
    true,
  );
  expect(calls).toEqual([
    { type: "radius", value: 12 },
    { type: "bounds", value: { x: 6, y: 30, width: 314, height: 588 } },
  ]);
  expect(result).toEqual({ x: 6, y: 30, width: 314, height: 588 });

  calls.length = 0;
  applySidebarBackdropFrame(
    view,
    { x: 0, y: 24, width: 90, height: 600 },
    true,
  );
  expect(calls[0]).toEqual({ type: "radius", value: 12 });
  expect(calls[1]?.type).toBe("bounds");
});

test("the sidebar backing layer is prepared before its first visible frame", () => {
  const calls: { type: string; frame?: SidebarMotionFrame }[] = [];
  let visible = false;
  const view = {
    getVisible: () => visible,
    setVisible: (next: boolean) => {
      visible = next;
      calls.push({ type: "visible" });
    },
    setBounds: (frame: SidebarMotionFrame) => {
      calls.push({ type: "bounds", frame });
    },
  } as unknown as WebContentsView;
  const motion = new SidebarOverlayMotion(view, {
    onProgress: (_progress, frame) => calls.push({ type: "backdrop", frame }),
  });

  motion.layout({ y: 24, width: 320, height: 600, railWidth: 84 });
  calls.length = 0;
  motion.setOpen(true, { animate: false, rail: true });

  expect(calls.map((call) => call.type)).toEqual([
    "backdrop",
    "bounds",
    "visible",
  ]);
  expect(calls[0]?.frame).toEqual({ x: 0, y: 24, width: 320, height: 600 });
  motion.dispose();
});

test("native mode stays frame-synchronized when page and backdrop hooks are present", async () => {
  const calls: {
    type: string;
    frame?: SidebarMotionFrame;
    progress?: number;
    animation?: unknown;
  }[] = [];
  let visible = false;
  const view = {
    getVisible: () => visible,
    setVisible: (next: boolean) => {
      visible = next;
      calls.push({ type: "visible" });
    },
    setBounds: (frame: SidebarMotionFrame, animation?: unknown) =>
      calls.push({ type: "bounds", frame, animation }),
  } as unknown as WebContentsView;
  const motion = new SidebarOverlayMotion(
    view,
    {
      onProgress: (progress, frame) =>
        calls.push({ type: "backdrop", progress, frame }),
    },
    "native",
  );

  motion.layout({ y: 24, width: 320, height: 600, railWidth: 84 });
  calls.length = 0;
  motion.setOpen(true, { rail: true });
  await new Promise((resolve) => setTimeout(resolve, SIDEBAR_MOTION_MS + 40));
  motion.dispose();

  const boundsCalls = calls.filter((call) => call.type === "bounds");
  expect(boundsCalls.length).toBeGreaterThan(3);
  for (const boundsCall of boundsCalls) {
    const index = calls.indexOf(boundsCall);
    expect(calls[index - 1]?.type).toBe("backdrop");
    expect(calls[index - 1]?.frame).toEqual(boundsCall.frame);
    expect(boundsCall.animation).toBeUndefined();
  }
  expect(
    calls.filter((call) => call.type === "backdrop").at(-1)?.progress,
  ).toBe(1);
  expect(visible).toBe(true);
});
