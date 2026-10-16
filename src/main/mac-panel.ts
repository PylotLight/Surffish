import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BaseWindow } from 'electron'

/**
 * Mini window panels on macOS (the mini windows and the menu bar popout, their floating headers and
 * edge handles): `type: 'panel'` windows on every Space that should never activate Surffish.
 *
 * Why it matters: when Surffish becomes the active app while a browser window lives on another Space,
 * macOS ("When switching to an application, switch to a Space with open windows") pulls the user over
 * to that Space, and hiding a key panel of the active app hands the key window to the browser window
 * over there (same jump). Electron fakes the panel's nonactivating style mask at runtime, which newer
 * macOS releases stop honouring for clicks (electron/electron#53889; upstream fix proposed in #54807
 * sets the window's "prevents activation" tag). Until that ships in Electron, the native addon
 * (src/native/macos/mac-trackpad-swipe.mm, `preventActivation`) sets the same tag on our panels.
 * Opt out with SURFFISH_PANEL_ACTIVATION=allow (for comparing on a Mac).
 */

interface PanelActivationAddon {
  preventActivation?(windowHandle: Buffer): boolean
}

interface PanelActivationGuardDeps {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /** Load the native addon (null: not built in this run). Called at most once. */
  load(): PanelActivationAddon | null
  warn(message: string, error?: unknown): void
}

interface PanelActivationGuard {
  /** Keep `window` (a `type: 'panel'` window) from activating Surffish. True when the tag was set. */
  apply(window: Pick<BaseWindow, 'isDestroyed' | 'getNativeWindowHandle'>): boolean
  /** Whether the guard can do anything here (macOS, not opted out, the addon has the export). */
  available(): boolean
}

export function createPanelActivationGuard(deps: PanelActivationGuardDeps): PanelActivationGuard {
  let addon: PanelActivationAddon | null | undefined
  const enabled = deps.platform === 'darwin' && deps.env.SURFFISH_PANEL_ACTIVATION !== 'allow'

  function loaded(): PanelActivationAddon | null {
    if (!enabled) return null
    if (addon !== undefined) return addon
    try {
      addon = deps.load()
    } catch (error) {
      deps.warn('[mac panel] Native addon could not be loaded; panels may activate Surffish:', error)
      addon = null
    }
    if (addon && typeof addon.preventActivation !== 'function') {
      // An addon built before this export (a stale out/native): nothing to call.
      deps.warn('[mac panel] Native addon has no preventActivation; panels may activate Surffish.')
      addon = null
    }
    return addon
  }

  return {
    available: () => loaded() !== null,
    apply: (window) => {
      const native = loaded()
      if (!native?.preventActivation || window.isDestroyed()) return false
      try {
        return native.preventActivation(window.getNativeWindowHandle()) === true
      } catch (error) {
        deps.warn('[mac panel] Could not keep a panel from activating Surffish:', error)
        return false
      }
    }
  }
}

const requireFromMain = createRequire(import.meta.url)

const guard = createPanelActivationGuard({
  platform: process.platform,
  env: process.env,
  load: () => {
    // Every main chunk sits in out/main, beside out/native (as for mac-trackpad-swipe.ts).
    const addonPath = join(dirname(fileURLToPath(import.meta.url)), '../native/mac-trackpad-swipe.node')
    return existsSync(addonPath) ? (requireFromMain(addonPath) as PanelActivationAddon) : null
  },
  warn: (message, error) => (error === undefined ? console.warn(message) : console.warn(message, error))
})

/**
 * Make `window` a floating panel: above normal windows ('floating' on macOS), on every Space and over
 * full-screen apps, and (macOS) never activating Surffish. Call right after creating it.
 */
export function makeFloatingPanel(window: BaseWindow): void {
  if (process.platform === 'darwin') {
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    guard.apply(window)
  } else {
    window.setAlwaysOnTop(true)
  }
}

/**
 * Bring a floating panel up on the Space the user is on. `focus`: it takes the keyboard too.
 * macOS: every Space again first, shown without focus, then made key on its own. `window.show()` on a
 * non-panel (and `app.focus()`) would activate Surffish, and macOS would switch to the Space holding a
 * browser window; `focus()` on a panel only makes it key. Elsewhere: show + focus as before.
 */
export function showFloatingPanel(window: BaseWindow, focus: boolean): void {
  if (window.isDestroyed()) return
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    if (!window.isVisible()) window.showInactive()
    if (focus) window.focus()
    window.setAlwaysOnTop(true, 'floating')
    return
  }
  if (focus) {
    window.show()
    window.focus()
  } else if (!window.isVisible()) {
    window.showInactive()
  }
  window.setAlwaysOnTop(true)
}

