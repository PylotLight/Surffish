/**
 * Pure helpers for the channel between Surffish and a Chrome Web Store extension's service worker
 * (main/extension-bridge.ts). Two transports exist:
 *  - 'worker': Electron's service-worker preload (session.registerPreloadScript type
 *    'service-worker', Electron 35+) gives the worker a direct IPC channel. No extra renderer.
 *  - 'page': the older hidden per-extension bridge page, which relays over runtime messaging.
 *    Kept as the fallback: Chromium only runs service-worker preloads with the renderer sandbox on,
 *    extensions without a service worker have nothing to preload into, and a worker that never
 *    answers (preload did not apply) falls back after a timeout.
 */

export type ExtensionBridgeTransport = "worker" | "page";

export interface TransportInput {
  /** The extension's manifest has background.service_worker. */
  hasServiceWorker: boolean;
  /** The service-worker preload is registered on the session (sandbox on, Electron supports it). */
  workerPreloadActive: boolean;
  /** SURFFISH_EXTENSION_BRIDGE=page (or the worker transport already failed for this extension). */
  forcePage: boolean;
}

export function chooseBridgeTransport(
  input: TransportInput,
): ExtensionBridgeTransport {
  if (input.forcePage || !input.hasServiceWorker || !input.workerPreloadActive)
    return "page";
  return "worker";
}

/** SURFFISH_EXTENSION_BRIDGE: 'page' forces the bridge page; anything else (or unset) prefers the worker. */
export function bridgeTransportOverride(
  value: string | undefined,
): ExtensionBridgeTransport | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "page") return "page";
  if (normalized === "worker") return "worker";
  return null;
}

/** Chromium skips service-worker preloads when the renderer sandbox is off. */
export function sandboxDisabled(
  switches: { hasSwitch(name: string): boolean },
  env: Record<string, string | undefined>,
): boolean {
  return (
    switches.hasSwitch("no-sandbox") || Boolean(env.ELECTRON_DISABLE_SANDBOX)
  );
}

/** How long a worker gets to answer Surffish's init before the extension falls back to the bridge page. */
export const WORKER_READY_TIMEOUT_MS = 10_000;
export const MAX_QUEUED_WORKER_EVENTS = 200;

export interface WorkerEvent {
  type: "event";
  name: string;
  details: Record<string, unknown>;
}

/**
 * Outgoing webNavigation events for one extension's worker. Before the worker has said which events
 * it listens to, everything is queued (bounded). Afterwards an event nobody listens to is dropped,
 * so a stopped worker is only woken (as Chrome does) for events it registered a listener for.
 */
export class WorkerEventQueue {
  private queue: WorkerEvent[] = [];
  private listening: Set<string> | null = null;
  dropped = 0;

  constructor(private readonly limit = MAX_QUEUED_WORKER_EVENTS) {}

  /** The worker reported its listeners (on every start: listeners are registered again each run). */
  setListening(names: readonly string[]): void {
    this.listening = new Set(names);
    this.queue = this.queue.filter((event) => this.listening!.has(event.name));
  }

  addListening(name: string): void {
    if (!this.listening) this.listening = new Set();
    this.listening.add(name);
  }

  knowsListeners(): boolean {
    return this.listening !== null;
  }

  wants(name: string): boolean {
    return this.listening === null || this.listening.has(name);
  }

  /** Queue an event the worker cannot take right now. Returns whether it was kept. */
  push(event: WorkerEvent): boolean {
    if (!this.wants(event.name)) return false;
    if (this.queue.length >= this.limit) {
      this.dropped += 1;
      return false;
    }
    this.queue.push(event);
    return true;
  }

  drain(): WorkerEvent[] {
    return this.queue.splice(0);
  }

  get size(): number {
    return this.queue.length;
  }
}
