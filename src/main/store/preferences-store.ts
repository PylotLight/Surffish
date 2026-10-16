import { createHash } from 'node:crypto'
import type { BrowserPreferences } from '../../shared/persistence'
import type { SurffishDatabase } from './database'
import { RowMirror, type DesiredRow, type MirrorResult } from './row-mirror'

/**
 * Browser preferences (browser-preferences.json) in the `settings` table, one row per preference
 * so changing the search engine or one site's zoom writes one row and one change-log op:
 *
 *   pref.<name>        searchEngine, tabSleepMinutes, newTabPage, newTabPreferences (synced);
 *                      sidebarWidth and the legacy pinnedSites copy (device: never synced)
 *   site:<hash>        one site's permissions/settings, value { origin, ...settings } (synced)
 *   zoom:<hash>        one site's page zoom, value { origin, factor } (device, like Chrome/Safari)
 *   volume:<hash>      one site's tab volume, value { origin, volume } (device)
 *
 * Per-site keys use a hash of the origin, not the origin, so when Forget this site / Clear browsing
 * data removes them the row is hard-deleted and the change log keeps only a `delete` op with the
 * hash (no URL), like history visits.
 */

const SAVED_KEY = 'store:preferences:saved_at'
const SYNCED_PREFS = ['searchEngine', 'tabSleepMinutes', 'newTabPage', 'newTabPreferences'] as const
const DEVICE_PREFS = ['sidebarWidth', 'pinnedSites'] as const

const isPerSite = (key: string): boolean => key.startsWith('site:') || key.startsWith('zoom:') || key.startsWith('volume:')
const ownsKey = (key: string): boolean => key.startsWith('pref.') || isPerSite(key)

export class PreferencesTable {
  private readonly mirror: RowMirror
  private readonly hashes = new Map<string, string>()

  constructor(private readonly db: SurffishDatabase) {
    this.mirror = new RowMirror(db, { table: 'settings', columns: ['value', 'scope'], owns: ownsKey, hardDelete: isPerSite, ordered: true })
  }

  hasSavedCopy(): boolean {
    return this.db.getMeta(SAVED_KEY) !== null
  }

  /** The saved preferences in the browser-preferences.json shape (for parseBrowserPreferences), or null. */
  load(): Record<string, unknown> | null {
    if (!this.hasSavedCopy()) return null
    const result: Record<string, unknown> = { version: 1 }
    const siteSettings: Record<string, unknown> = {}
    const siteZoom: Record<string, unknown> = {}
    const siteVolume: Record<string, unknown> = {}
    // Oldest write first, so siteZoom keeps "most recently changed last" (the cap drops the oldest).
    for (const row of this.mirror.loadLive()) {
      let value: unknown
      try { value = JSON.parse(String(row.values.value)) } catch { continue }
      if (row.key.startsWith('pref.')) {
        result[row.key.slice(5)] = value
      } else if (typeof value === 'object' && value !== null && typeof (value as { origin?: unknown }).origin === 'string') {
        const { origin, ...rest } = value as { origin: string; factor?: unknown; volume?: unknown }
        if (row.key.startsWith('site:')) siteSettings[origin] = { origin, ...rest }
        else if (row.key.startsWith('volume:')) siteVolume[origin] = rest.volume
        else siteZoom[origin] = rest.factor
      }
    }
    result.siteSettings = siteSettings
    result.siteZoom = siteZoom
    result.siteVolume = siteVolume
    return result
  }

  /** Write `preferences`, touching only the rows that changed. */
  save(preferences: BrowserPreferences): MirrorResult {
    const desired = new Map<string, DesiredRow>()
    for (const name of SYNCED_PREFS) desired.set(`pref.${name}`, { values: { value: JSON.stringify(preferences[name]), scope: 'synced' } })
    for (const name of DEVICE_PREFS) desired.set(`pref.${name}`, { values: { value: JSON.stringify(preferences[name]), scope: 'device' } })
    for (const [origin, settings] of Object.entries(preferences.siteSettings)) {
      desired.set(`site:${this.hash(origin)}`, { values: { value: JSON.stringify({ ...settings, origin }), scope: 'synced' } })
    }
    for (const [origin, factor] of Object.entries(preferences.siteZoom)) {
      desired.set(`zoom:${this.hash(origin)}`, { values: { value: JSON.stringify({ origin, factor }), scope: 'device' } })
    }
    for (const [origin, volume] of Object.entries(preferences.siteVolume)) {
      desired.set(`volume:${this.hash(origin)}`, { values: { value: JSON.stringify({ origin, volume }), scope: 'device' } })
    }
    try {
      return this.db.transaction(() => {
        const result = this.mirror.sync(desired)
        if (!this.hasSavedCopy()) this.db.setMeta(SAVED_KEY, String(Date.now()))
        return result
      })
    } catch (error) {
      this.mirror.reset()
      throw error
    }
  }

  /** Fold the WAL back so removed per-site rows don't linger in it (after a privacy delete). */
  checkpoint(): void {
    this.db.checkpoint('TRUNCATE')
  }

  private hash(origin: string): string {
    let hash = this.hashes.get(origin)
    if (!hash) {
      hash = createHash('sha256').update(origin).digest('hex').slice(0, 32)
      this.hashes.set(origin, hash)
    }
    return hash
  }
}
