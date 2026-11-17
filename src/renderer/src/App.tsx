import { useEffect, useMemo, useState } from "react";
import Browser from "./views/Browser";
import {
  FRAME_TRANSPARENCY_DEFAULT,
  frameGlassCssVars,
  frameTransparencyAllowsGlass,
  sidebarCardCssVars,
} from "../../shared/sidebar-card";
import { sidebarMotionCssVars } from "../../shared/sidebar-motion";
import {
  DEFAULT_SIDEBAR_BACKDROP_SETTINGS,
  type SidebarPageMode,
} from "../../shared/sidebar-backdrop";

// One source for the sidebar card's geometry and its open/close timeline (main uses the same
// numbers for the overlay view).
const SIDEBAR_CARD_STYLE = {
  ...sidebarCardCssVars(),
  ...sidebarMotionCssVars(),
} as React.CSSProperties;

/**
 * Settings → Appearance → Frame transparency and Sidebar layout mode, live in every surface
 * (toolbar, sidebar, content): main broadcasts the settings to every window's renderers when they
 * change.
 */
function useFrameSettings(): {
  frameTransparency: number;
  sidebarPageMode: SidebarPageMode;
} {
  const [value, setValue] = useState({
    frameTransparency: FRAME_TRANSPARENCY_DEFAULT,
    sidebarPageMode: DEFAULT_SIDEBAR_BACKDROP_SETTINGS.sidebarPageMode,
  });
  useEffect(() => {
    const api = window.api.browser.sidebarBackdrop;
    if (!api) return;
    let mounted = true;
    const apply = (next: {
      frameTransparency: number;
      sidebarPageMode?: SidebarPageMode;
    }): void =>
      setValue({
        frameTransparency: next.frameTransparency,
        sidebarPageMode:
          next.sidebarPageMode ??
          DEFAULT_SIDEBAR_BACKDROP_SETTINGS.sidebarPageMode,
      });
    void api
      .get()
      .then((result) => {
        if (mounted) apply(result.settings);
      })
      .catch(() => undefined);
    const off = api.onSettings(apply);
    return () => {
      mounted = false;
      off();
    };
  }, []);
  return value;
}

export default function App(): React.JSX.Element {
  const [fullscreen, setFullscreen] = useState({
    windowFullscreen: false,
    nativeFullscreen: false,
    htmlFullscreen: false,
  });
  useEffect(() => {
    let mounted = true;
    let eventVersion = 0;
    const unsubscribe = window.api.browser.onWindowFullscreen(
      (windowFullscreen, nativeFullscreen, htmlFullscreen) => {
        eventVersion += 1;
        setFullscreen({ windowFullscreen, nativeFullscreen, htmlFullscreen });
      },
    );
    const queryVersion = eventVersion;
    void window.api.browser
      .getWindowFullscreenState()
      .then((state) => {
        if (mounted && eventVersion === queryVersion) setFullscreen(state);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  const { frameTransparency, sidebarPageMode } = useFrameSettings();
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
      data-fullscreen={fullscreen.windowFullscreen ? "true" : undefined}
      data-native-fullscreen={fullscreen.nativeFullscreen ? "true" : undefined}
      data-page-fullscreen={fullscreen.htmlFullscreen ? "true" : undefined}
      data-frame-solid={
        frameTransparencyAllowsGlass(frameTransparency) ? undefined : "true"
      }
      data-sidebar-push={sidebarPageMode !== "float" ? "true" : undefined}
      style={style}
    >
      <Browser surface={surface} />
    </div>
  );
}
