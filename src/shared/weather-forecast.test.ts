import { describe, expect, test } from 'bun:test'
import {
  clampWeatherScale, conditionFromDescription, forecastDayCount, forecastDayLabel, formatTemperatureShort, isWeatherForecastView, localClock, longitudeOffsetMinutes, metSymbolCondition,
  openWeatherCondition, parseMetNorwayDaily, parseOpenMeteoDaily, parseOpenWeatherForecast, parseWttrDaily, placeToday, visibleForecast, WEATHER_PROVIDER_DAY_LIMITS, weatherFit, wmoCondition, wttrCondition
} from './weather-forecast'
import { parseNewTabPreferences } from './persistence'

describe('forecast setting and weather size', () => {
  test('views map to day counts; unknown views are rejected', () => {
    expect(['current', 'today', 'days3', 'days5', 'days7'].map((view) => forecastDayCount(view as never))).toEqual([0, 1, 3, 5, 7])
    expect(isWeatherForecastView('days5')).toBe(true)
    expect(isWeatherForecastView('days9')).toBe(false)
    expect(isWeatherForecastView(3)).toBe(false)
  })

  test('weather size clamps to 50–250 on 5 % steps; junk is 100', () => {
    expect(clampWeatherScale(100)).toBe(100)
    expect(clampWeatherScale(7)).toBe(50)
    expect(clampWeatherScale(999)).toBe(250)
    expect(clampWeatherScale(103)).toBe(105)
    expect(clampWeatherScale(102)).toBe(100)
    expect(clampWeatherScale(247.6)).toBe(250)
    expect(clampWeatherScale('150')).toBe(100)
    expect(clampWeatherScale(Number.NaN)).toBe(100)
    expect(clampWeatherScale(undefined)).toBe(100)
  })

  test('saved preferences: old profiles get today’s look, bad values fall back, good ones stay', () => {
    const old = parseNewTabPreferences({ weatherEnabled: true, weatherPosition: 'corner', clockScale: 145 })
    expect([old.weatherScale, old.weatherForecast, old.weatherPosition, old.clockScale]).toEqual([100, 'current', 'corner', 145])
    const saved = parseNewTabPreferences({ weatherScale: 200, weatherForecast: 'days5' })
    expect([saved.weatherScale, saved.weatherForecast]).toEqual([200, 'days5'])
    const bad = parseNewTabPreferences({ weatherScale: 1000, weatherForecast: 'fortnight' })
    expect([bad.weatherScale, bad.weatherForecast]).toEqual([250, 'current'])
    expect(parseNewTabPreferences({ weatherScale: 12 }).weatherScale).toBe(50)
    expect(parseNewTabPreferences({ weatherScale: 133 }).weatherScale).toBe(135)
  })

  test('a forecast too tall for the window shrinks to fit, never below half', () => {
    expect(weatherFit(400, 200, 1)).toBe(1)
    expect(weatherFit(150, 200, 1)).toBe(0.75)
    expect(weatherFit(150, 150, 0.75)).toBe(0.75) // already fitted: stays put
    expect(weatherFit(400, 150, 0.75)).toBe(1) // the window grew: back to full size
    expect(weatherFit(20, 200, 1)).toBe(0.5)
    expect(weatherFit(-50, 200, 1)).toBe(0.5)
    expect(weatherFit(Infinity, 200, 1)).toBe(1)
    expect(weatherFit(100, 0, 1)).toBe(1)
  })

  test('provider day limits: wttr.in 3, OpenWeather 5, the rest 7', () => {
    expect(WEATHER_PROVIDER_DAY_LIMITS).toEqual({ 'open-meteo': 7, 'met-norway': 7, wttr: 3, openweathermap: 5 })
  })
})

