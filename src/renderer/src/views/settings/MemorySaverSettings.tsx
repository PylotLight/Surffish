import { useEffect, useState } from "react";
import { SettingsRow } from "./SettingsControls";

type Snapshot = Awaited<ReturnType<typeof window.api.browser.memorySaver.get>>;

/** Settings → General → Tabs: discard background tabs when memory is tight (on by default). */
export function MemorySaverSettings(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    let live = true;
    void window.api.browser.memorySaver
      .get()
      .then((next) => {
        if (live) setSnapshot(next);
      })
      .catch(() => undefined);
    const off = window.api.browser.memorySaver.onChange(setSnapshot);
    return () => {
      live = false;
      off();
    };
  }, []);
  const discarded = snapshot?.discarded ?? 0;
  return (
    <SettingsRow
      label="Memory saver"
      hint="Background tabs sleep early when memory runs low."
      info={`When your computer runs low on memory, or Surffish uses more than half of it, background tabs go to sleep early, least recently used first, but never before your sleep timer above (and never within 15 minutes of being looked at) unless memory is critically low. Playing, pinned and tabs with unsaved form input stay awake.${discarded > 0 ? ` ${discarded} tab${discarded === 1 ? "" : "s"} put to sleep this session.` : ""}`}
    >
      <input
        type="checkbox"
        className="settings-switch"
        checked={snapshot?.enabled ?? true}
        disabled={!snapshot}
        onChange={(event) => {
          void window.api.browser.memorySaver
            .set({ enabled: event.target.checked })
            .then(setSnapshot)
            .catch(() => undefined);
        }}
        aria-label="Put background tabs to sleep when memory is low"
      />
    </SettingsRow>
  );
}
