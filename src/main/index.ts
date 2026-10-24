// First: log and count main-process errors instead of Electron's modal error dialog (crash-guard.ts).
import "./crash-guard";
// Then: scopes every IPC handler registered after it to the sender's window (multi-window).
import { installIpcWindowScope } from "./ipc-window-scope";
import { app } from "electron";
import { dirname, join } from "node:path";
import { APP_ID, APP_NAME } from "../shared/config";
import {
  CHROMIUM_HTTPS_UPGRADE_FEATURES,
  mergeFeatureList,
} from "../shared/https-only";
import { registerIpc } from "./ipc";
import { registerDiagnosticsIpc } from "./diagnostics";
import { registerBookmarkIpc } from "./bookmarks-ipc";
import { registerWindowIpc } from "./window-menu";
import { initializeTabArchive, registerTabArchiveIpc } from "./tab-archive";
import {
  disposeMemorySaver,
  initializeMemorySaver,
  registerMemorySaverIpc,
} from "./memory-saver";
import { registerPreconnectIpc } from "./preconnect";
import { registerWakeSnapshotIpc } from "./wake-snapshot";
import {
  getBrowserProxySettings,
  getNetworkHelperUpstreamSettings,
  initializeBrowserProxy,
} from "./proxy";
import {
  getNetworkHelperStatus,
  startNetworkHelper,
  stopNetworkHelper,
} from "./network-helper";
import { syncManagedSshTunnel, stopManagedSshTunnel } from "./ssh-tunnel";
import { initializeScreenSharing } from "./screen-share";
import { initializeSpacesStore } from "./spaces-store";
import { restoreWindows, setMainWindowCloseHandler } from "./window";
import { quietRetiredShellSenders } from "./ipc-retired";
import {
  freezeBrowserSession,
  pruneSavedWakeSnapshots,
  setBrowserSearchEngine,
  TAB_COMMAND_SHORTCUTS,
} from "./browser";
import { browserWindows } from "./window-scope";
import { getBrowserSearchEngine } from "./browser-persistence";
import { initializeSessionCookiePersistence } from "./session-cookies";
import { disposeBramblePoc, initializeBramblePoc } from "./bramble-poc";
import { initializeDownloads } from "./downloads";
import { installAppMenu } from "./app-menu";
import {
  flushExternalOpens,
  registerExternalOpenHandlers,
} from "./external-links";
import {
  disposeWebStoreExtensions,
  initializeWebStoreExtensions,
} from "./web-store-extensions";
import { holdPageRequestsUntil } from "./request-gate";
import { afterFirstWindowPaint, traceStartup } from "./startup-defer";
import { registerPdfEditorScheme } from "./pdf-editor";
import { READER_SCHEME_PRIVILEGES, registerReaderIpc } from "./reader-mode";
import {
  disposePageWatchersFeature,
  initializePageWatchersFeature,
  registerPageWatcherIpc,
} from "./page-watchers-feature";
import {
  disposeReadAloudFeature,
  READ_ALOUD_SCHEME_PRIVILEGES,
  registerReadAloudIpc,
} from "./read-aloud-feature";
import { initializeBrowserSafety } from "./safety";
import { initializeCertificateHandling } from "./certificates";
import {
  disposeUpdates,
  initializeUpdates,
  registerUpdateIpc,
} from "./updates";
import {
  disposeFeeds,
  registerFeedIpc,
  startFeedsAfterFirstPaint,
} from "./feeds-ipc";
import { registerReadingListIpc } from "./reading-list-ipc";
import { registerAdblockStatsIpc } from "./adblock-stats";
import { registerTabVolume } from "./tab-volume";
import { registerGlanceIpc } from "./glance-entry";
import {
  registerMiniWindowIpc,
  setMiniWindowAppShortcuts,
  startMiniWindowMenuBar,
} from "./mini-window-entry";
import { APP_SHORTCUTS } from "./app-shortcuts";
import { initializeLocalAI, registerLocalAIIpc } from "./local-ai";
import { registerCastIpc } from "./cast-entry";
import { chromeUserAgent } from "./adblock-policy";

installIpcWindowScope();
app.setName(APP_NAME);
// Dev builds get their own profile, so they can run beside the installed release app.
// The single-instance lock is per profile (userData), so each profile still has one window owner.
// SURFFISH_PROFILE=<name> picks another isolated profile (e.g. a second dev instance).
const profileOverride = process.env["SURFFISH_PROFILE"]
  ?.trim()
  .replace(/[^\w.-]/g, "");
// Leave an explicitly chosen profile alone (smoke tests and --user-data-dir set userData outside appData).
const usesDefaultProfileDir =
  dirname(app.getPath("userData")) === app.getPath("appData");
