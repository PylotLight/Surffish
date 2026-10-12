/**
 * Stage a Chrome Web Store extension for Electron: copy the unpacked package to an app-owned
 * directory, adapt only the copy, and inject Surffish's compatibility shim into extension-owned
 * contexts (background worker, extension pages, isolated-world content scripts), following the
 * Bramble adapter pattern. Pure Node (fs/path): unit-testable without Electron.
 *
 * The shim never fakes paid/pro state: it only fills in browser APIs Electron lacks.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import type { ExtensionSourceFile } from '../shared/extension-compat'

export const EXTENSION_SHIM_FILE = 'surffish-extension-shim.js'
export const EXTENSION_BACKGROUND_WRAPPER_FILE = 'surffish-extension-background.js'
const SHIM_MARKER = 'data-surffish-extension-shim'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  if (isExtensionPage && host && typeof host.tabs === 'function') {
    const tabs = api.tabs || {};
    if (!api.tabs) define(api, 'tabs', tabs);
    const run = (op, payload, callback) => settle(Promise.resolve(host.tabs(op, payload)), callback);
    const resolveUrl = (url) => typeof url === 'string' ? new URL(url, api.runtime.getURL('/')).href : undefined;
    const props = (value) => {
      const input = value && typeof value === 'object' ? value : {};
      return { url: resolveUrl(input.url), active: typeof input.active === 'boolean' ? input.active : (typeof input.selected === 'boolean' ? input.selected : undefined), pinned: typeof input.pinned === 'boolean' ? input.pinned : undefined };
    };
    define(tabs, 'query', (queryInfo, callback) => run('query', queryInfo && typeof queryInfo === 'object' ? JSON.parse(JSON.stringify(queryInfo)) : {}, callback));
    define(tabs, 'get', (tabId, callback) => run('get', { tabId }, callback));
    define(tabs, 'getCurrent', (callback) => settle(Promise.resolve(undefined), callback));
    define(tabs, 'create', (createProperties, callback) => run('create', props(createProperties), callback));
    define(tabs, 'update', (...args) => {
      const callback = lastFunction(args);
      const tabId = typeof args[0] === 'number' ? args[0] : undefined;
      const updateProperties = typeof args[0] === 'number' ? args[1] : args[0];
      return run('update', { tabId, ...props(updateProperties) }, callback);
    });
    define(tabs, 'reload', (...args) => {
      const callback = lastFunction(args);
      const tabId = typeof args[0] === 'number' ? args[0] : undefined;
      const options = args.find((entry) => entry && typeof entry === 'object');
      return run('reload', { tabId, bypassCache: !!(options && options.bypassCache) }, callback);
    });
    define(tabs, 'remove', (tabIds, callback) => run('remove', { tabIds: Array.isArray(tabIds) ? tabIds : [tabIds] }, callback));
    if (typeof host.openOptionsPage === 'function') {
      define(api.runtime, 'openOptionsPage', (callback) => settle(Promise.resolve(host.openOptionsPage()), callback));
    }
  }
})();
`

/** Insert the shim as the first script of an extension HTML page. */
export function injectExtensionShim(html: string): string {
  if (html.includes(SHIM_MARKER)) return html
  const script = `<script src="/${EXTENSION_SHIM_FILE}" ${SHIM_MARKER}></script>`
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n  ${script}`)
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n${script}`)
  return `${script}\n${html}`
}

function backgroundWrapperSource(original: string, isModule: boolean): string {
  const base = posix.basename(original)
  return isModule
    ? `import '/${EXTENSION_SHIM_FILE}';\nimport './${base}';\n`
    : `importScripts('/${EXTENSION_SHIM_FILE}', './${base}');\n`
}

export interface AdaptedWebStoreManifest {
  manifest: JsonRecord
  worker: { original: string; wrapper: string; module: boolean } | null
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const normalized = posix.normalize(value.replace(/^\/+/, ''))
  if (normalized.startsWith('..') || normalized.includes('\0') || /^[a-z]:/i.test(normalized)) return null
  return normalized
}

/**
 * Adapt a Web Store manifest for Electron: drop update_url (Surffish updates it), pin the store
 * identity with the publisher key, run the shim before the background worker, and prepend it to
 * isolated-world content scripts.
 */
