import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { EXTENSION_PAGE_TABS_SHIM } from "./extension-tabs-shim.ts";

export const BRAMBLE_BROWSER_ALIAS_FILE = "surffish-bramble-browser-alias.js";
export const BRAMBLE_BACKGROUND_WORKER_FILE = "surffish-bramble-background.js";

const PICKER_SETTLE_GUARD =
  /var ([\w$]+)=500,([\w$]+)=-1\/0;function [\w$]+\(\)\{\2=performance\.now\(\)\}function [\w$]+\(\)\{return performance\.now\(\)-\2<\1\}/g;
const PICKER_SETTLE_MS = 100;

export type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Shorten only the fixed picker settle delay. Bramble's original browser-visibility
 * behavior and the content script's final geometry/hit test remain untouched.
 */
export function adaptBrambleAutofillSettleDelay(contentScript: string): string {
  const settleMatches = [...contentScript.matchAll(PICKER_SETTLE_GUARD)];
  if (settleMatches.length !== 1) {
    throw new Error(
      "The Bramble release uses an unsupported autofill click guard; refusing an unsafe or incomplete adaptation.",
    );
  }
  // 100 ms still rejects clicks already in flight when a page opens or moves the picker,
  // while avoiding the upstream half-second no-op on a suggestion the user has aimed at.
  return contentScript.replace(PICKER_SETTLE_GUARD, (guard) =>
    guard.replace("=500,", `=${PICKER_SETTLE_MS},`),
  );
}

/** Accept extension UI navigation only when it remains on Bramble's loaded extension origin. */
export function isBrambleExtensionUrl(
  candidate: string,
  extensionUrl: string,
): boolean {
  try {
    const requested = new URL(candidate);
    const extension = new URL(extensionUrl);
    return (
      requested.protocol === "chrome-extension:" &&
      extension.protocol === "chrome-extension:" &&
      requested.host === extension.host &&
      !requested.username &&
      !requested.password &&
      !requested.port
    );
  } catch {
    return false;
  }
}

/**
 * Convert Bramble's Firefox MV3 event-page build into the Electron MV3 shape.
 * This is intentionally narrow: it refuses arbitrary extensions and only adapts
 * Bramble's known Firefox bundle entry points. It does not emulate browser APIs
 * that Electron does not provide.
 */
export function adaptBrambleFirefoxManifest(input: unknown): JsonRecord {
  if (
    !isRecord(input) ||
    input.name !== "Bramble" ||
    input.manifest_version !== 3
  ) {
    throw new Error(
      "Select Bramble’s unpacked Firefox build (Manifest V3, name “Bramble”).",
    );
  }

  const background = record(input.background);
  const scripts = Array.isArray(background.scripts) ? background.scripts : [];
  if (
    background.type !== "module" ||
    scripts.length !== 1 ||
    scripts[0] !== "background.js"
  ) {
    throw new Error(
      "Surffish supports Bramble’s Firefox module background at background.js.",
    );
  }

  const manifest = structuredClone(input) as JsonRecord;
  delete manifest.browser_specific_settings;

  const adaptedBackground: JsonRecord = { ...background };
  delete adaptedBackground.scripts;
  adaptedBackground.service_worker = BRAMBLE_BACKGROUND_WORKER_FILE;
  adaptedBackground.type = "module";
  manifest.background = adaptedBackground;

  // `identity` is only used by Bramble's optional Google Drive OAuth backup flow.
  // It is not available in Electron and is not required for local vault setup/unlock.
  if (Array.isArray(manifest.permissions)) {
    manifest.permissions = manifest.permissions.filter(
      (permission) => permission !== "identity",
    );
  }
  const optionalPermissions = manifest.optional_permissions;
  if (Array.isArray(optionalPermissions)) {
    const filteredOptionalPermissions = optionalPermissions.filter(
      (permission) => permission !== "identity",
    );
    if (filteredOptionalPermissions.length === 0)
      delete manifest.optional_permissions;
    else manifest.optional_permissions = filteredOptionalPermissions;
  }

  const action = record(manifest.action);
  if (Object.hasOwn(action, "theme_icons")) {
    delete action.theme_icons;
    manifest.action = action;
  }

  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts = manifest.content_scripts.map((entry) => {
      if (
        !isRecord(entry) ||
        entry.world === "MAIN" ||
        !Array.isArray(entry.js)
      )
        return entry;
      const js = entry.js.filter(
        (file): file is string => typeof file === "string",
      );
      return {
        ...entry,
        js: js.includes(BRAMBLE_BROWSER_ALIAS_FILE)
          ? js
          : [BRAMBLE_BROWSER_ALIAS_FILE, ...js],
      };
    });
  }

  return manifest;
}

