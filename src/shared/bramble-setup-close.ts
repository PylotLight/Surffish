/**
 * Closing Bramble's setup tab (options.html) once setup is done: create a vault, join one from another
 * device, or restore a backup. The page side is bramble-setup-close-page.cjs (staged next to Bramble's
 * scripts with the Scan QR helper); it asks the main process to close its tab, which re-checks here.
 * Pure helpers, no Electron imports.
 */

/**
 * True for Bramble's setup page: `<extension>/options.html` with no `?screen=`. Bramble routes
 * `?screen=import` and `?screen=restore` (opened from its Settings) to other flows, which keep their tab.
 */
export function isBrambleSetupPageUrl(
  candidate: string,
  extensionUrl: string,
): boolean {
  let url: URL;
  let base: URL;
  try {
    url = new URL(candidate);
    base = new URL(extensionUrl);
  } catch {
    return false;
  }
  if (
    url.protocol !== "chrome-extension:" ||
    url.protocol !== base.protocol ||
    url.host !== base.host
  )
    return false;
  if (url.pathname !== "/options.html") return false;
  return !url.searchParams.has("screen");
}

export type SetupTabClosePlan = "close" | "replace-with-new-tab";

/**
 * How to get rid of the finished setup tab. Closing the last tab of a window would close that window
 * (or, in the only window, already leaves a fresh New Tab), so the last tab is swapped for a New Tab
 * first: setup finishing should never take a window away. A mini window is a throwaway peek and closes
 * with its last tab as usual.
 */
export function planSetupTabClose(window: {
  tabCount: number;
  mini: boolean;
}): SetupTabClosePlan {
  if (window.mini) return "close";
  return window.tabCount <= 1 ? "replace-with-new-tab" : "close";
}
