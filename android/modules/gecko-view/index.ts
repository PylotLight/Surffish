import { requireNativeModule, requireNativeView } from 'expo'
import type { ComponentType } from 'react'
import type { ViewProps } from 'react-native'

export type ContextMenuType = 'image' | 'video' | 'audio' | 'none'

export interface GeckoEvents {
  onLocationChange: { tabId: string; url: string }
  onTitleChange: { tabId: string; title: string }
  onProgress: { tabId: string; progress: number }
  onPageStart: { tabId: string; url: string }
  onPageStop: { tabId: string; success: boolean }
  onNavState: { tabId: string; canGoBack: boolean; canGoForward: boolean }
  onSecurity: { tabId: string; secure: boolean; host: string; issuer: string | null; mixed: boolean }
  onFullScreen: { tabId: string; fullScreen: boolean }
  onContextMenu: { tabId: string; linkUri: string | null; srcUri: string | null; type: ContextMenuType; title: string | null; linkText: string | null; altText: string | null }
  onNewTabRequest: { tabId: string; openerTabId: string | null; url: string; private: boolean; source: 'window' | 'extension'; active?: boolean }
  onCloseTabRequest: { tabId: string }
  onSelectTabRequest: { tabId: string }
  onPermissionRequest: { requestId: string; tabId: string; kind: string; uri: string; media: boolean }
  onDownload: { url: string; filename: string; status: 'started' | 'done' | 'failed'; error?: string }
  onExtensionsChanged: Record<string, never>
  onExtensionPopup: { tabId: string; extensionId: string; title: string }
  onExtensionAction: { id: string; tabId: string | null; title: string | null; badgeText: string | null; enabled: boolean }
  onExtensionInstallPrompt: { requestId: string; id: string; name: string; permissions: string[]; origins: string[]; dataCollection: string[]; optional?: boolean }
  onCrash: { tabId: string }
  onIntent: LaunchIntent
  onOpenUrl: { url: string }
}

export interface LaunchIntent {
  url?: string
  text?: string
  subject?: string | null
}

export interface InstalledExtension {
  id: string
  name: string
  description: string | null
  version: string
  enabled: boolean
  builtIn: boolean
  creator: string | null
  homepageUrl: string | null
  optionsPageUrl: string | null
  amoListingUrl: string | null
  allowedInPrivate: boolean
  hasAction: boolean
  permissions: string[]
  origins: string[]
  icon: string | null
}

interface NativeGecko {
  geckoVersion: string
  init(): Promise<boolean>
  consumeLaunchIntent(): Promise<LaunchIntent | null>
  createTab(tabId: string, isPrivate: boolean, desktop: boolean, url: string | null, state: string | null): Promise<boolean>
  hasTab(tabId: string): Promise<boolean>
  closeTab(tabId: string): Promise<void>
  load(tabId: string, url: string): Promise<void>
  goBack(tabId: string): Promise<void>
  goForward(tabId: string): Promise<void>
  reload(tabId: string): Promise<void>
  stop(tabId: string): Promise<void>
  exitFullScreen(tabId: string): Promise<void>
  setDesktopMode(tabId: string, desktop: boolean): Promise<void>
  find(tabId: string, query: string, backwards: boolean): Promise<{ found: boolean; current: number; total: number }>
  clearFind(tabId: string): Promise<void>
  getSessionStates(): Promise<Record<string, string>>
  captureThumbnail(tabId: string): Promise<string | null>
  clearBrowsingData(): Promise<boolean>
  resolvePermission(requestId: string, allow: boolean): Promise<void>
  download(url: string, filename: string | null, mime: string | null): Promise<void>
  openExternal(url: string): Promise<void>
  setImmersive(enabled: boolean): Promise<void>
  listExtensions(): Promise<InstalledExtension[]>
  installExtension(url: string): Promise<InstalledExtension>
  ensureUblock(): Promise<boolean>
  setExtensionEnabled(id: string, enabled: boolean): Promise<boolean>
  setExtensionPrivate(id: string, allowed: boolean): Promise<boolean>
  uninstallExtension(id: string): Promise<boolean>
  clickExtensionAction(id: string, tabId: string | null): Promise<boolean>
  resolveInstallPrompt(requestId: string, allow: boolean, allowPrivate: boolean): Promise<void>
  addListener<K extends keyof GeckoEvents>(event: K, listener: (payload: GeckoEvents[K]) => void): { remove(): void }
}

export const Gecko = requireNativeModule<NativeGecko>('SurffishGecko')

export function addGeckoListener<K extends keyof GeckoEvents>(event: K, listener: (payload: GeckoEvents[K]) => void): { remove(): void } {
  return Gecko.addListener(event, listener)
}

export interface GeckoViewProps extends ViewProps {
  /** The tab whose GeckoSession this view shows. null shows nothing. */
  tabId: string | null
}

export const GeckoView: ComponentType<GeckoViewProps> = requireNativeView('SurffishGecko')
