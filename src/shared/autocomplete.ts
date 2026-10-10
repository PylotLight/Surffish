import type { BrowserTabSummary, BrowsingHistoryEntry, PinnedSite } from './types'

export type AddressSuggestionSource = 'Pinned site' | 'Open tab' | 'History'

export interface AddressSuggestion {
  title: string
  url: string
  source: AddressSuggestionSource
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '')
  } catch {
    return value
  }
}

/** Suggestions are resolved from local browser data only; no keystrokes leave the device. */
export function buildAddressSuggestions(
  input: string,
  pinnedSites: readonly PinnedSite[],
  tabs: readonly BrowserTabSummary[],
  history: readonly BrowsingHistoryEntry[],
  limit = 7
): AddressSuggestion[] {
  const query = input.trim().toLocaleLowerCase()
  if (!query || limit < 1) return []

  const candidates: AddressSuggestion[] = [
    ...pinnedSites.map((site) => ({ title: site.title, url: site.url, source: 'Pinned site' as const })),
    ...tabs.map((tab) => ({ title: tab.title, url: tab.url, source: 'Open tab' as const })),
    ...history.map((entry) => ({ title: entry.title, url: entry.url, source: 'History' as const }))
  ]
  const seen = new Set<string>()
  const matches: AddressSuggestion[] = []

  for (const candidate of candidates) {
    const url = normalizedUrl(candidate.url)
    if (!url || seen.has(url)) continue
    const haystack = `${candidate.title} ${candidate.url} ${hostLabel(candidate.url)}`.toLocaleLowerCase()
    if (!haystack.includes(query)) continue
    matches.push({ ...candidate, url })
    seen.add(url)
    if (matches.length >= limit) break
  }
  return matches
}
