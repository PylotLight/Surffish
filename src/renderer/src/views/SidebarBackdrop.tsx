import { useEffect, useMemo, useRef, useState } from "react";
import type { SidebarBackdropState } from "../../../shared/sidebar-backdrop";

/**
 * The overlay sidebar's background over live pages (shared/sidebar-backdrop.ts has the why).
 * Only the 'sidebar' surface uses it; the content surface's sidebar sits over its own New Tab /
 * panel content, where its CSS backdrop-filter really does see what's underneath.
 */
export function useSidebarBackdrop(
  enabled: boolean,
  pageKey: string,
  onScreen: boolean,
): SidebarBackdropState | null {
  const [state, setState] = useState<SidebarBackdropState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const unsubscribe = window.api.browser.sidebarBackdrop.onState((next) => {
      if (mounted) setState(next);
    });
    void window.api.browser.sidebarBackdrop
      .get()
      .then(({ state: initial }) => {
        if (mounted) setState((current) => current ?? initial);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [enabled]);
  // Tab switch / navigation / load finished under an open sidebar: ask for a fresh snapshot (throttled in main).
  const lastKey = useRef(pageKey);
  useEffect(() => {
    if (!enabled || lastKey.current === pageKey) return;
    lastKey.current = pageKey;
    if (onScreen && state?.mode === "snapshot")
      void window.api.browser.sidebarBackdrop.refresh().catch(() => undefined);
  }, [enabled, pageKey, onScreen, state?.mode]);
  return state;
}

/** Blur radius applied once, in a canvas, to the (already 4x downscaled) snapshot. */
const CANVAS_BLUR_PX = 9;

/**
 * Snapshot mode: draws the page pieces under the sidebar into one canvas, blurred once (no
 * per-frame filter: the canvas is a static bitmap after this). Positioned in sidebar-view
 * coordinates, so it lines up with the page behind the card.
 */
export function SidebarBackdropLayer({
  state,
  cardRef,
}: {
  state: SidebarBackdropState | null;
  cardRef: React.RefObject<HTMLElement | null>;
}): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const images = useMemo(
    () => (state?.mode === "snapshot" ? state.images : []),
    [state],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return;
    if (images.length === 0) {
      setReady(false);
      return;
    }
    let cancelled = false;
    const scale = 0.5;
    const width = Math.max(...images.map((image) => image.x + image.width), 1);
    const height = Math.max(
      ...images.map((image) => image.y + image.height),
      1,
    );
    void Promise.all(
      images.map(
        (image) =>
          new Promise<HTMLImageElement | null>((resolve) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => resolve(null);
            element.src = image.dataUrl;
          }),
      ),
    ).then((loaded) => {
      if (cancelled) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      // Line the canvas up with the sidebar view's origin, whatever the card's inset/border is.
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      canvas.style.left = `${-rect.left - parseFloat(style.borderLeftWidth || "0")}px`;
      canvas.style.top = `${-rect.top - parseFloat(style.borderTopWidth || "0")}px`;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.filter = `blur(${CANVAS_BLUR_PX}px) saturate(1.35)`;
      loaded.forEach((element, index) => {
        const image = images[index];
        if (!element || !image) return;
        // Draw a little oversize so the blur doesn't fade to transparent at the strip edges.
        const pad = CANVAS_BLUR_PX * 2;
        context.drawImage(
          element,
          image.x * scale - pad,
          image.y * scale - pad,
          image.width * scale + pad * 2,
          image.height * scale + pad * 2,
        );
      });
      context.filter = "none";
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [images, cardRef]);

  if (state?.mode !== "snapshot") return null;
  return (
    <div
      className={`sidebar-backdrop${ready ? " is-ready" : ""}`}
      aria-hidden="true"
      data-testid="sidebar-backdrop"
    >
      <canvas ref={canvasRef} className="sidebar-backdrop-canvas" />
      <div className="sidebar-backdrop-tint" />
    </div>
  );
}

export function sidebarBackdropClass(
  surface: string,
  state: SidebarBackdropState | null,
): string {
  if (surface !== "sidebar") return "";
  return ` has-backdrop-${state?.mode ?? "solid"}${state?.framed ? " is-view-framed" : ""}`;
}