export function adaptWebStoreManifest(input: unknown, publicKeyBase64: string | null): AdaptedWebStoreManifest {
  if (!isRecord(input)) throw new Error('The extension manifest is not a JSON object.')
  const manifest = structuredClone(input) as JsonRecord
  delete manifest.update_url
  if (publicKeyBase64) manifest.key = publicKeyBase64

  let worker: AdaptedWebStoreManifest['worker'] = null
  const background = isRecord(manifest.background) ? { ...manifest.background } : null
  const serviceWorker = background ? safeRelativePath(background.service_worker) : null
  if (background && serviceWorker) {
    const directory = posix.dirname(serviceWorker)
    const wrapper = directory === '.' ? EXTENSION_BACKGROUND_WRAPPER_FILE : `${directory}/${EXTENSION_BACKGROUND_WRAPPER_FILE}`
    const module = background.type === 'module'
    background.service_worker = wrapper
    manifest.background = background
    worker = { original: serviceWorker, wrapper, module }
  }

  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts = manifest.content_scripts.map((entry) => {
      if (!isRecord(entry) || entry.world === 'MAIN' || !Array.isArray(entry.js) || entry.js.length === 0) return entry
      const js = entry.js.filter((file): file is string => typeof file === 'string')
      return { ...entry, js: js.includes(EXTENSION_SHIM_FILE) ? js : [EXTENSION_SHIM_FILE, ...js] }
    })
  }
  return { manifest, worker }
}

function listFiles(directory: string, predicate: (name: string) => boolean, limit = 5000): string[] {
  const results: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (results.length >= limit) return
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && predicate(entry.name)) results.push(path)
    }
  }
  walk(directory)
  return results
}

const MAX_SCANNED_SOURCE_BYTES = 24 * 1024 * 1024

/** The extension's JS files for the static API scan (bounded; never executed). */
export function collectExtensionSources(directory: string): ExtensionSourceFile[] {
  const root = resolve(directory)
  const files: ExtensionSourceFile[] = []
  let total = 0
  for (const path of listFiles(root, (name) => /\.(m?js)$/i.test(name) && name !== EXTENSION_SHIM_FILE && name !== EXTENSION_BACKGROUND_WRAPPER_FILE)) {
    const size = statSync(path).size
    if (total + size > MAX_SCANNED_SOURCE_BYTES) break
    total += size
    files.push({ path: relative(root, path).split(sep).join('/'), content: readFileSync(path, 'utf8') })
  }
  return files
}

export const EXTENSION_SIDECAR_FILE = 'surffish-extension.json'

/** Write (or refresh) the shim and background wrapper inside a staged extension directory. */
export function writeExtensionShimFiles(directory: string): void {
  writeFileSync(join(directory, EXTENSION_SHIM_FILE), EXTENSION_SHIM_SOURCE)
  const sidecarPath = join(directory, EXTENSION_SIDECAR_FILE)
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as unknown
  if (!isRecord(sidecar) || !isRecord(sidecar.worker)) return
  const original = safeRelativePath(sidecar.worker.original)
  const wrapper = safeRelativePath(sidecar.worker.wrapper)
  if (!original || !wrapper || posix.basename(wrapper) !== EXTENSION_BACKGROUND_WRAPPER_FILE) return
  writeFileSync(join(directory, ...wrapper.split('/')), backgroundWrapperSource(original, sidecar.worker.module === true))
}

export interface StagedWebStoreExtension {
  stagedDirectory: string
  version: string
  manifest: JsonRecord
}

/**
 * Copy `sourceDirectory` (an unpacked Web Store package) to `targetDirectory`, adapting only the copy.
 * `_metadata/` (Web Store verified contents, which Chromium refuses to load unpacked) is never copied.
 */
