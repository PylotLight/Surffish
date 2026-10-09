const SEARCH_URL = 'https://duckduckgo.com/'

function isIpv4(host: string): boolean {
  const parts = host.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isLoopback(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1' || normalized.startsWith('127.')
}

function searchFor(query: string): string {
  const url = new URL(SEARCH_URL)
  url.searchParams.set('q', query)
  return url.toString()
}

/** Resolve address-bar input without ever allowing a non-HTTP(S) navigation. */
export function resolveNavigationTarget(input: string): string | null {
  const value = input.trim()
  if (!value) return null

  const explicitWebScheme = /^https?:/i.test(value)
  const explicitOtherScheme = /^(?:[a-z][a-z\d+.-]*):\/\//i.test(value) || /^(?:javascript|data|file|ftp|mailto|about|chrome|view-source):/i.test(value)
  if (explicitWebScheme || explicitOtherScheme) {
    try {
      const url = new URL(value)
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null
      return url.toString()
    } catch {
      return null
    }
  }

  // Whitespace is a strong signal that the user entered a search query.
  if (/\s/.test(value)) return searchFor(value)

  try {
    const url = new URL(`https://${value}`)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const looksLikeAddress = host === 'localhost' || host.endsWith('.localhost') || host.includes('.') || isIpv4(host) || host === '::1'
    if (!looksLikeAddress) return searchFor(value)
    if (isLoopback(url.hostname)) url.protocol = 'http:'
    return url.toString()
  } catch {
    return searchFor(value)
  }
}
