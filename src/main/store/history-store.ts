import type { BrowsingHistoryEntry } from '../../shared/types'
import type { SurffishDatabase } from './database'

/**
 * Browsing history on SQLite. One row per visit (like Chrome's `visits`), newest first by
 * `visited_at`. Writes are single indexed inserts/updates instead of rewriting a 5,000-entry
 * JSON file, so the database can keep far more than the list the UI asks for.
 */

export const HISTORY_ENTITY = 'history_visit'
/** Visits kept on disk; the oldest go first. The UI list is capped separately (history.ts). */
export const MAX_STORED_VISITS = 50_000
const PRUNE_EVERY_INSERTS = 500

interface VisitRow {
  id: string
  url: string
  title: string
  visited_at: number
  favicon_url: string | null
}

function toEntry(row: VisitRow): BrowsingHistoryEntry {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    visitedAt: Number(row.visited_at),
    ...(row.favicon_url ? { faviconUrl: row.favicon_url } : {})
  }
}

export class HistoryStore {
  private insertsSincePrune = 0

  constructor(private readonly db: SurffishDatabase, private readonly maxStored = MAX_STORED_VISITS) {}

  /** Newest first. */
  recent(limit: number): BrowsingHistoryEntry[] {
    return this.db.all<VisitRow>('SELECT id, url, title, visited_at, favicon_url FROM history_visits ORDER BY visited_at DESC, id DESC LIMIT ?', limit).map(toEntry)
  }

  count(): number {
    return Number(this.db.get<{ count: number }>('SELECT count(*) AS count FROM history_visits')?.count ?? 0)
  }

  /** Insert one visit (returns its id). */
  add(visit: { id?: string; url: string; title: string; visitedAt: number; faviconUrl?: string }): string {
    const { now, hlc, deviceId } = this.db.stamp()
    const id = visit.id ?? this.db.newId()
    this.db.run(
      'INSERT INTO history_visits (id, url, title, visited_at, favicon_url, device_id, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, visit.url, visit.title, visit.visitedAt, visit.faviconUrl ?? null, deviceId, now, now, hlc
    )
    this.insertsSincePrune += 1
    if (this.insertsSincePrune >= PRUNE_EVERY_INSERTS) this.prune()
    return id
  }

  setTitle(id: string, title: string): void {
    const { now, hlc, deviceId } = this.db.stamp()
    this.db.run('UPDATE history_visits SET title = ?, updated_at = ?, hlc = ?, device_id = ? WHERE id = ? AND title <> ?', title, now, hlc, deviceId, id, title)
  }

  setFavicon(id: string, faviconUrl: string): void {
    const { now, hlc, deviceId } = this.db.stamp()
    this.db.run('UPDATE history_visits SET favicon_url = ?, updated_at = ?, hlc = ?, device_id = ? WHERE id = ? AND favicon_url IS NOT ?', faviconUrl, now, hlc, deviceId, id, faviconUrl)
  }

  /** Delete everything (Clear history) and leave one `clear` op for sync. */
  clear(): number {
    const removed = this.db.transaction(() => {
      const count = this.count()
      this.db.run('DELETE FROM history_visits')
      this.db.recordClear(HISTORY_ENTITY)
      return count
    })
    // Privacy: don't leave the cleared pages sitting in the WAL file until the next checkpoint.
    this.db.checkpoint('TRUNCATE')
    return removed
  }

  /** Delete the visits `predicate` matches (Clear browsing data by time range, Forget this site). */
  removeWhere(predicate: (entry: BrowsingHistoryEntry) => boolean): number {
    const ids: string[] = []
    for (const row of this.db.statement('SELECT id, url, title, visited_at, favicon_url FROM history_visits').iterate() as Iterable<VisitRow>) {
      if (predicate(toEntry(row))) ids.push(row.id)
    }
    if (ids.length === 0) return 0
    this.removeIds(ids)
    this.db.checkpoint('TRUNCATE')
    return ids.length
  }

  removeIds(ids: readonly string[]): void {
    this.db.transaction(() => {
      for (const id of ids) this.db.run('DELETE FROM history_visits WHERE id = ?', id)
      this.db.recordDeletes(HISTORY_ENTITY, ids)
    })
  }

  /**
   * Bulk insert (JSON migration, import from another browser). Rows whose id already exists, or
   * exact (url, visited_at) repeats, are skipped. Returns the ids actually inserted.
   */
  addMany(visits: ReadonlyArray<{ id?: string; url: string; title: string; visitedAt: number; faviconUrl?: string }>): string[] {
    const inserted: string[] = []
    this.db.transaction(() => {
      for (const visit of visits) {
        if (visit.id && this.db.get('SELECT 1 AS hit FROM history_visits WHERE id = ?', visit.id)) continue
        if (this.db.get('SELECT 1 AS hit FROM history_visits WHERE url = ? AND visited_at = ?', visit.url, visit.visitedAt)) continue
        const { now, hlc, deviceId } = this.db.stamp()
        const id = visit.id ?? this.db.newId()
        this.db.run(
          'INSERT INTO history_visits (id, url, title, visited_at, favicon_url, device_id, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          id, visit.url, visit.title, visit.visitedAt, visit.faviconUrl ?? null, deviceId, now, now, hlc
        )
        inserted.push(id)
      }
      this.prune()
    })
    return inserted
  }

  /** Drop the oldest visits beyond the cap (their ops go too; they never need to sync). */
  prune(): number {
    this.insertsSincePrune = 0
    const over = this.count() - this.maxStored
    if (over <= 0) return 0
    this.db.run('DELETE FROM history_visits WHERE id IN (SELECT id FROM history_visits ORDER BY visited_at ASC, id ASC LIMIT ?)', over)
    return over
  }
}
