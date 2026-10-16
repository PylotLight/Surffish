import { app, safeStorage } from 'electron'
import type { NewTabWeatherSnapshot, WeatherKeyStatus, WeatherPlace, WeatherProviderId, WeatherResult } from '../shared/types'
import {
  DEFAULT_WEATHER_PROVIDER, isWeatherProviderId, MAX_WEATHER_API_KEY_LENGTH, normalizeWeatherPlace, parseGeocodingResults, parseIpLocation,
  parseMetNorway, parseOpenMeteoCurrent, parseOpenWeatherMap, parseWttr, WEATHER_CACHE_MS, weatherCacheKey, weatherErrorMessage, weatherPlaceLabel
} from '../shared/weather'
import { readUserJson, writeUserJson } from './user-json'

/**
 * New Tab weather. Every provider is asked by coordinates; Open-Meteo's keyless geocoder powers the
 * city search. Readings are cached 10 min per provider + place. Requests use the global `fetch`
 * (looked up per call, so the smokes can stand in a fake one without network).
 */

interface CachedWeather {
  expiresAt: number
  value: NewTabWeatherSnapshot
}

const weatherCache = new Map<string, CachedWeather>()
const legacyPlaces = new Map<string, WeatherPlace>()
const KEYS_FILE = 'weather-keys.json'
const REQUEST_TIMEOUT_MS = 8_000

class WeatherRequestError extends Error {}

function userAgent(): string {
  // MET Norway's terms require an identifying User-Agent with a contact.
  return `Surffish/${app.getVersion()} (+https://github.com/PylotLight/Surffish)`
}

async function getJson(url: URL, provider: WeatherProviderId): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    throw new WeatherRequestError(weatherErrorMessage(provider, name === 'TimeoutError' || name === 'AbortError' ? { timeout: true } : { offline: true }))
  }
  if (!response.ok) throw new WeatherRequestError(weatherErrorMessage(provider, { status: response.status }))
  try {
    return await response.json() as unknown
  } catch {
    throw new WeatherRequestError(weatherErrorMessage(provider, {}))
  }
}

/** City search for the New Tab settings (type-ahead suggestions). */
export async function searchWeatherPlaces(queryInput: string): Promise<WeatherPlace[]> {
  const query = queryInput.trim().slice(0, 100)
  if (query.length < 2) return []
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.search = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' }).toString()
  return parseGeocodingResults(await getJson(url, 'open-meteo'))
}

/** "Use my approximate location": an IP lookup (get.geojs.io, keyless). City-level at best. */
export async function locateWeatherPlace(): Promise<WeatherPlace> {
  let json: unknown
  try {
    json = await getJson(new URL('https://get.geojs.io/v1/ip/geo.json'), 'open-meteo')
  } catch {
    throw new Error('Couldn’t look up your approximate location. Search for your city instead.')
  }
  const place = parseIpLocation(json)
  if (!place) throw new Error('Couldn’t work out your approximate location. Search for your city instead.')
  return place
}

async function resolveLegacyLocation(location: string): Promise<WeatherPlace> {
  const key = location.toLocaleLowerCase()
  const known = legacyPlaces.get(key)
  if (known) return known
  const [place] = await searchWeatherPlaces(location)
  if (!place) throw new Error(`Could not find “${location}”. Search for your city in New Tab settings.`)
  legacyPlaces.set(key, place)
  return place
}

