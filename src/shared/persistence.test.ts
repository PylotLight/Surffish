import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NEW_TAB_PAGE,
  DEFAULT_BROWSER_UI_FONT,
  isBrowserUiFont,
  DEFAULT_BROWSER_PROXY_SETTINGS,
  MAX_PINNED_SITES,
  MAX_RESTORED_TABS,
  DEFAULT_TAB_SLEEP_MINUTES,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  DEFAULT_NEW_TAB_PREFERENCES,
  MAX_WORLD_CLOCKS,
  normalizeBrowserSession,
  normalizeSessionUrl,
  normalizeFaviconUrl,
  normalizeCachedFaviconDataUrl,
  MAX_CACHED_FAVICON_BYTES,
  normalizePinnedSites,
  parseBrowserProxySettings,
  parseBrowserPreferences,
  parseNewTabPreferences,
  parseBrowserSession,
} from "./persistence.ts";
import { SURFFISH_QUICK_LINKS_URL } from "./navigation.ts";

test("normalizes a saved tab list and retains its selected tab", () => {
  assert.deepEqual(
    normalizeBrowserSession(["https://one.test/", "https://two.test/"], 1),
    {
      urls: ["https://one.test/", "https://two.test/"],
      activeIndex: 1,
      pinnedIndexes: [],
    },
  );
});

test("redacts credential-like session URL parts while preserving ordinary query parameters", () => {
  const input =
    "https://example.test/search?q=blue+fish&page=2&access_token=one&ACCESS-TOKEN=two&code=oauth-code&state=csrf#private-fragment";
  assert.equal(
    normalizeSessionUrl(input),
    "https://example.test/search?q=blue+fish&page=2",
  );
  assert.deepEqual(normalizeBrowserSession([input], 0), {
    urls: ["https://example.test/search?q=blue+fish&page=2"],
    activeIndex: 0,
    pinnedIndexes: [],
  });
  assert.equal(
    normalizeSessionUrl(
      "https://example.test/?filter=recent&sort=title#anchor",
    ),
    "https://example.test/?filter=recent&sort=title",
  );
  assert.equal(
    normalizeSessionUrl("https://example.test/?apiKey=a&api_key=b&sessionId=c"),
    "https://example.test/",
  );
});

test("drops unsafe URLs and adjusts the selected index", () => {
  assert.deepEqual(
    normalizeBrowserSession(["file:///etc/passwd", "https://safe.test/"], 1),
    {
      urls: ["https://safe.test/"],
      activeIndex: 0,
      pinnedIndexes: [],
    },
  );
});

test("preserves the internal Quick Links tab while still rejecting other non-web URLs", () => {
  assert.deepEqual(
    normalizeBrowserSession(
      [SURFFISH_QUICK_LINKS_URL, "file:///etc/passwd", "https://safe.test/"],
      0,
    ),
    {
      urls: [SURFFISH_QUICK_LINKS_URL, "https://safe.test/"],
      activeIndex: 0,
      pinnedIndexes: [],
    },
  );
});

test("restores pinned tabs by normalized session position and accepts older sessions without pins", () => {
  assert.deepEqual(
    normalizeBrowserSession(
      ["file:///ignored", "https://one.test/", "https://two.test/"],
      2,
      [0, 2, -1],
    ),
    {
      urls: ["https://one.test/", "https://two.test/"],
      activeIndex: 1,
      pinnedIndexes: [1],
    },
  );
  assert.deepEqual(
    parseBrowserSession({
      version: 1,
      tabs: ["https://one.test/"],
      activeIndex: 0,
    }),
    {
      urls: ["https://one.test/"],
      activeIndex: 0,
      pinnedIndexes: [],
    },
  );
  assert.deepEqual(
    parseBrowserSession({
      version: 1,
      tabs: ["https://one.test/", "https://two.test/"],
      activeIndex: 0,
      pinnedTabs: [1, "0", -1],
    }).pinnedIndexes,
    [1],
  );
});

