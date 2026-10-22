import { isSettingsUrl } from "../../../shared/settings-tab";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserTabSummary } from "../../../shared/types";
import { describeTabSleep, isRestoredSleep } from "../../../shared/tab-sleep";
import { tabAudioIndicator } from "../../../shared/tab-audio";
import {
  formatTabVolume,
  stepTabVolume,
  TAB_VOLUME_WHEEL_STEP,
  tabVolumeLevel,
  type TabVolumeLevel,
} from "../../../shared/tab-volume";

/** Favicon / loading spinner, audio mute + volume control and pinned-tab icon used by the tab sidebar. */
/**
 * `animate` is false while this surface's sidebar is off screen: an animation keeps ticking (and
 * repainting the blurred sidebar) even under visibility:hidden, so the arc then sits still.
 */
export function TabFavicon({
  tab,
  animate = true,
}: {
  tab: BrowserTabSummary;
  animate?: boolean;
}): React.JSX.Element {
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => setIconFailed(false), [tab.faviconUrl]);
  return (
    <span
      className={`tab-favicon${tab.loading ? " is-loading" : ""}`}
      aria-hidden="true"
    >
      {tab.loading ? (
        <svg
          className="tab-spinner"
          viewBox="0 0 24 24"
          shapeRendering="geometricPrecision"
        >
          <circle className="tab-spinner-track" cx="12" cy="12" r="9" />
          {/* The arc travels round the ring by animating stroke-dashoffset (CSS, Browser.css), so it
              is vector-drawn every frame and never handed to the compositor: a CSS transform (on the
              svg or on a <g>) gets rasterised into a layer and wobbles into a lumpy squircle at
              favicon size. It used to be a SMIL <animateTransform>, but Chromium held a freshly
              mounted SMIL arc still for one whole cycle (0.9 s) before it turned, which is what
              selecting a sleeping tab showed. A CSS animation moves from the first frame. */}
          <circle
            className={`tab-spinner-arc${animate ? " is-turning" : ""}`}
            cx="12"
            cy="12"
            r="9"
            pathLength="100"
          />
        </svg>
      ) : isSettingsUrl(tab.url) ? (
        <svg
          className="tab-favicon-settings"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      ) : tab.faviconUrl && !iconFailed ? (
        <img
          src={tab.faviconUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setIconFailed(true)}
        />
      ) : (
        tab.title.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

const SPEAKER_WAVES: Record<TabVolumeLevel, React.JSX.Element | null> = {
  muted: <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />,
  off: null,
  low: <path className="tab-audio-wave1" d="M15 9.2a4 4 0 0 1 0 5.6" />,
  high: (
    <>
      <path className="tab-audio-wave1" d="M15 9.2a4 4 0 0 1 0 5.6" />
      <path className="tab-audio-wave2" d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),
};
/** Wheel pixels per 5% step (Chromium reports a mouse notch as 100px). */
const WHEEL_PIXELS_PER_STEP = 100;

/**
 * The tab's speaker (shared/tab-audio.ts): shown while the tab is audible or muted; a quiet tab that
 * was heard (or has a non-default volume) keeps it only while the row is hovered (`is-idle`), so a
 * muted autoplay video never lights it. Click mutes, the scroll wheel steps the tab volume 5%, and
 * hovering it slides out a volume slider (the title gives way).
 */
export function TabAudioButton({
  tab,
  className = "",
}: {
  tab: BrowserTabSummary;
  className?: string;
}): React.JSX.Element | null {
  const saved = tab.volume ?? 1;
  // While the slider is dragged (and until main echoes the level back) the control shows its own value.
  const [local, setLocal] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const volume = local ?? saved;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const indicator = tabAudioIndicator({
    audible: tab.audible,
    muted: tab.muted,
    heard: tab.audioHeard === true,
    volume: saved,
  });
  const shown = indicator !== "none";
  const tabId = tab.id;

  const send = useCallback(
    (value: number) => {
      const next = stepTabVolume(value, 0);
      setLocal(next);
      void window.api.browser.tabs.setVolume(tabId, next);
    },
    [tabId],
  );

  // Main's level caught up with what the control shows: let go of the local copy.
  useEffect(() => {
    if (local === null || dragging) return;
    if (Math.abs(local - saved) < 0.005) {
      setLocal(null);
      return;
    }
    const timer = setTimeout(() => setLocal(null), 1500);
    return () => clearTimeout(timer);
  }, [local, saved, dragging]);

  // React's wheel listener is passive; this one must stop the sidebar scrolling.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let carried = 0;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      // Line/page deltas: one step per event. Pixels: a mouse notch (~100px) is one step; trackpads add up.
      carried +=
        event.deltaMode === 0
          ? event.deltaY
          : Math.sign(event.deltaY) * WHEEL_PIXELS_PER_STEP;
      const steps = Math.trunc(carried / WHEEL_PIXELS_PER_STEP);
      if (steps === 0) return;
      carried -= steps * WHEEL_PIXELS_PER_STEP;
      send(stepTabVolume(volumeRef.current, -steps * TAB_VOLUME_WHEEL_STEP));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [send, shown]);

  if (!shown) return null;
  const level = tabVolumeLevel(volume, tab.muted);
  const percent = formatTabVolume(volume);
  const stop = (event: React.SyntheticEvent): void => event.stopPropagation();
  return (
    <span
      ref={rootRef}
      className={`tab-volume${dragging ? " is-open" : ""}${level === "muted" ? " is-muted" : ""}${indicator === "idle" ? " is-idle" : ""}`}
      data-audio={indicator}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onAuxClick={stop}
      onKeyDown={stop}
    >
      <button
        className={`tab-audio-button${tab.muted ? " is-muted" : indicator === "playing" ? " is-playing" : " is-idle"} ${className}`.trim()}
        type="button"
        aria-label={`${tab.muted ? "Unmute" : "Mute"} ${tab.title} (volume ${percent})`}
        aria-pressed={tab.muted}
        title={
          tab.muted
            ? `Muted · volume ${percent} · click to unmute`
            : `Volume ${percent} · click to mute, scroll to change`
        }
        onClick={() => {
          void window.api.browser.tabs.setMuted(tab.id, !tab.muted);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            className="tab-audio-speaker"
            d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"
          />
          {SPEAKER_WAVES[level]}
        </svg>
      </button>
      <input
        className="tab-volume-slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        style={{ "--tab-volume-fill": percent } as React.CSSProperties}
        aria-label={`Volume of ${tab.title}`}
        aria-valuetext={percent}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        onChange={(event) => send(Number(event.target.value) / 100)}
      />
    </span>
  );
}

export function PinnedTabIcon({
  tab,
  dragProps,
}: {
  tab: BrowserTabSummary;
  dragProps?: React.ButtonHTMLAttributes<HTMLButtonElement> &
    Record<`data-${string}`, string>;
}): React.JSX.Element {
  return (
    <button
      {...dragProps}
      className={`pinned-tab-icon-button${tab.active ? " is-active" : ""}`}
      type="button"
      data-browser-tab-id={tab.id}
      aria-label={`Open pinned tab ${tab.title}`}
      title={`${tab.title}${tab.sleeping ? ` · ${describeTabSleep(tab.sleep).toLowerCase()}` : ""}${tab.muted ? " · muted" : tab.audible ? " · playing audio" : ""}`}
      onClick={() => {
        void window.api.browser.tabs.activate(tab.id);
      }}
    >
      <TabFavicon tab={tab} />
      {tab.sleeping && (
        <span
          className={`pinned-tab-sleep-indicator${isRestoredSleep(tab.sleep) ? " is-restored" : ""}`}
          aria-hidden="true"
        >
          ☾
        </span>
      )}
      {(tab.audible || tab.muted) && (
        <span
          className={`pinned-tab-audio-indicator${tab.muted ? " is-muted" : ""}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24">
            <path
              className="tab-audio-speaker"
              d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"
            />
            {tab.muted ? (
              <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
            ) : (
              <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
            )}
          </svg>
        </span>
      )}
    </button>
  );
}

/** Mask glyph marking private tabs. */
export function PrivateGlyph(): React.JSX.Element {
  return (
    <svg className="private-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10.5c0-1.4 1.1-2.5 2.5-2.5h13c1.4 0 2.5 1.1 2.5 2.5v.6c0 3-2.2 5.4-5 5.4-1.6 0-2.6-.9-3.2-2.2-.3-.6-.6-.8-.8-.8s-.5.2-.8.8c-.6 1.3-1.6 2.2-3.2 2.2-2.8 0-5-2.4-5-5.4z" />
      <circle className="private-glyph-eye" cx="8" cy="11.3" r="1.4" />
      <circle className="private-glyph-eye" cx="16" cy="11.3" r="1.4" />
    </svg>
  );
}
