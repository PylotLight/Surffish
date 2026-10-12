import { useCallback, useEffect, useState } from 'react'

/**
 * Small renderer-only preference stored in localStorage and kept in sync across the toolbar,
 * sidebar and content surfaces (same origin) via the `storage` event. Use main-process
 * preferences instead when the main process has to act on the value.
 */
export function useStoredState<T>(key: string, fallback: T): [T, (next: T) => void] {
  const read = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? fallback : JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }, [key])
  const [value, setValue] = useState<T>(read)
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => { if (event.key === key) setValue(read()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key, read])
  const write = useCallback((next: T): void => {
    localStorage.setItem(key, JSON.stringify(next))
    setValue(next)
  }, [key])
  return [value, write]
}