test("rejects invalid session data and bounds restored tab count", () => {
  const urls = Array.from(
    { length: MAX_RESTORED_TABS + 5 },
    (_, index) => `https://site${index}.test/`,
  );
  const parsed = parseBrowserSession({
    version: 1,
    tabs: urls,
    activeIndex: MAX_RESTORED_TABS + 3,
  });
  assert.equal(parsed.urls.length, MAX_RESTORED_TABS);
  assert.equal(parsed.activeIndex, 0);
  assert.deepEqual(
    parseBrowserSession({ version: 2, tabs: ["https://ignored.test/"] }),
    { urls: [], activeIndex: 0, pinnedIndexes: [] },
  );
});

test("defaults UI font for new and older preference files and round-trips Maple Mono", () => {
  assert.equal(DEFAULT_BROWSER_UI_FONT, "system");
  assert.equal(parseBrowserPreferences(null).uiFont, "system");
  assert.equal(
    parseBrowserPreferences({ version: 1, searchEngine: "google" }).uiFont,
    "system",
  );
  assert.equal(
    parseBrowserPreferences({ version: 1, uiFont: "maple-mono" }).uiFont,
    "maple-mono",
  );
  assert.equal(isBrowserUiFont("system"), true);
  assert.equal(isBrowserUiFont("maple-mono"), true);
});

test("defaults invalid UI font preference values to system", () => {
  for (const uiFont of ["maple", "Comic Sans", "", null, 5, {}, undefined]) {
    assert.equal(
      parseBrowserPreferences({ version: 1, uiFont }).uiFont,
      "system",
    );
    assert.equal(isBrowserUiFont(uiFont), false);
  }
});

test("falls back to the default search engine for invalid preferences", () => {
  assert.equal(
    parseBrowserPreferences({ version: 1, searchEngine: "google" })
      .searchEngine,
    "google",
  );
  assert.equal(
    parseBrowserPreferences({ version: 1, searchEngine: "unknown" })
      .searchEngine,
    "brave",
  );
});

test("defaults fresh profiles to direct browsing while preserving valid saved SOCKS choices", () => {
  assert.deepEqual(DEFAULT_BROWSER_PROXY_SETTINGS, {
    enabled: false,
    host: "127.0.0.1",
    port: 1080,
    bypassLocalNetwork: true,
  });
  assert.deepEqual(
    parseBrowserProxySettings(null),
    DEFAULT_BROWSER_PROXY_SETTINGS,
  );
  assert.deepEqual(
    parseBrowserProxySettings({ enabled: true, host: "localhost", port: 1080 }),
    {
      enabled: true,
      host: "localhost",
      port: 1080,
      bypassLocalNetwork: true,
    },
  );
  // The local-network bypass defaults on for older files and keeps an explicit off.
  assert.equal(
    parseBrowserProxySettings({
      enabled: true,
      host: "127.0.0.1",
      port: 1080,
      bypassLocalNetwork: false,
    }).bypassLocalNetwork,
    false,
  );
  assert.deepEqual(
    parseBrowserProxySettings({
      enabled: true,
      host: "proxy.example",
      port: 1080,
    }),
    DEFAULT_BROWSER_PROXY_SETTINGS,
  );
});

test("uses a validated default tab-sleep interval for new and older preferences", () => {
  assert.equal(
    parseBrowserPreferences(null).tabSleepMinutes,
    DEFAULT_TAB_SLEEP_MINUTES,
  );
  assert.equal(
    parseBrowserPreferences({ version: 1, searchEngine: "google" })
      .tabSleepMinutes,
    DEFAULT_TAB_SLEEP_MINUTES,
  );
  assert.equal(
    parseBrowserPreferences({
      version: 1,
      searchEngine: "google",
      tabSleepMinutes: 15,
    }).tabSleepMinutes,
    15,
  );
  assert.equal(
    parseBrowserPreferences({
      version: 1,
      searchEngine: "google",
      tabSleepMinutes: 10,
    }).tabSleepMinutes,
    DEFAULT_TAB_SLEEP_MINUTES,
  );
});

