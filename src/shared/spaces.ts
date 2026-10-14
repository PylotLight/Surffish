/**
 * Spaces: named sets of tabs in the sidebar (Arc / Zen style), each with a name, an emoji icon and
 * a colour, and optionally its own session partition (separate logins) and its own proxy route.
 *
 * Pure model, no Electron, so it is unit tested and shared by main and the renderers.
 *
 * - Space definitions are global (one list for the app, saved in browser-spaces.json). Tabs are
 *   per window: every tab carries a space id and each window shows one active Space. Two windows
 *   may show the same Space; each keeps its own tabs in it (definitions are shared, tabs are not).
 * - The Default Space always exists (id 'default'), is first in a fresh list, can't be deleted and
 *   always uses the profile partition `persist:surffish-browser`, so existing data is untouched.
 * - Spaces are off by default. Off means: one Default Space, no switcher, no shortcuts, no swipe,
 *   no Space commands, nothing written to the session file — the browser behaves like before.
 */
import { isProxyRoute, type ProxyRoute, type ProxyRoutingInput } from './proxy-routing'

export const DEFAULT_SPACE_ID = 'default'
export const MAX_SPACES = 9
export const MAX_SPACE_NAME_LENGTH = 32
export const SPACE_PARTITION_PREFIX = 'persist:surffish-space-'

export const SPACE_COLORS = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'teal', 'grey'] as const
export type SpaceColor = typeof SPACE_COLORS[number]

/** Swatches for the switcher dot and the menus (CSS colours, readable on light and dark). */
export const SPACE_COLOR_VALUES: Record<SpaceColor, string> = {
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899',
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  teal: '#14b8a6',
  grey: '#8a8f98'
}

export const SPACE_ICONS = ['🏠', '💼', '🎮', '🎨', '📚', '🛒', '✈️', '🎵', '🧪', '💰', '🐟', '⭐'] as const

/**
 * A Space's proxy choice. 'inherit' follows Settings (main proxy + per-site rules). Anything else
 * forces this Space's default route: 'direct', 'proxy' (the main proxy) or 'proxy:<name>'.
 * Chromium sets proxies per session, so a forced route needs the Space's own partition.
 */
export type SpaceProxyChoice = 'inherit' | ProxyRoute

export interface SpaceDefinition {
  id: string
  name: string
  /** One emoji (or empty for the colour dot only). */
  icon: string
  color: SpaceColor
  /** Separate logins: the Space's tabs use their own persistent partition. Never on Default. */
  partitioned: boolean
  /** Only takes effect while `partitioned` (see SpaceProxyChoice). */
  proxy: SpaceProxyChoice
}

export interface SpacesSettings {
  enabled: boolean
  spaces: SpaceDefinition[]
}

/** What the sidebar's switcher gets for its window. */
export interface SpacesSnapshot {
  enabled: boolean
  spaces: SpaceDefinition[]
  activeSpaceId: string
  /** Tabs per Space in this window (the switcher shows a count on hover). */
  tabCounts: Record<string, number>
}

export const DEFAULT_SPACE: SpaceDefinition = { id: DEFAULT_SPACE_ID, name: 'Default', icon: '', color: 'blue', partitioned: false, proxy: 'inherit' }

export function defaultSpacesSettings(): SpacesSettings {
  return { enabled: false, spaces: [{ ...DEFAULT_SPACE }] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSpaceColor(value: unknown): value is SpaceColor {
  return typeof value === 'string' && (SPACE_COLORS as readonly string[]).includes(value)
}

/** Ids are short and partition-safe (they end up in a partition name). */
export function isSpaceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value)
}

export function normalizeSpaceName(value: unknown, fallback = 'Space'): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_SPACE_NAME_LENGTH).trim() : ''
  return name || fallback
}

