/**
 * New Tab weather forecast: the Forecast setting, the weather size slider, per-provider day limits,
 * and the pure parsing of each provider's daily data (Open-Meteo daily block, MET Norway timeseries
 * → daily hi/lo, wttr.in's three days, OpenWeather 5-day/3-hour list → daily). Unit-tested; the
 * network calls stay in main (main/new-tab-weather.ts).
 */
import type { WeatherProviderId } from './types'

/** Forecast setting: today's look (current only), today's high/low, or 3/5/7 daily rows. */
export type WeatherForecastView = 'current' | 'today' | 'days3' | 'days5' | 'days7'
export const WEATHER_FORECAST_VIEWS: readonly WeatherForecastView[] = ['current', 'today', 'days3', 'days5', 'days7']
export const DEFAULT_WEATHER_FORECAST: WeatherForecastView = 'current'
export const isWeatherForecastView = (value: unknown): value is WeatherForecastView => WEATHER_FORECAST_VIEWS.includes(value as WeatherForecastView)
export const WEATHER_FORECAST_LABELS: Readonly<Record<WeatherForecastView, string>> = { current: 'Current only', today: 'Today', days3: '3 days', days5: '5 days', days7: '7 days' }

/** Days of daily data a view needs (0 = no daily request at all, today's look). */
export function forecastDayCount(view: WeatherForecastView): number {
  return view === 'today' ? 1 : view === 'days3' ? 3 : view === 'days5' ? 5 : view === 'days7' ? 7 : 0
}

/** Weather size slider: percent on top of the gentle clock-following scale; 100 is the original look. */
export const MIN_WEATHER_SCALE = 50
export const MAX_WEATHER_SCALE = 250
export const WEATHER_SCALE_STEP = 5
export const DEFAULT_WEATHER_SCALE = 100

/** A stored weather size: a number in range, on a 5 % step; anything else is 100. */
export function clampWeatherScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WEATHER_SCALE
  const bounded = Math.min(MAX_WEATHER_SCALE, Math.max(MIN_WEATHER_SCALE, value))
  return Math.min(MAX_WEATHER_SCALE, Math.max(MIN_WEATHER_SCALE, Math.round(bounded / WEATHER_SCALE_STEP) * WEATHER_SCALE_STEP))
}

/**
 * How far a forecast too tall for the window shrinks (its "fit", 0.5–1 in 0.05 steps): what it
 * would need at full size (`height / currentFit`, since everything in it scales with the fit) against
 * the `available` px. 1 when it fits; never below half (the icon track scrolls past that, as before).
 */
export function weatherFit(available: number, height: number, currentFit: number): number {
  const natural = height / (currentFit > 0 ? currentFit : 1)
  if (!(natural > 0) || !Number.isFinite(available)) return 1
  return Math.min(1, Math.max(0.5, Math.floor((available / natural) * 20 + 1e-6) / 20))
}

/**
 * Daily days each provider can give (today included). wttr.in's JSON has 3; OpenWeather's free
 * forecast is 5 days of 3-hour steps; Open-Meteo goes to 16 and MET Norway ~9, both capped at 7.
 */
export const WEATHER_PROVIDER_DAY_LIMITS: Readonly<Record<WeatherProviderId, number>> = { 'open-meteo': 7, 'met-norway': 7, wttr: 3, openweathermap: 5 }
export const MAX_FORECAST_DAYS = 7

/** Icon family for a reading or a day. */
export type WeatherCondition = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'sleet' | 'snow' | 'thunder'

