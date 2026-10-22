import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserSiteSettings } from "../../../../shared/types";
import { settingsSitesList } from "../../../../shared/settings-tab";
import {
  SiteSettingSwitches,
  siteOverrideSummary,
  type SiteSettingKey,
} from "./SiteSettingSwitches";
import { SiteDataSettings } from "../settings/SiteDataSettings";
import { SiteRouteSettings } from "../settings/SiteRouteSettings";

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * Settings → Sites: every site with its own settings (a list, so the Settings tab never guesses a
 * "current site"). `focusHost` (from the site menu's "All site settings") puts that site first,
 * open and focused, even before it has any override; `revision` re-applies it on every request.
 */
export function SitesSettings({
  focusHost,
  revision,
}: {
  focusHost?: string;
  revision?: number;
}): React.JSX.Element {
  const [saved, setSaved] = useState<BrowserSiteSettings[] | null>(null);
  const [extra, setExtra] = useState<Record<string, BrowserSiteSettings>>({});
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(focusHost ? [focusHost] : []),
  );
  const [filter, setFilter] = useState("");
  const focusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = (): void => {
      void window.api.browser.siteSettings
        .list()
        .then((list) => {
          if (live) setSaved(list);
        })
        .catch(() => {
          if (live) setSaved([]);
        });
    };
    refresh();
    const stop = window.api.browser.adblock.onSiteSettingsChanged(() =>
      refresh(),
    );
    return () => {
      live = false;
      stop();
    };
  }, []);

  // A deep link: that site opens (loaded even with no overrides yet) and takes focus.
  useEffect(() => {
    if (!focusHost) return;
    setOpen((current) => new Set([...current, focusHost]));
    setFilter("");
    let live = true;
    void window.api.browser.siteSettings
      .get(focusHost)
      .then((settings) => {
        if (live && settings)
          setExtra((current) => ({ ...current, [focusHost]: settings }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [focusHost, revision]);

  const byOrigin = useMemo(() => {
    const map = new Map<string, BrowserSiteSettings>();
    for (const settings of Object.values(extra))
      map.set(settings.origin, settings);
    for (const settings of saved ?? []) map.set(settings.origin, settings);
    return map;
  }, [saved, extra]);
  const origins = useMemo(
    () =>
      settingsSitesList(
        (saved ?? []).map((settings) => settings.origin),
        focusHost,
      ),
    [saved, focusHost],
  );
  const query = filter.trim().toLowerCase();
  const shown = query
    ? origins.filter((origin) => origin.toLowerCase().includes(query))
    : origins;

  useEffect(() => {
    if (!focusHost || !byOrigin.has(focusHost)) return;
    const element = focusRef.current;
    if (!element) return;
    element.scrollIntoView({ block: "nearest" });
    element.focus({ preventScroll: true });
  }, [focusHost, revision, byOrigin.has(focusHost ?? "")]);

  async function update(
    origin: string,
    key: SiteSettingKey,
    value: boolean,
  ): Promise<void> {
    const current = byOrigin.get(origin);
    if (!current) return;
    const next = { ...current, [key]: value };
    setExtra((all) => ({ ...all, [origin]: next }));
    setSaved(
      (list) =>
        list?.map((settings) =>
          settings.origin === origin ? next : settings,
        ) ?? list,
    );
    try {
      const result = await window.api.browser.siteSettings.set(origin, next);
      if (result) setExtra((all) => ({ ...all, [origin]: result }));
    } catch {
      setExtra((all) => ({ ...all, [origin]: current }));
    }
  }

  function toggle(origin: string): void {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(origin)) next.delete(origin);
      else next.add(origin);
      return next;
    });
  }

  return (
    <div className="settings-view site-settings-view sites-settings-view">
      <header className="settings-page-header">
        <div className="settings-page-heading-copy">
          <h1>Sites</h1>
          <p>
            Sites with their own privacy and permission settings. Change one
            from the site menu in the address bar.
          </p>
        </div>
      </header>
      <div className="settings-content">
        {saved === null ? (
          <section className="settings-section">
            <p className="settings-help">Loading sites…</p>
          </section>
        ) : (
          <>
            {origins.length > 6 && (
              <label className="sites-settings-filter">
                <input
                  type="search"
                  placeholder="Find a site"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  aria-label="Find a site"
                />
              </label>
            )}
            {origins.length === 0 && (
              <section className="settings-section">
                <p className="settings-help">
                  No site has its own settings yet. Every site blocks ads and
                  trackers, and camera, microphone, location, notifications and
                  clipboard reads stay denied until you allow them for a site
                  from its menu in the address bar.
                </p>
              </section>
            )}
            <ul
              className="sites-settings-list"
              aria-label="Sites with their own settings"
            >
              {shown.map((origin) => {
                const settings = byOrigin.get(origin);
                const isOpen = open.has(origin);
                const focused = origin === focusHost;
                return (
                  <li
                    key={origin}
                    className={`settings-section sites-settings-site${isOpen ? " is-open" : ""}${focused ? " is-focused" : ""}`}
                    data-site-origin={origin}
                  >
                    <button
                      type="button"
                      className="sites-settings-site-head"
                      aria-expanded={isOpen}
                      ref={
                        focused
                          ? (element) => {
                              focusRef.current = element;
                            }
                          : undefined
                      }
                      onClick={() => toggle(origin)}
                    >
                      <strong>{hostOf(origin)}</strong>
                      <span className="settings-status">
                        {settings ? siteOverrideSummary(settings) : "…"}
                      </span>
                      <span
                        className="sites-settings-chevron"
                        aria-hidden="true"
                      >
                        ›
                      </span>
                    </button>
                    {isOpen && settings && (
                      <div className="sites-settings-site-body">
                        <SiteSettingSwitches
                          settings={settings}
                          origin={origin}
                          onChange={(key, value) =>
                            void update(origin, key, value)
                          }
                        />
                        <SiteRouteSettings url={origin} />
                        <SiteDataSettings origin={origin} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="settings-help">
              Copying, fullscreen and pointer lock work everywhere, like Chrome.
              Other web permissions stay denied, and a short notice shows when a
              site is blocked. Allowing a permission does not bypass macOS or
              Windows privacy prompts. Changes apply to new requests; reload a
              site to apply them.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
