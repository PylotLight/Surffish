import { dialog, ipcMain, Menu, type BaseWindow, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { isMainWindowRenderer } from './browser-shell'
import { currentBrowserWindow } from './window-scope'
import {
  applyBrowserSpaceSessions,
  countBrowserTabsInSpace,
  countBrowserTabsOutsideDefaultSpace,
  deleteBrowserSpace,
  getBrowserSpacesSnapshot,
  mergeAllSpacesIntoDefault,
  moveBrowserTabToSpace,
  publishBrowserSpaces,
  switchBrowserSpace
} from './browser'
import { getSpace, getSpacesSettings, partitionForSpaceId, saveSpacesSettings } from './spaces-store'
import { getProxyRoutingState, reapplyPartitionRouting } from './proxy'
import {
  addSpace,
  DEFAULT_SPACE_ID,
  moveSpace,
  SPACE_COLORS,
  SPACE_ICONS,
  spaceProxyLabel,
  updateSpace,
  type SpaceDefinition,
  type SpacePatch,
  type SpaceProxyChoice
} from '../shared/spaces'

/**
 * Spaces UI plumbing: the switcher's IPC, its native context menu (rename / icon / colour /
 * separate logins / proxy / reorder / delete), the delete and "turn Spaces off" confirms.
 */

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) throw new Error('This browser operation is available only to the app window.')
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertMainRenderer(event)
    return listener(event, ...args)
  })
}

function windowOf(): BaseWindow | undefined {
  const win = currentBrowserWindow()
  return win && !win.isDestroyed() ? win : undefined
}

