import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  downloadsAttention, fitToolbarItems, parseToolbarLayout, sameToolbarSet, toolbarItemsBudget, TOOLBAR_LAYOUT_STORAGE_KEY,
  type DownloadsAttention, type ToolbarItemId, type ToolbarLayout
} from '../../../../shared/toolbar-layout'
import type { DownloadEntry } from '../../../../shared/downloads'
import { useStoredState } from '../../lib/stored-state'

/** The pin / order layout (localStorage, synced across surfaces by the `storage` event). */
export function useToolbarLayout(): [ToolbarLayout, (next: ToolbarLayout) => void] {
  const [raw, setRaw] = useStoredState<unknown>(TOOLBAR_LAYOUT_STORAGE_KEY, null)
  const layout = useMemo(() => parseToolbarLayout(raw), [raw])
  const write = useCallback((next: ToolbarLayout) => { if (next !== layout) setRaw(next) }, [layout, setRaw])
  return [layout, write]
}

/** Set when the Downloads popup opens: finished downloads before it stop keeping the button out. */
export const DOWNLOADS_SEEN_STORAGE_KEY = 'surffish.toolbar.downloadsSeenAt'

/** Counts that arrived before this renderer mounted are fetched once the window has settled. */
const DOWNLOADS_DELAY_MS = 1_500

/**
 * Should the contextual Downloads button show (shared/toolbar-layout.ts)? Listens to the downloads
 * broadcast main already sends every window renderer; state only changes when active/recent flip,
 * so download progress never re-renders the toolbar.
 */
export function useDownloadsAttention(seenAt: number): { active: boolean; recent: boolean } {
  const [entries, setEntries] = useState<readonly DownloadEntry[] | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [flags, setFlags] = useState({ active: false, recent: false })
  useEffect(() => window.api.browser.downloads.onChange((next) => setEntries(next)), [])
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.browser.downloads.get().then((list) => { if (!cancelled && Array.isArray(list)) setEntries((current) => current ?? list) }).catch(() => undefined)
    }, DOWNLOADS_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])
  const attention: DownloadsAttention = useMemo(() => downloadsAttention(entries ?? [], seenAt, Math.max(now, Date.now())), [entries, seenAt, now])
  useEffect(() => {
    setFlags((current) => current.active === attention.active && current.recent === attention.recent ? current : { active: attention.active, recent: attention.recent })
    if (attention.recentUntil === null) return
    // Hide on time when the hour is up.
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1_000, attention.recentUntil - Date.now() + 50))
    return () => clearTimeout(timer)
  }, [attention.active, attention.recent, attention.recentUntil])
  return flags
}

/** Combined progress (0..1) of running downloads, for the Downloads button's ring; null when unknown. */
export function useDownloadsProgress(enabled: boolean): number | null {
  const [progress, setProgress] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) {
      setProgress(null)
      return
    }
    const update = (list: readonly DownloadEntry[]): void => {
      const next = downloadsAttention(list, Number.MAX_SAFE_INTEGER, Date.now()).progress
      // 1% steps: enough for a 14px ring, and it caps re-renders of this button.
      setProgress(next === null ? null : Math.round(next * 100) / 100)
    }
    let cancelled = false
    void window.api.browser.downloads.get().then((list) => { if (!cancelled && Array.isArray(list)) update(list) }).catch(() => undefined)
    const off = window.api.browser.downloads.onChange(update)
    return () => { cancelled = true; off() }
  }, [enabled])
  return progress
}

const NO_FOLDS: ReadonlySet<ToolbarItemId> = new Set()
/** Width assumed for a button never measured (the icon hit box). */
const DEFAULT_ITEM_WIDTH = 30

/**
 * Narrow window: which wanted buttons fold into the Surffish menu (shared/toolbar-layout.ts
 * `fitToolbarItems`). One ResizeObserver on the toolbar and the button row; it reads widths in its
 * callback (layout is already clean there) and sets state only when the folded set changes. The
 * budget doesn't depend on what's folded, so folding can't feed back into another fold (no jitter).
 */
export function useToolbarOverflow(toolbarRef: React.RefObject<HTMLElement | null>, itemsRef: React.RefObject<HTMLElement | null>, wanted: readonly ToolbarItemId[], active: boolean): ReadonlySet<ToolbarItemId> {
  const [folded, setFolded] = useState<ReadonlySet<ToolbarItemId>>(NO_FOLDS)
  const foldedRef = useRef(folded)
  const widths = useRef(new Map<ToolbarItemId, number>())
  const wantedKey = wanted.join(',')
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const items = itemsRef.current
    const trailing = items?.parentElement
    const ids = wantedKey ? wantedKey.split(',') as ToolbarItemId[] : []
    const apply = (next: ReadonlySet<ToolbarItemId>): void => {
      if (sameToolbarSet(next, foldedRef.current)) return
      foldedRef.current = next
      setFolded(next)
    }
    if (!active || !toolbar || !items || !trailing) {
      apply(NO_FOLDS)
      return
    }
    const omnibox = toolbar.querySelector<HTMLElement>('.omnibox-wrap')
    const leading = toolbar.querySelector<HTMLElement>('.browser-toolbar-leading')
    const measure = (): void => {
      for (const slot of items.querySelectorAll<HTMLElement>('.toolbar-slot[data-toolbar-item]')) {
        if (slot.classList.contains('is-folded')) continue
        const width = slot.offsetWidth
        if (width > 0) widths.current.set(slot.dataset.toolbarItem as ToolbarItemId, width)
      }
      const style = getComputedStyle(toolbar)
      const gap = parseFloat(style.columnGap) || 0
      const leadingWidth = leading && leading.offsetWidth > 0 ? leading.offsetWidth + gap : 0
      const budget = toolbarItemsBudget({
        toolbarWidth: toolbar.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0),
        leadingWidth,
        fixedWidth: trailing.offsetWidth - items.offsetWidth,
        centered: omnibox ? getComputedStyle(omnibox).position === 'absolute' : false,
        gap
      })
      const itemGap = parseFloat(getComputedStyle(items).columnGap) || 0
      apply(fitToolbarItems(ids.map((id) => ({ id, width: widths.current.get(id) ?? DEFAULT_ITEM_WIDTH })), budget, itemGap, foldedRef.current))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    observer.observe(items)
    measure()
    return () => observer.disconnect()
  }, [active, wantedKey])
  return folded
}