/** Install `browser` as a compatibility alias only in extension-owned contexts. */
export const BRAMBLE_BROWSER_ALIAS_SOURCE = `(() => {
  if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
    Object.defineProperty(globalThis, 'browser', {
      configurable: true,
      enumerable: true,
      value: globalThis.chrome
    });
  }
  const extensionApi = globalThis.browser;
  // Electron 44 never fires chrome.storage.onChanged in an extension service worker (pages get it),
  // so Bramble's background missed e.g. an auto-lock timeout change until its next restart. The
  // always-running offscreen page relays storage changes to the worker, which replays them to the
  // listeners Bramble registered. Only the "local" area is relayed (prefs, vault metadata): the
  // "session" area holds key material and Bramble's worker already re-reads it directly. Large
  // values (vault blobs) travel as keys only, which is all Bramble's worker listeners read.
  // Replaying stops once the native event is seen in the worker (a future Electron fix).
  const STORAGE_MESSAGE = '__surffishBrambleStorageChanged';
  const STORAGE_MAX_VALUE_CHARS = 64 * 1024;
  const isStorageRelay = (message) => !!message && typeof message === 'object' && Object.prototype.hasOwnProperty.call(message, STORAGE_MESSAGE);
  const extensionContext = typeof globalThis.document === 'undefined' || globalThis.location?.protocol === 'chrome-extension:';
  const runtimeOnMessage = extensionApi?.runtime?.onMessage;
  const addRuntimeListener = runtimeOnMessage && typeof runtimeOnMessage.addListener === 'function' ? runtimeOnMessage.addListener.bind(runtimeOnMessage) : null;
  if (extensionContext && addRuntimeListener && !runtimeOnMessage.__surffishStorageFiltered) {
    const removeRuntimeListener = runtimeOnMessage.removeListener.bind(runtimeOnMessage);
    const hasRuntimeListener = runtimeOnMessage.hasListener.bind(runtimeOnMessage);
    const wrapped = new WeakMap();
    try {
      Object.defineProperty(runtimeOnMessage, '__surffishStorageFiltered', { value: true });
      Object.defineProperty(runtimeOnMessage, 'addListener', {
        configurable: true,
        value: (listener) => {
          if (typeof listener !== 'function') return addRuntimeListener(listener);
          let wrapper = wrapped.get(listener);
          if (!wrapper) {
            wrapper = function (message, sender, sendResponse) { return isStorageRelay(message) ? undefined : listener.call(this, message, sender, sendResponse); };
            wrapped.set(listener, wrapper);
          }
          return addRuntimeListener(wrapper);
        }
      });
      Object.defineProperty(runtimeOnMessage, 'removeListener', { configurable: true, value: (listener) => removeRuntimeListener(wrapped.get(listener) || listener) });
      Object.defineProperty(runtimeOnMessage, 'hasListener', { configurable: true, value: (listener) => hasRuntimeListener(wrapped.get(listener) || listener) });
    } catch {}
  }
  const storageOnChanged = extensionApi?.storage?.onChanged;
  if (typeof globalThis.document === 'undefined' && storageOnChanged && addRuntimeListener && !storageOnChanged.__surffishRelay) {
    const listeners = new Set();
    let nativeEvents = false;
    const nativeAdd = storageOnChanged.addListener.bind(storageOnChanged);
    const nativeRemove = storageOnChanged.removeListener.bind(storageOnChanged);
    try {
      nativeAdd(() => { nativeEvents = true; });
      Object.defineProperty(storageOnChanged, '__surffishRelay', { value: true });
      Object.defineProperty(storageOnChanged, 'addListener', { configurable: true, value: (listener) => { if (typeof listener === 'function') listeners.add(listener); return nativeAdd(listener); } });
      Object.defineProperty(storageOnChanged, 'removeListener', { configurable: true, value: (listener) => { listeners.delete(listener); return nativeRemove(listener); } });
      Object.defineProperty(storageOnChanged, 'hasListener', { configurable: true, value: (listener) => listeners.has(listener) });
      Object.defineProperty(storageOnChanged, 'hasListeners', { configurable: true, value: () => listeners.size > 0 });
      const offscreenUrl = extensionApi.runtime.getURL('offscreen.html');
      addRuntimeListener((message, sender) => {
        if (!isStorageRelay(message) || nativeEvents) return undefined;
        // Only Bramble's own offscreen page relays. (Electron reports a tab even for extension pages,
        // so the check is the sender URL: a content script's sender URL is the web page's.)
        if (!sender || sender.id !== extensionApi.runtime.id || typeof sender.url !== 'string' || sender.url.split('#')[0] !== offscreenUrl) return undefined;
        const relay = message[STORAGE_MESSAGE];
        if (!relay || typeof relay !== 'object' || relay.area !== 'local' || !relay.changes || typeof relay.changes !== 'object') return undefined;
        for (const listener of [...listeners]) {
          try { listener(relay.changes, relay.area); } catch (error) { try { console.error(error); } catch {} }
        }
        return undefined;
      });
    } catch {}
  }
  if (typeof globalThis.document !== 'undefined' && globalThis.location?.protocol === 'chrome-extension:' &&
      globalThis.location.pathname === '/offscreen.html' && storageOnChanged && extensionApi?.runtime?.sendMessage) {
    const small = (value) => {
      if (value === undefined) return true;
      try { const text = JSON.stringify(value); return typeof text !== 'string' || text.length <= STORAGE_MAX_VALUE_CHARS; } catch { return false; }
    };
    storageOnChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes) return;
      const relayed = {};
      for (const key of Object.keys(changes)) {
        const change = changes[key] || {};
        relayed[key] = small(change.oldValue) && small(change.newValue) ? change : {};
      }
      if (Object.keys(relayed).length === 0) return;
      try {
        const sent = extensionApi.runtime.sendMessage({ [STORAGE_MESSAGE]: { area, changes: relayed } });
        if (sent && typeof sent.catch === 'function') sent.catch(() => {});
      } catch {}
    });
  }
  if (typeof globalThis.document === 'undefined' && extensionApi && typeof extensionApi.offscreen === 'undefined') {
    try {
      Object.defineProperty(extensionApi, 'offscreen', {
        configurable: true,
        value: {
          Reason: { WORKERS: 'WORKERS', CLIPBOARD: 'CLIPBOARD', WEB_RTC: 'WEB_RTC' },
          hasDocument: async () => true,
          createDocument: async () => {}
        }
      });
    } catch {}
  }
  // Electron has no chrome.windows. Bramble's autofill "Vault locked" row (and the passkey unlock)
  // asks the background to windows.create its popup, which threw and did nothing. In the worker,
  // forward create/remove to the offscreen page; in the offscreen page, hand them to Surffish.
  const WINDOWS_MESSAGE = '__surffishBrambleWindows';
  const POPOUT_WINDOW_ID = 1;
  if (typeof globalThis.document === 'undefined' && extensionApi?.runtime && typeof extensionApi.windows === 'undefined') {
    const forward = (op, url) => {
      try {
        const sent = extensionApi.runtime.sendMessage({ [WINDOWS_MESSAGE]: op, url });
        if (sent && typeof sent.catch === 'function') sent.catch(() => {});
      } catch {}
    };
    const noWindow = async () => { throw new Error('No window with that id.'); };
    try {
      Object.defineProperty(extensionApi, 'windows', {
        configurable: true,
        value: {
          WINDOW_ID_NONE: -1,
          WINDOW_ID_CURRENT: -2,
          create: async (info) => {
            const raw = info && (Array.isArray(info.url) ? info.url[0] : info.url);
            const url = typeof raw === 'string' ? new URL(raw, extensionApi.runtime.getURL('/')).href : undefined;
            forward('create', url);
            return { id: POPOUT_WINDOW_ID, focused: true, type: 'popup', state: 'normal', alwaysOnTop: false, incognito: false };
          },
          remove: async (id) => { if (id === POPOUT_WINDOW_ID) forward('remove'); },
          update: async (id) => ({ id, focused: true }),
          get: noWindow,
          getCurrent: noWindow,
          getLastFocused: noWindow,
          getAll: async () => [],
          onRemoved: { addListener() {}, removeListener() {}, hasListener: () => false },
          onFocusChanged: { addListener() {}, removeListener() {}, hasListener: () => false }
        }
      });
    } catch {}
  }
  // Electron's action.openPopup resolves without opening anything, so Bramble's passkey and
  // save prompts ("Unlock & Use") never fell back to windows.create. Reject so they do.
  if (typeof globalThis.document === 'undefined' && extensionApi?.action && typeof extensionApi.action.openPopup === 'function') {
    try {
      Object.defineProperty(extensionApi.action, 'openPopup', {
        configurable: true,
        value: async () => { throw new Error('openPopup is unavailable in Surffish.'); }
      });
    } catch {}
  }
  const brambleBridge = globalThis.surffishBramble;
  if (typeof globalThis.document !== 'undefined' && extensionApi?.runtime?.onMessage && typeof brambleBridge?.openPopout === 'function') {
    extensionApi.runtime.onMessage.addListener((message) => {
      const op = message && message[WINDOWS_MESSAGE];
      if (op === 'create') void brambleBridge.openPopout(typeof message.url === 'string' ? message.url : '').catch(() => {});
      else if (op === 'remove') void brambleBridge.closePopout().catch(() => {});
      return false;
    });
  }
  if (typeof globalThis.document !== 'undefined' && typeof brambleBridge?.writeClipboard === 'function' && globalThis.navigator?.clipboard) {
    try {
      Object.defineProperty(globalThis.navigator.clipboard, 'writeText', {
        configurable: true,
        value: (text) => brambleBridge.writeClipboard(text)
      });
    } catch {}
  }
  // chrome.tabs in Bramble's popup and options/setup tab: Electron gives extension pages no tabs.create
  // (Settings → Backups → Restore / Import call tabs.create({ url: 'options.html?screen=…' })) and a
  // tabs.query that cannot see Surffish's tabs (the popup's current-site lookup). Route them to
  // Surffish's tabs, the same shim Web Store extension pages get. Not in the hidden offscreen host.
  if (typeof globalThis.document !== 'undefined' && globalThis.location?.protocol === 'chrome-extension:' &&
      globalThis.location.pathname !== '/offscreen.html') {
    (${EXTENSION_PAGE_TABS_SHIM})(extensionApi, globalThis.surffishExtensionHost);
  }
  if (typeof globalThis.document !== 'undefined' && extensionApi?.runtime &&
      typeof brambleBridge?.openOptionsPage === 'function' && typeof extensionApi.runtime.openOptionsPage === 'function') {
    try {
      Object.defineProperty(extensionApi.runtime, 'openOptionsPage', {
        configurable: true,
        value: async () => brambleBridge.openOptionsPage()
      });
    } catch {}
  }
})();
`;

