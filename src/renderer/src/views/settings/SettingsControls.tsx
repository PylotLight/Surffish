import { useId, useRef, useState } from "react";
import { splitSettingsHint } from "../../../../shared/settings-search";

/**
 * Layout primitives for the Settings pages (v2, 2026-10): a group is a small header label above an
 * inset glass list; a row is label + one-line hint on the left, control on the right. Long hints
 * show their first sentence and tuck the rest behind an ⓘ button (still in the DOM, so settings
 * search matches it). Categories carry the sticky headings and the jump list on General.
 */
export function SettingsGroup({
  title,
  status,
  statusOn,
  aside,
  icon,
  className = "",
  children,
}: {
  title: string;
  status?: string;
  statusOn?: boolean;
  aside?: React.ReactNode;
  icon?: string;
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className={`settings-group ${className}`.trim()}
      aria-label={title}
    >
      <header className="settings-group-header">
        {icon && <img className="settings-group-icon" src={icon} alt="" />}
        <div className="settings-group-title">
          <h2>{title}</h2>
          {status && (
            <span className={`settings-status${statusOn ? " is-on" : ""}`}>
              {status}
            </span>
          )}
        </div>
        {aside && <div className="settings-group-aside">{aside}</div>}
      </header>
      {children && <div className="settings-group-body">{children}</div>}
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  info,
  children,
}: {
  label: string;
  hint?: string;
  info?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const split = hint ? splitSettingsHint(hint) : null;
  const more = info ?? split?.more ?? null;
  const [open, setOpen] = useState(false);
  const infoId = useId();
  return (
    <div className={`settings-row${open ? " is-info-open" : ""}`}>
      <div className="settings-row-copy">
        <span className="settings-row-label">
          {label}
          {more && (
            <button
              type="button"
              className="settings-row-info-toggle"
              aria-expanded={open}
              aria-controls={infoId}
              aria-label={`About ${label}`}
              title={open ? "Less" : "More about this setting"}
              onClick={() => setOpen((value) => !value)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.25" />
                <path d="M8 7.2v3.9M8 4.9v.1" />
              </svg>
            </button>
          )}
        </span>
        {split?.short && (
          <span className="settings-row-hint">{split.short}</span>
        )}
        {more && (
          <span className="settings-row-info" id={infoId}>
            {more}
          </span>
        )}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function SettingsSlider({
  label,
  value,
  unit = "",
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <label className="settings-row settings-slider-row">
      <span className="settings-row-label">{label}</span>
      <input
        className="settings-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--range-fill": `${percent}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <output className="settings-slider-value">
        {value}
        {unit}
      </output>
    </label>
  );
}

/**
 * Segmented control for 2–4 short exclusive choices (replaces a select or a radio stack). A
 * radiogroup with a roving tabindex: Tab lands on the selected option, arrow keys move and select.
 */
export function SettingsSegmented<T extends string | number>({
  value,
  options,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const move = (index: number): void => {
    const wrapped = (index + options.length) % options.length;
    const next = options[wrapped];
    if (!next) return;
    onChange(next.value);
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[wrapped]?.focus();
  };
  return (
    <div
      className="settings-segmented"
      role="radiogroup"
      aria-label={ariaLabel}
      ref={ref}
    >
      {options.map((option, index) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={index === selectedIndex}
          tabIndex={index === selectedIndex ? 0 : -1}
          className={index === selectedIndex ? "is-selected" : ""}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              move(index + 1);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              move(index - 1);
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const saved = window.localStorage.getItem(`surffish.settings.open.${id}`);
    return saved === null ? fallback : saved === "1";
  } catch {
    return fallback;
  }
}

/**
 * A collapsible sub-list inside a group (progressive disclosure, one level deep): the summary row
 * shows the name and the current values; the body holds the rows. Open state is remembered per id.
 * Settings search opens it while a row inside matches (data-search-forced) without saving that.
 */
export function SettingsDisclosure({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  return (
    <details
      className="settings-disclosure"
      data-disclosure={id}
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (
          (event.currentTarget as HTMLElement).hasAttribute(
            "data-search-forced",
          ) ||
          next === open
        )
          return;
        setOpen(next);
        try {
          window.localStorage.setItem(
            `surffish.settings.open.${id}`,
            next ? "1" : "0",
          );
        } catch {
          /* storage unavailable */
        }
      }}
    >
      <summary className="settings-disclosure-summary">
        <span className="settings-disclosure-title">{title}</span>
        {summary && (
          <span className="settings-disclosure-value">{summary}</span>
        )}
        <svg
          className="settings-disclosure-chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </summary>
      <div className="settings-disclosure-body">{children}</div>
    </details>
  );
}

/**
 * A titled block of groups on a long page; its heading sticks while the block scrolls by. `single`:
 * the block holds one group named like the category, so that group's own label is hidden.
 */
export function SettingsCategory({
  id,
  title,
  single = false,
  children,
}: {
  id: string;
  title: string;
  single?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`settings-category${single ? " is-single" : ""}`}
      id={`settings-category-${id}`}
      data-category={id}
      role="group"
      aria-labelledby={`settings-category-${id}-title`}
    >
      <h2
        className="settings-category-title"
        id={`settings-category-${id}-title`}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}