test("defaults older preference files to Quick Links without losing existing settings", () => {
  const parsed = parseBrowserPreferences({
    version: 1,
    searchEngine: "google",
    tabSleepMinutes: 15,
  });
  assert.equal(parsed.newTabPage, DEFAULT_NEW_TAB_PAGE);
  assert.equal(parsed.searchEngine, "google");
  assert.equal(parsed.tabSleepMinutes, 15);
  assert.deepEqual(parsed.pinnedSites, []);
  assert.equal(parsed.sidebarWidth, DEFAULT_SIDEBAR_WIDTH);
  assert.deepEqual(parsed.siteSettings, {});
  assert.deepEqual(parsed.siteZoom, {});
});

test("normalizes sidebar width to a rounded, usable range", () => {
  assert.equal(
    parseBrowserPreferences({ version: 1, sidebarWidth: 347.6 }).sidebarWidth,
    348,
  );
  assert.equal(
    parseBrowserPreferences({ version: 1, sidebarWidth: 80 }).sidebarWidth,
    MIN_SIDEBAR_WIDTH,
  );
  assert.equal(
    parseBrowserPreferences({ version: 1, sidebarWidth: 900 }).sidebarWidth,
    MAX_SIDEBAR_WIDTH,
  );
  assert.equal(
    parseBrowserPreferences({ version: 1, sidebarWidth: "wide" }).sidebarWidth,
    DEFAULT_SIDEBAR_WIDTH,
  );
});

test("normalizes pins and rejects unsafe, credential-bearing, duplicate, or excessive URLs", () => {
  const pins = normalizePinnedSites([
    { title: "  GitHub  ", url: "https://github.com" },
    { title: "duplicate", url: "https://github.com/" },
    { title: "javascript", url: "javascript:alert(1)" },
    { title: "credentials", url: "https://user:pass@example.test/" },
    ...Array.from({ length: MAX_PINNED_SITES + 2 }, (_, index) => ({
      title: `Site ${index}`,
      url: `https://site${index}.test/`,
    })),
  ]);
  assert.equal(pins.length, MAX_PINNED_SITES);
  assert.deepEqual(pins[0], { title: "GitHub", url: "https://github.com/" });
  assert.ok(pins.every((pin) => pin.url.startsWith("https://")));
});

test("persists only bounded, credential-free HTTP(S) favicon URLs on pins", () => {
  const pins = normalizePinnedSites([
    {
      title: "Example",
      url: "https://example.test/",
      faviconUrl: "https://assets.example.test/icon.svg",
    },
    {
      title: "Unsafe icon",
      url: "https://unsafe.test/",
      faviconUrl: "javascript:alert(1)",
    },
    {
      title: "Credential icon",
      url: "https://credentials.test/",
      faviconUrl: "https://user:pass@assets.example.test/icon.svg",
    },
    {
      title: "Data icon",
      url: "https://data.test/",
      faviconUrl: "data:image/png;base64,AAAA",
    },
  ]);
  assert.deepEqual(pins, [
    {
      title: "Example",
      url: "https://example.test/",
      faviconUrl: "https://assets.example.test/icon.svg",
    },
    { title: "Unsafe icon", url: "https://unsafe.test/" },
    { title: "Credential icon", url: "https://credentials.test/" },
    { title: "Data icon", url: "https://data.test/" },
  ]);
  assert.equal(
    normalizeFaviconUrl(`https://${"a".repeat(4_100)}.test/icon.png`),
    null,
  );
  assert.equal(
    normalizeFaviconUrl("http://assets.example.test/icon.ico"),
    "http://assets.example.test/icon.ico",
  );
});

