/**
 * Wake snapshots: when a sleeping or discarded tab (timed sleep, memory saver, Hibernate Tab) is
 * opened again, the last picture of it shows at once while the real page reloads underneath, then
 * cross-fades out when the page's first contentful paint lands. The picture is taken when the tab
 * leaves the screen (a hidden, detached page can't be captured), kept in memory, capped in total
 * size, and dropped once used or when its tab closes. Non-private tabs' snapshots are also saved
 * in the profile (shared/wake-snapshot-disk.ts) so a restored session's tabs have one after a
 * restart; private ones never leave memory. Input is never swallowed: a press or scroll on the picture removes it and goes to
 * the page.
 *
 * Pure rules live here; main/wake-snapshot.ts does the capture and the presentation.
 */

/**
 * Snapshots keep the capture's own device pixels (capturePage returns the page area at the
 * display's scale, 2x on Retina) so text stays readable while the page reloads; only a capture
 * wider than this (a 5K/6K display) is scaled down. The overview thumbnail is made separately.
 */
export const WAKE_SNAPSHOT_MAX_WIDTH = 3840;
/** JPEG quality: 80 at device pixels keeps small grey text crisp (60 and a 1280 px cap blurred it). */
export const WAKE_SNAPSHOT_JPEG_QUALITY = 80;
/** Every snapshot together never holds more than this (least recently taken go first). */
export const WAKE_SNAPSHOT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
/** A single snapshot over this is not worth keeping (a huge, noisy page). */
export const WAKE_SNAPSHOT_MAX_BYTES = 3 * 1024 * 1024;
/** Cross-fade length once the page has painted. */
export const WAKE_SNAPSHOT_FADE_MS = 180;
/** The picture never stays longer than this, painted or not. */
export const WAKE_SNAPSHOT_MAX_SHOW_MS = 8000;
/** Fallback when no contentful paint is reported (a blank or image-only page): fade this long after the load finishes. */
export const WAKE_SNAPSHOT_LOAD_GRACE_MS = 150;
/** A snapshot whose page area differs from today's by more than this (width or height ratio) would look wrong. */
export const WAKE_SNAPSHOT_SIZE_TOLERANCE = 0.25;

export interface WakeSnapshotSize {
  width: number;
  height: number;
}

/**
 * Byte-capped, least-recently-stored map of snapshots by tab id. Generic so the rules can be
 * tested without images.
 */
export class WakeSnapshotStore<T extends { bytes: number }> {
  private readonly entries = new Map<string, T>();
  private total = 0;

  constructor(
    private readonly maxTotalBytes = WAKE_SNAPSHOT_MAX_TOTAL_BYTES,
    private readonly maxEntryBytes = WAKE_SNAPSHOT_MAX_BYTES,
  ) {}

