import { useEffect, useRef, useState } from "react";
import type { UpdateState } from "../../../../shared/update-feed";
import { SettingsGroup, SettingsRow } from "./SettingsControls";
import { useUpdateState } from "./useUpdateState";
import "./UpdateSettings.css";

function formatChecked(timestamp: number | null): string {
  if (!timestamp) return "Never checked";
  return `Last checked ${new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

function formatReleased(iso: string): string | null {
  const time = Date.parse(iso);
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString(undefined, { dateStyle: "medium" })
    : null;
}

function statusLabel(state: UpdateState): { text: string; on: boolean } {
  if (state.status === "checking") return { text: "Checking…", on: false };
  if (state.updateAvailable && state.latest)
    return { text: `${state.latest.version} available`, on: true };
  if (state.status === "up-to-date") return { text: "Up to date", on: false };
  if (state.status === "unavailable") return { text: "Unavailable", on: false };
  if (state.status === "error") return { text: "Check failed", on: false };
  return { text: `v${state.currentVersion}`, on: false };
}

/** Settings → General → About & updates: versions, release notes, download / skip / remind later. */
export function UpdateSettings(): React.JSX.Element {
  const [state, setState] = useUpdateState();
  const [feedUrl, setFeedUrl] = useState("");
  const [feedDirty, setFeedDirty] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state && !feedDirty) setFeedUrl(state.feedUrl);
  }, [state, feedDirty]);

  useEffect(
    () =>
      window.api.browser.updates.onReveal(() => {
        sectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }),
    [],
  );

  async function run(
    action: () => Promise<UpdateState | boolean | null | void>,
  ): Promise<void> {
    setError("");
    setBusy(true);
    try {
      const next = await action();
      if (next && typeof next === "object") setState(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message.replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              "",
            )
          : String(caught),
      );
    } finally {
      setBusy(false);
    }
  }

  /** Save { feedUrl?, betaChannel? }; a rejected value (bad feed URL) shows inline and returns null. */
  async function saveSettings(patch: {
    feedUrl?: string;
    betaChannel?: boolean;
  }): Promise<UpdateState | null> {
    const result = await window.api.browser.updates.setSettings(patch);
    if (result.ok) return result.state;
    setError(result.error);
    return null;
  }

  if (!state) {
    return (
      <div ref={sectionRef}>
        <SettingsGroup title="About & updates" />
      </div>
    );
  }

  const status = statusLabel(state);
  const latest = state.latest;
  const released = latest ? formatReleased(latest.updated) : null;
  const download = state.download;
  const showRelease = Boolean(latest && state.updateAvailable);

  return (
    <div ref={sectionRef} className="update-settings">
      <SettingsGroup
        title="About & updates"
        status={status.text}
        statusOn={status.on}
      >
        <SettingsRow
          label={`Surffish ${state.currentVersion}`}
          hint={[
            state.engine
              ? `Electron ${state.engine.electron} · Chromium ${state.engine.chromium}`
              : null,
            state.message,
            formatChecked(state.lastChecked),
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <button
            className="settings-action secondary"
            type="button"
            disabled={busy || state.status === "checking"}
            onClick={() => void run(() => window.api.browser.updates.check())}
          >
            {state.status === "checking" ? "Checking…" : "Check for updates"}
          </button>
        </SettingsRow>

        {showRelease && latest && (
          <div className="update-release">
            <div className="update-release-heading">
              <strong>{latest.title}</strong>
              <span>
                Latest {latest.version}
                {released ? ` · released ${released}` : ""}
                {state.skippedVersion === latest.version ? " · skipped" : ""}
              </span>
            </div>
            {latest.notes && (
              <div
                className="update-release-notes"
                tabIndex={0}
                aria-label="Release notes"
              >
                {latest.notes}
              </div>
            )}
            <div className="update-release-actions">
              <button
                className="settings-action primary"
                type="button"
                disabled={busy || !latest.link}
                onClick={() =>
                  void run(() => window.api.browser.updates.download())
                }
              >
                Download
              </button>
              <button
                className="settings-action secondary"
                type="button"
                disabled={busy || state.skippedVersion === latest.version}
                onClick={() =>
                  void run(() =>
                    window.api.browser.updates.skip(latest.version),
                  )
                }
              >
                Skip this version
              </button>
              <button
                className="settings-action secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => window.api.browser.updates.remindLater())
                }
              >
                Remind me later
              </button>
            </div>
            {download.state !== "none" && (
              <div className="update-download" role="status">
                <span>
                  {download.state === "downloading" &&
                    `Downloading ${download.filename ?? "update"}… (see Downloads)`}
                  {download.state === "completed" &&
                    `${download.filename ?? "Update"} downloaded.`}
                  {download.state === "failed" &&
                    `${download.filename ?? "The update"} didn't finish downloading.`}
                </span>
                {download.canOpenInstaller && (
                  <button
                    className="settings-action primary"
                    type="button"
                    onClick={() =>
                      void run(() => window.api.browser.updates.openInstaller())
                    }
                  >
                    Open installer
                  </button>
                )}
                {download.canReveal && (
                  <button
                    className="settings-action secondary"
                    type="button"
                    onClick={() =>
                      void run(() =>
                        window.api.browser.updates.revealDownload(),
                      )
                    }
                  >
                    Show in folder
                  </button>
                )}
              </div>
            )}
            <p className="settings-help">
              Surffish doesn't install updates itself: download the new build,
              then replace the app in Applications.
            </p>
          </div>
        )}

        <SettingsRow
          label="Beta channel"
          hint="Also offer pre-releases (tags like v0.3.0-beta.1)."
        >
          <input
            type="checkbox"
            className="settings-switch"
            checked={state.betaChannel}
            disabled={busy}
            onChange={(event) =>
              void run(() =>
                saveSettings({ betaChannel: event.target.checked }),
              )
            }
            aria-label="Offer pre-release updates"
          />
        </SettingsRow>
        <form
          className="update-feed-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const next = await saveSettings({ feedUrl });
              if (next) setFeedDirty(false);
              return next;
            });
          }}
        >
          <label className="settings-field settings-field-grow">
            <span>Release feed</span>
            <input
              type="url"
              value={feedUrl}
              placeholder={state.defaultFeedUrl}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setFeedUrl(event.target.value);
                setFeedDirty(true);
              }}
              aria-label="Release feed URL"
            />
          </label>
          <button
            className="settings-action secondary"
            type="submit"
            disabled={busy || !feedDirty}
          >
            Save
          </button>
          {state.feedUrl && (
            <button
              className="settings-action secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await saveSettings({ feedUrl: "" });
                  if (next) setFeedDirty(false);
                  return next;
                })
              }
            >
              Use default
            </button>
          )}
        </form>
        <p className="settings-help">
          An Atom feed of releases (GitHub's <code>releases.atom</code> format).
          Point it at a public mirror, a feed on your NAS, or a tokenized URL.
          Checks go through your proxy, at launch and every 6 hours.
        </p>
        {error && (
          <p className="settings-message is-error" role="alert">
            {error}
          </p>
        )}
      </SettingsGroup>
    </div>
  );
}