test("accepts only small, base64-encoded image data URLs for the local favicon cache", () => {
  const icon = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(normalizeCachedFaviconDataUrl(icon), icon);
  assert.equal(
    normalizeCachedFaviconDataUrl("data:text/html;base64,PGgxPk5vPC9oMT4="),
    null,
  );
  assert.equal(normalizeCachedFaviconDataUrl("data:image/png,<svg/>"), null);
  assert.equal(
    normalizeCachedFaviconDataUrl("data:image/png;base64,AAAA="),
    null,
  );
  const tooLarge = `data:image/png;base64,${"A".repeat(Math.ceil((MAX_CACHED_FAVICON_BYTES * 4) / 3) + 4)}`;
  assert.equal(normalizeCachedFaviconDataUrl(tooLarge), null);
});

test("accepts only HTTP(S) site settings and defaults each site to blocking and denying permissions", () => {
  const parsed = parseBrowserPreferences({
    version: 1,
    newTabPage: "search",
    pinnedSites: [{ title: "", url: "https://example.test/path" }],
    siteSettings: {
      "https://example.test/path": {
        blockAds: false,
        allowMedia: true,
        allowNotifications: true,
      },
      "file:///private": { blockAds: false },
      "https://credential:secret@invalid.test/": { allowGeolocation: true },
    },
  });
  assert.equal(parsed.newTabPage, "search");
  assert.deepEqual(parsed.pinnedSites, [
    { title: "example.test", url: "https://example.test/path" },
  ]);
  assert.deepEqual(parsed.siteSettings["https://example.test"], {
    origin: "https://example.test",
    blockAds: false,
    openPopupsInTabs: false,
    allowMedia: true,
    allowGeolocation: false,
    allowNotifications: true,
    allowClipboardRead: false,
  });
  assert.equal(Object.keys(parsed.siteSettings).length, 1);
});

test("defaults New Tab clocks, weather, and icon display preferences safely", () => {
  const preferences = parseNewTabPreferences(null);
  assert.deepEqual(preferences, DEFAULT_NEW_TAB_PREFERENCES);
  assert.equal(preferences.showClock, true);
  assert.equal(preferences.weatherEnabled, false);
  assert.equal(preferences.timeZone, "local");
  assert.equal(preferences.iconVerticalPosition, 69);
  assert.equal(preferences.weatherProvider, "open-meteo");
  assert.equal(preferences.openMeteoModel, "best_match");
  assert.equal(preferences.weatherPlace, null);
});

test("clock display options: defaults keep the original look, use24HourTime migrates", () => {
  const fresh = parseNewTabPreferences({});
  assert.equal(fresh.timeFormat, "24h");
  assert.equal(fresh.showAmPm, true);
  assert.equal(fresh.dateFormat, "long");
  assert.equal(fresh.clockScale, 100);
  assert.equal(fresh.clockVerticalPosition, 0);
  assert.equal(fresh.clockWeight, "light");
  assert.equal(fresh.clockTabularDigits, true);
  assert.equal(fresh.showGreeting, false);
  assert.equal(fresh.worldClockShowDifference, false);
  assert.equal(fresh.worldClockShowDay, false);
  assert.equal(
    parseNewTabPreferences({ use24HourTime: false }).timeFormat,
    "12h",
  );
  assert.equal(
    parseNewTabPreferences({ use24HourTime: true }).timeFormat,
    "24h",
  );
  assert.equal(
    parseNewTabPreferences({ use24HourTime: false, timeFormat: "auto" })
      .timeFormat,
    "auto",
    "the new key wins",
  );
  assert.equal(
    "use24HourTime" in parseNewTabPreferences({ use24HourTime: false }),
    false,
    "the old key is dropped",
  );
  const bad = parseNewTabPreferences({
    timeFormat: "13h",
    dateFormat: "rfc",
    clockSize: "xxl",
    clockWeight: 900,
    showGreeting: "yes",
  });
  assert.equal(bad.timeFormat, "24h");
  assert.equal(bad.dateFormat, "long");
  assert.equal(bad.clockScale, 100);
  assert.equal(bad.clockWeight, "light");
  assert.equal(bad.showGreeting, false);
  const set = parseNewTabPreferences({
    timeFormat: "12h",
    showAmPm: false,
    dateFormat: "iso",
    clockScale: 180,
    clockVerticalPosition: 40,
    clockWeight: "bold",
    clockTabularDigits: false,
    showGreeting: true,
    worldClockShowDifference: true,
    worldClockShowDay: true,
  });
  assert.deepEqual(
    [
      set.timeFormat,
      set.showAmPm,
      set.dateFormat,
      set.clockScale,
      set.clockVerticalPosition,
      set.clockWeight,
      set.clockTabularDigits,
      set.showGreeting,
      set.worldClockShowDifference,
      set.worldClockShowDay,
    ],
    ["12h", false, "iso", 180, 40, "bold", false, true, true, true],
  );
});

