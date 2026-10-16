/**
 * New Tab weather: providers, the place a search picked, and the pure parsing of each provider's
 * response. Network calls live in main (main/new-tab-weather.ts); everything here is unit-tested.
 */
import type { NewTabWeatherSnapshot, WeatherPlace, WeatherProviderId } from './types'

export interface WeatherProviderInfo {
  id: WeatherProviderId
  label: string
  /** One line for Settings: what it is and what it sends. */
  hint: string
  needsKey: boolean
}

export const WEATHER_PROVIDERS: readonly WeatherProviderInfo[] = [
  { id: 'open-meteo', label: 'Open-Meteo', hint: 'Free, no key. Sends only the place’s coordinates.', needsKey: false },
  { id: 'met-norway', label: 'MET Norway', hint: 'Norwegian Meteorological Institute (yr.no). Free, no key. Sends only coordinates.', needsKey: false },
  { id: 'wttr', label: 'wttr.in', hint: 'Free, no key, best effort: a hobby service that can be slow or busy.', needsKey: false },
  { id: 'openweathermap', label: 'OpenWeather', hint: 'Needs your own free OpenWeather API key, kept on this device.', needsKey: true }
]

export const DEFAULT_WEATHER_PROVIDER: WeatherProviderId = 'open-meteo'
export const WEATHER_CACHE_MS = 10 * 60 * 1000
export const MAX_WEATHER_API_KEY_LENGTH = 128

export function isWeatherProviderId(value: unknown): value is WeatherProviderId {
  return typeof value === 'string' && WEATHER_PROVIDERS.some((provider) => provider.id === value)
}

export function weatherProviderLabel(id: WeatherProviderId): string {
  return WEATHER_PROVIDERS.find((provider) => provider.id === id)?.label ?? 'Weather'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, max)
  return trimmed || undefined
}

