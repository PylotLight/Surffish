/**
 * One timeline for the overlay sidebar's open/close.
 *
 * Over live pages the sidebar is its own WebContentsView, and with the native blur the view
 * itself is the dark, blurred card (main sets its background colour + blur). A CSS transform
 * inside the view can only move the view's *contents*, so the old behaviour was a tint/blur that
 * popped in at full strength while the panel slid in 260ms later, and a close that cut both
 * instantly. Now main drives the view itself along this timeline (it slides as one piece, and
 * the native tint/blur ramp with the same progress), and the in-page sidebar's CSS transition
 * reads the same duration and curve from the custom properties below.
 */

/** Open and close take the same time and curve (CSS, the overlay view and its tint all use these). */
export const SIDEBAR_MOTION_MS = 200;
/** cubic-bezier control points: a quick start that settles softly (the sidebar's existing curve). */
export const SIDEBAR_MOTION_EASING: readonly [number, number, number, number] =
  [0.2, 0.8, 0.2, 1];
/** Frame pacing for the main-process stepper (ms). ~120 Hz so ProMotion displays don't see steps. */
export const SIDEBAR_MOTION_FRAME_MS = 8;

export function sidebarMotionEasingCss(
  easing: readonly [number, number, number, number] = SIDEBAR_MOTION_EASING,
): string {
  return `cubic-bezier(${easing.join(", ")})`;
}

/** CSS custom properties the renderer sets on `.app-shell` so the in-page sidebar uses the same timeline. */
export function sidebarMotionCssVars(): Record<string, string> {
  return {
    "--sidebar-motion-duration": `${SIDEBAR_MOTION_MS}ms`,
    "--sidebar-motion-easing": sidebarMotionEasingCss(),
  };
}

/**
 * CSS-compatible cubic-bezier timing function (x = time fraction in, y = progress out).
 * Newton-Raphson with a bisection fallback, like the browsers do it.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number): number => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  const solve = (x: number): number => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(s) - x;
      if (Math.abs(error) < 1e-6) return s;
      const slope = slopeX(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let low = 0;
    let high = 1;
    s = x;
    for (let i = 0; i < 30; i++) {
      const value = sampleX(s);
      if (Math.abs(value - x) < 1e-6) return s;
      if (x > value) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return s;
  };
  return (t: number): number => {
    if (!Number.isFinite(t) || t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solve(t));
  };
}

const ease = cubicBezier(...SIDEBAR_MOTION_EASING);

/** A running open (target 1) or close (target 0). Progress 0 = fully hidden, 1 = fully open. */
export interface SidebarMotion {
  from: number;
  to: 0 | 1;
  startedAt: number;
  durationMs: number;
}

/**
 * Start (or retarget) a motion from wherever the sidebar is now. A close that interrupts a
 * half-finished open runs for the share of the duration it has left to travel, so reversing
 * mid-way never jumps and never takes longer than a full open would.
 */
export function startSidebarMotion(
  current: number,
  to: 0 | 1,
  now: number,
  { durationMs = SIDEBAR_MOTION_MS, reducedMotion = false } = {},
): SidebarMotion {
  const from = clamp01(current);
  const distance = Math.abs(to - from);
  return {
    from,
    to,
    startedAt: now,
    durationMs: reducedMotion ? 0 : Math.round(durationMs * distance),
  };
}

/** Where a motion is at `now` (eased), and whether it has landed. */
export function sidebarMotionAt(
  motion: SidebarMotion,
  now: number,
): { progress: number; done: boolean } {
  if (motion.durationMs <= 0) return { progress: motion.to, done: true };
  const t = (now - motion.startedAt) / motion.durationMs;
  if (t >= 1) return { progress: motion.to, done: true };
  const eased = ease(Math.max(0, t));
  return {
    progress: motion.from + (motion.to - motion.from) * eased,
    done: false,
  };
}

/**
 * The overlay view's x for a given progress: slid left by the hidden share of its width, so the
 * card (and the native blur/tint that is the view's own background) moves as one piece. Same
 * size every frame: only the origin changes, so the sidebar renderer never re-lays out.
 */
export function sidebarSlideX(progress: number, width: number): number {
  const hidden = Math.round((1 - clamp01(progress)) * Math.max(0, width));
  return hidden === 0 ? 0 : -hidden;
}

/**
 * Scale the alpha of an ARGB hex colour (`#AARRGGBB`, Electron's View.setBackgroundColor format)
 * by `factor`, so the native tint fades with the slide instead of popping in at full strength.
 * Anything that isn't `#AARRGGBB` comes back unchanged.
 */
export function scaleArgbAlpha(color: string, factor: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const alpha = Math.round(parseInt(match[1]!, 16) * clamp01(factor));
  return `#${alpha.toString(16).padStart(2, "0").toUpperCase()}${match[2]!.toUpperCase()}`;
}

/** 'stepped' (default): main moves the view frame by frame. 'native': Electron's animated setBounds (experimental). 'off': snap. */
export type SidebarMotionMode = "stepped" | "native" | "off";

export function parseSidebarMotionMode(
  value: string | undefined,
): SidebarMotionMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "native" || normalized === "off"
    ? normalized
    : "stepped";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
