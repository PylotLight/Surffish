/**
 * Stage a Chrome Web Store extension for Electron: copy the unpacked package to an app-owned
 * directory, adapt only the copy, and inject Surffish's compatibility shim into extension-owned
 * contexts (background worker, extension pages, isolated-world content scripts), following the
 * Bramble adapter pattern. Pure Node (fs/path): unit-testable without Electron.
 *
 * The shim never fakes paid/pro state: it only fills in browser APIs Electron lacks.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import type { ExtensionSourceFile } from "../shared/extension-compat";
import { EXTENSION_PAGE_TABS_SHIM } from "./extension-tabs-shim.ts";

export const EXTENSION_SHIM_FILE = "surffish-extension-shim.js";
export const EXTENSION_BACKGROUND_WRAPPER_FILE =
  "surffish-extension-background.js";
/** Hidden relay page between Surffish and the extension's worker (see main/extension-bridge.ts). */
export const EXTENSION_BRIDGE_PAGE = "surffish-bridge.html";
export const EXTENSION_BRIDGE_SCRIPT = "surffish-bridge.js";
const SHIM_MARKER = "data-surffish-extension-shim";
/** Messages between Surffish's bridge page and its worker shim carry this key; the extension never sees them. */
export const EXTENSION_BRIDGE_KEY = "__surffishBridge";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runs before extension code in every extension-owned context Surffish controls.
 * - storage.sync → storage.local (Electron exposes storage.sync but every call throws).
 * - management.get/getSelf → minimal self info (worker + extension pages).
 * - tabs.query/get/create/update/reload/remove and runtime.openOptionsPage in extension pages →
 *   Surffish's own tabs through the narrow `surffishExtensionHost` preload bridge.
 */
