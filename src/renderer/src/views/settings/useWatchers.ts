import { useEffect, useState } from 'react'

export type Snapshot = Awaited<ReturnType<typeof window.api.browser.watchers.list>>

export function useWatchers(enabled = true): Snapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void window.api.browser.watchers.list().then((next) => { if (live) setSnapshot(next) }).catch(() => undefined)
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
