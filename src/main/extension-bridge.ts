/**
 * Surffish's channel into a Chrome Web Store extension's service worker.
 *
 * Electron gives the main process no API for chrome.webNavigation or for an extension's
 * declarativeNetRequest state, so Surffish's worker shim (web-store-extension-adapter.ts) and main
 * talk directly. Two transports (src/shared/extension-worker-bridge.ts):
 *
 *  - 'worker' (preferred): Electron's service-worker preload (extension-worker.cjs, registered with
 *    session.registerPreloadScript type 'service-worker') exposes a narrow IPC object in the worker.
 *    Main reaches the worker through ServiceWorkerMain.send/ipc. A stopped worker is started with
 *    serviceWorkers.startWorkerForScope when an event it listens to arrives (Chrome's wake-up
 *    semantics); messages are only sent once the worker is 'running' (Chromium drops them while it
 *    is still starting). No extra renderer.
 *  - 'page' (fallback): a hidden page per extension (`surffish-bridge.html`, written into the staged
 *    extension by the adapter) with a Surffish preload relays over chrome.runtime messaging (which
 *    also wakes a stopped worker). Used when the renderer sandbox is off (Chromium then skips
 *    service-worker preloads), for extensions without a service worker, when
 *    SURFFISH_EXTENSION_BRIDGE=page, or when a worker never answers Surffish's init.
 *
 * Used for:
 *  - chrome.webNavigation, which Electron lacks: main turns tab navigation events into
 *    onBeforeNavigate/onCommitted/onDOMContentLoaded/onCompleted/onErrorOccurred/... for the shim.
 *  - declarativeNetRequest: the dynamic/session rules and enabled rulesets are read from the native
 *    API whenever they change and reported to extension-dnr.ts (which enforces them). On start-up
 *    Surffish's enabled-ruleset set is mirrored into the native API (Electron never enables manifest
 *    rulesets on its own).
 */
import {
  app,
  ipcMain,
  webContents as allWebContents,
  WebContentsView,
  webFrameMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type ServiceWorkerMain,
  type WebContents,
  type WebFrameMain,
} from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extensionDnrEnabledRulesets,
  forgetExtensionDnrTab,
  updateExtensionDnrState,
} from "./extension-dnr";
import { EXTENSION_BRIDGE_PAGE } from "./web-store-extension-adapter";
import {
  BRIDGE_RELOAD_LIMIT,
  BRIDGE_RELOAD_WINDOW_MS,
  RecoveryBudget,
} from "../shared/stability";
import { extensionWorkerPreloadActive } from "./extension-worker-preload";
import {
  bridgeTransportOverride,
  chooseBridgeTransport,
  WORKER_READY_TIMEOUT_MS,
  WorkerEventQueue,
  type ExtensionBridgeTransport,
} from "../shared/extension-worker-bridge";

export const BRIDGE_UP_CHANNEL = "surffish:extension-bridge:up";
export const BRIDGE_CALL_CHANNEL = "surffish:extension-bridge:call";
export const BRIDGE_DOWN_CHANNEL = "surffish:extension-bridge:down";
export const WORKER_UP_CHANNEL = "surffish:extension-worker:up";
export const WORKER_CALL_CHANNEL = "surffish:extension-worker:call";
export const WORKER_DOWN_CHANNEL = "surffish:extension-worker:down";

const MAX_QUEUED_EVENTS = 200;
const mainDirectory = dirname(fileURLToPath(import.meta.url));

type JsonRecord = Record<string, unknown>;

interface BridgeOptions {
  id: string;
  /** chrome-extension://<id>/ */
  extensionUrl: string;
  session: Electron.Session;
  webNavigation: boolean;
  dnr: boolean;
  /** The manifest declares background.service_worker (the worker transport needs one). */
  serviceWorker?: boolean;
  /** Is this webContents one of the user's (non-private) tabs? */
  isTab(contents: WebContents): boolean;
}

interface PageTransport {
  kind: "page";
  view: WebContentsView;
  ready: boolean;
  queue: unknown[];
  /** Crash reloads left for this bridge: a page that keeps crashing is not reloaded forever. */
  reloads: RecoveryBudget;
}

