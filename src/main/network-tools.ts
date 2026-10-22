import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type WebContents,
} from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { windowForContents } from "./window-scope";
import { buildHar, type HarSourceEntry } from "../shared/har";
import {
  cdpFetchPatterns,
  hasActiveOverrides,
  matchOverrideRule,
  overrideCommand,
  validateOverrideRules,
  type NetworkCopyResult,
  type NetworkHarExportResult,
  type NetworkOverrideRule,
  type NetworkOverridesState,
  type NetworkReplayResult,
} from "../shared/network-overrides";
import { toCurl, toFetch } from "../shared/request-snippets";
import { sendToMainWindowRenderers } from "./browser-shell";
import {
  getNetworkRequestDetails,
  getNetworkRequests,
  getNetworkResponseBody,
  getNetworkTabContents,
  getTrackedNetworkContents,
  isNetworkCaptureEnabled,
  onNetworkTrackerEvent,
} from "./network-inspector";

/**
 * Network inspector tools: HAR export, copy as cURL / fetch, replay, and mock / override rules.
 * All of it sits on top of the inspector, which is opt-in (off by default): overrides only run on
 * tabs the inspector has CDP attached to, through that same attachment (Fetch.enable on it, never
 * a second attach and never detaching anyone), and only while at least one rule is on. Rules live
 * in memory for this session and are dropped when the inspector is switched off.
 */

const REPLAY_MAX_BYTES = 50 * 1024 * 1024;
const REPLAY_TIMEOUT_MS = 30_000;
/** Headers net.fetch sets itself or refuses. Cookie is kept: replay re-sends what the page sent. */
const REPLAY_SKIPPED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "cookie2",
  "expect",
]);

let rules: NetworkOverrideRule[] = [];
const hits = new Map<string, number>();
type Interceptor = {
  contents: WebContents;
  listener: (
    event: Electron.Event,
    method: string,
    params: Record<string, unknown>,
  ) => void;
  fetchOn: boolean;
};
const interceptors = new Map<number, Interceptor>();

export function getNetworkOverridesState(): NetworkOverridesState {
  return {
    rules: rules.map((rule) => ({
      ...rule,
      headers: rule.headers.map((header) => ({ ...header })),
    })),
    active: hasActiveOverrides(rules) && isNetworkCaptureEnabled(),
    hits: Object.fromEntries(hits),
  };
}

let publishTimer: ReturnType<typeof setTimeout> | null = null;
function publish(): void {
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    sendToMainWindowRenderers(
      "browser:network:overrides-changed",
      getNetworkOverridesState(),
    );
  }, 100);
}

async function handlePaused(
  contents: WebContents,
  params: Record<string, unknown>,
): Promise<void> {
  const requestId =
    typeof params.requestId === "string" ? params.requestId : "";
  if (!requestId) return;
  const request = (params.request ?? {}) as { url?: unknown; method?: unknown };
  const url = typeof request.url === "string" ? request.url : "";
  const method = typeof request.method === "string" ? request.method : "GET";
  const rule = matchOverrideRule(rules, { url, method });
  try {
    if (!rule) {
      await contents.debugger.sendCommand("Fetch.continueRequest", {
        requestId,
      });
      return;
    }
    const command = overrideCommand(rule, requestId);
    await contents.debugger.sendCommand(command.method, command.params);
    hits.set(rule.id, (hits.get(rule.id) ?? 0) + 1);
    publish();
  } catch (error) {
    // A paused request must always be released, or the page hangs on it.
    console.warn(
      "Network override failed; letting the request continue:",
      error,
    );
    try {
      await contents.debugger.sendCommand("Fetch.continueRequest", {
        requestId,
      });
    } catch {
      // Request already gone (tab navigated or closed).
    }
  }
}

function attachInterceptor(contents: WebContents): Interceptor | null {
  if (contents.isDestroyed()) return null;
  const existing = interceptors.get(contents.id);
  if (existing) return existing;
  const interceptor: Interceptor = {
    contents,
    fetchOn: false,
    listener: (_event, method, params) => {
      if (method === "Fetch.requestPaused") void handlePaused(contents, params);
    },
  };
  contents.debugger.on("message", interceptor.listener);
  interceptors.set(contents.id, interceptor);
  return interceptor;
}

