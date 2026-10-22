/**
 * Script popups (`window.open(url, '_blank', 'width=…,height=…')`): sign-in windows for Disqus,
 * "Log in with X" OAuth flows, payment 3-D Secure pages. Like Chrome, a popup opened right after a
 * click or key press in the page becomes a real popup window that keeps `window.opener` (the site
 * reads the result back through it with postMessage, or by polling `popup.closed`). Popups with no
 * user activation behind them stay blocked. Pure rules only; main/page-popups.ts does the windows.
 */
import { isShiftClickLinkOpen } from "./glance";

/** Chromium's transient user activation lasts 5 s (HTMLDocument "user activation" timeout). */
export const POPUP_ACTIVATION_MS = 5_000;

/** Keys that never grant activation in Chromium (Escape and bare modifiers). */
const NON_ACTIVATING_KEYS = new Set([
  "Escape",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "Fn",
  "OS",
]);

/** A press or release of a mouse button grants activation (before-mouse-event types). */
export function isActivatingMouseInput(input: { type: string }): boolean {
  return input.type === "mouseDown" || input.type === "mouseUp";
}

/** A key press grants activation, except Escape and modifier-only presses (before-input-event). */
export function isActivatingKeyInput(input: {
  type: string;
  key?: string;
}): boolean {
  return input.type === "keyDown" && !NON_ACTIVATING_KEYS.has(input.key ?? "");
}

/**
 * One page's transient activation. Opening a popup consumes it (one click → one popup, like
 * Chrome), so a page can't chain a burst of popups off a single click.
 */
export class PopupActivation {
  private activatedAt = Number.NEGATIVE_INFINITY;

  note(now: number): void {
    this.activatedAt = now;
  }

  isActive(now: number): boolean {
    const age = now - this.activatedAt;
    return age >= 0 && age <= POPUP_ACTIVATION_MS;
  }

  /** True (and spent) when the page was activated within the window. */
  consume(now: number): boolean {
    if (!this.isActive(now)) return false;
    this.activatedAt = Number.NEGATIVE_INFINITY;
    return true;
  }
}

/**
 * Is this window-open request a script popup (sized `window.open`) rather than a link? Chromium
 * reports those as `new-window` *with* window features; a Shift+click on a link is `new-window`
 * without features, and `window.open(url)` / target=_blank are tabs.
 */
export function isScriptPopupRequest(details: {
  disposition: string;
  features?: string;
  postBody?: unknown;
}): boolean {
  return details.disposition === "new-window" && !isShiftClickLinkOpen(details);
}

/** Where a popup may start: an http(s) page, or about:blank that the opener then navigates. */
export function isPopupStartUrl(url: string): boolean {
  if (url === "about:blank" || url === "") return true;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Where a popup may navigate to (its own links and redirects): http(s) only. */
export function isPopupNavigationUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Cmd+W (macOS) / Ctrl+W (elsewhere) in a popup closes the popup, not the opener's tab. */
export function isClosePopupShortcut(
  input: {
    type: string;
    key?: string;
    control?: boolean;
    meta?: boolean;
    alt?: boolean;
    shift?: boolean;
  },
  platform: string,
): boolean {
  if (
    input.type !== "keyDown" ||
    (input.key ?? "").toLowerCase() !== "w" ||
    input.alt ||
    input.shift
  )
    return false;
  return platform === "darwin"
    ? Boolean(input.meta) && !input.control
    : Boolean(input.control) && !input.meta;
}
