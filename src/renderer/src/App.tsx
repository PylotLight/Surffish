import { useEffect, useState } from "react";
import Browser from "./views/Browser";
import { sidebarCardCssVars } from "../../shared/sidebar-card";
import { sidebarMotionCssVars } from "../../shared/sidebar-motion";

// One source for the sidebar card's geometry and its open/close timeline (main uses the same
// numbers for the overlay view).
const SIDEBAR_CARD_STYLE = {
  ...sidebarCardCssVars(),
  ...sidebarMotionCssVars(),
} as React.CSSProperties;

export default function App(): React.JSX.Element {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => window.api.browser.onWindowFullscreen(setFullscreen), []);
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
      style={SIDEBAR_CARD_STYLE}
    >
      <Browser surface={surface} />
    </div>
  );
}
