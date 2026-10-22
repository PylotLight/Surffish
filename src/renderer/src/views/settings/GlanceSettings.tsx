import { useEffect, useState } from "react";
import { SettingsGroup, SettingsRow } from "./SettingsControls";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

/** Settings → General → Glance: "Shift-click opens links in Glance" (on by default). */
export function GlanceSettings(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void window.api.browser.glance
      .getSettings()
      .then((settings) => {
        if (live) setEnabled(settings.shiftClick);
      })
      .catch(() => {
        if (live) setEnabled(true);
      });
    const off = window.api.browser.glance.onSettingsChange((settings) =>
      setEnabled(settings.shiftClick),
    );
    return () => {
      live = false;
      off();
    };
  }, []);
  return (
    <SettingsGroup
      title="Glance"
      status={enabled === null ? undefined : enabled ? "On" : "Off"}
      statusOn={enabled === true}
    >
      <SettingsRow
        label="Shift-click opens links in Glance"
        hint="Peek at a link in a sheet over the page instead of a new tab."
        info={`Esc or a click outside closes it; ${IS_MAC ? "⌘" : "Ctrl+"}Enter opens it as a tab without reloading. Right-click a link → Open Link in Glance works either way.`}
      >
        <input
          type="checkbox"
          className="settings-switch"
          checked={enabled ?? false}
          disabled={enabled === null}
          onChange={(event) => {
            const next = event.target.checked;
            setEnabled(next);
            void window.api.browser.glance
              .setShiftClick(next)
              .then((settings) => setEnabled(settings.shiftClick))
              .catch(() => undefined);
          }}
          aria-label="Shift-click opens links in Glance"
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
