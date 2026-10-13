/** addons.mozilla.org API v5: search add-ons that are compatible with Firefox for Android. */
export interface AmoAddon {
  id: number
  guid: string
  slug: string
  name: string
  summary: string
  icon: string | null
  users: number
  rating: number
  xpi: string | null
  url: string
  recommended: boolean
}

function pick(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const map = value as Record<string, string>
    return map['en-US'] ?? map[Object.keys(map)[0] ?? ''] ?? ''
  }
  return ''
}

interface AmoResult {
  id: number
  guid: string
  slug: string
  name: unknown
  summary: unknown
  icon_url?: string
  average_daily_users?: number
  ratings?: { average?: number }
  current_version?: { file?: { url?: string } }
  url: string
  promoted?: { category?: string } | { category?: string }[] | null
}

export async function searchAmo(query: string, page = 1): Promise<{ results: AmoAddon[]; next: boolean }> {
  const params = new URLSearchParams({
    app: 'android',
    type: 'extension',
    page: String(page),
    page_size: '25',
    lang: 'en-US',
    sort: query.trim() ? 'relevance' : 'users'
  })
  if (query.trim()) params.set('q', query.trim())
  else params.set('promoted', 'recommended')
  const res = await fetch(`https://addons.mozilla.org/api/v5/addons/search/?${params.toString()}`)
  if (!res.ok) throw new Error(`AMO ${res.status}`)
  const data = (await res.json()) as { results: AmoResult[]; next: string | null }
  return {
    next: !!data.next,
    results: data.results.map((r) => {
      const promoted = Array.isArray(r.promoted) ? r.promoted : r.promoted ? [r.promoted] : []
      return {
        id: r.id,
        guid: r.guid,
        slug: r.slug,
        name: pick(r.name),
        summary: pick(r.summary),
        icon: r.icon_url ?? null,
        users: r.average_daily_users ?? 0,
        rating: r.ratings?.average ?? 0,
        xpi: r.current_version?.file?.url ?? null,
        url: r.url,
        recommended: promoted.some((p) => p?.category === 'recommended' || p?.category === 'line')
      }
    })
  }
}
