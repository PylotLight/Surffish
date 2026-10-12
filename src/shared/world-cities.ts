/**
 * Cities people actually search for, mapped to their IANA zone.
 * IANA only names one city per zone (America/New_York, America/Los_Angeles…), so places like
 * Tampa or Seattle never show up in Intl.supportedValuesOf('timeZone'). This list fills that gap.
 */
export type WorldCity = { city: string; region: string; timeZone: string }

const C = (city: string, region: string, timeZone: string): WorldCity => ({ city, region, timeZone })

export const WORLD_CITIES: readonly WorldCity[] = [
  // United States
  C('New York', 'New York, USA', 'America/New_York'),
  C('Boston', 'Massachusetts, USA', 'America/New_York'),
  C('Philadelphia', 'Pennsylvania, USA', 'America/New_York'),
  C('Washington, D.C.', 'USA', 'America/New_York'),
  C('Atlanta', 'Georgia, USA', 'America/New_York'),
  C('Miami', 'Florida, USA', 'America/New_York'),
  C('Tampa', 'Florida, USA', 'America/New_York'),
  C('Orlando', 'Florida, USA', 'America/New_York'),
  C('Jacksonville', 'Florida, USA', 'America/New_York'),
  C('Charlotte', 'North Carolina, USA', 'America/New_York'),
  C('Raleigh', 'North Carolina, USA', 'America/New_York'),
  C('Pittsburgh', 'Pennsylvania, USA', 'America/New_York'),
  C('Baltimore', 'Maryland, USA', 'America/New_York'),
  C('Cleveland', 'Ohio, USA', 'America/New_York'),
  C('Columbus', 'Ohio, USA', 'America/New_York'),
  C('Detroit', 'Michigan, USA', 'America/Detroit'),
  C('Indianapolis', 'Indiana, USA', 'America/Indiana/Indianapolis'),
  C('Louisville', 'Kentucky, USA', 'America/Kentucky/Louisville'),
  C('Nashville', 'Tennessee, USA', 'America/Chicago'),
  C('Chicago', 'Illinois, USA', 'America/Chicago'),
  C('Dallas', 'Texas, USA', 'America/Chicago'),
  C('Houston', 'Texas, USA', 'America/Chicago'),
  C('Austin', 'Texas, USA', 'America/Chicago'),
  C('San Antonio', 'Texas, USA', 'America/Chicago'),
  C('New Orleans', 'Louisiana, USA', 'America/Chicago'),
  C('Minneapolis', 'Minnesota, USA', 'America/Chicago'),
  C('St. Louis', 'Missouri, USA', 'America/Chicago'),
  C('Kansas City', 'Missouri, USA', 'America/Chicago'),
  C('Milwaukee', 'Wisconsin, USA', 'America/Chicago'),
  C('Denver', 'Colorado, USA', 'America/Denver'),
  C('Salt Lake City', 'Utah, USA', 'America/Denver'),
  C('Albuquerque', 'New Mexico, USA', 'America/Denver'),
  C('Boise', 'Idaho, USA', 'America/Boise'),
  C('Phoenix', 'Arizona, USA', 'America/Phoenix'),
  C('Las Vegas', 'Nevada, USA', 'America/Los_Angeles'),
  C('Los Angeles', 'California, USA', 'America/Los_Angeles'),
  C('San Francisco', 'California, USA', 'America/Los_Angeles'),
  C('San Diego', 'California, USA', 'America/Los_Angeles'),
  C('San Jose', 'California, USA', 'America/Los_Angeles'),
  C('Sacramento', 'California, USA', 'America/Los_Angeles'),
  C('Seattle', 'Washington, USA', 'America/Los_Angeles'),
  C('Portland', 'Oregon, USA', 'America/Los_Angeles'),
  C('Anchorage', 'Alaska, USA', 'America/Anchorage'),
  C('Honolulu', 'Hawaii, USA', 'Pacific/Honolulu'),
  // Canada & Latin America
  C('Toronto', 'Ontario, Canada', 'America/Toronto'),
  C('Ottawa', 'Ontario, Canada', 'America/Toronto'),
  C('Montreal', 'Quebec, Canada', 'America/Toronto'),
  C('Halifax', 'Nova Scotia, Canada', 'America/Halifax'),
  C('St. John’s', 'Newfoundland, Canada', 'America/St_Johns'),
  C('Winnipeg', 'Manitoba, Canada', 'America/Winnipeg'),
  C('Calgary', 'Alberta, Canada', 'America/Edmonton'),
  C('Edmonton', 'Alberta, Canada', 'America/Edmonton'),
  C('Vancouver', 'British Columbia, Canada', 'America/Vancouver'),
  C('Mexico City', 'Mexico', 'America/Mexico_City'),
  C('Cancún', 'Mexico', 'America/Cancun'),
  C('Guadalajara', 'Mexico', 'America/Mexico_City'),
  C('Bogotá', 'Colombia', 'America/Bogota'),
  C('Lima', 'Peru', 'America/Lima'),
  C('Santiago', 'Chile', 'America/Santiago'),
  C('Buenos Aires', 'Argentina', 'America/Argentina/Buenos_Aires'),
  C('São Paulo', 'Brazil', 'America/Sao_Paulo'),
  C('Rio de Janeiro', 'Brazil', 'America/Sao_Paulo'),
  C('Caracas', 'Venezuela', 'America/Caracas'),
  C('Panama City', 'Panama', 'America/Panama'),
  C('San Juan', 'Puerto Rico', 'America/Puerto_Rico'),
  // Europe
  C('London', 'United Kingdom', 'Europe/London'),
  C('Manchester', 'United Kingdom', 'Europe/London'),
  C('Edinburgh', 'United Kingdom', 'Europe/London'),
  C('Dublin', 'Ireland', 'Europe/Dublin'),
  C('Lisbon', 'Portugal', 'Europe/Lisbon'),
  C('Madrid', 'Spain', 'Europe/Madrid'),
  C('Barcelona', 'Spain', 'Europe/Madrid'),
  C('Paris', 'France', 'Europe/Paris'),
  C('Brussels', 'Belgium', 'Europe/Brussels'),
  C('Amsterdam', 'Netherlands', 'Europe/Amsterdam'),
  C('Berlin', 'Germany', 'Europe/Berlin'),
  C('Munich', 'Germany', 'Europe/Berlin'),
  C('Frankfurt', 'Germany', 'Europe/Berlin'),
  C('Zurich', 'Switzerland', 'Europe/Zurich'),
  C('Geneva', 'Switzerland', 'Europe/Zurich'),
  C('Milan', 'Italy', 'Europe/Rome'),
  C('Rome', 'Italy', 'Europe/Rome'),
  C('Vienna', 'Austria', 'Europe/Vienna'),
  C('Prague', 'Czechia', 'Europe/Prague'),
  C('Bratislava', 'Slovakia', 'Europe/Bratislava'),
  C('Budapest', 'Hungary', 'Europe/Budapest'),
  C('Warsaw', 'Poland', 'Europe/Warsaw'),
  C('Copenhagen', 'Denmark', 'Europe/Copenhagen'),
  C('Oslo', 'Norway', 'Europe/Oslo'),
  C('Stockholm', 'Sweden', 'Europe/Stockholm'),
  C('Helsinki', 'Finland', 'Europe/Helsinki'),
  C('Athens', 'Greece', 'Europe/Athens'),
  C('Bucharest', 'Romania', 'Europe/Bucharest'),
  C('Kyiv', 'Ukraine', 'Europe/Kyiv'),
  C('Istanbul', 'Türkiye', 'Europe/Istanbul'),
  C('Moscow', 'Russia', 'Europe/Moscow'),
  // Africa & Middle East
  C('Cairo', 'Egypt', 'Africa/Cairo'),
  C('Lagos', 'Nigeria', 'Africa/Lagos'),
  C('Nairobi', 'Kenya', 'Africa/Nairobi'),
  C('Johannesburg', 'South Africa', 'Africa/Johannesburg'),
  C('Cape Town', 'South Africa', 'Africa/Johannesburg'),
  C('Casablanca', 'Morocco', 'Africa/Casablanca'),
  C('Tel Aviv', 'Israel', 'Asia/Jerusalem'),
  C('Jerusalem', 'Israel', 'Asia/Jerusalem'),
  C('Riyadh', 'Saudi Arabia', 'Asia/Riyadh'),
  C('Doha', 'Qatar', 'Asia/Qatar'),
  C('Dubai', 'United Arab Emirates', 'Asia/Dubai'),
  C('Abu Dhabi', 'United Arab Emirates', 'Asia/Dubai'),
  C('Tehran', 'Iran', 'Asia/Tehran'),
  // Asia
  C('Karachi', 'Pakistan', 'Asia/Karachi'),
  C('Mumbai', 'India', 'Asia/Kolkata'),
  C('Delhi', 'India', 'Asia/Kolkata'),
  C('Bengaluru', 'India', 'Asia/Kolkata'),
  C('Kathmandu', 'Nepal', 'Asia/Kathmandu'),
  C('Dhaka', 'Bangladesh', 'Asia/Dhaka'),
  C('Bangkok', 'Thailand', 'Asia/Bangkok'),
  C('Ho Chi Minh City', 'Vietnam', 'Asia/Ho_Chi_Minh'),
  C('Hanoi', 'Vietnam', 'Asia/Bangkok'),
  C('Jakarta', 'Indonesia', 'Asia/Jakarta'),
  C('Bali', 'Indonesia', 'Asia/Makassar'),
  C('Kuala Lumpur', 'Malaysia', 'Asia/Kuala_Lumpur'),
  C('Singapore', 'Singapore', 'Asia/Singapore'),
  C('Manila', 'Philippines', 'Asia/Manila'),
  C('Hong Kong', 'China', 'Asia/Hong_Kong'),
  C('Shanghai', 'China', 'Asia/Shanghai'),
  C('Beijing', 'China', 'Asia/Shanghai'),
  C('Shenzhen', 'China', 'Asia/Shanghai'),
  C('Taipei', 'Taiwan', 'Asia/Taipei'),
  C('Seoul', 'South Korea', 'Asia/Seoul'),
  C('Tokyo', 'Japan', 'Asia/Tokyo'),
  C('Osaka', 'Japan', 'Asia/Tokyo'),
  // Oceania
  C('Perth', 'Western Australia', 'Australia/Perth'),
  C('Darwin', 'Northern Territory, Australia', 'Australia/Darwin'),
  C('Adelaide', 'South Australia', 'Australia/Adelaide'),
  C('Brisbane', 'Queensland, Australia', 'Australia/Brisbane'),
  C('Gold Coast', 'Queensland, Australia', 'Australia/Brisbane'),
  C('Sydney', 'New South Wales, Australia', 'Australia/Sydney'),
  C('Canberra', 'ACT, Australia', 'Australia/Sydney'),
  C('Melbourne', 'Victoria, Australia', 'Australia/Melbourne'),
  C('Hobart', 'Tasmania, Australia', 'Australia/Hobart'),
  C('Auckland', 'New Zealand', 'Pacific/Auckland'),
  C('Wellington', 'New Zealand', 'Pacific/Auckland'),
  C('Christchurch', 'New Zealand', 'Pacific/Auckland'),
  C('Fiji', 'Fiji', 'Pacific/Fiji'),
  // Reference
  C('UTC', 'Coordinated Universal Time', 'UTC')
]

