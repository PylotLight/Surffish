export type PasswordManagerTarget = 'bitwarden' | 'bramble'
export type CompatibilityIssueKind = 'manifest' | 'api-gap' | 'browser-ui' | 'host-access'
export type CompatibilitySeverity = 'blocker' | 'warning'

export interface PasswordExtensionManifest {
  manifest_version?: unknown
  name?: unknown
  short_name?: unknown
  permissions?: unknown
  optional_permissions?: unknown
  host_permissions?: unknown
  background?: unknown
  action?: unknown
  browser_action?: unknown
  commands?: unknown
  content_scripts?: unknown
  browser_specific_settings?: unknown
  [key: string]: unknown
}

export interface ExtensionSourceFile {
  path: string
  content: string
}

export interface CompatibilityIssue {
  kind: CompatibilityIssueKind
  severity: CompatibilitySeverity
  message: string
}

export interface PasswordExtensionCompatibility {
  target: PasswordManagerTarget
  extensionName: string
  manifestVersion: number | null
  issues: CompatibilityIssue[]
  observedApis: string[]
  noDeclaredBlockers: boolean
  staticOnly: true
}

const TARGET_DETAILS: Record<PasswordManagerTarget, {
  label: string
  documentedApiGaps: readonly string[]
  actions: readonly string[]
}> = {
  bitwarden: {
    label: 'Bitwarden',
    documentedApiGaps: [
      'clipboardRead',
      'clipboardWrite',
      'contextMenus',
      'idle',
      'notifications',
      'webNavigation',
      'commands'
    ],
    actions: ['browser_action']
  },
  bramble: {
    label: 'Bramble',
    documentedApiGaps: [
      'alarms',
      'idle',
      'offscreen',
      'webAuthenticationProxy',
      'identity',
      'commands'
    ],
    actions: ['action']
  }
}

// Electron documents storage.local, not other storage areas. Several APIs in
// this list were absent from the MV2 fixture but did appear in the current MV3
// service-worker fixture; absent-by-default remains a static hint, not a claim
// about every extension context or Electron version.
const UNDOCUMENTED_ELECTRON_API_PREFIXES = [
  'alarms',
  'clipboardRead',
  'clipboardWrite',
  'contextMenus',
  'cookies',
  'downloads',
  'identity',
  'idle',
  'offscreen',
  'notifications',
  'webAuthenticationProxy',
  'webNavigation',
  'storage.managed',
  'storage.onChanged',
  'storage.session',
  'storage.sync'
] as const

// Presence was observed in the checked-in MV3 background fixture on Electron
// 44.5.1 / Chromium 152. Functionality required by Bramble is tested separately.
const MV3_RUNTIME_OBSERVED_API_PREFIXES = [
  'alarms',
  'idle',
  'offscreen',
  'storage.onChanged',
  'storage.session'
] as const
const MV2_RUNTIME_OBSERVED_API_PREFIXES = [
  'alarms',
  'storage.onChanged'
] as const

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function hasPrefix(api: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => api === prefix || api.startsWith(`${prefix}.`))
}

function isRuntimeObservedApi(target: PasswordManagerTarget, manifestVersion: number | null, api: string): boolean {
  if (target === 'bramble' && manifestVersion === 3) return hasPrefix(api, MV3_RUNTIME_OBSERVED_API_PREFIXES)
  if (target === 'bitwarden' && manifestVersion === 2) return hasPrefix(api, MV2_RUNTIME_OBSERVED_API_PREFIXES)
  return false
}

/**
 * Extracts only static references to the common WebExtension API namespaces.
 * This does not parse or execute extension code; computed property names and
 * aliased imports can be missed, and minified code can produce extra hints.
 */
export function findExtensionApiReferences(sourceFiles: readonly ExtensionSourceFile[]): string[] {
  const references = new Set<string>()
  const apiPath = /\b(chrome|browser)((?:(?:\?\.)|(?:\.))\s*[A-Za-z_$][\w$]*)+/g

  for (const file of sourceFiles) {
    for (const match of file.content.matchAll(apiPath)) {
      const namespace = match[1]
      const path = match[0]?.slice(namespace?.length ?? 0).replace(/^\./, '').replace(/\s/g, '').replaceAll('?.', '.')
      if (namespace && path) references.add(`${namespace}.${path}`)
    }
  }

  return [...references].sort()
}

/**
 * Checks declared and statically referenced compatibility risks. Passing this
 * check does not prove runtime compatibility; extensions are never executed.
 */
