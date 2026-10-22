/**
 * Mini window in the menu bar: a mini window (or a 'tabs' collection) can live behind one Tray
 * status item instead of floating or being tucked to a screen edge. Clicking the item drops the mini
 * out as a panel anchored under the icon (above it for a taskbar at the bottom of the screen); click
 * again, press Esc or click elsewhere (unless pinned) and it hides. Hidden is not closed: the page
 * keeps running and audio keeps playing, like a tucked mini window.
 * Pure rules only (geometry, the show/hide state, the drop-in animation on the shared frame loop,
 * what is remembered); main/mini-window-menubar.ts owns the Tray and main/mini-window.ts the windows.
 */
import {
  easeInCubic,
  easeOutQuint,
  frameClock,
  type FrameLoop,
} from "./mini-window-motion";
import {
  MINI_WINDOW_MAX,
  MINI_WINDOW_MIN_SIZE,
  MINI_WINDOW_POPOUT_STRIP_HEIGHT,
  canPopOutUrl,
  type MiniRect,
  type MiniWindowMenuBarIcon,
} from "./mini-window";

/** Which mini windows live in the menu bar and the popout's size, kept across restarts (private tabs never). */
export const MINI_WINDOW_MENU_BAR_FILE = "mini-window-menubar.json";
/** The popout's page size (under its strip) until it is resized. */
export const MINI_MENU_BAR_DEFAULT_SIZE = { width: 400, height: 560 };

/**
 * The popout window for a page area of `page` (the size that is remembered): the always-on strip adds
 * to the window, so the page keeps the height it had before the strip existed.
 */
export function menuBarWindowSize(page: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: page.width,
    height: page.height + MINI_WINDOW_POPOUT_STRIP_HEIGHT,
  };
}

/** The page area of a popout window `window` big (what is remembered when the user resizes it). */
export function menuBarPageSize(window: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: window.width,
    height: Math.max(1, window.height - MINI_WINDOW_POPOUT_STRIP_HEIGHT),
  };
}
/** Gap between the icon (the menu bar) and the popout. */
export const MINI_MENU_BAR_GAP = 4;
/** Kept from the work area's sides when the icon sits near a screen edge. */
export const MINI_MENU_BAR_MARGIN = 8;
/** How far the popout slides into place (toward the icon on the way out) while it fades. */
export const MINI_MENU_BAR_DROP_PX = 8;
/** The drop-in's length (ease-out quint: most of the slide in the first few frames, then only the fade). */
export const MINI_MENU_BAR_DROP_MS = 210;
/** Going away: a quicker ease-in fade + slide back toward the icon, then hidden. */
export const MINI_MENU_BAR_CLOSE_MS = 150;
/**
 * A click on the icon this soon after the popout hid because it lost focus is the click that took the
 * focus away (pressing the icon blurs the popout first): it closes, never reopens.
 */
export const MINI_MENU_BAR_BLUR_CLICK_MS = 400;
/**
 * A blur this soon after the popout opened is not taken at once: macOS can take the key window away
 * for a moment while it comes up (a Space change, Surffish activating, the page taking first
 * responder). It hides when that time is up unless the popout got the focus back meanwhile.
 */
export const MINI_MENU_BAR_OPEN_BLUR_GRACE_MS = 200;
/**
 * macOS: swiping to another Space (desktop) takes the key window away from the popout, though it is
 * on every Space and stays on screen. A blur this close to a Space change (either side of it) is the
 * Space change, not a click elsewhere: the popout stays.
 */
export const MINI_MENU_BAR_SPACE_BLUR_MS = 700;
/**
 * macOS: a blur with no mouse button down (no click elsewhere: a Space swipe, Ctrl+arrow, ⌘Tab) waits
 * this long for the Space change notification before it is taken as a click-away.
 */
export const MINI_MENU_BAR_SPACE_SETTLE_MS = 600;

/** Does the Tray exist? 'in-use' only while a mini window lives in the menu bar; never one for 'never'. */
export function wantsMenuBarTray(
  mode: MiniWindowMenuBarIcon,
  inMenuBar: number,
): boolean {
  if (mode === "never") return false;
  return mode === "always" || inMenuBar > 0;
}

