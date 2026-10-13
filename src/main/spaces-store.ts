/**
 * Space definitions (name, icon, colour, partition, proxy) and the "Enable Spaces" setting, saved
 * in browser-spaces.json. No browser.ts import: browser.ts, proxy and the session code read it.
 * The model and rules are in shared/spaces.ts.
 */
import { BROWSER_SESSION_PARTITION } from './browser-session'
import { readSettingsFile, writeSettingsFile } from './safety-store'
import { setPartitionRouteResolver } from './proxy'
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
const listeners = new Set<(settings: SpacesSettings) => void>()

function current(): SpacesSettings {
  if (!settings) {
    settings = parseSpacesSettings(readSettingsFile(FILE))
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

/** Save and announce new settings (already validated by the shared helpers). */
export function saveSpacesSettings(next: SpacesSettings): void {
  settings = parseSpacesSettings(serializeSpacesSettings(next))
  writeSettingsFile(FILE, serializeSpacesSettings(settings))
  const snapshot = getSpacesSettings()
  for (const listener of listeners) listener(snapshot)
}

export function onSpacesSettingsChanged(listener: (settings: SpacesSettings) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
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