/** One emoji-ish grapheme (at most 8 UTF-16 units, no letters/digits/spaces) or ''. */
export function normalizeSpaceIcon(value: unknown): string {
  if (typeof value !== 'string') return ''
  const icon = value.trim()
  if (!icon || icon.length > 8 || /[\p{L}\p{N}\s<>&"']/u.test(icon)) return ''
  return icon
}

function parseSpaceProxy(value: unknown): SpaceProxyChoice {
  return value === 'inherit' || isProxyRoute(value) ? value : 'inherit'
}

function parseSpace(value: unknown): SpaceDefinition | null {
  if (!isRecord(value) || !isSpaceId(value.id)) return null
  const isDefault = value.id === DEFAULT_SPACE_ID
  return {
    id: value.id,
    name: normalizeSpaceName(value.name, isDefault ? 'Default' : 'Space'),
    icon: normalizeSpaceIcon(value.icon),
    color: isSpaceColor(value.color) ? value.color : 'blue',
    partitioned: !isDefault && value.partitioned === true,
    proxy: isDefault ? 'inherit' : parseSpaceProxy(value.proxy)
  }
}

/** Lenient parse of browser-spaces.json: bad entries are dropped, Default is always there. */
export function parseSpacesSettings(value: unknown): SpacesSettings {
  if (!isRecord(value)) return defaultSpacesSettings()
  const spaces: SpaceDefinition[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(value.spaces) ? value.spaces : []) {
    const space = parseSpace(raw)
    if (!space || seen.has(space.id) || spaces.length >= MAX_SPACES) continue
    seen.add(space.id)
    spaces.push(space)
  }
  if (!seen.has(DEFAULT_SPACE_ID)) {
    if (spaces.length >= MAX_SPACES) spaces.pop()
    spaces.unshift({ ...DEFAULT_SPACE })
  }
  return { enabled: value.enabled === true, spaces }
}

export function serializeSpacesSettings(settings: SpacesSettings): Record<string, unknown> {
  return { version: 1, enabled: settings.enabled, spaces: settings.spaces.map((space) => ({ ...space })) }
}

export function findSpace(settings: SpacesSettings, id: string | null | undefined): SpaceDefinition | undefined {
  return id ? settings.spaces.find((space) => space.id === id) : undefined
}

/** A space id that exists (and is visible): anything else lands in Default. Off = always Default. */
export function resolveSpaceId(settings: SpacesSettings, id: string | null | undefined): string {
  if (!settings.enabled) return DEFAULT_SPACE_ID
  return findSpace(settings, id) ? id! : DEFAULT_SPACE_ID
}

/** The session partition a Space's (non-private) tabs use. */
export function partitionForSpace(space: SpaceDefinition | undefined, defaultPartition: string): string {
  if (!space || space.id === DEFAULT_SPACE_ID || !space.partitioned) return defaultPartition
  return `${SPACE_PARTITION_PREFIX}${space.id}`
}

/** Short random id, partition safe. `taken` avoids collisions. */
export function newSpaceId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    const id = `s${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`
    if (!taken.has(id) && id !== DEFAULT_SPACE_ID) return id
  }
}

export interface NewSpaceInput {
  name?: unknown
  icon?: unknown
  color?: unknown
  partitioned?: unknown
}

/** Add a Space at the end; the colour defaults to the first one not in use. Throws at the limit. */
export function addSpace(settings: SpacesSettings, input: NewSpaceInput = {}, random?: () => number): { settings: SpacesSettings; space: SpaceDefinition } {
  if (settings.spaces.length >= MAX_SPACES) throw new Error(`Up to ${MAX_SPACES} Spaces are supported.`)
  const used = new Set(settings.spaces.map((space) => space.color))
  const color = isSpaceColor(input.color) ? input.color : SPACE_COLORS.find((candidate) => !used.has(candidate)) ?? 'grey'
  const id = newSpaceId(new Set(settings.spaces.map((space) => space.id)), random)
  const space: SpaceDefinition = {
    id,
    name: normalizeSpaceName(input.name, `Space ${settings.spaces.length + 1}`),
    icon: normalizeSpaceIcon(input.icon),
    color,
    partitioned: input.partitioned === true,
    proxy: 'inherit'
  }
  return { settings: { ...settings, spaces: [...settings.spaces, space] }, space }
}

export interface SpacePatch {
  name?: unknown
  icon?: unknown
  color?: unknown
  partitioned?: unknown
  proxy?: unknown
}

