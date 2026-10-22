// New Tab clock formatting: time (auto / 12 h / 24 h, seconds, AM/PM), date styles, the world-clock
// difference from the main clock ("+2h", "Tomorrow") and the greeting. Pure functions over Intl so
// they unit-test with a fixed time, zone and locale. Formatters are cached: the New Tab re-renders
// every minute (every second with seconds on) and Intl.DateTimeFormat construction is the costly part.

export type ClockTimeFormat = "auto" | "12h" | "24h";
export type ClockDateFormat = "long" | "short" | "numeric" | "iso";
export type ClockWeight = "light" | "regular" | "bold";

export const CLOCK_TIME_FORMATS: readonly ClockTimeFormat[] = [
  "auto",
  "12h",
  "24h",
];
export const CLOCK_DATE_FORMATS: readonly ClockDateFormat[] = [
  "long",
  "short",
  "numeric",
  "iso",
];
export const CLOCK_WEIGHTS: readonly ClockWeight[] = [
  "light",
  "regular",
  "bold",
];

export const isClockTimeFormat = (value: unknown): value is ClockTimeFormat =>
  CLOCK_TIME_FORMATS.includes(value as ClockTimeFormat);
export const isClockDateFormat = (value: unknown): value is ClockDateFormat =>
  CLOCK_DATE_FORMATS.includes(value as ClockDateFormat);
export const isClockWeight = (value: unknown): value is ClockWeight =>
  CLOCK_WEIGHTS.includes(value as ClockWeight);

/** Clock size slider: percent of the original clock (clamp(24px, 3vw, 42px)); 100 is the default. */
export const MIN_CLOCK_SCALE = 50;
export const MAX_CLOCK_SCALE = 250;
export const CLOCK_SCALE_STEP = 5;
/** Clock position slider: percent of the free space above the icons (0 = the original top spot). */
export const MIN_CLOCK_POSITION = 0;
export const MAX_CLOCK_POSITION = 100;
/** The S/M/L/XL presets of the first clock-options build, as slider values (font size ratios to M at 1280 px). */
const LEGACY_CLOCK_SIZE_SCALE: ReadonlyMap<unknown, number> = new Map([
  ["s", 75],
  ["m", 100],
  ["l", 145],
  ["xl", 220],
]);
export const clockScaleFromLegacySize = (value: unknown): number | null =>
  LEGACY_CLOCK_SIZE_SCALE.get(value) ?? null;

/** Where the New Tab weather reading sits: its own line under the clocks (default) or the page's top-right corner. */
export type WeatherPosition = "below" | "corner";
export const WEATHER_POSITIONS: readonly WeatherPosition[] = [
  "below",
  "corner",
];
export const isWeatherPosition = (value: unknown): value is WeatherPosition =>
  WEATHER_POSITIONS.includes(value as WeatherPosition);

/** Where the clocks sit: `position` percent of the free space between their top spot and the icons. */
export function clockShift(position: number, freeSpace: number): number {
  return Math.round(
    (Math.max(0, freeSpace) *
      Math.min(MAX_CLOCK_POSITION, Math.max(MIN_CLOCK_POSITION, position))) /
      100,
  );
}

export interface ClockTimeOptions {
  /** 'local' = the device zone. */
  timeZone: string;
  timeFormat: ClockTimeFormat;
  showSeconds: boolean;
  /** 12-hour only: false drops "am"/"pm". */
  showAmPm: boolean;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(
  locale: string | undefined,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${timeZone}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    if (formatters.size > 64) formatters.clear();
    cached = new Intl.DateTimeFormat(locale, {
      ...(timeZone === "local" ? {} : { timeZone }),
      ...options,
    });
    formatters.set(key, cached);
  }
  return cached;
}

/** Whether `timeFormat` resolves to a 12-hour clock in `locale` ('auto' asks the locale). */
export function usesTwelveHour(
  timeFormat: ClockTimeFormat,
  locale?: string,
): boolean {
  if (timeFormat !== "auto") return timeFormat === "12h";
  const cycle = formatter(locale, "UTC", { hour: "numeric" }).resolvedOptions()
    .hourCycle;
  return cycle === "h11" || cycle === "h12";
}

