import { useEffect, useState } from "react";
import {
  formatStorageBytes,
  type SiteDataSummary,
} from "../../../../shared/browsing-data";
import "../Safety.css";

/** "This site" → Cookies and site data, with Forget this site. */
export function SiteDataSettings({
  origin,
  onForgotten,
}: {
  origin: string;
  onForgotten?: () => void;
}): React.JSX.Element {
  const [summary, setSummary] = useState<SiteDataSummary | null>(null);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    setSummary(null);
    setConfirming(false);
    setMessage("");
    void window.api.browser.safety.siteData
      .get(origin)
      .then((next) => {
        if (mounted) setSummary(next);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [origin]);

  async function forget(): Promise<void> {
    setBusy(true);
    try {
      setSummary(
        await window.api.browser.safety.siteData.forget(origin, includeHistory),
      );
      setMessage(
        `Forgot ${new URL(origin).hostname}. Reload the page to start fresh.`,
      );
      setConfirming(false);
      onForgotten?.();
    } catch {
      setMessage("Could not clear this site’s data.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <div>
          <strong>Cookies and site data</strong>
        </div>
      </div>
      <label className="site-setting-row">
        <span>
          <strong>
            {summary
              ? `${summary.cookies} cookie${summary.cookies === 1 ? "" : "s"}, ${formatStorageBytes(summary.storageBytes)}${summary.storageBytes === null ? "" : " stored"}`
              : "Checking…"}
          </strong>
          <small>
            Cookies this site can read, plus local storage, IndexedDB and caches
            it keeps on this device.
          </small>
        </span>
      </label>
      {confirming ? (
        <>
          <label className="privacy-check">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(event) => setIncludeHistory(event.target.checked)}
            />
            <span>Also remove this site from history</span>
          </label>
          <p className="settings-help">
            Clears cookies, storage and cache for {new URL(origin).hostname},
            and resets its permissions, zoom and tab volume. You’ll be signed
            out.
          </p>
          <div className="settings-actions">
            <button
              className="settings-action secondary"
              type="button"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              className="settings-action primary"
              type="button"
              disabled={busy}
              onClick={() => void forget()}
            >
              {busy ? "Forgetting…" : "Forget"}
            </button>
          </div>
        </>
      ) : (
        <div className="settings-actions">
          <button
            className="settings-action secondary"
            type="button"
            onClick={() => setConfirming(true)}
          >
            Forget this site
          </button>
        </div>
      )}
      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