  /** Store (replacing any older one for the tab). False when the entry alone is over the per-snapshot cap. */
  set(id: string, entry: T): boolean {
    this.delete(id);
    if (
      !(entry.bytes > 0) ||
      entry.bytes > this.maxEntryBytes ||
      entry.bytes > this.maxTotalBytes
    )
      return false;
    this.entries.set(id, entry);
    this.total += entry.bytes;
    while (this.total > this.maxTotalBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    return true;
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Remove and return (a snapshot is shown once). */
  take(id: string): T | undefined {
    const entry = this.entries.get(id);
    if (entry) this.delete(id);
    return entry;
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.total -= entry.bytes;
  }

  /** Drop every snapshot the predicate matches (e.g. all private ones); returns how many went. */
  deleteWhere(predicate: (entry: T, id: string) => boolean): number {
    let removed = 0;
    for (const [id, entry] of [...this.entries]) {
      if (predicate(entry, id)) {
        this.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  get totalBytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }
}

/** The width a snapshot is stored at: the capture's own width, never more than the cap. */
export function wakeSnapshotWidth(
  capturedWidth: number,
  maxWidth = WAKE_SNAPSHOT_MAX_WIDTH,
): number {
  if (!(capturedWidth > 0)) return 0;
  return Math.max(1, Math.min(Math.round(capturedWidth), maxWidth));
}

/** Whether a snapshot taken at `taken` (page-area size) still fits the page area it would cover now. */
export function wakeSnapshotFits(
  taken: WakeSnapshotSize,
  now: WakeSnapshotSize,
  tolerance = WAKE_SNAPSHOT_SIZE_TOLERANCE,
): boolean {
  if (!(taken.width > 0 && taken.height > 0 && now.width > 0 && now.height > 0))
    return false;
  const ratio = (a: number, b: number): number =>
    Math.max(a, b) / Math.min(a, b) - 1;
  return (
    ratio(taken.width, now.width) <= tolerance &&
    ratio(taken.height, now.height) <= tolerance
  );
}

/** The page a snapshot shows is the one about to load (fragments aside). */
export function wakeSnapshotMatchesUrl(
  snapshotUrl: string,
  targetUrl: string,
): boolean {
  const strip = (value: string): string | null => {
    try {
      const url = new URL(value);
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  };
  const a = strip(snapshotUrl);
  return a !== null && a === strip(targetUrl);
}

/**
 * The back/forward list a tab goes to sleep with, for waking it with navigationHistory.restore
 * (scroll position and form values ride in each entry's page state): only when its active entry
 * is the page the tab will wake to, else null (wake falls back to loading the URL).
 */
export function restorableSleepHistory<T extends { url: string }>(
  entries: readonly T[],
  index: number,
  url: string,
): { entries: T[]; index: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= entries.length)
    return null;
  if (!url || entries[index]?.url !== url) return null;
  return { entries: [...entries], index };
}

export type WakeSnapshotPhase = "showing" | "fading" | "gone";

/**
 * What ends a snapshot. `painted`/`loaded`/`timeout` fade it out; anything that means the picture
 * is wrong or in the way (`input`, `failed`, `left` = tab switched/closed/window or layout changed)
 * removes it at once; `faded` is the renderer saying the fade finished.
 */
export type WakeSnapshotEvent =
  "painted" | "loaded" | "timeout" | "input" | "failed" | "left" | "faded";

export function nextWakeSnapshotPhase(
  phase: WakeSnapshotPhase,
  event: WakeSnapshotEvent,
  reducedMotion = false,
): WakeSnapshotPhase {
  if (phase === "gone") return "gone";
  switch (event) {
    case "painted":
    case "loaded":
    case "timeout":
      return phase === "showing" && !reducedMotion ? "fading" : "gone";
    case "faded":
      return phase === "fading" ? "gone" : phase;
    case "input":
    case "failed":
    case "left":
      return "gone";
  }
}

/**
 * A pointer press/scroll on the toolbar surface while it covers the page goes to the page when it
 * didn't land on the toolbar's own UI: the elements hit are only the transparent shell layers (or
 * the snapshot itself).
 */
export const WAKE_SNAPSHOT_PASSTHROUGH_ELEMENTS: ReadonlySet<string> = new Set([
  "HTML",
  "BODY",
]);
export const WAKE_SNAPSHOT_PASSTHROUGH_CLASSES: readonly string[] = [
  "app-shell",
  "browser-layout",
  "browser-main",
  "wake-snapshot",
];
export const WAKE_SNAPSHOT_PASSTHROUGH_IDS: readonly string[] = ["root"];

export function isWakeSnapshotPassthroughTarget(
  element: {
    tagName: string;
    id?: string;
    classList?: { contains: (name: string) => boolean };
  } | null,
): boolean {
  if (!element) return true;
  if (WAKE_SNAPSHOT_PASSTHROUGH_ELEMENTS.has(element.tagName.toUpperCase()))
    return true;
  if (element.id && WAKE_SNAPSHOT_PASSTHROUGH_IDS.includes(element.id))
    return true;
  return WAKE_SNAPSHOT_PASSTHROUGH_CLASSES.some(
    (name) => element.classList?.contains(name) ?? false,
  );
}

/**
 * Input that may change how a page looks, so its last picture (overview thumbnail, wake snapshot)
 * is stale: presses, scrolls, touches and typing. Hover moves don't count, nor do shortcut chords
 * (Ctrl/Cmd held: switching tabs by keyboard must not invalidate the tab being left) or releases.
 */
export function inputMayChangePage(input: {
  type: string;
  modifiers?: readonly string[];
}): boolean {
  const { type } = input;
  if (
    type === "mouseDown" ||
    type === "mouseWheel" ||
    type.startsWith("gesture") ||
    type.startsWith("touch")
  )
    return true;
  if (type !== "rawKeyDown" && type !== "keyDown" && type !== "char")
    return false;
  return !(input.modifiers ?? []).some((modifier) =>
    ["control", "ctrl", "meta", "cmd", "command"].includes(modifier),
  );
}

/** Point inside a rect (window coordinates). */
export function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    x >= rect.x &&
    y >= rect.y &&
    x < rect.x + rect.width &&
    y < rect.y + rect.height
  );
}

/** Channels between main and the toolbar surface. */
export const WAKE_SNAPSHOT_SHOW_CHANNEL = "browser:wake-snapshot:show";
export const WAKE_SNAPSHOT_FADE_CHANNEL = "browser:wake-snapshot:fade";
export const WAKE_SNAPSHOT_HIDE_CHANNEL = "browser:wake-snapshot:hide";
export const WAKE_SNAPSHOT_INPUT_CHANNEL = "browser:wake-snapshot:input";
export const WAKE_SNAPSHOT_FADED_CHANNEL = "browser:wake-snapshot:faded";

export interface WakeSnapshotShowMessage {
  token: number;
  /** data:image/jpeg;base64,… */
  src: string;
  /** Page area in window coordinates (the toolbar surface sits at 0,0). */
  rect: { x: number; y: number; width: number; height: number };
}

export type WakeSnapshotInput =
  | {
      kind: "mouseDown" | "mouseUp" | "mouseMove";
      x: number;
      y: number;
      button: "left" | "middle" | "right";
      clickCount: number;
      modifiers: string[];
    }
  | {
      kind: "mouseWheel";
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
      modifiers: string[];
    }
  | { kind: "key" };

export function parseWakeSnapshotInput(
  value: unknown,
): WakeSnapshotInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const finite = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);
  const modifiers = Array.isArray(record.modifiers)
    ? record.modifiers.filter(
        (m): m is string =>
          typeof m === "string" &&
          ["shift", "control", "alt", "meta"].includes(m),
      )
    : [];
  if (record.kind === "key") return { kind: "key" };
  if (!finite(record.x) || !finite(record.y)) return null;
  if (record.kind === "mouseWheel") {
    if (!finite(record.deltaX) || !finite(record.deltaY)) return null;
    return {
      kind: "mouseWheel",
      x: record.x,
      y: record.y,
      deltaX: record.deltaX,
      deltaY: record.deltaY,
      modifiers,
    };
  }
  if (
    record.kind === "mouseDown" ||
    record.kind === "mouseUp" ||
    record.kind === "mouseMove"
  ) {
    const button =
      record.button === "middle" || record.button === "right"
        ? record.button
        : "left";
    const clickCount = finite(record.clickCount)
      ? Math.max(0, Math.min(3, Math.round(record.clickCount)))
      : 1;
    return {
      kind: record.kind,
      x: record.x,
      y: record.y,
      button,
      clickCount,
      modifiers,
    };
  }
  return null;
}