/**
 * "20:05" / "8:05 pm" / "8:05" (AM/PM hidden) / "20:05:07". 24-hour keeps the leading zero (the
 * look before these options existed); 12-hour drops it, like the system clock.
 */
export function formatClockTime(
  date: Date,
  options: ClockTimeOptions,
  locale?: string,
): string {
  const twelve = usesTwelveHour(options.timeFormat, locale);
  const parts = formatter(locale, options.timeZone, {
    hour: twelve ? "numeric" : "2-digit",
    minute: "2-digit",
    ...(options.showSeconds ? { second: "2-digit" as const } : {}),
    // hourCycle rather than hour12: hour12:false can resolve to h24 ("24:05") in some locales.
    hourCycle: twelve ? "h12" : "h23",
  }).formatToParts(date);
  if (!twelve || options.showAmPm)
    return parts.map((part) => part.value).join("");
  // Drop the day period and the space that joined it (either side; some locales lead with it).
  const kept: string[] = [];
  parts.forEach((part, index) => {
    if (part.type === "dayPeriod") return;
    if (
      part.type === "literal" &&
      /^\s+$/.test(part.value) &&
      (parts[index + 1]?.type === "dayPeriod" ||
        parts[index - 1]?.type === "dayPeriod")
    )
      return;
    kept.push(part.value);
  });
  return kept.join("").trim();
}

interface ZonedDay {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}
function zonedParts(date: Date, timeZone: string): ZonedDay {
  const values: Record<string, number> = {};
  for (const part of formatter("en-US", timeZone, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour! % 24,
    minute: values.minute!,
  };
}

/** "Friday 16 October" (long, the original look) / "Fri, 16 Oct" / "16/10/2026" (locale order) / "2026-10-16". */
export function formatClockDate(
  date: Date,
  timeZone: string,
  format: ClockDateFormat,
  locale?: string,
): string {
  if (format === "iso") {
    const { year, month, day } = zonedParts(date, timeZone);
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const options: Intl.DateTimeFormatOptions =
    format === "long"
      ? { weekday: "long", month: "long", day: "numeric" }
      : format === "short"
        ? { weekday: "short", month: "short", day: "numeric" }
        : { year: "numeric", month: "2-digit", day: "2-digit" };
  return formatter(locale, timeZone, options).format(date);
}

/** Minutes `timeZone` is ahead of `referenceZone` at `date` (DST-aware; negative when behind). */
export function zoneDifferenceMinutes(
  date: Date,
  timeZone: string,
  referenceZone: string,
): number {
  const wall = (zone: string): number => {
    const p = zonedParts(date, zone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  };
  return Math.round((wall(timeZone) - wall(referenceZone)) / 60_000);
}

/** "+2h", "−10h", "+5h 30m", "+45m"; "Same time" at 0. */
export function formatZoneDifference(minutes: number): string {
  if (minutes === 0) return "Same time";
  const sign = minutes > 0 ? "+" : "\u2212";
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${sign}${hours ? `${hours}h` : ""}${hours && rest ? " " : ""}${rest ? `${rest}m` : ""}`;
}

/** "Tomorrow" / "Yesterday" when `timeZone`'s calendar day differs from `referenceZone`'s, else null. */
export function relativeClockDay(
  date: Date,
  timeZone: string,
  referenceZone: string,
): "Tomorrow" | "Yesterday" | null {
  const day = (zone: string): number => {
    const p = zonedParts(date, zone);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  const diff = Math.round((day(timeZone) - day(referenceZone)) / 86_400_000);
  return diff > 0 ? "Tomorrow" : diff < 0 ? "Yesterday" : null;
}

/** "Good morning" 5:00–11:59, "Good afternoon" 12:00–17:59, otherwise "Good evening". */
export function clockGreeting(date: Date, timeZone: string): string {
  const { hour } = zonedParts(date, timeZone);
  return hour >= 5 && hour < 12
    ? "Good morning"
    : hour >= 12 && hour < 18
      ? "Good afternoon"
      : "Good evening";
}
