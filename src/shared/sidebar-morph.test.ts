import { describe, expect, test } from "bun:test";
import {
  planSidebarMorph,
  type MarkRect,
  type MorphTarget,
  MORPH_LABEL_DELAY_MS,
  MORPH_LABEL_MS,
  MORPH_FADE_MS,
  MORPH_PAINT_MS,
  MORPH_ROOM_FALLBACK_MS,
} from "./sidebar-morph";
import { isPinMotionKey } from "./rail-pin-cluster";
import { SIDEBAR_MOTION_MS } from "./sidebar-motion";

const rect = (x: number, y: number, width = 22, height = 22): MarkRect => ({
  x,
  y,
  width,
  height,
});
const element = (): HTMLElement => ({}) as HTMLElement; // the plan only reads numbers; stubs stand in for the DOM
const target = (
  key: string | null,
  rect: MarkRect | null,
  labels: HTMLElement[] = [],
): MorphTarget => ({ element: element(), key, rect, labels });

describe("planSidebarMorph", () => {
  test("a mark whose destination matches its origin settles in place", () => {
    const plan = planSidebarMorph(
      { "tab:a": rect(20, 100) },
      [target("tab:a", rect(20, 100), [element()])],
      { edgeFrom: 84, widening: true },
    );
    expect(plan.flights).toEqual([]);
    expect(plan.settled).toHaveLength(1);
    expect(plan.labels).toHaveLength(1);
    expect(plan.durationMs).toBeGreaterThanOrEqual(
      MORPH_LABEL_MS + MORPH_LABEL_DELAY_MS,
    );
  });

  test("a moved mark gets a centre-to-centre flight", () => {
    const plan = planSidebarMorph(
      { "tab:a": rect(20, 100) },
      [target("tab:a", rect(30, 150))],
      { edgeFrom: 84, widening: true },
    );
    expect(plan.flights).toHaveLength(1);
    // Centres: (20+11)-(30+11) = -10 horizontally; (100+11)-(150+11) = -50 vertically.
    expect(plan.flights[0]!.dx).toBeCloseTo(-10);
    expect(plan.flights[0]!.dy).toBeCloseTo(-50);
    expect(plan.flights[0]!.trailing).toBe(false);
  });

  test("a mark landing past the old shape's edge while it widens trails", () => {
    // The old shape's right edge is 84 (the collapsed rail); the mark lands at 200.
    const plan = planSidebarMorph(
      { "tab:a": rect(20, 100) },
      [target("tab:a", rect(190, 100))],
      { edgeFrom: 84, widening: true },
    );
    expect(plan.flights[0]!.trailing).toBe(true);
    expect(plan.flights[0]!.roomRight).toBe(212);
  });

  test("a mark landing inside the old shape's extent never trails", () => {
    const plan = planSidebarMorph(
      { "tab:a": rect(200, 100) },
      [target("tab:a", rect(20, 100))], // collapsing: landing well left of the old edge
      { edgeFrom: 320, widening: false },
    );
    expect(plan.flights[0]!.trailing).toBe(false);
  });

  test("unkeyed and unmeasured counterparts are left alone", () => {
    const plan = planSidebarMorph(
      { "tab:a": rect(20, 100) },
      [
        target(null, rect(30, 100)),
        target("tab:gone", null),
        target("tab:a", rect(20, 100)),
      ],
      { edgeFrom: 84, widening: true },
    );
    expect(plan.flights).toEqual([]);
    expect(plan.settled).toHaveLength(1);
  });

  test("the plan's duration covers the longest beat, at least the exit fade", () => {
    const moving = planSidebarMorph(
      { "tab:a": rect(20, 100) },
      [target("tab:a", rect(190, 100))], // trailing
      { edgeFrom: 84, widening: true },
    );
    expect(moving.durationMs).toBeGreaterThanOrEqual(SIDEBAR_MOTION_MS);
    const settled = planSidebarMorph(
      { "tab:a": rect(20, 100) },
      [target("tab:a", rect(20, 100))],
      { edgeFrom: 84, widening: true },
    );
    expect(settled.durationMs).toBeGreaterThanOrEqual(MORPH_FADE_MS);
  });
  test("hold shows every counterpart in place, however far it measured from it", () => {
    const plan = planSidebarMorph(
      { "tab:a": rect(60, 100), "tab:b": rect(8, 160) },
      [target("tab:a", rect(20, 100)), target("tab:b", rect(20, 150))],
      { edgeFrom: 84, widening: false, hold: true },
    );
    expect(plan.flights).toHaveLength(0);
    expect(plan.settled).toHaveLength(2);
  });

  test("under hold, pins glide between their cluster and row slots while tabs stand", () => {
    // Expand: the rail cluster's slots (12px apart on the row's line) spread to the panel's row
    // (80px pitch); the first pin is already on its row slot.
    const step = 12;
    const pitch = 80;
    const marks = {
      "pin:a": rect(30, 14, 24, 24),
      "pin:b": rect(30 + step, 14, 24, 24),
      "site:https://c/": rect(30 + step * 2, 14, 24, 24),
      "tab:x": rect(33, 80),
    };
    const plan = planSidebarMorph(
      marks,
      [
        target("pin:a", rect(30, 14, 24, 24)),
        target("pin:b", rect(30 + pitch, 14, 24, 24)),
        target("site:https://c/", rect(30 + pitch * 2, 14, 24, 24)),
        target("site:https://hidden/", rect(30 + pitch * 3, 14, 24, 24)),
        target("tab:x", rect(40, 90)),
      ],
      {
        edgeFrom: 84,
        widening: true,
        hold: true,
        glide: isPinMotionKey,
      },
    );
    // Only the pins that moved fly, horizontally only, and never wait for room: they ride the
    // card's own curve and duration.
    expect(plan.flights.map((flight) => [flight.dx, flight.dy])).toEqual([
      [step - pitch, 0],
      [step * 2 - pitch * 2, 0],
    ]);
    expect(plan.flights.every((flight) => !flight.trailing)).toBe(true);
    // The first pin and the held tab settle; the pin behind "+N" has no counterpart (it fades).
    expect(plan.settled).toHaveLength(2);
    expect(plan.durationMs).toBeLessThanOrEqual(
      SIDEBAR_MOTION_MS + MORPH_ROOM_FALLBACK_MS,
    );
  });

  test("collapse reverses the glide: row slots gather back into the cluster", () => {
    const plan = planSidebarMorph(
      { "pin:a": rect(30, 14, 24, 24), "pin:b": rect(110, 14, 24, 24) },
      [
        target("pin:a", rect(30, 14, 24, 24)),
        target("pin:b", rect(42, 14, 24, 24)),
      ],
      { edgeFrom: 320, widening: false, hold: true, glide: isPinMotionKey },
    );
    expect(plan.flights.map((flight) => [flight.dx, flight.dy])).toEqual([
      [68, 0],
    ]);
  });

  test("without glide (reduced motion), pins hold like everything else", () => {
    const plan = planSidebarMorph(
      { "pin:b": rect(42, 14, 24, 24) },
      [target("pin:b", rect(110, 14, 24, 24))],
      { edgeFrom: 84, widening: true, hold: true },
    );
    expect(plan.flights).toEqual([]);
  });

  test("flights travel in whole pixels", () => {
    const plan = planSidebarMorph(
      { "tab:a": rect(20.4, 100.6) },
      [target("tab:a", rect(30, 150.2))],
      { edgeFrom: 84, widening: true },
    );
    expect(Number.isInteger(plan.flights[0]!.dx)).toBe(true);
    expect(Number.isInteger(plan.flights[0]!.dy)).toBe(true);
    expect(plan.flights[0]!.dx).toBe(-10);
    expect(plan.flights[0]!.dy).toBe(-50);
  });

  test("a sub-pixel difference settles instead of flying", () => {
    const plan = planSidebarMorph(
      { "tab:a": rect(20.3, 100.2) },
      [target("tab:a", rect(20, 100))],
      { edgeFrom: 84, widening: true },
    );
    expect(plan.flights).toEqual([]);
    expect(plan.settled).toHaveLength(1);
  });

  test("fades are long enough to read as fades at 30fps, and the exit is the shorter", () => {
    const frame = 1000 / 30;
    expect(MORPH_LABEL_MS).toBeGreaterThanOrEqual(220);
    expect(MORPH_LABEL_MS).toBeLessThanOrEqual(280);
    expect(MORPH_FADE_MS).toBeGreaterThanOrEqual(150);
    expect(MORPH_FADE_MS).toBeLessThanOrEqual(200);
    expect(MORPH_FADE_MS).toBeLessThan(MORPH_LABEL_MS);
    expect(MORPH_LABEL_MS / frame).toBeGreaterThanOrEqual(6);
    expect(MORPH_PAINT_MS / frame).toBeGreaterThanOrEqual(6);
  });
});
