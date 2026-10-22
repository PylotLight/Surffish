import type { WeatherCondition } from "../../../../shared/weather-forecast";

/** Tiny line icons for the New Tab weather (1em, currentColor): no icon font or image requests. */
const SUN = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </>
);
const CLOUD = (
  <path d="M7 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 18.5z" />
);
const SMALL_CLOUD = (
  <path d="M7 15.5h8a3.3 3.3 0 0 0 .3-6.6 4.5 4.5 0 0 0-8.7 1A2.8 2.8 0 0 0 7 15.5z" />
);
const PATHS: Record<WeatherCondition, React.JSX.Element> = {
  clear: SUN,
  partly: (
    <>
      <circle cx="8.5" cy="8.5" r="3" />
      <path d="M8.5 2.5v1.2M2.5 8.5h1.2M4.3 4.3l.9.9M12.7 4.3l-.9.9" />
      <path d="M9 19.5h9a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.2 1A3 3 0 0 0 9 19.5z" />
    </>
  ),
  cloudy: CLOUD,
  fog: (
    <>
      <path d="M7 13.5h10a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1.1A3 3 0 0 0 7 13.5z" />
      <path d="M4 17h16M6 20.5h12" />
    </>
  ),
  drizzle: (
    <>
      {SMALL_CLOUD}
      <path d="M9 18.5l-.6 1.5M13 18.5l-.6 1.5" />
    </>
  ),
  rain: (
    <>
      {SMALL_CLOUD}
      <path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5" />
    </>
  ),
  sleet: (
    <>
      {SMALL_CLOUD}
      <path d="M9 18l-.8 2M15 18l-.8 2" />
      <circle cx="12" cy="19.5" r=".6" />
    </>
  ),
  snow: (
    <>
      {SMALL_CLOUD}
      <path
        d="M8.5 19.5h.01M12 18.5h.01M15.5 19.5h.01M10.2 21.5h.01M13.8 21.5h.01"
        strokeWidth="2.2"
      />
    </>
  ),
  thunder: (
    <>
      {SMALL_CLOUD}
      <path d="M12.5 16l-2 3.5h3l-2 3" />
    </>
  ),
};

export default function WeatherGlyph({
  condition,
  label,
}: {
  condition: WeatherCondition;
  label?: string;
}): React.JSX.Element {
  return (
    <svg
      className="new-tab-weather-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      {PATHS[condition]}
    </svg>
  );
}

/** Chance-of-rain droplet beside a percentage. */
export function RainChanceGlyph(): React.JSX.Element {
  return (
    <svg
      className="new-tab-weather-drop"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3.5c-3 4.2-5.5 7.4-5.5 10.6a5.5 5.5 0 0 0 11 0c0-3.2-2.5-6.4-5.5-10.6z" />
    </svg>
  );
}
