import { useEffect, useState } from 'react'
import { isWatchersDisabledResult } from '../../../../shared/page-watchers-feature'

type ListResult = Awaited<ReturnType<typeof window.api.browser.watchers.list>>
export type Snapshot = Exclude<ListResult, { ok: false }>

const EMPTY: Snapshot = { watchers: [], running: [] }

export function useWatchers(enabled = true): Snapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void window.api.browser.watchers.list().then((next) => { if (live) setSnapshot(isWatchersDisabledResult(next) ? EMPTY : next) }).catch(() => undefined)
    const off = window.api.browser.watchers.onChange((next) => setSnapshot(next))
    return () => {
      live = false
      off()
    }
  }, [enabled])
  return snapshot
}

/** Changes the user hasn't opened yet, for the Settings → Watchers badge. */
export function useUnseenWatcherCount(enabled = true): number {
  const snapshot = useWatchers(enabled)
  return snapshot?.watchers.filter((watcher) => watcher.unseen).length ?? 0
}

/** Settings → General → "Enable page watchers"; null until main answers. */
export function usePageWatchersEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void window.api.browser.watchers.getEnabled().then((settings) => { if (live) setEnabled(settings.enabled) }).catch(() => { if (live) setEnabled(true) })
    const off = window.api.browser.watchers.onEnabledChange((next) => setEnabled(next))
    return () => {
      live = false
      off()
    }
  }, [])
  return enabled
}
