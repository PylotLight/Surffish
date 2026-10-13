/**
 * Static compatibility gate for general Chrome Web Store extensions on Surffish's Electron 44
 * extension host. Analyses the manifest and statically referenced chrome.* APIs (reusing the
 * password-extension scanner) and returns Supported / Partial / Unsupported.
 *
 * This never executes extension code. "Supported" means nothing the manifest declares or the code
 * references falls outside what Electron provides or Surffish shims; it is not a runtime guarantee.
 */
import { unsupportedDnrRuleCount } from './dnr'
import { findExtensionApiReferences, type ExtensionSourceFile } from './password-extension-compat'

export type ExtensionCompatLevel = 'supported' | 'partial' | 'unsupported'

export interface ExtensionCompatibility {
  level: ExtensionCompatLevel
  /** Features that will not work (install allowed, with a warning). */
  gaps: string[]
  /** Reasons the extension cannot work at all (install blocked). */
  blockers: string[]
  /** APIs Surffish fills in with its own compatibility shims. */
  shimmed: string[]
  manifestVersion: number | null
  observedApis: string[]
}

export type { ExtensionSourceFile }

/** Permissions Electron 44 provides (or that need no API surface) for a typical content extension. */
const SUPPORTED_PERMISSIONS = new Set([
  'activeTab',
  'storage',
  'unlimitedStorage',
  'scripting',
  'webRequest',
  'management',
  'tabs',
  'clipboardWrite',
  'clipboardRead',
  'background',
  'fontSettings',
  // Enforced by Surffish itself (src/shared/dnr.ts, main/extension-dnr.ts).
  'declarativeNetRequest',
  'declarativeNetRequestWithHostAccess',
  // Events forwarded by Surffish's extension bridge (main/extension-bridge.ts).
  'webNavigation'
])

/** Declared permissions whose API Electron lacks; the rest of the extension can still run. */
const GAP_PERMISSIONS: Record<string, string> = {
  alarms: 'chrome.alarms is only partially available; scheduled background work may not run',
  bookmarks: 'chrome.bookmarks is not available (Surffish has no extension bookmark API)',
  browsingData: 'chrome.browsingData is not available',
  commands: 'Extension keyboard shortcuts (commands) are not registered',
  contextMenus: 'Right-click menu entries (contextMenus) are not shown',
  cookies: 'chrome.cookies is not available',
  declarativeContent: 'declarativeContent rules are ignored',
  declarativeNetRequestFeedback: 'Matched-rule feedback (declarativeNetRequest.getMatchedRules, onRuleMatchedDebug) is not available',
  downloads: 'chrome.downloads is not available',
  favicon: 'The favicon API is not available',
  history: 'chrome.history is not available',
  identity: 'chrome.identity sign-in (OAuth) is not available',
  idle: 'chrome.idle is not available',
  nativeMessaging: 'Native messaging to desktop apps is not available',
  notifications: 'Desktop notifications from the extension are not shown',
  offscreen: 'Offscreen documents are not available',
  sessions: 'chrome.sessions is not available',
  sidePanel: 'The side panel is not shown',
  tabCapture: 'Tab capture is not available',
  tabGroups: 'Tab groups are not available',
  topSites: 'chrome.topSites is not available',
  tts: 'Text-to-speech (tts) is not available',
  webRequestBlocking: 'Blocking webRequest can conflict with Surffish’s ad blocker',
  geolocation: 'Extension geolocation is not granted',
  search: 'chrome.search is not available',
  system: 'chrome.system.* is not available'
}

/** Declared permissions that are the extension's whole purpose and cannot work here. */
const BLOCKER_PERMISSIONS: Record<string, string> = {
  debugger: 'needs chrome.debugger, which Surffish does not expose',
  proxy: 'needs chrome.proxy; Surffish manages its own SOCKS proxy',
  vpnProvider: 'needs the ChromeOS VPN provider API',
  platformKeys: 'needs ChromeOS platform keys',
  enterprise: 'needs Chrome enterprise APIs',
  'enterprise.deviceAttributes': 'needs Chrome enterprise APIs',
  'enterprise.platformKeys': 'needs Chrome enterprise APIs',
  fileSystemProvider: 'needs the ChromeOS file system provider API',
  input: 'needs the ChromeOS input method API',
  printerProvider: 'needs the printer provider API'
}

