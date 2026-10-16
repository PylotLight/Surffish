import { describe, expect, test } from 'bun:test'
import {
  describeMetSymbol, formatTemperature, isWeatherProviderId, normalizeWeatherPlace, parseGeocodingResults, parseIpLocation,
  parseMetNorway, parseOpenMeteoCurrent, parseOpenWeatherMap, parseWttr, weatherCacheKey, weatherErrorMessage, weatherPlaceLabel
} from './weather'

describe('weather places', () => {
  test('geocoding results become deduplicated places with region and country', () => {
    const places = parseGeocodingResults({
      results: [
        { name: 'Melbourne', admin1: 'Victoria', country: 'Australia', country_code: 'au', latitude: -37.814, longitude: 144.96332, timezone: 'Australia/Melbourne' },
        { name: 'Melbourne', admin1: 'Victoria', country: 'Australia', country_code: 'AU', latitude: -37.8141, longitude: 144.9633 },
        { name: 'Melbourne', admin1: 'Florida', country: 'United States', latitude: 28.08363, longitude: -80.60811 },
        { name: 'Broken', latitude: 'x', longitude: 1 },
        'junk'
      ]
    })
    expect(places.map(weatherPlaceLabel)).toEqual(['Melbourne, Victoria, Australia', 'Melbourne, Florida, United States'])
    expect(places[0]).toEqual({ name: 'Melbourne', region: 'Victoria', country: 'Australia', countryCode: 'AU', latitude: -37.814, longitude: 144.9633, timeZone: 'Australia/Melbourne' })
    expect(parseGeocodingResults({})).toEqual([])
    expect(parseGeocodingResults({ results: Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, latitude: i, longitude: i })) }, 5)).toHaveLength(5)
  })

  test('labels collapse repeated parts and places reject bad coordinates', () => {
    expect(weatherPlaceLabel({ name: 'Singapore', region: 'Singapore', country: 'Singapore' })).toBe('Singapore')
    expect(normalizeWeatherPlace({ name: 'X', latitude: 91, longitude: 0 })).toBeNull()
    expect(normalizeWeatherPlace({ name: '', latitude: 1, longitude: 0 })).toBeNull()
    expect(normalizeWeatherPlace({ name: 'Y', latitude: '45.84', longitude: '-119.7' })).toEqual({ name: 'Y', latitude: 45.84, longitude: -119.7 })
  })

  test('IP location (geojs) becomes an approximate place', () => {
    expect(parseIpLocation({ city: 'Boardman', region: 'Oregon', country: 'United States', country_code: 'US', latitude: '45.8401', longitude: '-119.705', timezone: 'America/Los_Angeles' }))
      .toEqual({ name: 'Boardman', region: 'Oregon', country: 'United States', countryCode: 'US', latitude: 45.8401, longitude: -119.705, timeZone: 'America/Los_Angeles' })
    expect(parseIpLocation({ country: 'Nowhere' })).toBeNull()
  })

  test('cache key is per provider and coordinates', () => {
    const place = { name: 'A', latitude: 1.23456, longitude: 2 }
    expect(weatherCacheKey('open-meteo', place)).not.toBe(weatherCacheKey('met-norway', place))
    expect(weatherCacheKey('open-meteo', place)).not.toBe(weatherCacheKey('open-meteo', { ...place, latitude: 1.3 }))
  })
})

describe('weather providers', () => {
  test('provider ids', () => {
    expect(isWeatherProviderId('wttr')).toBe(true)
    expect(isWeatherProviderId('darksky')).toBe(false)
  })

  test('Open-Meteo current', () => {
    expect(parseOpenMeteoCurrent({ current: { temperature_2m: 15.3, weather_code: 2 } })).toEqual({ temperatureCelsius: 15.3, description: 'Partly cloudy' })
    expect(parseOpenMeteoCurrent({ current: { temperature_2m: 15.3 } })).toBeNull()
  })

  test('MET Norway compact', () => {
    const json = { properties: { timeseries: [{ data: { instant: { details: { air_temperature: 15.3 } }, next_1_hours: { summary: { symbol_code: 'partlycloudy_night' } } } }] } }
    expect(parseMetNorway(json)).toEqual({ temperatureCelsius: 15.3, description: 'Partly cloudy' })
    expect(describeMetSymbol('lightrainshowersandthunder_day')).toBe('Light showers and thunder')
    expect(describeMetSymbol('heavysnow')).toBe('Heavy snow')
    expect(describeMetSymbol('mystery_day')).toBe('Current conditions')
    expect(parseMetNorway({ properties: { timeseries: [] } })).toBeNull()
  })

  test('wttr.in j1', () => {
    expect(parseWttr({ current_condition: [{ temp_C: '16', weatherDesc: [{ value: 'Cloudy ' }] }] })).toEqual({ temperatureCelsius: 16, description: 'Cloudy' })
    expect(parseWttr({ current_condition: [] })).toBeNull()
  })

  test('OpenWeather current weather', () => {
    expect(parseOpenWeatherMap({ main: { temp: 9.5 }, weather: [{ description: 'light rain' }] })).toEqual({ temperatureCelsius: 9.5, description: 'Light rain' })
    expect(parseOpenWeatherMap({ cod: 401 })).toBeNull()
  })

  test('friendly errors', () => {
    expect(weatherErrorMessage('openweathermap', { status: 401 })).toMatch(/API key/)
    expect(weatherErrorMessage('wttr', { timeout: true })).toMatch(/wttr.in didn’t answer/)
    expect(weatherErrorMessage('met-norway', { status: 503 })).toMatch(/MET Norway is having trouble/)
    expect(weatherErrorMessage('open-meteo', { offline: true })).toMatch(/Can’t reach Open-Meteo/)
  })

  test('temperature units', () => {
    expect(formatTemperature(15.3, 'celsius')).toBe('15°C')
    expect(formatTemperature(15.3, 'fahrenheit')).toBe('60°F')
  })
})
