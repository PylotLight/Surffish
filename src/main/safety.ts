import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { onPageSessionCreated } from "./browser-session";
import { installFallbackRequestGate, watchRequestErrors } from "./request-gate";
import {
  getSpellcheckState,
  initializeSpellcheck,
  setSpellcheckSettings,
} from "./spellcheck-settings";
import {
  continueToHttp,
  getHttpsOnlyState,
  initializeHttpsOnly,
  removeHttpsOnlyException,
  setHttpsOnlyEnabled,
} from "./https-only-mode";
import {
  checkProxyNow,
  getProxyGuardStatus,
  initializeProxyKillSwitch,
  setProxyKillSwitch,
} from "./proxy-kill-switch";
import {
  clearBrowsingData,
  deleteCookieSite,
  forgetSite,
  getSiteData,
  listCookieSites,
} from "./browsing-data-clear";
import {
  attachTabHealth,
  killUnresponsiveTab,
  reloadCrashedTab,
  waitForUnresponsiveTab,
} from "./tab-health";
import { isMainWindowRenderer } from "./browser-shell";
import { getActiveTabWebContents } from "./browser";

/**
 * Safety pack: spellcheck settings, crashed/hung tab recovery, clear browsing data, site data
 * controls, HTTPS-only mode and the proxy kill switch. Wired in from index.ts (init),
 * ipc.ts (IPC) and browser.ts (per-tab attach).
 */

/** After the proxy is configured and before ad blocking attaches (which then calls the gates first). */
export function initializeBrowserSafety(): void {
  void onPageSessionCreated((target) => {
    installFallbackRequestGate(target);
    watchRequestErrors(target);
  });
  initializeSpellcheck();
  initializeHttpsOnly();
  initializeProxyKillSwitch();
}

/** Every site tab's WebContents. */
export function attachTabSafety(contents: WebContents): void {
  attachTabHealth(contents);
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame))
    throw new Error(
      "This browser operation is available only to the app window.",
    );
}

function handle(
  channel: string,
  listener: (...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    return listener(...args);
  });
}

function runTabRecovery(action: unknown): boolean {
  const contents = getActiveTabWebContents();
  if (!contents || contents.isDestroyed()) return false;
  switch (action) {
    case "reload":
      return reloadCrashedTab(contents);
    case "wait":
      return waitForUnresponsiveTab(contents);
    case "kill":
      return killUnresponsiveTab(contents);
    case "continue-http":
      return continueToHttp(contents);
    case "back":
      if (!contents.navigationHistory.canGoBack()) return false;
      contents.navigationHistory.goBack();
      return true;
    default:
      return false;
  }
}

export function registerSafetyIpc(): void {
  handle("browser:tab-recovery", (action) => runTabRecovery(action));
  handle("browser:spellcheck:get", () => getSpellcheckState());
  handle("browser:spellcheck:set", (settings) =>
    setSpellcheckSettings(settings),
  );
  handle("browser:https-only:get", () => getHttpsOnlyState());
  handle("browser:https-only:set", (enabled) => setHttpsOnlyEnabled(enabled));
  handle("browser:https-only:remove-exception", (host) =>
    removeHttpsOnlyException(host),
  );
  handle("browser:proxy-guard:get", () => getProxyGuardStatus());
  handle("browser:proxy-guard:set", (enabled) => setProxyKillSwitch(enabled));
  handle("browser:proxy-guard:check", () => checkProxyNow());
  handle("browser:privacy:clear", (options) => clearBrowsingData(options));
  handle("browser:privacy:cookie-sites", () => listCookieSites());
  handle("browser:privacy:delete-cookie-site", (site) =>
    deleteCookieSite(site),
  );
  handle("browser:site-data:get", (origin) => getSiteData(origin));
  handle("browser:site-data:forget", (origin, includeHistory) =>
    forgetSite(origin, includeHistory),
  );
}