/** API namespaces (from the static scan) and how Surffish handles them. */
const SUPPORTED_API_PREFIXES = [
  'runtime',
  'i18n',
  'extension',
  'storage.local',
  'storage.onChanged',
  'storage.session',
  'scripting',
  'webRequest',
  'devtools',
  'action.onClicked',
  'action.getPopup',
  'action.setPopup',
  'action.getTitle',
  'action.setTitle',
  'action.enable',
  'action.disable',
  'action.isEnabled',
  'browserAction.getPopup',
  'browserAction.setPopup',
  'tabs.sendMessage',
  'tabs.reload',
  'tabs.update',
  'tabs.query',
  'tabs.get',
  'tabs.onUpdated',
  'tabs.onRemoved',
  'tabs.onActivated',
  'tabs.onCreated',
  'tabs.executeScript',
  'tabs.insertCSS',
  'tabs.TAB_ID_NONE'
] as const

const DNR_SHIM_LABEL = 'declarativeNetRequest (Surffish enforces the extension’s rules)'
const WEB_NAVIGATION_SHIM_LABEL = 'webNavigation (Surffish forwards tab navigation events)'

const SHIMMED_APIS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: 'declarativeNetRequest', label: DNR_SHIM_LABEL },
  { prefix: 'webNavigation', label: WEB_NAVIGATION_SHIM_LABEL },
  { prefix: 'storage.sync', label: 'storage.sync (stored in storage.local on this device)' },
  { prefix: 'management.getSelf', label: 'management.getSelf (minimal self info)' },
  { prefix: 'management.get', label: 'management.get (self only)' },
  { prefix: 'management', label: 'management.getSelf (minimal self info)' },
  { prefix: 'tabs.create', label: 'tabs.create from popups/options (opens a Surffish tab)' },
  { prefix: 'tabs.remove', label: 'tabs.remove from popups/options (closes a Surffish tab)' },
  { prefix: 'tabs.query', label: 'tabs.query/update/reload from popups/options (Surffish tabs)' },
  { prefix: 'tabs.update', label: 'tabs.query/update/reload from popups/options (Surffish tabs)' },
  { prefix: 'tabs.reload', label: 'tabs.query/update/reload from popups/options (Surffish tabs)' },
  { prefix: 'runtime.openOptionsPage', label: 'runtime.openOptionsPage (opens a Surffish tab)' }
]

