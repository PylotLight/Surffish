// Namespace import: loaded (through sidebar-backdrop) where 'electron' may be a plain path string.
import * as electron from "electron";
import type { BaseWindow, View } from "electron";
import { sidebarFloatShadowRects, type CardRect } from "../shared/sidebar-card";
import { scaleArgbAlpha } from "../shared/sidebar-motion";

/**
 * The floating hover card's soft shadow (shared/sidebar-card.ts SIDEBAR_FLOAT_SHADOW): a few
 * background-only Views per window, stacked above the pages and below the card's glass layer, each
 * a translucent black rounded rect a little larger than the card. Solid colour layers only (no
 * blur, no bitmaps), created on first use, moved with the bounds the slide already updates and
 * shown at full strength whenever the card is floating on screen.
 */

interface WindowShadow {
  layers: View[];
  key: string;
}

const perWindow = new WeakMap<BaseWindow, WindowShadow>();

function createShadow(
  window: BaseWindow,
  below: View,
  count: number,
): WindowShadow | null {
  const ViewClass = electron.View;
  if (typeof ViewClass !== "function" || window.isDestroyed()) return null;
  const layers: View[] = [];
  for (let i = 0; i < count; i++) {
    const view = new ViewClass();
    view.setVisible(false);
    // Give the view its own compositor layer (the blur setter creates one): without a layer it
    // paints into the window's root layer, which is under the pages, and never shows.
    view.setBackgroundBlur(0);
    layers.push(view);
  }
  // Widest (faintest) first, so each tighter layer stacks above it; all directly under `below`.
  for (const view of [...layers].reverse()) {
    const index = window.contentView.children.indexOf(below);
    window.contentView.addChildView(view, Math.max(0, index));
  }
  const shadow = { layers, key: "" };
  perWindow.set(window, shadow);
  return shadow;
}

/** Hide the shadow (card closed, docked, not floating). */
export function hideSidebarCardShadow(window: BaseWindow): void {
  const shadow = perWindow.get(window);
  if (!shadow || window.isDestroyed() || shadow.key === "") return;
  shadow.key = "";
  try {
    for (const view of shadow.layers) view.setVisible(false);
  } catch {
    // The window is being torn down.
  }
}

/**
 * Place the shadow around the floating card at `card` (window DIPs), at `strength` 0..1, directly
 * under `below` (the card's native backing layer, or the sidebar view).
 */
export function updateSidebarCardShadow(
  window: BaseWindow,
  {
    card,
    below,
    strength,
  }: { card: CardRect | null; below: View | null; strength: number },
): void {
  if (window.isDestroyed()) return;
  const rects = card && strength > 0 ? sidebarFloatShadowRects(card) : [];
  if (!below || rects.length === 0) {
    hideSidebarCardShadow(window);
    return;
  }
  const level = Math.round(Math.min(1, strength) * 20) / 20;
  const key = `${JSON.stringify(rects)}@${level}`;
  let shadow = perWindow.get(window) ?? null;
  if (shadow?.key === key) return;
  shadow ??= createShadow(window, below, rects.length);
  if (!shadow) return;
  shadow.key = key;
  try {
    rects.forEach((rect, i) => {
      const view = shadow.layers[i];
      if (!view) return;
      view.setBorderRadius(rect.radius);
      view.setBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      view.setBackgroundColor(scaleArgbAlpha(alphaBlack(rect.alpha), level));
      view.setVisible(true);
    });
  } catch (error) {
    console.warn("Could not place the sidebar card shadow:", error);
    hideSidebarCardShadow(window);
  }
}

/** `#AA000000` for an alpha 0..1. */
function alphaBlack(alpha: number): string {
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `#${value.toString(16).padStart(2, "0").toUpperCase()}000000`;
}
