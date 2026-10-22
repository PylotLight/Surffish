import { describe, expect, test } from "bun:test";
import {
  classifyWeatherFetchError,
  describeMetSymbol,
  formatTemperature,
  isOpenMeteoModelId,
  isProviderSideFailure,
  isWeatherProviderId,
  openMeteoModelLabel,
  normalizeWeatherPlace,
  parseGeocodingResults,
  parseIpLocation,
  parseMetNorway,
  parseOpenMeteoCurrent,
  parseOpenWeatherMap,
  parseWttr,
  weatherCacheKey,
  weatherErrorMessage,
  weatherPlaceLabel,
} from "./weather";

describe("weather places", () => {
  test("geocoding results become deduplicated places with region and country", () => {
    const places = parseGeocodingResults({
      results: [
        {
          name: "Melbourne",
          admin1: "Victoria",
          country: "Australia",
          country_code: "au",
          latitude: -37.814,
          longitude: 144.96332,
          timezone: "Australia/Melbourne",
        },
        {
          name: "Melbourne",
          admin1: "Victoria",
          country: "Australia",
          country_code: "AU",
          latitude: -37.8141,
          longitude: 144.9633,
        },
        {
          name: "Melbourne",
          admin1: "Florida",
          country: "United States",
          latitude: 28.08363,
          longitude: -80.60811,
        },
        { name: "Broken", latitude: "x", longitude: 1 },
        "junk",
      ],
    });
    expect(places.map(weatherPlaceLabel)).toEqual([
      "Melbourne, Victoria, Australia",
      "Melbourne, Florida, United States",
    ]);
    expect(places[0]).toEqual({
      name: "Melbourne",
      region: "Victoria",
      country: "Australia",
      countryCode: "AU",
      latitude: -37.814,
      longitude: 144.9633,
      timeZone: "Australia/Melbourne",
    });
    expect(parseGeocodingResults({})).toEqual([]);
    expect(
      parseGeocodingResults(
        {
          results: Array.from({ length: 20 }, (_, i) => ({
            name: `C${i}`,
            latitude: i,
            longitude: i,
          })),
        },
        5,
      ),
    ).toHaveLength(5);
  });

  test("labels collapse repeated parts and places reject bad coordinates", () => {
    expect(
      weatherPlaceLabel({
        name: "Singapore",
        region: "Singapore",
        country: "Singapore",
      }),
    ).toBe("Singapore");
    expect(
      normalizeWeatherPlace({ name: "X", latitude: 91, longitude: 0 }),
    ).toBeNull();
    expect(
      normalizeWeatherPlace({ name: "", latitude: 1, longitude: 0 }),
    ).toBeNull();
    expect(
      normalizeWeatherPlace({
        name: "Y",
        latitude: "45.84",
        longitude: "-119.7",
      }),
    ).toEqual({ name: "Y", latitude: 45.84, longitude: -119.7 });
  });

  test("IP location (geojs) becomes an approximate place", () => {
    expect(
      parseIpLocation({
        city: "Boardman",
        region: "Oregon",
        country: "United States",
        country_code: "US",
        latitude: "45.8401",
        longitude: "-119.705",
        timezone: "America/Los_Angeles",
      }),
    ).toEqual({
      name: "Boardman",
      region: "Oregon",
      country: "United States",
      countryCode: "US",
      latitude: 45.8401,
      longitude: -119.705,
      timeZone: "America/Los_Angeles",
    });
    expect(parseIpLocation({ country: "Nowhere" })).toBeNull();
  });

  test("cache key is per provider and coordinates", () => {
    const place = { name: "A", latitude: 1.23456, longitude: 2 };
    expect(weatherCacheKey("open-meteo", place)).not.toBe(
      weatherCacheKey("met-norway", place),
    );
    expect(weatherCacheKey("open-meteo", place)).not.toBe(
      weatherCacheKey("open-meteo", { ...place, latitude: 1.3 }),
    );
  });
});

