/**
 * Sync-ready identifiers and clocks, shared by the desktop store and (later) the phone app.
 *
 * - `uuidv7()`: stable row ids. Time-ordered, so new rows land at the end of SQLite's b-tree
 *   instead of at random pages, and two devices can mint ids without talking to each other.
 * - `HybridLogicalClock`: a per-device clock whose stamps sort the same way on every device even
 *   when wall clocks disagree a little. Every write to a synced row carries one (`hlc` column),
 *   and last-writer-wins merges compare them as plain strings.
 *
 * Stamp format: `<wall ms, 13 digits>:<counter, 4 hex>:<device id>`, e.g.
 * `1760400000000:0000:0192c3f0-…`. Fixed-width parts make string order equal clock order.
 */

const HEX = "0123456789abcdef";

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** RFC 9562 UUID version 7 (48-bit ms timestamp + random). */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ms = Math.max(0, Math.floor(now));
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let out = "";
  bytes.forEach((byte, index) => {
    if (index === 4 || index === 6 || index === 8 || index === 10) out += "-";
    out += HEX[byte >> 4]! + HEX[byte & 15]!;
  });
  return out;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export interface HlcParts {
  wall: number;
  counter: number;
  deviceId: string;
}

const MAX_COUNTER = 0xffff;
/** A remote stamp further ahead than this is treated as a broken clock and not followed. */
export const MAX_CLOCK_DRIFT_MS = 24 * 60 * 60 * 1000;

export function formatHlc(parts: HlcParts): string {
  return `${String(Math.max(0, Math.floor(parts.wall))).padStart(13, "0")}:${parts.counter.toString(16).padStart(4, "0")}:${parts.deviceId}`;
}

export function parseHlc(value: unknown): HlcParts | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{13}):([0-9a-f]{4}):(.+)$/.exec(value);
  if (!match) return null;
  return {
    wall: Number(match[1]),
    counter: Number.parseInt(match[2]!, 16),
    deviceId: match[3]!,
  };
}

/** -1 / 0 / 1. Stamps are fixed width, so string comparison is clock comparison. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HybridLogicalClock {
  private wall = 0;
  private counter = 0;

  constructor(
    readonly deviceId: string,
    private readonly now: () => number = Date.now,
    last?: string | null,
  ) {
    const parsed = parseHlc(last);
    if (parsed) {
      this.wall = parsed.wall;
      this.counter = parsed.counter;
    }
  }

  /** A fresh stamp for a local write; always greater than every stamp this clock issued or saw. */
  tick(): string {
    const physical = this.now();
    if (physical > this.wall) {
      this.wall = physical;
      this.counter = 0;
    } else if (this.counter < MAX_COUNTER) {
      this.counter += 1;
    } else {
      // Counter exhausted inside one millisecond: borrow the next millisecond.
      this.wall += 1;
      this.counter = 0;
    }
    return formatHlc({
      wall: this.wall,
      counter: this.counter,
      deviceId: this.deviceId,
    });
  }

  /**
   * Fold in a stamp received from another device so later local writes sort after it.
   * Returns false (and ignores it) when the remote wall clock is implausibly far ahead.
   */
  receive(remote: string): boolean {
    const parsed = parseHlc(remote);
    if (!parsed) return false;
    const physical = this.now();
    if (parsed.wall - physical > MAX_CLOCK_DRIFT_MS) return false;
    if (parsed.wall > this.wall) {
      this.wall = parsed.wall;
      this.counter = parsed.counter;
    } else if (parsed.wall === this.wall && parsed.counter > this.counter) {
      this.counter = parsed.counter;
    }
    return true;
  }

  /** The newest stamp issued or received, for persisting across restarts. */
  last(): string {
    return formatHlc({
      wall: this.wall,
      counter: this.counter,
      deviceId: this.deviceId,
    });
  }
}
