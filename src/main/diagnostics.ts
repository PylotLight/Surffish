import {
  app,
  ipcMain,
  session,
  webContents as allWebContents,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import {
  buildDiagnosticsSnapshot,
  describeTabOccupant,
  DIAGNOSTICS_SAMPLE_INTERVAL_MS,
  type DiagnosticsOccupant,
  type DiagnosticsPayload,
  type DiagnosticsSnapshot,
} from "../shared/diagnostics";
import {
  getBrowserTabProcessEntries,
  reloadBrowserTab,
  suspendBrowserTab,
} from "./browser";
import { getBrowserSession, listPageSessions } from "./browser-session";
import {
  getBrowserChromeState,
  getMainWindowRenderers,
  isMainWindowRenderer,
  sendToMainWindowRenderers,
  setBrowserChromeState,
} from "./browser-shell";
import { getLinkStatusContentsIds } from "./link-status";
import { getTabOverviewContentsIds } from "./tab-overview";
import { getScreenshotContentsIds } from "./screenshot";
import { getGlanceContentsIds } from "./glance-entry";

/**
 * Diagnostics / Task Manager. Samples app.getAppMetrics() every 2 s, only while a Diagnostics
 * view is open, and labels each process by what lives in it (tabs, the app's own surfaces,
 * overlays, extensions, cross-site frames). Snapshots go to every app surface so the sidebar can
 * show per-tab hints while the panel is open; when the last watcher leaves, a null snapshot
 * clears them and the timer stops.
 */

export const DIAGNOSTICS_CHANNEL = "browser:diagnostics";

const watchers = new Set<WebContents>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastSnapshot: DiagnosticsSnapshot | null = null;

function safeOsPid(contents: WebContents): number {
  try {
    return contents.isDestroyed() ? 0 : contents.getOSProcessId();
  } catch {
    return 0;
  }
}

function extensionNames(): Map<string, string> {
  const names = new Map<string, string>();
  const sessions = new Set<Electron.Session>([
    session.defaultSession,
    getBrowserSession(),
    ...listPageSessions()
      .filter(({ info }) => !info.isPrivate)
      .map(({ session: page }) => page),
  ]);
  for (const contents of allWebContents.getAllWebContents()) {
    if (!contents.isDestroyed()) sessions.add(contents.session);
  }
  for (const ses of sessions) {
    try {
      for (const extension of ses.extensions.getAllExtensions())
        names.set(extension.id, extension.name);
    } catch {
      // A session without extension support.
    }
  }
  return names;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Everything we can attribute to a process: tabs, their cross-site frames, shell surfaces, overlays, extensions. */
export function collectDiagnosticsOccupants(): {
  occupants: DiagnosticsOccupant[];
  unattributedWorkers: string[];
} {
  const occupants: DiagnosticsOccupant[] = [];
  const claimed = new Set<number>();
  const internalToOs = new Map<number, number>();
  const names = extensionNames();

  for (const tab of getBrowserTabProcessEntries()) {
    const contents = tab.contents;
    if (!contents) continue;
    const pid = safeOsPid(contents);
    if (!pid) continue;
    claimed.add(contents.id);
    const { label, detail: tabDetail } = describeTabOccupant(
      tab.title,
      tab.url,
    );
    // With several windows open, say which one the tab lives in.
    const withWindow = tab.windowNumber
      ? `${tabDetail} · window ${tab.windowNumber}`
      : tabDetail;
    const detail = tab.spaceName
      ? `${withWindow} · ${tab.spaceName}`
      : withWindow;
    occupants.push({
      pid,
      kind: tab.pdfEditor
        ? "pdf-editor"
        : tab.extensionPage
          ? "extension"
          : "tab",
      label,
      detail,
      tabId: tab.id,
    });
    try {
      internalToOs.set(contents.getProcessId(), pid);
      // Site isolation: cross-site iframes (ads, embeds, sign-in widgets) get their own renderers.
      for (const frame of contents.mainFrame.framesInSubtree) {
        internalToOs.set(frame.processId, frame.osProcessId);
        if (frame.osProcessId === pid || frame.osProcessId <= 0) continue;
        occupants.push({
          pid: frame.osProcessId,
          kind: "subframe",
          label:
            frame.origin && frame.origin !== "null"
              ? frame.origin.replace(/^https?:\/\//, "")
              : "frame",
          detail: `in ${label}`,
        });
      }
    } catch {
      // The page is navigating; its frames show up on the next sample.
    }
  }

  const shell = new Set(
    getMainWindowRenderers().map((contents) => contents.id),
  );
  const linkStatusIds = new Set(getLinkStatusContentsIds());
  const overviewIds = new Set(getTabOverviewContentsIds());
  const screenshotIds = new Set(getScreenshotContentsIds());
  const glanceIds = getGlanceContentsIds();
  const glancePages = new Set(glanceIds.page);
  const glanceChrome = new Set(glanceIds.chrome);
  for (const contents of allWebContents.getAllWebContents()) {
    if (contents.isDestroyed() || claimed.has(contents.id)) continue;
    const pid = safeOsPid(contents);
    if (!pid) continue;
    try {
      internalToOs.set(contents.getProcessId(), pid);
    } catch {
      // ignore
    }
    const url = contents.getURL();
    if (shell.has(contents.id)) {
      let surface = "window";
      try {
        surface = new URL(url).searchParams.get("surface") ?? surface;
      } catch {
        // keep the default
      }
      occupants.push({ pid, kind: "shell", label: surface });
    } else if (linkStatusIds.has(contents.id)) {
      occupants.push({ pid, kind: "overlay", label: "link status" });
    } else if (overviewIds.has(contents.id)) {
      occupants.push({ pid, kind: "overlay", label: "tab overview" });
    } else if (glancePages.has(contents.id)) {
      occupants.push({
        pid,
        kind: "overlay",
        label: `Glance: ${hostOf(url) || "page"}`,
        detail: "link peek",
      });
    } else if (glanceChrome.has(contents.id)) {
      occupants.push({ pid, kind: "overlay", label: "glance header" });
    } else if (screenshotIds.has(contents.id)) {
      occupants.push({ pid, kind: "overlay", label: "screenshot" });
    } else if (url.startsWith("chrome-extension://")) {
      const id = hostOf(url);
      const what =
        contents.getType() === "backgroundPage"
          ? "background page"
          : url.includes("offscreen")
            ? "offscreen page"
            : "page";
      occupants.push({
        pid,
        kind: "extension",
        label: names.get(id) ?? id,
        detail: what,
      });
    } else if (url.startsWith("devtools://")) {
      occupants.push({ pid, kind: "overlay", label: "DevTools" });
    } else {
      occupants.push({
        pid,
        kind: "overlay",
        label: url.startsWith("data:")
          ? "internal view"
          : hostOf(url) || contents.getType(),
        detail: contents.getType(),
      });
    }
  }

  // Service workers (extension backgrounds, site push workers) have no web contents. Name the ones
  // that share a process with something above; list the rest so the "no page" rows make sense.
  const unattributedWorkers: string[] = [];
  const sessions = new Set<Electron.Session>([
    session.defaultSession,
    getBrowserSession(),
    ...listPageSessions()
      .filter(({ info }) => !info.isPrivate)
      .map(({ session: page }) => page),
  ]);
  for (const contents of allWebContents.getAllWebContents())
    if (!contents.isDestroyed()) sessions.add(contents.session);
  for (const ses of sessions) {
    let running: Record<number, Electron.ServiceWorkerInfo> = {};
    try {
      running = ses.serviceWorkers.getAllRunning();
    } catch {
      continue;
    }
    for (const worker of Object.values(running)) {
      const extensionId = worker.scriptUrl.startsWith("chrome-extension://")
        ? hostOf(worker.scriptUrl)
        : "";
      const name = extensionId
        ? `${names.get(extensionId) ?? extensionId} (service worker)`
        : `${hostOf(worker.scope) || worker.scope} service worker`;
      const pid = internalToOs.get(worker.renderProcessId);
      if (pid)
        occupants.push({
          pid,
          kind: extensionId ? "extension" : "subframe",
          label: name,
        });
      else unattributedWorkers.push(name);
    }
  }
  return { occupants, unattributedWorkers };
}

function sample(): DiagnosticsPayload {
  const metrics = app.getAppMetrics();
  const { occupants, unattributedWorkers } = collectDiagnosticsOccupants();
  lastSnapshot = buildDiagnosticsSnapshot(metrics, occupants, Date.now());
  return { ...lastSnapshot, unattributedWorkers };
}

function publish(): void {
  sendToMainWindowRenderers(DIAGNOSTICS_CHANNEL, sample());
}

function stopIfIdle(): void {
  for (const contents of [...watchers])
    if (contents.isDestroyed()) watchers.delete(contents);
  if (watchers.size > 0 || !timer) return;
  clearInterval(timer);
  timer = null;
  lastSnapshot = null;
  sendToMainWindowRenderers(DIAGNOSTICS_CHANNEL, null);
}

/** The Diagnostics view mounted (true) or unmounted (false). Returns a first snapshot to paint. */
export function watchDiagnostics(
  contents: WebContents,
  watching: boolean,
): DiagnosticsPayload | null {
  if (!watching) {
    watchers.delete(contents);
    stopIfIdle();
    return null;
  }
  if (!watchers.has(contents)) {
    watchers.add(contents);
    contents.once("destroyed", () => {
      watchers.delete(contents);
      stopIfIdle();
    });
  }
  // The first getAppMetrics() call starts the CPU interval (CPU reads 0); memory is real already.
  const first = sample();
  if (!timer) timer = setInterval(publish, DIAGNOSTICS_SAMPLE_INTERVAL_MS);
  return first;
}

/** Kill a renderer/GPU/utility process the last snapshot showed as killable. */
export function killDiagnosticsProcess(pid: number): boolean {
  const row = lastSnapshot?.rows.find((entry) => entry.pid === pid);
  if (!row || !row.canKill || pid === process.pid) return false;
  // Renderers that host a page die through Chromium, so the tab sees render-process-gone.
  const host = allWebContents
    .getAllWebContents()
    .find((contents) => safeOsPid(contents) === pid);
  if (host && !getMainWindowRenderers().includes(host)) {
    host.forcefullyCrashRenderer();
  } else {
    try {
      process.kill(pid);
    } catch {
      return false;
    }
  }
  setTimeout(() => {
    if (timer) publish();
  }, 300);
  return true;
}

/** Window → Task Manager (Shift+Esc, like Chrome): open Settings → Diagnostics, or close it again. */
export function toggleTaskManager(): void {
  const open = getBrowserChromeState().sidebarMode === "diagnostics";
  setBrowserChromeState({ sidebarMode: open ? "tabs" : "diagnostics" });
}

function assertAppRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame))
    throw new Error("Diagnostics are available only to the app window.");
}

export function registerDiagnosticsIpc(): void {
  ipcMain.handle("browser:diagnostics:watch", (event, watching: unknown) => {
    // Stopping is always allowed: the view's unmount can land while the window is tearing down.
    if (watching !== true) return watchDiagnostics(event.sender, false);
    assertAppRenderer(event);
    return watchDiagnostics(event.sender, true);
  });
  ipcMain.handle("browser:diagnostics:kill", (event, pid: unknown) => {
    assertAppRenderer(event);
    return typeof pid === "number" && Number.isInteger(pid)
      ? killDiagnosticsProcess(pid)
      : false;
  });
  ipcMain.handle("browser:diagnostics:reload-tab", (event, tabId: unknown) => {
    assertAppRenderer(event);
    if (typeof tabId !== "string") return false;
    reloadBrowserTab(tabId);
    return true;
  });
  ipcMain.handle("browser:diagnostics:discard-tab", (event, tabId: unknown) => {
    assertAppRenderer(event);
    if (typeof tabId !== "string") return false;
    suspendBrowserTab(tabId);
    return true;
  });
}