async function confirm(message: string, detail: string, action: string): Promise<boolean> {
  const win = windowOf()
  const options = { type: 'question' as const, buttons: [action, 'Cancel'], defaultId: 0, cancelId: 1, message, detail }
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return response === 0
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** New Space at the end; the window switches to it (a fresh New Tab). */
export function createBrowserSpace(input: unknown = {}): string | null {
  const settings = getSpacesSettings()
  if (!settings.enabled) return null
  const { settings: next, space } = addSpace(settings, typeof input === 'object' && input !== null ? input : {})
  saveSpacesSettings(next)
  switchBrowserSpace(space.id)
  publishBrowserSpaces()
  return space.id
}

/** Rename / icon / colour / separate logins / proxy. A partition or proxy change moves the Space's tabs over. */
export async function updateBrowserSpace(id: unknown, patch: unknown): Promise<SpaceDefinition | null> {
  if (typeof id !== 'string' || typeof patch !== 'object' || patch === null) return null
  const before = getSpace(id)
  if (!before) return null
  saveSpacesSettings(updateSpace(getSpacesSettings(), id, patch as SpacePatch))
  const after = getSpace(id)!
  if (after.partitioned !== before.partitioned || after.proxy !== before.proxy) {
    // Proxy first (fail closed), so a re-created page never loads before its route is in place.
    if (after.partitioned) await reapplyPartitionRouting(partitionForSpaceId(id)).catch((error: unknown) => console.error('[spaces] proxy for Space failed:', error))
    applyBrowserSpaceSessions()
  }
  publishBrowserSpaces()
  return after
}

export async function deleteBrowserSpaceWithConfirm(id: unknown): Promise<boolean> {
  if (typeof id !== 'string' || id === DEFAULT_SPACE_ID) return false
  const space = getSpace(id)
  if (!space) return false
  const tabs = countBrowserTabsInSpace(id)
  const details = [
    tabs > 0 ? `Its ${plural(tabs, 'tab')} (in every window) will be closed.` : 'It has no open tabs.',
    space.partitioned ? 'Its separate logins and site data are deleted too.' : ''
  ].filter(Boolean).join(' ')
  if (!await confirm(`Delete the “${space.name}” Space?`, details, tabs > 0 ? 'Close Tabs and Delete' : 'Delete')) return false
  return deleteBrowserSpace(id)
}

/**
 * "Enable Spaces". Turning it off with tabs in other Spaces asks first, then merges every tab into
 * Default (tabs from Spaces with separate logins reload in the profile session). The Space list is
 * kept, empty, for next time.
 */
export async function setBrowserSpacesEnabled(enabled: unknown): Promise<boolean> {
  const settings = getSpacesSettings()
  if (typeof enabled !== 'boolean' || enabled === settings.enabled) return settings.enabled
  if (!enabled) {
    const outside = countBrowserTabsOutsideDefaultSpace()
    if (outside > 0) {
      const ok = await confirm('Turn off Spaces?', `${plural(outside, 'tab')} from your other Spaces will move into Default. Tabs from Spaces with separate logins reload with your main profile. Your Spaces are kept for when you turn this back on.`, 'Turn Off and Merge Tabs')
      if (!ok) {
        publishBrowserSpaces()
        return true
      }
    }
    mergeAllSpacesIntoDefault()
  }
  saveSpacesSettings({ ...getSpacesSettings(), enabled })
  applyBrowserSpaceSessions()
  return enabled
}

function moveSpaceBy(id: string, offset: number): void {
  const settings = getSpacesSettings()
  const index = settings.spaces.findIndex((space) => space.id === id)
  if (index < 0) return
  saveSpacesSettings(moveSpace(settings, id, index + offset))
  publishBrowserSpaces()
}

function proxyChoices(): SpaceProxyChoice[] {
  const routing = getProxyRoutingState()
  return ['inherit', 'direct', 'proxy', ...routing.proxies.map((proxy) => `proxy:${proxy.name}` as SpaceProxyChoice)]
}

/** Right-click on a Space in the switcher. "Rename…" hands back to the renderer's inline editor. */
function showSpaceMenu(event: IpcMainInvokeEvent, id: unknown): boolean {
  if (typeof id !== 'string') return false
  const space = getSpace(id)
  const win = windowOf()
  if (!space || !win) return false
  const settings = getSpacesSettings()
  const index = settings.spaces.findIndex((candidate) => candidate.id === id)
  const isDefault = id === DEFAULT_SPACE_ID
  const sender = event.sender
  const update = (patch: SpacePatch): void => { void updateBrowserSpace(id, patch) }
  const items: MenuItemConstructorOptions[] = [
    { label: 'Rename…', click: () => { if (!sender.isDestroyed()) sender.send('browser:spaces:rename', id) } },
    {
      label: 'Icon',
      submenu: [
        { label: 'None (colour dot)', type: 'checkbox', checked: !space.icon, click: () => update({ icon: '' }) },
        { type: 'separator' },
        ...SPACE_ICONS.map((icon): MenuItemConstructorOptions => ({ label: icon, type: 'checkbox', checked: space.icon === icon, click: () => update({ icon }) }))
      ]
    },
    {
      label: 'Colour',
      submenu: SPACE_COLORS.map((color): MenuItemConstructorOptions => ({ label: color[0]!.toUpperCase() + color.slice(1), type: 'checkbox', checked: space.color === color, click: () => update({ color }) }))
    },
    { type: 'separator' },
    {
      label: 'Separate Logins (Own Cookies and Storage)',
      type: 'checkbox',
      checked: space.partitioned,
      enabled: !isDefault,
      click: () => update({ partitioned: !space.partitioned })
    },
    {
      label: space.partitioned || isDefault ? 'Proxy' : 'Proxy (needs Separate Logins)',
      enabled: space.partitioned && !isDefault,
      submenu: proxyChoices().map((choice): MenuItemConstructorOptions => ({ label: spaceProxyLabel(choice), type: 'checkbox', checked: space.proxy === choice, click: () => update({ proxy: choice }) }))
    },
    { type: 'separator' },
    { label: 'Move Left', enabled: index > 0, click: () => moveSpaceBy(id, -1) },
    { label: 'Move Right', enabled: index < settings.spaces.length - 1, click: () => moveSpaceBy(id, 1) },
    { type: 'separator' },
    { label: 'New Space', click: () => { createBrowserSpace() } },
    { label: 'Delete Space…', enabled: !isDefault, click: () => { void deleteBrowserSpaceWithConfirm(id) } }
  ]
  Menu.buildFromTemplate(items).popup({ window: win })
  return true
}

export function registerSpacesIpc(): void {
  handle('browser:spaces:get', () => getBrowserSpacesSnapshot())
  handle('browser:spaces:switch', (_event, id) => typeof id === 'string' && switchBrowserSpace(id))
  handle('browser:spaces:create', (_event, input) => createBrowserSpace(input))
  handle('browser:spaces:update', (_event, id, patch) => updateBrowserSpace(id, patch))
  handle('browser:spaces:delete', (_event, id) => deleteBrowserSpaceWithConfirm(id))
  handle('browser:spaces:set-enabled', (_event, enabled) => setBrowserSpacesEnabled(enabled))
  handle('browser:spaces:move-tab', (_event, tabId, spaceId) => typeof tabId === 'string' && typeof spaceId === 'string' && moveBrowserTabToSpace(tabId, spaceId))
  handle('browser:spaces:menu', (event, id) => showSpaceMenu(event, id))
}
