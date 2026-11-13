import { useEffect, useState } from "react";
import type {
  SidebarBackdropMode,
  SidebarBackdropSettings,
} from "../../../../shared/sidebar-backdrop";
import {
  FRAME_TRANSPARENCY_DEFAULT,
  FRAME_TRANSPARENCY_MAX,
  FRAME_TRANSPARENCY_MIN,
} from "../../../../shared/sidebar-card";
import type { SidebarPushStyle } from "../../../../shared/page-view-bounds";
import { SettingsGroup, SettingsRow } from "./SettingsControls";

const REDUCED_TRANSPARENCY_QUERY = "(prefers-reduced-transparency: reduce)";

/** The system's Reduce Transparency switch (macOS), live. */
function useReducedTransparency(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.(REDUCED_TRANSPARENCY_QUERY).matches === true,
  );
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_TRANSPARENCY_QUERY);
    if (!query) return;
    const update = (): void => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const MODE_HINT: Record<SidebarBackdropMode, string> = {
  native:
    "Blurs the page behind the sidebar when it slides over a site. Turn off for a solid sidebar (saves a little GPU work while it’s open).",
  snapshot:
    "Blurs a snapshot of the page behind the sidebar when it slides over a site. Turn off for a solid sidebar.",
  solid: "The sidebar uses a solid, high-contrast background over sites.",
};

/** Settings → General → Appearance: sidebar blur, frame transparency and the bookmarks bar. */
export function AppearanceSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<SidebarBackdropSettings | null>(
    null,
  );
  const [mode, setMode] = useState<SidebarBackdropMode>("solid");
  const [barVisible, setBarVisible] = useState(false);
  const isMac = window.api.platform === "darwin";
  const reducedTransparency = useReducedTransparency();
  // While the slider moves: shown at once, saved and applied to every window as it goes.
  const [frameDraft, setFrameDraft] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.api.browser.sidebarBackdrop
      .get()
      .then((result) => {
        if (!mounted) return;
        setSettings(result.settings);
        setMode(result.state.mode);
      })
      .catch(() => undefined);
    void window.api.browser.bookmarks.bar
      .get()
      .then((visible) => {
        if (mounted) setBarVisible(visible);
      })
      .catch(() => undefined);
    const offSettings = window.api.browser.sidebarBackdrop.onSettings(
      (next) => {
        setSettings(next);
        void window.api.browser.sidebarBackdrop
          .get()
          .then((result) => {
            if (mounted) setMode(result.state.mode);
          })
          .catch(() => undefined);
      },
    );
    const offBar = window.api.browser.bookmarks.bar.onChange(setBarVisible);
    return () => {
      mounted = false;
      offSettings();
      offBar();
    };
  }, []);

  // With blur on, a platform without a blur path still reports 'solid'; say so instead of promising one.
  const hint =
    settings?.blur === false
      ? MODE_HINT.solid
      : mode === "solid"
        ? "No blur on this platform yet: the sidebar uses a solid, high-contrast background over sites."
        : MODE_HINT[mode];
  const frameTransparency =
    frameDraft ?? settings?.frameTransparency ?? FRAME_TRANSPARENCY_DEFAULT;
  const frameDisabled = !settings || !isMac || reducedTransparency;
  const frameHint = !isMac
    ? "The glass frame is macOS only: here the frame is always solid."
    : reducedTransparency
      ? "Reduce Transparency is on in System Settings, so the frame is solid."
      : "How much of the desktop shows through the toolbar, rail and docked sidebar. 0% is a solid frame. The hover sidebar follows, but always stays a little denser so it reads over pages.";
  const setFrameTransparency = (value: number): void => {
    setFrameDraft(value);
    void window.api.browser.sidebarBackdrop
      .set({ frameTransparency: value })
      .then((next) => {
        setSettings(next);
        setFrameDraft((draft) => (draft === value ? null : draft));
      })
      .catch(() => setFrameDraft(null));
  };
  const framePercent =
    ((frameTransparency - FRAME_TRANSPARENCY_MIN) /
      (FRAME_TRANSPARENCY_MAX - FRAME_TRANSPARENCY_MIN)) *
    100;
  return (
    <SettingsGroup title="Sidebar & bookmarks bar">
      <SettingsRow label="Sidebar blur" hint={hint}>
        <input
          type="checkbox"
          className="settings-switch"
          disabled={!settings}
          checked={settings?.blur ?? true}
          aria-label="Sidebar blur"
          onChange={(event) =>
            void window.api.browser.sidebarBackdrop
              .set({ blur: event.target.checked })
              .then(setSettings)
              .catch(() => undefined)
          }
        />
      </SettingsRow>
      <SettingsRow label="Frame transparency" hint={frameHint}>
        <input
          className="settings-range settings-frame-transparency"
          type="range"
          min={FRAME_TRANSPARENCY_MIN}
          max={FRAME_TRANSPARENCY_MAX}
          step={1}
          disabled={frameDisabled}
          value={frameDisabled && settings ? 0 : frameTransparency}
          style={
            {
              "--range-fill": `${frameDisabled && settings ? 0 : framePercent}%`,
            } as React.CSSProperties
          }
          aria-label="Frame transparency"
          aria-valuetext={`${frameTransparency}%`}
          onChange={(event) => setFrameTransparency(Number(event.target.value))}
          onDoubleClick={() => setFrameTransparency(FRAME_TRANSPARENCY_DEFAULT)}
        />
        <output className="settings-slider-value">
          {frameDisabled && settings ? "Solid" : `${frameTransparency}%`}
        </output>
      </SettingsRow>
      <SettingsRow
        label="Sidebar pushes page"
        hint="The hover sidebar pushes the page aside and matches the frame, instead of floating over it."
      >
        <input
          type="checkbox"
          className="settings-switch"
          disabled={!settings}
          checked={settings?.sidebarPushesPage ?? true}
          aria-label="Sidebar pushes page"
          onChange={(event) =>
            void window.api.browser.sidebarBackdrop
              .set({ sidebarPushesPage: event.target.checked })
              .then(setSettings)
              .catch(() => undefined)
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Sidebar animation"
        hint="How the page makes room while the hover sidebar pushes it: shrink beside the sidebar, or slide across at its size."
      >
        <select
          className="settings-select"
          disabled={!settings || settings.sidebarPushesPage === false}
          value={settings?.sidebarPushStyle ?? "resize"}
          aria-label="Sidebar animation"
          onChange={(event) =>
            void window.api.browser.sidebarBackdrop
              .set({
                sidebarPushStyle: event.target.value as SidebarPushStyle,
              })
              .then(setSettings)
              .catch(() => undefined)
          }
        >
          <option value="resize">Resize page</option>
          <option value="slide">Slide page</option>
        </select>
      </SettingsRow>
      <SettingsRow
        label="Bookmarks bar"
        hint={`Favourites under the toolbar (${isMac ? "⇧⌘B" : "Ctrl+Shift+B"}).`}
      >
        <input
          type="checkbox"
          className="settings-switch"
          checked={barVisible}
          aria-label="Show bookmarks bar"
          onChange={(event) =>
            void window.api.browser.bookmarks.bar
              .set(event.target.checked)
              .then(setBarVisible)
              .catch(() => undefined)
          }
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