function dropInterceptor(contents: WebContents): void {
  const interceptor = interceptors.get(contents.id);
  if (!interceptor) return;
  interceptors.delete(contents.id);
  if (!contents.isDestroyed())
    contents.debugger.off("message", interceptor.listener);
}

/** Fetch.enable with the current patterns while a rule is on; Fetch.disable once none are. */
async function syncInterceptor(contents: WebContents): Promise<void> {
  if (contents.isDestroyed() || !contents.debugger.isAttached()) {
    dropInterceptor(contents);
    return;
  }
  const wanted = hasActiveOverrides(rules);
  const interceptor = wanted
    ? attachInterceptor(contents)
    : (interceptors.get(contents.id) ?? null);
  if (!interceptor) return;
  try {
    if (wanted) {
      // Calling enable again replaces the patterns.
      await contents.debugger.sendCommand("Fetch.enable", {
        patterns: cdpFetchPatterns(rules),
      });
      interceptor.fetchOn = true;
    } else {
      if (interceptor.fetchOn)
        await contents.debugger.sendCommand("Fetch.disable");
      dropInterceptor(contents);
    }
  } catch (error) {
    console.warn("Could not update network overrides for a tab:", error);
  }
}

function syncAll(): void {
  for (const { contents } of getTrackedNetworkContents())
    void syncInterceptor(contents);
}

let hooksInstalled = false;
export function initializeNetworkTools(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  onNetworkTrackerEvent((event) => {
    if (event.type === "attached") {
      if (hasActiveOverrides(rules)) void syncInterceptor(event.contents);
      publish();
    } else if (event.type === "detached") {
      dropInterceptor(event.contents);
    } else {
      // Inspector switched off: no hidden overrides survive it.
      for (const interceptor of [...interceptors.values()])
        dropInterceptor(interceptor.contents);
      rules = [];
      hits.clear();
      publish();
    }
  });
}

export function setNetworkOverrides(input: unknown): NetworkOverridesState {
  const next = validateOverrideRules(input);
  rules = next;
  for (const id of [...hits.keys()])
    if (!next.some((rule) => rule.id === id)) hits.delete(id);
  syncAll();
  publish();
  return getNetworkOverridesState();
}

function snippetRequest(
  details: NonNullable<Awaited<ReturnType<typeof getNetworkRequestDetails>>>,
): {
  method: string;
  url: string;
  headers: { name: string; value: string }[];
  body: string | null;
} {
  return {
    method: details.method,
    url: details.url,
    headers: details.requestHeaders,
    body: details.requestBodyAvailable ? details.requestBody : null,
  };
}

function payloadWarning(
  details: NonNullable<Awaited<ReturnType<typeof getNetworkRequestDetails>>>,
): string | null {
  if (details.requestBodyAvailable && details.requestBody === null)
    return "Chromium didn’t keep this request’s payload, so it’s left out.";
  if (details.requestBodyTruncated)
    return "The payload was cut to 128 KB when captured.";
  return null;
}

export async function copyNetworkRequestAs(
  id: unknown,
  format: unknown,
): Promise<NetworkCopyResult> {
  if (typeof id !== "string" || (format !== "curl" && format !== "fetch"))
    throw new Error("Invalid copy request.");
  const details = await getNetworkRequestDetails(id);
  if (!details) throw new Error("This request is no longer retained.");
  const request = snippetRequest(details);
  const text = format === "curl" ? toCurl(request) : toFetch(request);
  clipboard.writeText(text);
  return { text, warning: payloadWarning(details) };
}