export const EXTENSION_SHIM_SOURCE = `(() => {
  const api = globalThis.chrome;
  if (!api || !api.runtime || globalThis.__surffishExtensionShim) return;
  try { Object.defineProperty(globalThis, '__surffishExtensionShim', { value: true }); } catch {}
  const isWorker = typeof globalThis.document === 'undefined';
  const isExtensionPage = !isWorker && globalThis.location && globalThis.location.protocol === 'chrome-extension:';
  const define = (target, key, value) => {
    try { Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value }); return true; } catch { return false; }
  };
  const lastFunction = (args) => { const last = args[args.length - 1]; return typeof last === 'function' ? last : undefined; };
  const settle = (promise, callback) => {
    if (!callback) return promise;
    promise.then((value) => callback(value), (error) => {
      try { console.warn('[surffish] extension API call failed:', error && error.message ? error.message : error); } catch {}
      callback(undefined);
    });
    return undefined;
  };
  const noopEvent = () => ({ addListener() {}, removeListener() {}, hasListener: () => false, hasListeners: () => false });

  // storage.sync: keep data on this device in storage.local.
  const local = api.storage && api.storage.local;
  if (local) {
    const call = (name, args) => {
      const callback = lastFunction(args);
      const rest = callback ? args.slice(0, -1) : args;
      if (typeof local[name] !== 'function') return settle(Promise.resolve(name === 'getBytesInUse' ? 0 : undefined), callback);
      return settle(Promise.resolve(local[name](...rest)), callback);
    };
    define(api.storage, 'sync', Object.freeze({
      QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512,
      MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
      get: (...args) => call('get', args),
      set: (...args) => call('set', args),
      remove: (...args) => call('remove', args),
      clear: (...args) => call('clear', args),
      getBytesInUse: (...args) => call('getBytesInUse', args),
      getKeys: (...args) => call('getKeys', args),
      setAccessLevel: (...args) => settle(Promise.resolve(), lastFunction(args)),
      onChanged: local.onChanged || noopEvent()
    }));
  }

  // management: only the extension's own minimal info, as Chrome gives an extension about itself.
  if (isWorker || isExtensionPage) {
    const manifest = typeof api.runtime.getManifest === 'function' ? api.runtime.getManifest() : {};
    const message = (value) => {
      const match = typeof value === 'string' && /^__MSG_(.+)__$/.exec(value);
      if (!match) return value || '';
      try { return (api.i18n && api.i18n.getMessage(match[1])) || value; } catch { return value; }
    };
    const optionsPage = (manifest.options_ui && manifest.options_ui.page) || manifest.options_page;
    const selfInfo = () => ({
      id: api.runtime.id,
      name: message(manifest.name),
      shortName: message(manifest.short_name || manifest.name),
      description: message(manifest.description),
      version: manifest.version,
      versionName: manifest.version_name,
      mayDisable: true,
      enabled: true,
      installType: 'normal',
      type: 'extension',
      isApp: false,
      offlineEnabled: false,
      homepageUrl: manifest.homepage_url || '',
      updateUrl: '',
      optionsUrl: optionsPage ? api.runtime.getURL(optionsPage) : '',
      permissions: (manifest.permissions || []).filter((entry) => typeof entry === 'string' && !entry.includes('://') && entry !== '<all_urls>'),
      hostPermissions: manifest.host_permissions || [],
      icons: []
    });
    const management = api.management || {};
    const getSelf = (...args) => settle(Promise.resolve(selfInfo()), lastFunction(args));
    const get = (id, ...args) => settle(id === api.runtime.id ? Promise.resolve(selfInfo()) : Promise.reject(new Error('Failed to find extension with id ' + id + '.')), lastFunction(args));
    if (!api.management) {
      define(api, 'management', { getSelf, get, onEnabled: noopEvent(), onDisabled: noopEvent(), onInstalled: noopEvent(), onUninstalled: noopEvent(),
        ExtensionInstallType: { ADMIN: 'admin', DEVELOPMENT: 'development', NORMAL: 'normal', SIDELOAD: 'sideload', OTHER: 'other' } });
    } else {
      define(management, 'getSelf', getSelf);
      define(management, 'get', get);
    }
  }

  // tabs + openOptionsPage in popups/options pages: Electron does not know Surffish's tab model
  // (tabs.query sees no tabs, tabs.create is missing), so ask Surffish over its preload bridge.
  const host = globalThis.surffishExtensionHost;
  if (isExtensionPage && (${EXTENSION_PAGE_TABS_SHIM})(api, host)) {
    if (typeof host.openOptionsPage === 'function') {
      define(api.runtime, 'openOptionsPage', (callback) => settle(Promise.resolve(host.openOptionsPage()), callback));
    }
  }

  // Surffish bridge messages (webNavigation events, DNR sync) travel over runtime messaging between
  // Surffish's hidden bridge page and this shim; keep them away from the extension's own listeners.
  const BRIDGE_KEY = '__surffishBridge';
  const isBridgeMessage = (message) => !!message && typeof message === 'object' && Object.prototype.hasOwnProperty.call(message, BRIDGE_KEY);
  const onMessage = api.runtime.onMessage;
  const addRuntimeListener = onMessage && typeof onMessage.addListener === 'function' ? onMessage.addListener.bind(onMessage) : null;
  if (addRuntimeListener) {
    const removeRuntimeListener = onMessage.removeListener.bind(onMessage);
    const hasRuntimeListener = onMessage.hasListener.bind(onMessage);
    const wrapped = new WeakMap();
    define(onMessage, 'addListener', (listener) => {
      if (typeof listener !== 'function') return addRuntimeListener(listener);
      let wrapper = wrapped.get(listener);
      if (!wrapper) {
        wrapper = function (message, sender, sendResponse) { return isBridgeMessage(message) ? undefined : listener.call(this, message, sender, sendResponse); };
        wrapped.set(listener, wrapper);
      }
      return addRuntimeListener(wrapper);
    });
    define(onMessage, 'removeListener', (listener) => removeRuntimeListener(wrapped.get(listener) || listener));
    define(onMessage, 'hasListener', (listener) => hasRuntimeListener(wrapped.get(listener) || listener));
  }
  const toBridge = (message) => {
    try { return Promise.resolve(api.runtime.sendMessage({ [BRIDGE_KEY]: message })).catch(() => undefined); } catch { return Promise.resolve(undefined); }
  };
  // Surffish's service-worker preload (preload/extension-worker.cjs) gives the worker a direct
  // channel to Surffish. Without it (sandbox off, older Surffish) the hidden bridge page relays.
  const workerHost = isWorker && globalThis.surffishExtensionWorker && typeof globalThis.surffishExtensionWorker.send === 'function' ? globalThis.surffishExtensionWorker : null;
  const toHost = (message) => { try { workerHost.send(message); } catch {} };
  const fromOwnPage = (sender) => !!sender && sender.id === api.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(api.runtime.getURL('/'));

  // declarativeNetRequest: Electron stores the rules but never enforces them in Surffish (its own
  // webRequest pipeline takes precedence), so Surffish enforces them itself. Tell the bridge after
  // every change so it can read the new state back.
  const dnr = api.declarativeNetRequest;
  const safe = async (task, fallback) => { try { return await task(); } catch { return fallback; } };
  let dnrSyncing = Promise.resolve();
  const syncDnrToHost = () => {
    if (!dnr || !workerHost) return dnrSyncing;
    dnrSyncing = dnrSyncing.then(async () => {
      const enabledRulesets = await safe(() => dnr.getEnabledRulesets(), []);
      const disabledStaticRuleIds = {};
      if (typeof dnr.getDisabledRuleIds === 'function') {
        for (const rulesetId of enabledRulesets) {
          const ids = await safe(() => dnr.getDisabledRuleIds({ rulesetId }), []);
          if (ids.length > 0) disabledStaticRuleIds[rulesetId] = ids;
        }
      }
      toHost({ type: 'dnr-state', dynamicRules: await safe(() => dnr.getDynamicRules(), []), sessionRules: await safe(() => dnr.getSessionRules(), []), enabledRulesets, disabledStaticRuleIds });
    });
    return dnrSyncing;
  };
  if (dnr && (isWorker || isExtensionPage)) {
    for (const name of ['updateDynamicRules', 'updateSessionRules', 'updateEnabledRulesets', 'updateStaticRules']) {
      const original = typeof dnr[name] === 'function' ? dnr[name].bind(dnr) : null;
      if (!original) continue;
      define(dnr, name, (options, callback) => {
        const result = Promise.resolve().then(() => original(options));
        result.then(() => workerHost ? syncDnrToHost() : toBridge({ type: 'dnr-changed' }), () => {});
        if (typeof callback !== 'function') return result;
        result.then(() => callback(), (error) => {
          try { console.warn('[surffish] declarativeNetRequest.' + name + ' failed:', error && error.message ? error.message : error); } catch {}
          callback();
        });
        return undefined;
      });
    }
  }

  // notifications: not shown in Surffish, but calls must not throw.
  if (!api.notifications && (isWorker || isExtensionPage)) {
    define(api, 'notifications', {
      create: (...args) => { const id = typeof args[0] === 'string' ? args[0] : 'surffish-' + Date.now(); return settle(Promise.resolve(id), lastFunction(args)); },
      update: (...args) => settle(Promise.resolve(false), lastFunction(args)),
      clear: (...args) => settle(Promise.resolve(false), lastFunction(args)),
      getAll: (...args) => settle(Promise.resolve({}), lastFunction(args)),
      getPermissionLevel: (...args) => settle(Promise.resolve('denied'), lastFunction(args)),
      onClicked: noopEvent(), onClosed: noopEvent(), onButtonClicked: noopEvent(), onShowSettings: noopEvent(), onPermissionLevelChanged: noopEvent(),
      TemplateType: { BASIC: 'basic', IMAGE: 'image', LIST: 'list', PROGRESS: 'progress' }
    });
  }

  // storage.onChanged: Electron 44 never fires it in an extension service worker (pages get it).
  // Extension pages relay what they see to the worker over runtime messaging; the worker also
  // reports its own writes to its listeners (pages may be closed). Duplicates (the same change
  // seen by several pages, or a page relaying the worker's own write) are dropped by fingerprint.
  // A value larger than STORAGE_RELAY_MAX_CHARS is relayed as the key only. Changes made only by
  // content scripts while no extension page is open still never reach the worker. Replaying stops
  // once a native event is seen (a future Electron fix).
  const STORAGE_RELAY_MAX_CHARS = 256 * 1024;
  const storageEvent = api.storage && api.storage.onChanged;
  const jsonOf = (value) => { try { return value === undefined ? 'undefined' : JSON.stringify(value); } catch { return '?'; } };
  if (isExtensionPage && storageEvent && typeof storageEvent.addListener === 'function' && !String(globalThis.location.pathname).endsWith('/surffish-bridge.html')) {
    storageEvent.addListener((changes, area) => {
      if (!changes || typeof changes !== 'object' || typeof area !== 'string') return;
      const relayed = {};
      for (const key of Object.keys(changes)) {
        const change = changes[key] || {};
        const small = jsonOf(change.oldValue).length <= STORAGE_RELAY_MAX_CHARS && jsonOf(change.newValue).length <= STORAGE_RELAY_MAX_CHARS;
        relayed[key] = small ? change : {};
      }
      if (Object.keys(relayed).length > 0) toBridge({ type: 'storage-changed', area, changes: relayed });
    });
  }
  let storageRelay = null;
  if (isWorker && storageEvent && typeof storageEvent.addListener === 'function' && !storageEvent.__surffishRelay) {
    const listeners = new Set();
    const areaListeners = {};
    let nativeSeen = false;
    const recent = new Map();
    const DEDUPE_MS = 2000;
    const remember = (fingerprint) => recent.set(fingerprint, Date.now() + DEDUPE_MS);
    const seen = (fingerprint) => {
      const now = Date.now();
      for (const [key, expires] of recent) if (expires < now) recent.delete(key);
      return recent.has(fingerprint);
    };
    const hasAny = (area) => listeners.size > 0 || (areaListeners[area] && areaListeners[area].size > 0);
    const deliver = (area, changes) => {
      if (nativeSeen || Object.keys(changes).length === 0) return;
      for (const listener of [...listeners]) { try { listener(changes, area); } catch (error) { try { console.error(error); } catch {} } }
      for (const listener of [...(areaListeners[area] || [])]) { try { listener(changes); } catch (error) { try { console.error(error); } catch {} } }
    };
    const patchEvent = (event, set) => {
      const nativeAdd = event.addListener.bind(event);
      const nativeRemove = event.removeListener.bind(event);
      define(event, 'addListener', (listener) => { if (typeof listener === 'function') set.add(listener); return nativeAdd(listener); });
      define(event, 'removeListener', (listener) => { set.delete(listener); return nativeRemove(listener); });
      define(event, 'hasListener', (listener) => set.has(listener));
      define(event, 'hasListeners', () => set.size > 0);
    };
    try {
      storageEvent.addListener(() => { nativeSeen = true; });
      Object.defineProperty(storageEvent, '__surffishRelay', { value: true });
    } catch {}
    patchEvent(storageEvent, listeners);
    for (const areaName of ['local', 'session']) {
      const area = api.storage[areaName];
      if (!area) continue;
      areaListeners[areaName] = new Set();
      if (area.onChanged && typeof area.onChanged.addListener === 'function') patchEvent(area.onChanged, areaListeners[areaName]);
      const get = typeof area.get === 'function' ? area.get.bind(area) : null;
      if (!get) continue;
      for (const op of ['set', 'remove', 'clear']) {
        const original = typeof area[op] === 'function' ? area[op].bind(area) : null;
        if (!original) continue;
        define(area, op, (...args) => {
          const callback = lastFunction(args);
          const rest = callback ? args.slice(0, -1) : args;
          const work = (async () => {
            if (!hasAny(areaName) || nativeSeen) return original(...rest);
            const keys = op === 'set' ? Object.keys(rest[0] || {}) : op === 'remove' ? [].concat(rest[0] === undefined ? [] : rest[0]) : null;
            const before = await Promise.resolve(get(keys)).catch(() => ({}));
            const result = await original(...rest);
            const changes = {};
            if (op === 'set') {
              for (const key of keys) {
                const newJson = jsonOf(rest[0][key]);
                const oldJson = jsonOf(before ? before[key] : undefined);
                if (newJson === oldJson) continue;
                const change = { newValue: newJson === 'undefined' ? undefined : JSON.parse(newJson) };
                if (before && Object.prototype.hasOwnProperty.call(before, key)) change.oldValue = before[key];
                changes[key] = change;
              }
            } else {
              for (const key of Object.keys(before || {})) changes[key] = { oldValue: before[key] };
            }
            for (const key of Object.keys(changes)) {
              remember(areaName + '|' + key + '|' + jsonOf(changes[key].oldValue) + '|' + jsonOf(changes[key].newValue));
              remember(areaName + '|' + key + '|*');
            }
            deliver(areaName, changes);
            return result;
          })();
          return settle(work, callback);
        });
      }
    }
    storageRelay = {
      fromPage(area, changes) {
        if (typeof area !== 'string' || !changes || typeof changes !== 'object' || !hasAny(area)) return;
        const fresh = {};
        for (const key of Object.keys(changes)) {
          const change = changes[key] && typeof changes[key] === 'object' ? changes[key] : {};
          const truncated = !('oldValue' in change) && !('newValue' in change);
          const full = area + '|' + key + '|' + jsonOf(change.oldValue) + '|' + jsonOf(change.newValue);
          const star = area + '|' + key + '|*';
          if (truncated ? seen(star) : seen(full)) continue;
          remember(full);
          remember(star);
          fresh[key] = change;
        }
        deliver(area, fresh);
      }
    };
  }

  if (isWorker) {
    const bridgeUrl = api.runtime.getURL('/surffish-bridge.html');
    // tabs.query in the worker sees Surffish's hidden bridge page as a tab; hide it.
    const tabsApi = api.tabs;
    if (tabsApi && typeof tabsApi.query === 'function') {
      const query = tabsApi.query.bind(tabsApi);
      define(tabsApi, 'query', (queryInfo, callback) => {
        const result = Promise.resolve(query(queryInfo || {})).then((tabs) => (tabs || []).filter((tab) => !String(tab.url || tab.pendingUrl || '').startsWith(bridgeUrl)));
        return settle(result, typeof callback === 'function' ? callback : undefined);
      });
    }

    // webNavigation: Electron has no such API; Surffish forwards tab navigation events here.
    const navigationEvents = {};
    if (!api.webNavigation) {
      const text = (value) => typeof value === 'string' ? value : '';
      const urlFilterMatches = (filter, url) => {
        let parsed;
        try { parsed = new URL(url); } catch { return false; }
        const host = parsed.hostname, path = parsed.pathname, query = parsed.search.replace(/^\\?/, ''), full = parsed.href.split('#')[0];
        const checks = [
          ['hostContains', (v) => ('.' + host).includes(v)], ['hostEquals', (v) => host === v], ['hostPrefix', (v) => host.startsWith(v)], ['hostSuffix', (v) => host.endsWith(v)],
          ['pathContains', (v) => path.includes(v)], ['pathEquals', (v) => path === v], ['pathPrefix', (v) => path.startsWith(v)], ['pathSuffix', (v) => path.endsWith(v)],
          ['queryContains', (v) => query.includes(v)], ['queryEquals', (v) => query === v], ['queryPrefix', (v) => query.startsWith(v)], ['querySuffix', (v) => query.endsWith(v)],
          ['urlContains', (v) => full.includes(v)], ['urlEquals', (v) => full === v], ['urlPrefix', (v) => full.startsWith(v)], ['urlSuffix', (v) => full.endsWith(v)],
          ['urlMatches', (v) => { try { return new RegExp(v).test(full); } catch { return false; } }],
          ['originAndPathMatches', (v) => { try { return new RegExp(v).test(parsed.origin + path); } catch { return false; } }],
          ['schemes', (v) => Array.isArray(v) && v.includes(parsed.protocol.slice(0, -1))],
          ['ports', (v) => Array.isArray(v) && v.some((port) => { const actual = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : parsed.protocol === 'http:' ? 80 : 0)); return Array.isArray(port) ? actual >= port[0] && actual <= port[1] : actual === port; })]
        ];
        return checks.every(([key, test]) => filter[key] === undefined || test(typeof filter[key] === 'string' ? text(filter[key]) : filter[key]));
      };
      const makeEvent = (name) => {
        const listeners = [];
        return {
          addListener(listener, filters) {
            if (typeof listener !== 'function' || listeners.some((entry) => entry.listener === listener)) return;
            listeners.push({ listener, filters: filters && Array.isArray(filters.url) ? filters.url : null });
            // Surffish only wakes a stopped worker for events it listens to (as Chrome does).
            if (workerHost && listeners.length === 1) toHost({ type: 'listen', name });
          },
          removeListener(listener) { const index = listeners.findIndex((entry) => entry.listener === listener); if (index >= 0) listeners.splice(index, 1); },
          hasListener(listener) { return listeners.some((entry) => entry.listener === listener); },
          hasListeners() { return listeners.length > 0; },
          dispatch(details) {
            for (const entry of listeners.slice()) {
              if (entry.filters && !entry.filters.some((filter) => filter && typeof filter === 'object' && urlFilterMatches(filter, details.url))) continue;
              try { entry.listener(details); } catch (error) { console.error(error); }
            }
          }
        };
      };
      for (const name of ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onHistoryStateUpdated', 'onReferenceFragmentUpdated', 'onCreatedNavigationTarget', 'onTabReplaced']) {
        navigationEvents[name] = makeEvent(name);
      }
      const call = (method, details, callback) => {
        const args = details && typeof details === 'object' ? JSON.parse(JSON.stringify(details)) : {};
        const result = workerHost
          ? Promise.resolve().then(() => workerHost.call(method, args)).catch(() => null)
          : toBridge({ type: 'call', method, args }).then((response) => response && response.ok ? response.result : null);
        return settle(result, callback);
      };
      const webNavigation = {
        getFrame: (details, callback) => call('webNavigation.getFrame', details, callback),
        getAllFrames: (details, callback) => call('webNavigation.getAllFrames', details, callback)
      };
      for (const [name, event] of Object.entries(navigationEvents)) {
        webNavigation[name] = { addListener: event.addListener, removeListener: event.removeListener, hasListener: event.hasListener, hasListeners: event.hasListeners };
      }
      define(api, 'webNavigation', webNavigation);
    }

    if (addRuntimeListener) {
      addRuntimeListener((message, sender) => {
        if (!isBridgeMessage(message) || !sender || sender.id !== api.runtime.id) return undefined;
        const payload = message[BRIDGE_KEY];
        if (payload && payload.type === 'event' && navigationEvents[payload.name]) navigationEvents[payload.name].dispatch(payload.details || {});
        // An extension page changed DNR rules: with the worker channel, the worker reports them.
        else if (payload && payload.type === 'dnr-changed' && workerHost && fromOwnPage(sender)) syncDnrToHost();
        else if (payload && payload.type === 'storage-changed' && fromOwnPage(sender) && storageRelay) storageRelay.fromPage(payload.area, payload.changes);
        return undefined;
      });
    }

    if (workerHost && typeof workerHost.onMessage === 'function') {
      workerHost.onMessage(async (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'event') {
          if (navigationEvents[message.name]) navigationEvents[message.name].dispatch(message.details || {});
        } else if (message.type === 'init') {
          // Ready first: queued events (e.g. the one that woke this worker) are delivered at once.
          toHost({ type: 'ready', listening: Object.keys(navigationEvents).filter((name) => navigationEvents[name].hasListeners()) });
          // Electron never enables manifest rulesets itself: mirror Surffish's set into the native
          // API so the extension's own getEnabledRulesets() is right, then report the state.
          if (dnr && Array.isArray(message.enabledRulesets)) {
            const current = await safe(() => dnr.getEnabledRulesets(), []);
            const enableRulesetIds = message.enabledRulesets.filter((id) => !current.includes(id));
            const disableRulesetIds = current.filter((id) => !message.enabledRulesets.includes(id));
            if (enableRulesetIds.length > 0 || disableRulesetIds.length > 0) await safe(() => dnr.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds }));
          }
          if (dnr && Array.isArray(message.enabledRulesets)) await syncDnrToHost();
        }
      });
    }
  }
})();
`;