describe("weather providers", () => {
  test("provider ids", () => {
    expect(isWeatherProviderId("wttr")).toBe(true);
    expect(isWeatherProviderId("darksky")).toBe(false);
  });

  test("Open-Meteo current", () => {
    expect(
      parseOpenMeteoCurrent({
        current: { temperature_2m: 15.3, weather_code: 2 },
      }),
    ).toEqual({ temperatureCelsius: 15.3, description: "Partly cloudy" });
    expect(
      parseOpenMeteoCurrent({ current: { temperature_2m: 15.3 } }),
    ).toBeNull();
  });

  test("MET Norway compact", () => {
    const json = {
      properties: {
        timeseries: [
          {
            data: {
              instant: { details: { air_temperature: 15.3 } },
              next_1_hours: { summary: { symbol_code: "partlycloudy_night" } },
            },
          },
        ],
      },
    };
    expect(parseMetNorway(json)).toEqual({
      temperatureCelsius: 15.3,
      description: "Partly cloudy",
    });
    expect(describeMetSymbol("lightrainshowersandthunder_day")).toBe(
      "Light showers and thunder",
    );
    expect(describeMetSymbol("heavysnow")).toBe("Heavy snow");
    expect(describeMetSymbol("mystery_day")).toBe("Current conditions");
    expect(parseMetNorway({ properties: { timeseries: [] } })).toBeNull();
  });

  test("wttr.in j1", () => {
    expect(
      parseWttr({
        current_condition: [
          { temp_C: "16", weatherDesc: [{ value: "Cloudy " }] },
        ],
      }),
    ).toEqual({ temperatureCelsius: 16, description: "Cloudy" });
    expect(parseWttr({ current_condition: [] })).toBeNull();
  });

  test("OpenWeather current weather", () => {
    expect(
      parseOpenWeatherMap({
        main: { temp: 9.5 },
        weather: [{ description: "light rain" }],
      }),
    ).toEqual({ temperatureCelsius: 9.5, description: "Light rain" });
    expect(parseOpenWeatherMap({ cod: 401 })).toBeNull();
  });

  test("friendly errors", () => {
    expect(weatherErrorMessage("openweathermap", { status: 401 })).toMatch(
      /API key/,
    );
    expect(weatherErrorMessage("wttr", { timeout: true })).toMatch(
      /wttr.in didn’t answer/,
    );
    expect(weatherErrorMessage("met-norway", { status: 503 })).toMatch(
      /MET Norway is having trouble/,
    );
    expect(weatherErrorMessage("open-meteo", { offline: true })).toMatch(
      /Can’t reach Open-Meteo/,
    );
  });

  test("temperature units", () => {
    expect(formatTemperature(15.3, "celsius")).toBe("15°C");
    expect(formatTemperature(15.3, "fahrenheit")).toBe("60°F");
  });
});

describe("Open-Meteo models", () => {
  test("model ids, labels and cache keys", () => {
    expect(isOpenMeteoModelId("bom_access_global")).toBe(true);
    expect(isOpenMeteoModelId("best_match")).toBe(true);
    expect(isOpenMeteoModelId("bom_access")).toBe(false);
    expect(openMeteoModelLabel("bom_access_global")).toBe("BOM ACCESS-G");
    const place = { name: "Melbourne", latitude: -37.814, longitude: 144.9633 };
    // Best match keeps the key it had before models existed; another model gets its own entry.
    expect(weatherCacheKey("open-meteo", place, "best_match")).toBe(
      weatherCacheKey("open-meteo", place),
    );
    expect(weatherCacheKey("open-meteo", place, "bom_access_global")).not.toBe(
      weatherCacheKey("open-meteo", place),
    );
    expect(weatherCacheKey("met-norway", place, "bom_access_global")).toBe(
      weatherCacheKey("met-norway", place),
    );
  });

  test("a model with no data (BOM delivery paused) is no reading, not 0°", () => {
    expect(
      parseOpenMeteoCurrent({
        current: {
          time: "2026-10-17T00:00",
          temperature_2m: null,
          weather_code: null,
        },
      }),
    ).toBeNull();
    expect(
      parseOpenMeteoCurrent({
        current: { temperature_2m: 14.1, weather_code: null },
      }),
    ).toBeNull();
    expect(
      parseOpenMeteoCurrent({
        current: { temperature_2m: 0, weather_code: 3 },
      }),
    ).toEqual({ temperatureCelsius: 0, description: "Overcast" });
  });
});

