export type PasswordManagerTarget = 'bitwarden' | 'bramble'
export type CompatibilityIssueKind = 'manifest' | 'api-gap' | 'browser-ui'

export interface PasswordExtensionManifest {
  manifest_version?: unknown
  name?: unknown
  short_name?: unknown
  permissions?: unknown
  optional_permissions?: unknown
  background?: unknown
  action?: unknown
  browser_action?: unknown
  commands?: unknown
}

export interface CompatibilityIssue {
  kind: CompatibilityIssueKind
  message: string
}

export interface PasswordExtensionCompatibility {
  target: PasswordManagerTarget
  extensionName: string
  manifestVersion: number | null
  issues: CompatibilityIssue[]
  noDeclaredBlockers: boolean
}

const TARGET_DETAILS: Record<PasswordManagerTarget, {
  label: string
  documentedApiGaps: readonly string[]
  actions: readonly string[]
}> = {
  bitwarden: {
    label: 'Bitwarden',
    documentedApiGaps: [
      'alarms',
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
      'clipboardWrite',
      'webAuthenticationProxy',
      'identity',
      'commands'
    ],
    actions: ['action']
  }
}

function stringPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Checks only declared compatibility risks. Passing this check would not prove
 * runtime compatibility; Electron supports only a subset of Chrome extension APIs.
 */
export function inspectPasswordExtensionCompatibility(
  target: PasswordManagerTarget,
  manifest: PasswordExtensionManifest
): PasswordExtensionCompatibility {
  const details = TARGET_DETAILS[target]
  const issues: CompatibilityIssue[] = []
  const manifestVersion = typeof manifest.manifest_version === 'number' ? manifest.manifest_version : null
  const background = typeof manifest.background === 'object' && manifest.background !== null
    ? manifest.background as Record<string, unknown>
    : {}

  if (background.service_worker) {
    issues.push({
      kind: 'manifest',
      message: `${details.label} requires a Manifest V3 background service worker; Electron documents background-page support but not extension service-worker support.`
    })
  }

  const permissions = new Set(stringPermissions(manifest.permissions))
  const gaps = details.documentedApiGaps.filter((permission) => permissions.has(permission))
  if (gaps.length > 0) {
    issues.push({
      kind: 'api-gap',
      message: `Declared permissions rely on APIs outside Electron's documented extension subset: ${gaps.join(', ')}.`
    })
  }

  const actionKey = details.actions.find((key) => manifest[key as keyof PasswordExtensionManifest] !== undefined)
  if (actionKey) {
    issues.push({
      kind: 'browser-ui',
      message: `The ${actionKey} popup declared by this extension has no Sockfish toolbar/popup host yet.`
    })
  }

  if (manifest.commands && typeof manifest.commands === 'object') {
    issues.push({
      kind: 'browser-ui',
      message: 'Extension keyboard commands are declared, but Sockfish does not yet register extension commands.'
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
    noDeclaredBlockers: issues.length === 0
  }
}