function finite(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** A stored or IPC-supplied place, or null when it isn't a usable one. Coordinates keep 4 decimals (~11 m). */
export function normalizeWeatherPlace(value: unknown): WeatherPlace | null {
  if (!isRecord(value)) return null
  const name = text(value.name, 100)
  const latitude = finite(value.latitude)
  const longitude = finite(value.longitude)
  if (!name || latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  const place: WeatherPlace = { name, latitude: Math.round(latitude * 1e4) / 1e4, longitude: Math.round(longitude * 1e4) / 1e4 }
  const region = text(value.region, 100)
  const country = text(value.country, 100)
  const countryCode = text(value.countryCode, 3)
  const timeZone = text(value.timeZone, 100)
  if (region) place.region = region
  if (country) place.country = country
  if (countryCode) place.countryCode = countryCode.toUpperCase()
  if (timeZone) place.timeZone = timeZone
  return place
}

/** "Melbourne, Victoria, Australia" (parts deduplicated, so "Singapore, Singapore" collapses). */
export function weatherPlaceLabel(place: Pick<WeatherPlace, 'name' | 'region' | 'country'>): string {
  return [place.name, place.region, place.country]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ')
}

/** Open-Meteo geocoding results → places (the search box's suggestions). */
export function parseGeocodingResults(json: unknown, limit = 8): WeatherPlace[] {
  const results = isRecord(json) && Array.isArray(json.results) ? json.results : []
  const places: WeatherPlace[] = []
  const seen = new Set<string>()
  for (const entry of results) {
    if (!isRecord(entry)) continue
    const place = normalizeWeatherPlace({
      name: entry.name,
      region: entry.admin1,
      country: entry.country,
      countryCode: entry.country_code,
      latitude: entry.latitude,
      longitude: entry.longitude,
      timeZone: entry.timezone
    })
    if (!place) continue
    const key = `${weatherPlaceLabel(place)}|${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    places.push(place)
    if (places.length >= limit) break
  }
  return places
}

/** IP geolocation (get.geojs.io/v1/ip/geo.json) → an approximate place. */
export function parseIpLocation(json: unknown): WeatherPlace | null {
  if (!isRecord(json)) return null
  return normalizeWeatherPlace({
    name: json.city ?? json.region ?? json.country,
    region: json.region,
    country: json.country,
    countryCode: json.country_code,
    latitude: json.latitude,
    longitude: json.longitude,
    timeZone: json.timezone
  })
}

/** WMO weather interpretation codes (Open-Meteo). */
export function describeWmoCode(code: number): string {
  if (code === 0) return 'Clear sky'
  if (code === 1) return 'Mainly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if ([45, 48].includes(code)) return 'Fog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([95, 96, 99].includes(code)) return 'Thunderstorms'
  return 'Current conditions'
}

const MET_SYMBOLS: Record<string, string> = {
  clearsky: 'Clear sky', fair: 'Mainly clear', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog',
  lightrain: 'Light rain', rain: 'Rain', heavyrain: 'Heavy rain', lightrainshowers: 'Light showers', rainshowers: 'Showers', heavyrainshowers: 'Heavy showers',
  lightsleet: 'Light sleet', sleet: 'Sleet', heavysleet: 'Heavy sleet', lightsleetshowers: 'Sleet showers', sleetshowers: 'Sleet showers', heavysleetshowers: 'Sleet showers',
  lightsnow: 'Light snow', snow: 'Snow', heavysnow: 'Heavy snow', lightsnowshowers: 'Snow showers', snowshowers: 'Snow showers', heavysnowshowers: 'Snow showers'
}

/** MET Norway symbol_code ("partlycloudy_night", "lightrainshowersandthunder_day") → words. */
export function describeMetSymbol(symbol: string): string {
  const base = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (base.endsWith('andthunder')) return `${MET_SYMBOLS[base.slice(0, -'andthunder'.length)] ?? 'Rain'} and thunder`
  return MET_SYMBOLS[base] ?? 'Current conditions'
}

type Reading = Pick<NewTabWeatherSnapshot, 'temperatureCelsius' | 'description'>

export function parseOpenMeteoCurrent(json: unknown): Reading | null {
  const current = isRecord(json) && isRecord(json.current) ? json.current : null
  const temperature = finite(current?.temperature_2m)
  const code = finite(current?.weather_code)
  if (temperature === null || code === null) return null
  return { temperatureCelsius: temperature, description: describeWmoCode(code) }
}

export function parseMetNorway(json: unknown): Reading | null {
  const series = isRecord(json) && isRecord(json.properties) && Array.isArray(json.properties.timeseries) ? json.properties.timeseries : []
  const first = series.find(isRecord)
  const data = isRecord(first?.data) ? first.data : null
  const details = isRecord(data?.instant) && isRecord(data.instant.details) ? data.instant.details : null
  const temperature = finite(details?.air_temperature)
  if (temperature === null) return null
  const summary = [data?.next_1_hours, data?.next_6_hours, data?.next_12_hours]
    .map((block) => (isRecord(block) && isRecord(block.summary) ? block.summary.symbol_code : undefined))
    .find((code): code is string => typeof code === 'string')
  return { temperatureCelsius: temperature, description: summary ? describeMetSymbol(summary) : 'Current conditions' }
}

export function parseWttr(json: unknown): Reading | null {
  const current = isRecord(json) && Array.isArray(json.current_condition) ? json.current_condition.find(isRecord) : undefined
  const temperature = finite(current?.temp_C)
  if (!current || temperature === null) return null
  const desc = Array.isArray(current.weatherDesc) ? current.weatherDesc.find(isRecord)?.value : undefined
  return { temperatureCelsius: temperature, description: text(desc, 60) ?? 'Current conditions' }
}

export function parseOpenWeatherMap(json: unknown): Reading | null {
  const main = isRecord(json) && isRecord(json.main) ? json.main : null
  const temperature = finite(main?.temp)
  if (temperature === null) return null
  const weather = isRecord(json) && Array.isArray(json.weather) ? json.weather.find(isRecord) : undefined
  const desc = text(weather?.description, 60)
  return { temperatureCelsius: temperature, description: desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : 'Current conditions' }
}

/** Cache key: one entry per provider and place (coordinates, so two "Springfield"s never share). */
export function weatherCacheKey(provider: WeatherProviderId, place: WeatherPlace): string {
  return `${provider}|${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`
}

/** A friendly sentence for a failed provider request (shown on the New Tab and in Settings). */
export function weatherErrorMessage(provider: WeatherProviderId, error: { status?: number; timeout?: boolean; offline?: boolean }): string {
  const label = weatherProviderLabel(provider)
  if (error.timeout) return `${label} didn’t answer in time. Trying again later.`
  if (error.offline) return `Can’t reach ${label}. Check your connection.`
  if (error.status === 401 || error.status === 403) return provider === 'openweathermap' ? 'OpenWeather rejected the API key. Check it in New Tab settings.' : `${label} refused the request (HTTP ${error.status}).`
  if (error.status === 429) return `${label} is rate-limiting requests. Trying again later.`
  if (error.status && error.status >= 500) return `${label} is having trouble (HTTP ${error.status}). Trying again later.`
  if (error.status) return `${label} returned HTTP ${error.status}.`
  return `${label} sent weather data Surffish couldn’t read.`
}

export function formatTemperature(celsius: number, unit: 'celsius' | 'fahrenheit'): string {
  return `${Math.round(unit === 'fahrenheit' ? celsius * 9 / 5 + 32 : celsius)}°${unit === 'fahrenheit' ? 'F' : 'C'}`
}
