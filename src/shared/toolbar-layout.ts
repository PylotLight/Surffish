/**
 * The toolbar's right-hand buttons (Chrome-style pin / unpin / overflow, Oct 2026).
 *
 * Every button has a placement: `pinned` (always on the toolbar), `menu` (only in the Surffish
 * menu) or, for the contextual ones (Cast, Downloads), `auto`: on the toolbar while it matters (a
 * page played media / a cast is live; a download is running or finished recently), else in the
 * menu. The order is one list of every id, so a button keeps its slot when it is unpinned and
 * pinned again. A window too narrow for the pinned buttons folds them into the menu, lowest
 * priority first (`fitToolbarItems`).
 *
 * The layout lives in the renderer's localStorage (`TOOLBAR_LAYOUT_STORAGE_KEY`), shared by the
 * toolbar, sidebar and content surfaces through the `storage` event, so a change made in Settings
 * reaches the toolbar view without any IPC. Extension icons keep their own pins
 * (`surffish.toolbar.extensionPins`); here they ride along as the `extensions` group.
 */

export const TOOLBAR_ITEM_IDS = ['bookmarks', 'reading-list', 'adblock', 'cast', 'history', 'extensions', 'downloads'] as const
export type ToolbarItemId = typeof TOOLBAR_ITEM_IDS[number]
export type ToolbarPlacement = 'pinned' | 'auto' | 'menu'

export const TOOLBAR_LAYOUT_STORAGE_KEY = 'surffish.toolbar.layout'
const LAYOUT_VERSION = 1

export interface ToolbarItemInfo {
  id: ToolbarItemId
  label: string
  /** Has an `auto` placement (shown while it matters). */
  contextual: boolean
  /** Higher stays on a narrow toolbar longer. */
  priority: number
  defaultPlacement: ToolbarPlacement
}

export const TOOLBAR_ITEMS: Readonly<Record<ToolbarItemId, ToolbarItemInfo>> = {
  bookmarks: { id: 'bookmarks', label: 'Bookmarks', contextual: false, priority: 60, defaultPlacement: 'pinned' },
  'reading-list': { id: 'reading-list', label: 'Reading List', contextual: false, priority: 40, defaultPlacement: 'menu' },
  adblock: { id: 'adblock', label: 'Ad blocker', contextual: false, priority: 70, defaultPlacement: 'pinned' },
  cast: { id: 'cast', label: 'Cast', contextual: true, priority: 85, defaultPlacement: 'auto' },
  history: { id: 'history', label: 'History', contextual: false, priority: 30, defaultPlacement: 'menu' },
  extensions: { id: 'extensions', label: 'Extensions', contextual: false, priority: 50, defaultPlacement: 'pinned' },
  downloads: { id: 'downloads', label: 'Downloads', contextual: true, priority: 90, defaultPlacement: 'auto' }
}

export interface ToolbarLayout {
  version: typeof LAYOUT_VERSION
  /** Every id once, left to right. */
  order: ToolbarItemId[]
  placement: Record<ToolbarItemId, ToolbarPlacement>
}

export function isToolbarItemId(value: unknown): value is ToolbarItemId {
  return typeof value === 'string' && (TOOLBAR_ITEM_IDS as readonly string[]).includes(value)
}

function defaultPlacements(): Record<ToolbarItemId, ToolbarPlacement> {
  return Object.fromEntries(TOOLBAR_ITEM_IDS.map((id) => [id, TOOLBAR_ITEMS[id].defaultPlacement])) as Record<ToolbarItemId, ToolbarPlacement>
}

export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = Object.freeze({
  version: LAYOUT_VERSION,
  order: [...TOOLBAR_ITEM_IDS],
  placement: defaultPlacements()
}) as ToolbarLayout

/** `auto` only means something for contextual buttons; anything else falls back to `pinned`/`menu`. */
function validPlacement(id: ToolbarItemId, value: unknown): ToolbarPlacement | null {
  if (value === 'pinned' || value === 'menu') return value
  if (value === 'auto') return TOOLBAR_ITEMS[id].contextual ? 'auto' : 'pinned'
  return null
}

/**
 * Read a stored layout. Nothing stored (every user before this change), an unknown version or
 * junk gives the defaults; a partial one keeps what it says and fills the rest in. Ids added in a
 * later release land at their default position (after the id that precedes them by default).
 */
