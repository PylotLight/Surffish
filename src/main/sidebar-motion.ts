// Namespace import: browser-shell (and so this module) is loaded by plain bun unit tests, where
// 'electron' is just a path string and a named value import would fail to link.
import * as electron from "electron";
import type { WebContentsView } from "electron";
import {
  parseSidebarMotionMode,
  sidebarMotionAt,
  sidebarRevealWidth,
  sidebarSlideX,
  startSidebarMotion,
  SIDEBAR_MOTION_FRAME_MS,
  SIDEBAR_MOTION_MS,
  type SidebarMotion,
} from "../shared/sidebar-motion";

/**
 * Drives the overlay sidebar view along one open/close timeline (shared/sidebar-motion.ts).
 *
 * Two resting shapes:
 *  - with a rail (`rail: true`, the tab list): the view never leaves the window. Closed it is the
 *    card's icon rail at the left edge; opening grows it to the full sidebar width, so the panel
 *    is revealed beside the rail instead of sliding in from off-window.
 *  - without a rail (a full panel, or leaving the overlay for New Tab): closed the view waits fully
 *    slid out at its card width, and only its x moves. Nothing is resized while it is off screen.
 *
 * The native blur + tint (the view's own background) always moves and grows with the view, and the
 * renderer's card fills whatever width it is given (the panel has a fixed width and is clipped), so
 * an open/close never re-flows the sidebar. The view is hidden only once a close has landed with no
 * rail to show.
 *
 * SURFFISH_SIDEBAR_MOTION=native tries Electron's compositor-animated setBounds instead (no tint
 * ramp; on macOS the web contents may not follow the layer animation, so it is opt-in), =off snaps.
 */

const mode = parseSidebarMotionMode(process.env.SURFFISH_SIDEBAR_MOTION);

export interface SidebarMotionRect {
  y: number;
  width: number;
  height: number;
  /** Width of the collapsed icon rail; 0 means a closed sidebar is fully hidden. */
  railWidth?: number;
}

export interface SidebarMotionHooks {
  /** Every frame, with the eased progress (0 closed … 1 open): sidebar-backdrop ramps the native tint. */
  onProgress?: (progress: number) => void;
  /** A close has landed and there is no rail left to show (the view is hidden now). */
  onHidden?: () => void;
}

function prefersReducedMotion(): boolean {
  try {
    return (
      electron.systemPreferences?.getAnimationSettings?.()
        .prefersReducedMotion === true
    );
  } catch {
    return false;
  }
}

export class SidebarOverlayMotion {
  private progress = 0;
  private reported = -1;
  private appliedKey = "";
  private target: 0 | 1 = 0;
  private motion: SidebarMotion | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rect: SidebarMotionRect = { y: 0, width: 0, height: 0 };
  /** Closed, the view keeps the icon rail on screen instead of sliding fully out. */
  private rail = false;
  /** The panel has already been reported as closed (it collapses to the rail, or the view hides). */
  private closedNotified = true;

  constructor(
    private readonly view: WebContentsView,
    private readonly hooks: SidebarMotionHooks = {},
  ) {}

  /** True while the view is on screen (open, opening, still closing, or resting on its rail). */
  get onScreen(): boolean {
    return this.rail || this.target === 1 || this.progress > 0;
  }

  /** Lay out at the current progress (window resize, width drag, card inset change). */
  layout(rect: SidebarMotionRect): void {
    this.rect = { ...rect };
    this.apply();
  }