export interface WeatherDay {
  /** The place's local calendar date, YYYY-MM-DD. */
  date: string
  highCelsius: number
  lowCelsius: number
  /** 0–100, or null when the provider doesn't give one (some Open-Meteo models). */
  precipitationChance: number | null
  condition: WeatherCondition
  description: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function chance(value: number | null): number | null {
  return value === null ? null : Math.round(Math.min(100, Math.max(0, value)))
}

/** WMO weather code (Open-Meteo) → icon family. */
export function wmoCondition(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code === 1 || code === 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if (code === 66 || code === 67) return 'sleet'
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'thunder'
  return 'cloudy'
}

/** MET Norway symbol_code ("lightrainshowers_day") → icon family. */
export function metSymbolCondition(symbol: string): WeatherCondition {
  const base = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (base.includes('thunder')) return 'thunder'
  if (base.includes('sleet')) return 'sleet'
  if (base.includes('snow')) return 'snow'
  if (base.includes('rain')) return base.startsWith('light') ? 'drizzle' : 'rain'
  if (base === 'fog') return 'fog'
  if (base === 'cloudy') return 'cloudy'
  if (base === 'partlycloudy' || base === 'fair') return 'partly'
  if (base === 'clearsky') return 'clear'
  return 'cloudy'
}

/** wttr.in (WorldWeatherOnline) weatherCode → icon family. */
export function wttrCondition(code: number): WeatherCondition {
  if (code === 113) return 'clear'
  if (code === 116) return 'partly'
  if (code === 119 || code === 122) return 'cloudy'
  if ([143, 248, 260].includes(code)) return 'fog'
  if ([200, 386, 389, 392, 395].includes(code)) return 'thunder'
  if ([263, 266, 281, 284, 185].includes(code)) return 'drizzle'
  if ([179, 182, 311, 314, 317, 320, 350, 362, 365, 374, 377].includes(code)) return 'sleet'
  if ([227, 230, 323, 326, 329, 332, 335, 338, 368, 371].includes(code)) return 'snow'
  if ([176, 293, 296, 299, 302, 305, 308, 353, 356, 359].includes(code)) return 'rain'
  return 'cloudy'
}

/** OpenWeather condition id → icon family. */
export function openWeatherCondition(id: number): WeatherCondition {
  if (id >= 200 && id < 300) return 'thunder'
  if (id >= 300 && id < 400) return 'drizzle'
  if (id === 511 || (id >= 611 && id <= 616)) return 'sleet'
  if (id >= 500 && id < 600) return 'rain'
  if (id >= 600 && id < 700) return 'snow'
  if (id >= 700 && id < 800) return 'fog'
  if (id === 800) return 'clear'
  if (id === 801 || id === 802) return 'partly'
  return 'cloudy'
}

/** A current reading's description ("Partly cloudy", "Light rain showers") → icon family, for every provider. */
export function conditionFromDescription(description: string): WeatherCondition {
  const text = description.toLowerCase()
  if (/thunder/.test(text)) return 'thunder'
  if (/sleet|freezing|ice pellets/.test(text)) return 'sleet'
  if (/snow|blizzard/.test(text)) return 'snow'
  if (/drizzle|light rain|light shower/.test(text)) return 'drizzle'
  if (/rain|shower/.test(text)) return 'rain'
  if (/fog|mist|haze|smoke/.test(text)) return 'fog'
  if (/partly|few clouds|scattered|mainly clear|fair/.test(text)) return 'partly'
  if (/clear|sunny/.test(text)) return 'clear'
  return 'cloudy'
}

const DESCRIPTIONS: Readonly<Record<WeatherCondition, string>> = {
  clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog', drizzle: 'Light rain', rain: 'Rain', sleet: 'Sleet', snow: 'Snow', thunder: 'Thunderstorms'
}
export const describeCondition = (condition: WeatherCondition): string => DESCRIPTIONS[condition]

/** Open-Meteo `daily` block (weather_code, temperature_2m_max/min, precipitation_probability_max), dates already local. */
export function parseOpenMeteoDaily(json: unknown): WeatherDay[] {
  const daily = isRecord(json) && isRecord(json.daily) ? json.daily : null
  const times = Array.isArray(daily?.time) ? daily.time : []
  const column = (key: string): unknown[] => (daily && Array.isArray(daily[key]) ? daily[key] as unknown[] : [])
  const codes = column('weather_code')
  const highs = column('temperature_2m_max')
  const lows = column('temperature_2m_min')
  const rain = column('precipitation_probability_max')
  const days: WeatherDay[] = []
  times.forEach((date, index) => {
    const high = finite(highs[index])
    const low = finite(lows[index])
    if (typeof date !== 'string' || !ISO_DATE.test(date) || high === null || low === null) return
    const code = finite(codes[index])
    const condition = code === null ? 'cloudy' : wmoCondition(code)
    days.push({ date, highCelsius: high, lowCelsius: low, precipitationChance: chance(finite(rain[index])), condition, description: describeCondition(condition) })
  })
  return days.slice(0, MAX_FORECAST_DAYS)
}

/** Local calendar date + hour of a UTC timestamp, in a place's zone (or at a fixed offset). */
export type LocalClock = (time: number) => { date: string; hour: number }
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

/** A LocalClock for an IANA `timeZone`, or `offsetMinutes` from UTC when there is none (or it's unknown). */
export function localClock(timeZone: string | undefined, offsetMinutes: number): LocalClock {
  if (timeZone) {
    try {
      let format = zoneFormatters.get(timeZone)
      if (!format) {
        format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
        zoneFormatters.set(timeZone, format)
      }
      const zoned = format
      return (time) => {
        const parts: Record<string, string> = {}
        for (const part of zoned.formatToParts(time)) parts[part.type] = part.value
        return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 }
      }
    } catch {
      // Unknown zone: fall through to the offset.
    }
  }
  return (time) => {
    const shifted = new Date(time + offsetMinutes * 60_000)
    return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() }
  }
}