/** The bridge page: no shim (it must see the bridge messages the shim hides). */
export const EXTENSION_BRIDGE_HTML = `<!doctype html>
<!-- Surffish extension bridge (${SHIM_MARKER}: not injected here) -->
<meta charset="utf-8">
<script src="/${EXTENSION_BRIDGE_SCRIPT}"></script>
`;

/**
 * Runs in the hidden bridge page (extension origin, Surffish preload). Relays webNavigation events
 * and bridge calls from/to the worker shim, and reports declarativeNetRequest state to Surffish.
 */
export const EXTENSION_BRIDGE_SOURCE = `(() => {
  const host = globalThis.surffishExtensionBridge;
  const api = globalThis.chrome;
  if (!host || !api || !api.runtime) return;
  const KEY = '${EXTENSION_BRIDGE_KEY}';
  const dnr = api.declarativeNetRequest;
  const safe = async (task, fallback) => { try { return await task(); } catch { return fallback; } };
  const readDnr = async () => {
    const enabledRulesets = await safe(() => dnr.getEnabledRulesets(), []);
    const disabledStaticRuleIds = {};
    if (typeof dnr.getDisabledRuleIds === 'function') {
      for (const rulesetId of enabledRulesets) {
        const ids = await safe(() => dnr.getDisabledRuleIds({ rulesetId }), []);
        if (ids.length > 0) disabledStaticRuleIds[rulesetId] = ids;
      }
    }
    return {
      type: 'dnr-state',
      dynamicRules: await safe(() => dnr.getDynamicRules(), []),
      sessionRules: await safe(() => dnr.getSessionRules(), []),
      enabledRulesets,
      disabledStaticRuleIds
    };
  };
  let syncing = Promise.resolve();
  const syncDnr = () => {
    if (!dnr) return syncing;
    syncing = syncing.then(async () => host.send(await readDnr()));
    return syncing;
  };
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !Object.prototype.hasOwnProperty.call(message, KEY)) return undefined;
    if (!sender || sender.id !== api.runtime.id) return undefined;
    const payload = message[KEY] || {};
    if (payload.type === 'dnr-changed') { syncDnr(); return undefined; }
    if (payload.type === 'call') {
      Promise.resolve(host.call(payload.method, payload.args)).then(
        (result) => sendResponse({ ok: true, result }),
        (error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) })
      );
      return true;
    }
    return undefined;
  });
  host.onMessage(async (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init') {
      // Electron never enables manifest rulesets itself: mirror Surffish's set into the native API
      // so the extension's own getEnabledRulesets() is right.
      if (dnr && Array.isArray(message.enabledRulesets)) {
        const current = await safe(() => dnr.getEnabledRulesets(), []);
        const enableRulesetIds = message.enabledRulesets.filter((id) => !current.includes(id));
        const disableRulesetIds = current.filter((id) => !message.enabledRulesets.includes(id));
        if (enableRulesetIds.length > 0 || disableRulesetIds.length > 0) await safe(() => dnr.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds }));
      }
      syncDnr();
    } else if (message.type === 'event') {
      Promise.resolve(api.runtime.sendMessage({ [KEY]: { type: 'event', name: message.name, details: message.details } })).catch(() => {});
    }
  });
  host.send({ type: 'ready' });
})();
`;