interface WorkerTransport {
  kind: "worker";
  /** The running worker, once it has answered init; null while stopped or starting. */
  worker: ServiceWorkerMain | null;
  ready: boolean;
  events: WorkerEventQueue;
  /** Other messages (none today besides events) waiting for the worker. */
  pending: unknown[];
  waking: Promise<unknown> | null;
  /** Falls back to the bridge page when the worker never answers. Cleared on the first ready. */
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  answeredOnce: boolean;
  stats: WorkerStats;
}

interface WorkerStats {
  starts: number;
  wakes: number;
  delivered: number;
  droppedUnlistened: number;
  lastWakeMs: number | null;
}

interface Bridge extends BridgeOptions {
  transport: PageTransport | WorkerTransport;
}

const bridges = new Map<string, Bridge>();
const watchedContents = new WeakSet<WebContents>();
const hookedWorkers = new WeakSet<ServiceWorkerMain>();
const workerHookedSessions = new WeakSet<Electron.Session>();
/** Extensions whose worker transport failed this run: they stay on the bridge page. */
const workerFailed = new Set<string>();
let ipcRegistered = false;
let contentsHooked = false;

function resolvePreload(file: string): string {
  const candidates = [
    join(mainDirectory, `../preload/${file}`),
    join(mainDirectory, `../../preload/${file}`),
    join(app.getAppPath(), `src/preload/${file}`),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
  );
}

function scopeOf(bridge: Bridge): string {
  return bridge.extensionUrl.endsWith("/")
    ? bridge.extensionUrl
    : `${bridge.extensionUrl}/`;
}

// ---------------------------------------------------------------------------
// Service-worker preload (worker transport)

function workerPreloadActive(session: Electron.Session): boolean {
  return extensionWorkerPreloadActive(session);
}

function bridgeForScope(
  session: Electron.Session,
  scope: string,
): Bridge | null {
  for (const bridge of bridges.values()) {
    if (
      bridge.session === session &&
      bridge.transport.kind === "worker" &&
      scopeOf(bridge) === scope
    )
      return bridge;
  }
  return null;
}

