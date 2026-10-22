/**
 * Crash / hang bookkeeping for the main process (pure, so it is unit-testable).
 *
 * - `StabilityCounters`: what went wrong this session (main-process errors, renderer and child
 *   process deaths, hangs, recoveries). Read by smokes and the perf bench through
 *   `globalThis.__surffishStability`, and printed once at quit when anything happened.
 * - `LogThrottle`: the same error repeating (a timer throwing every frame) is logged a few times,
 *   then every Nth time, so a loop can't flood the log or the terminal.
 * - `RecoveryBudget`: how often a dead app surface may be reloaded before we stop (crash on load).
 */

export interface StabilityCounters {
  /** Main process: exceptions nothing caught (the app keeps running; Electron would show a modal dialog). */
  uncaughtExceptions: number;
  /** Main process: promise rejections nothing handled. */
  unhandledRejections: number;
  /** Main process: an ipcMain.on listener threw or rejected (bad or missing input from a renderer). */
  ipcListenerErrors: number;
  /** Site tab renderers that died (crash, OOM, killed). Clean exits are not counted. */
  tabRendererGone: number;
  /** The app's own surfaces (toolbar, sidebar, content) whose renderer died. */
  shellRendererGone: number;
  /** Shell surfaces reloaded after their renderer died. */
  shellReloads: number;
  /** Any other webContents (overlays, extension pages, glance, popups) whose renderer died. */
  otherRendererGone: number;
  /** GPU process deaths (Chromium relaunches it; we repaint every surface). */
  gpuGone: number;
  /** Utility / other child process deaths (network service, audio, storage …). */
  childGone: number;
  /** `unresponsive` events (hung renderers) on any webContents. */
  unresponsive: number;
  /** Last few one-line summaries, newest last. */
  recent: string[];
}

export const STABILITY_RECENT_LIMIT = 20;

export function emptyStabilityCounters(): StabilityCounters {
  return {
    uncaughtExceptions: 0,
    unhandledRejections: 0,
    ipcListenerErrors: 0,
    tabRendererGone: 0,
    shellRendererGone: 0,
    shellReloads: 0,
    otherRendererGone: 0,
    gpuGone: 0,
    childGone: 0,
    unresponsive: 0,
    recent: [],
  };
}

type CounterKey = Exclude<keyof StabilityCounters, "recent">;

export function countStabilityEvent(
  counters: StabilityCounters,
  key: CounterKey,
  summary: string | null,
  now = Date.now(),
): void {
  counters[key] += 1;
  if (summary === null) return;
  counters.recent.push(
    `${new Date(now).toISOString()} ${key}: ${summary.slice(0, 300)}`,
  );
  if (counters.recent.length > STABILITY_RECENT_LIMIT)
    counters.recent.splice(0, counters.recent.length - STABILITY_RECENT_LIMIT);
}

/** Total of the "something died or threw" counters (recoveries and hang prompts excluded). */
export function stabilityFailureTotal(counters: StabilityCounters): number {
  return (
    counters.uncaughtExceptions +
    counters.unhandledRejections +
    counters.ipcListenerErrors +
    counters.tabRendererGone +
    counters.shellRendererGone +
    counters.otherRendererGone +
    counters.gpuGone +
    counters.childGone
  );
}

/** Log the first `head` occurrences of a signature, then every `every`th one. */
export class LogThrottle {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly head = 5,
    private readonly every = 100,
    private readonly maxSignatures = 200,
  ) {}

  /** Returns the occurrence number when this one should be logged, else 0. */
  shouldLog(signature: string): number {
    const count = (this.seen.get(signature) ?? 0) + 1;
    if (!this.seen.has(signature) && this.seen.size >= this.maxSignatures) {
      // Unbounded distinct messages: forget the oldest signature rather than grow forever.
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(signature, count);
    return count <= this.head || count % this.every === 0 ? count : 0;
  }
}

/** First line of an error's message (or the value), for de-duplicating repeated failures. */
export function errorSignature(error: unknown): string {
  if (error instanceof Error)
    return `${error.name}: ${error.message.split("\n")[0] ?? ""}`.slice(0, 200);
  try {
    return String(error).split("\n")[0]!.slice(0, 200);
  } catch {
    return "unprintable value";
  }
}

/** An extension's bridge page is reloaded after a crash at most this many times per window. */
export const BRIDGE_RELOAD_LIMIT = 3;
export const BRIDGE_RELOAD_WINDOW_MS = 60_000;

/** At most `limit` attempts inside `windowMs`; older attempts age out. */
export class RecoveryBudget {
  private attempts: number[] = [];

  constructor(
    private readonly limit = 3,
    private readonly windowMs = 60_000,
  ) {}

  tryTake(now = Date.now()): boolean {
    this.attempts = this.attempts.filter(
      (time) => now - time < this.windowMs && time <= now,
    );
    if (this.attempts.length >= this.limit) return false;
    this.attempts.push(now);
    return true;
  }
}
