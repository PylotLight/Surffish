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
  type SidebarMotionMode,
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
 * The native blur + tint sibling follows the view's bounds and motion progress, and the renderer's
 * card fills whatever width it is given (the panel has a fixed width and is clipped), so an
 * open/close never re-flows the sidebar. The view is hidden only once a close has landed with no
 * rail to show.
 *
 * SURFFISH_SIDEBAR_MOTION=native tries Electron's compositor-animated setBounds when no coordinated
 * frame hook is needed. With page/backdrop synchronization, use the shared frame stepper; =off snaps.
 */

const mode = parseSidebarMotionMode(process.env.SURFFISH_SIDEBAR_MOTION);

export interface SidebarMotionRect {
  y: number;
  width: number;
  height: number;
  /** Width of the collapsed icon rail; 0 means a closed sidebar is fully hidden. */
  railWidth?: number;
}

export interface SidebarMotionFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SidebarMotionHooks {
  /** Before the foreground bounds change, prepare the frame's backdrop and page edge. */
  onProgress?: (progress: number, frame: SidebarMotionFrame) => void;
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
    private readonly motionMode: SidebarMotionMode = mode,
  ) {}

  /** True while the view is on screen (open, opening, still closing, or resting on its rail). */
  get onScreen(): boolean {
    return this.rail || this.target === 1 || this.progress > 0;
  }

  /**
   * The view's right edge at the current progress (window px): the rail's edge when closed on its
   * rail, the full panel's edge when open, 0 when nothing is on screen. A pushed page card
   * (browser-shell.ts) follows this edge frame by frame.
   */
  get visibleRight(): number {
    if (!this.onScreen || this.rect.width <= 0 || this.rect.height <= 0)
      return 0;
    const { x, width } = this.frameAt(this.progress);
    return Math.max(0, x + width);
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
    if (this.motionMode === "native" && !this.hooks.onProgress) {
      this.runNative();
      return;
    }
    this.motion = startSidebarMotion(this.progress, to, Date.now(), {
      durationMs: SIDEBAR_MOTION_MS,
    });
    // apply() prepares the backing layer, sets the rail/edge frame, then makes it visible.
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
      const currentFrame = this.frameAt(this.progress);
      this.hooks.onProgress?.(this.progress, currentFrame);
      this.applyFrame(currentFrame);
      this.view.setVisible(true);
      const frame = this.frameAt(to);
      this.progress = to;
      this.hooks.onProgress?.(to, frame);
      this.appliedKey = this.frameKey(frame);
      this.view.setBounds(frame, { animate: { duration, easing: "ease-out" } });
    } else {
      this.hooks.onProgress?.(to, this.frameAt(to));
    }
    this.reported = to;
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
  private frameAt(progress: number): SidebarMotionFrame {
    const { y, width, height, railWidth = 0 } = this.rect;
    if (this.rail && railWidth > 0)
      return {
        x: 0,
        y,
        width: sidebarRevealWidth(progress, { railWidth, width }),
        height,
      };
    return { x: sidebarSlideX(progress, width), y, width, height };
  }

  private apply(): void {
    const { height } = this.rect;
    const frame = this.frameAt(this.progress);
    const key = this.frameKey(frame);
    const boundsChanged = key !== this.appliedKey;
    const visible = this.onScreen && this.rect.width > 0 && height > 0;
    const progressChanged = this.progress !== this.reported;
    if (progressChanged) this.reported = this.progress;
    if (progressChanged || boundsChanged) {
      // Move the backing material/page edge first; the foreground must never outrun its clip.
      this.hooks.onProgress?.(this.progress, frame);
    }
    if (boundsChanged) this.applyFrame(frame);
    // Hidden, not just slid away, once closed: nothing in it should paint or animate then.
    if (this.view.getVisible() !== visible) this.view.setVisible(visible);
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

  private frameKey(frame: SidebarMotionFrame): string {
    return `${frame.x},${frame.y},${frame.width},${frame.height}`;
  }

  private applyFrame(frame: SidebarMotionFrame): boolean {
    if (this.rect.width <= 0 || frame.height <= 0) return false;
    const key = this.frameKey(frame);
    // Layout runs on every chrome-state change; only touch the view when its frame really moves
    // (also keeps a native animated move from being snapped by an unrelated re-layout).
    if (key !== this.appliedKey) {
      this.appliedKey = key;
      this.view.setBounds(frame);
      return true;
    }
    return false;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
