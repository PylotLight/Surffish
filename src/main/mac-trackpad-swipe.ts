import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseWindow } from "electron";
import {
  parseSwipeIntentOverride,
  shouldCommitSwipe,
  swipeIntentForRequest,
} from "../shared/swipe-intent";

export type MacTrackpadSwipeDirection = "back" | "forward";

export interface MacTrackpadSwipeBeginRequest {
  windowHandle: Buffer;
  x: number;
  y: number;
  direction: MacTrackpadSwipeDirection;
  /** Running scroll totals since the fingers went down (newer native builds): the intent check reads them. */
  dx?: number;
  dy?: number;
  elapsedMs?: number;
}

/** The native module keeps watching the gesture (neither start nor refuse) when onBegin returns this. */
export const MAC_SWIPE_KEEP_WATCHING = -1;

// Deadzone + intent thresholds (shared/swipe-intent.ts); SURFFISH_SWIPE_INTENT tunes them on a real trackpad.
const swipeIntent = parseSwipeIntentOverride(process.env.SURFFISH_SWIPE_INTENT);
const swipeDebug = process.env.SURFFISH_SWIPE_DEBUG === "1";

export interface MacTrackpadSwipeCallbacks {
  onBegin(request: MacTrackpadSwipeBeginRequest): number | undefined;
  onProgress(contentsId: number, progress: number): void;
  onEnd(
    contentsId: number,
    direction: MacTrackpadSwipeDirection,
    committed: boolean,
    maxProgress: number,
  ): void;
  /**
   * Pinch phases with the running NSEvent magnification (negative = pinching in). Return true from
   * 'begin' to take the pinch over: the page then sees none of it and 'change'/'end'/'cancel' follow.
   */
  onPinch(phase: MacTrackpadPinchPhase, magnification: number): boolean;
}

export type MacTrackpadPinchPhase = "begin" | "change" | "end" | "cancel";

interface NativeMacTrackpadSwipeAddon {
  start(callbacks: MacTrackpadSwipeCallbacks): void;
  stop(): void;
  isSwipeTrackingEnabled(): boolean;
}

let addon: NativeMacTrackpadSwipeAddon | null = null;
const requireFromMain = createRequire(import.meta.url);

export function startMacTrackpadSwipe(
  _window: BaseWindow,
  callbacks: MacTrackpadSwipeCallbacks,
): boolean {
  if (process.platform !== "darwin") return false;
  stopMacTrackpadSwipe();

  const addonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../native/mac-trackpad-swipe.node",
  );
  if (!existsSync(addonPath)) {
    console.warn(
      "[trackpad swipe] Native module was not built; two-finger navigation is unavailable in this run.",
    );
    return false;
  }

  try {
    const nativeAddon = requireFromMain(
      addonPath,
    ) as NativeMacTrackpadSwipeAddon;
    nativeAddon.start({
      onBegin: (request) => {
        try {
          // Slow sideways drift and mostly-vertical scrolls never start a history swipe.
          const intent = swipeIntentForRequest(request, swipeIntent);
          if (swipeDebug && intent !== "wait")
            console.info("[trackpad swipe] intent", intent, {
              dx: request.dx,
              dy: request.dy,
              elapsedMs: request.elapsedMs,
            });
          if (intent === "wait") return MAC_SWIPE_KEEP_WATCHING;
          if (intent === "refuse") return undefined;
          return callbacks.onBegin(request);
        } catch (error) {
          console.error(
            "[trackpad swipe] Could not validate gesture start:",
            error,
          );
          return undefined;
        }
      },
      onProgress: (contentsId, progress) => {
        try {
          callbacks.onProgress(contentsId, progress);
        } catch (error) {
          console.error(
            "[trackpad swipe] Could not update gesture progress:",
            error,
          );
        }
      },
      onEnd: (contentsId, direction, committed, maxProgress) => {
        try {
          // A flick that barely moved the page doesn't navigate (AppKit can call that committed).
          const keep = shouldCommitSwipe(committed, maxProgress, swipeIntent);
          if (swipeDebug && committed && !keep)
            console.info("[trackpad swipe] commit refused: too short", {
              maxProgress,
            });
          callbacks.onEnd(contentsId, direction, keep, maxProgress);
        } catch (error) {
          console.error("[trackpad swipe] Could not finish gesture:", error);
        }
      },
      onPinch: (phase, magnification) => {
        try {
          return callbacks.onPinch(phase, magnification) === true;
        } catch (error) {
          console.error("[trackpad swipe] Could not handle pinch:", error);
          return false;
        }
      },
    });
    addon = nativeAddon;
    console.info(
      "[trackpad swipe] AppKit phased-scroll navigation ready; legacy macOS page-swipe setting:",
      nativeAddon.isSwipeTrackingEnabled(),
    );
    return true;
  } catch (error) {
    console.error("[trackpad swipe] Native module could not be loaded:", error);
    return false;
  }
}

export function stopMacTrackpadSwipe(): void {
  const current = addon;
  addon = null;
  if (!current) return;
  try {
    current.stop();
  } catch (error) {
    console.warn(
      "[trackpad swipe] Could not stop native gesture capture:",
      error,
    );
  }
}
