/**
 * Script popups from site tabs as real popup windows (see shared/page-popups.ts for the rules).
 *
 * Chromium makes the popup's webContents itself (`action: 'allow'`), so it shares the opener's
 * session/partition and keeps `window.opener`: Disqus, OAuth and 3-D Secure flows post their result
 * back to the opener (often a cross-site iframe in the tab) or poll `popup.closed`. Electron does
 * not inherit the opener's preload, so a popup runs only the session's sandboxed ad-filter frame
 * preload, like any page. Popups are plain BrowserWindows outside the browser-window list: no
 * toolbar, never restored, closed with their opener.
 */
import { BrowserWindow, type WebContents } from "electron";
import {
  isActivatingKeyInput,
  isActivatingMouseInput,
  isClosePopupShortcut,
  isPopupNavigationUrl,
  isPopupStartUrl,
  isScriptPopupRequest,
  PopupActivation,
} from "../shared/page-popups";

export interface PagePopupHost {
  /** Open a link (target=_blank, window.open without features) from a popup as a browser tab. */
  openTab(url: string, activate: boolean): void;
  /** Google's sign-in can't run in Electron: hand it to the native sign-in (true = handled). */
  handOffSignIn?(contents: WebContents, url: string): boolean;
}

const activations = new WeakMap<WebContents, PopupActivation>();
/** Popups allowed but not created yet (did-create-window only configures windows we allowed). */
const pendingPopups = new WeakMap<WebContents, number>();

function activationFor(contents: WebContents): PopupActivation {
  let activation = activations.get(contents);
  if (!activation) {
    activation = new PopupActivation();
    activations.set(contents, activation);
  }
  return activation;
}

const POPUP_WEB_PREFERENCES: Electron.WebPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  // The session's ad-filter frame preload runs in the popup's iframes too, as in tabs.
  nodeIntegrationInSubFrames: true,
  spellcheck: true,
};

/**
 * Track user activation in `contents` and turn the popups it allows into configured windows.
 * Clicks inside cross-site iframes reach before-mouse-event too (input-event only sees the main
 * frame's widget), which is what Disqus's login button is.
 */
export function attachPagePopups(
  contents: WebContents,
  host: PagePopupHost,
): void {
  contents.on("before-mouse-event", (_event, input) => {
    if (isActivatingMouseInput(input)) activationFor(contents).note(Date.now());
  });
  contents.on("before-input-event", (_event, input) => {
    if (isActivatingKeyInput(input)) activationFor(contents).note(Date.now());
  });
  contents.on("did-create-window", (window) => {
    const pending = pendingPopups.get(contents) ?? 0;
    if (pending <= 0 || !(window instanceof BrowserWindow)) return;
    pendingPopups.set(contents, pending - 1);
    configurePagePopup(window, host);
  });
}

/**
 * The window-open response for a script popup the user just asked for (a click or key press in
 * the last 5 s, consumed here), or null when this request is not one: the caller then applies its
 * usual rules (tabs for links, deny for unrequested popups).
 */
export function userPopupResponse(
  contents: WebContents,
  details: Electron.HandlerDetails,
): Electron.WindowOpenHandlerResponse | null {
  if (!isScriptPopupRequest(details) || !isPopupStartUrl(details.url))
    return null;
  if (!activationFor(contents).consume(Date.now())) return null;
  pendingPopups.set(contents, (pendingPopups.get(contents) ?? 0) + 1);
  return {
    action: "allow",
    outlivesOpener: false,
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      fullscreenable: false,
      show: true,
      webPreferences: POPUP_WEB_PREFERENCES,
    },
  };
}

function configurePagePopup(window: BrowserWindow, host: PagePopupHost): void {
  const contents = window.webContents;
  window.setMenuBarVisibility(false);
  attachPagePopups(contents, host);
  contents.setWindowOpenHandler((details) => {
    const popup = userPopupResponse(contents, details);
    if (popup) return popup;
    // Links out of a popup (terms, help) open as tabs in the opener's window.
    if (isPopupNavigationUrl(details.url) && !isScriptPopupRequest(details))
      host.openTab(details.url, details.disposition !== "background-tab");
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!isPopupNavigationUrl(url)) return event.preventDefault();
    if (host.handOffSignIn?.(contents, url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
    if (!isPopupNavigationUrl(url)) return event.preventDefault();
    if (isMainFrame && host.handOffSignIn?.(contents, url))
      event.preventDefault();
  });
  contents.on("before-input-event", (event, input) => {
    // The app menu's Cmd/Ctrl+W closes the browser window's tab; in a popup it closes the popup.
    if (!isClosePopupShortcut(input, process.platform)) return;
    event.preventDefault();
    if (!window.isDestroyed()) window.close();
  });
}
