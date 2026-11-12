/**
 * The page card's rounded inner corners where a hover-revealed sidebar panel crosses it.
 *
 * The page card is rounded with View.setBorderRadius (PAGE_FRAME_RADIUS), and in the rail and
 * docked states those corners sit in the open frame, so they show. A hover reveal slides the panel
 * out over the card without moving or resizing the page (no reflow), so the card's own top-left
 * and bottom-left corners are under the panel, and what the eye reads as the card's corner is
 * where the panel's straight right edge crosses the card's straight top (and bottom) edge: a hard
 * square corner. Electron's compositor draws the page and the sidebar into one layer tree, so the
 * page can't be clipped to the panel's edge without resizing it every frame; instead two small
 * concave fillets in the frame's surface colour sit at the panel's right edge, above the page and
 * below the sidebar, and round that corner the same way the card's own corners are rounded.
 *
 * The fillets only make sense where the panel is the frame's opaque surface at that moment: the
 * solid backdrop always, the native backdrop once its open fade has finished (it is translucent
 * and blurred on the way in and out), never the snapshot backdrop (a gradient over a page picture).
 */
import type { SidebarBackdropMode } from "./sidebar-backdrop";

export interface FilletRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The two fillets' window rects (DIPs). A side is null when the panel doesn't reach that edge. */
export interface HoverPanelFillets {
  top: FilletRect | null;
  bottom: FilletRect | null;
}

/**
 * Whether the hover panel is the frame's opaque surface right now, so a frame-coloured fillet at
 * its edge matches it exactly. Docked panels have no fillets: the card sits beside them with its
 * own rounded corners in the open frame gap.
 */
export function hoverPanelIsOpaqueFrame({
  mode,
  docked,
  visible,
  progress,
}: {
  mode: SidebarBackdropMode;
  docked: boolean;
  visible: boolean;
  progress: number;
}): boolean {
  if (docked || !visible || !(progress > 0)) return false;
  if (mode === "solid") return true;
  if (mode === "native") return progress >= 1;
  return false;
}

/**
 * Where the fillets go for a panel (the overlay sidebar view's bounds, its right edge being the
 * panel's right edge) over a page card. Null when there is nothing to round: no card, a panel
 * whose edge isn't inside the card (the rail, or a panel narrower than the gap beside the rail),
 * or a card too small for two corners.
 */
export function hoverPanelFilletRects({
  panel,
  card,
  radius,
}: {
  panel: FilletRect;
  card: FilletRect | null;
  radius: number;
}): HoverPanelFillets | null {
  const r = Math.round(radius);
  if (!card || r <= 0) return null;
  if (!(panel.width > 0) || !(panel.height > 0)) return null;
  if (card.width < r * 2 || card.height < r * 2) return null;
  const edge = Math.round(panel.x + panel.width);
  // Only once the panel covers the card's own rounded corner (r px in from its left edge), and
  // never past its right side.
  if (edge < card.x + r || edge + r > card.x + card.width) return null;
  const cardBottom = card.y + card.height;
  const top =
    panel.y <= card.y ? { x: edge, y: card.y, width: r, height: r } : null;
  const bottom =
    panel.y + panel.height >= cardBottom
      ? { x: edge, y: cardBottom - r, width: r, height: r }
      : null;
  if (!top && !bottom) return null;
  return { top, bottom };
}

/**
 * Coverage (0..1) of the frame colour at pixel (px, py) of a size×size fillet bitmap. The arc is a
 * quarter circle of radius `size` centred on the fillet's inner corner: bottom-right for the top
 * fillet (the card is below and to the right), top-right for the bottom fillet. Outside the circle
 * is frame, inside is the page. 4×4 supersampled for a smooth edge.
 */
export function filletCoverage(
  px: number,
  py: number,
  size: number,
  corner: "top" | "bottom",
): number {
  const cx = size;
  const cy = corner === "top" ? size : 0;
  const samples = 4;
  let outside = 0;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const x = px + (sx + 0.5) / samples;
      const y = py + (sy + 0.5) / samples;
      if ((x - cx) ** 2 + (y - cy) ** 2 > size * size) outside++;
    }
  }
  return outside / (samples * samples);
}

/** `#AARRGGBB` → [r, g, b, a] bytes (a frame surface colour, as View.setBackgroundColor takes it). */
export function argbBytes(argb: string): [number, number, number, number] {
  const value = argb.replace(/^#/, "");
  const hex = (start: number) => parseInt(value.slice(start, start + 2), 16);
  return [hex(2), hex(4), hex(6), hex(0)];
}

/** A fillet as straight (non-premultiplied) RGBA rows, `size` px square, in `argb`'s colour. */
export function filletRgba(
  size: number,
  argb: string,
  corner: "top" | "bottom",
): Uint8Array {
  const [r, g, b, a] = argbBytes(argb);
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = Math.round(a * filletCoverage(x, y, size, corner));
    }
  }
  return pixels;
}