if (usesDefaultProfileDir && (profileOverride || !app.isPackaged)) {
  const profileName = profileOverride
    ? `${APP_NAME} ${profileOverride}`
    : `${APP_NAME} Dev`;
  app.setName(profileName);
  app.setPath("userData", join(app.getPath("appData"), profileName));
  // macOS Keychain ACLs pin to the requesting binary's code signature. A dev run is the ad-hoc
  // signed Electron in node_modules, which changes on every Electron bump, so "Always Allow" never
  // sticks and every launch asks for the login password. Dev profiles use Chromium's mock keychain
  // instead (a fixed, non-secret key: fine for throwaway dev data). SURFFISH_REAL_KEYCHAIN=1 opts out.
  if (
    process.platform === "darwin" &&
    !app.isPackaged &&
    process.env["SURFFISH_REAL_KEYCHAIN"] !== "1"
  )
    app.commandLine.appendSwitch("use-mock-keychain");
}
// One user agent everywhere, before any session or page exists. Sessions get theirs from
// browser-session.ts, but service workers and the workers inside cross-site iframes (Cloudflare
// Turnstile's challenges.cloudflare.com frame) use this app-wide fallback, which otherwise still says
// `Electron/x Surffish/x`; challenges see two different browsers and never pass.
app.userAgentFallback = chromeUserAgent(app.userAgentFallback);
// Privileged schemes must be registered before ready.
registerPdfEditorScheme([
  READER_SCHEME_PRIVILEGES,
  READ_ALOUD_SCHEME_PRIVILEGES,
]);
// Bound Chromium's HTTP cache (default grows with free disk space) so the profile stays lean.
app.commandLine.appendSwitch("disk-cache-size", String(512 * 1024 * 1024));
// Surffish owns http→https upgrades (HTTPS-only mode, typed-host https-first with Continue to HTTP)
// and never upgrades local-network hosts. Keep Chromium's own HTTPS-Upgrades / HTTPS-First off so
// a plain-http LAN device can't be silently switched to TLS underneath us. (Electron 44's content
// layer doesn't ship Chrome's upgrade throttle; this is a guard against it arriving in an update.)
app.commandLine.appendSwitch(
  "disable-features",
  mergeFeatureList(
    app.commandLine.getSwitchValue("disable-features"),
    CHROMIUM_HTTPS_UPGRADE_FEATURES,
  ),
);

// Worst case (first run downloading filter lists waits up to 8 s, plus extensions) before pages load anyway.
const STARTUP_HOLD_TIMEOUT_MS = 20_000;

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
// Default-browser links and opened files can arrive before ready; they queue until tabs exist.
else registerExternalOpenHandlers();

async function startNetworkServices(): Promise<void> {
  const settings = getBrowserProxySettings();
  const managedSshEnabled =
    settings.enabled && Boolean(settings.sshHost?.trim());
  if (managedSshEnabled)
    await startNetworkHelper(settings.port, getNetworkHelperUpstreamSettings);
  else await stopNetworkHelper();
  // Bind the user-facing port first so the private in-app SSH listener cannot select it.
  await syncManagedSshTunnel(settings);
  const status = getNetworkHelperStatus(settings);
  if (managedSshEnabled && !status.listening)
    console.warn("[network helper] unavailable:", status.error);
  if (
    status.sshTunnel.configured &&
    status.sshTunnel.enabled &&
    !status.sshTunnel.running &&
    !status.sshTunnel.starting
  )
    console.warn("[ssh tunnel] unavailable:", status.sshTunnel.error);
}

function stopNetworkServices(): Promise<void> {
  return Promise.all([stopNetworkHelper(), stopManagedSshTunnel()]).then(
    () => undefined,
  );
}