export type TimeZoneSearchResult = { key: string; label: string; detail: string; timeZone: string; city: string }

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_/,.]/g, ' ').replace(/\s+/g, ' ').trim()
}

const validity = new Map<string, boolean>()
/** Older ICU builds may not know newer names (e.g. Europe/Kyiv); never offer a zone that would throw. */
export function isSupportedTimeZone(timeZone: string): boolean {
  let ok = validity.get(timeZone)
  if (ok === undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone }); ok = true } catch { ok = false }
    validity.set(timeZone, ok)
  }
  return ok
}

function zoneCity(timeZone: string): string {
  return timeZone.split('/').at(-1)?.replaceAll('_', ' ') || timeZone
}

/**
 * Search the curated city list plus every IANA zone the runtime knows.
 * Cities rank first; a prefix match beats a substring match.
 */
export function searchTimeZones(query: string, ianaZones: readonly string[], limit = 40): TimeZoneSearchResult[] {
  const q = normalize(query)
  const scored: Array<{ score: number; result: TimeZoneSearchResult }> = []
  const seen = new Set<string>()
  const score = (haystack: string, base: number): number => {
    if (!q) return base
    const h = normalize(haystack)
    if (h === q) return base + 300
    if (h.startsWith(q)) return base + 200
    if (h.split(' ').some((word) => word.startsWith(q))) return base + 120
    if (h.includes(q)) return base + 60
    return -1
  }
  for (const entry of WORLD_CITIES) {
    if (!isSupportedTimeZone(entry.timeZone)) continue
    const s = Math.max(score(entry.city, 20), score(`${entry.city} ${entry.region}`, 10), score(entry.timeZone, 0))
    if (s < 0) continue
    const key = `city:${entry.city}:${entry.timeZone}`
    seen.add(entry.timeZone)
    scored.push({ score: s, result: { key, label: entry.city, detail: `${entry.region} · ${entry.timeZone.replaceAll('_', ' ')}`, timeZone: entry.timeZone, city: entry.city } })
  }
  for (const zone of ianaZones) {
    const s = score(zone, -5)
    if (s < 0) continue
    // Skip bare zones a curated city already covers unless the user typed the zone itself.
    if (!q && seen.has(zone)) continue
    scored.push({ score: s, result: { key: `zone:${zone}`, label: zone.replaceAll('_', ' '), detail: 'Time zone', timeZone: zone, city: zoneCity(zone) } })
  }
  scored.sort((a, b) => b.score - a.score || a.result.label.localeCompare(b.result.label))
  return scored.slice(0, limit).map((item) => item.result)
}
