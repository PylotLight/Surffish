import { app, safeStorage } from "electron";
import type {
  NewTabWeatherSnapshot,
  OpenMeteoModelId,
  WeatherKeyStatus,
  WeatherPlace,
  WeatherProviderId,
  WeatherResult,
} from "../shared/types";
import {
  classifyWeatherFetchError,
  DEFAULT_OPEN_METEO_MODEL,
  DEFAULT_WEATHER_PROVIDER,
  isOpenMeteoModelId,
  isProviderSideFailure,
  isWeatherProviderId,
  MAX_WEATHER_API_KEY_LENGTH,
  normalizeWeatherPlace,
  openMeteoModelLabel,
  parseGeocodingResults,
  parseIpLocation,
  parseMetNorway,
  parseOpenMeteoCurrent,
  parseOpenWeatherMap,
  parseWttr,
  WEATHER_CACHE_MS,
  weatherCacheKey,
  weatherErrorMessage,
  weatherPlaceLabel,
  weatherProviderLabel,
  type WeatherNetworkFailure,
} from "../shared/weather";
import {
  conditionFromDescription,
  localClock,
  longitudeOffsetMinutes,
  parseMetNorwayDaily,
  parseOpenMeteoDaily,
  parseOpenWeatherForecast,
  parseWttrDaily,
  type WeatherDay,
} from "../shared/weather-forecast";
import { backgroundNetworkBlockedReason } from "./background-network";
import { getBrowserSession } from "./browser-session";
import { readUserJson, writeUserJson } from "./user-json";

/**
 * New Tab weather. Every provider is asked by coordinates; Open-Meteo's keyless geocoder powers the
 * city search. Readings are cached 10 min per provider (+ Open-Meteo model) + place.
 *
 * Daily forecast rows ride on the same request where the provider allows it (Open-Meteo `daily=`,
 * MET Norway's timeseries, wttr.in's three days); OpenWeather's free 5-day/3-hour forecast is one
 * extra request, made in parallel and only while a forecast view is on. A cached reading without
 * daily rows is refetched once when a forecast view asks for them; otherwise the 10 min cache holds.
 *
 * Requests go through the browser session's Chromium network stack (`session.fetch`), like feeds,
 * page watchers and the New Tab photos: the user's SOCKS proxy / network rules, the system proxy +
 * PAC (when no Surffish proxy is set), Chromium's DNS and the proxy kill switch all apply. Node's
 * global fetch (undici) ignores all of that, which is how a proxy/VPN user got "Can't reach
 * Open-Meteo" while the same URL loaded fine in a tab. Smokes stand in a fake via
 * `globalThis.__surffishWeatherFetch` (looked up per call), so CI never touches the network.
 */

type WeatherFetch = (url: string, init: RequestInit) => Promise<Response>;

interface CachedWeather {
  expiresAt: number;
  value: NewTabWeatherSnapshot;
  /** Fetched with daily rows (a forecast view was on). */
  withDaily: boolean;
}

const weatherCache = new Map<string, CachedWeather>();
const legacyPlaces = new Map<string, WeatherPlace>();
const KEYS_FILE = "weather-keys.json";
const REQUEST_TIMEOUT_MS = 8_000;

interface WeatherFailure {
  status?: number;
  network?: WeatherNetworkFailure;
  unreadable?: boolean;
  /** The proxy kill switch stopped it before it left. */
  guard?: boolean;
}

/** A failed provider request: the friendly message plus what kind of failure it was (decides fallbacks). */
class WeatherRequestError extends Error {
  readonly failure: WeatherFailure;
  constructor(message: string, failure: WeatherFailure) {
    super(message);
    this.failure = failure;
  }
}

function userAgent(): string {
  // MET Norway's terms require an identifying User-Agent with a contact.
  return `Surffish/${app.getVersion()} (+https://github.com/PylotLight/Surffish)`;
}

function weatherFetch(): WeatherFetch {
  const hook = (globalThis as { __surffishWeatherFetch?: unknown })
    .__surffishWeatherFetch;
  return typeof hook === "function"
    ? (hook as WeatherFetch)
    : (url, init) => getBrowserSession().fetch(url, init);
}

/** Host + path only: OpenWeather puts the API key in the query. */
function logUrl(url: URL): string {
  return `${url.host}${url.pathname}`;
}