/** Ensure the alias runs before ESM code in a Bramble-owned HTML page. */
export function injectBrambleBrowserAlias(html: string): string {
  const script = `<script src="./${BRAMBLE_BROWSER_ALIAS_FILE}"></script>`;
  if (html.includes(BRAMBLE_BROWSER_ALIAS_FILE)) return html;
  if (/<\/head\s*>/i.test(html))
    return html.replace(/<\/head\s*>/i, `  ${script}\n</head>`);
  if (/<body\b[^>]*>/i.test(html))
    return html.replace(/<body\b[^>]*>/i, (body) => `${body}\n  ${script}`);
  return `${script}\n${html}`;
}

/** Keep the real popup usable on compact displays without changing the selected source build. */
export function adaptBramblePopupViewport(html: string): string {
  const marker = "data-surffish-bramble-viewport";
  if (html.includes(marker)) return html;
  const style = `<style ${marker}>html, body { box-sizing: border-box; width: 100%; max-width: 500px; min-width: 0; height: 100%; min-height: 0; margin: 0; overflow: auto; } #root { min-height: 100%; }</style>`;
  if (/<\/head\s*>/i.test(html))
    return html.replace(/<\/head\s*>/i, `  ${style}\n</head>`);
  if (/<body\b[^>]*>/i.test(html))
    return html.replace(/<body\b[^>]*>/i, (body) => `${body}\n  ${style}`);
  return `${style}\n${html}`;
}

