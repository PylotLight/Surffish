/**
 * Entry point web-store-extensions.ts loads on demand for extensions that use declarativeNetRequest
 * or webNavigation: Surffish's DNR enforcement plus the hidden bridge page. Kept out of the startup
 * bundle (most profiles have no such extension).
 */
import type { Session, WebContents } from 'electron'
import { manifestUsesDnr, registerExtensionDnr, unregisterExtensionDnr } from './extension-dnr'
import { disposeExtensionBridges, startExtensionBridge, stopExtensionBridge } from './extension-bridge'

export interface ExtensionRuntimeOptions {
  id: string
  directory: string
  manifest: Record<string, unknown>
  extensionUrl: string
  session: Session
  statePath: string
  isTab(contents: WebContents): boolean
}

export function startExtensionRuntimeSupport(options: ExtensionRuntimeOptions): void {
  const permissions = Array.isArray(options.manifest.permissions) ? options.manifest.permissions : []
  registerExtensionDnr(options.session, options.id, options.directory, options.manifest, options.statePath)
  startExtensionBridge({
    id: options.id,
    extensionUrl: options.extensionUrl,
    session: options.session,
    webNavigation: permissions.includes('webNavigation'),
    dnr: manifestUsesDnr(options.manifest),
    isTab: options.isTab
  })
}

export function stopExtensionRuntimeSupport(id: string): void {
  stopExtensionBridge(id)
  unregisterExtensionDnr(id)
}

export function disposeExtensionRuntimeSupport(): void {
  disposeExtensionBridges()
}