/** Rename / recolour / re-icon / partition / proxy. Default keeps its partition and proxy. */
export function updateSpace(settings: SpacesSettings, id: string, patch: SpacePatch): SpacesSettings {
  const index = settings.spaces.findIndex((space) => space.id === id)
  if (index < 0) return settings
  const current = settings.spaces[index]!
  const isDefault = id === DEFAULT_SPACE_ID
  const next: SpaceDefinition = { ...current }
  if (patch.name !== undefined) next.name = normalizeSpaceName(patch.name, current.name)
  if (patch.icon !== undefined) next.icon = normalizeSpaceIcon(patch.icon)
  if (patch.color !== undefined && isSpaceColor(patch.color)) next.color = patch.color
  if (patch.partitioned !== undefined && !isDefault) next.partitioned = patch.partitioned === true
  if (patch.proxy !== undefined && !isDefault) {
    if (patch.proxy !== 'inherit' && !isProxyRoute(patch.proxy)) throw new Error('Choose Settings, Direct or a proxy.')
    next.proxy = patch.proxy
  }
  // A forced proxy needs the Space's own session (Chromium sets proxies per session).
  if (!next.partitioned) next.proxy = 'inherit'
  const spaces = settings.spaces.slice()
  spaces[index] = next
  return { ...settings, spaces }
}

/** Move a Space to `toIndex` (clamped). */
export function moveSpace(settings: SpacesSettings, id: string, toIndex: number): SpacesSettings {
  const from = settings.spaces.findIndex((space) => space.id === id)
  if (from < 0 || !Number.isInteger(toIndex)) return settings
  const spaces = settings.spaces.slice()
  const [space] = spaces.splice(from, 1)
  const at = Math.max(0, Math.min(spaces.length, toIndex))
  spaces.splice(at, 0, space!)
  return { ...settings, spaces }
}

/** Remove a Space (never Default). The caller closes its tabs first. */
export function removeSpace(settings: SpacesSettings, id: string): SpacesSettings {
  if (id === DEFAULT_SPACE_ID) return settings
  return { ...settings, spaces: settings.spaces.filter((space) => space.id !== id) }
}

/** The Space `offset` steps from `currentId` in switcher order, without wrapping (swipe / next/previous). */
export function adjacentSpaceId(settings: SpacesSettings, currentId: string, offset: number): string | null {
  const index = settings.spaces.findIndex((space) => space.id === currentId)
  if (index < 0) return settings.spaces[0]?.id ?? null
  const next = settings.spaces[index + offset]
  return next ? next.id : null
}

/** Ctrl+1..9: the Space at that position (1-based), or null. */
export function spaceIdAtNumber(settings: SpacesSettings, number: number): string | null {
  if (!Number.isInteger(number) || number < 1) return null
  return settings.spaces[number - 1]?.id ?? null
}

// ---------------------------------------------------------------------------
// Proxy precedence

/**
 * The routing a Space's session uses, layered on Settings (main proxy + #76 per-site rules).
 * Precedence, highest first:
 *   1. local addresses (localhost, 127.x, ::1, dotless names) always go direct;
 *   2. a per-site rule that routes through a proxy keeps its proxy;
 *   3. a per-site Direct rule stays direct, EXCEPT in a Space forced through a proxy, where it
 *      goes through the Space's proxy (a proxied Space never leaks a site direct);
 *   4. the Space's forced route ('direct', 'proxy' or 'proxy:<name>');
 *   5. Settings' main proxy on/off (only when the Space inherits).
 * A forced 'proxy:<name>' whose proxy was removed fails closed onto the main proxy, never direct.
 * The output is a plain ProxyRoutingInput, so the PAC builder, self-check, effective-route lookup
 * and the kill switch's endpoint list all work on it unchanged.
 */
export function spaceRoutingInput(input: ProxyRoutingInput, choice: SpaceProxyChoice): ProxyRoutingInput {
  const copy = (): ProxyRoutingInput => ({ primary: { ...input.primary }, proxies: input.proxies.map((proxy) => ({ ...proxy })), rules: input.rules.map((rule) => ({ ...rule })) })
  if (choice === 'inherit') return copy()
  const base = copy()
  if (choice === 'direct') return { ...base, primary: { ...base.primary, enabled: false } }
  let host = input.primary.host
  let port = input.primary.port
  if (choice.startsWith('proxy:')) {
    const name = choice.slice('proxy:'.length).toLowerCase()
    const named = input.proxies.find((proxy) => proxy.name.toLowerCase() === name)
    if (named) {
      host = named.host
      port = named.port
    }
  }
  const movesPrimary = host !== input.primary.host || port !== input.primary.port
  // Rules that said "main proxy" must keep the main proxy even though the Space's primary moved:
  // point them at a synthetic named entry (a name users can't type, see PROXY_NAME_PATTERN).
  const proxies = movesPrimary ? [...base.proxies, { name: SPACE_MAIN_PROXY_NAME, host: input.primary.host, port: input.primary.port }] : base.proxies
  return {
    primary: { ...base.primary, enabled: true, host, port },
    proxies,
    rules: base.rules.map((rule) => {
      // Direct rules can't punch through a proxied Space: they take the Space's route ('proxy' = the Space's primary now).
      if (rule.route === 'direct') return { ...rule, route: 'proxy' as ProxyRoute }
      if (rule.route === 'proxy' && movesPrimary) return { ...rule, route: `proxy:${SPACE_MAIN_PROXY_NAME}` as ProxyRoute }
      return rule
    })
  }
}

