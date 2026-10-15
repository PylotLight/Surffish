/**
 * Registers Surffish's service-worker preload (preload/extension-worker.cjs) on the browser session.
 * Small on purpose: web-store-extensions.ts calls it before loading an extension that needs
 * runtime support (so the worker's first start already has the preload), without pulling in the
 * lazily loaded bridge/DNR modules. See main/extension-bridge.ts for the channel itself.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bridgeTransportOverride, sandboxDisabled } from '../shared/extension-worker-bridge'

const mainDirectory = dirname(fileURLToPath(import.meta.url))
const registered = new WeakMap<Electron.Session, string>()
const refused = new WeakSet<Electron.Session>()

function preloadPath(): string {
  const candidates = [join(mainDirectory, '../preload/extension-worker.cjs'), join(mainDirectory, '../../preload/extension-worker.cjs'), join(app.getAppPath(), 'src/preload/extension-worker.cjs')]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
}

/**
 * Register the preload once per session. Returns whether extension workers in this session can
 * use the worker transport: not with SURFFISH_EXTENSION_BRIDGE=page, not with the renderer sandbox
 * off (Chromium then never runs service-worker preloads), not on an Electron without the API.
 */
export function ensureExtensionWorkerPreload(session: Electron.Session): boolean {
  if (registered.has(session)) return true
  if (refused.has(session)) return false
  const refuse = (): boolean => {
    refused.add(session)
    return false
  }
  const override = bridgeTransportOverride(process.env.SURFFISH_EXTENSION_BRIDGE)
  if (override === 'page') return refuse()
  // SURFFISH_EXTENSION_BRIDGE=worker tries the preload even with the sandbox off (testing the
  // automatic fallback: the worker never answers, so the bridge page takes over after a timeout).
  if (override !== 'worker' && sandboxDisabled(app.commandLine, process.env)) return refuse()
  if (typeof session.registerPreloadScript !== 'function' || typeof session.serviceWorkers?.startWorkerForScope !== 'function') return refuse()
  const filePath = preloadPath()
  if (!existsSync(filePath)) return refuse()
  try {
    registered.set(session, session.registerPreloadScript({ type: 'service-worker', filePath }))
    return true
  } catch (error) {
    console.warn('[extensions] could not register the service-worker preload; extensions use bridge pages:', error instanceof Error ? error.message : error)
    return refuse()
  }
}

export function extensionWorkerPreloadActive(session: Electron.Session): boolean {
  return registered.has(session)
}
