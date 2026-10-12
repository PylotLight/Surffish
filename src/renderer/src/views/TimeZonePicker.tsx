import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { searchTimeZones, WORLD_CITIES, type TimeZoneSearchResult } from '../../../shared/world-cities'

const IANA_ZONES: readonly string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []

function displayFor(timeZone: string, label?: string): string {
  const city = WORLD_CITIES.find((entry) => entry.timeZone === timeZone && entry.city === label)
  if (city) return `${city.city}, ${city.region}`
  return timeZone.replaceAll('_', ' ')
}

type Props = {
  value: string
  /** The clock's current label, used to show "Tampa, Florida" rather than "America/New York". */
  label?: string
  ariaLabel: string
  onSelect: (result: TimeZoneSearchResult) => void
}

/** Type-to-search city / time zone combobox. Finds Tampa, Seattle, etc. that IANA doesn't list. */
export default function TimeZonePicker({ value, label, ariaLabel, onSelect }: Props): React.JSX.Element {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [listBox, setListBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const results = useMemo(() => searchTimeZones(query, IANA_ZONES), [query])

  useEffect(() => { setHighlight(0) }, [query])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  // Position the list as a fixed layer so it never gets clipped or split by the settings columns.
  useEffect(() => {
    if (!open) { setListBox(null); return }
    const place = (): void => {
      const rect = inputRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const maxHeight = Math.max(160, Math.min(300, Math.max(below, above)))
      const top = below >= Math.min(300, maxHeight) || below >= above ? rect.bottom + 6 : rect.top - 6 - maxHeight
      setListBox({ top, left: rect.left, width: rect.width, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    rootRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  function choose(result: TimeZoneSearchResult | undefined): void {
    if (!result) return
    onSelect(result)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setHighlight((i) => Math.min(results.length - 1, i + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((i) => Math.max(0, i - 1)) }
    else if (event.key === 'Enter') { event.preventDefault(); if (open) choose(results[highlight]) }
    else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery('') }
  }

  return (
    <div className={`tz-picker${open ? ' is-open' : ''}`} ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[highlight] ? `${listId}-${highlight}` : undefined}
        spellCheck={false}
        autoComplete="off"
        placeholder={open ? 'Search a city or time zone…' : displayFor(value, label)}
        value={open ? query : displayFor(value, label)}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={(event) => { setOpen(true); setQuery(event.target.value) }}
        onKeyDown={onKeyDown}
      />
      <span className="tz-picker-caret" aria-hidden="true">⌄</span>
      {open && (
        <ul className="tz-picker-list" id={listId} role="listbox" style={listBox ? { top: listBox.top, left: listBox.left, width: listBox.width, maxHeight: listBox.maxHeight } : { visibility: 'hidden' }}>
          {results.map((result, index) => (
            <li
              key={result.key}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === highlight}
              className={`${index === highlight ? 'is-highlighted' : ''}${result.timeZone === value ? ' is-current' : ''}`}
              onPointerDown={(event) => { event.preventDefault(); choose(result) }}
              onPointerEnter={() => setHighlight(index)}
            >
              <strong>{result.label}</strong>
              <span>{result.detail}</span>
            </li>
          ))}
          {results.length === 0 && <li className="tz-picker-empty" role="presentation">No matching city or time zone</li>}
        </ul>
      )}
    </div>
  )
}
