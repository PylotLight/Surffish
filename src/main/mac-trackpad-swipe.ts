import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BaseWindow } from 'electron'

export type MacTrackpadSwipeDirection = 'back' | 'forward'

export interface MacTrackpadSwipeBeginRequest {
  windowHandle: Buffer
  x: number
  y: number
  direction: MacTrackpadSwipeDirection
}

export interface MacTrackpadSwipeCallbacks {
  onBegin(request: MacTrackpadSwipeBeginRequest): number | undefined
  onProgress(contentsId: number, progress: number): void
  onEnd(contentsId: number, direction: MacTrackpadSwipeDirection, committed: boolean, maxProgress: number): void
}

interface NativeMacTrackpadSwipeAddon {
  start(callbacks: MacTrackpadSwipeCallbacks): void
  stop(): void
  isSwipeTrackingEnabled(): boolean
}

let addon: NativeMacTrackpadSwipeAddon | null = null
const requireFromMain = createRequire(import.meta.url)

export function startMacTrackpadSwipe(_window: BaseWindow, callbacks: MacTrackpadSwipeCallbacks): boolean {
  if (process.platform !== 'darwin') return false
  stopMacTrackpadSwipe()

  const addonPath = join(dirname(fileURLToPath(import.meta.url)), '../native/mac-trackpad-swipe.node')
  if (!existsSync(addonPath)) {
    console.warn('[trackpad swipe] Native module was not built; two-finger navigation is unavailable in this run.')
    return false
  }

  try {
    const nativeAddon = requireFromMain(addonPath) as NativeMacTrackpadSwipeAddon
    nativeAddon.start({
      onBegin: (request) => {
        try {
          return callbacks.onBegin(request)
        } catch (error) {
          console.error('[trackpad swipe] Could not validate gesture start:', error)
          return undefined
        }
      },
      onProgress: (contentsId, progress) => {
        try {
          callbacks.onProgress(contentsId, progress)
        } catch (error) {
          console.error('[trackpad swipe] Could not update gesture progress:', error)
        }
      },
      onEnd: (contentsId, direction, committed, maxProgress) => {
        try {
          callbacks.onEnd(contentsId, direction, committed, maxProgress)
        } catch (error) {
          console.error('[trackpad swipe] Could not finish gesture:', error)
        }
      }
    })
    addon = nativeAddon
    console.info('[trackpad swipe] AppKit gesture capture ready; macOS page-swipe setting:', nativeAddon.isSwipeTrackingEnabled())
    return true
  } catch (error) {
    console.error('[trackpad swipe] Native module could not be loaded:', error)
    return false
  }
}

export function stopMacTrackpadSwipe(): void {
  const current = addon
  addon = null
  if (!current) return
  try {
    current.stop()
  } catch (error) {
    console.warn('[trackpad swipe] Could not stop native gesture capture:', error)
  }
}
