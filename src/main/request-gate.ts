/**
 * Lets several features (proxy kill switch, HTTPS-only upgrades) act on requests before the
 * ad blocker sees them. Electron allows one webRequest listener per event and session: the ad
 * blocker owns onBeforeRequest and calls gateRequest() first; when it isn't attached (it failed
 * to load) installFallbackRequestGate() keeps the gates working on their own.
 * onErrorOccurred and onBeforeSendHeaders are owned here; onHeadersReceived belongs to the ad blocker,
 * which runs the response-header hooks registered here after its own work. No `app` imports, like
 * adblock-engine.
 */
import type { Session } from "electron";

export type RequestGateDetails = Electron.OnBeforeRequestListenerDetails;
export type RequestGate = (
  details: RequestGateDetails,
) => Electron.CallbackResponse | null;
export type RequestErrorListener = (
  details: Electron.OnErrorOccurredListenerDetails,
) => void;

const gates: RequestGate[] = [];
const errorListeners = new Set<RequestErrorListener>();
const watchedSessions = new WeakSet<Session>();

export function addRequestGate(gate: RequestGate): () => void {
  gates.push(gate);
  return () => {
    const index = gates.indexOf(gate);
    if (index >= 0) gates.splice(index, 1);
  };
}

const sessionGates = new WeakMap<Session, RequestGate[]>();

/** A gate for one session only (e.g. extension declarativeNetRequest rules on the profile session). Runs after the global gates. */
export function addSessionRequestGate(
  session: Session,
  gate: RequestGate,
): () => void {
  const list = sessionGates.get(session) ?? [];
  list.push(gate);
  sessionGates.set(session, list);
  return () => {
    const index = list.indexOf(gate);
    if (index >= 0) list.splice(index, 1);
  };
}

function runGates(
  list: readonly RequestGate[],
  details: RequestGateDetails,
): Electron.CallbackResponse | null {
  for (const gate of list) {
    try {
      const response = gate(details);
      if (response) return response;
    } catch (error) {
      console.warn("Request gate failed:", error);
    }
  }
  return null;
}

/** The first gate that wants to cancel or redirect the request wins; null lets it continue. */
export function gateRequest(
  details: RequestGateDetails,
  session?: Session,
): Electron.CallbackResponse | null {
  const response = runGates(gates, details);
  if (response) return response;
  const forSession = session ? sessionGates.get(session) : undefined;
  return forSession && forSession.length > 0
    ? runGates(forSession, details)
    : null;
}

// ---------------------------------------------------------------------------
// Header hooks. Each returns new headers or null for "unchanged"; hooks run in registration order.

export type HeaderRecord = Record<string, string | string[]>;
export type RequestHeadersHook = (
  details: Electron.OnBeforeSendHeadersListenerDetails,
  headers: HeaderRecord,
) => HeaderRecord | null;
export type ResponseHeadersHook = (
  details: Electron.OnHeadersReceivedListenerDetails,
  headers: HeaderRecord,
) => HeaderRecord | null;

const requestHeaderHooks = new WeakMap<Session, RequestHeadersHook[]>();
const responseHeaderHooks = new WeakMap<Session, ResponseHeadersHook[]>();

function runHeaderHooks<D>(
  hooks: ReadonlyArray<
    (details: D, headers: HeaderRecord) => HeaderRecord | null
  >,
  details: D,
  headers: HeaderRecord,
): HeaderRecord | null {
  let current = headers;
  let changed = false;
  for (const hook of hooks) {
    try {
      const next = hook(details, current);
      if (next) {
        current = next;
        changed = true;
      }
    } catch (error) {
      console.warn("Header hook failed:", error);
    }
  }
  return changed ? current : null;
}

/**
 * Modify outgoing request headers on a session. The session's onBeforeSendHeaders listener exists
 * only while at least one hook is registered (so requests pay nothing otherwise).
 */
export function addRequestHeadersHook(
  session: Session,
  hook: RequestHeadersHook,
): () => void {
  const list = requestHeaderHooks.get(session) ?? [];
  requestHeaderHooks.set(session, list);
  list.push(hook);
  if (list.length === 1) {
    session.webRequest.onBeforeSendHeaders(
      { urls: ["<all_urls>"] },
      (details, callback) => {
        const headers = runHeaderHooks(list, details, details.requestHeaders);
        callback(
          headers ? { requestHeaders: headers as Record<string, string> } : {},
        );
      },
    );
  }
  return () => {
    const index = list.indexOf(hook);
    if (index < 0) return;
    list.splice(index, 1);
    if (list.length === 0) session.webRequest.onBeforeSendHeaders(null);
  };
}

