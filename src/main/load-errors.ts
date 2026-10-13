import type { Session } from 'electron'
import { parseLoadError, type BrowserLoadError } from '../shared/navigation-errors'
import { getEffectiveRoute } from './proxy'

/**
 * Extra details for a tab's `error` string (which URL failed, whether the failure left an empty
 * error page). Keyed by the tab object so browser.ts only has to note errors, not carry fields.
 */
interface LoadErrorNote {
  message: string
  url: string
  fullPage: boolean
}

const notes = new WeakMap<object, LoadErrorNote>()

export function noteTabLoadError(tab: object, message: string, url: string, fullPage: boolean): void {
  notes.set(tab, { message, url, fullPage })
}

/** Load-error details for the tab's current `error`, or null when it has none. */
export function tabLoadError(tab: object, error: string | null, fallbackUrl: string, session?: Session): BrowserLoadError | null {
  if (!error) return null
  const note = notes.get(tab)
  const matching = note && note.message === error ? note : null
  const url = matching?.url || fallbackUrl
  const { code, name } = parseLoadError(error)
  let viaProxy = false
  try {
    viaProxy = getEffectiveRoute(url, session)?.kind === 'proxy'
  } catch {
    viaProxy = false
  }
  return { code, name, url, viaProxy, fullPage: matching?.fullPage ?? false }
}