app
  .whenReady()
  .then(async () => {
    traceStartup("app ready");
    if (!app.isPackaged)
      console.info("Surffish browser profile:", app.getPath("userData"));
    try {
      // Space definitions first: the proxy reads each Space partition's forced route.
      initializeSpacesStore();
      // Set the browser session's proxy before any remote page is created.
      await initializeBrowserProxy();
      // Start the optional in-app SSH tunnel before the helper and browser windows.
      await startNetworkServices();
      void initializeScreenSharing();
      // Kill switch, HTTPS-only and spellcheck hook into the sessions before ad blocking attaches.
      initializeBrowserSafety();
      // Certificate capture, the macOS OS-trust fallback and "Proceed anyway" exceptions.
      initializeCertificateHandling();
      await initializeSessionCookiePersistence();
      initializeDownloads();
    } catch (error) {
      console.error("Could not initialize the browser profile:", error);
      app.quit();
      return;
    }
    traceStartup("profile ready");
    // The ad filter and Web Store extensions load after the first window is drawn; until then page
    // requests wait in the fallback gate (no unfiltered first page, extension content scripts still
    // apply) and are handed to the ad blocker once it attaches.
    let finishDeferredStartup: () => void = () => {};
    holdPageRequestsUntil(
      new Promise<void>((resolve) => {
        finishDeferredStartup = resolve;
      }),
      STARTUP_HOLD_TIMEOUT_MS,
    );
    // Windows taskbar grouping/notifications; dev builds group under the Electron binary.
    if (process.platform === "win32")
      app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
    quietRetiredShellSenders();
    registerIpc();
    registerUpdateIpc();
    registerDiagnosticsIpc();
    registerBookmarkIpc();
    registerWindowIpc();
    registerTabArchiveIpc();
    registerMemorySaverIpc();
    registerPreconnectIpc();
    registerWakeSnapshotIpc();
    registerReaderIpc();
    registerPageWatcherIpc();
    // Read Aloud settings and player IPC only; the read-aloud module loads on the first reading.
    registerReadAloudIpc();
    registerFeedIpc();
    registerReadingListIpc();
    registerAdblockStatsIpc();
    // Per-tab volume: frame preload on every page session, before any tab loads.
    registerTabVolume();
    // Glance settings only; the glance module itself loads on the first Shift+click.
    registerGlanceIpc();
    // Mini window settings and its global toggle shortcut; the window module loads on first use.
    setMiniWindowAppShortcuts(() => [
      ...Object.values(APP_SHORTCUTS),
      ...Object.values(TAB_COMMAND_SHORTCUTS).map(
        (shortcut) => shortcut.accelerator,
      ),
    ]);
    registerMiniWindowIpc();
    // Built-in AI (Prompt API, experimental): off by default; nothing is forked until it's on.
    registerLocalAIIpc();
    initializeLocalAI();
    // Cast to a Chromecast: settings + IPC only; discovery and CASTV2 load on first use (cast.ts).
    registerCastIpc();
    installAppMenu();
    setBrowserSearchEngine(getBrowserSearchEngine());
    setMainWindowCloseHandler(() => {
      disposeBramblePoc();
      disposeWebStoreExtensions();
    });
    // Every saved window comes back (an older single-window session becomes one window).
    const windows = restoreWindows();
    traceStartup("windows created");
    flushExternalOpens();
    initializeTabArchive();
    // Discard least recently used background tabs when memory is tight (on by default).
    initializeMemorySaver();
    // Release-feed update notifications: first check ~30s after launch, then every 6h.
    initializeUpdates();
    // Page watchers: checks run in main on their own schedule (never for private tabs). Off in
    // Settings → General means the watcher module is never loaded.
    initializePageWatchersFeature();
    // macOS keeps running with no windows open; the Dock icon brings the saved windows back.
    app.on("activate", () => {
      if (browserWindows().length === 0) {
        void startNetworkServices().then(restoreWindows);
      }
    });
    await afterFirstWindowPaint(windows.at(-1));
    traceStartup("first window painted");
    // Saved tab pictures of pages the restored session no longer has go (one small index read, a readdir).
    pruneSavedWakeSnapshots();
    const originalSecurityWarnings =
      process.env.ELECTRON_DISABLE_SECURITY_WARNINGS;
    let initializeNetworkAdblock: (() => Promise<void>) | undefined;
    try {
      // The adapter sets this environment variable as an import side effect; restore the app's
      // previous setting right away.
      const adblock = await import("./adblock");
      initializeNetworkAdblock = adblock.initializeNetworkAdblock;
      adblock.attachNetworkAdblock();
    } catch (error) {
      console.warn(
        "Could not load the network ad-filter adapter; continuing without it:",
        error,
      );
    } finally {
      if (originalSecurityWarnings === undefined)
        delete process.env.ELECTRON_DISABLE_SECURITY_WARNINGS;
      else
        process.env.ELECTRON_DISABLE_SECURITY_WARNINGS =
          originalSecurityWarnings;
    }
    try {
      await initializeNetworkAdblock?.();
    } catch (error) {
      console.warn(
        "Could not initialize network ad filtering; continuing without it:",
        error,
      );
    }
    traceStartup("adblock engine ready");
    try {
      // Before page requests are released, so content scripts apply to restored tabs.
      await initializeWebStoreExtensions();
    } catch (error) {
      console.warn(
        "Could not load Chrome Web Store extensions; continuing without them:",
        error,
      );
    }
    finishDeferredStartup();
    traceStartup("extensions ready, page requests released");
    // Feeds: the store and poller load now (not at launch); no feeds means no timer.
    startFeedsAfterFirstPaint();
    // Mini windows that lived in the menu bar come back there (and the icon shows when set to Always);
    // with nothing there and the default setting, nothing loads.
    startMiniWindowMenuBar();
    try {
      await initializeBramblePoc();
    } catch (error) {
      console.warn(
        "Could not initialize the Bramble extension; continuing without it:",
        error,
      );
    }
  })
  .catch((error: unknown) => {
    console.error("App startup failed:", error);
    app.quit();
  });
app.on("window-all-closed", () => {
  void stopNetworkServices();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  // Windows close one by one while quitting; keep all of them in the saved session.
  freezeBrowserSession();
  void stopNetworkServices();
  disposeUpdates();
  disposePageWatchersFeature();
  disposeReadAloudFeature();
  disposeFeeds();
  disposeMemorySaver();
  disposeBramblePoc();
  disposeWebStoreExtensions();
});
