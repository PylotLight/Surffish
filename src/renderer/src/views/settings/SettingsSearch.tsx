import { useEffect, useRef, useState } from "react";
import {
  settingsMatchesElsewhere,
  type SettingsSearchMode,
} from "../../../../shared/settings-search";

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * The settings search field (in the settings nav bar). "/" focuses it from anywhere on a settings
 * page; Esc clears it, and a second Esc (empty field) leaves settings as before.
 */
export function SettingsSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={`settings-search${value ? " has-query" : ""}`}>
      <svg
        className="settings-search-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.6" />
        <path d="M10.4 10.4L14 14" />
      </svg>
      <input
        ref={input}
        type="search"
        value={value}
        placeholder="Search settings"
        spellCheck={false}
        autoComplete="off"
        aria-label="Search settings"
        aria-keyshortcuts="/"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (value) {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          } else {
            input.current?.blur();
          }
        }}
      />
      {!value && (
        <kbd className="settings-search-key" aria-hidden="true">
          /
        </kbd>
      )}
    </div>
  );
}

/** Under the nav while searching: how many rows match here, and which other pages have matches. */
export function SettingsSearchStatus({
  query,
  matches,
  mode,
  available,
  labelFor,
  onOpen,
  onClear,
}: {
  query: string;
  matches: number;
  mode: SettingsSearchMode;
  available: (mode: SettingsSearchMode) => boolean;
  labelFor: (mode: SettingsSearchMode) => string;
  onOpen: (mode: SettingsSearchMode) => void;
  onClear: () => void;
}): React.JSX.Element {
  const elsewhere = settingsMatchesElsewhere(query, mode).filter((hit) =>
    available(hit.mode),
  );
  const shown = query.trim();
  return (
    <div className="settings-search-status" role="status" aria-live="polite">
      <span className="settings-search-count">
        {matches > 0
          ? `${matches} ${matches === 1 ? "match" : "matches"} for “${shown}”`
          : `Nothing on this page matches “${shown}”`}
      </span>
      {elsewhere.length > 0 && (
        <span className="settings-search-elsewhere">
          <span>Also in</span>
          {elsewhere.map((hit) => (
            <button
              key={hit.mode}
              type="button"
              className="settings-search-chip"
              title={hit.labels.join(", ")}
              onClick={() => onOpen(hit.mode)}
            >
              {labelFor(hit.mode)}{" "}
              <span className="settings-search-chip-count">{hit.count}</span>
            </button>
          ))}
        </span>
      )}
      <button type="button" className="settings-search-clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

/**
 * The jump list beside General's categories (a glass side panel): click to scroll a category into
 * view; the one at the top of the page is marked current. While searching, it shows match counts
 * and hides categories without matches.
 */
export function SettingsToc({
  categories,
  counts,
  rootRef,
}: {
  categories: ReadonlyArray<{ id: string; label: string }>;
  counts: Record<string, number> | null;
  rootRef: React.RefObject<HTMLElement | null>;
}): React.JSX.Element {
  const [current, setCurrent] = useState(categories[0]?.id ?? "");
  useEffect(() => {
    const scroller =
      rootRef.current?.querySelector<HTMLElement>(".settings-view");
    if (!scroller) return;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top;
      const visible = categories.filter((category) => {
        const element = scroller.querySelector<HTMLElement>(
          `[data-category="${category.id}"]`,
        );
        return element && !element.hasAttribute("data-search-miss");
      });
      let active = visible[0]?.id ?? "";
      for (const category of visible) {
        const element = scroller.querySelector<HTMLElement>(
          `[data-category="${category.id}"]`,
        );
        if (!element) continue;
        if (element.getBoundingClientRect().top - top <= 96)
          active = category.id;
      }
      // At the very bottom the last short category can never reach the top: mark it anyway.
      if (
        scroller.scrollTop + scroller.clientHeight >=
        scroller.scrollHeight - 4
      ) {
        active = visible[visible.length - 1]?.id ?? active;
      }
      setCurrent(active);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [categories, rootRef, counts]);
  const jump = (id: string): void => {
    const element = rootRef.current?.querySelector<HTMLElement>(
      `[data-category="${id}"]`,
    );
    if (!element) return;
    element.scrollIntoView({
      block: "start",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    const heading = element.querySelector<HTMLElement>(
      ".settings-category-title",
    );
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    setCurrent(id);
  };
  if (counts && !categories.some((category) => (counts[category.id] ?? 0) > 0))
    return (
      <nav
        className="settings-toc is-empty"
        aria-label="General settings categories"
      />
    );
  return (
    <nav className="settings-toc" aria-label="General settings categories">
      {categories.map((category) => {
        const count = counts ? (counts[category.id] ?? 0) : null;
        if (count === 0) return null;
        return (
          <button
            key={category.id}
            type="button"
            className={current === category.id ? "is-current" : ""}
            aria-current={current === category.id ? "location" : undefined}
            onClick={() => jump(category.id)}
          >
            <span>{category.label}</span>
            {count !== null && (
              <span
                className="settings-toc-count"
                aria-label={`${count} matches`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
