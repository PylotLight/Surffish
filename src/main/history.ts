import { app } from 'electron'
import { cancelDeferredWrite, deferWrite } from './deferred-writes'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowsingHistoryEntry } from '../shared/types'
import { normalizeFaviconUrl } from '../shared/persistence'

const MAX_HISTORY_ENTRIES = 5000
let loaded = false
let entries: BrowsingHistoryEntry[] = []

function normalizeHistoryEntry(value: unknown): BrowsingHistoryEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Partial<BrowsingHistoryEntry>
  if (typeof entry.id !== 'string'
    || typeof entry.url !== 'string'
    || !/^https?:\/\//i.test(entry.url)
    || typeof entry.title !== 'string'
    || typeof entry.visitedAt !== 'number'
    || !Number.isFinite(entry.visitedAt)) return null
  const faviconUrl = normalizeFaviconUrl(entry.faviconUrl)
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    visitedAt: entry.visitedAt,
    ...(faviconUrl ? { faviconUrl } : {})
  }
}

function historyPath(): string {
  return join(app.getPath('userData'), 'browsing-history.json')
}

function loadHistory(): void {
  if (loaded) return
  loaded = true
  const path = historyPath()
  if (!existsSync(path)) return
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (Array.isArray(parsed)) {
      entries = parsed.map(normalizeHistoryEntry).filter((entry): entry is BrowsingHistoryEntry => entry !== null).slice(0, MAX_HISTORY_ENTRIES)
    }
  } catch (error) {
    console.warn('Could not read browsing history:', error)
    entries = []
  }
}

function persistHistory(): void {
  deferWrite('history', writeHistory, 1500)
}

function writeHistory(): void {
  const path = historyPath()
  const directory = app.getPath('userData')
  const temporaryPath = `${path}.tmp`
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify(entries), 'utf8')
    renameSync(temporaryPath, path)
  } catch (error) {
    console.error('Could not save browsing history:', error)
  }
}

export function getBrowsingHistory(): BrowsingHistoryEntry[] {
  loadHistory()
  return entries.map((entry) => ({ ...entry }))
}

export function recordBrowsingVisit(url: string, title: string): void {
  if (!/^https?:\/\//i.test(url)) return
  loadHistory()
  entries.unshift({
    id: randomUUID(),
    url,
    title: title.trim() || url,
    visitedAt: Date.now()
  })
  entries = entries.slice(0, MAX_HISTORY_ENTRIES)
  persistHistory()
}

export function updateLatestVisitTitle(url: string, title: string): void {
  if (!url || !title.trim()) return
  loadHistory()
  const entry = entries.find((candidate) => candidate.url === url)
  if (!entry || entry.title === title) return
  entry.title = title
  persistHistory()
}

export function updateLatestVisitFavicon(url: string, faviconUrl: string): void {
  if (!url) return
  const normalizedFaviconUrl = normalizeFaviconUrl(faviconUrl)
  if (!normalizedFaviconUrl) return
  loadHistory()
  const entry = entries.find((candidate) => candidate.url === url)
  if (!entry || entry.faviconUrl === normalizedFaviconUrl) return
  entry.faviconUrl = normalizedFaviconUrl
  persistHistory()
}

export function clearBrowsingHistory(): void {
  loadHistory()
  entries = []
  // Clearing is a privacy action: hit the disk now rather than in a second.
  cancelDeferredWrite('history')
  writeHistory()
}

/** Remove entries matching `predicate` (Clear browsing data, Forget this site). Returns how many went. */
export function removeBrowsingHistory(predicate: (entry: BrowsingHistoryEntry) => boolean): number {
  loadHistory()
  const before = entries.length
  entries = entries.filter((entry) => !predicate(entry))
  const removed = before - entries.length
  if (removed > 0) {
    cancelDeferredWrite('history')
    writeHistory()
  }
  return removed
}

/**
 * Merge visits imported from another browser. Exact (url, time) repeats are skipped, the list
 * stays newest-first and capped, so a huge import only keeps the most recent visits.
 */
export function importBrowsingHistory(imported: ReadonlyArray<{ url: string; title: string; visitedAt: number }>): number {
  loadHistory()
  const seen = new Set(entries.map((entry) => `${entry.visitedAt}\n${entry.url}`))
  const added: BrowsingHistoryEntry[] = []
  for (const visit of imported) {
    if (!/^https?:\/\//i.test(visit.url) || !Number.isFinite(visit.visitedAt)) continue
    const key = `${visit.visitedAt}\n${visit.url}`
    if (seen.has(key)) continue
    seen.add(key)
    added.push({ id: randomUUID(), url: visit.url, title: visit.title.trim() || visit.url, visitedAt: visit.visitedAt })
  }
  if (added.length === 0) return 0
  const addedIds = new Set(added.map((entry) => entry.id))
  entries = [...entries, ...added].sort((a, b) => b.visitedAt - a.visitedAt).slice(0, MAX_HISTORY_ENTRIES)
  persistHistory()
  return entries.reduce((count, entry) => count + (addedIds.has(entry.id) ? 1 : 0), 0)
}
