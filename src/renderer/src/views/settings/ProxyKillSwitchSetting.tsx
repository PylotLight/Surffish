import { useEffect, useState } from "react";
import type { ProxyGuardStatus } from "../../../../shared/proxy-guard";
import { SettingsRow } from "./SettingsControls";

/** Kill switch row inside the SOCKS5 proxy group. */
export function ProxyKillSwitchSetting(): React.JSX.Element {
  const [status, setStatus] = useState<ProxyGuardStatus | null>(null);
  useEffect(() => {
    let mounted = true;
    void window.api.browser.safety.proxyGuard
      .get()
      .then((next) => {
        if (mounted) setStatus(next);
      })
      .catch(() => undefined);
    const unsubscribe =
      window.api.browser.safety.proxyGuard.onChange(setStatus);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  const state = !status?.killSwitch
    ? ""
    : !status.armed
      ? " Turns on when the proxy (or a proxied site rule) is enabled."
      : status.blocking
        ? " Proxy unreachable: traffic is blocked now."
        : status.state === "up"
          ? " Watching: proxy reachable."
          : " Checking the proxy…";
  return (
    <SettingsRow
      label="Kill switch"
      hint={`Blocks proxied traffic if the proxy stops answering.${state}`}
      info="Nothing routed through a dead proxy goes out directly instead (sites with a Direct rule are unaffected). Resumes automatically when it’s back."
    >
      <input
        type="checkbox"
        className="settings-switch"
        disabled={!status}
        checked={status?.killSwitch ?? false}
        onChange={(event) =>
          void window.api.browser.safety.proxyGuard
            .set(event.target.checked)
            .then(setStatus)
        }
        aria-label="Proxy kill switch"
      />
    </SettingsRow>
  );
}
