import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowsingHistoryEntry } from '../shared/types'

const MAX_HISTORY_ENTRIES = 5000
let loaded = false
let entries: BrowsingHistoryEntry[] = []

function isHistoryEntry(value: unknown): value is BrowsingHistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<BrowsingHistoryEntry>
  return typeof entry.id === 'string'
    && typeof entry.url === 'string'
    && /^https?:\/\//i.test(entry.url)
    && typeof entry.title === 'string'
    && typeof entry.visitedAt === 'number'
    && Number.isFinite(entry.visitedAt)
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
      entries = parsed.filter(isHistoryEntry).slice(0, MAX_HISTORY_ENTRIES)
    }
  } catch (error) {
    console.warn('Could not read browsing history:', error)
    entries = []
  }
}

function persistHistory(): void {
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

export function clearBrowsingHistory(): void {
  loadHistory()
  entries = []
  persistHistory()
}