export const BRAMBLE_QR_JOIN_FILE = "surffish-bramble-qr-join.js";
export const BRAMBLE_JSQR_FILE = "surffish-jsqr.js";

/** Load Surffish's Scan QR helper (bramble-qr-join-page.cjs) on Bramble's options page. */
export function injectBrambleQrJoinScript(html: string): string {
  if (html.includes(BRAMBLE_QR_JOIN_FILE)) return html;
  const script = `<script defer src="./${BRAMBLE_QR_JOIN_FILE}"></script>`;
  if (/<\/head\s*>/i.test(html))
    return html.replace(/<\/head\s*>/i, `  ${script}\n</head>`);
  if (/<\/body\s*>/i.test(html))
    return html.replace(/<\/body\s*>/i, `  ${script}\n</body>`);
  return `${html}\n${script}\n`;
}

/**
 * Add Surffish's "Scan QR" to Bramble's Join a device form in a staged copy: the page script, the jsQR
 * fallback decoder (when the build ships it) and one <script> tag in options.html. Idempotent, so it
 * also refreshes builds staged by an older Surffish. Bramble's own files are not otherwise touched.
 */
export function addBrambleQrJoin(
  stagedDirectory: string,
  pageScript: string,
  jsqrSource: string | null,
): void {
  const optionsPath = join(stagedDirectory, "options.html");
  if (!existsSync(optionsPath)) return;
  writeFileSync(join(stagedDirectory, BRAMBLE_QR_JOIN_FILE), pageScript);
  const jsqrPath = join(stagedDirectory, BRAMBLE_JSQR_FILE);
  if (jsqrSource) writeFileSync(jsqrPath, jsqrSource);
  else rmSync(jsqrPath, { force: true });
  const html = readFileSync(optionsPath, "utf8");
  const adapted = injectBrambleQrJoinScript(html);
  if (adapted !== html) writeFileSync(optionsPath, adapted);
}