/** Modify response headers on a session; applied by the ad blocker's onHeadersReceived after its own changes. */
export function addResponseHeadersHook(
  session: Session,
  hook: ResponseHeadersHook,
): () => void {
  const list = responseHeaderHooks.get(session) ?? [];
  responseHeaderHooks.set(session, list);
  list.push(hook);
  return () => {
    const index = list.indexOf(hook);
    if (index >= 0) list.splice(index, 1);
  };
}

/** Fold the session's response-header hooks into an onHeadersReceived response. */
export function applyResponseHeaderHooks(
  session: Session,
  details: Electron.OnHeadersReceivedListenerDetails,
  response: Electron.HeadersReceivedResponse,
): Electron.HeadersReceivedResponse {
  const hooks = responseHeaderHooks.get(session);
  if (!hooks || hooks.length === 0 || response.cancel) return response;
  const headers = runHeaderHooks(
    hooks,
    details,
    response.responseHeaders ?? details.responseHeaders ?? {},
  );
  return headers ? { ...response, responseHeaders: headers } : response;
}

// ---------------------------------------------------------------------------
// Start-up hold: the first window shows before the ad-filter engine and Web Store extensions
// are loaded, so page requests wait here until they are (never an unfiltered first page).

let hold: Promise<void> | null = null;

/**
 * Hold page requests until `ready` settles, or `timeoutMs` passes (a stuck start-up never
 * leaves pages hanging). Requests without a page (Session.fetch for filter lists, favicons,
 * extension downloads) and extension resources are never held, so the work being waited for
 * can't wait on itself.
 */
export function holdPageRequestsUntil(
  ready: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const released: Promise<void> = Promise.race([
    ready.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(
          `Start-up work took over ${timeoutMs} ms; letting page requests through.`,
        );
        resolve();
      }, timeoutMs);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    if (hold === released) hold = null;
  });
  hold = released;
  return released;
}

/** Should this request wait for the start-up hold? */
export function isHeldRequest(
  details: Pick<RequestGateDetails, "url" | "webContentsId">,
): boolean {
  if (!hold) return false;
  if (typeof details.webContentsId !== "number" || details.webContentsId < 0)
    return false;
  return !/^(?:chrome-extension|devtools|chrome|file|data|blob):/i.test(
    details.url,
  );
}

/** Run `next` now, or once the start-up hold lifts when the request is held. */
export function afterStartupHold(
  details: Pick<RequestGateDetails, "url" | "webContentsId">,
  next: () => void,
): void {
  if (hold && isHeldRequest(details)) void hold.then(next);
  else next();
}

export type BeforeRequestHandler = (
  details: RequestGateDetails,
  callback: (response: Electron.CallbackResponse) => void,
) => void;
const sessionHandlers = new WeakMap<Session, BeforeRequestHandler>();

/**
 * The full handler a session's requests go through once attached (the ad blocker). Requests the
 * fallback gate held at start-up are handed to it on release, so attaching late (after the first
 * window) never lets a held request through unfiltered.
 */
export function setSessionRequestHandler(
  session: Session,
  handler: BeforeRequestHandler | null,
): void {
  if (handler) sessionHandlers.set(session, handler);
  else sessionHandlers.delete(session);
}

export function installFallbackRequestGate(session: Session): void {
  session.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      afterStartupHold(details, () => {
        const handler = sessionHandlers.get(session);
        if (handler) handler(details, callback);
        else callback(gateRequest(details, session) ?? {});
      });
    },
  );
}

export function onRequestError(listener: RequestErrorListener): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

export function watchRequestErrors(session: Session): void {
  if (watchedSessions.has(session)) return;
  watchedSessions.add(session);
  session.webRequest.onErrorOccurred({ urls: ["<all_urls>"] }, (details) => {
    for (const listener of errorListeners) {
      try {
        listener(details);
      } catch (error) {
        console.warn("Request error listener failed:", error);
      }
    }
  });
}