describe("weather network errors", () => {
  const chromium = (code: string) => new Error(`net::${code}`);
  const undici = (code: string, message = "getaddrinfo failed") =>
    Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error(message), { code }),
    });

  test("Chromium net::ERR_* codes", () => {
    expect(
      classifyWeatherFetchError(chromium("ERR_NAME_NOT_RESOLVED")),
    ).toMatchObject({ kind: "dns", code: "ERR_NAME_NOT_RESOLVED" });
    expect(
      classifyWeatherFetchError(chromium("ERR_INTERNET_DISCONNECTED")).kind,
    ).toBe("offline");
    expect(
      classifyWeatherFetchError(chromium("ERR_CONNECTION_TIMED_OUT")).kind,
    ).toBe("timeout");
    expect(
      classifyWeatherFetchError(chromium("ERR_CERT_AUTHORITY_INVALID")).kind,
    ).toBe("tls");
    expect(
      classifyWeatherFetchError(chromium("ERR_SSL_PROTOCOL_ERROR")).kind,
    ).toBe("tls");
    expect(
      classifyWeatherFetchError(chromium("ERR_SOCKS_CONNECTION_FAILED")).kind,
    ).toBe("proxy");
    expect(
      classifyWeatherFetchError(chromium("ERR_PROXY_CONNECTION_FAILED")).kind,
    ).toBe("proxy");
    expect(
      classifyWeatherFetchError(chromium("ERR_TUNNEL_CONNECTION_FAILED")).kind,
    ).toBe("proxy");
    expect(
      classifyWeatherFetchError(chromium("ERR_BLOCKED_BY_CLIENT")).kind,
    ).toBe("blocked");
    expect(
      classifyWeatherFetchError(chromium("ERR_CONNECTION_RESET")).kind,
    ).toBe("connection");
    expect(
      classifyWeatherFetchError(chromium("ERR_ADDRESS_UNREACHABLE")),
    ).toMatchObject({ kind: "network", code: "ERR_ADDRESS_UNREACHABLE" });
  });

  test("Node/undici codes in the cause chain", () => {
    expect(classifyWeatherFetchError(undici("ENOTFOUND"))).toMatchObject({
      kind: "dns",
      code: "ENOTFOUND",
    });
    expect(
      classifyWeatherFetchError(undici("UND_ERR_CONNECT_TIMEOUT")).kind,
    ).toBe("timeout");
    expect(
      classifyWeatherFetchError(undici("UNABLE_TO_GET_ISSUER_CERT_LOCALLY"))
        .kind,
    ).toBe("tls");
    expect(classifyWeatherFetchError(undici("ECONNREFUSED")).kind).toBe(
      "connection",
    );
    const detail = classifyWeatherFetchError(
      undici("ENOTFOUND", "getaddrinfo ENOTFOUND api.open-meteo.com"),
    ).detail;
    expect(detail).toContain("fetch failed");
    expect(detail).toContain("getaddrinfo ENOTFOUND api.open-meteo.com");
  });

  test("aborts and timeouts", () => {
    expect(
      classifyWeatherFetchError(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      ),
    ).toMatchObject({ kind: "timeout", code: "TimeoutError" });
    expect(
      classifyWeatherFetchError(new DOMException("aborted", "AbortError")).kind,
    ).toBe("timeout");
    expect(classifyWeatherFetchError("weird")).toMatchObject({
      kind: "network",
      detail: "weird",
    });
  });

  test('messages only say "Can’t reach" for plain network failures, and name the code', () => {
    const message = (code: string) =>
      weatherErrorMessage("open-meteo", {
        network: classifyWeatherFetchError(new Error(`net::${code}`)),
      });
    expect(message("ERR_NAME_NOT_RESOLVED")).toBe(
      "Couldn’t look up Open-Meteo’s server (ERR_NAME_NOT_RESOLVED). Check your DNS or VPN.",
    );
    expect(message("ERR_CERT_AUTHORITY_INVALID")).toMatch(
      /secure connection to Open-Meteo \(ERR_CERT_AUTHORITY_INVALID\)/,
    );
    expect(message("ERR_SOCKS_CONNECTION_FAILED")).toMatch(
      /through your proxy/,
    );
    expect(message("ERR_BLOCKED_BY_CLIENT")).toMatch(/was blocked/);
    expect(message("ERR_TIMED_OUT")).toMatch(/didn’t answer in time/);
    expect(message("ERR_INTERNET_DISCONNECTED")).toMatch(/You’re offline/);
    expect(message("ERR_ADDRESS_UNREACHABLE")).toBe(
      "Can’t reach Open-Meteo (ERR_ADDRESS_UNREACHABLE). Check your connection.",
    );
    for (const code of [
      "ERR_NAME_NOT_RESOLVED",
      "ERR_CERT_DATE_INVALID",
      "ERR_PROXY_CONNECTION_FAILED",
      "ERR_BLOCKED_BY_CLIENT",
      "ERR_TIMED_OUT",
    ])
      expect(message(code)).not.toMatch(/Can’t reach/);
    expect(weatherErrorMessage("open-meteo", { status: 429 })).toBe(
      "Open-Meteo is rate-limiting requests. Trying again later.",
    );
    expect(weatherErrorMessage("open-meteo", { status: 502 })).toMatch(
      /having trouble \(HTTP 502\)/,
    );
  });

  test("only provider-side failures fall back to the other keyless provider", () => {
    expect(isProviderSideFailure({ status: 429 })).toBe(true);
    expect(isProviderSideFailure({ status: 503 })).toBe(true);
    expect(isProviderSideFailure({ status: 404 })).toBe(false);
    expect(isProviderSideFailure({ unreadable: true })).toBe(true);
    expect(
      isProviderSideFailure({
        network: classifyWeatherFetchError(new Error("net::ERR_TIMED_OUT")),
      }),
    ).toBe(true);
    expect(
      isProviderSideFailure({
        network: classifyWeatherFetchError(
          new Error("net::ERR_NAME_NOT_RESOLVED"),
        ),
      }),
    ).toBe(false);
    expect(
      isProviderSideFailure({
        network: classifyWeatherFetchError(
          new Error("net::ERR_SOCKS_CONNECTION_FAILED"),
        ),
      }),
    ).toBe(false);
    expect(isProviderSideFailure({})).toBe(false);
  });
});
