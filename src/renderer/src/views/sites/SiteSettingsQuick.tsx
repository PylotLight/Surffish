import { useEffect, useState } from "react";
import "./sites.css";
import type { BrowserSiteSettings } from "../../../../shared/types";
import {
  SiteSettingSwitches,
  type SiteSettingKey,
} from "./SiteSettingSwitches";

/**
 * The address bar's site menu: this tab's site, its switches, and a link to every site's settings
 * (Settings → Sites, deep-linked to this one). Tied to the current tab; Settings never guesses it.
 */
export function SiteSettingsQuick({
  origin,
  onAllSiteSettings,
}: {
  origin: string;
  onAllSiteSettings: () => void;
}): React.JSX.Element {
  const [settings, setSettings] = useState<BrowserSiteSettings | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    let live = true;
    setSettings(null);
    setChanged(false);
    void window.api.browser.siteSettings
      .get(origin)
      .then((next) => {
        if (live) setSettings(next);
      })
      .catch(() => undefined);
    // The ad-blocker shield and Settings → Sites change the same settings.
    const stop = window.api.browser.adblock.onSiteSettingsChanged((next) => {
      if (live && next?.origin === origin) setSettings(next);
    });
    return () => {
      live = false;
      stop();
    };
  }, [origin]);

  async function update(key: SiteSettingKey, value: boolean): Promise<void> {
    if (!settings) return;
    const optimistic = { ...settings, [key]: value };
    setSettings(optimistic);
    setChanged(true);
    try {
      const saved = await window.api.browser.siteSettings.set(
        origin,
        optimistic,
      );
      if (saved) setSettings(saved);
    } catch {
      setSettings(settings);
    }
  }

  return (
    <div
      className="site-quick-settings"
      role="group"
      aria-label={`Settings for ${origin}`}
    >
      {settings ? (
        <SiteSettingSwitches
          settings={settings}
          origin={origin}
          compact
          onChange={(key, value) => void update(key, value)}
        />
      ) : (
        <p className="site-connection-detail">Loading…</p>
      )}
      <div className="site-quick-settings-footer">
        {changed && (
          <button
            type="button"
            className="site-quick-settings-reload"
            onClick={() => void window.api.browser.reload()}
          >
            Reload to apply
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className="site-quick-settings-all"
          onClick={onAllSiteSettings}
        >
          <span>All site settings</span>
          <span className="site-connection-chevron" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
    </div>
  );
}