describe('conditions', () => {
  test('each provider’s codes land in the right icon family', () => {
    expect([0, 1, 2, 3, 45, 53, 61, 66, 73, 81, 95].map(wmoCondition)).toEqual(['clear', 'partly', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'rain', 'thunder'])
    expect(['clearsky_day', 'fair_night', 'partlycloudy_day', 'cloudy', 'fog', 'lightrain', 'heavyrainshowers_day', 'sleet', 'snowshowers_night', 'rainandthunder'].map(metSymbolCondition))
      .toEqual(['clear', 'partly', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'thunder'])
    expect([113, 116, 119, 248, 266, 296, 317, 338, 389, 999].map(wttrCondition)).toEqual(['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'thunder', 'cloudy'])
    expect([211, 301, 500, 511, 601, 613, 741, 800, 802, 804].map(openWeatherCondition)).toEqual(['thunder', 'drizzle', 'rain', 'sleet', 'snow', 'sleet', 'fog', 'clear', 'partly', 'cloudy'])
  })

  test('current readings get an icon from their words, for every provider', () => {
    expect(['Partly cloudy', 'Light rain showers', 'Heavy rain', 'Rain and thunder', 'Mist', 'Sunny', 'Overcast', 'Light snow', 'Freezing drizzle'].map(conditionFromDescription))
      .toEqual(['partly', 'drizzle', 'rain', 'thunder', 'fog', 'clear', 'cloudy', 'snow', 'sleet'])
  })
})

describe('daily aggregation per provider', () => {
  test('Open-Meteo: the daily block as is (local dates), null rain chance when a model has none, null temperature days dropped', () => {
    const days = parseOpenMeteoDaily({
      daily: {
        time: ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'],
        weather_code: [2, 61, null, 3],
        temperature_2m_max: [21.4, 17.2, 19, null],
        temperature_2m_min: [11.1, 9.8, 8.5, 7],
        precipitation_probability_max: [10, 85, null, 5]
      }
    })
    expect(days).toEqual([
      { date: '2026-10-17', highCelsius: 21.4, lowCelsius: 11.1, precipitationChance: 10, condition: 'partly', description: 'Partly cloudy' },
      { date: '2026-10-18', highCelsius: 17.2, lowCelsius: 9.8, precipitationChance: 85, condition: 'rain', description: 'Rain' },
      { date: '2026-10-19', highCelsius: 19, lowCelsius: 8.5, precipitationChance: null, condition: 'cloudy', description: 'Cloudy' }
    ])
    expect(parseOpenMeteoDaily({ daily: { time: Array.from({ length: 16 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`), temperature_2m_max: Array(16).fill(20), temperature_2m_min: Array(16).fill(10) } })).toHaveLength(7)
    expect(parseOpenMeteoDaily({ current: {} })).toEqual([])
  })

  test('MET Norway: hi/lo per local day from instants + 6-hour max/min, midday symbol, max precipitation probability', () => {
    // Melbourne (UTC+11 in October): hourly from 2026-10-17 06:00 UTC (17:00 local) to the next day, then 6-hourly.
    const timeseries: unknown[] = []
    const hourly = (iso: string, temp: number, symbol: string, probability?: number) => ({
      time: iso,
      data: {
        instant: { details: { air_temperature: temp } },
        next_1_hours: { summary: { symbol_code: symbol }, details: { precipitation_amount: 0, ...(probability === undefined ? {} : { probability_of_precipitation: probability }) } }
      }
    })
    for (let h = 6; h < 24; h += 1) timeseries.push(hourly(`2026-10-17T${String(h).padStart(2, '0')}:00:00Z`, 20 - (h - 6) * 0.5, h === 6 ? 'cloudy' : 'clearsky_night', h === 8 ? 30 : 5))
    for (let h = 0; h < 13; h += 1) timeseries.push(hourly(`2026-10-18T${String(h).padStart(2, '0')}:00:00Z`, 12 + h, h === 1 ? 'partlycloudy_day' : 'cloudy', 10))
    const sixHourly = (iso: string, temp: number, max: number, min: number, symbol: string, probability: number) => ({
      time: iso,
      data: { instant: { details: { air_temperature: temp } }, next_6_hours: { summary: { symbol_code: symbol }, details: { air_temperature_max: max, air_temperature_min: min, probability_of_precipitation: probability } } }
    })
    timeseries.push(sixHourly('2026-10-18T18:00:00Z', 10, 11, 8, 'rain', 70)) // 05:00 on the 19th local
    timeseries.push(sixHourly('2026-10-19T00:00:00Z', 15, 19, 14, 'lightrainshowers_day', 60)) // 11:00 local
    timeseries.push(sixHourly('2026-10-19T06:00:00Z', 16, 17, 12, 'cloudy', 20))
    timeseries.push(sixHourly('2026-10-19T12:00:00Z', 11, 12, 9, 'cloudy', 10))
    timeseries.push(sixHourly('2026-10-20T18:00:00Z', 9, 10, 8, 'snow', 5)) // the series' last stamp: a lone point on the 21st local
    const days = parseMetNorwayDaily({ properties: { timeseries } }, localClock('Australia/Melbourne', 0))
    expect(days.map((day) => day.date)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19'])
    // The 17th local is 06:00–12:00 UTC (17:00–23:00 local): 20 down to 17.
    expect(days[0]).toMatchObject({ highCelsius: 20, lowCelsius: 17, precipitationChance: 30, condition: 'cloudy' })
    // The 18th local: 00:00–12:00 UTC on the 17th/18th plus the hourly steps; 12 + 12 = 24 at 12:00 UTC (23:00 local).
    expect(days[1]).toMatchObject({ highCelsius: 24, lowCelsius: 11.5, precipitationChance: 10, condition: 'partly' })
    // The 19th: instants 10/15/16/11 and 6-hour blocks 19 max, 8 min; the block starting 11:00 local is nearest midday.
    expect(days[2]).toMatchObject({ highCelsius: 19, lowCelsius: 8, precipitationChance: 70, condition: 'drizzle' })
  })

  test('MET Norway compact (no probabilities) and a place without a zone (longitude offset)', () => {
    const json = { properties: { timeseries: [
      { time: '2026-10-17T10:00:00Z', data: { instant: { details: { air_temperature: 5 } }, next_1_hours: { summary: { symbol_code: 'fog' } } } },
      { time: '2026-10-17T16:00:00Z', data: { instant: { details: { air_temperature: 9 } }, next_1_hours: { summary: { symbol_code: 'fog' } } } },
      { time: '2026-10-17T23:00:00Z', data: { instant: { details: { air_temperature: 3 } } } }
    ] } }
    expect(longitudeOffsetMinutes(10.75)).toBe(60)
    expect(longitudeOffsetMinutes(-122.4)).toBe(-480)
    const days = parseMetNorwayDaily(json, localClock(undefined, longitudeOffsetMinutes(10.75)))
    expect(days).toEqual([{ date: '2026-10-17', highCelsius: 9, lowCelsius: 5, precipitationChance: null, condition: 'fog', description: 'Fog' }])
    expect(parseMetNorwayDaily({}, localClock(undefined, 0))).toEqual([])
  })

  test('wttr.in: three days, midday icon, highest rain or snow chance', () => {
    const hourly = (time: string, code: string, rain: string, snow = '0') => ({ time, weatherCode: code, chanceofrain: rain, chanceofsnow: snow })
    const days = parseWttrDaily({
      weather: [
        { date: '2026-10-17', maxtempC: '22', mintempC: '12', hourly: [hourly('0', '113', '0'), hourly('1200', '116', '20'), hourly('2100', '296', '65')] },
        { date: '2026-10-18', maxtempC: '18', mintempC: '10', hourly: [hourly('900', '338', '0', '90'), hourly('1500', '119', '0')] },
        { date: '2026-10-19', maxtempC: '25', mintempC: '14', hourly: [] },
        { date: '2026-10-20', maxtempC: '25', mintempC: '14', hourly: [] }
      ]
    })
    expect(days).toEqual([
      { date: '2026-10-17', highCelsius: 22, lowCelsius: 12, precipitationChance: 65, condition: 'partly', description: 'Partly cloudy' },
      { date: '2026-10-18', highCelsius: 18, lowCelsius: 10, precipitationChance: 90, condition: 'cloudy', description: 'Cloudy' },
      { date: '2026-10-19', highCelsius: 25, lowCelsius: 14, precipitationChance: null, condition: 'cloudy', description: 'Cloudy' }
    ])
    expect(parseWttrDaily({ weather: [{ date: 'soon', maxtempC: '1', mintempC: '0' }] })).toEqual([])
  })

  test('OpenWeather: 3-hour steps grouped by the city’s local day, at most 5 days', () => {
    const offset = 11 * 3600 // Melbourne, AEDT
    const start = Date.UTC(2026, 9, 17, 3) / 1000 // 14:00 local on the 17th
    const list = Array.from({ length: 40 }, (_, i) => {
      const dt = start + i * 3 * 3600
      const localHour = new Date((dt + offset) * 1000).getUTCHours()
      return { dt, main: { temp: 10 + (i % 8), temp_min: 9 + (i % 8), temp_max: 11 + (i % 8) }, weather: [{ id: localHour === 11 ? 500 : 803 }], pop: i === 3 ? 0.55 : 0.1 }
    })
    const days = parseOpenWeatherForecast({ list, city: { timezone: offset } })
    expect(days).toHaveLength(5)
    expect(days.map((day) => day.date)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'])
    // The 17th local: steps 0–3 (14:00, 17:00, 20:00, 23:00); pop 55 % on step 3; no midday step, so the nearest (14:00) gives the icon.
    expect(days[0]).toMatchObject({ highCelsius: 14, lowCelsius: 9, precipitationChance: 55, condition: 'cloudy' })
    // Full days: 8 steps each, the 11:00 step (rain) is nearest midday.
    expect(days[1]).toMatchObject({ highCelsius: 18, lowCelsius: 9, precipitationChance: 10, condition: 'rain' })
    expect(parseOpenWeatherForecast({ cod: '401' })).toEqual([])
  })
})

describe('what the New Tab shows', () => {
  const days = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map((date) => ({ date, highCelsius: 20, lowCelsius: 10, precipitationChance: 0, condition: 'clear' as const, description: 'Clear' }))

  test('days from the place’s today, clamped to the view and the provider', () => {
    const five = visibleForecast('days5', 'open-meteo', days, '2026-10-17')
    expect(five.days.map((day) => day.date)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'])
    expect([five.requested, five.limit, five.capped]).toEqual([5, 7, false])
    const wttr = visibleForecast('days7', 'wttr', days, '2026-10-17')
    expect([wttr.days.length, wttr.limit, wttr.capped]).toEqual([3, 3, true])
    expect(visibleForecast('days7', 'openweathermap', days).days).toHaveLength(5)
    expect(visibleForecast('today', 'met-norway', days, '2026-10-17').days.map((day) => day.date)).toEqual(['2026-10-17'])
    expect(visibleForecast('current', 'open-meteo', days).days).toEqual([])
    expect(visibleForecast('days3', 'open-meteo', undefined).days).toEqual([])
  })

  test('labels: “Today” in the locale’s words, then short weekdays', () => {
    expect(forecastDayLabel('2026-10-17', '2026-10-17', 0, 'en-US')).toBe('Today')
    expect(forecastDayLabel('2026-10-18', '2026-10-17', 1, 'en-US')).toBe('Sun')
    expect(forecastDayLabel('2026-10-19', undefined, 2, 'en-US')).toBe('Mon')
    expect(forecastDayLabel('2026-10-17', undefined, 0, 'en-US')).toBe('Today')
    expect(forecastDayLabel('2026-10-17', '2026-10-17', 0, 'fr')).toBe('Aujourd’hui')
    expect(forecastDayLabel('2026-10-19', '2026-10-17', 2, 'de')).toMatch(/^Mo\.?$/)
  })

  test('place today and short temperatures', () => {
    const at = Date.UTC(2026, 9, 16, 14) // 01:00 on the 17th in Melbourne, still the 16th in London
    expect(placeToday('Australia/Melbourne', at)).toBe('2026-10-17')
    expect(placeToday('Europe/London', at)).toBe('2026-10-16')
    expect(placeToday(undefined, at)).toBeUndefined()
    expect(formatTemperatureShort(21.6, 'celsius')).toBe('22°')
    expect(formatTemperatureShort(21.6, 'fahrenheit')).toBe('71°')
  })
})
