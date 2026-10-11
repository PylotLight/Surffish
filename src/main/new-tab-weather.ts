import type { NewTabWeatherSnapshot } from '../shared/types'

interface CachedWeather {
  expiresAt: number
  value: NewTabWeatherSnapshot
}

const WEATHER_CACHE_MS = 10 * 60 * 1000
const weatherCache = new Map<string, CachedWeather>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getJson(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000)
  })
  if (!response.ok) throw new Error(`Weather provider returned HTTP ${response.status}.`)
  return response.json() as Promise<unknown>
}

function describeWeather(code: number): string {
  if (code === 0) return 'Clear sky'
  if (code <= 3) return 'Partly cloudy'
  if ([45, 48].includes(code)) return 'Fog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([95, 96, 99].includes(code)) return 'Thunderstorms'
  return 'Current conditions'
}

export async function getNewTabWeather(locationInput: string): Promise<NewTabWeatherSnapshot> {
  const location = locationInput.trim().slice(0, 100)
  if (!location) throw new Error('Add a city or town in New Tab settings to load weather.')
  const cacheKey = location.toLocaleLowerCase()
  const cached = weatherCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value }

  const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
  geocodingUrl.search = new URLSearchParams({ name: location, count: '1', language: 'en', format: 'json' }).toString()
  const geocoding = await getJson(geocodingUrl)
  const results = isRecord(geocoding) && Array.isArray(geocoding.results) ? geocoding.results : []
  const place = results.find((entry): entry is Record<string, unknown> => isRecord(entry)
    && typeof entry.name === 'string'
    && typeof entry.latitude === 'number'
    && typeof entry.longitude === 'number')
  if (!place) throw new Error(`Could not find “${location}”. Check the city name in New Tab settings.`)

  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
  forecastUrl.search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,weather_code',
    timezone: 'auto',
    forecast_days: '1'
  }).toString()
  const forecast = await getJson(forecastUrl)
  const current = isRecord(forecast) && isRecord(forecast.current) ? forecast.current : null
  if (!current || typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') {
    throw new Error('Weather data is temporarily unavailable.')
  }

  const resolvedLocation = [place.name, place.admin1, place.country]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ')
  const value: NewTabWeatherSnapshot = {
    location: resolvedLocation || location,
    temperatureCelsius: current.temperature_2m,
    weatherCode: current.weather_code,
    description: describeWeather(current.weather_code),
    fetchedAt: Date.now()
  }
  weatherCache.set(cacheKey, { value, expiresAt: Date.now() + WEATHER_CACHE_MS })
  return { ...value }
}
