import { useEffect, useState } from 'react'
import type { CustomSearchEngine } from '../../../shared/search-keywords'

/** Custom search engines / keywords, kept in sync across the shell renderers. */
export function useSearchKeywords(enabled = true): CustomSearchEngine[] {
  const [engines, setEngines] = useState<CustomSearchEngine[]>([])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const unsubscribe = window.api.browser.searchKeywords.onChange(setEngines)
    void window.api.browser.searchKeywords.get().then((next) => {
      if (!cancelled) setEngines(next)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [enabled])
  return engines
}
