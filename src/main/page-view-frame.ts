import type { Rectangle, View } from "electron";

const pageCornerRadii = new WeakMap<View, number>();

/** Set the native page corner first, so a bounds change never exposes a square frame for a paint. */
export function applyPageViewFrame(
  view: View,
  bounds: Rectangle | null,
  radius: number,
): void {
  if ((pageCornerRadii.get(view) ?? 0) !== radius) {
    pageCornerRadii.set(view, radius);
    view.setBorderRadius(radius);
  }
  if (bounds) view.setBounds(bounds);
}