/** Rough UTC offset from longitude (15° per hour), for places saved without a time zone. */
export const longitudeOffsetMinutes = (longitude: number): number => Math.round(longitude / 15) * 60

interface DayBucket {
  high: number
  low: number
  points: number
  chance: number | null
  symbol: { distance: number; value: string } | null
}

function bucket(map: Map<string, DayBucket>, date: string): DayBucket {
  let entry = map.get(date)
  if (!entry) {
    entry = { high: -Infinity, low: Infinity, points: 0, chance: null, symbol: null }
    map.set(date, entry)
  }
  return entry
}

function summarySymbol(block: unknown): string | undefined {
  return isRecord(block) && isRecord(block.summary) && typeof block.summary.symbol_code === 'string' ? block.summary.symbol_code : undefined
}

/**
 * MET Norway locationforecast (compact or complete) → daily rows: hi/lo from the instant
 * temperatures plus each 6-hour block's max/min (complete), the symbol nearest local midday, and the
 * highest precipitation probability (complete only; compact has none → null). Days are the place's
 * local dates; a trailing day with too few readings (the series' last timestamp) is dropped.
 */
export function parseMetNorwayDaily(json: unknown, clock: LocalClock): WeatherDay[] {
  const series = isRecord(json) && isRecord(json.properties) && Array.isArray(json.properties.timeseries) ? json.properties.timeseries : []
  const days = new Map<string, DayBucket>()
  for (const entry of series) {
    if (!isRecord(entry) || typeof entry.time !== 'string' || !isRecord(entry.data)) continue
    const time = Date.parse(entry.time)
    if (!Number.isFinite(time)) continue
    const { date, hour } = clock(time)
    const data = entry.data
    const instant = isRecord(data.instant) && isRecord(data.instant.details) ? finite(data.instant.details.air_temperature) : null
    const day = bucket(days, date)
    if (instant !== null) {
      day.high = Math.max(day.high, instant)
      day.low = Math.min(day.low, instant)
      day.points += 1
    }
    const six = isRecord(data.next_6_hours) && isRecord(data.next_6_hours.details) ? data.next_6_hours.details : null
    const sixMax = finite(six?.air_temperature_max)
    const sixMin = finite(six?.air_temperature_min)
    if (sixMax !== null && sixMin !== null) {
      const middle = bucket(days, clock(time + 3 * 3_600_000).date)
      middle.high = Math.max(middle.high, sixMax)
      middle.low = Math.min(middle.low, sixMin)
    }
    for (const block of [data.next_1_hours, data.next_6_hours]) {
      const probability = isRecord(block) && isRecord(block.details) ? finite(block.details.probability_of_precipitation) : null
      if (probability !== null) day.chance = Math.max(day.chance ?? 0, probability)
    }
    const sixSymbol = summarySymbol(data.next_6_hours)
    const symbol = sixSymbol ?? summarySymbol(data.next_1_hours) ?? summarySymbol(data.next_12_hours)
    // The day's icon: the forecast for the hours around midday (a 6-hour block starting about 9).
    const distance = Math.abs(hour - (sixSymbol ? 9 : 12))
    if (symbol && (!day.symbol || distance < day.symbol.distance)) day.symbol = { distance, value: symbol }
  }
  const rows: WeatherDay[] = []
  let first = true
  for (const [date, day] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!Number.isFinite(day.high) || !Number.isFinite(day.low)) continue
    // The first day can be a late-evening sliver; later days need more than the series' last stamp.
    if (!first && day.points < 2) continue
    first = false
    const condition = day.symbol ? metSymbolCondition(day.symbol.value) : 'cloudy'
    rows.push({ date, highCelsius: day.high, lowCelsius: day.low, precipitationChance: chance(day.chance), condition, description: describeCondition(condition) })
  }
  return rows.slice(0, MAX_FORECAST_DAYS)
}

/** wttr.in `?format=j1` → its three days (local dates; the icon is the midday hour's). */
export function parseWttrDaily(json: unknown): WeatherDay[] {
  const weather = isRecord(json) && Array.isArray(json.weather) ? json.weather : []
  const days: WeatherDay[] = []
  for (const entry of weather) {
    if (!isRecord(entry) || typeof entry.date !== 'string' || !ISO_DATE.test(entry.date)) continue
    const high = finite(entry.maxtempC)
    const low = finite(entry.mintempC)
    if (high === null || low === null) continue
    const hourly = Array.isArray(entry.hourly) ? entry.hourly.filter(isRecord) : []
    const midday = hourly.find((hour) => String(hour.time) === '1200') ?? hourly[Math.floor(hourly.length / 2)]
    const code = finite(midday?.weatherCode)
    const condition = code === null ? 'cloudy' : wttrCondition(code)
    const chances = hourly.flatMap((hour) => [finite(hour.chanceofrain), finite(hour.chanceofsnow)]).filter((value): value is number => value !== null)
    days.push({ date: entry.date, highCelsius: high, lowCelsius: low, precipitationChance: chances.length ? chance(Math.max(...chances)) : null, condition, description: describeCondition(condition) })
  }
  return days.slice(0, WEATHER_PROVIDER_DAY_LIMITS.wttr)
}