const GAP_API_LABELS: Record<string, string> = {
  'declarativeNetRequest.getMatchedRules': 'Matched-rule feedback (declarativeNetRequest.getMatchedRules, onRuleMatchedDebug) is not available',
  'declarativeNetRequest.onRuleMatchedDebug': 'Matched-rule feedback (declarativeNetRequest.getMatchedRules, onRuleMatchedDebug) is not available',
  'declarativeNetRequest.setExtensionActionOptions': 'Toolbar badge text is not displayed',
  'action.setBadgeText': 'Toolbar badge text is not displayed',
  'action.setBadgeBackgroundColor': 'Toolbar badge text is not displayed',
  'action.setIcon': 'Dynamic toolbar icons are not displayed',
  'action.openPopup': 'Programmatic popup opening (action.openPopup) is not available',
  'browserAction.setBadgeText': 'Toolbar badge text is not displayed',
  'browserAction.setIcon': 'Dynamic toolbar icons are not displayed',
  windows: 'chrome.windows is not available (single Surffish window)',
  permissions: 'Runtime permission requests (chrome.permissions) are not available',
  'tabs.captureVisibleTab': 'Screenshots (tabs.captureVisibleTab) are not available',
  'tabs.group': 'Tab groups are not available',
  'tabs.discard': 'tabs.discard is not available',
  'tabs.duplicate': 'tabs.duplicate is not available',
  'tabs.move': 'tabs.move is not available',
  'tabs.highlight': 'tabs.highlight is not available',
  'tabs.getCurrent': 'tabs.getCurrent is not available',
  'storage.managed': 'Managed (policy) storage is not available'
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function hasPrefix(api: string, prefix: string): boolean {
  return api === prefix || api.startsWith(`${prefix}.`)
}

/** A static declarativeNetRequest ruleset as read from the package (`rules: null` when unreadable). */
export interface ExtensionDnrRuleset { id: string; rules: unknown }

/** Analyse a manifest plus the extension's JS sources (and its static DNR rulesets, when given). */
export function analyzeExtensionCompatibility(manifestInput: unknown, sourceFiles: readonly ExtensionSourceFile[] = [], dnrRulesets: readonly ExtensionDnrRuleset[] = []): ExtensionCompatibility {
  const manifest = record(manifestInput)
  const gaps = new Set<string>()
  const blockers = new Set<string>()
  const shimmed = new Set<string>()
  const manifestVersion = typeof manifest.manifest_version === 'number' ? manifest.manifest_version : null

  if (manifestVersion !== 2 && manifestVersion !== 3) blockers.add('The manifest does not declare manifest_version 2 or 3.')
  if (manifest.theme !== undefined) blockers.add('Chrome themes are not supported; Surffish only loads extensions.')
  if (manifest.app !== undefined) blockers.add('Chrome Apps are not supported.')
  if (manifest.export !== undefined && manifest.content_scripts === undefined && manifest.background === undefined) {
    blockers.add('Shared-module packages are libraries for other extensions and cannot run on their own.')
  }

  const background = record(manifest.background)
  if (manifestVersion === 3) {
    if (Array.isArray(background.scripts) && typeof background.service_worker !== 'string') {
      blockers.add('Declares a Firefox-style MV3 background.scripts entry, which Chromium does not run.')
    }
  } else if (manifestVersion === 2) {
    gaps.add('Manifest V2 extension: Chromium is retiring MV2, so it may load with reduced functionality')
    if (background.persistent === true) gaps.add('Persistent MV2 background pages may be suspended')
  }

  const permissions = [...stringList(manifest.permissions), ...stringList(manifest.optional_permissions)]
  for (const permission of permissions) {
    if (permission.includes('://') || permission === '<all_urls>') continue
    if (SUPPORTED_PERMISSIONS.has(permission)) continue
    const blocker = BLOCKER_PERMISSIONS[permission]
    if (blocker) {
      blockers.add(`The extension ${blocker}.`)
      continue
    }
    gaps.add(GAP_PERMISSIONS[permission] ?? `The “${permission}” permission is not available`)
  }
  if (stringList(manifest.optional_permissions).length > 0 || stringList(manifest.optional_host_permissions).length > 0) {
    gaps.add('Optional permissions cannot be granted at runtime')
  }
  const usesDnr = permissions.includes('declarativeNetRequest') || permissions.includes('declarativeNetRequestWithHostAccess') || record(manifest.declarative_net_request).rule_resources !== undefined
  if (usesDnr) {
    shimmed.add(DNR_SHIM_LABEL)
    const unreadable = dnrRulesets.filter((ruleset) => !Array.isArray(ruleset.rules)).map((ruleset) => ruleset.id)
    if (unreadable.length > 0) gaps.add(`declarativeNetRequest ruleset ${unreadable.join(', ')} could not be read, so its rules are not applied`)
    const { total, unsupported, reasons } = unsupportedDnrRuleCount(dnrRulesets.filter((ruleset) => Array.isArray(ruleset.rules)))
    if (unsupported > 0) {
      const why = reasons.length > 0 ? ` (${reasons.slice(0, 2).join('; ')})` : ''
      gaps.add(`${unsupported} of ${total} declarativeNetRequest rules can’t be enforced by Surffish${why}`)
    }
  }
  if (permissions.includes('webNavigation')) shimmed.add(WEB_NAVIGATION_SHIM_LABEL)

  if (Object.keys(record(manifest.commands)).length > 0) gaps.add(GAP_PERMISSIONS.commands as string)
  if (record(manifest.chrome_url_overrides).newtab !== undefined) gaps.add('New Tab page overrides are ignored')
  if (Object.keys(record(manifest.chrome_url_overrides)).some((key) => key !== 'newtab')) gaps.add('Bookmarks/history page overrides are ignored')
  if (manifest.side_panel !== undefined) gaps.add(GAP_PERMISSIONS.sidePanel as string)
  if (manifest.omnibox !== undefined) gaps.add('Address-bar keywords (omnibox) are not available')
  if (manifest.devtools_page !== undefined) gaps.add('DevTools panels are not shown')
  if (manifest.externally_connectable !== undefined) gaps.add('Messages from web pages (externally_connectable) may not arrive')
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts.map(record) : []
  if (contentScripts.some((entry) => entry.world === 'MAIN')) gaps.add('MAIN-world content scripts run without Surffish’s compatibility shims')

  const observedApis = findExtensionApiReferences(sourceFiles)
  for (const reference of observedApis) {
    if (!reference.startsWith('chrome.') && !reference.startsWith('browser.')) continue
    const api = reference.replace(/^(chrome|browser)\./, '')
    // Real API namespaces are lowerCamelCase; "browser.Backup" in prose or minified code is not one.
    if (!/^[a-z]/.test(api)) continue
    // Parts of shimmed namespaces Surffish does not provide.
    const missingMember = Object.keys(GAP_API_LABELS).find((prefix) => prefix.startsWith('declarativeNetRequest.') && hasPrefix(api, prefix))
    if (missingMember) {
      gaps.add(GAP_API_LABELS[missingMember] as string)
      continue
    }
    const shim = SHIMMED_APIS.find((entry) => hasPrefix(api, entry.prefix))
    if (shim) {
      shimmed.add(shim.label)
      continue
    }
    if (SUPPORTED_API_PREFIXES.some((prefix) => hasPrefix(api, prefix))) continue
    if (api === 'storage' || api === 'tabs' || api === 'action') continue
    const gapKey = Object.keys(GAP_API_LABELS).find((prefix) => hasPrefix(api, prefix))
    if (gapKey) {
      gaps.add(GAP_API_LABELS[gapKey] as string)
      continue
    }
    const namespace = api.split('.')[0] ?? api
    if (namespace === 'storage' || namespace === 'tabs' || namespace === 'action' || namespace === 'browserAction') {
      // Unlisted members of mostly-supported namespaces: report the exact member.
      gaps.add(`chrome.${api.split('.').slice(0, 2).join('.')} is not available`)
      continue
    }
    const blocker = BLOCKER_PERMISSIONS[namespace]
    if (blocker) {
      blockers.add(`The extension ${blocker}.`)
      continue
    }
    gaps.add(GAP_PERMISSIONS[namespace] ?? `chrome.${namespace} is not available`)
  }

  // Wrapped APIs (webextension-polyfill, ExtPay) hide the chrome.* prefix from the scan above.
  const wrappedUse = (pattern: RegExp): boolean => sourceFiles.some((file) => pattern.test(file.content))
  if (wrappedUse(/\.storage\.sync\b/)) shimmed.add('storage.sync (stored in storage.local on this device)')
  if (wrappedUse(/\.management\.(getSelf|get)\b/)) shimmed.add('management.getSelf (minimal self info)')

  const blockerList = [...blockers].sort()
  const gapList = [...gaps].filter(Boolean).sort()
  return {
    level: blockerList.length > 0 ? 'unsupported' : gapList.length > 0 ? 'partial' : 'supported',
    gaps: gapList,
    blockers: blockerList,
    shimmed: [...shimmed].sort(),
    manifestVersion,
    observedApis
  }
}

export function compatibilityLabel(level: ExtensionCompatLevel): string {
  return level === 'supported' ? 'Supported' : level === 'partial' ? 'Partial' : 'Unsupported'
}
