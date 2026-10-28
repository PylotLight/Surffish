import { useEffect, useState } from "react";
import {
  castPosition,
  formatCastTime,
  type CastMediaChoice,
  type CastSessionState,
  type CastSnapshot,
} from "../../../../shared/cast";
import "./cast.css";

const STATUS_TEXT: Record<CastSessionState["status"], string> = {
  connecting: "Connecting…",
  loading: "Loading on the TV…",
  playing: "Playing",
  paused: "Paused",
  buffering: "Buffering…",
  idle: "Ready",
  ended: "Finished",
  error: "Couldn’t play",
};

/** Seconds on the cast's clock, ticking once a second while it plays. */
function usePosition(session: CastSessionState | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (session?.status !== "playing") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [session?.status]);
  return session ? castPosition(session, Math.max(now, session.updatedAt)) : 0;
}

function SessionControls({
  session,
}: {
  session: CastSessionState;
}): React.JSX.Element {
  const position = usePosition(session);
  const [seeking, setSeeking] = useState<number | null>(null);
  const playing =
    session.status === "playing" || session.status === "buffering";
  const canControl =
    session.kind === "media" &&
    session.status !== "connecting" &&
    session.status !== "loading" &&
    session.status !== "error";
  const seekable = canControl && !session.live && session.duration !== null;
  const volume = Math.round((session.volume ?? 1) * 100);
  return (
    <section
      className="cast-session"
      aria-label={`Casting to ${session.deviceName}`}
      data-status={session.status}
    >
      <div className="cast-session-head">
        <span className="cast-session-device">{session.deviceName}</span>
        <span
          className={`cast-session-status${session.status === "error" ? " is-error" : ""}`}
          role="status"
        >
          {session.kind === "mirror" && session.status === "playing"
            ? "Live"
            : STATUS_TEXT[session.status]}
        </span>
      </div>
      <p className="cast-session-title" title={session.title}>
        {session.kind === "mirror"
          ? `Mirroring: ${session.title}`
          : session.title}
      </p>
      {session.kind === "mirror" &&
        session.mirror &&
        session.mirror.height > 0 && (
          <p className="cast-note cast-mirror-stats">{`${session.mirror.height}p · ${session.mirror.kbps >= 1000 ? `${(session.mirror.kbps / 1000).toFixed(1)} Mbps` : `${session.mirror.kbps} kbps`}${session.mirror.audio ? " · sound on the TV" : ""}`}</p>
        )}
      {session.error && (
        <p className="cast-error" role="alert">
          {session.error}
        </p>
      )}
      {session.kind === "media" && (
        <div className="cast-transport">
          <button
            type="button"
            className="cast-icon-button cast-play"
            disabled={!canControl}
            aria-label={playing ? "Pause on the TV" : "Play on the TV"}
            title={playing ? "Pause" : "Play"}
            onClick={() =>
              void window.api.browser.cast.control(playing ? "pause" : "play")
            }
          >
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5.5v13M16 5.5v13" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.5 5.2v13.6L18.5 12z" />
              </svg>
            )}
          </button>
          <span className="cast-time">
            {session.live ? "Live" : formatCastTime(seeking ?? position)}
          </span>
          <input
            type="range"
            className="cast-seek"
            min={0}
            max={Math.max(1, Math.floor(session.duration ?? 1))}
            step={1}
            value={Math.floor(seeking ?? position)}
            disabled={!seekable}
            aria-label="Position on the TV"
            aria-valuetext={formatCastTime(seeking ?? position)}
            onChange={(event) => setSeeking(Number(event.target.value))}
            onPointerUp={() => {
              if (seeking !== null) {
                void window.api.browser.cast.control("seek", seeking);
                setSeeking(null);
              }
            }}
            onKeyUp={() => {
              if (seeking !== null) {
                void window.api.browser.cast.control("seek", seeking);
                setSeeking(null);
              }
            }}
          />
          <span className="cast-time">
            {session.duration !== null && !session.live
              ? formatCastTime(session.duration)
              : ""}
          </span>
        </div>
      )}
      <div className="cast-volume-row">
        <button
          type="button"
          className="cast-icon-button"
          disabled={session.status === "connecting"}
          aria-label={session.muted ? "Unmute the TV" : "Mute the TV"}
          aria-pressed={session.muted}
          title={session.muted ? "Unmute" : "Mute"}
          onClick={() => void window.api.browser.cast.control("mute")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
            {session.muted ? (
              <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
            ) : (
              <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
            )}
          </svg>
        </button>
        <input
          type="range"
          className="cast-volume"
          min={0}
          max={100}
          step={5}
          value={volume}
          disabled={session.status === "connecting"}
          aria-label="TV volume"
          aria-valuetext={`${volume}%`}
          onChange={(event) =>
            void window.api.browser.cast.control(
              "volume",
              Number(event.target.value) / 100,
            )
          }
        />
        <button
          type="button"
          className="cast-stop"
          onClick={() => void window.api.browser.cast.control("stop")}
        >
          Stop casting
        </button>
      </div>
    </section>
  );
}

/**
 * The cast picker: the live cast's controls, what this tab would cast, and the Chromecasts on the
 * network (browsed while this is open). Cast video hands the device the page's media URL.
 */