/** Synthetic proxy name for "the main proxy" inside a Space whose primary is another proxy. */
export const SPACE_MAIN_PROXY_NAME = '~main'

/** Human label for a Space proxy choice (menus). */
export function spaceProxyLabel(choice: SpaceProxyChoice): string {
  if (choice === 'inherit') return 'Same as Settings'
  if (choice === 'direct') return 'Direct (no proxy)'
  if (choice === 'proxy') return 'Main proxy'
  return `Proxy ${choice.slice('proxy:'.length)}`
}

// ---------------------------------------------------------------------------
// Session file

/** Per window in browser-session.json; absent when every tab is in Default (older files read the same). */
export interface SavedWindowSpaces {
  /** Space id per saved tab (same order as `tabs`). */
  tabSpaces: string[]
  /** The Space the window was showing. */
  activeSpace: string
  /** Last active tab index per Space, so switching back lands where you were. */
  spaceActiveTabs?: Record<string, number>
}

/** Validate untrusted per-window spaces data against `tabCount` tabs. Null = everything in Default. */
export function parseSavedWindowSpaces(value: unknown, tabCount: number): SavedWindowSpaces | null {
  if (!isRecord(value) || !Array.isArray(value.tabSpaces)) return null
  const tabSpaces = Array.from({ length: tabCount }, (_unused, index) => {
    const id = (value.tabSpaces as unknown[])[index]
    return isSpaceId(id) ? id : DEFAULT_SPACE_ID
  })
  const activeSpace = isSpaceId(value.activeSpace) ? value.activeSpace : DEFAULT_SPACE_ID
  const spaceActiveTabs: Record<string, number> = {}
  if (isRecord(value.spaceActiveTabs)) {
    for (const [id, index] of Object.entries(value.spaceActiveTabs)) {
      if (isSpaceId(id) && typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < tabCount && tabSpaces[index] === id) spaceActiveTabs[id] = index
    }
  }
  if (tabSpaces.every((id) => id === DEFAULT_SPACE_ID) && activeSpace === DEFAULT_SPACE_ID) return null
  return { tabSpaces, activeSpace, ...(Object.keys(spaceActiveTabs).length > 0 ? { spaceActiveTabs } : {}) }
}

/** Re-point saved spaces data at the tabs that survived normalisation (`newIndex` -1 = dropped). */
export function remapSavedWindowSpaces(spaces: SavedWindowSpaces | null, newIndex: (index: number) => number, keptCount: number): SavedWindowSpaces | null {
  if (!spaces) return null
  const tabSpaces: string[] = Array.from({ length: keptCount }, () => DEFAULT_SPACE_ID)
  spaces.tabSpaces.forEach((id, index) => {
    const at = newIndex(index)
    if (at >= 0 && at < keptCount) tabSpaces[at] = id
  })
  const spaceActiveTabs: Record<string, number> = {}
  for (const [id, index] of Object.entries(spaces.spaceActiveTabs ?? {})) {
    const at = newIndex(index)
    if (at >= 0 && tabSpaces[at] === id) spaceActiveTabs[id] = at
  }
  return parseSavedWindowSpaces({ tabSpaces, activeSpace: spaces.activeSpace, spaceActiveTabs }, keptCount)
}

/**
 * Restore-time placement against the current definitions: unknown Spaces (deleted, or Spaces off)
 * fold into Default. Returns the space id per tab and the window's active Space.
 */
export function placeRestoredTabs(settings: SpacesSettings, saved: SavedWindowSpaces | null | undefined, tabCount: number): { tabSpaces: string[]; activeSpace: string } {
  const tabSpaces = Array.from({ length: tabCount }, (_unused, index) => resolveSpaceId(settings, saved?.tabSpaces[index]))
  return { tabSpaces, activeSpace: resolveSpaceId(settings, saved?.activeSpace) }
}
