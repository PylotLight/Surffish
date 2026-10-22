import { randomUUID } from "node:crypto";
import {
  BrowserWindow,
  dialog,
  Notification,
  powerMonitor,
  type WebContents,
} from "electron";
import {
  applyCheckFailure,
  applyCheckSuccess,
  changeSummary,
  createWatcher,
  deferCheck,
  dueWatchers,
  editWatcher,
  MAX_CONCURRENT_CHECKS,
  nextWakeDelay,
  normalizeWatchText,
  normalizeWatchUrl,
  parseWatcherList,
  summarizeWatcher,
  type NewWatcherInput,
  type PageWatcher,
  type PageWatcherSummary,
  type WatcherPatch,
} from "../shared/page-watchers";
import { APP_NAME } from "../shared/config";
import { backgroundNetworkBlockedReason } from "./background-network";
import { getBrowserSession } from "./browser-session";
import {
  sendToMainWindowRenderers,
  setBrowserChromeState,
} from "./browser-shell";
import { deferWrite } from "./deferred-writes";
import type { WatchTextResult } from "./page-watcher-text";
import { readUserJson, writeUserJson } from "./user-json";
import { getMainWindow } from "./window";

/**
 * Page watchers. Each watcher re-reads one page (or one element of it) on its own interval, in
 * main: a plain fetch with the browser session (the SOCKS proxy applies; the proxy kill switch
 * guard can veto it) whose HTML is parsed without running anything, or, when the watcher asks for
 * it, a hidden offscreen window that runs the page's JavaScript first. A change raises a native
 * notification and a badge in Settings → Watchers with the added/removed lines. Errors back off
 * exponentially. Private tabs never create watchers. Stored in page-watchers.json.
 */
const FILE = "page-watchers.json";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 40_000;
/** After load, give script-built pages a moment to fill in. */
const RENDER_SETTLE_MS = 2_500;
/** Don't hit the network the moment the app opens; restored tabs come first. */
const STARTUP_DELAY_MS = 45_000;
const PICKER_WORLD_ID = 1311;
const RENDER_WORLD_ID = 1312;

let watchers: PageWatcher[] = [];
let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let startedAt = 0;
let disposed = false;
const running = new Set<string>();
const notifications = new Map<string, Notification>();

function load(): void {
  if (loaded) return;
  loaded = true;
  watchers = parseWatcherList(readUserJson(FILE), Date.now());
}

function persist(): void {
  const snapshot = watchers;
  deferWrite(
    "page-watchers",
    () => {
      writeUserJson(FILE, { version: 1, watchers: snapshot });
    },
    1_500,
  );
}

export function listPageWatchers(): PageWatcherSummary[] {
  load();
  return watchers.map(summarizeWatcher);
}

export interface PageWatchersSnapshot {
  watchers: PageWatcherSummary[];
  /** Ids being checked right now. */
  running: string[];
}

function snapshot(): PageWatchersSnapshot {
  return { watchers: listPageWatchers(), running: [...running] };
}

function publish(): void {
  try {
    sendToMainWindowRenderers("browser:watchers:changed", snapshot());
  } catch {
    // The window may be closing; the next list() call returns fresh state anyway.
  }
}

function replace(next: PageWatcher): void {
  watchers = watchers.map((watcher) =>
    watcher.id === next.id ? next : watcher,
  );
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (disposed) return;
  const now = Date.now();
  const delay = nextWakeDelay(watchers, now, running);
  if (delay === null) return;
  // Hold the first checks until the app has settled.
  const startupHold = Math.max(0, startedAt + STARTUP_DELAY_MS - now);
  timer = setTimeout(tick, Math.max(delay, startupHold));
  timer.unref?.();
}

function tick(): void {
  timer = null;
  if (disposed) return;
  const due = dueWatchers(watchers, Date.now(), running);
  for (const watcher of due.slice(
    0,
    Math.max(0, MAX_CONCURRENT_CHECKS - running.size),
  ))
    void runCheck(watcher.id);
  schedule();
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES)
    throw new Error("The page is too large to watch.");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The page is too large to watch.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Plain fetch with the browser session (proxy, cookies); no scripts run. */
