/**
 * Space definitions (name, icon, colour, partition, proxy) and the "Enable Spaces" setting, saved
 * in surffish.db (`spaces` + the `spaces.enabled` setting, store/spaces-table.ts) and in
 * browser-spaces.json. No browser.ts import: browser.ts, proxy and the session code read it.
 * The model and rules are in shared/spaces.ts.
 *
 * Startup reads the database when it has the Spaces and browser-spaces.json is gone or unchanged
 * since Surffish wrote it; otherwise the JSON wins and is imported. Both copies are written on
 * every change (the file is tiny and changes are rare), and the database write only touches the
 * Spaces that changed. No database (or `SURFFISH_STORE=json`): the JSON file only, as before.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { BROWSER_SESSION_PARTITION } from './browser-session'
import { deferWrite } from './deferred-writes'
import { readUserJson, writeSettingsFile } from './user-json'
import { setPartitionRouteResolver } from './proxy'
import { getProfileDatabase, reportStoreWriteError } from './store'
import { databaseCopyIsCurrent, settleDualWrite } from './store/legacy-json'
import { SpacesTable } from './store/spaces-table'
import {
  DEFAULT_SPACE_ID,
  findSpace,
  parseSpacesSettings,
  partitionForSpace,
  serializeSpacesSettings,
  SPACE_PARTITION_PREFIX,
  type SpaceDefinition,
  type SpaceProxyChoice,
  type SpacesSettings
} from '../shared/spaces'

const FILE = 'browser-spaces.json'
let settings: SpacesSettings | null = null
let table: SpacesTable | null | undefined

function sqlTable(): SpacesTable | null {
  if (table !== undefined) return table
  const db = getProfileDatabase()
  table = db ? new SpacesTable(db) : null
  return table
}

function filePath(): string {
  return join(app.getPath('userData'), FILE)
}

function saveToDatabase(value: SpacesSettings): boolean {
  const target = sqlTable()
  if (!target) return false
  try {
    target.save(value)
    return true
  } catch (error) {
    reportStoreWriteError('Could not save Spaces to the database (browser-spaces.json still has them):', error)
    table = null
    return false
  }
}

/** The raw Spaces to parse: the database copy when current, else browser-spaces.json (imported shortly after). */
function readSaved(): unknown {
  const db = getProfileDatabase()
  const target = sqlTable()
  if (db && target) {
    try {
      if (databaseCopyIsCurrent(db, FILE, filePath(), target.hasSavedCopy())) {
        const saved = target.load()
        if (saved) return saved
      }
    } catch (error) {
      console.error('Could not read Spaces from the database; using browser-spaces.json:', error)
    }
  }
  const raw = readUserJson(FILE)
  if (target) {
    deferWrite('spaces-import', () => {
      if (!settings) return
      const saved = saveToDatabase(settings)
      settleDualWrite(getProfileDatabase(), FILE, filePath(), saved, saved)
    }, 1500)
  }
  return raw
}

function current(): SpacesSettings {
  if (!settings) {
    settings = parseSpacesSettings(readSaved())
    // Tell the proxy which route each Space partition is forced to.
    setPartitionRouteResolver(spaceProxyForPartition)
  }
  return settings
}

export function getSpacesSettings(): SpacesSettings {
  const value = current()
  return { enabled: value.enabled, spaces: value.spaces.map((space) => ({ ...space })) }
}

export function spacesEnabled(): boolean {
  return current().enabled
}

export function getSpace(id: string | null | undefined): SpaceDefinition | undefined {
  return findSpace(current(), id)
}

/** Save new settings (already validated by the shared helpers). */
export function saveSpacesSettings(next: SpacesSettings): void {
  settings = parseSpacesSettings(serializeSpacesSettings(next))
  const jsonSaved = writeSettingsFile(FILE, serializeSpacesSettings(settings))
  if (sqlTable()) settleDualWrite(getProfileDatabase(), FILE, filePath(), saveToDatabase(settings), jsonSaved)
}

/** The partition a Space's normal tabs use (Default, unknown Spaces and Spaces off: the profile one). */
export function partitionForSpaceId(id: string | null | undefined): string {
  const value = current()
  if (!value.enabled) return BROWSER_SESSION_PARTITION
  return partitionForSpace(findSpace(value, id ?? DEFAULT_SPACE_ID), BROWSER_SESSION_PARTITION)
}

function spaceProxyForPartition(partition: string): SpaceProxyChoice {
  const value = current()
  if (!value.enabled || !partition.startsWith(SPACE_PARTITION_PREFIX)) return 'inherit'
  const space = findSpace(value, partition.slice(SPACE_PARTITION_PREFIX.length))
  return space?.partitioned ? space.proxy : 'inherit'
}

/** Partitions of every Space with separate logins (opened this run or not), for Clear Browsing Data. */
export function knownSpacePartitions(): string[] {
  return current().spaces.filter((space) => space.partitioned).map((space) => partitionForSpace(space, BROWSER_SESSION_PARTITION))
}

/** Read the file and hook the proxy resolver up early (before any page session is created). */
export function initializeSpacesStore(): void {
  current()
}