test("clock size/position sliders: S/M/L/XL migrate, values are clamped and stepped", () => {
  assert.deepEqual(
    ["s", "m", "l", "xl"].map(
      (clockSize) => parseNewTabPreferences({ clockSize }).clockScale,
    ),
    [75, 100, 145, 220],
  );
  assert.equal(
    parseNewTabPreferences({ clockSize: "xl", clockScale: 120 }).clockScale,
    120,
    "the slider value wins",
  );
  assert.equal(
    "clockSize" in parseNewTabPreferences({ clockSize: "l" }),
    false,
    "the old key is dropped",
  );
  assert.equal(parseNewTabPreferences({ clockScale: 999 }).clockScale, 250);
  assert.equal(parseNewTabPreferences({ clockScale: 10 }).clockScale, 50);
  assert.equal(parseNewTabPreferences({ clockScale: 133 }).clockScale, 135);
  assert.equal(
    parseNewTabPreferences({ clockScale: Number.NaN }).clockScale,
    100,
  );
  assert.equal(
    parseNewTabPreferences({ clockVerticalPosition: 140 })
      .clockVerticalPosition,
    100,
  );
  assert.equal(
    parseNewTabPreferences({ clockVerticalPosition: -5 }).clockVerticalPosition,
    0,
  );
  assert.equal(
    parseNewTabPreferences({ clockVerticalPosition: "50" })
      .clockVerticalPosition,
    0,
  );
});

test("migrates the old px icon offset and free-text weather city", () => {
  assert.equal(
    parseNewTabPreferences({ iconVerticalOffset: 340 }).iconVerticalPosition,
    69,
  );
  assert.equal(
    parseNewTabPreferences({ iconVerticalOffset: 0 }).iconVerticalPosition,
    35,
  );
  assert.equal(
    parseNewTabPreferences({ iconVerticalOffset: 480 }).iconVerticalPosition,
    83,
  );
  assert.equal(
    parseNewTabPreferences({
      iconVerticalOffset: 340,
      iconVerticalPosition: 12,
    }).iconVerticalPosition,
    12,
    "the new key wins",
  );
  assert.equal(
    parseNewTabPreferences({ iconVerticalPosition: 140 }).iconVerticalPosition,
    100,
  );
  assert.equal(
    parseNewTabPreferences({ iconVerticalPosition: -3 }).iconVerticalPosition,
    0,
  );
  const legacy = parseNewTabPreferences({
    weatherEnabled: true,
    weatherLocation: "Melbourne",
  });
  assert.equal(legacy.weatherLocation, "Melbourne");
  assert.equal(legacy.weatherPlace, null, "looked up once by main, then saved");
  const picked = parseNewTabPreferences({
    weatherPlace: {
      name: "Melbourne",
      region: "Victoria",
      country: "Australia",
      latitude: -37.81396,
      longitude: 144.96332,
    },
    weatherProvider: "met-norway",
  });
  assert.deepEqual(picked.weatherPlace, {
    name: "Melbourne",
    region: "Victoria",
    country: "Australia",
    latitude: -37.814,
    longitude: 144.9633,
  });
  assert.equal(picked.weatherProvider, "met-norway");
  assert.equal(
    parseNewTabPreferences({ openMeteoModel: "bom_access_global" })
      .openMeteoModel,
    "bom_access_global",
  );
  assert.equal(
    parseNewTabPreferences({ openMeteoModel: "nonsense" }).openMeteoModel,
    "best_match",
  );
  assert.equal(
    parseNewTabPreferences({
      weatherProvider: "darksky",
      weatherPlace: { name: "X", latitude: 200, longitude: 0 },
    }).weatherProvider,
    "open-meteo",
  );
  assert.equal(
    parseNewTabPreferences({
      weatherPlace: { name: "X", latitude: 200, longitude: 0 },
    }).weatherPlace,
    null,
  );
});