export function stageWebStoreExtension(sourceDirectory: string, targetDirectory: string, publicKeyBase64: string | null): StagedWebStoreExtension {
  const source = resolve(sourceDirectory)
  const manifestPath = join(source, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error('The extension package has no manifest.json.')
  let sourceManifest: unknown
  try {
    sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`The extension manifest could not be parsed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const { manifest, worker } = adaptWebStoreManifest(sourceManifest, publicKeyBase64)
  const version = typeof manifest.version === 'string' ? manifest.version : ''
  if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error('The extension manifest has no valid version.')
  if (worker && !existsSync(join(source, ...worker.original.split('/')))) throw new Error(`The extension is missing its background worker ${worker.original}.`)

  const staged = resolve(targetDirectory)
  rmSync(staged, { recursive: true, force: true })
  mkdirSync(staged, { recursive: true })
  cpSync(source, staged, {
    recursive: true,
    dereference: false,
    filter: (path) => {
      const rel = relative(source, path).split(sep)
      return rel[0] !== '_metadata'
    }
  })
  writeFileSync(join(staged, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(staged, EXTENSION_SIDECAR_FILE), `${JSON.stringify({ worker }, null, 2)}\n`)
  if (worker) mkdirSync(dirname(join(staged, ...worker.wrapper.split('/'))), { recursive: true })
  writeExtensionShimFiles(staged)
  for (const htmlPath of listFiles(staged, (name) => name.toLowerCase().endsWith('.html'))) {
    const html = readFileSync(htmlPath, 'utf8')
    const adapted = injectExtensionShim(html)
    if (adapted !== html) writeFileSync(htmlPath, adapted)
  }
  return { stagedDirectory: staged, version, manifest }
}

/** Resolve a __MSG_name__ manifest string from the default locale. */
export function resolveManifestMessage(directory: string, manifest: JsonRecord, value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = /^__MSG_(.+)__$/.exec(value)
  if (!match) return value
  const locale = typeof manifest.default_locale === 'string' ? manifest.default_locale : 'en'
  for (const candidate of [locale, locale.split('_')[0], 'en', 'en_US']) {
    if (!candidate || !/^[\w-]+$/.test(candidate)) continue
    const path = join(directory, '_locales', candidate, 'messages.json')
    if (!existsSync(path)) continue
    try {
      const messages = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown
      if (!isRecord(messages)) continue
      const key = Object.keys(messages).find((name) => name.toLowerCase() === (match[1] as string).toLowerCase())
      const entry = key ? messages[key] : undefined
      if (isRecord(entry) && typeof entry.message === 'string') return entry.message
    } catch {
      // Fall through to the next locale.
    }
  }
  return value
}

/** A small data: URL for the extension's toolbar icon, or null. */
export function readExtensionIconDataUrl(directory: string, manifest: JsonRecord, preferredSizes = ['32', '48', '38', '24', '16', '64', '96', '128']): string | null {
  const action = isRecord(manifest.action) ? manifest.action : isRecord(manifest.browser_action) ? manifest.browser_action : {}
  const actionIcons = isRecord(action.default_icon) ? action.default_icon : typeof action.default_icon === 'string' ? { 32: action.default_icon } : {}
  const icons = isRecord(manifest.icons) ? manifest.icons : {}
  const candidates = [...preferredSizes.map((size) => actionIcons[size]), ...preferredSizes.map((size) => icons[size])]
  const root = resolve(directory)
  for (const iconPath of candidates) {
    const relativePath = safeRelativePath(iconPath)
    if (!relativePath) continue
    const candidate = resolve(root, relativePath)
    if (!candidate.startsWith(`${root}${sep}`) || !existsSync(candidate)) continue
    const extension = candidate.toLowerCase().split('.').at(-1)
    const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'svg' ? 'image/svg+xml' : null
    const stats = statSync(candidate)
    if (mime && stats.isFile() && stats.size <= 256 * 1024) return `data:${mime};base64,${readFileSync(candidate).toString('base64')}`
  }
  return null
}

export function manifestPopupPath(manifest: JsonRecord): string | null {
  const action = isRecord(manifest.action) ? manifest.action : isRecord(manifest.browser_action) ? manifest.browser_action : {}
  return safeRelativePath(action.default_popup)
}

export function manifestOptionsPath(manifest: JsonRecord): string | null {
  const optionsUi = isRecord(manifest.options_ui) ? manifest.options_ui : {}
  return safeRelativePath(optionsUi.page) ?? safeRelativePath(manifest.options_page)
}

/** Scripts the staged background worker loads (wrapper, shim, original), for the fresh-worker stamp. */
export function extensionWorkerFiles(directory: string): string[] {
  const sidecarPath = join(directory, EXTENSION_SIDECAR_FILE)
  if (!existsSync(sidecarPath)) return [EXTENSION_SHIM_FILE]
  try {
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as unknown
    if (!isRecord(sidecar) || !isRecord(sidecar.worker)) return [EXTENSION_SHIM_FILE]
    const files = [safeRelativePath(sidecar.worker.wrapper), EXTENSION_SHIM_FILE, safeRelativePath(sidecar.worker.original)]
    return files.filter((file): file is string => typeof file === 'string')
  } catch {
    return [EXTENSION_SHIM_FILE]
  }
}