async function fetchPage(url: string): Promise<{ body: string; type: string }> {
  const response = await getBrowserSession().fetch(url, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept:
        "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    },
  });
  if (!response.ok)
    throw new Error(`The page answered HTTP ${response.status}.`);
  const type = response.headers.get("content-type") ?? "text/html";
  if (!/(?:html|xml|text\/plain)/i.test(type))
    throw new Error("This address is not a web page.");
  return { body: decodeBody(await readBounded(response), type), type };
}

function renderScript(selector: string | null): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    let target = null;
    try { target = selector ? document.querySelector(selector) : (document.querySelector('main, [role="main"]') || (document.querySelectorAll('article').length === 1 ? document.querySelector('article') : null) || document.body); } catch { return { error: 'selector' }; }
    if (!target) return { error: 'missing' };
    return { text: String(target.innerText || '').slice(0, 1000000) };
  })()`;
}

/** Load the page in a hidden offscreen window (browser session), let its scripts run, read the text. */
async function renderPage(
  url: string,
  selector: string | null,
): Promise<WatchTextResult> {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      offscreen: true,
      // Hidden page read for its text: its media or Screen Wake Lock must never keep the Mac awake.
      disableWakeLocks: true,
      session: getBrowserSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      images: false,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: "document-user-activation-required",
    },
  });
  const contents = window.webContents;
  try {
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, target) => {
      if (!/^https?:\/\//i.test(target)) event.preventDefault();
    });
    contents.on("will-redirect", (event, target) => {
      if (!/^https?:\/\//i.test(target)) event.preventDefault();
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      contents.loadURL(url),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("The page took too long to load.")),
          RENDER_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timeout));
    await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));
    if (contents.isDestroyed())
      return { ok: false, error: "The page closed while loading." };
    const result = (await contents.executeJavaScriptInIsolatedWorld(
      RENDER_WORLD_ID,
      [{ code: renderScript(selector) }],
    )) as { text?: unknown; error?: unknown } | null;
    if (!result || result.error === "missing")
      return {
        ok: false,
        error: selector
          ? "The watched element was not found on the page."
          : "The page has no text to watch.",
      };
    if (result.error)
      return { ok: false, error: "The CSS selector is not supported." };
    return {
      ok: true,
      lines: normalizeWatchText(
        typeof result.text === "string" ? result.text : "",
      ),
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

type WatchTextModule = typeof import("./page-watcher-text");
let watchTextModule: Promise<WatchTextModule> | null = null;
/** node-html-parser is the largest dependency in the main bundle; load it when a watcher first needs it, not at launch. */
function loadWatchText(): Promise<WatchTextModule> {
  watchTextModule ??= import("./page-watcher-text");
  watchTextModule.catch(() => {
    watchTextModule = null;
  });
  return watchTextModule;
}

async function readWatchedText(watcher: PageWatcher): Promise<WatchTextResult> {
  // Even for rendering, fetch first: it confirms the address is a web page (not a download).
  const page = await fetchPage(watcher.url);
  if (watcher.renderJs) return renderPage(watcher.url, watcher.selector);
  if (/text\/plain/i.test(page.type))
    return watcher.selector
      ? {
          ok: false,
          error: "This address is plain text; watch the whole page instead.",
        }
      : { ok: true, lines: normalizeWatchText(page.body) };
  return (await loadWatchText()).extractWatchText(page.body, watcher.selector);
}

function notifyChange(watcher: PageWatcher): void {
  if (!Notification.isSupported() || !watcher.lastDiff) return;
  notifications.get(watcher.id)?.close();
  const notification = new Notification({
    title: `${watcher.title} changed`,
    body: `${changeSummary(watcher.lastDiff)} · ${APP_NAME} page watcher`,
    silent: false,
  });
  notification.on("click", () => revealPageWatchers(watcher.id, "diff"));
  notification.on("close", () => {
    if (notifications.get(watcher.id) === notification)
      notifications.delete(watcher.id);
  });
  notifications.set(watcher.id, notification);
  notification.show();
}

async function runCheck(id: string): Promise<void> {
  const watcher = watchers.find((candidate) => candidate.id === id);
  if (!watcher || running.has(id) || disposed) return;
  const blocked = backgroundNetworkBlockedReason();
  if (blocked) {
    replace(deferCheck(watcher, blocked, Date.now()));
    persist();
    publish();
    schedule();
    return;
  }
  running.add(id);
  publish();
  let result: WatchTextResult;
  try {
    result = await readWatchedText(watcher);
  } catch (error) {
    result = {
      ok: false,
      error:
        error instanceof Error
          ? error.message.replace(/^net::/, "")
          : String(error),
    };
  } finally {
    running.delete(id);
  }
  // Edited (or deleted) while it ran: that result is about the old target.
  const current = watchers.find((candidate) => candidate.id === id);
  if (disposed) return;
  if (
    !current ||
    current.selector !== watcher.selector ||
    current.renderJs !== watcher.renderJs ||
    current.url !== watcher.url
  ) {
    publish();
    schedule();
    return;
  }
  const now = Date.now();
  if (result.ok) {
    const outcome = applyCheckSuccess(current, result.lines, now);
    replace(outcome.watcher);
    if (outcome.changed) notifyChange(outcome.watcher);
  } else {
    replace(applyCheckFailure(current, result.error, now));
  }
  persist();
  publish();
  schedule();
}

/** Show Settings → Watchers, optionally with one watcher opened (its diff, or its settings). */
export function revealPageWatchers(
  focusId?: string,
  mode: "diff" | "edit" = "diff",
): void {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  setBrowserChromeState({ sidebarMode: "watchers" });
  if (focusId) {
    // Let the section mount before asking it to open the watcher.
    setTimeout(() => {
      try {
        sendToMainWindowRenderers("browser:watchers:focus", {
          id: focusId,
          mode,
        });
      } catch {
        /* window closing */
      }
    }, 200);
  }
}

export function canWatchPage(url: string): boolean {
  return normalizeWatchUrl(url) !== null;
}

async function addWatcher(
  input: NewWatcherInput,
): Promise<
  { ok: true; watcher: PageWatcherSummary } | { ok: false; error: string }
> {
  const { isSupportedWatchSelector } = await loadWatchText();
  load();
  if (input.selector && !isSupportedWatchSelector(input.selector))
    return { ok: false, error: "That CSS selector is not supported." };
  const result = createWatcher(input, watchers, randomUUID(), Date.now());
  if (!result.ok) return result;
  watchers = [...watchers, result.watcher];
  persist();
  publish();
  // First check now (it takes the baseline), unless the app just started.
  if (Date.now() - startedAt >= STARTUP_DELAY_MS)
    void runCheck(result.watcher.id);
  else schedule();
  return { ok: true, watcher: summarizeWatcher(result.watcher) };
}

/** Element picker for "Watch Part of This Page…": hover highlights, click picks, Esc cancels. */
const PICKER_SCRIPT = `new Promise((resolve) => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = '<style>.box{position:fixed;border:2px solid #0a84ff;background:rgba(10,132,255,.12);border-radius:3px;transition:all 60ms;pointer-events:none}.tip{position:fixed;left:50%;top:12px;transform:translateX(-50%);font:13px -apple-system,system-ui,sans-serif;background:#1c1c1e;color:#fff;padding:7px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3)}</style><div class="box"></div><div class="tip">Click the part of the page to watch · Esc to cancel</div>';
  const box = shadow.querySelector('.box');
  (document.body || document.documentElement).appendChild(host);
  let current = null;
  const sane = (value) => /^[A-Za-z][\\w-]{0,63}$/.test(value) && !/\\d{4,}/.test(value);
  const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1; } catch { return false; } };
  const selectorFor = (element) => {
    if (element.id && sane(element.id) && unique('#' + CSS.escape(element.id))) return '#' + CSS.escape(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement && parts.length < 10) {
      if (node !== element && node.id && sane(node.id) && unique('#' + CSS.escape(node.id))) { parts.unshift('#' + CSS.escape(node.id)); return parts.join(' > '); }
      let part = node.localName;
      const classes = [...node.classList].filter(sane).slice(0, 2);
      if (classes.length) part += classes.map((name) => '.' + CSS.escape(name)).join('');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((child) => child.localName === node.localName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
      if (parts.length >= 2 && unique(parts.join(' > '))) return parts.join(' > ');
    }
    return (node === document.body ? 'body > ' : '') + parts.join(' > ');
  };
  const place = (element) => {
    const rect = element.getBoundingClientRect();
    box.style.left = rect.left + 'px'; box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px'; box.style.height = rect.height + 'px';
  };
  const finish = (value) => {
    clearTimeout(timeout);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', swallow, true);
    document.removeEventListener('mouseup', swallow, true);
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    resolve(value);
  };
  const onMove = (event) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (element && element !== current && element !== host) { current = element; place(element); }
  };
  const swallow = (event) => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
  const onClick = (event) => {
    swallow(event);
    const element = document.elementFromPoint(event.clientX, event.clientY) || current;
    if (!element) return finish(null);
    finish({ selector: selectorFor(element), preview: String(element.innerText || element.textContent || '').trim().slice(0, 200) });
  };
  const onKey = (event) => { if (event.key === 'Escape') { swallow(event); finish(null); } };
  const timeout = setTimeout(() => finish(null), 120000);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', swallow, true);
  document.addEventListener('mouseup', swallow, true);
  document.addEventListener('keydown', onKey, true);
})`;

let picking = false;

/** Context menu: "Watch This Page for Changes…" / "Watch Part of This Page…" on a normal tab. */
export async function watchPageFromTab(
  contents: WebContents,
  mode: "page" | "pick",
  title: string,
): Promise<void> {
  if (contents.isDestroyed()) return;
  const url = contents.getURL();
  if (!canWatchPage(url)) return;
  let selector: string | null = null;
  if (mode === "pick") {
    if (picking) return;
    picking = true;
    try {
      contents.focus();
      const picked = (await contents.executeJavaScriptInIsolatedWorld(
        PICKER_WORLD_ID,
        [{ code: PICKER_SCRIPT }],
        true,
      )) as { selector?: unknown } | null;
      if (!picked || typeof picked.selector !== "string") return;
      selector = picked.selector;
    } catch (error) {
      console.warn("[watchers] element picker failed:", error);
      return;
    } finally {
      picking = false;
    }
    if (contents.isDestroyed() || contents.getURL() !== url) return;
  }
  const result = await addWatcher({ url, title, selector });
  if (!result.ok) {
    const window = getMainWindow();
    const options = {
      type: "info" as const,
      message: "Could not watch this page",
      detail: result.error,
      buttons: ["OK"],
    };
    if (window && !window.isDestroyed())
      void dialog.showMessageBox(window, options);
    else void dialog.showMessageBox(options);
    return;
  }
  revealPageWatchers(result.watcher.id, "edit");
}

async function updateWatcher(
  id: unknown,
  patch: unknown,
): Promise<
  { ok: true; snapshot: PageWatchersSnapshot } | { ok: false; error: string }
> {
  const { isSupportedWatchSelector } = await loadWatchText();
  load();
  const watcher =
    typeof id === "string"
      ? watchers.find((candidate) => candidate.id === id)
      : undefined;
  if (!watcher) return { ok: false, error: "That watcher no longer exists." };
  const record =
    typeof patch === "object" && patch !== null
      ? (patch as Record<string, unknown>)
      : {};
  const clean: WatcherPatch = {};
  if (typeof record.title === "string") clean.title = record.title;
  if (record.selector === null || typeof record.selector === "string")
    clean.selector = record.selector;
  if (typeof record.intervalMinutes === "number")
    clean.intervalMinutes =
      record.intervalMinutes as WatcherPatch["intervalMinutes"];
  if (typeof record.renderJs === "boolean") clean.renderJs = record.renderJs;
  if (typeof record.paused === "boolean") clean.paused = record.paused;
  if (record.seen === true) clean.seen = true;
  if (
    typeof clean.selector === "string" &&
    clean.selector.trim() &&
    !isSupportedWatchSelector(clean.selector.trim())
  )
    return { ok: false, error: "That CSS selector is not supported." };
  const result = editWatcher(watcher, clean, Date.now());
  if (!result.ok) return { ok: false, error: result.error };
  replace(result.watcher);
  if (result.watcher.unseen !== watcher.unseen && !result.watcher.unseen)
    notifications.get(id as string)?.close();
  persist();
  publish();
  schedule();
  return { ok: true, snapshot: snapshot() };
}

function deleteWatcher(id: unknown): PageWatchersSnapshot {
  load();
  if (typeof id !== "string") return snapshot();
  notifications.get(id)?.close();
  notifications.delete(id);
  watchers = watchers.filter((watcher) => watcher.id !== id);
  persist();
  publish();
  schedule();
  return snapshot();
}

function checkNow(id: unknown): PageWatchersSnapshot {
  load();
  const watcher =
    typeof id === "string"
      ? watchers.find((candidate) => candidate.id === id)
      : undefined;
  if (watcher && !running.has(watcher.id)) void runCheck(watcher.id);
  return snapshot();
}

/**
 * IPC handlers, registered (behind the "Enable page watchers" gate and the app-window check) by
 * page-watchers-feature.ts, which only imports this module while watchers are on.
 */
export const pageWatcherIpcHandlers = {
  list: (): PageWatchersSnapshot => snapshot(),
  add: (
    input: unknown,
  ):
    | Promise<
        { ok: true; watcher: PageWatcherSummary } | { ok: false; error: string }
      >
    | { ok: false; error: string } => {
    const record =
      typeof input === "object" && input !== null
        ? (input as Record<string, unknown>)
        : {};
    if (typeof record.url !== "string")
      return { ok: false, error: "Enter a web address to watch." };
    return addWatcher({
      url: record.url,
      title: typeof record.title === "string" ? record.title : undefined,
      selector:
        typeof record.selector === "string" && record.selector.trim()
          ? record.selector.trim()
          : null,
      intervalMinutes:
        typeof record.intervalMinutes === "number"
          ? (record.intervalMinutes as NewWatcherInput["intervalMinutes"])
          : undefined,
      renderJs: record.renderJs === true,
    });
  },
  update: (id: unknown, patch: unknown) => updateWatcher(id, patch),
  delete: (id: unknown): PageWatchersSnapshot => deleteWatcher(id),
  checkNow: (id: unknown): PageWatchersSnapshot => checkNow(id),
};

let resumeHooked = false;

/** Start the schedule. `startupHold: false` (turned back on in Settings) checks due watchers right away. */
export function initializePageWatchers(
  options: { startupHold?: boolean } = {},
): void {
  load();
  startedAt =
    options.startupHold === false ? Date.now() - STARTUP_DELAY_MS : Date.now();
  disposed = false;
  // After sleep the timers are stale; look again.
  if (!resumeHooked) {
    resumeHooked = true;
    try {
      powerMonitor.on("resume", () => schedule());
    } catch {
      /* not available in tests */
    }
  }
  schedule();
}

export function disposePageWatchers(): void {
  disposed = true;
  if (timer) clearTimeout(timer);
  timer = null;
  for (const notification of notifications.values()) notification.close();
  notifications.clear();
}