test("normalizes clock time zones, removes invalid world clocks, and bounds display settings", () => {
  const preferences = parseNewTabPreferences({
    showClock: false,
    timeZone: "Not/A_Timezone",
    weatherEnabled: true,
    weatherLocation: ` ${"A".repeat(140)} `,
    temperatureUnit: "fahrenheit",
    iconSize: 999,
    linksPerRow: 1,
    backgroundDim: -12,
    backgroundBlur: 6.4,
    iconVerticalPosition: 999,
    worldClocks: [
      { id: "one", label: "Sydney", timeZone: "Australia/Sydney" },
      { id: "two", label: "Bad zone", timeZone: "Mars/Phobos" },
      { id: "one", label: "Duplicate id", timeZone: "UTC" },
      { id: "empty", label: "  ", timeZone: "UTC" },
    ],
  });
  assert.equal(preferences.showClock, false);
  assert.equal(preferences.timeZone, "local");
  assert.equal(preferences.weatherLocation.length, 100);
  assert.equal(preferences.temperatureUnit, "fahrenheit");
  assert.equal(preferences.iconSize, 52);
  assert.equal(preferences.linksPerRow, 3);
  assert.equal(preferences.backgroundDim, 0);
  assert.equal(preferences.backgroundBlur, 6);
  assert.equal(preferences.iconVerticalPosition, 100);
  assert.deepEqual(preferences.worldClocks, [
    { id: "one", label: "Sydney", timeZone: "Australia/Sydney" },
  ]);
});

test("caps saved world clocks to a small, bounded list", () => {
  const clocks = Array.from({ length: MAX_WORLD_CLOCKS + 3 }, (_, index) => ({
    id: `clock-${index}`,
    label: `City ${index}`,
    timeZone: "UTC",
  }));
  assert.equal(
    parseNewTabPreferences({ worldClocks: clocks }).worldClocks.length,
    MAX_WORLD_CLOCKS,
  );
});

test("per-site zoom keeps valid http origins with non-default factors only", () => {
  const parsed = parseBrowserPreferences({
    version: 1,
    siteZoom: {
      "https://example.com/path": 1.25,
      "https://default.test": 1,
      "file:///tmp": 2,
      "https://big.test": 12,
      "https://bad.test": "x",
    },
  });
  assert.deepEqual(parsed.siteZoom, {
    "https://example.com": 1.25,
    "https://big.test": 5,
  });
});

test("weather position: below the clocks by default, corner kept, junk ignored", () => {
  assert.equal(parseNewTabPreferences({}).weatherPosition, "below");
  assert.equal(
    parseNewTabPreferences({ weatherPosition: "corner" }).weatherPosition,
    "corner",
  );
  assert.equal(
    parseNewTabPreferences({ weatherPosition: "inline" }).weatherPosition,
    "below",
  );
  assert.equal(
    parseNewTabPreferences({ weatherPosition: 1 }).weatherPosition,
    "below",
  );
});