/** Insert the shim as the first script of an extension HTML page. */
export function injectExtensionShim(html: string): string {
  if (html.includes(SHIM_MARKER)) return html;
  const script = `<script src="/${EXTENSION_SHIM_FILE}" ${SHIM_MARKER}></script>`;
  if (/<head\b[^>]*>/i.test(html))
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n  ${script}`);
  if (/<html\b[^>]*>/i.test(html))
    return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n${script}`);
  return `${script}\n${html}`;
}

function backgroundWrapperSource(original: string, isModule: boolean): string {
  const base = posix.basename(original);
  return isModule
    ? `import '/${EXTENSION_SHIM_FILE}';\nimport './${base}';\n`
    : `importScripts('/${EXTENSION_SHIM_FILE}', './${base}');\n`;
}

export interface AdaptedWebStoreManifest {
  manifest: JsonRecord;
  worker: { original: string; wrapper: string; module: boolean } | null;
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const normalized = posix.normalize(value.replace(/^\/+/, ""));
  if (
    normalized.startsWith("..") ||
    normalized.includes("\0") ||
    /^[a-z]:/i.test(normalized)
  )
    return null;
  return normalized;
}

/**
 * Adapt a Web Store manifest for Electron: drop update_url (Surffish updates it), pin the store
 * identity with the publisher key, run the shim before the background worker, and prepend it to
 * isolated-world content scripts.
 */