export const BRAMBLE_BACKGROUND_WORKER_SOURCE = `import './${BRAMBLE_BROWSER_ALIAS_FILE}';
import './background.js';
`;

function listHtmlFiles(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...listHtmlFiles(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
      paths.push(path);
  }
  return paths;
}

/**
 * Copy the Firefox build to an app-owned location, adapt only the copy, and return
 * the manifest version. Source files in the Bramble checkout remain untouched.
 */
export function stageBrambleFirefoxBuild(
  sourceDirectory: string,
  targetDirectory: string,
): { stagedDirectory: string; version: string } {
  const source = resolve(sourceDirectory);
  const manifestPath = join(source, "manifest.json");
  if (!existsSync(manifestPath))
    throw new Error("The selected folder does not contain manifest.json.");

  let sourceManifest: unknown;
  try {
    sourceManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Bramble manifest could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const adaptedManifest = adaptBrambleFirefoxManifest(sourceManifest);
  const action = record(adaptedManifest.action);
  const popupPath = action.default_popup;
  const version =
    typeof adaptedManifest.version === "string"
      ? adaptedManifest.version
      : "unknown";
  if (typeof popupPath !== "string" || !existsSync(join(source, popupPath))) {
    throw new Error(
      "The selected Bramble build is missing its declared popup page.",
    );
  }
  if (!existsSync(join(source, "background.js"))) {
    throw new Error("The selected Bramble build is missing background.js.");
  }
  const hostPatterns = Array.isArray(adaptedManifest.host_permissions)
    ? adaptedManifest.host_permissions
    : [];
  if (!hostPatterns.includes("<all_urls>")) {
    throw new Error(
      "Bramble’s declared <all_urls> site access must be visible before loading.",
    );
  }

  const stagedDirectory = resolve(targetDirectory);
  rmSync(stagedDirectory, { recursive: true, force: true });
  mkdirSync(stagedDirectory, { recursive: true });
  cpSync(source, stagedDirectory, { recursive: true, dereference: false });
  writeFileSync(
    join(stagedDirectory, "manifest.json"),
    `${JSON.stringify(adaptedManifest, null, 2)}\n`,
  );
  writeFileSync(
    join(stagedDirectory, BRAMBLE_BROWSER_ALIAS_FILE),
    BRAMBLE_BROWSER_ALIAS_SOURCE,
  );
  writeFileSync(
    join(stagedDirectory, BRAMBLE_BACKGROUND_WORKER_FILE),
    BRAMBLE_BACKGROUND_WORKER_SOURCE,
  );

  const contentScriptPath = join(stagedDirectory, "content-script.js");
  if (!existsSync(contentScriptPath)) {
    throw new Error(
      "The selected Bramble build is missing its content-script bundle.",
    );
  }
  const contentScript = adaptBrambleAutofillSettleDelay(
    readFileSync(contentScriptPath, "utf8"),
  );
  writeFileSync(contentScriptPath, contentScript);

  for (const htmlPath of listHtmlFiles(stagedDirectory)) {
    const html = readFileSync(htmlPath, "utf8");
    let adapted = injectBrambleBrowserAlias(html);
    if (basename(htmlPath) === "popup.html")
      adapted = adaptBramblePopupViewport(adapted);
    if (adapted !== html) writeFileSync(htmlPath, adapted);
  }
  return { stagedDirectory, version };
}
