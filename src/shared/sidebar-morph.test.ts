import { describe, expect, test } from "bun:test";
import {
  planSidebarMorph,
  type MarkRect,
  type MorphTarget,
  MORPH_LABEL_DELAY_MS,
  MORPH_LABEL_MS,
  MORPH_FADE_MS,
} from "./sidebar-morph";
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
});