export function adaptWebStoreManifest(
  input: unknown,
  publicKeyBase64: string | null,
): AdaptedWebStoreManifest {
  if (!isRecord(input))
    throw new Error("The extension manifest is not a JSON object.");
  const manifest = structuredClone(input) as JsonRecord;
  delete manifest.update_url;
  if (publicKeyBase64) manifest.key = publicKeyBase64;

  let worker: AdaptedWebStoreManifest["worker"] = null;
  const background = isRecord(manifest.background)
    ? { ...manifest.background }
    : null;
  const serviceWorker = background
    ? safeRelativePath(background.service_worker)
    : null;
  if (background && serviceWorker) {
    const directory = posix.dirname(serviceWorker);
    const wrapper =
      directory === "."
        ? EXTENSION_BACKGROUND_WRAPPER_FILE
        : `${directory}/${EXTENSION_BACKGROUND_WRAPPER_FILE}`;
    const module = background.type === "module";
    background.service_worker = wrapper;
    manifest.background = background;
    worker = { original: serviceWorker, wrapper, module };
  }

  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts = manifest.content_scripts.map((entry) => {
      if (
        !isRecord(entry) ||
        entry.world === "MAIN" ||
        !Array.isArray(entry.js) ||
        entry.js.length === 0
      )
        return entry;
      const js = entry.js.filter(
        (file): file is string => typeof file === "string",
      );
      return {
        ...entry,
        js: js.includes(EXTENSION_SHIM_FILE)
          ? js
          : [EXTENSION_SHIM_FILE, ...js],
      };
    });
  }
  return { manifest, worker };
}