/** Text beside the icon (macOS): the count when several live there, and a note while one plays audio. */
export function menuBarTrayTitle(count: number, audio: boolean): string {
  return [count > 1 ? String(count) : "", audio ? "♪" : ""]
    .filter(Boolean)
    .join(" ");
}

/** The icon's tooltip: what lives there (the first few titles), and whether one is playing. */
export function menuBarTrayTooltip(
  titles: readonly string[],
  audio: boolean,
): string {
  if (titles.length === 0) return "Surffish mini window";
  const shown = titles
    .slice(0, 3)
    .map((title) => (title.length > 60 ? `${title.slice(0, 59)}…` : title));
  const more = titles.length > 3 ? ` +${titles.length - 3} more` : "";
  return `${shown.join(", ")}${more}${audio ? " (playing)" : ""}`;
}

export interface MenuBarDisplay {
  bounds: MiniRect;
  workArea: MiniRect;
}

/**
 * Where the popout goes for a click on the icon at `anchor` (the Tray's bounds; null or empty, as on
 * many Linux trays: the pointer at `cursor` stands in): centred under the icon, just below the menu
 * bar (its bottom or the work area's top, whichever is lower, so a notch's taller bar counts), or just
 * above the icon when it sits in the lower half of the display (a Windows/Linux taskbar at the bottom).
 * Fitted to the work area: its size never over it (nor under the minimum), its sides kept
 * MINI_MENU_BAR_MARGIN in. `side` says which way it opened (the drop-in comes from that side).
 */
export function menuBarPopoutBounds(
  anchor: MiniRect | null,
  cursor: { x: number; y: number },
  size: { width: number; height: number },
  display: MenuBarDisplay,
): { bounds: MiniRect; side: "below" | "above" } {
  const icon =
    anchor && anchor.width > 0 && anchor.height > 0
      ? anchor
      : { x: cursor.x, y: cursor.y, width: 0, height: 0 };
  const wa = display.workArea;
  const room = {
    width: Math.max(1, wa.width - 2 * MINI_MENU_BAR_MARGIN),
    height: Math.max(1, wa.height - 2 * MINI_MENU_BAR_GAP),
  };
  const width = Math.round(
    Math.min(room.width, Math.max(MINI_WINDOW_MIN_SIZE.width, size.width)),
  );
  const height = Math.round(
    Math.min(room.height, Math.max(MINI_WINDOW_MIN_SIZE.height, size.height)),
  );
  const centreX = icon.x + icon.width / 2;
  const centreY = icon.y + icon.height / 2;
  const minX =
    wa.x + Math.min(MINI_MENU_BAR_MARGIN, Math.max(0, (wa.width - width) / 2));
  const maxX =
    wa.x +
    wa.width -
    width -
    Math.min(MINI_MENU_BAR_MARGIN, Math.max(0, (wa.width - width) / 2));
  const x = Math.round(Math.min(maxX, Math.max(minX, centreX - width / 2)));
  const lowerHalf = centreY > display.bounds.y + display.bounds.height / 2;
  const side: "below" | "above" = lowerHalf ? "above" : "below";
  const wanted =
    side === "below"
      ? Math.max(icon.y + icon.height, wa.y) + MINI_MENU_BAR_GAP
      : Math.min(icon.y, wa.y + wa.height) - height - MINI_MENU_BAR_GAP;
  const y = Math.round(
    Math.min(wa.y + wa.height - height, Math.max(wa.y, wanted)),
  );
  return { bounds: { x, y, width, height }, side };
}

/**
 * The popout `v` of the way in (0: gone, 1: in place; already eased): `MINI_MENU_BAR_DROP_PX` short of
 * `target` toward the icon (`side` it opened on) scaled by what is left, faded to `opacity`·v. Offsets
 * are whole px, so the long tail of an ease-out only changes the opacity (no setBounds for it).
 */
export function menuBarPopoutFrame(
  target: MiniRect,
  side: "below" | "above",
  v: number,
  opacity: number,
): { rect: MiniRect; opacity: number } {
  const p = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  const offset =
    Math.round(MINI_MENU_BAR_DROP_PX * (1 - p)) * (side === "below" ? -1 : 1);
  return {
    rect: { ...target, y: target.y + offset },
    opacity: Math.round(opacity * p * 1000) / 1000,
  };
}

