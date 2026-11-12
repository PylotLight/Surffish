import { useEffect, useMemo, useState } from "react";
import Browser from "./views/Browser";
import {
  FRAME_TRANSPARENCY_DEFAULT,
  frameGlassCssVars,
  frameTransparencyAllowsGlass,
  sidebarCardCssVars,
} from "../../shared/sidebar-card";
import { sidebarMotionCssVars } from "../../shared/sidebar-motion";

// One source for the sidebar card's geometry and its open/close timeline (main uses the same
// numbers for the overlay view).
const SIDEBAR_CARD_STYLE = {
  ...sidebarCardCssVars(),
  ...sidebarMotionCssVars(),
} as React.CSSProperties;

/**
 * Settings → Appearance → Frame transparency, live in every surface (toolbar, sidebar, content):
 * main broadcasts the settings to every window's renderers when it changes.
 */
function useFrameTransparency(): number {
  const [value, setValue] = useState(FRAME_TRANSPARENCY_DEFAULT);
  useEffect(() => {
    const api = window.api.browser.sidebarBackdrop;
    if (!api) return;
    let mounted = true;
    void api
      .get()
      .then((result) => {
        if (mounted) setValue(result.settings.frameTransparency);
      })
      .catch(() => undefined);
    const off = api.onSettings((next) => setValue(next.frameTransparency));
    return () => {
      mounted = false;
      off();
    };
  }, []);
  return value;
}

export default function App(): React.JSX.Element {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => window.api.browser.onWindowFullscreen(setFullscreen), []);
  const frameTransparency = useFrameTransparency();
  const style = useMemo(
    () =>
      ({
        ...SIDEBAR_CARD_STYLE,
        ...frameGlassCssVars(frameTransparency),
      }) as React.CSSProperties,
    [frameTransparency],
  );
  const requestedSurface = new URLSearchParams(window.location.search).get(
    "surface",
  );
  const surface =
    requestedSurface === "toolbar" || requestedSurface === "sidebar"
      ? requestedSurface
      : "content";
  return (
    <div
      className="app-shell"
      data-platform={window.api.platform}
      data-surface={surface}
      data-fullscreen={fullscreen ? "true" : undefined}
      data-frame-solid={
        frameTransparencyAllowsGlass(frameTransparency) ? undefined : "true"
      }
      style={style}
    >
      <Browser surface={surface} />
    </div>
  );
}