export function CastPanel({
  tabId,
  pageUrl,
  snapshot,
  onClose,
  onOpenSettings,
}: {
  tabId: string;
  pageUrl: string;
  snapshot: CastSnapshot;
  onClose: () => void;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const [probe, setProbe] = useState<{
    choice: CastMediaChoice;
    proxied: boolean;
  } | null>(null);
  const [probed, setProbed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void window.api.browser.cast.setPickerOpen(true).catch(() => undefined);
    return () => {
      void window.api.browser.cast.setPickerOpen(false).catch(() => undefined);
    };
  }, []);
  const sessionPlaying = snapshot.session?.status === "playing";
  useEffect(() => {
    let live = true;
    setProbed(false);
    setError("");
    if (!pageUrl) {
      setProbe(null);
      setProbed(true);
      return;
    }
    void window.api.browser.cast
      .probe(tabId)
      .then((next) => {
        if (!live) return;
        setProbe(next);
        setProbed(true);
      })
      .catch(() => {
        if (live) setProbed(true);
      });
    return () => {
      live = false;
    };
  }, [tabId, pageUrl, sessionPlaying]);

  async function castTo(
    deviceId: string,
    mode: "media" | "mirror",
  ): Promise<void> {
    setBusy(`${mode}:${deviceId}`);
    setError("");
    try {
      const result =
        mode === "mirror"
          ? await window.api.browser.cast.mirror(deviceId, tabId)
          : await window.api.browser.cast.castMedia(deviceId, tabId);
      if (!result.ok) setError(result.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const choice = probe?.choice ?? null;
  const castable = choice?.castable === true;
  return (
    <div
      id="cast-popover"
      className="cast-popover"
      role="dialog"
      aria-label="Cast"
    >
      <div className="cast-header">
        <strong>Cast</strong>
        <span className="cast-scan" aria-live="polite">
          {snapshot.scanning
            ? "Looking for devices…"
            : `${snapshot.devices.length} device${snapshot.devices.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {snapshot.session && <SessionControls session={snapshot.session} />}
      {pageUrl &&
        !(
          snapshot.session?.tabId === tabId &&
          snapshot.session.status !== "error"
        ) && (
          <div
            className={`cast-media${castable ? " is-castable" : ""}`}
            data-castable={castable ? "true" : "false"}
          >
            {!probed && <span>Checking this page’s video…</span>}
            {probed && choice?.castable === true && (
              <span>
                <strong>{choice.label}</strong> ready to cast
                {choice.live
                  ? " (live)"
                  : choice.startTime > 1
                    ? ` from ${formatCastTime(choice.startTime)}`
                    : ""}
                .
              </span>
            )}
            {probed && choice && !choice.castable && (
              <span>{choice.message}</span>
            )}
            {probed && !choice && <span>This tab isn’t loaded.</span>}
            {castable && probe?.proxied && (
              <small className="cast-note">
                The Chromecast fetches the video itself, straight from the site,
                not through your SOCKS proxy.
              </small>
            )}
            {castable && !probe?.proxied && (
              <small className="cast-note">
                The Chromecast fetches the video itself, without this tab’s
                login or cookies.
              </small>
            )}
          </div>
        )}
      {snapshot.devices.length > 0 ? (
        <ul className="cast-devices" aria-label="Cast devices">
          {snapshot.devices.map((device) => {
            const current = snapshot.session?.deviceId === device.id;
            return (
              <li
                key={device.id}
                className={`cast-device${current ? " is-current" : ""}`}
                data-device-id={device.id}
              >
                <span className="cast-device-text">
                  <span className="cast-device-name">{device.name}</span>
                  {device.model && <small>{device.model}</small>}
                </span>
                <span className="cast-device-actions">
                  <button
                    type="button"
                    className="cast-action"
                    disabled={!castable || busy !== null}
                    aria-label={`Cast video to ${device.name}`}
                    title={
                      castable
                        ? `Cast this video to ${device.name} (it plays it by itself)`
                        : "No video this page can hand over: use Mirror tab"
                    }
                    onClick={() => void castTo(device.id, "media")}
                  >
                    {busy === `media:${device.id}` ? "Casting…" : "Cast video"}
                  </button>
                  <button
                    type="button"
                    className="cast-action cast-mirror"
                    disabled={busy !== null || !pageUrl}
                    aria-label={`Mirror this tab to ${device.name}`}
                    title={`Show this tab on ${device.name}, picture and sound, live`}
                    onClick={() => void castTo(device.id, "mirror")}
                  >
                    {busy === `mirror:${device.id}`
                      ? "Starting…"
                      : "Mirror tab"}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="cast-empty">
          {snapshot.scanning
            ? "Looking for Chromecasts on your network…"
            : "No Chromecasts found. Check it’s on the same network; on macOS, allow Surffish in System Settings → Privacy & Security → Local Network."}
        </p>
      )}
      {error && (
        <p className="cast-error" role="alert">
          {error}
        </p>
      )}
      <div className="cast-footer">
        <button
          type="button"
          className="cast-settings-link"
          onClick={onOpenSettings}
        >
          Cast settings…
        </button>
        <button type="button" className="cast-close" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