async function getJson(
  url: URL,
  provider: WeatherProviderId,
): Promise<unknown> {
  const blocked = backgroundNetworkBlockedReason();
  if (blocked)
    throw new WeatherRequestError(
      `Weather paused: ${blocked.replace(/^The /, "the ")}`,
      { guard: true },
    );
  let response: Response;
  try {
    response = await weatherFetch()(url.href, {
      headers: { Accept: "application/json", "User-Agent": userAgent() },
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const network = classifyWeatherFetchError(error);
    console.warn(
      `[weather] ${logUrl(url)} request failed (${network.kind}): ${network.detail}`,
    );
    throw new WeatherRequestError(weatherErrorMessage(provider, { network }), {
      network,
    });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn(
      `[weather] ${logUrl(url)} answered HTTP ${response.status}: ${body.replace(/\s+/g, " ").slice(0, 200)}`,
    );
    throw new WeatherRequestError(
      weatherErrorMessage(provider, { status: response.status }),
      { status: response.status },
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    console.warn(
      `[weather] ${logUrl(url)} sent unreadable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new WeatherRequestError(weatherErrorMessage(provider, {}), {
      unreadable: true,
    });
  }
}

/** City search for the New Tab settings (type-ahead suggestions). */
export async function searchWeatherPlaces(
  queryInput: string,
): Promise<WeatherPlace[]> {
  const query = queryInput.trim().slice(0, 100);
  if (query.length < 2) return [];
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: query,
    count: "8",
    language: "en",
    format: "json",
  }).toString();
  return parseGeocodingResults(await getJson(url, "open-meteo"));
}

/** "Use my approximate location": an IP lookup (get.geojs.io, keyless). City-level at best. */
export async function locateWeatherPlace(): Promise<WeatherPlace> {
  let json: unknown;
  try {
    json = await getJson(
      new URL("https://get.geojs.io/v1/ip/geo.json"),
      "open-meteo",
    );
  } catch (error) {
    const failure = error instanceof WeatherRequestError ? error.failure : null;
    if (failure?.guard) throw error;
    const reason =
      failure?.network?.code ??
      (failure?.status ? `HTTP ${failure.status}` : "");
    throw new Error(
      `Couldn’t look up your approximate location${reason ? ` (${reason})` : ""}. Search for your city instead.`,
      { cause: error },
    );
  }
  const place = parseIpLocation(json);
  if (!place)
    throw new Error(
      "Couldn’t work out your approximate location. Search for your city instead.",
    );
  return place;
}

async function resolveLegacyLocation(location: string): Promise<WeatherPlace> {
  const key = location.toLocaleLowerCase();
  const known = legacyPlaces.get(key);
  if (known) return known;
  const [place] = await searchWeatherPlaces(location);
  if (!place)
    throw new Error(
      `Could not find “${location}”. Search for your city in New Tab settings.`,
    );
  legacyPlaces.set(key, place);
  return place;
}

async function readKeys(): Promise<Partial<Record<WeatherProviderId, string>>> {
  const saved = readUserJson(KEYS_FILE);
  if (typeof saved !== "object" || saved === null) return {};
  const keys: Partial<Record<WeatherProviderId, string>> = {};
  for (const [provider, entry] of Object.entries(
    saved as Record<string, unknown>,
  )) {
    if (
      !isWeatherProviderId(provider) ||
      typeof entry !== "object" ||
      entry === null
    )
      continue;
    const { value, encrypted } = entry as {
      value?: unknown;
      encrypted?: unknown;
    };
    if (typeof value !== "string") continue;
    try {
      keys[provider] =
        encrypted === true
          ? (await safeStorage.decryptStringAsync(Buffer.from(value, "base64")))
              .result
          : value;
    } catch {
      // The OS keychain changed (new machine, reset profile): the key is gone, ask for it again.
    }
  }
  return keys;
}

export async function getWeatherKeyStatus(): Promise<WeatherKeyStatus> {
  return { openweathermap: Boolean((await readKeys()).openweathermap) };
}

/** Saves (or with an empty value, removes) a provider's API key: OS-encrypted when available, 0600 either way. */
export async function setWeatherApiKey(
  provider: unknown,
  keyInput: unknown,
): Promise<WeatherKeyStatus> {
  if (provider !== "openweathermap")
    throw new Error("Only OpenWeather takes an API key.");
  const key = typeof keyInput === "string" ? keyInput.trim() : "";
  if (key.length > MAX_WEATHER_API_KEY_LENGTH || /[^\w-]/.test(key))
    throw new Error("That doesn’t look like an OpenWeather API key.");
  const saved = (readUserJson(KEYS_FILE) ?? {}) as Record<string, unknown>;
  if (!key) delete saved[provider];
  else if (await safeStorage.isAsyncEncryptionAvailable())
    saved[provider] = {
      value: (await safeStorage.encryptStringAsync(key)).toString("base64"),
      encrypted: true,
    };
  else saved[provider] = { value: key, encrypted: false };
  writeUserJson(KEYS_FILE, saved);
  for (const cacheKey of weatherCache.keys())
    if (cacheKey.startsWith(`${provider}|`)) weatherCache.delete(cacheKey);
  return getWeatherKeyStatus();
}

type Reading = Pick<
  NewTabWeatherSnapshot,
  "temperatureCelsius" | "description" | "daily"
>;

async function readProvider(
  provider: WeatherProviderId,
  place: WeatherPlace,
  model: OpenMeteoModelId = DEFAULT_OPEN_METEO_MODEL,
  daily = false,
): Promise<Reading> {
  const lat = place.latitude.toFixed(4);
  const lon = place.longitude.toFixed(4);
  let url: URL;
  let parse: (json: unknown) => Reading | null;
  let parseDaily: ((json: unknown) => WeatherDay[]) | null = null;
  let dailyUrl: URL | null = null;
  if (provider === "met-norway") {
    // `complete` adds precipitation probability and 6-hour max/min (about twice the bytes): only for a forecast view.
    url = new URL(
      `https://api.met.no/weatherapi/locationforecast/2.0/${daily ? "complete" : "compact"}`,
    );
    url.search = new URLSearchParams({ lat, lon }).toString();
    parse = parseMetNorway;
    if (daily) {
      const clock = localClock(
        place.timeZone,
        longitudeOffsetMinutes(place.longitude),
      );
      parseDaily = (json) => parseMetNorwayDaily(json, clock);
    }
  } else if (provider === "wttr") {
    url = new URL(`https://wttr.in/${lat},${lon}`);
    url.search = new URLSearchParams({ format: "j1" }).toString();
    parse = parseWttr;
    if (daily) parseDaily = parseWttrDaily;
  } else if (provider === "openweathermap") {
    const key = (await readKeys()).openweathermap;
    if (!key)
      throw new Error(
        "Add your OpenWeather API key in New Tab settings, or pick a free provider.",
      );
    url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.search = new URLSearchParams({
      lat,
      lon,
      units: "metric",
      appid: key,
    }).toString();
    parse = parseOpenWeatherMap;
    if (daily) {
      dailyUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
      dailyUrl.search = url.search;
      parseDaily = parseOpenWeatherForecast;
    }
  } else {
    url = new URL("https://api.open-meteo.com/v1/forecast");
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: "temperature_2m,weather_code",
      timezone: "auto",
      forecast_days: daily ? "7" : "1",
    });
    if (daily) {
      params.set(
        "daily",
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      );
      parseDaily = parseOpenMeteoDaily;
    }
    if (model !== DEFAULT_OPEN_METEO_MODEL) params.set("models", model);
    url.search = params.toString();
    parse = parseOpenMeteoCurrent;
  }
  // OpenWeather's forecast is its own request: asked alongside the current one, never after it,
  // and its failure only costs the daily rows.
  const forecastUrl = dailyUrl;
  const [json, dailyJson] = await Promise.all([
    getJson(url, provider),
    forecastUrl
      ? getJson(forecastUrl, provider).catch((error: unknown) => {
          console.warn(
            `[weather] ${logUrl(forecastUrl)} forecast failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        })
      : Promise.resolve(undefined),
  ]);
  const reading = parse(json);
  if (!reading) {
    console.warn(
      `[weather] ${logUrl(url)}${provider === "open-meteo" ? ` (model ${model})` : ""} had no current reading`,
    );
    throw new WeatherRequestError(weatherErrorMessage(provider, {}), {
      unreadable: true,
    });
  }
  if (parseDaily) reading.daily = parseDaily(forecastUrl ? dailyJson : json);
  return reading;
}

type ProviderReading = Reading &
  Pick<NewTabWeatherSnapshot, "provider" | "model" | "notice">;

/** Open-Meteo with a chosen model. A model with no data (BOM delivery paused) or one Open-Meteo rejects falls back to best match, with a notice. */
async function readOpenMeteo(
  place: WeatherPlace,
  model: OpenMeteoModelId,
  daily: boolean,
): Promise<ProviderReading> {
  if (model === DEFAULT_OPEN_METEO_MODEL)
    return {
      ...(await readProvider("open-meteo", place, model, daily)),
      provider: "open-meteo",
      model,
    };
  try {
    return {
      ...(await readProvider("open-meteo", place, model, daily)),
      provider: "open-meteo",
      model,
    };
  } catch (error) {
    const failure = error instanceof WeatherRequestError ? error.failure : null;
    if (!failure || !(failure.unreadable || failure.status === 400))
      throw error;
    return {
      ...(await readProvider(
        "open-meteo",
        place,
        DEFAULT_OPEN_METEO_MODEL,
        daily,
      )),
      provider: "open-meteo",
      model: DEFAULT_OPEN_METEO_MODEL,
      notice: `${openMeteoModelLabel(model)} data unavailable, showing best match.`,
    };
  }
}

/** The other keyless provider to try when one is busy or broken (429, 5xx, timeout); never for offline/DNS/proxy/kill switch. */
const KEYLESS_FALLBACK: Partial<Record<WeatherProviderId, WeatherProviderId>> =
  { "open-meteo": "met-norway", "met-norway": "open-meteo" };

async function readWithFallback(
  provider: WeatherProviderId,
  place: WeatherPlace,
  model: OpenMeteoModelId,
  daily: boolean,
): Promise<ProviderReading> {
  try {
    if (provider === "open-meteo")
      return await readOpenMeteo(place, model, daily);
    return {
      ...(await readProvider(provider, place, DEFAULT_OPEN_METEO_MODEL, daily)),
      provider,
    };
  } catch (error) {
    const fallback = KEYLESS_FALLBACK[provider];
    if (
      !fallback ||
      !(error instanceof WeatherRequestError) ||
      !isProviderSideFailure(error.failure)
    )
      throw error;
    try {
      const reading = await readProvider(
        fallback,
        place,
        DEFAULT_OPEN_METEO_MODEL,
        daily,
      );
      return {
        ...reading,
        provider: fallback,
        notice: `${error.message.replace(/ Trying again later\.$/, "")} Showing ${weatherProviderLabel(fallback)}.`,
      };
    } catch (fallbackError) {
      console.warn(
        `[weather] fallback to ${weatherProviderLabel(fallback)} failed too: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
      );
      throw error;
    }
  }
}

export interface NewTabWeatherRequest {
  provider?: unknown;
  /** Open-Meteo model (ignored for other providers). */
  model?: unknown;
  place?: unknown;
  /** Settings saved before city search: free text, geocoded once (the renderer then saves the place). */
  location?: unknown;
  /** A forecast view is on: include daily rows. */
  daily?: unknown;
}

export async function getNewTabWeather(
  request: NewTabWeatherRequest | string,
): Promise<NewTabWeatherSnapshot> {
  const input = typeof request === "string" ? { location: request } : request;
  const provider = isWeatherProviderId(input.provider)
    ? input.provider
    : DEFAULT_WEATHER_PROVIDER;
  const model =
    provider === "open-meteo" && isOpenMeteoModelId(input.model)
      ? input.model
      : DEFAULT_OPEN_METEO_MODEL;
  const daily = input.daily === true;
  let place = normalizeWeatherPlace(input.place);
  if (!place) {
    const location =
      typeof input.location === "string"
        ? input.location.trim().slice(0, 100)
        : "";
    if (!location)
      throw new Error("Search for a city in New Tab settings to load weather.");
    place = await resolveLegacyLocation(location);
  }
  const cacheKey = weatherCacheKey(provider, place, model);
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && (cached.withDaily || !daily))
    return rendererCopy(cached.value, daily);
  const {
    notice,
    model: usedModel,
    daily: days,
    ...reading
  } = await readWithFallback(provider, place, model, daily);
  const value: NewTabWeatherSnapshot = {
    ...reading,
    condition: conditionFromDescription(reading.description),
    location: weatherPlaceLabel(place),
    place,
    fetchedAt: Date.now(),
  };
  if (days) value.daily = days;
  if (usedModel) value.model = usedModel;
  if (notice) value.notice = notice;
  weatherCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + WEATHER_CACHE_MS,
    withDaily: daily,
  });
  return rendererCopy(value, daily);
}

/** A copy for the renderer: daily rows only when asked (Current only keeps the IPC reply as small as before). */
function rendererCopy(
  value: NewTabWeatherSnapshot,
  daily: boolean,
): NewTabWeatherSnapshot {
  const { daily: days, ...rest } = value;
  const copy: NewTabWeatherSnapshot = { ...rest, place: { ...rest.place } };
  if (daily && days) copy.daily = days.map((day) => ({ ...day }));
  return copy;
}

/** IPC wrapper: an expected failure (offline, bad key, unknown city) comes back as `{ ok: false }` instead of a thrown, logged error. */
export async function weatherResult<T>(
  work: () => Promise<T>,
): Promise<WeatherResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
