import { app, shell } from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { externalOpenTarget, externalOpenTargetsFromArgv, isLocalDocumentUrl } from '../shared/external-links'
import type { DefaultBrowserStatus } from '../shared/types'
import { openExternalBrowserTab } from './browser'
import { getMainWindow, showWindow } from './window'

/** Links and files the OS hands over before the window and restored tabs exist; opened in order once ready. */
const pending: string[] = []
let ready = false

function exists(target: string): boolean {
  if (!isLocalDocumentUrl(target)) return true
  try {
    return existsSync(fileURLToPath(target))
  } catch {
    return false
  }
}

function open(target: string, focus = true): void {
  const hadWindow = getMainWindow() !== null
  // A new window restores its tabs synchronously and shows itself once its surfaces load.
  if (!hadWindow) showWindow()
  if (openExternalBrowserTab(target) && hadWindow && focus) showWindow()
}

function enqueue(value: string): void {
  const target = externalOpenTarget(value)
  if (!target || !exists(target)) return
  if (ready) open(target)
  else pending.push(target)
}

/**
 * Register before app ready: macOS delivers default-browser links (`open-url`) and Finder/Dock
 * files (`open-file`) during launch, and Windows/Linux pass them on the command line.
 */
export function registerExternalOpenHandlers(): void {
  app.on('will-finish-launching', () => {
    app.on('open-url', (event, url) => {
      event.preventDefault()
      enqueue(url)
    })
    app.on('open-file', (event, path) => {
      event.preventDefault()
      enqueue(path)
    })
  })
  app.on('second-instance', (_event, argv) => {
    const targets = externalOpenTargetsFromArgv(argv)
    if (targets.length === 0) {
      showWindow()
      return
    }
    for (const target of targets) enqueue(target)
  })
  if (process.platform !== 'darwin') {
    for (const target of externalOpenTargetsFromArgv(process.argv)) enqueue(target)
  }
}

/** Call once the main window and its restored tabs exist. */
export function flushExternalOpens(): void {
  ready = true
  // The window was just created and shows itself when ready; don't force it up early.
  for (const target of pending.splice(0)) open(target, false)
}

const WEB_SCHEMES = ['http', 'https'] as const

export function getDefaultBrowserStatus(): DefaultBrowserStatus {
  const isDefault = WEB_SCHEMES.every((scheme) => app.isDefaultProtocolClient(scheme))
  // An unpackaged build would register the bare Electron binary as the system browser.
  return { isDefault, canSet: app.isPackaged, platform: process.platform }
}

/**
 * macOS asks the user to confirm in a system dialog, so the status may only flip a moment later.
 * Windows 10+ ignores programmatic changes; open the Default apps settings page instead.
 */
export async function makeDefaultBrowser(): Promise<DefaultBrowserStatus> {
  if (!app.isPackaged) return getDefaultBrowserStatus()
  for (const scheme of WEB_SCHEMES) {
    try {
      app.setAsDefaultProtocolClient(scheme)
    } catch (error) {
      console.warn(`Could not register as the ${scheme} handler:`, error)
    }
  }
  const status = getDefaultBrowserStatus()
  if (!status.isDefault && process.platform === 'win32') {
    await shell.openExternal('ms-settings:defaultapps').catch(() => undefined)
  }
  return status
}