export function parseToolbarLayout(value: unknown): ToolbarLayout {
  if (!value || typeof value !== 'object') return cloneLayout(DEFAULT_TOOLBAR_LAYOUT)
  const raw = value as { version?: unknown; order?: unknown; placement?: unknown }
  if (raw.version !== undefined && raw.version !== LAYOUT_VERSION) return cloneLayout(DEFAULT_TOOLBAR_LAYOUT)
  const order: ToolbarItemId[] = []
  if (Array.isArray(raw.order)) for (const id of raw.order) if (isToolbarItemId(id) && !order.includes(id)) order.push(id)
  TOOLBAR_ITEM_IDS.forEach((id, index) => {
    if (order.includes(id)) return
    const before = TOOLBAR_ITEM_IDS.slice(0, index).reverse().find((other) => order.includes(other))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id)
  })
  const placement = defaultPlacements()
  if (raw.placement && typeof raw.placement === 'object') {
    for (const id of TOOLBAR_ITEM_IDS) {
      const next = validPlacement(id, (raw.placement as Record<string, unknown>)[id])
      if (next) placement[id] = next
    }
  }
  return { version: LAYOUT_VERSION, order, placement }
}

function cloneLayout(layout: ToolbarLayout): ToolbarLayout {
  return { version: LAYOUT_VERSION, order: [...layout.order], placement: { ...layout.placement } }
}

export function isDefaultToolbarLayout(layout: ToolbarLayout): boolean {
  return layout.order.every((id, index) => id === DEFAULT_TOOLBAR_LAYOUT.order[index])
    && TOOLBAR_ITEM_IDS.every((id) => layout.placement[id] === DEFAULT_TOOLBAR_LAYOUT.placement[id])
}

export function setToolbarPlacement(layout: ToolbarLayout, id: ToolbarItemId, placement: ToolbarPlacement): ToolbarLayout {
  const next = validPlacement(id, placement) ?? layout.placement[id]
  if (layout.placement[id] === next) return layout
  return { ...cloneLayout(layout), placement: { ...layout.placement, [id]: next } }
}

/** Right-click → Pin / Unpin. Unpinning a contextual button puts it back to "while it matters". */
export function togglePinned(layout: ToolbarLayout, id: ToolbarItemId): ToolbarLayout {
  if (layout.placement[id] !== 'pinned') return setToolbarPlacement(layout, id, 'pinned')
  return setToolbarPlacement(layout, id, TOOLBAR_ITEMS[id].contextual ? 'auto' : 'menu')
}

/** Drag a button onto another: it lands before (`after: false`) or after `targetId`. */
export function moveToolbarItem(layout: ToolbarLayout, id: ToolbarItemId, targetId: ToolbarItemId, after: boolean): ToolbarLayout {
  if (id === targetId) return layout
  const order = layout.order.filter((other) => other !== id)
  const targetIndex = order.indexOf(targetId)
  if (targetIndex < 0) return layout
  order.splice(after ? targetIndex + 1 : targetIndex, 0, id)
  if (order.every((other, index) => other === layout.order[index])) return layout
  return { ...cloneLayout(layout), order }
}

/** Settings' up / down buttons: one step left (-1) or right (+1) in the full order. */
export function shiftToolbarItem(layout: ToolbarLayout, id: ToolbarItemId, delta: -1 | 1): ToolbarLayout {
  const index = layout.order.indexOf(id)
  const target = layout.order[index + delta]
  if (index < 0 || !target) return layout
  return moveToolbarItem(layout, id, target, delta > 0)
}

export interface ToolbarContext {
  /** Cast is turned on in Settings (off: no button and no menu entry). */
  castEnabled: boolean
  /** A cast or a mirror is running. */
  castLive: boolean
  /** Chromecasts known on the network. */
  castDevices: number
  /** The active tab's page has played video or audio since it loaded. */
  tabHasMedia: boolean
  /** A download is running or paused. */
  downloadsActive: boolean
  /** A download finished in the last hour and the Downloads popup hasn't been opened since. */
  downloadsRecent: boolean
}

/** Can this button be used at all right now (on the toolbar or in the menu)? */
export function toolbarItemAvailable(id: ToolbarItemId, context: ToolbarContext): boolean {
  return id === 'cast' ? context.castEnabled : true
}

/** Does the button want a toolbar slot (before the narrow-window fitting)? */
export function toolbarItemWanted(layout: ToolbarLayout, id: ToolbarItemId, context: ToolbarContext): boolean {
  if (!toolbarItemAvailable(id, context)) return false
  const placement = layout.placement[id]
  if (placement === 'pinned') return true
  if (placement === 'menu') return false
  if (id === 'cast') return context.castLive || (context.castDevices > 0 && context.tabHasMedia)
  if (id === 'downloads') return context.downloadsActive || context.downloadsRecent
  return false
}

