import type { MiniRect } from "./mini-window";

/**
 * Moving tabs into, out of, between and within mini windows (pure rules; main/mini-window.ts and
 * main/browser.ts do the moving, always by moving the live view so no page reloads).
 *
 * - A strip chip dragged along its own strip reorders (an insertion caret shows where it lands).
 * - Let go over another mini window: it joins that collection at the chip slot under the pointer.
 * - Let go over a browser window: it goes back to that window, before the sidebar row under the
 *   pointer (else where it came from when that is the window, else at the end).
 * - Let go anywhere else: it splits off into a window of its own under the pointer.
 * - Esc while dragging cancels; nothing moves.
 * - A sidebar tab let go over a mini window joins it at the chip slot under the pointer.
 */

export interface Point {
  x: number;
  y: number;
}

/** One strip chip, in the header view's coordinates (left edge and width). */
export interface MiniStripChip {
  left: number;
  width: number;
}

/**
 * Where a tab dropped at `x` (the header's coordinates) goes among `chips`: the index of the chip it
 * goes before, `chips.length` for the end. Past the middle of a chip counts as after it.
 */
export function miniStripInsertIndex(
  x: number,
  chips: readonly MiniStripChip[],
): number {
  for (const [index, chip] of chips.entries()) {
    if (x < chip.left + chip.width / 2) return index;
  }
  return chips.length;
}

/**
 * Index `tabId` ends up at after a drop before slot `slot` of the strip it is already in (`ids` the
 * strip as it is). Dropping on either side of itself leaves it where it is.
 */
export function miniReorderTarget(
  ids: readonly string[],
  tabId: string,
  slot: number,
): number {
  const from = ids.indexOf(tabId);
  if (from < 0) return -1;
  const clamped = Math.max(0, Math.min(ids.length, slot));
  return clamped > from ? clamped - 1 : clamped;
}

/** `ids` with `tabId` moved to `to` (unchanged when it isn't there). */
export function moveTabId(
  ids: readonly string[],
  tabId: string,
  to: number,
): string[] {
  const from = ids.indexOf(tabId);
  if (from < 0) return ids.slice();
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, tabId);
  return next;
}

/** A keyboard move (⌥⇧← / ⌥⇧→, palette): the index one step along, clamped; -1 when it can't move. */
export function miniStepTarget(
  ids: readonly string[],
  tabId: string,
  step: -1 | 1,
): number {
  const from = ids.indexOf(tabId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return -1;
  return to;
}

function inside(point: Point, rect: MiniRect): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

export interface MiniDropMini<T> {
  mini: T;
  bounds: MiniRect;
}
export interface MiniDropBrowser<W> {
  window: W;
  bounds: MiniRect;
}

export type MiniChipDrop<T, W> =
  | { kind: "reorder" }
  | { kind: "merge"; into: T }
  | { kind: "return"; into: W }
  | { kind: "split" }
  | { kind: "none" };

/**
 * A chip of a collection (`own`, the window plus its floating header; `ownStrip` the strip on screen)
 * let go at `point`. Mini windows float above everything, so they win over the browser windows
 * under them; inside its own window off the strip means nothing; a collection's last tab never
 * splits (it is already a window of its own).
 */
export function resolveMiniChipDrop<T, W>(
  point: Point,
  input: {
    own: MiniRect;
    ownStrip: MiniRect | null;
    tabCount: number;
    minis: ReadonlyArray<MiniDropMini<T>>;
    browsers: ReadonlyArray<MiniDropBrowser<W>>;
  },
): MiniChipDrop<T, W> {
  if (input.ownStrip && inside(point, input.ownStrip))
    return { kind: "reorder" };
  const into = input.minis.find((other) => inside(point, other.bounds));
  if (into) return { kind: "merge", into: into.mini };
  if (inside(point, input.own)) return { kind: "none" };
  const browser = input.browsers.find((candidate) =>
    inside(point, candidate.bounds),
  );
  if (browser) return { kind: "return", into: browser.window };
  return input.tabCount < 2 ? { kind: "none" } : { kind: "split" };
}

/** Where a tab sat in the window it popped out of: the tabs on either side (null at an end). */
export interface MiniTabOrigin {
  prevId: string | null;
  nextId: string | null;
}

export function miniTabOrigin(
  ids: readonly string[],
  tabId: string,
): MiniTabOrigin | null {
  const at = ids.indexOf(tabId);
  if (at < 0) return null;
  return { prevId: ids[at - 1] ?? null, nextId: ids[at + 1] ?? null };
}

/**
 * The tab to put a returning tab before so it lands back where it was (`ids`: the home window's
 * tabs now): before its old right neighbour, else after its old left one, else at the end (null).
 * Neighbours that left or moved apart: the right one wins when it is still right after the left
 * one, and whichever is still there otherwise.
 */
export function miniReturnBeforeId(
  origin: MiniTabOrigin | null | undefined,
  ids: readonly string[],
): string | null {
  if (!origin) return null;
  const next =
    origin.nextId && ids.includes(origin.nextId) ? origin.nextId : null;
  const prevAt = origin.prevId ? ids.indexOf(origin.prevId) : -1;
  if (next) return next;
  if (prevAt >= 0) return ids[prevAt + 1] ?? null;
  return null;
}

/** A sidebar row under a drop point, and which half of it (lower half: after it). */
export interface SidebarRowHit {
  id: string;
  after: boolean;
}

/** The tab to insert before for a drop on `hit` (`ids` the window's tabs in order; null = the end). */
export function sidebarDropBeforeId(
  hit: SidebarRowHit | null,
  ids: readonly string[],
  movingId: string,
): string | null {
  if (!hit || hit.id === movingId) return null;
  if (!hit.after) return hit.id;
  const at = ids.indexOf(hit.id);
  if (at < 0) return null;
  const rest = ids.slice(at + 1).filter((id) => id !== movingId);
  return rest[0] ?? null;
}