/** Frame `t` (0..1, linear time) of the drop-in: ease-out quint over `menuBarPopoutFrame`. */
export function menuBarDropFrame(
  target: MiniRect,
  side: "below" | "above",
  t: number,
  opacity: number,
): { rect: MiniRect; opacity: number } {
  return menuBarPopoutFrame(target, side, easeOutQuint(t), opacity);
}

/** Frame `t` (0..1, linear time) of going away from `from` (how far in it was): ease-in cubic. */
export function menuBarCloseFrame(
  target: MiniRect,
  side: "below" | "above",
  t: number,
  opacity: number,
  from = 1,
): { rect: MiniRect; opacity: number } {
  return menuBarPopoutFrame(target, side, from * (1 - easeInCubic(t)), opacity);
}

/** What happened to a blur of the popout (for the debug log). */
export type MenuBarBlurVerdict =
  /** Hidden, pinned or nothing to do. */
  | "ignored"
  /** A click elsewhere (or no way to tell): hidden. */
  | "hide"
  /** Right as it opened: held until the open grace is up. */
  | "hold-open"
  /** No click behind it (macOS): held for a Space change notification. */
  | "hold-space"
  /** A Space change (macOS): it stays shown. */
  | "space";

/** What a blur of the popout knows about why (macOS native; null where it can't tell). */
export interface MenuBarBlurEvidence {
  /** A mouse button is down right now (the click that took the focus); null: unknown. */
  mouseDown: boolean | null;
  /** When the active Space last changed (on `deps.now()`'s clock); null: never or unknown. */
  spaceChangedAt: number | null;
}

/** Was the Space changed close enough to `at` (either side, up to `now`) for a blur then to be it? */
export function spaceChangeExplainsBlur(
  spaceChangedAt: number | null,
  at: number,
  now: number,
): boolean {
  if (spaceChangedAt === null || !Number.isFinite(spaceChangedAt)) return false;
  return (
    spaceChangedAt <= now &&
    Math.abs(spaceChangedAt - at) <= MINI_MENU_BAR_SPACE_BLUR_MS
  );
}

/** Which menu bar mini a click on the icon shows: the one shown last when it is still there, else the newest. */
export function pickMenuBarMini<T>(
  entries: readonly T[],
  last: T | null,
): T | null {
  if (last !== null && entries.includes(last)) return last;
  return entries.at(-1) ?? null;
}

export interface MenuBarPopoutDeps {
  now(): number;
  loop: FrameLoop;
  /** Put the window at `rect` (queued in the loop's tick while animating). */
  place(rect: MiniRect): void;
  /** Window opacity (null: the platform has none, so it only drops in). */
  setOpacity: ((opacity: number) => void) | null;
  /** The opacity it settles at (Settings → Mini window → Opacity). */
  opacity(): number;
  /** Show the window (focused: it takes the keyboard, so Esc and clicks elsewhere reach it). */
  show(focus: boolean): void;
  hide(): void;
  reducedMotion(): boolean;
}

export interface MenuBarPopout {
  /** On screen (or dropping in); false as soon as it starts going away. */
  shown(): boolean;
  /** Drop in at `target`, coming from `side` (instant with reduced motion; from where it was when it is mid-close). */
  open(target: MiniRect, side: "below" | "above", focus: boolean): void;
  /**
   * Hide: a short fade + slide toward the icon, then hidden (`animate` false, reduced motion or no
   * opacity: at once). Called while it is already going away with `animate` false, it hides now.
   */
  close(animate?: boolean): void;
  /**
   * It lost focus: hide unless `pinned` (`evidence`: why, where the platform can tell). Within
   * MINI_MENU_BAR_OPEN_BLUR_GRACE_MS of opening it is held; with no click behind it (macOS) it is held
   * for MINI_MENU_BAR_SPACE_SETTLE_MS awaiting a Space change; next to a Space change it stays.
   * `blurPendingMs()` says how long until `settle()` for a held one.
   */
  blur(pinned: boolean, evidence?: MenuBarBlurEvidence): MenuBarBlurVerdict;
  /** It has the focus (again): a held blur is dropped. */
  focused(): void;
  /** Ms until a held blur should be settled (0: none held). */
  blurPendingMs(): number;
  /**
   * A held blur's time is up: 'space' when a Space change explains it (stays), 'hide' when it hid,
   * 'pending' when called early, 'none' when nothing is held (or pinned / hidden meanwhile).
   */
  settle(
    pinned: boolean,
    spaceChangedAt?: number | null,
  ): "hide" | "space" | "pending" | "none";
  /** The icon was clicked: what to do ('none' for the click that just blurred it shut). */
  click(): "show" | "hide" | "none";
  /** Mid drop-in or mid close. */
  animating(): boolean;
  /** Mid close (still on screen, fading out). */
  closing(): boolean;
  dispose(): void;
}