export async function replayNetworkRequest(
  id: unknown,
): Promise<NetworkReplayResult> {
  if (typeof id !== "string") throw new Error("Invalid request identifier.");
  const details = await getNetworkRequestDetails(id);
  if (!details) throw new Error("This request is no longer retained.");
  const started = performance.now();
  const failure = (error: string): NetworkReplayResult => ({
    ok: false,
    status: null,
    statusText: "",
    sizeBytes: 0,
    sizeCapped: false,
    durationMs: Math.round(performance.now() - started),
    finalUrl: details.url,
    redirected: false,
    error,
  });
  let parsed: URL;
  try {
    parsed = new URL(details.url);
  } catch {
    return failure("This request’s URL can’t be replayed.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return failure("Only HTTP and HTTPS requests can be replayed.");
  const contents = getNetworkTabContents(details.tabId);
  if (!contents) return failure("The tab that made this request is closed.");
  const headers = new Headers();
  for (const header of details.requestHeaders) {
    if (
      header.name.startsWith(":") ||
      REPLAY_SKIPPED_HEADERS.has(header.name.toLowerCase())
    )
      continue;
    try {
      headers.append(header.name, header.value);
    } catch {
      // Header net.fetch won't take; skip it.
    }
  }
  const method = details.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" || !details.requestBodyAvailable
      ? undefined
      : (details.requestBody ?? undefined);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPLAY_TIMEOUT_MS);
  try {
    // The tab's own session: same proxy route, kill switch, ad blocking and HTTPS-only rules.
    const response = await contents.session.fetch(details.url, {
      method,
      headers,
      body,
      credentials: "omit",
      signal: controller.signal,
      cache: "no-store",
    });
    let sizeBytes = 0;
    let sizeCapped = false;
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        sizeBytes += chunk.value.byteLength;
        if (sizeBytes >= REPLAY_MAX_BYTES) {
          sizeCapped = true;
          await reader.cancel();
          break;
        }
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      sizeBytes,
      sizeCapped,
      durationMs: Math.round(performance.now() - started),
      finalUrl: response.url || details.url,
      redirected: response.redirected,
      error: null,
    };
  } catch (error) {
    return failure(
      controller.signal.aborted
        ? "No response within 30 seconds."
        : error instanceof Error
          ? error.message
          : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

function timestampForFile(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export async function exportNetworkHar(
  sender: WebContents,
  options: unknown,
): Promise<NetworkHarExportResult> {
  const record =
    typeof options === "object" && options !== null
      ? (options as Record<string, unknown>)
      : {};
  const tabId =
    typeof record.tabId === "string" && record.tabId ? record.tabId : null;
  const includeBodies = record.includeBodies === true;
  const summaries = getNetworkRequests().filter(
    (request) => tabId === null || request.tabId === tabId,
  );
  if (summaries.length === 0)
    return {
      saved: false,
      path: null,
      entries: 0,
      bodies: 0,
      error: "There are no captured requests to export.",
    };
  const entries: HarSourceEntry[] = [];
  let bodies = 0;
  for (const summary of summaries) {
    const details = await getNetworkRequestDetails(summary.id);
    if (!details) continue;
    let responseBody = null;
    if (includeBodies && details.responseBodyAvailable) {
      responseBody = (await getNetworkResponseBody(details.id)).body;
      if (responseBody) bodies += 1;
    }
    entries.push({ request: details, responseBody });
  }
  const har = buildHar(entries, {
    creatorVersion: app.getVersion(),
    includeBodies,
  });
  // App surfaces live in BaseWindows, which fromWebContents doesn't know: ask the window registry first.
  const window =
    windowForContents(sender) ??
    BrowserWindow.fromWebContents(sender) ??
    BrowserWindow.getFocusedWindow();
  const dialogOptions: Electron.SaveDialogOptions = {
    title: "Export HAR",
    defaultPath: join(
      app.getPath("downloads"),
      `surffish-${tabId ? "tab" : "all"}-${timestampForFile()}.har`,
    ),
    filters: [
      { name: "HTTP Archive", extensions: ["har"] },
      { name: "JSON", extensions: ["json"] },
    ],
  };
  const choice = window
    ? await dialog.showSaveDialog(window, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (choice.canceled || !choice.filePath)
    return {
      saved: false,
      path: null,
      entries: entries.length,
      bodies,
      error: null,
    };
  try {
    await writeFile(choice.filePath, `${JSON.stringify(har, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    return {
      saved: false,
      path: null,
      entries: entries.length,
      bodies,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    saved: true,
    path: choice.filePath,
    entries: entries.length,
    bodies,
    error: null,
  };
}