async function readKeys(): Promise<Partial<Record<WeatherProviderId, string>>> {
  const saved = readUserJson(KEYS_FILE)
  if (typeof saved !== 'object' || saved === null) return {}
  const keys: Partial<Record<WeatherProviderId, string>> = {}
  for (const [provider, entry] of Object.entries(saved as Record<string, unknown>)) {
    if (!isWeatherProviderId(provider) || typeof entry !== 'object' || entry === null) continue
    const { value, encrypted } = entry as { value?: unknown; encrypted?: unknown }
    if (typeof value !== 'string') continue
    try {
      keys[provider] = encrypted === true ? (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result : value
    } catch {
      // The OS keychain changed (new machine, reset profile): the key is gone, ask for it again.
    }
  }
  return keys
}

export async function getWeatherKeyStatus(): Promise<WeatherKeyStatus> {
  return { openweathermap: Boolean((await readKeys()).openweathermap) }
}

/** Saves (or with an empty value, removes) a provider's API key: OS-encrypted when available, 0600 either way. */
export async function setWeatherApiKey(provider: unknown, keyInput: unknown): Promise<WeatherKeyStatus> {
  if (provider !== 'openweathermap') throw new Error('Only OpenWeather takes an API key.')
  const key = typeof keyInput === 'string' ? keyInput.trim() : ''
  if (key.length > MAX_WEATHER_API_KEY_LENGTH || /[^\w-]/.test(key)) throw new Error('That doesn’t look like an OpenWeather API key.')
  const saved = (readUserJson(KEYS_FILE) ?? {}) as Record<string, unknown>
  if (!key) delete saved[provider]
  else if (await safeStorage.isAsyncEncryptionAvailable()) saved[provider] = { value: (await safeStorage.encryptStringAsync(key)).toString('base64'), encrypted: true }
  else saved[provider] = { value: key, encrypted: false }
  writeUserJson(KEYS_FILE, saved)
  for (const cacheKey of weatherCache.keys()) if (cacheKey.startsWith(`${provider}|`)) weatherCache.delete(cacheKey)
  return getWeatherKeyStatus()
}

async function readProvider(provider: WeatherProviderId, place: WeatherPlace): Promise<Pick<NewTabWeatherSnapshot, 'temperatureCelsius' | 'description'>> {
  const lat = place.latitude.toFixed(4)
  const lon = place.longitude.toFixed(4)
  let url: URL
  let parse: (json: unknown) => Pick<NewTabWeatherSnapshot, 'temperatureCelsius' | 'description'> | null
  if (provider === 'met-norway') {
    url = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact')
    url.search = new URLSearchParams({ lat, lon }).toString()
    parse = parseMetNorway
  } else if (provider === 'wttr') {
    url = new URL(`https://wttr.in/${lat},${lon}`)
    url.search = new URLSearchParams({ format: 'j1' }).toString()
    parse = parseWttr
  } else if (provider === 'openweathermap') {
    const key = (await readKeys()).openweathermap
    if (!key) throw new Error('Add your OpenWeather API key in New Tab settings, or pick a free provider.')
    url = new URL('https://api.openweathermap.org/data/2.5/weather')
    url.search = new URLSearchParams({ lat, lon, units: 'metric', appid: key }).toString()
    parse = parseOpenWeatherMap
  } else {
    url = new URL('https://api.open-meteo.com/v1/forecast')
    url.search = new URLSearchParams({ latitude: lat, longitude: lon, current: 'temperature_2m,weather_code', timezone: 'auto', forecast_days: '1' }).toString()
    parse = parseOpenMeteoCurrent
  }
  const reading = parse(await getJson(url, provider))
  if (!reading) throw new Error(weatherErrorMessage(provider, {}))
  return reading
}

export interface NewTabWeatherRequest {
  provider?: unknown
  place?: unknown
  /** Settings saved before city search: free text, geocoded once (the renderer then saves the place). */
  location?: unknown
}

export async function getNewTabWeather(request: NewTabWeatherRequest | string): Promise<NewTabWeatherSnapshot> {
  const input = typeof request === 'string' ? { location: request } : request
  const provider = isWeatherProviderId(input.provider) ? input.provider : DEFAULT_WEATHER_PROVIDER
  let place = normalizeWeatherPlace(input.place)
  if (!place) {
    const location = typeof input.location === 'string' ? input.location.trim().slice(0, 100) : ''
    if (!location) throw new Error('Search for a city in New Tab settings to load weather.')
    place = await resolveLegacyLocation(location)
  }
  const cacheKey = weatherCacheKey(provider, place)
  const cached = weatherCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value }
  const reading = await readProvider(provider, place)
  const value: NewTabWeatherSnapshot = { ...reading, location: weatherPlaceLabel(place), provider, place, fetchedAt: Date.now() }
  weatherCache.set(cacheKey, { value, expiresAt: Date.now() + WEATHER_CACHE_MS })
  return { ...value, place: { ...place } }
}


/** IPC wrapper: an expected failure (offline, bad key, unknown city) comes back as `{ ok: false }` instead of a thrown, logged error. */
export async function weatherResult<T>(work: () => Promise<T>): Promise<WeatherResult<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
