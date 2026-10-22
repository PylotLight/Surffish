import { AsyncLocalStorage } from "node:async_hooks";
import type { BaseWindow, WebContents } from "electron";

/**
 * Which browser window an operation is for.
 *
 * Surffish used to drive one window, so most of main calls "the window" implicitly (newBrowserTab(),
 * setBrowserChromeState(), openCommandPalette(), ...). With several windows those calls resolve
 * through currentBrowserWindow():
 *
 *   1. the window whose renderer / tab sent the IPC being handled (or that a caller scoped with
 *      runInWindow) — tracked with AsyncLocalStorage, so it survives the handler's awaits,
 *   2. otherwise the focused browser window,
 *   3. otherwise the last focused one (menus, OS link opens, timers while the app is in the background).
 *
 * Code that already knows its window (a tab's own events) passes it explicitly instead.
 */

const scope = new AsyncLocalStorage<BaseWindow>();
const windows: BaseWindow[] = [];
let lastFocused: BaseWindow | null = null;
/** webContents id -> the browser window it belongs to (shell surfaces, tab pages, overlays). */
const contentsWindows = new Map<number, BaseWindow>();
const changeListeners = new Set<() => void>();

function live(win: BaseWindow | null | undefined): win is BaseWindow {
  return Boolean(win && !win.isDestroyed() && windows.includes(win));
}

function notifyChanged(): void {
  for (const listener of changeListeners) {
    try {
      listener();
    } catch (error) {
      console.warn("[windows] change listener failed:", error);
    }
  }
}

export function registerBrowserWindow(win: BaseWindow): void {
  if (windows.includes(win)) return;
  windows.push(win);
  lastFocused = win;
  win.on("focus", () => {
    if (!windows.includes(win)) return;
    lastFocused = win;
    notifyChanged();
  });
  win.on("closed", () => unregisterBrowserWindow(win));
  notifyChanged();
}

export function unregisterBrowserWindow(win: BaseWindow): void {
  const index = windows.indexOf(win);
  if (index < 0) return;
  windows.splice(index, 1);
  for (const [id, owner] of contentsWindows)
    if (owner === win) contentsWindows.delete(id);
  if (lastFocused === win) lastFocused = windows.at(-1) ?? null;
  notifyChanged();
}

/** Open browser windows in the order they were created. */
export function browserWindows(): BaseWindow[] {
  return windows.filter((win) => !win.isDestroyed());
}

/** 1-based position among the open windows (what menus and the task manager call "Window 2"). */
export function browserWindowNumber(win: BaseWindow): number {
  return browserWindows().indexOf(win) + 1;
}

export function focusedBrowserWindow(): BaseWindow | null {
  return windows.find((win) => !win.isDestroyed() && win.isFocused()) ?? null;
}

export function lastFocusedBrowserWindow(): BaseWindow | null {
  const focused = focusedBrowserWindow();
  if (focused) return focused;
  if (live(lastFocused)) return lastFocused;
  return browserWindows().at(-1) ?? null;
}

/** The window an implicit "the window" call is for (see the module comment). */
export function currentBrowserWindow(): BaseWindow | null {
  const scoped = scope.getStore();
  if (live(scoped)) return scoped;
  return lastFocusedBrowserWindow();
}

/** Run `fn` (and everything it awaits) with `win` as the current window. */
export function runInWindow<T>(
  win: BaseWindow | null | undefined,
  fn: () => T,
): T {
  return live(win) ? scope.run(win, fn) : fn();
}

/** Remember that `contents` belongs to `win`, so IPC from it is scoped to that window. */
export function bindContentsToWindow(
  contents: WebContents,
  win: BaseWindow,
): void {
  if (contents.isDestroyed()) return;
  const id = contents.id;
  contentsWindows.set(id, win);
  // One cleanup listener per webContents, however often it moves between windows (tab moves, mini window).
  if (watchedContents.has(contents)) return;
  watchedContents.add(contents);
  contents.once("destroyed", () => contentsWindows.delete(id));
}
const watchedContents = new WeakSet<WebContents>();

export function windowForContents(
  contents: WebContents | null | undefined,
): BaseWindow | null {
  if (!contents) return null;
  const win = contentsWindows.get(contents.id);
  return live(win) ? win : null;
}

/** Window list, focus or titles changed (the Window menu rebuilds from this). */
export function onBrowserWindowsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function notifyBrowserWindowsChanged(): void {
  notifyChanged();
}