/** Ids that want a toolbar slot, left to right. */
export function wantedToolbarItems(layout: ToolbarLayout, context: ToolbarContext): ToolbarItemId[] {
  return layout.order.filter((id) => toolbarItemWanted(layout, id, context))
}

export interface ToolbarFitItem {
  id: ToolbarItemId
  /** Measured width in px (a cached one while folded). */
  width: number
}

/** Extra room a folded button needs before it comes back, so a window edge on the line doesn't flicker. */
export const TOOLBAR_UNFOLD_HYSTERESIS = 8

/**
 * Which wanted buttons fold into the menu: keep the highest-priority ones while their widths (plus
 * a gap each) fit `budget`; the first that doesn't fit and everything below it fold. `budget` is
 * the room the buttons may use whatever is folded (the address bar takes up the slack), so folding
 * one never changes it and the result can't oscillate. A button folded last time needs
 * `hysteresis` px to spare before it returns.
 */
export function fitToolbarItems(items: readonly ToolbarFitItem[], budget: number, gap: number, previouslyFolded: ReadonlySet<ToolbarItemId> = new Set(), hysteresis = TOOLBAR_UNFOLD_HYSTERESIS): Set<ToolbarItemId> {
  const byPriority = [...items].sort((a, b) => TOOLBAR_ITEMS[b.id].priority - TOOLBAR_ITEMS[a.id].priority)
  const folded = new Set<ToolbarItemId>()
  let used = 0
  let overflowing = false
  for (const item of byPriority) {
    const width = Math.max(0, item.width) + gap
    const need = used + width + (previouslyFolded.has(item.id) ? hysteresis : 0)
    if (overflowing || need > budget) {
      overflowing = true
      folded.add(item.id)
      continue
    }
    used += width
  }
  return folded
}

/** The address bar keeps at least this much (nav buttons + field) before buttons fold. */
export const OMNIBOX_MIN_CENTERED = 400
export const OMNIBOX_MIN_INLINE = 420

export interface ToolbarBudgetInput {
  /** Toolbar content width (padding excluded). */
  toolbarWidth: number
  /** Left-hand toolbar bits beside the address bar (traffic-light spacer…), with their gap. */
  leadingWidth: number
  /** Right-hand bits that never fold (the Surffish menu button, "Add to Surffish", badges), with gaps. */
  fixedWidth: number
  /** Wide windows center the address bar (Browser.css), so the right side gets half of what's left. */
  centered: boolean
  /** Gap between the address bar and the right-hand group. */
  gap: number
}

/** Room for the foldable buttons. Never negative. */
export function toolbarItemsBudget({ toolbarWidth, leadingWidth, fixedWidth, centered, gap }: ToolbarBudgetInput): number {
  const side = centered
    ? (toolbarWidth - OMNIBOX_MIN_CENTERED - 40) / 2
    : toolbarWidth - leadingWidth - OMNIBOX_MIN_INLINE - gap
  return Math.max(0, Math.floor(side - fixedWidth))
}

/** Same set? (cheap check before a state update) */
export function sameToolbarSet(a: ReadonlySet<ToolbarItemId>, b: ReadonlySet<ToolbarItemId>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/** A finished download keeps the Downloads button out for this long (or until the popup is opened). */
export const DOWNLOADS_RECENT_MS = 60 * 60 * 1000

export interface DownloadLike {
  state: string
  startedAt: number
  completedAt: number | null
  receivedBytes: number
  totalBytes: number
}

export interface DownloadsAttention {
  active: boolean
  recent: boolean
  /** Combined progress 0..1 of running downloads with a known size, or null. */
  progress: number | null
  /** When `recent` runs out (epoch ms), so the button can hide on time; null when not recent. */
  recentUntil: number | null
}

/** Is a download worth a toolbar button right now? `seenAt`: when the Downloads popup was last opened. */
export function downloadsAttention(entries: readonly DownloadLike[], seenAt: number, now: number): DownloadsAttention {
  let active = false
  let received = 0
  let total = 0
  let latestFinish = 0
  for (const entry of entries) {
    if (entry.state === 'progressing' || entry.state === 'paused') {
      active = true
      if (entry.totalBytes > 0) {
        received += Math.min(entry.receivedBytes, entry.totalBytes)
        total += entry.totalBytes
      }
      continue
    }
    if (entry.state === 'cancelled') continue
    const finishedAt = entry.completedAt ?? entry.startedAt
    if (finishedAt > latestFinish) latestFinish = finishedAt
  }
  const recent = latestFinish > seenAt && now - latestFinish < DOWNLOADS_RECENT_MS
  return { active, recent, progress: total > 0 ? received / total : null, recentUntil: recent ? latestFinish + DOWNLOADS_RECENT_MS : null }
}