function listFiles(
  directory: string,
  predicate: (name: string) => boolean,
  limit = 5000,
): string[] {
  const results: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (results.length >= limit) return;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && predicate(entry.name)) results.push(path);
    }
  };
  walk(directory);
  return results;
}

const MAX_SCANNED_SOURCE_BYTES = 24 * 1024 * 1024;

/** The extension's JS files for the static API scan (bounded; never executed). */
export function collectExtensionSources(
  directory: string,
): ExtensionSourceFile[] {
  const root = resolve(directory);
  const files: ExtensionSourceFile[] = [];
  let total = 0;
  for (const path of listFiles(
    root,
    (name) =>
      /\.(m?js)$/i.test(name) &&
      name !== EXTENSION_SHIM_FILE &&
      name !== EXTENSION_BACKGROUND_WRAPPER_FILE &&
      name !== EXTENSION_BRIDGE_SCRIPT,
  )) {
    const size = statSync(path).size;
    if (total + size > MAX_SCANNED_SOURCE_BYTES) break;
    total += size;
    files.push({
      path: relative(root, path).split(sep).join("/"),
      content: readFileSync(path, "utf8"),
    });
  }
  return files;
}

/** The extension's static declarativeNetRequest rulesets, for the install compatibility check (bounded). */
export function collectDnrRulesets(
  directory: string,
  manifest: unknown,
): Array<{ id: string; rules: unknown }> {
  const root = resolve(directory);
  const result: Array<{ id: string; rules: unknown }> = [];
  const dnr =
    isRecord(manifest) && isRecord(manifest.declarative_net_request)
      ? manifest.declarative_net_request
      : {};
  const declarations = (
    Array.isArray(dnr.rule_resources) ? dnr.rule_resources : []
  )
    .filter(isRecord)
    .filter(
      (entry): entry is { id: string; path: string } =>
        typeof entry.id === "string" && typeof entry.path === "string",
    );
  for (const declaration of declarations) {
    const relativePath = safeRelativePath(declaration.path);
    if (!relativePath) continue;
    const file = resolve(root, relativePath);
    if (
      !file.startsWith(`${root}${sep}`) ||
      !existsSync(file) ||
      statSync(file).size > MAX_SCANNED_SOURCE_BYTES
    )
      continue;
    try {
      result.push({
        id: declaration.id,
        rules: JSON.parse(
          readFileSync(file, "utf8").replace(/^\uFEFF/, ""),
        ) as unknown,
      });
    } catch {
      result.push({ id: declaration.id, rules: null });
    }
  }
  return result;
}