  /**
   * Open (true) or close (false) along the timeline; `animate: false` snaps (e.g. leaving live
   * pages). `rail` keeps a collapsed sidebar visible as its icon rail.
   */
  setOpen(
    open: boolean,
    {
      animate = true,
      rail = false,
    }: { animate?: boolean; rail?: boolean } = {},
  ): void {
    const to: 0 | 1 = open ? 1 : 0;
    const railChanged = rail !== this.rail;
    this.rail = rail;
    const instant =
      !animate ||
      mode === "off" ||
      prefersReducedMotion() ||
      this.rect.width <= 0;
    if (
      to === this.target &&
      !railChanged &&
      (this.motion || this.progress === to)
    ) {
      if (instant && this.motion) this.finish();
      return;
    }
    this.target = to;
    if (instant) {
      this.finish();
      return;
    }
    if (mode === "native") {
      this.runNative();
      return;
    }
    this.motion = startSidebarMotion(this.progress, to, Date.now(), {
      durationMs: SIDEBAR_MOTION_MS,
    });
    // Show before the first frame so the open starts from the rail (or the edge), not a hidden view.
    if (to === 1) this.view.setVisible(true);
    this.step();
  }

  dispose(): void {
    this.clearTimer();
    this.motion = null;
  }

  private step(): void {
    this.clearTimer();
    const motion = this.motion;
    if (!motion) return;
    const { progress, done } = sidebarMotionAt(motion, Date.now());
    this.progress = progress;
    if (done) {
      this.finish();
      return;
    }
    this.apply();
    this.timer = setTimeout(() => this.step(), SIDEBAR_MOTION_FRAME_MS);
  }

  private runNative(): void {
    this.clearTimer();
    this.motion = null;
    const to = this.target;
    const duration = Math.round(
      SIDEBAR_MOTION_MS * Math.abs(to - this.progress),
    );
    if (this.progress !== to) {
      // Start from wherever it is (the rail, or slid out) before asking for the animated move.
      this.applyFrame(this.progress);
      this.view.setVisible(true);
      const frame = this.frameAt(to);
      this.appliedKey = `${frame.x},${this.rect.y},${frame.width},${this.rect.height}`;
      this.view.setBounds(
        {
          x: frame.x,
          y: this.rect.y,
          width: frame.width,
          height: this.rect.height,
        },
        { animate: { duration, easing: "ease-out" } },
      );
      this.progress = to;
    }
    this.reported = to;
    this.hooks.onProgress?.(to);
    if (to === 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.target === 0) this.finish();
      }, duration + 16);
    }
  }

  private finish(): void {
    this.clearTimer();
    this.motion = null;
    this.progress = this.target;
    this.apply();
  }
  /** Where the view's frame sits at a given progress (x from the left, and its width). */
  private frameAt(progress: number): { x: number; width: number } {
    const { width, railWidth = 0 } = this.rect;
    if (this.rail && railWidth > 0)
      return {
        x: 0,
        width: sidebarRevealWidth(progress, { railWidth, width }),
      };
    return { x: sidebarSlideX(progress, width), width };
  }

  private apply(): void {
    const { height } = this.rect;
    this.applyFrame(this.progress);
    const visible = this.onScreen && this.rect.width > 0 && height > 0;
    // Hidden, not just slid away, once closed: nothing in it should paint or animate then.
    if (this.view.getVisible() !== visible) this.view.setVisible(visible);
    if (this.progress !== this.reported) {
      this.reported = this.progress;
      this.hooks.onProgress?.(this.progress);
    }
    this.notifyClosed();
  }

  /**
   * Tell the shell once the panel is closed — whether it landed on the rail (still visible) or the
   * view slid out entirely. Kept separate from visibility: the rail is on screen while closed.
   */
  private notifyClosed(): void {
    const closed = this.target === 0 && this.progress === 0;
    if (!closed) {
      this.closedNotified = false;
      return;
    }
    if (this.closedNotified) return;
    this.closedNotified = true;
    this.hooks.onHidden?.();
  }

  private applyFrame(progress: number): void {
    const { y, height } = this.rect;
    if (this.rect.width <= 0 || height <= 0) return;
    const { x, width } = this.frameAt(progress);
    const key = `${x},${y},${width},${height}`;
    // Layout runs on every chrome-state change; only touch the view when its frame really moves
    // (also keeps a native animated move from being snapped by an unrelated re-layout).
    if (key !== this.appliedKey) {
      this.appliedKey = key;
      this.view.setBounds({ x, y, width, height });
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
