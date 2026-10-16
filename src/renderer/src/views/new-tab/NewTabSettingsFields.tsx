import { useEffect, useState } from 'react'
import type { NewTabPageId, NewTabPreferences, NewTabWeatherSnapshot, OpenMeteoModelId, WeatherKeyStatus, WeatherProviderId, WorldClockPreference } from '../../../../shared/types'
import { MAX_ICON_VERTICAL_POSITION, MAX_WORLD_CLOCKS, MIN_ICON_VERTICAL_POSITION } from '../../../../shared/persistence'
import { formatTemperature, OPEN_METEO_MODELS, WEATHER_PROVIDERS, weatherPlaceLabel, weatherProviderLabel } from '../../../../shared/weather'
import { WORLD_CITIES } from '../../../../shared/world-cities'
import { CLOCK_DATE_FORMATS, formatClockDate, usesTwelveHour, type ClockDateFormat, type ClockSize, type ClockTimeFormat, type ClockWeight } from '../../../../shared/new-tab-clock'
import { SettingsGroup, SettingsRow, SettingsSegmented, SettingsSlider } from '../settings/SettingsControls'
import TimeZonePicker from '../TimeZonePicker'
import WeatherCitySearch from './WeatherCitySearch'

const COMMON_TIME_ZONES = [
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland', 'Asia/Kolkata', 'Asia/Tokyo', 'Asia/Singapore',
  'Europe/London', 'Europe/Paris', 'Europe/Bratislava', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'UTC'
]
const TIME_FORMAT_OPTIONS: ReadonlyArray<{ value: ClockTimeFormat; label: string }> = [{ value: 'auto', label: 'Auto' }, { value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]
const CLOCK_SIZE_OPTIONS: ReadonlyArray<{ value: ClockSize; label: string }> = [{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }, { value: 'xl', label: 'XL' }]
const CLOCK_WEIGHT_OPTIONS: ReadonlyArray<{ value: ClockWeight; label: string }> = [{ value: 'light', label: 'Light' }, { value: 'regular', label: 'Regular' }, { value: 'bold', label: 'Bold' }]
let timeZoneOptions: string[] | null = null
function allTimeZones(): string[] {
  timeZoneOptions ??= Array.from(new Set([...COMMON_TIME_ZONES, ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []), 'UTC']))
  return timeZoneOptions
}

function timeZoneCityName(timeZone: string): string {
  return timeZone.split('/').at(-1)?.replaceAll('_', ' ') || timeZone
}

function ipcMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export interface NewTabWeatherState {
  snapshot: NewTabWeatherSnapshot | null
  error: string
  loading: boolean
}

export interface NewTabSettingsFieldsProps {
  preferences: NewTabPreferences
  onPatch: (patch: Partial<NewTabPreferences>) => void
  newTabPage: NewTabPageId
  onNewTabPageChange: (page: NewTabPageId) => void
  weather: NewTabWeatherState
  /** 'page': Settings → New Tab. 'panel': the Customize panel on the New Tab itself. */
  variant: 'page' | 'panel'
  /** Settings page only: open the New Tab with the Customize panel. */
  onCustomizeOnNewTab?: () => void
  /** An API key was saved or removed: reload the weather now. */
  onWeatherKeyChange: () => void
}