/** OpenWeather free 5-day / 3-hour forecast → up to 5 local days (hi/lo from each step's min/max, highest pop, the step nearest midday). */
export function parseOpenWeatherForecast(json: unknown): WeatherDay[] {
  const list = isRecord(json) && Array.isArray(json.list) ? json.list : []
  const offsetSeconds = isRecord(json) && isRecord(json.city) ? finite(json.city.timezone) ?? 0 : 0
  const clock = localClock(undefined, offsetSeconds / 60)
  const days = new Map<string, DayBucket & { code: number | null }>()
  for (const step of list) {
    if (!isRecord(step)) continue
    const dt = finite(step.dt)
    const main = isRecord(step.main) ? step.main : null
    const temp = finite(main?.temp)
    const high = finite(main?.temp_max) ?? temp
    const low = finite(main?.temp_min) ?? temp
    if (dt === null || high === null || low === null) continue
    const { date, hour } = clock(dt * 1000)
    let day = days.get(date)
    if (!day) {
      day = { high: -Infinity, low: Infinity, points: 0, chance: null, symbol: null, code: null }
      days.set(date, day)
    }
    day.high = Math.max(day.high, high)
    day.low = Math.min(day.low, low)
    day.points += 1
    const pop = finite(step.pop)
    if (pop !== null) day.chance = Math.max(day.chance ?? 0, pop * 100)
    const weather = Array.isArray(step.weather) ? step.weather.find(isRecord) : undefined
    const id = finite(weather?.id)
    const distance = Math.abs(hour - 12)
    if (id !== null && (!day.symbol || distance < day.symbol.distance)) {
      day.symbol = { distance, value: String(id) }
      day.code = id
    }
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, WEATHER_PROVIDER_DAY_LIMITS.openweathermap).map(([date, day]) => {
    const condition = day.code === null ? 'cloudy' : openWeatherCondition(day.code)
    return { date, highCelsius: day.high, lowCelsius: day.low, precipitationChance: chance(day.chance), condition, description: describeCondition(condition) }
  })
}

export interface VisibleForecast {
  days: WeatherDay[]
  /** Days the view asked for. */
  requested: number
  /** What the provider that answered can give at most. */
  limit: number
  /** The view asks for more days than the provider has (e.g. 7 days on wttr.in → 3). */
  capped: boolean
}

/**
 * The rows a view shows: from the place's today (when its zone is known, so a stale snapshot never
 * shows yesterday), at most the view's count and the provider's limit.
 */
export function visibleForecast(view: WeatherForecastView, provider: WeatherProviderId, days: readonly WeatherDay[] | undefined, today?: string): VisibleForecast {
  const requested = forecastDayCount(view)
  const limit = WEATHER_PROVIDER_DAY_LIMITS[provider]
  const fromToday = (days ?? []).filter((day) => !today || day.date >= today)
  return { days: fromToday.slice(0, Math.min(requested, limit)), requested, limit, capped: requested > limit }
}

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>()
/** "Today" (in the locale's words) for the place's today, otherwise the short weekday ("Mon", "lun."). */
export function forecastDayLabel(date: string, today: string | undefined, index: number, locale?: string): string {
  if (date === today || (!today && index === 0)) {
    try {
      const word = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'day')
      return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1)
    } catch {
      return 'Today'
    }
  }
  const key = locale ?? ''
  let format = weekdayFormatters.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
    weekdayFormatters.set(key, format)
  }
  return format.format(new Date(`${date}T12:00:00Z`))
}

/** Today's date (YYYY-MM-DD) in the place's zone, or undefined when the place has no zone. */
export function placeToday(timeZone: string | undefined, now = Date.now()): string | undefined {
  if (!timeZone) return undefined
  try {
    return localClock(timeZone, 0)(now).date
  } catch {
    return undefined
  }
}

/** "18°" (hi/lo cells: the unit is on the current reading). */
export function formatTemperatureShort(celsius: number, unit: 'celsius' | 'fahrenheit'): string {
  return `${Math.round(unit === 'fahrenheit' ? celsius * 9 / 5 + 32 : celsius)}°`
}