export const EXTENSION_SIDECAR_FILE = "surffish-extension.json";

/** Write (or refresh) the shim and background wrapper inside a staged extension directory. */
export function writeExtensionShimFiles(directory: string): void {
  writeFileSync(join(directory, EXTENSION_SHIM_FILE), EXTENSION_SHIM_SOURCE);
  writeFileSync(join(directory, EXTENSION_BRIDGE_PAGE), EXTENSION_BRIDGE_HTML);
  writeFileSync(
    join(directory, EXTENSION_BRIDGE_SCRIPT),
    EXTENSION_BRIDGE_SOURCE,
  );
  const sidecarPath = join(directory, EXTENSION_SIDECAR_FILE);
  if (!existsSync(sidecarPath)) return;
  const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as unknown;
  if (!isRecord(sidecar) || !isRecord(sidecar.worker)) return;
  const original = safeRelativePath(sidecar.worker.original);
  const wrapper = safeRelativePath(sidecar.worker.wrapper);
  if (
    !original ||
    !wrapper ||
    posix.basename(wrapper) !== EXTENSION_BACKGROUND_WRAPPER_FILE
  )
    return;
  writeFileSync(
    join(directory, ...wrapper.split("/")),
    backgroundWrapperSource(original, sidecar.worker.module === true),
  );
}

export interface StagedWebStoreExtension {
  stagedDirectory: string;
  version: string;
  manifest: JsonRecord;
}

/**
 * Copy `sourceDirectory` (an unpacked Web Store package) to `targetDirectory`, adapting only the copy.
 * `_metadata/` (Web Store verified contents, which Chromium refuses to load unpacked) is never copied.
 */