function sendToWorker(
  bridge: Bridge,
  transport: WorkerTransport,
  message: unknown,
): boolean {
  const worker = transport.worker;
  if (!worker || worker.isDestroyed()) return false;
  try {
    worker.send(WORKER_DOWN_CHANNEL, message);
    return true;
  } catch (error) {
    console.warn(
      `[extensions] could not reach the worker of ${bridge.id}:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

function sendInit(
  bridge: Bridge,
  transport: WorkerTransport,
  worker: ServiceWorkerMain,
): void {
  transport.worker = worker;
  sendToWorker(bridge, transport, {
    type: "init",
    enabledRulesets: bridge.dnr ? extensionDnrEnabledRulesets(bridge.id) : null,
    webNavigation: bridge.webNavigation,
  });
}

function flushWorker(bridge: Bridge, transport: WorkerTransport): void {
  for (const message of transport.pending.splice(0))
    sendToWorker(bridge, transport, message);
  for (const event of transport.events.drain()) {
    if (sendToWorker(bridge, transport, event)) transport.stats.delivered += 1;
  }
}

function wakeWorker(
  bridge: Bridge,
  transport: WorkerTransport,
  attempt = 0,
): void {
  if (transport.waking) return;
  const startedAt = performance.now();
  if (attempt === 0) transport.stats.wakes += 1;
  transport.waking = bridge.session.serviceWorkers
    .startWorkerForScope(scopeOf(bridge))
    .then(() => {
      transport.stats.lastWakeMs = performance.now() - startedAt;
    })
    .catch((error: unknown) => {
      // Right after loadExtension the registration may not exist yet (Chromium then starts the
      // worker itself and 'running' attaches it). Retry a few times before saying anything.
      if (attempt < 3) {
        setTimeout(
          () => {
            if (
              bridges.get(bridge.id) === bridge &&
              bridge.transport === transport &&
              !transport.worker
            )
              wakeWorker(bridge, transport, attempt + 1);
          },
          500 * (attempt + 1),
        );
        return;
      }
      console.warn(
        `[extensions] could not start the worker of ${bridge.id}:`,
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      transport.waking = null;
    });
}

function onWorkerUp(
  bridge: Bridge,
  transport: WorkerTransport,
  worker: ServiceWorkerMain,
  message: unknown,
): void {
  if (typeof message !== "object" || message === null) return;
  const record = message as JsonRecord;
  if (record.type === "ready") {
    transport.worker = worker;
    transport.ready = true;
    transport.answeredOnce = true;
    if (transport.fallbackTimer) {
      clearTimeout(transport.fallbackTimer);
      transport.fallbackTimer = null;
    }
    const listening = Array.isArray(record.listening)
      ? record.listening.filter(
          (name): name is string => typeof name === "string",
        )
      : [];
    transport.events.setListening(listening);
    flushWorker(bridge, transport);
  } else if (record.type === "listen" && typeof record.name === "string") {
    transport.events.addListening(record.name);
  } else if (record.type === "dnr-state" && bridge.dnr) {
    updateExtensionDnrState(bridge.id, {
      dynamicRules: record.dynamicRules,
      sessionRules: record.sessionRules,
      enabledRulesets: record.enabledRulesets,
      disabledStaticRuleIds: record.disabledStaticRuleIds,
    });
  }
}

function hookWorker(
  session: Electron.Session,
  worker: ServiceWorkerMain,
): void {
  if (hookedWorkers.has(worker)) return;
  hookedWorkers.add(worker);
  // Every message is re-checked against the worker's scope: only workers of extensions Surffish
  // manages here are answered (the preload exposes its object in every extension worker).
  worker.ipc.on(WORKER_UP_CHANNEL, (_event, message: unknown) => {
    const bridge = bridgeForScope(session, worker.scope);
    if (!bridge || bridge.transport.kind !== "worker") return;
    onWorkerUp(bridge, bridge.transport, worker, message);
  });
  worker.ipc.handle(
    WORKER_CALL_CHANNEL,
    (_event, method: unknown, args: unknown) => {
      const bridge = bridgeForScope(session, worker.scope);
      if (!bridge) throw new Error("Not available.");
      return bridgeCall(bridge, method, args);
    },
  );
}

function onWorkerStatus(
  session: Electron.Session,
  versionId: number,
  status: string,
): void {
  if (bridges.size === 0) return;
  let worker: ServiceWorkerMain | undefined;
  try {
    worker = session.serviceWorkers.getWorkerFromVersionID(versionId);
  } catch {
    worker = undefined;
  }
  if (status === "starting" || status === "running") {
    if (!worker || !worker.scope.startsWith("chrome-extension://")) return;
    const bridge = bridgeForScope(session, worker.scope);
    if (!bridge || bridge.transport.kind !== "worker") return;
    hookWorker(session, worker);
    if (status === "running") {
      bridge.transport.stats.starts += 1;
      sendInit(bridge, bridge.transport, worker);
    }
    return;
  }
  // stopping / stopped: the next event wakes it again.
  for (const bridge of bridges.values()) {
    if (bridge.session !== session || bridge.transport.kind !== "worker")
      continue;
    const transport = bridge.transport;
    if (!transport.worker) continue;
    if (
      transport.worker.isDestroyed() ||
      transport.worker.versionId === versionId
    ) {
      transport.worker = null;
      transport.ready = false;
    }
  }
}

function hookWorkerStatus(session: Electron.Session): void {
  if (workerHookedSessions.has(session)) return;
  workerHookedSessions.add(session);
  session.serviceWorkers.on(
    "running-status-changed",
    ({ versionId, runningStatus }) =>
      onWorkerStatus(session, versionId, runningStatus),
  );
}

/** Attach to an already-running worker (the extension loaded before this module started listening). */
function attachRunningWorker(
  bridge: Bridge,
  transport: WorkerTransport,
): boolean {
  const scope = scopeOf(bridge);
  let running: Record<number, Electron.ServiceWorkerInfo>;
  try {
    running = bridge.session.serviceWorkers.getAllRunning();
  } catch {
    return false;
  }
  for (const [versionId, info] of Object.entries(running)) {
    if (info.scope !== scope) continue;
    const worker = bridge.session.serviceWorkers.getWorkerFromVersionID(
      Number(versionId),
    );
    if (!worker) continue;
    hookWorker(bridge.session, worker);
    sendInit(bridge, transport, worker);
    return true;
  }
  return false;
}

function startWorkerTransport(bridge: Bridge): void {
  const transport: WorkerTransport = {
    kind: "worker",
    worker: null,
    ready: false,
    events: new WorkerEventQueue(),
    pending: [],
    waking: null,
    fallbackTimer: null,
    answeredOnce: false,
    stats: {
      starts: 0,
      wakes: 0,
      delivered: 0,
      droppedUnlistened: 0,
      lastWakeMs: null,
    },
  };
  bridge.transport = transport;
  hookWorkerStatus(bridge.session);
  // The worker must answer once; if the preload never applied (it only runs in sandboxed workers),
  // fall back to the bridge page for this extension.
  transport.fallbackTimer = setTimeout(
    () => {
      transport.fallbackTimer = null;
      if (
        bridges.get(bridge.id) !== bridge ||
        bridge.transport !== transport ||
        transport.answeredOnce
      )
        return;
      console.warn(
        `[extensions] the worker of ${bridge.id} did not answer over the service-worker preload; using the bridge page`,
      );
      workerFailed.add(bridge.id);
      const queued = transport.events.drain();
      startPageTransport(bridge);
      for (const event of queued) send(bridge, event);
    },
    Number(process.env.SURFFISH_EXTENSION_WORKER_TIMEOUT_MS) ||
      WORKER_READY_TIMEOUT_MS,
  );
  if (!attachRunningWorker(bridge, transport)) wakeWorker(bridge, transport);
}

// ---------------------------------------------------------------------------
// Bridge page (page transport, fallback)

function bridgeForSender(
  sender: WebContents,
  senderFrame: WebFrameMain | null,
): Bridge | null {
  for (const bridge of bridges.values()) {
    if (
      bridge.transport.kind !== "page" ||
      bridge.transport.view.webContents !== sender
    )
      continue;
    if (
      !senderFrame ||
      senderFrame !== sender.mainFrame ||
      !senderFrame.url.startsWith(bridge.extensionUrl)
    )
      return null;
    return bridge;
  }
  return null;
}

function send(bridge: Bridge, message: unknown): void {
  const transport = bridge.transport;
  if (transport.kind === "worker") {
    const event = message as { type?: unknown; name?: unknown };
    if (event.type === "event" && typeof event.name === "string") {
      if (!transport.events.wants(event.name)) {
        transport.stats.droppedUnlistened += 1;
        return;
      }
      if (transport.ready && sendToWorker(bridge, transport, message)) {
        transport.stats.delivered += 1;
        return;
      }
      if (transport.events.push(message as never) && !transport.worker)
        wakeWorker(bridge, transport);
      return;
    }
    if (transport.ready && sendToWorker(bridge, transport, message)) return;
    if (transport.pending.length < MAX_QUEUED_EVENTS)
      transport.pending.push(message);
    return;
  }
  const contents = transport.view.webContents;
  if (contents.isDestroyed()) return;
  if (!transport.ready) {
    if (transport.queue.length < MAX_QUEUED_EVENTS)
      transport.queue.push(message);
    return;
  }
  contents.send(BRIDGE_DOWN_CHANNEL, message);
}

function onUp(event: IpcMainEvent, message: unknown): void {
  const bridge = bridgeForSender(event.sender, event.senderFrame);
  if (
    !bridge ||
    bridge.transport.kind !== "page" ||
    typeof message !== "object" ||
    message === null
  )
    return;
  const transport = bridge.transport;
  const record = message as JsonRecord;
  if (record.type === "ready") {
    transport.ready = true;
    event.sender.send(BRIDGE_DOWN_CHANNEL, {
      type: "init",
      enabledRulesets: bridge.dnr
        ? extensionDnrEnabledRulesets(bridge.id)
        : null,
    });
    const queued = transport.queue.splice(0);
    for (const item of queued) event.sender.send(BRIDGE_DOWN_CHANNEL, item);
  } else if (record.type === "dnr-state" && bridge.dnr) {
    updateExtensionDnrState(bridge.id, {
      dynamicRules: record.dynamicRules,
      sessionRules: record.sessionRules,
      enabledRulesets: record.enabledRulesets,
      disabledStaticRuleIds: record.disabledStaticRuleIds,
    });
  }
}

function frameInfo(frame: WebFrameMain | null | undefined): {
  frameId: number;
  parentFrameId: number;
} {
  // Chrome's frame ids (as chrome.scripting expects them): 0 for the main frame, else the frame tree node id.
  if (!frame || !frame.parent) return { frameId: 0, parentFrameId: -1 };
  const parent = frame.parent;
  return {
    frameId: frame.frameTreeNodeId,
    parentFrameId: parent.parent ? parent.frameTreeNodeId : 0,
  };
}

function frameDetails(contents: WebContents, frame: WebFrameMain): JsonRecord {
  return {
    tabId: contents.id,
    processId: frame.processId,
    ...frameInfo(frame),
    url: frame.url,
    errorOccurred: false,
    documentLifecycle: "active",
    frameType: frame.parent ? "sub_frame" : "outermost_frame",
  };
}

/** webNavigation.getFrame / getAllFrames, from either transport. */
function bridgeCall(bridge: Bridge, method: unknown, args: unknown): unknown {
  if (!bridge.webNavigation) throw new Error("Not available.");
  const input =
    typeof args === "object" && args !== null ? (args as JsonRecord) : {};
  const tabId = typeof input.tabId === "number" ? input.tabId : -1;
  const contents = allWebContents.fromId(tabId);
  if (
    !contents ||
    contents.isDestroyed() ||
    contents.session !== bridge.session ||
    !bridge.isTab(contents)
  )
    return null;
  const frames = contents.mainFrame.framesInSubtree;
  if (method === "webNavigation.getAllFrames")
    return frames.map((frame) => frameDetails(contents, frame));
  if (method === "webNavigation.getFrame") {
    const frameId = typeof input.frameId === "number" ? input.frameId : 0;
    const frame = frames.find(
      (candidate) => frameInfo(candidate).frameId === frameId,
    );
    return frame ? frameDetails(contents, frame) : null;
  }
  throw new Error("Unsupported bridge call.");
}

async function onCall(
  event: IpcMainInvokeEvent,
  method: unknown,
  args: unknown,
): Promise<unknown> {
  const bridge = bridgeForSender(event.sender, event.senderFrame);
  if (!bridge) throw new Error("Not available.");
  return bridgeCall(bridge, method, args);
}

function registerIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on(BRIDGE_UP_CHANNEL, onUp);
  ipcMain.handle(BRIDGE_CALL_CHANNEL, onCall);
}

function startPageTransport(bridge: Bridge): void {
  registerIpc();
  const view = new WebContentsView({
    webPreferences: {
      session: bridge.session,
      // Hidden bridge page, never on screen: no wake locks.
      disableWakeLocks: true,
      preload: resolvePreload("extension-bridge.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  const transport: PageTransport = {
    kind: "page",
    view,
    ready: false,
    queue: [],
    reloads: new RecoveryBudget(BRIDGE_RELOAD_LIMIT, BRIDGE_RELOAD_WINDOW_MS),
  };
  bridge.transport = transport;
  const contents = view.webContents;
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("render-process-gone", () => {
    // Reload the relay once the renderer is gone (e.g. extension process crash).
    if (bridges.get(bridge.id) !== bridge || bridge.transport !== transport)
      return;
    transport.ready = false;
    if (!transport.reloads.tryTake()) {
      // Crash loop: stop reloading; the bridge comes back when the extension is reloaded or re-enabled.
      console.warn(
        `[extensions] the Surffish bridge for ${bridge.id} keeps crashing (${BRIDGE_RELOAD_LIMIT} times in ${BRIDGE_RELOAD_WINDOW_MS / 1000} s); not reloading it again`,
      );
      return;
    }
    setTimeout(() => {
      if (
        bridges.get(bridge.id) === bridge &&
        bridge.transport === transport &&
        !contents.isDestroyed()
      )
        void contents
          .loadURL(`${bridge.extensionUrl}${EXTENSION_BRIDGE_PAGE}`)
          .catch(() => {});
    }, 1000);
  });
  void contents
    .loadURL(`${bridge.extensionUrl}${EXTENSION_BRIDGE_PAGE}`)
    .catch((error: unknown) => {
      console.warn(
        `[extensions] could not start the Surffish bridge for ${bridge.id}:`,
        error instanceof Error ? error.message : error,
      );
    });
}

// ---------------------------------------------------------------------------
// webNavigation events from tabs

function dispatch(
  contents: WebContents,
  name: string,
  details: JsonRecord,
): void {
  if (bridges.size === 0) return;
  let isTab: boolean | null = null;
  for (const bridge of bridges.values()) {
    if (!bridge.webNavigation || contents.session !== bridge.session) continue;
    isTab ??= bridge.isTab(contents);
    if (!isTab) return;
    send(bridge, {
      type: "event",
      name,
      details: { tabId: contents.id, timeStamp: Date.now(), ...details },
    });
  }
}

function frameFromIds(
  processId: number,
  routingId: number,
): WebFrameMain | undefined {
  try {
    return webFrameMain.fromId(processId, routingId);
  } catch {
    return undefined;
  }
}

function isTrackedUrl(url: string): boolean {
  return !/^(?:chrome-extension|devtools|chrome):/i.test(url);
}

function watchContents(contents: WebContents): void {
  if (watchedContents.has(contents)) return;
  watchedContents.add(contents);
  const lastUrlByFrame = new Map<number, string>();
  contents.on("did-start-navigation", (details) => {
    if (details.isSameDocument || !isTrackedUrl(details.url)) return;
    const frame = details.frame;
    dispatch(contents, "onBeforeNavigate", {
      url: details.url,
      processId: -1,
      ...frameInfo(frame ?? null),
      parentDocumentId: undefined,
      frameType: details.isMainFrame ? "outermost_frame" : "sub_frame",
    });
  });
  contents.on(
    "did-frame-navigate",
    (_event, url, _code, _status, isMainFrame, processId, routingId) => {
      if (!isTrackedUrl(url)) return;
      const frame = isMainFrame
        ? contents.mainFrame
        : frameFromIds(processId, routingId);
      const ids = isMainFrame
        ? { frameId: 0, parentFrameId: -1 }
        : frameInfo(frame);
      lastUrlByFrame.set(ids.frameId, url);
      dispatch(contents, "onCommitted", {
        url,
        processId,
        ...ids,
        transitionType: "link",
        transitionQualifiers: [],
        frameType: isMainFrame ? "outermost_frame" : "sub_frame",
        documentLifecycle: "active",
      });
    },
  );
  contents.on("frame-created", (_event, { frame }) => {
    if (!frame) return;
    frame.on("dom-ready", () => {
      if (frame.isDestroyed?.() || !isTrackedUrl(frame.url)) return;
      dispatch(contents, "onDOMContentLoaded", {
        url: frame.url,
        processId: frame.processId,
        ...frameInfo(frame),
        frameType: "sub_frame",
        documentLifecycle: "active",
      });
    });
  });
  contents.on("dom-ready", () => {
    const url = contents.getURL();
    if (!isTrackedUrl(url)) return;
    dispatch(contents, "onDOMContentLoaded", {
      url,
      processId: contents.mainFrame.processId,
      frameId: 0,
      parentFrameId: -1,
      frameType: "outermost_frame",
      documentLifecycle: "active",
    });
  });
  contents.on(
    "did-frame-finish-load",
    (_event, isMainFrame, processId, routingId) => {
      const frame = isMainFrame
        ? contents.mainFrame
        : frameFromIds(processId, routingId);
      if (!frame || !isTrackedUrl(frame.url)) return;
      dispatch(contents, "onCompleted", {
        url: frame.url,
        processId,
        ...(isMainFrame ? { frameId: 0, parentFrameId: -1 } : frameInfo(frame)),
        frameType: isMainFrame ? "outermost_frame" : "sub_frame",
        documentLifecycle: "active",
      });
    },
  );
  contents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      processId,
      routingId,
    ) => {
      if (!isTrackedUrl(validatedURL)) return;
      const ids = isMainFrame
        ? { frameId: 0, parentFrameId: -1 }
        : frameInfo(frameFromIds(processId, routingId));
      const error = errorDescription
        ? errorDescription.startsWith("net::")
          ? errorDescription
          : `net::${errorDescription}`
        : `net::ERR_FAILED (${errorCode})`;
      dispatch(contents, "onErrorOccurred", {
        url: validatedURL,
        processId,
        ...ids,
        error,
        frameType: isMainFrame ? "outermost_frame" : "sub_frame",
      });
    },
  );
  contents.on(
    "did-navigate-in-page",
    (_event, url, isMainFrame, processId, routingId) => {
      if (!isTrackedUrl(url)) return;
      const ids = isMainFrame
        ? { frameId: 0, parentFrameId: -1 }
        : frameInfo(frameFromIds(processId, routingId));
      const previous = lastUrlByFrame.get(ids.frameId);
      lastUrlByFrame.set(ids.frameId, url);
      const fragmentOnly =
        previous !== undefined && previous.split("#")[0] === url.split("#")[0];
      dispatch(
        contents,
        fragmentOnly ? "onReferenceFragmentUpdated" : "onHistoryStateUpdated",
        {
          url,
          processId,
          ...ids,
          transitionType: "link",
          transitionQualifiers: [],
          frameType: isMainFrame ? "outermost_frame" : "sub_frame",
        },
      );
    },
  );
  contents.once("destroyed", () => forgetExtensionDnrTab(contents.id));
}

function hookContents(session: Electron.Session): void {
  if (contentsHooked) return;
  contentsHooked = true;
  // Listeners are cheap (they return at once while no bridge wants events); attach to every page in the session.
  for (const contents of allWebContents.getAllWebContents()) {
    if (contents.session === session) watchContents(contents);
  }
  app.on("web-contents-created", (_event, contents) => {
    if (contents.session === session) watchContents(contents);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle

/** Start (or restart) the bridge for a loaded extension. No-op when it needs neither feature. */
export function startExtensionBridge(options: BridgeOptions): void {
  stopExtensionBridge(options.id);
  if (!options.webNavigation && !options.dnr) return;
  if (options.webNavigation) hookContents(options.session);
  const kind: ExtensionBridgeTransport = chooseBridgeTransport({
    hasServiceWorker: options.serviceWorker === true,
    workerPreloadActive: workerPreloadActive(options.session),
    forcePage:
      workerFailed.has(options.id) ||
      bridgeTransportOverride(process.env.SURFFISH_EXTENSION_BRIDGE) === "page",
  });
  // Placeholder transport until the chosen one is set up below.
  const bridge = {
    ...options,
    transport: null as unknown as Bridge["transport"],
  } as Bridge;
  bridges.set(options.id, bridge);
  if (kind === "worker") startWorkerTransport(bridge);
  else startPageTransport(bridge);
}

export function stopExtensionBridge(id: string): void {
  const bridge = bridges.get(id);
  if (!bridge) return;
  bridges.delete(id);
  const transport = bridge.transport;
  if (transport.kind === "worker") {
    if (transport.fallbackTimer) clearTimeout(transport.fallbackTimer);
    transport.fallbackTimer = null;
    transport.events.drain();
    return;
  }
  const contents = transport.view.webContents;
  if (!contents.isDestroyed()) contents.close();
}

export function disposeExtensionBridges(): void {
  for (const id of [...bridges.keys()]) stopExtensionBridge(id);
}

/** Which transport each running bridge uses, plus worker counters (smokes and diagnostics). */
export function extensionBridgeSnapshot(): Array<{
  id: string;
  transport: ExtensionBridgeTransport;
  ready: boolean;
  starts?: number;
  wakes?: number;
  delivered?: number;
  droppedUnlistened?: number;
  lastWakeMs?: number | null;
}> {
  return [...bridges.values()].map((bridge) => {
    const transport = bridge.transport;
    if (transport.kind === "page")
      return { id: bridge.id, transport: "page", ready: transport.ready };
    return {
      id: bridge.id,
      transport: "worker",
      ready: transport.ready,
      ...transport.stats,
    };
  });
}

// Smoke instrumentation only.
if (
  process.env.SURFFISH_SMOKE_DNR_STATS === "1" ||
  process.env.SURFFISH_SMOKE_EXTENSION_BRIDGE === "1"
) {
  (
    globalThis as {
      __surffishExtensionBridgeSnapshot?: typeof extensionBridgeSnapshot;
    }
  ).__surffishExtensionBridgeSnapshot = extensionBridgeSnapshot;
}
