import type { WebContents } from 'electron'
import { filterTabsForQuery, isAllowedExtensionTabUrl, toChromeTab, type ExtensionAccess } from '../shared/extension-tabs'
import {
  createExtensionTab,
  getExtensionTab,
  getExtensionTabForContents,
  listExtensionTabs,
  reloadExtensionTab,
  removeExtensionTabs,
  updateExtensionTab,
  type ExtensionPageOwner
} from './browser'

/**
 * Who is calling chrome.tabs from an extension page (popup or options tab), as resolved and checked by
 * the extension's owner (web-store-extensions.ts, bramble-poc.ts) from the IPC sender.
 */
export interface ExtensionTabsCaller {
  /** The extension's ID (the chrome-extension:// host). */
  id: string
  /** `chrome-extension://<id>/` */
  extensionUrl: string
  access: ExtensionAccess
  /** Preload for the extension's own pages opened in Surffish tabs (keeps the bridge in the new tab). */
  pagePreloadPath: string
  owner: ExtensionPageOwner
  /** The page that called. */
  sender: WebContents
  /** Called when a call switched the active tab (Chrome then closes the extension's toolbar popup). */
  onActiveTabSwitch?: () => void
}

/**
 * chrome.tabs.query/get/getCurrent/create/update/reload/remove from an extension page, served from
 * Surffish's own tabs. Extensions may open web pages and their own pages only.
 */
export function handleExtensionTabsCall(caller: ExtensionTabsCaller, op: unknown, payloadInput: unknown): unknown {
  const payload = typeof payloadInput === 'object' && payloadInput !== null && !Array.isArray(payloadInput)
    ? payloadInput as Record<string, unknown>
    : {}
  const { access, id } = caller
  const tabId = typeof payload.tabId === 'number' && Number.isSafeInteger(payload.tabId) ? payload.tabId : undefined
  const checkedUrl = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    if (!isAllowedExtensionTabUrl(value, id)) throw new Error('Extensions can only open web pages or their own pages in Surffish.')
    return value
  }
  switch (op) {
    case 'query':
      return filterTabsForQuery(listExtensionTabs(), payload).map((tab) => toChromeTab(tab, access))
    case 'get': {
      const tab = tabId === undefined ? null : getExtensionTab(tabId)
      if (!tab) throw new Error(`No tab with id: ${String(payload.tabId)}.`)
      return toChromeTab(tab, access)
    }
    case 'getCurrent': {
      // A popup is not a tab (Chrome returns undefined); an options page in a tab gets its tab.
      const tab = getExtensionTabForContents(caller.sender)
      return tab ? toChromeTab(tab, access) : undefined
    }
    case 'create': {
      const url = checkedUrl(payload.url)
      const active = payload.active !== false
      const tab = url !== undefined && url.startsWith(caller.extensionUrl)
        ? createExtensionTab(url, active, { extensionUrl: caller.extensionUrl, preloadPath: caller.pagePreloadPath, owner: caller.owner })
        : createExtensionTab(url, active)
      if (!tab) throw new Error('Could not open a tab.')
      if (active) caller.onActiveTabSwitch?.()
      return toChromeTab(tab, access)
    }
    case 'update': {
      const url = checkedUrl(payload.url)
      if (url?.startsWith('chrome-extension:')) throw new Error('Open extension pages with tabs.create.')
      const tab = updateExtensionTab(tabId, {
        url,
        active: typeof payload.active === 'boolean' ? payload.active : undefined,
        pinned: typeof payload.pinned === 'boolean' ? payload.pinned : undefined
      })
      if (!tab) throw new Error(`No tab with id: ${String(payload.tabId)}.`)
      if (payload.active === true) caller.onActiveTabSwitch?.()
      return toChromeTab(tab, access)
    }
    case 'reload':
      if (!reloadExtensionTab(tabId, payload.bypassCache === true)) throw new Error(`No tab with id: ${String(payload.tabId)}.`)
      return undefined
    case 'remove': {
      const ids = Array.isArray(payload.tabIds) ? payload.tabIds.filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value)) : []
      removeExtensionTabs(ids)
      return undefined
    }
    default:
      throw new Error('Unsupported tabs operation.')
  }
}
