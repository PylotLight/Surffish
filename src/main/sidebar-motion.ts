// Namespace import: browser-shell (and so this module) is loaded by plain bun unit tests, where
// 'electron' is just a path string and a named value import would fail to link.
import * as electron from 'electron'
import type { WebContentsView } from 'electron'
import {
  parseSidebarMotionMode,
  sidebarMotionAt,
  sidebarSlideX,
  startSidebarMotion,
  SIDEBAR_MOTION_FRAME_MS,
  SIDEBAR_MOTION_MS,
  type SidebarMotion
} from '../shared/sidebar-motion'

/**
 * Drives the overlay sidebar view along one open/close timeline (shared/sidebar-motion.ts).
 *
 * The view keeps its full card size the whole time and only its x changes: it slides in from
 * the left edge and back out, so the native blur + tint (the view's own background) and the card
 * drawn inside it move as one piece, and the sidebar renderer never gets a resize (the old
 * 0 → 320px width flip on every reveal made it re-lay out and could show a stale frame). The view
 * is hidden only once a close has fully landed, so its last painted frame is never a half-state
 * that flashes on the next reveal.
 *
 * SURFFISH_SIDEBAR_MOTION=native tries Electron's compositor-animated setBounds instead (no tint
 * ramp; on macOS the web contents may not follow the layer animation, so it is opt-in), =off snaps.
 */

const mode = parseSidebarMotionMode(process.env.SURFFISH_SIDEBAR_MOTION)

export interface SidebarMotionRect {
  y: number
  width: number
  height: number
}

export interface SidebarMotionHooks {
  /** Every frame, with the eased progress (0 hidden … 1 open): sidebar-backdrop ramps the native tint. */
  onProgress?: (progress: number) => void
  /** A close has landed (the view is hidden now). */
  onHidden?: () => void
}

function prefersReducedMotion(): boolean {
  try {
    return electron.systemPreferences?.getAnimationSettings?.().prefersReducedMotion === true
  } catch {
    return false
  }
}

export class SidebarOverlayMotion {
  private progress = 0
  private reported = -1
  private appliedKey = ''
  private target: 0 | 1 = 0
  private motion: SidebarMotion | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private rect: SidebarMotionRect = { y: 0, width: 0, height: 0 }

  constructor(private readonly view: WebContentsView, private readonly hooks: SidebarMotionHooks = {}) {}

  /** True while the view is on screen (open, opening or still closing). */
  get onScreen(): boolean {
    return this.target === 1 || this.progress > 0
  }

  /** Lay out at the current progress (window resize, width drag, card inset change). */
  layout(rect: SidebarMotionRect): void {
    this.rect = { ...rect }
    this.apply()
  }

  /** Open (true) or close (false) along the timeline; `animate: false` snaps (e.g. leaving live pages). */
  setOpen(open: boolean, { animate = true }: { animate?: boolean } = {}): void {
    const to: 0 | 1 = open ? 1 : 0
    const instant = !animate || mode === 'off' || prefersReducedMotion() || this.rect.width <= 0
    if (to === this.target && (this.motion || this.progress === to)) {
      if (instant && this.motion) this.finish()
      return
    }
    this.target = to
    if (instant) {
      this.finish()
      return
    }
    if (mode === 'native') {
      this.runNative()
      return
    }
    this.motion = startSidebarMotion(this.progress, to, Date.now(), { durationMs: SIDEBAR_MOTION_MS })
    // Show before the first frame so the slide starts from the edge, not from a hidden view.
    if (to === 1) this.view.setVisible(true)
    this.step()
  }

  dispose(): void {
    this.clearTimer()
    this.motion = null
  }

  private step(): void {
    this.clearTimer()
    const motion = this.motion
    if (!motion) return
    const { progress, done } = sidebarMotionAt(motion, Date.now())
    this.progress = progress
    if (done) {
      this.finish()
      return
    }
    this.apply()
    this.timer = setTimeout(() => this.step(), SIDEBAR_MOTION_FRAME_MS)
  }

  private runNative(): void {
    this.clearTimer()
    this.motion = null
    const { y, width, height } = this.rect
    const to = this.target
    if (to === 1) {
      if (this.progress === 0) {
        const x = sidebarSlideX(0, width)
        this.appliedKey = `${x},${y},${width},${height}`
        this.view.setBounds({ x, y, width, height })
      }
      this.view.setVisible(true)
      this.reported = 1
      this.hooks.onProgress?.(1)
    }
    const duration = Math.round(SIDEBAR_MOTION_MS * Math.abs(to - this.progress))
    const x = sidebarSlideX(to, width)
    this.appliedKey = `${x},${y},${width},${height}`
    this.view.setBounds({ x, y, width, height }, { animate: { duration, easing: 'ease-out' } })
    this.progress = to
    if (to === 0) {
      this.timer = setTimeout(() => {
        this.timer = null
        if (this.target === 0) this.finish()
      }, duration + 16)
    }
  }

  private finish(): void {
    this.clearTimer()
    this.motion = null
    this.progress = this.target
    this.apply()
    if (this.target === 0) this.hooks.onHidden?.()
  }

  private apply(): void {
    const { y, width, height } = this.rect
    const visible = this.onScreen && width > 0 && height > 0
    // Same size every frame (only x moves); a closed view waits fully slid out for the next reveal.
    if (width > 0 && height > 0) {
      const x = sidebarSlideX(this.progress, width)
      const key = `${x},${y},${width},${height}`
      // Layout runs on every chrome-state change; only touch the view when its frame really moves
      // (also keeps a native animated move from being snapped by an unrelated re-layout).
      if (key !== this.appliedKey) {
        this.appliedKey = key
        this.view.setBounds({ x, y, width, height })
      }
    }
    // Hidden, not just slid away, once closed: nothing in it should paint or animate then.
    if (this.view.getVisible() !== visible) this.view.setVisible(visible)
    if (this.progress !== this.reported) {
      this.reported = this.progress
      this.hooks.onProgress?.(this.progress)
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
