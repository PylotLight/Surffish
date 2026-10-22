/**
 * Speculative preconnect ("Preload pages for faster browsing", Settings → General → Tabs, on by
 * default). While the user types in the address bar, and when the pointer rests on a link, main
 * opens one socket (DNS + TCP + TLS) to the likely destination's origin in the active tab's own
 * session, so its proxy, per-site route and Space partition all apply. Nothing is fetched: only
 * the origin is ever used, so a search query never leaves the device as a URL, and each origin is
 * preconnected at most once per cooldown per session.
 *
 * Pure rules live here; main/preconnect.ts does the Electron work.
 */

export interface PreconnectSettings {
  enabled: boolean;
}

export const DEFAULT_PRECONNECT_SETTINGS: PreconnectSettings = {
  enabled: true,
};

export function parsePreconnectSettings(value: unknown): PreconnectSettings {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : DEFAULT_PRECONNECT_SETTINGS.enabled,
  };
}

/** Quiet time after the last keystroke before the address bar asks for a preconnect. */
export const TYPING_DEBOUNCE_MS = 150;
/** How long the pointer must rest on a link before its origin is preconnected. */
export const HOVER_DWELL_MS = 200;
/** The same origin (in the same session) is preconnected at most once per this long. */
export const ORIGIN_COOLDOWN_MS = 10_000;
/** Typed text shorter than this never preconnects (one letter matches too much to be a guess). */
export const MIN_TYPED_CHARS = 2;
/** Bounds the limiter's memory; the oldest entries go first. */
export const MAX_TRACKED_ORIGINS = 256;

/** The origin to preconnect for a URL: http(s) only, no credentials, no opaque or local schemes. */
export function preconnectOrigin(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192)
    return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.origin;
}

/** Whether typed address-bar text is worth a guess at all. */
export function typedInputQualifies(input: string): boolean {
  return input.trim().length >= MIN_TYPED_CHARS;
}

/**
 * What the address bar guesses Enter will open: the top suggestion when there is one, otherwise
 * the resolved typed text (a URL, or the search engine's query URL, of which only the engine's
 * origin is ever used).
 */
export function typedPreconnectUrl(
  input: string,
  topSuggestionUrl: string | null | undefined,
  resolve: (text: string) => string | null,
): string | null {
  if (!typedInputQualifies(input)) return null;
  const suggestion = preconnectOrigin(topSuggestionUrl ?? null);
  if (suggestion) return suggestion;
  return preconnectOrigin(resolve(input.trim()));
}

/**
 * At most one preconnect per (session key, origin) per cooldown. Keys are partition names, so a
 * Space or the private session never shares a cooldown with the profile session.
 */
export class PreconnectLimiter {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly cooldownMs = ORIGIN_COOLDOWN_MS,
    private readonly maxEntries = MAX_TRACKED_ORIGINS,
    private readonly now: () => number = Date.now,
  ) {}

  /** True (and the origin is stamped) when this origin may be preconnected now. */
  take(sessionKey: string, origin: string): boolean {
    const key = `${sessionKey}\n${origin}`;
    const at = this.now();
    const previous = this.last.get(key);
    if (previous !== undefined && at - previous < this.cooldownMs) return false;
    this.last.delete(key);
    this.last.set(key, at);
    while (this.last.size > this.maxEntries) {
      const oldest = this.last.keys().next().value;
      if (oldest === undefined) break;
      this.last.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.last.clear();
  }

  get size(): number {
    return this.last.size;
  }
}

export interface DebounceTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const DEFAULT_TIMERS: DebounceTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Trailing-edge debounce: `push` restarts the wait; only the last value pushed is delivered once
 * things go quiet for `delayMs`. Used for typing (150 ms) and link hover dwell (200 ms).
 */
export class Debouncer<T> {
  private handle: unknown = null;
  private pending: { value: T } | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly deliver: (value: T) => void,
    private readonly timers: DebounceTimers = DEFAULT_TIMERS,
  ) {}

  push(value: T): void {
    this.cancel();
    this.pending = { value };
    this.handle = this.timers.set(() => {
      const pending = this.pending;
      this.handle = null;
      this.pending = null;
      if (pending) this.deliver(pending.value);
    }, this.delayMs);
  }

  cancel(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
    this.pending = null;
  }

  get waiting(): boolean {
    return this.pending !== null;
  }
}