export function inspectPasswordExtensionCompatibility(
  target: PasswordManagerTarget,
  manifest: PasswordExtensionManifest,
  sourceFiles: readonly ExtensionSourceFile[] = []
): PasswordExtensionCompatibility {
  const details = TARGET_DETAILS[target]
  const issues: CompatibilityIssue[] = []
  const addIssue = (issue: CompatibilityIssue) => {
    if (!issues.some((existing) => existing.kind === issue.kind && existing.message === issue.message)) {
      issues.push(issue)
    }
  }
  const manifestVersion = typeof manifest.manifest_version === 'number' ? manifest.manifest_version : null
  const background = objectValue(manifest.background)

  if (background.service_worker) {
    addIssue({
      kind: 'manifest',
      severity: 'warning',
      message: `${details.label} declares a Manifest V3 service worker. Electron does not document this surface, but Sockfish's Electron 44.5.1 / Chromium 152 probe loaded the worker and completed extension messaging; the target extension still needs its own runtime test.`
    })
  } else if (Array.isArray(background.scripts) && manifestVersion === 3) {
    addIssue({
      kind: 'manifest',
      severity: 'blocker',
      message: `${details.label} declares Manifest V3 background.scripts (the Firefox-style background form); Electron warns that this form requires Manifest V2 and does not run it as an MV3 background.`
    })
  }

  const geckoSettings = objectValue(objectValue(manifest.browser_specific_settings).gecko)
  if (Object.keys(geckoSettings).length > 0) {
    addIssue({
      kind: 'manifest',
      severity: 'warning',
      message: 'Firefox-specific browser_specific_settings.gecko metadata is present; Electron is a Chromium host and does not provide a Gecko/Firefox runtime.'
    })
  }

  const declaredPermissions = new Set([
    ...stringList(manifest.permissions),
    ...stringList(manifest.optional_permissions)
  ])
  const declaredGaps = details.documentedApiGaps.filter((permission) => declaredPermissions.has(permission))
  const runtimeObservedPermissions = declaredGaps.filter((permission) => isRuntimeObservedApi(target, manifestVersion, permission))
  const declaredBlockers = declaredGaps.filter((permission) => !runtimeObservedPermissions.includes(permission))
  if (declaredBlockers.length > 0) {
    addIssue({
      kind: 'api-gap',
      severity: 'blocker',
      message: `Declared permissions rely on APIs outside Electron's documented extension subset and not present in the runtime probe: ${declaredBlockers.join(', ')}.`
    })
  }
  if (runtimeObservedPermissions.length > 0) {
    addIssue({
      kind: 'api-gap',
      severity: 'warning',
      message: `Sockfish's runtime probe exposed these undocumented APIs for this manifest version: ${runtimeObservedPermissions.join(', ')}. API presence is not a full behavioral or target compatibility test.`
    })
  }

  if (stringList(manifest.optional_permissions).length > 0) {
    addIssue({
      kind: 'api-gap',
      severity: 'warning',
      message: 'The extension requests optional permissions; Electron does not document Chrome permissions-grant UI or the complete runtime permission lifecycle.'
    })
  }

  const actionKey = details.actions.find((key) => manifest[key] !== undefined)
  if (actionKey) {
    addIssue({
      kind: 'browser-ui',
      severity: 'blocker',
      message: `The ${actionKey} declared by this extension needs a browser-action toolbar/popup host; Sockfish's Electron browser does not currently provide one.`
    })
  }

  if (Object.keys(objectValue(manifest.commands)).length > 0) {
    addIssue({
      kind: 'browser-ui',
      severity: 'blocker',
      message: 'Extension keyboard commands are declared, but Sockfish does not yet register extension commands.'
    })
  }

  const hostPatterns = [
    ...stringList(manifest.host_permissions),
    ...stringList(manifest.permissions).filter((permission) => permission.includes('://') || permission === '<all_urls>')
  ]
  if (hostPatterns.includes('<all_urls>')) {
    addIssue({
      kind: 'host-access',
      severity: 'warning',
      message: 'The manifest requests <all_urls>; confirm that the host is willing to grant access to every visited site.'
    })
  }

  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []
  if (contentScripts.some((entry) => objectValue(entry).world === 'MAIN')) {
    addIssue({
      kind: 'manifest',
      severity: 'warning',
      message: 'A content script requests world: "MAIN"; the isolated Chromium probe confirmed that the page MAIN world has no extension browser namespace, so a separate isolated-world bridge is required for extension APIs.'
    })
  }

  const observedApis = findExtensionApiReferences(sourceFiles)
  const observedApiNames = observedApis.map((reference) => reference.replace(/^(chrome|browser)\./, ''))
  const probedApiNames = observedApiNames.filter((api) => isRuntimeObservedApi(target, manifestVersion, api))
  const undocumentedNames = [...new Set(observedApis
    .filter((reference, index) => !reference.startsWith('browser.') && hasPrefix(observedApiNames[index] ?? '', UNDOCUMENTED_ELECTRON_API_PREFIXES) && !isRuntimeObservedApi(target, manifestVersion, observedApiNames[index] ?? ''))
    .map((reference) => reference.replace(/^(chrome|browser)\./, '').split('.').slice(0, 2).join('.')))].sort()
  const unverifiedNamespaceUsed = observedApis.some((reference) => reference.startsWith('browser.'))

  if (undocumentedNames.length > 0) {
    addIssue({
      kind: 'api-gap',
      severity: 'blocker',
      message: `Extension source references APIs outside Electron's documented surface and not present in the relevant runtime fixture: ${undocumentedNames.join(', ')}.`
    })
  }
  if (probedApiNames.length > 0 || unverifiedNamespaceUsed) {
    const names = [...new Set([
      ...(probedApiNames.length > 0 ? probedApiNames.map((api) => api.split('.').slice(0, 2).join('.')) : []),
      ...(unverifiedNamespaceUsed ? ['browser.* namespace'] : [])
    ])].sort()
    addIssue({
      kind: 'api-gap',
      severity: 'warning',
      message: `Static source references APIs outside Electron's documented surface that were exposed in Sockfish's Electron 44.5.1 runtime probe: ${names.join(', ')}. Presence is not a complete behavioral test.`
    })
  }

  if (observedApis.some((reference) => reference.startsWith('chrome.webRequest.')) || declaredPermissions.has('webRequest')) {
    addIssue({
      kind: 'api-gap',
      severity: 'warning',
      message: 'The extension uses webRequest, which Electron documents, but its session-level handler can conflict with Sockfish\'s existing Ghostery request blocker.'
    })
  }

  const extensionName = typeof manifest.name === 'string' && !manifest.name.startsWith('__MSG_')
    ? manifest.name
    : typeof manifest.short_name === 'string' ? manifest.short_name : details.label

  return {
    target,
    extensionName,
    manifestVersion,
    issues,
    observedApis,
    noDeclaredBlockers: !issues.some((issue) => issue.severity === 'blocker'),
    staticOnly: true
  }
}
