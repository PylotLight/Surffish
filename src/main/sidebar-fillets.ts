// Namespace import: loaded (through sidebar-backdrop) where 'electron' may be a plain path string.
import * as electron from "electron";
import type { BaseWindow, ImageView, NativeImage } from "electron";
import { deflateSync } from "node:zlib";
import {
  filletRgba,
  hoverPanelFilletRects,
  type FilletRect,
} from "../shared/frame-fillets";
import { PAGE_FRAME_RADIUS } from "../shared/sidebar-card";

/**
 * The hover panel's concave fillets over the page card (shared/frame-fillets.ts says why). Two
 * tiny ImageViews per window, stacked above the pages and below the sidebar view, painted once per
 * colour and only moved (setBounds) as the panel's edge moves; hidden whenever the panel isn't the
 * frame's opaque surface. Nothing here runs per frame beyond the bounds the slide already updates.
 */

type Corner = "top" | "bottom";
interface WindowFillets {
  top: ImageView;
  bottom: ImageView;
  colour: string;
  shown: Record<Corner, string>;
}

const perWindow = new WeakMap<BaseWindow, WindowFillets>();
const images = new Map<string, NativeImage>();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A minimal RGBA PNG (8-bit, no filtering): NativeImage decodes it on every platform. */
export function encodeRgbaPng(size: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.subarray(y * size * 4, (y + 1) * size * 4)).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/** The fillet image for a colour, with 1x, 2x and 3x pixels so it stays crisp on Retina. */
function filletImage(colour: string, corner: Corner): NativeImage {
  const key = `${colour}:${corner}`;
  const cached = images.get(key);
  if (cached) return cached;
  const radius = PAGE_FRAME_RADIUS;
  const image = electron.nativeImage.createFromBuffer(
    encodeRgbaPng(radius, filletRgba(radius, colour, corner)),
    { scaleFactor: 1 },
  );
  for (const scaleFactor of [2, 3]) {
    const size = radius * scaleFactor;
    image.addRepresentation({
      scaleFactor,
      width: radius,
      height: radius,
      buffer: encodeRgbaPng(size, filletRgba(size, colour, corner)),
    });
  }
  images.set(key, image);
  return image;
}

function createFillets(
  window: BaseWindow,
  sidebar: electron.View,
): WindowFillets | null {
  const ImageViewClass = electron.ImageView;
  if (typeof ImageViewClass !== "function" || window.isDestroyed()) return null;
  const make = (): ImageView => {
    const view = new ImageViewClass();
    view.setVisible(false);
    // Give the view its own compositor layer (Electron's View has no setPaintToLayer; the blur
    // setter creates one). Without a layer it would paint into the window's root layer, which is
    // under the page's layer, and never show.
    view.setBackgroundBlur(0);
    return view;
  };
  const fillets: WindowFillets = {
    top: make(),
    bottom: make(),
    colour: "",
    shown: { top: "", bottom: "" },
  };
  // Where the hover backdrop goes (sidebar-backdrop.ts): above every page, under the toolbar view
  // (which grows over the page for its popups) and the sidebar view.
  for (const view of [fillets.top, fillets.bottom]) {
    const index = window.contentView.children.indexOf(sidebar);
    window.contentView.addChildView(view, Math.max(0, index - 1));
  }
  perWindow.set(window, fillets);
  return fillets;
}

function place(
  fillets: WindowFillets,
  corner: Corner,
  rect: FilletRect | null,
): void {
  const view = fillets[corner];
  const key = rect ? `${rect.x},${rect.y},${rect.width},${rect.height}` : "";
  if (fillets.shown[corner] === key) return;
  fillets.shown[corner] = key;
  if (rect) view.setBounds(rect);
  view.setVisible(rect !== null);
}

/** Hide both fillets (panel closed, docked, mid-fade, or no page card). */
export function hideSidebarFillets(window: BaseWindow): void {
  const fillets = perWindow.get(window);
  if (!fillets || window.isDestroyed()) return;
  try {
    place(fillets, "top", null);
    place(fillets, "bottom", null);
  } catch {
    // The window is being torn down.
  }
}

/**
 * Place the fillets at the hover panel's right edge over the page card, painted in the frame's
 * surface colour. `opaque`: the panel is that opaque surface right now (hoverPanelIsOpaqueFrame).
 */
export function updateSidebarFillets(
  window: BaseWindow,
  {
    sidebar,
    card,
    colour,
    opaque,
  }: {
    sidebar: electron.View | null;
    card: FilletRect | null;
    colour: string;
    opaque: boolean;
  },
): void {
  if (window.isDestroyed() || !sidebar) return;
  const plan = opaque
    ? hoverPanelFilletRects({
        panel: sidebar.getBounds(),
        card,
        radius: PAGE_FRAME_RADIUS,
      })
    : null;
  let fillets = perWindow.get(window) ?? null;
  if (!plan) {
    if (fillets) hideSidebarFillets(window);
    return;
  }
  fillets ??= createFillets(window, sidebar);
  if (!fillets) return;
  try {
    if (fillets.colour !== colour) {
      fillets.colour = colour;
      fillets.top.setImage(filletImage(colour, "top"));
      fillets.bottom.setImage(filletImage(colour, "bottom"));
    }
    place(fillets, "top", plan.top);
    place(fillets, "bottom", plan.bottom);
  } catch (error) {
    console.warn("Could not place the sidebar fillets:", error);
    hideSidebarFillets(window);
  }
}
