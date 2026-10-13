import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../../shared/update-feed'

/** Live update-check state from the main process (the renderer never fetches the feed itself). */
export function useUpdateState(): [UpdateState | null, (state: UpdateState) => void] {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.api.browser.updates.onChange(setState)
    void window.api.browser.updates.get().then((next) => { if (!cancelled) setState(next) }).catch(() => undefined)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return [state, setState]
}
