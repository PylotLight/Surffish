import { useEffect, useRef, useState } from "react";
import type {
  NamedProxy,
  ProxyRoute,
  ProxyRule,
  ProxyRoutingState,
} from "../../../../shared/proxy-routing";
import { SettingsGroup } from "./SettingsControls";
import "./NetworkRules.css";

function hostPort(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

/** Route choices for a rule: the main proxy, Direct, then each extra proxy. */
export function routeOptions(state: {
  primary: { host: string; port: number };
  proxies: NamedProxy[];
}): Array<{ value: ProxyRoute; label: string }> {
  return [
    {
      value: "proxy",
      label: `Proxy (main · ${hostPort(state.primary.host, state.primary.port)})`,
    },
    { value: "direct", label: "Direct" },
    ...state.proxies
      .filter((proxy) => proxy.name.trim())
      .map((proxy) => ({
        value: `proxy:${proxy.name.trim()}` as ProxyRoute,
        label: `Proxy ${proxy.name.trim()} (${hostPort(proxy.host, Number(proxy.port))})`,
      })),
  ];
}

/** Settings → General → Network rules: per-site routes and extra SOCKS5 proxies. */
export function NetworkRulesSettings(): React.JSX.Element {
  const [applied, setApplied] = useState<ProxyRoutingState | null>(null);
  const [proxies, setProxies] = useState<NamedProxy[]>([]);
  const [rules, setRules] = useState<ProxyRule[]>([]);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = (value: boolean): void => {
    dirtyRef.current = value;
    setDirtyState(value);
  };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    const adopt = (state: ProxyRoutingState, force = false): void => {
      if (!mounted) return;
      setApplied(state);
      // Don't throw away edits in progress when the site panel changes a rule meanwhile.
      if (dirtyRef.current && !force) return;
      setProxies(state.proxies);
      setRules(state.rules);
      setDirty(false);
    };
    void window.api.browser.proxy.routing
      .get()
      .then((state) => adopt(state, true))
      .catch(() => undefined);
    // The site panel's quick toggle changes rules too.
    const unsubscribe = window.api.browser.proxy.routing.onChange((state) =>
      adopt(state),
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const edit = (nextProxies: NamedProxy[], nextRules: ProxyRule[]): void => {
    setProxies(nextProxies);
    setRules(nextRules);
    setDirty(true);
    setMessage(null);
  };

  const renameProxy = (index: number, name: string): void => {
    const previous = proxies[index]?.name.trim() ?? "";
    const nextProxies = proxies.map((proxy, position) =>
      position === index ? { ...proxy, name } : proxy,
    );
    // Keep rules pointing at the proxy they used.
    const nextRules = previous
      ? rules.map((rule) =>
          rule.route === `proxy:${previous}`
            ? { ...rule, route: `proxy:${name.trim()}` as ProxyRoute }
            : rule,
        )
      : rules;
    edit(nextProxies, nextRules);
  };

  const removeProxy = (index: number): void => {
    const name = proxies[index]?.name.trim() ?? "";
    const used = rules.filter((rule) => rule.route === `proxy:${name}`).length;
    // Rules that used it fall back to the main proxy, never to Direct.
    edit(
      proxies.filter((_proxy, position) => position !== index),
      rules.map((rule) =>
        rule.route === `proxy:${name}` ? { ...rule, route: "proxy" } : rule,
      ),
    );
    if (used)
      setMessage({
        text: `${used} rule${used === 1 ? "" : "s"} that used ${name} now use the main proxy.`,
        error: false,
      });
  };

  async function save(): Promise<void> {
    setBusy(true);
    setMessage({ text: "Applying network rules…", error: false });
    try {
      const saved = await window.api.browser.proxy.routing.set({
        proxies: proxies.map((proxy) => ({
          ...proxy,
          port: Number(proxy.port),
        })),
        rules: rules.filter((rule) => rule.pattern.trim()),
      });
      setApplied(saved);
      setProxies(saved.proxies);
      setRules(saved.rules);
      setDirty(false);
      setMessage({
        text: saved.rules.length
          ? `${saved.rules.length} rule${saved.rules.length === 1 ? "" : "s"} applied. Reload open pages to use the new routes.`
          : "No rules: every site uses the main proxy setting.",
        error: false,
      });
    } catch (error) {
      setMessage({
        text: (error instanceof Error ? error.message : String(error)).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const options = applied
    ? routeOptions({ primary: applied.primary, proxies })
    : [];
  const status = !applied
    ? "Loading…"
    : applied.error
      ? "Fail-safe: all traffic through one proxy"
      : applied.rules.length
        ? `${applied.rules.length} rule${applied.rules.length === 1 ? "" : "s"}`
        : "No rules";
  return (
    <SettingsGroup
      title="Network rules"
      status={status}
      statusOn={Boolean(applied?.rules.length) && !applied?.error}
      className="network-rules-settings"
    >
      <p className="settings-help">
        Send a site through the main proxy, another local SOCKS5 proxy, or
        directly. <code>example.com</code> matches that host only;{" "}
        <code>*.example.com</code> matches it and every subdomain. The most
        specific rule wins; other sites follow the SOCKS5 proxy switch above.
        Proxied sites never fall back to a direct connection.
      </p>
      {applied?.error && (
        <p className="settings-message is-error" role="alert">
          {applied.error} Until the rules are fixed, all traffic goes through
          one proxy (Direct rules are paused).
        </p>
      )}

      <div className="network-rules-block">
        <div className="network-rules-block-heading">
          <strong>Extra proxies</strong>
          <button
            className="settings-action secondary"
            type="button"
            disabled={busy || proxies.length >= 16}
            onClick={() =>
              edit(
                [
                  ...proxies,
                  {
                    name: `Proxy ${proxies.length + 2}`,
                    host: "127.0.0.1",
                    port: 1081 + proxies.length,
                  },
                ],
                rules,
              )
            }
          >
            + Add proxy
          </button>
        </div>
        {proxies.length === 0 && (
          <p className="settings-help">
            Only the main proxy so far. Add one to route some sites through a
            different tunnel (e.g.{" "}
            <code>ssh -N -D 127.0.0.1:1081 user@work</code>).
          </p>
        )}
        {proxies.map((proxy, index) => (
          <div className="network-rules-proxy-row" key={index}>
            <input
              className="settings-input"
              type="text"
              value={proxy.name}
              maxLength={32}
              spellCheck={false}
              aria-label={`Proxy ${index + 1} name`}
              placeholder="Name"
              onChange={(event) => renameProxy(index, event.target.value)}
            />
            <input
              className="settings-input"
              type="text"
              value={proxy.host}
              spellCheck={false}
              aria-label={`Proxy ${proxy.name || index + 1} host`}
              placeholder="127.0.0.1"
              onChange={(event) =>
                edit(
                  proxies.map((item, position) =>
                    position === index
                      ? { ...item, host: event.target.value }
                      : item,
                  ),
                  rules,
                )
              }
            />
            <input
              className="settings-input network-rules-port"
              type="number"
              min={1}
              max={65535}
              value={proxy.port}
              aria-label={`Proxy ${proxy.name || index + 1} port`}
              onChange={(event) =>
                edit(
                  proxies.map((item, position) =>
                    position === index
                      ? { ...item, port: Number(event.target.value) }
                      : item,
                  ),
                  rules,
                )
              }
            />
            <button
              className="settings-icon-action"
              type="button"
              aria-label={`Remove proxy ${proxy.name}`}
              title="Remove"
              onClick={() => removeProxy(index)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="network-rules-block">
        <div className="network-rules-block-heading">
          <strong>Site rules</strong>
          <button
            className="settings-action secondary"
            type="button"
            disabled={busy || rules.length >= 500}
            onClick={() =>
              edit(proxies, [...rules, { pattern: "", route: "direct" }])
            }
          >
            + Add rule
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="settings-help">
            No site rules. Add one here or use “Route this site” in a page’s
            site panel.
          </p>
        ) : (
          <table className="network-rules-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Route</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => (
                <tr key={index}>
                  <td>
                    <input
                      className="settings-input"
                      type="text"
                      value={rule.pattern}
                      spellCheck={false}
                      placeholder="*.example.com"
                      aria-label={`Rule ${index + 1} site pattern`}
                      onChange={(event) =>
                        edit(
                          proxies,
                          rules.map((item, position) =>
                            position === index
                              ? { ...item, pattern: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="settings-select"
                      value={rule.route}
                      aria-label={`Route for ${rule.pattern || `rule ${index + 1}`}`}
                      onChange={(event) =>
                        edit(
                          proxies,
                          rules.map((item, position) =>
                            position === index
                              ? {
                                  ...item,
                                  route: event.target.value as ProxyRoute,
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      {!options.some(
                        (option) => option.value === rule.route,
                      ) && <option value={rule.route}>{rule.route}</option>}
                    </select>
                  </td>
                  <td>
                    <button
                      className="settings-icon-action"
                      type="button"
                      aria-label={`Remove rule ${rule.pattern}`}
                      title="Remove"
                      onClick={() =>
                        edit(
                          proxies,
                          rules.filter((_item, position) => position !== index),
                        )
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="settings-actions">
        {dirty && <p className="settings-help">Unsaved changes.</p>}
        <button
          className="settings-action secondary"
          type="button"
          disabled={busy || !dirty || !applied}
          onClick={() => {
            if (applied) {
              setProxies(applied.proxies);
              setRules(applied.rules);
              setDirty(false);
              setMessage(null);
            }
          }}
        >
          Revert
        </button>
        <button
          className="settings-action primary"
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? "Applying…" : "Save rules"}
        </button>
      </div>
      {message && (
        <p
          className={`settings-message${message.error ? " is-error" : ""}`}
          role="status"
        >
          {message.text}
        </p>
      )}
    </SettingsGroup>
  );
}
