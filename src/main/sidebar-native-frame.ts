import type { Rectangle, View } from "electron";
import { SIDEBAR_FLOAT, sidebarFloatCardRect } from "../shared/sidebar-card";

/** Apply the native backing surface's corner shape before exposing its new compositor bounds. */
export function applySidebarBackdropFrame(
  view: Pick<View, "setBorderRadius" | "setBounds">,
  frame: Rectangle,
  floating: boolean,
): Rectangle {
  const bounds = floating ? sidebarFloatCardRect(frame) : frame;
  view.setBorderRadius(floating ? SIDEBAR_FLOAT.radius : 0);
  view.setBounds(bounds);
  return bounds;
}
