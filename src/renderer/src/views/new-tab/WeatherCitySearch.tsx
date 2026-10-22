import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { WeatherPlace } from "../../../../shared/types";
import { weatherPlaceLabel } from "../../../../shared/weather";

const SEARCH_DEBOUNCE_MS = 250;

function ipcMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
}

type Props = {
  /** The saved place's label (or the free text saved before city search). */
  value: string;
  current: WeatherPlace | null;
  disabled?: boolean;
  onSelect: (place: WeatherPlace) => void;
};

/**
 * Type-ahead city search (Open-Meteo geocoding through main): suggestions show city, region and
 * country; picking one saves its coordinates so weather lookups never geocode again. Same look and
 * keyboard model as the world clock TimeZonePicker (tz-picker classes).
 */
export default function WeatherCitySearch({
  value,
  current,
  disabled,
  onSelect,
}: Props): React.JSX.Element {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [locating, setLocating] = useState(false);
  const [listBox, setListBox] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Debounced search; a reply to an older query is dropped.
  useEffect(() => {
    const trimmed = query.trim();
    const id = ++requestRef.current;
    if (!open || trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      setError("");
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void window.api.browser.newTabWeather
        .search(trimmed)
        .then((reply) => {
          if (requestRef.current !== id) return;
          setResults(reply.ok ? reply.value : []);
          setHighlight(0);
          setError(reply.ok ? "" : reply.error);
        })
        .catch((caught: unknown) => {
          if (requestRef.current === id) {
            setResults([]);
            setError(ipcMessage(caught));
          }
        })
        .finally(() => {
          if (requestRef.current === id) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  // A fixed layer, so the list is never clipped by the settings column or the Customize panel.
  useEffect(() => {
    if (!open) {
      setListBox(null);
      return;
    }
    const place = (): void => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const maxHeight = Math.max(140, Math.min(300, Math.max(below, above)));
      const top =
        below >= Math.min(300, maxHeight) || below >= above
          ? rect.bottom + 6
          : rect.top - 6 - maxHeight;
      setListBox({ top, left: rect.left, width: rect.width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function choose(place: WeatherPlace | undefined): void {
    if (!place) return;
    onSelect(place);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function locateApproximately(): void {
    setLocating(true);
    setError("");
    void window.api.browser.newTabWeather
      .locate()
      .then((reply) => {
        if (!reply.ok) {
          setError(reply.error);
          return;
        }
        onSelect(reply.value);
        setOpen(false);
      })
      .catch((caught: unknown) => setError(ipcMessage(caught)))
      .finally(() => setLocating(false));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open) choose(results[highlight]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  const trimmed = query.trim();
  const status =
    trimmed.length < 2
      ? "Type at least 2 letters of a city or town"
      : searching
        ? "Searching…"
        : error || (results.length === 0 ? "No matching city or town" : "");

  return (
    <div className="weather-city-search">
      <div className={`tz-picker${open ? " is-open" : ""}`} ref={rootRef}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Weather city or town"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && results[highlight] ? `${listId}-${highlight}` : undefined
          }
          spellCheck={false}
          autoComplete="off"
          maxLength={100}
          disabled={disabled}
          placeholder={
            open ? "Search a city or town…" : value || "Search a city or town…"
          }
          value={open ? query : value}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <span className="tz-picker-caret" aria-hidden="true">
          ⌕
        </span>
        {open && (
          <ul
            className="tz-picker-list weather-city-list"
            id={listId}
            role="listbox"
            aria-label="Matching places"
            style={
              listBox
                ? {
                    top: listBox.top,
                    left: listBox.left,
                    width: listBox.width,
                    maxHeight: listBox.maxHeight,
                  }
                : { visibility: "hidden" }
            }
          >
            {results.map((place, index) => {
              const detail = [place.region, place.country]
                .filter(
                  (part, i, all): part is string =>
                    Boolean(part) &&
                    part !== place.name &&
                    all.indexOf(part) === i,
                )
                .join(", ");
              const isCurrent =
                current !== null &&
                Math.abs(current.latitude - place.latitude) < 0.01 &&
                Math.abs(current.longitude - place.longitude) < 0.01;
              return (
                <li
                  key={`${weatherPlaceLabel(place)}|${place.latitude},${place.longitude}`}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === highlight}
                  className={`${index === highlight ? "is-highlighted" : ""}${isCurrent ? " is-current" : ""}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(place);
                  }}
                  onPointerEnter={() => setHighlight(index)}
                >
                  <strong>{place.name}</strong>
                  <span>
                    {detail ||
                      `${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`}
                  </span>
                </li>
              );
            })}
            {status && (
              <li className="tz-picker-empty" role="presentation">
                {status}
              </li>
            )}
          </ul>
        )}
      </div>
      <button
        className="settings-link-action"
        type="button"
        disabled={disabled || locating}
        onClick={locateApproximately}
        title="Looks up your public IP address with get.geojs.io (city-level)"
      >
        {locating ? "Finding you…" : "Use my approximate location"}
      </button>
      {!open && error && (
        <p className="settings-message is-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