/** One menu bar mini's popout: shown/hidden, the drop-in and close on the shared frame loop, the icon click after a blur, and which blurs are click-aways. */
export function createMenuBarPopout(deps: MenuBarPopoutDeps): MenuBarPopout {
  const key = {};
  let shown = false;
  let animating = false;
  let closing = false;
  let blurHiddenAt = Number.NEGATIVE_INFINITY;
  let openedAt = Number.NEGATIVE_INFINITY;
  /** A held blur: when it came and when it is settled (null: none). */
  let held: { at: number; until: number } | null = null;
  /** How far in it is now (0..1, eased), so an interrupted open/close carries on from there. */
  let presence = 0;
  let lastTarget: MiniRect | null = null;
  let lastSide: "below" | "above" = "below";
  /** The close running is for a blur (its end restarts the icon-click guard). */
  let closingForBlur = false;

  function stop(): void {
    deps.loop.cancel(key);
    animating = false;
    closing = false;
    closingForBlur = false;
  }

  function finishHide(): void {
    stop();
    presence = 0;
    deps.hide();
  }

  function close(animate = true): void {
    held = null;
    if (!shown) {
      // Already going away: `animate` false (hidden underneath us, disposed) ends it now.
      if (closing && !animate) finishHide();
      return;
    }
    shown = false;
    const target = lastTarget;
    if (
      !animate ||
      !target ||
      deps.setOpacity === null ||
      deps.reducedMotion() ||
      presence <= 0
    ) {
      finishHide();
      return;
    }
    stop();
    const opacity = deps.opacity();
    const side = lastSide;
    const from = presence;
    const duration = Math.max(
      1,
      Math.round(MINI_MENU_BAR_CLOSE_MS * Math.max(0.4, from)),
    );
    animating = true;
    closing = true;
    const elapsed = frameClock(deps.loop);
    deps.loop.run(key, (now) => {
      const t = Math.min(1, elapsed(now) / duration);
      const frame = menuBarCloseFrame(target, side, t, opacity, from);
      presence = from * (1 - easeInCubic(t));
      if (t >= 1) {
        animating = false;
        closing = false;
        presence = 0;
        deps.setOpacity?.(0);
        deps.hide();
        // The icon click that blurred it lands after the fade: measured from when it really went.
        if (closingForBlur && blurHiddenAt > Number.NEGATIVE_INFINITY)
          blurHiddenAt = Math.max(blurHiddenAt, deps.now());
        closingForBlur = false;
        // Back in place at full opacity for next time (hidden: nothing shows it).
        deps.place(target);
        return false;
      }
      deps.place(frame.rect);
      deps.setOpacity?.(frame.opacity);
      return true;
    });
  }

  function hideForBlur(): void {
    held = null;
    blurHiddenAt = deps.now();
    close();
    if (closing) closingForBlur = true;
  }

  return {
    shown: () => shown,
    open: (target, side, focus) => {
      const resuming = closing ? presence : 0;
      stop();
      held = null;
      if (!shown || focus) openedAt = deps.now();
      lastTarget = { ...target };
      lastSide = side;
      const opacity = deps.opacity();
      if (deps.reducedMotion() || shown) {
        // Already up (another click while shown re-anchors it): just move there.
        deps.place(target);
        deps.setOpacity?.(opacity);
        if (!shown) deps.show(focus);
        else if (focus) deps.show(true);
        shown = true;
        presence = 1;
        return;
      }
      // Mid-close (still on screen): turn back from where it is, over what is left of the drop-in.
      const from = resuming;
      const first = menuBarPopoutFrame(target, side, from, opacity);
      deps.place(first.rect);
      deps.setOpacity?.(first.opacity);
      deps.show(focus);
      shown = true;
      animating = true;
      presence = from;
      const duration = Math.max(
        1,
        Math.round(MINI_MENU_BAR_DROP_MS * Math.max(0.4, 1 - from)),
      );
      const elapsed = frameClock(deps.loop);
      deps.loop.run(key, (now) => {
        if (!shown) {
          animating = false;
          return false;
        }
        const t = Math.min(1, elapsed(now) / duration);
        const v = from + (1 - from) * easeOutQuint(t);
        const frame = menuBarPopoutFrame(target, side, v, opacity);
        presence = v;
        deps.place(frame.rect);
        deps.setOpacity?.(frame.opacity);
        if (t >= 1) {
          animating = false;
          presence = 1;
          return false;
        }
        return true;
      });
    },
    close,
    blur: (pinned, evidence) => {
      if (!shown || pinned) return "ignored";
      const now = deps.now();
      if (
        evidence &&
        spaceChangeExplainsBlur(evidence.spaceChangedAt, now, now)
      ) {
        held = null;
        return "space";
      }
      if (now - openedAt < MINI_MENU_BAR_OPEN_BLUR_GRACE_MS) {
        held = { at: now, until: openedAt + MINI_MENU_BAR_OPEN_BLUR_GRACE_MS };
        return "hold-open";
      }
      if (evidence?.mouseDown === false) {
        held = { at: now, until: now + MINI_MENU_BAR_SPACE_SETTLE_MS };
        return "hold-space";
      }
      hideForBlur();
      return "hide";
    },
    focused: () => {
      held = null;
    },
    blurPendingMs: () =>
      held && shown ? Math.max(1, Math.ceil(held.until - deps.now())) : 0,
    settle: (pinned, spaceChangedAt = null) => {
      if (!held) return "none";
      if (!shown || pinned) {
        held = null;
        return "none";
      }
      const now = deps.now();
      if (spaceChangeExplainsBlur(spaceChangedAt, held.at, now)) {
        held = null;
        return "space";
      }
      if (now < held.until) return "pending";
      hideForBlur();
      return "hide";
    },
    click: () => {
      if (shown) return "hide";
      if (deps.now() - blurHiddenAt < MINI_MENU_BAR_BLUR_CLICK_MS) {
        blurHiddenAt = Number.NEGATIVE_INFINITY;
        return "none";
      }
      return "show";
    },
    animating: () => animating,
    closing: () => closing,
    dispose: () => {
      stop();
      held = null;
      shown = false;
      presence = 0;
    },
  };
}

