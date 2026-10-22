import { useEffect, useState } from "react";
import { SettingsRow } from "./SettingsControls";

type Snapshot = Awaited<ReturnType<typeof window.api.browser.preconnect.get>>;

/** Settings → General → Tabs: speculative preconnect while typing and on link hover, plus the omnibox prerender (on by default). */
export function PreloadPagesSettings(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    let live = true;
    void window.api.browser.preconnect
      .get()
      .then((next) => {
        if (live) setSnapshot(next);
      })
      .catch(() => undefined);
    const off = window.api.browser.preconnect.onChange(setSnapshot);
    return () => {
      live = false;
      off();
    };
  }, []);
  return (
    <SettingsRow
      label="Preload pages for faster browsing"
      hint="Connects ahead to the site you'll likely open next, and loads a history or bookmark page once the address bar is sure."
      info="Opens a connection to the site you're likely to visit next (the top address bar suggestion, or a link you rest the pointer on) through the same proxy and Space as the tab; search text is never sent. When what you typed is exactly a page from your history or bookmarks, that page loads out of sight so Enter shows it at once. Never in private tabs, on battery or when memory is low, and never for sign-out, delete, checkout or download links."
    >
      <input
        type="checkbox"
        className="settings-switch"
        checked={snapshot?.enabled ?? true}
        disabled={!snapshot}
        onChange={(event) => {
          void window.api.browser.preconnect
            .set({ enabled: event.target.checked })
            .then(setSnapshot)
            .catch(() => undefined);
        }}
        aria-label="Preload pages for faster browsing"
      />
    </SettingsRow>
  );
}
