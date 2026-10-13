import type { WebContents } from 'electron'
import type { BrowserTabInterstitial } from '../shared/types'

/**
 * Per-tab full-page notices (crash, hang, HTTPS-only fallback). The content renderer draws
 * them over the page area; main only keeps which tab shows which.
 */
const interstitials = new Map<number, BrowserTabInterstitial>()
const listeners = new Set<() => void>()

export function getTabInterstitial(contents: WebContents | null | undefined): BrowserTabInterstitial | null {
  if (!contents || contents.isDestroyed()) return null
  return interstitials.get(contents.id) ?? null
}

export function setTabInterstitial(contents: WebContents, value: BrowserTabInterstitial | null): void {
  if (contents.isDestroyed()) return
  const current = interstitials.get(contents.id) ?? null
  if (current === null && value === null) return
  if (value === null) interstitials.delete(contents.id)
  else interstitials.set(contents.id, value)
  for (const listener of listeners) listener()
}

export function forgetTabInterstitial(contentsId: number): void {
  if (interstitials.delete(contentsId)) for (const listener of listeners) listener()
}

export function onTabInterstitialChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