export interface MenuBarSaved {
  /** The popout's size (null: the default). */
  size: { width: number; height: number } | null;
  /** Pages living in the menu bar at the last save, oldest first (never private ones). */
  urls: string[];
}

/** The menu bar file as stored: anything unreadable is dropped. */
export function parseMenuBarSaved(value: unknown): MenuBarSaved {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const raw = record.size as Record<string, unknown> | undefined;
  const width =
    typeof raw?.width === "number" && Number.isFinite(raw.width)
      ? Math.round(raw.width)
      : 0;
  const height =
    typeof raw?.height === "number" && Number.isFinite(raw.height)
      ? Math.round(raw.height)
      : 0;
  const size =
    width >= MINI_WINDOW_MIN_SIZE.width &&
    height >= MINI_WINDOW_MIN_SIZE.height &&
    width <= 10000 &&
    height <= 10000
      ? { width, height }
      : null;
  const urls = Array.isArray(record.urls)
    ? record.urls
        .filter(
          (url): url is string =>
            typeof url === "string" && url.length <= 8192 && canPopOutUrl(url),
        )
        .slice(0, MINI_WINDOW_MAX)
    : [];
  return { size, urls };
}

/**
 * After a restart the menu bar minis' tabs come back as ordinary tabs at the end of their windows
 * (that is how every mini window tab is saved). Pick them back out: for each saved URL, the last
 * restored tab with that URL not already picked. Tab ids in `urls`' order (missing ones skipped).
 */
export function pickRestoredMenuBarTabs(
  urls: readonly string[],
  candidates: ReadonlyArray<{ tabId: string; url: string }>,
): string[] {
  const taken = new Set<string>();
  const picked: string[] = [];
  for (const url of urls) {
    const match = [...candidates]
      .reverse()
      .find(
        (candidate) => candidate.url === url && !taken.has(candidate.tabId),
      );
    if (!match) continue;
    taken.add(match.tabId);
    picked.push(match.tabId);
  }
  return picked;
}