export function stageWebStoreExtension(
  sourceDirectory: string,
  targetDirectory: string,
  publicKeyBase64: string | null,
): StagedWebStoreExtension {
  const source = resolve(sourceDirectory);
  const manifestPath = join(source, "manifest.json");
  if (!existsSync(manifestPath))
    throw new Error("The extension package has no manifest.json.");
  let sourceManifest: unknown;
  try {
    sourceManifest = JSON.parse(
      readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""),
    );
  } catch (error) {
    throw new Error(
      `The extension manifest could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const { manifest, worker } = adaptWebStoreManifest(
    sourceManifest,
    publicKeyBase64,
  );
  const version = typeof manifest.version === "string" ? manifest.version : "";
  if (!/^\d+(\.\d+){0,3}$/.test(version))
    throw new Error("The extension manifest has no valid version.");
  if (worker && !existsSync(join(source, ...worker.original.split("/"))))
    throw new Error(
      `The extension is missing its background worker ${worker.original}.`,
    );

  const staged = resolve(targetDirectory);
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(staged, { recursive: true });
  cpSync(source, staged, {
    recursive: true,
    dereference: false,
    filter: (path) => {
      const rel = relative(source, path).split(sep);
      return rel[0] !== "_metadata";
    },
  });
  writeFileSync(
    join(staged, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(staged, EXTENSION_SIDECAR_FILE),
    `${JSON.stringify({ worker }, null, 2)}\n`,
  );
  if (worker)
    mkdirSync(dirname(join(staged, ...worker.wrapper.split("/"))), {
      recursive: true,
    });
  writeExtensionShimFiles(staged);
  for (const htmlPath of listFiles(staged, (name) =>
    name.toLowerCase().endsWith(".html"),
  )) {
    const html = readFileSync(htmlPath, "utf8");
    const adapted = injectExtensionShim(html);
    if (adapted !== html) writeFileSync(htmlPath, adapted);
  }
  return { stagedDirectory: staged, version, manifest };
}

/** Resolve a __MSG_name__ manifest string from the default locale. */
export function resolveManifestMessage(
  directory: string,
  manifest: JsonRecord,
  value: unknown,
): string {
  if (typeof value !== "string") return "";
  const match = /^__MSG_(.+)__$/.exec(value);
  if (!match) return value;
  const locale =
    typeof manifest.default_locale === "string"
      ? manifest.default_locale
      : "en";
  for (const candidate of [locale, locale.split("_")[0], "en", "en_US"]) {
    if (!candidate || !/^[\w-]+$/.test(candidate)) continue;
    const path = join(directory, "_locales", candidate, "messages.json");
    if (!existsSync(path)) continue;
    try {
      const messages = JSON.parse(
        readFileSync(path, "utf8").replace(/^\uFEFF/, ""),
      ) as unknown;
      if (!isRecord(messages)) continue;
      const key = Object.keys(messages).find(
        (name) => name.toLowerCase() === (match[1] as string).toLowerCase(),
      );
      const entry = key ? messages[key] : undefined;
      if (isRecord(entry) && typeof entry.message === "string")
        return entry.message;
    } catch {
      // Fall through to the next locale.
    }
  }
  return value;
}

/** A small data: URL for the extension's toolbar icon, or null. */
export function readExtensionIconDataUrl(
  directory: string,
  manifest: JsonRecord,
  preferredSizes = ["32", "48", "38", "24", "16", "64", "96", "128"],
): string | null {
  const action = isRecord(manifest.action)
    ? manifest.action
    : isRecord(manifest.browser_action)
      ? manifest.browser_action
      : {};
  const actionIcons = isRecord(action.default_icon)
    ? action.default_icon
    : typeof action.default_icon === "string"
      ? { 32: action.default_icon }
      : {};
  const icons = isRecord(manifest.icons) ? manifest.icons : {};
  const candidates = [
    ...preferredSizes.map((size) => actionIcons[size]),
    ...preferredSizes.map((size) => icons[size]),
  ];
  const root = resolve(directory);
  for (const iconPath of candidates) {
    const relativePath = safeRelativePath(iconPath);
    if (!relativePath) continue;
    const candidate = resolve(root, relativePath);
    if (!candidate.startsWith(`${root}${sep}`) || !existsSync(candidate))
      continue;
    const extension = candidate.toLowerCase().split(".").at(-1);
    const mime =
      extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : extension === "svg"
              ? "image/svg+xml"
              : null;
    const stats = statSync(candidate);
    if (mime && stats.isFile() && stats.size <= 256 * 1024)
      return `data:${mime};base64,${readFileSync(candidate).toString("base64")}`;
  }
  return null;
}

export function manifestPopupPath(manifest: JsonRecord): string | null {
  const action = isRecord(manifest.action)
    ? manifest.action
    : isRecord(manifest.browser_action)
      ? manifest.browser_action
      : {};
  return safeRelativePath(action.default_popup);
}

export function manifestOptionsPath(manifest: JsonRecord): string | null {
  const optionsUi = isRecord(manifest.options_ui) ? manifest.options_ui : {};
  return (
    safeRelativePath(optionsUi.page) ?? safeRelativePath(manifest.options_page)
  );
}

/** Scripts the staged background worker loads (wrapper, shim, original), for the fresh-worker stamp. */
export function extensionWorkerFiles(directory: string): string[] {
  const sidecarPath = join(directory, EXTENSION_SIDECAR_FILE);
  if (!existsSync(sidecarPath)) return [EXTENSION_SHIM_FILE];
  try {
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as unknown;
    if (!isRecord(sidecar) || !isRecord(sidecar.worker))
      return [EXTENSION_SHIM_FILE];
    const files = [
      safeRelativePath(sidecar.worker.wrapper),
      EXTENSION_SHIM_FILE,
      safeRelativePath(sidecar.worker.original),
    ];
    return files.filter((file): file is string => typeof file === "string");
  } catch {
    return [EXTENSION_SHIM_FILE];
  }
}
