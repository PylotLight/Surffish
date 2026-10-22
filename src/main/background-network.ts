/**
 * Gate for network work main does on its own (page watchers, Reader view images): return a reason
 * to block it, or null to allow. Set by the proxy kill switch, like the update checker's guard. A
 * blocked request is skipped and retried later; it never falls back to a direct connection.
 */
type BackgroundNetworkGuard = () => string | null;

let guard: BackgroundNetworkGuard = () => null;

export function setBackgroundNetworkGuard(next: BackgroundNetworkGuard): void {
  guard = next;
}

export function backgroundNetworkBlockedReason(): string | null {
  try {
    return guard();
  } catch {
    return "The network is unavailable.";
  }
}