function OpenWeatherKeyRow({ onKeyChange }: { onKeyChange: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<WeatherKeyStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  useEffect(() => {
    let live = true
    void window.api.browser.newTabWeather.keys().then((next) => { if (live) setStatus(next) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  const save = (key: string): void => {
    void window.api.browser.newTabWeather.setKey('openweathermap', key).then((reply) => {
      if (!reply.ok) { setMessage({ text: reply.error, error: true }); return }
      setStatus(reply.value)
      setDraft('')
      setMessage({ text: key ? 'Key saved on this device.' : 'Key removed.', error: false })
      onKeyChange()
    }).catch((caught: unknown) => setMessage({ text: ipcMessage(caught), error: true }))
  }
  return (
    <>
      <SettingsRow label="API key" hint={status?.openweathermap ? 'Saved on this device (encrypted when the OS keychain is available).' : 'Free at openweathermap.org; new keys can take an hour to start working.'}>
        <form className="weather-key-form" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) save(draft.trim()) }}>
          <input type="password" className="settings-input" value={draft} maxLength={128} autoComplete="off" spellCheck={false} placeholder={status?.openweathermap ? '•••••••• saved' : 'Paste key'} onChange={(event) => setDraft(event.target.value)} aria-label="OpenWeather API key" />
          <button className="settings-action secondary" type="submit" disabled={!draft.trim()}>Save</button>
          {status?.openweathermap && <button className="settings-action secondary" type="button" onClick={() => save('')}>Remove</button>}
        </form>
      </SettingsRow>
      {message && <p className={`settings-message${message.error ? ' is-error' : ''}`} role="status">{message.text}</p>}
    </>
  )
}

/**
 * Every New Tab setting, shared by Settings → New Tab and the Customize panel on the New Tab page,
 * so both edit the same preferences object (one source of truth) and stay in sync.
 */
export default function NewTabSettingsFields({ preferences, onPatch, newTabPage, onNewTabPageChange, weather, variant, onCustomizeOnNewTab, onWeatherKeyChange }: NewTabSettingsFieldsProps): React.JSX.Element {
  const provider = WEATHER_PROVIDERS.find((entry) => entry.id === preferences.weatherProvider) ?? WEATHER_PROVIDERS[0]!
  const openMeteoModel = OPEN_METEO_MODELS.find((entry) => entry.id === preferences.openMeteoModel) ?? OPEN_METEO_MODELS[0]!
  const placeLabel = preferences.weatherPlace ? weatherPlaceLabel(preferences.weatherPlace) : preferences.weatherLocation
  const timeZones = allTimeZones()
  const twelveAuto = usesTwelveHour('auto')
  const twelveHour = usesTwelveHour(preferences.timeFormat)
  const sampleDate = new Date()
  return (
    <>
      <SettingsGroup title="Page">
        <SettingsRow label="New tab opens" hint="Applies to tabs opened from now on.">
          <select className="settings-select" value={newTabPage} onChange={(event) => onNewTabPageChange(event.target.value as NewTabPageId)} aria-label="Default new tab page">
            <option value="quick-links">Surffish New Tab</option>
            <option value="bonjourr">Bonjourr (online)</option>
            <option value="search">Search engine</option>
          </select>
        </SettingsRow>
        {variant === 'page' && newTabPage === 'quick-links' && <p className="settings-help">Favorites reuse pinned sites, frequent sites come from local history, and site icons and Wikimedia Commons photos are cached locally. No browsing data is sent.</p>}
        {variant === 'page' && onCustomizeOnNewTab && (
          <div className="settings-actions new-tab-customize-link">
            <p className="settings-help">See changes live: the gear at the bottom right of the New Tab opens these settings beside it.</p>
            <button className="settings-action secondary" type="button" onClick={onCustomizeOnNewTab}>Customize on New Tab</button>
          </div>
        )}
      </SettingsGroup>
      <SettingsGroup title="Layout">
        <SettingsRow label="Show site names"><input type="checkbox" className="settings-switch" checked={preferences.showLinkLabels} onChange={(event) => onPatch({ showLinkLabels: event.target.checked })} aria-label="Show site names under icons" /></SettingsRow>
        <SettingsSlider label="Icon size" value={preferences.iconSize} unit="px" min={20} max={52} onChange={(iconSize) => onPatch({ iconSize })} />
        <SettingsSlider label="Links per row" value={preferences.linksPerRow} min={3} max={12} onChange={(linksPerRow) => onPatch({ linksPerRow })} />
        <SettingsSlider label="Vertical position" value={preferences.iconVerticalPosition} unit="%" min={MIN_ICON_VERTICAL_POSITION} max={MAX_ICON_VERTICAL_POSITION} onChange={(iconVerticalPosition) => onPatch({ iconVerticalPosition })} />
      </SettingsGroup>
      <SettingsGroup title="Background">
        <SettingsSlider label="Dim" value={preferences.backgroundDim} unit="%" min={0} max={70} onChange={(backgroundDim) => onPatch({ backgroundDim })} />
        <SettingsSlider label="Blur" value={preferences.backgroundBlur} unit="px" min={0} max={12} onChange={(backgroundBlur) => onPatch({ backgroundBlur })} />
      </SettingsGroup>
      <SettingsGroup title="Clock">
        <SettingsRow label="Show clock"><input type="checkbox" className="settings-switch" checked={preferences.showClock} onChange={(event) => onPatch({ showClock: event.target.checked })} aria-label="Show local clock" /></SettingsRow>
        <SettingsRow label="Time format" hint={`Auto follows your system: ${twelveAuto ? '12-hour' : '24-hour'} here. World clocks use it too.`}>
          <SettingsSegmented value={preferences.timeFormat} ariaLabel="Time format" options={TIME_FORMAT_OPTIONS} onChange={(timeFormat) => onPatch({ timeFormat })} />
        </SettingsRow>
        <SettingsRow label="Show AM/PM" hint="12-hour clocks only.">
          <input type="checkbox" className="settings-switch" checked={preferences.showAmPm} disabled={!twelveHour} onChange={(event) => onPatch({ showAmPm: event.target.checked })} aria-label="Show AM/PM" />
        </SettingsRow>
        <SettingsRow label="Show seconds" hint="The page updates every second while on; otherwise once a minute."><input type="checkbox" className="settings-switch" checked={preferences.showSeconds} onChange={(event) => onPatch({ showSeconds: event.target.checked })} aria-label="Show seconds" /></SettingsRow>
        <SettingsRow label="Show date"><input type="checkbox" className="settings-switch" checked={preferences.showDate} onChange={(event) => onPatch({ showDate: event.target.checked })} aria-label="Show date" /></SettingsRow>
        <SettingsRow label="Date format">
          <select className="settings-select" value={preferences.dateFormat} disabled={!preferences.showDate} onChange={(event) => onPatch({ dateFormat: event.target.value as ClockDateFormat })} aria-label="Date format">
            {CLOCK_DATE_FORMATS.map((format) => <option key={format} value={format}>{formatClockDate(sampleDate, 'local', format)}{format === 'iso' ? ' (ISO)' : ''}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow label="Clock size">
          <SettingsSegmented value={preferences.clockSize} ariaLabel="Clock size" options={CLOCK_SIZE_OPTIONS} onChange={(clockSize) => onPatch({ clockSize })} />
        </SettingsRow>
        <SettingsRow label="Clock weight">
          <SettingsSegmented value={preferences.clockWeight} ariaLabel="Clock weight" options={CLOCK_WEIGHT_OPTIONS} onChange={(clockWeight) => onPatch({ clockWeight })} />
        </SettingsRow>
        <SettingsRow label="Monospaced digits" hint="Every digit is the same width, so the time doesn't shift as it changes."><input type="checkbox" className="settings-switch" checked={preferences.clockTabularDigits} onChange={(event) => onPatch({ clockTabularDigits: event.target.checked })} aria-label="Monospaced digits" /></SettingsRow>
        <SettingsRow label="Greeting" hint="“Good morning”, “Good afternoon” or “Good evening” above the clocks."><input type="checkbox" className="settings-switch" checked={preferences.showGreeting} onChange={(event) => onPatch({ showGreeting: event.target.checked })} aria-label="Show greeting" /></SettingsRow>
        <SettingsRow label="Time zone">
          <select className="settings-select" value={preferences.timeZone} onChange={(event) => onPatch({ timeZone: event.target.value })} aria-label="Primary New Tab time zone">
            <option value="local">Automatic · device time</option>
            {Array.from(new Set([...timeZones, ...(preferences.timeZone === 'local' ? [] : [preferences.timeZone])])).map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
          </select>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        title="World clocks"
        status={`${preferences.worldClocks.length} of ${MAX_WORLD_CLOCKS}`}
        aside={<button className="settings-action secondary" type="button" disabled={preferences.worldClocks.length >= MAX_WORLD_CLOCKS} onClick={() => {
          const usedTimeZones = new Set([
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(preferences.timeZone === 'local' ? [] : [preferences.timeZone]),
            ...preferences.worldClocks.map((item) => item.timeZone)
          ])
          const timeZone = timeZones.find((zone) => !usedTimeZones.has(zone)) ?? 'UTC'
          const clock: WorldClockPreference = { id: `${Date.now()}-${Math.floor(Math.random() * 10_000)}`, label: timeZoneCityName(timeZone), timeZone }
          onPatch({ worldClocks: [...preferences.worldClocks, clock] })
        }}>+ Add clock</button>}
      >
        <SettingsRow label="Time difference" hint="“+2h” from the main clock."><input type="checkbox" className="settings-switch" checked={preferences.worldClockShowDifference} onChange={(event) => onPatch({ worldClockShowDifference: event.target.checked })} aria-label="Show world clock time difference" /></SettingsRow>
        <SettingsRow label="Day when different" hint="“Tomorrow” or “Yesterday” when it's another day there."><input type="checkbox" className="settings-switch" checked={preferences.worldClockShowDay} onChange={(event) => onPatch({ worldClockShowDay: event.target.checked })} aria-label="Show world clock day" /></SettingsRow>
        {preferences.worldClocks.length === 0 && <p className="settings-help">No world clocks yet.</p>}
        {preferences.worldClocks.map((clock, index) => (
          <div className="new-tab-world-clock-editor" key={clock.id}>
            <input type="text" maxLength={40} value={clock.label} aria-label={`World clock ${index + 1} city name`} onChange={(event) => onPatch({ worldClocks: preferences.worldClocks.map((item) => item.id === clock.id ? { ...item, label: event.target.value } : item) })} />
            <TimeZonePicker
              value={clock.timeZone}
              label={clock.label}
              ariaLabel={`World clock ${index + 1} city or time zone`}
              onSelect={(result) => onPatch({
                worldClocks: preferences.worldClocks.map((item) => {
                  if (item.id !== clock.id) return item
                  const autoLabels = new Set([timeZoneCityName(item.timeZone), ...WORLD_CITIES.filter((city) => city.timeZone === item.timeZone).map((city) => city.city)])
                  const keepLabel = item.label.trim() !== '' && !autoLabels.has(item.label.trim())
                  return { ...item, timeZone: result.timeZone, label: keepLabel ? item.label : result.city.slice(0, 40) }
                })
              })}
            />
            <button className="settings-icon-action" type="button" aria-label={`Remove ${clock.label} world clock`} title="Remove" onClick={() => onPatch({ worldClocks: preferences.worldClocks.filter((item) => item.id !== clock.id) })}>×</button>
          </div>
        ))}
      </SettingsGroup>
      <SettingsGroup
        title="Weather"
        status={`Only the place’s coordinates are sent to ${provider.label}`}
        aside={<input type="checkbox" className="settings-switch" checked={preferences.weatherEnabled} onChange={(event) => onPatch({ weatherEnabled: event.target.checked })} aria-label="Show weather" />}
      >
        <SettingsRow label="City" hint="Search and pick a place; its coordinates are saved.">
          <WeatherCitySearch
            value={placeLabel}
            current={preferences.weatherPlace}
            disabled={!preferences.weatherEnabled}
            onSelect={(place) => onPatch({ weatherPlace: place, weatherLocation: weatherPlaceLabel(place).slice(0, 100) })}
          />
        </SettingsRow>
        <SettingsRow label="Provider" hint={provider.hint}>
          <select className="settings-select" value={provider.id} disabled={!preferences.weatherEnabled} onChange={(event) => onPatch({ weatherProvider: event.target.value as WeatherProviderId })} aria-label="Weather provider">
            {WEATHER_PROVIDERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}{entry.needsKey ? ' (API key)' : ''}</option>)}
          </select>
        </SettingsRow>
        {provider.id === 'open-meteo' && (
          <SettingsRow label="Forecast model" hint={openMeteoModel.hint}>
            <select className="settings-select" value={openMeteoModel.id} disabled={!preferences.weatherEnabled} onChange={(event) => onPatch({ openMeteoModel: event.target.value as OpenMeteoModelId })} aria-label="Open-Meteo forecast model">
              {OPEN_METEO_MODELS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </SettingsRow>
        )}
        {provider.needsKey && preferences.weatherEnabled && <OpenWeatherKeyRow onKeyChange={onWeatherKeyChange} />}
        <SettingsRow label="Units">
          <SettingsSegmented value={preferences.temperatureUnit} options={[{ value: 'celsius', label: '°C' }, { value: 'fahrenheit', label: '°F' }] as const} ariaLabel="Weather temperature unit" disabled={!preferences.weatherEnabled} onChange={(temperatureUnit) => onPatch({ temperatureUnit })} />
        </SettingsRow>
        {preferences.weatherEnabled && placeLabel && (
          <p className={`settings-message weather-preview${weather.error ? ' is-error' : ''}`} role="status" aria-label="Weather preview">
            {weather.error ? weather.error
              : weather.snapshot ? `${formatTemperature(weather.snapshot.temperatureCelsius, preferences.temperatureUnit)} · ${weather.snapshot.description} · ${weatherProviderLabel(weather.snapshot.provider)}${weather.snapshot.notice ? ` · ${weather.snapshot.notice}` : ''}`
                : weather.loading ? 'Loading weather…' : 'Weather shows on the New Tab.'}
          </p>
        )}
      </SettingsGroup>
    </>
  )
}
