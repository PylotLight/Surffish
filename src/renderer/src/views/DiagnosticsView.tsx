import { useEffect, useMemo, useState } from "react";
import {
  formatDiagnosticsMemory,
  sortDiagnosticsRows,
  type DiagnosticsPayload,
  type DiagnosticsRow,
  type DiagnosticsSortDirection,
  type DiagnosticsSortKey,
} from "../../../shared/diagnostics";
import "./DiagnosticsView.css";

export { useTabUsageHints, withTabUsageHint } from "./tabUsageHints";

const COLUMNS: ReadonlyArray<{
  key: DiagnosticsSortKey;
  label: string;
  numeric: boolean;
}> = [
  { key: "name", label: "Process", numeric: false },
  { key: "cpu", label: "CPU %", numeric: true },
  { key: "memory", label: "Memory", numeric: true },
  { key: "wakeups", label: "Idle wakeups/s", numeric: true },
  { key: "pid", label: "PID", numeric: true },
];

function kindBadge(row: DiagnosticsRow): string {
  switch (row.kind) {
    case "browser":
      return "Main";
    case "gpu":
      return "GPU";
    case "utility":
      return "Utility";
    case "tab":
      return row.tabIds.length > 1 ? "Tabs" : "Tab";
    case "subframe":
      return "Frame";
    case "shell":
      return "UI";
    case "overlay":
      return "Overlay";
    case "extension":
      return "Extension";
    case "pdf-editor":
      return "PDF";
    case "renderer":
      return "Renderer";
    default:
      return row.type;
  }
}

interface DiagnosticsViewProps {
  /** Only the content surface samples; other surfaces never start the timer. */
  live: boolean;
}

/** Settings → Diagnostics: a Chrome-style Task Manager for Surffish's processes. */
export default function DiagnosticsView({
  live,
}: DiagnosticsViewProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DiagnosticsPayload | null>(null);
  const [sortKey, setSortKey] = useState<DiagnosticsSortKey>("cpu");
  const [direction, setDirection] = useState<DiagnosticsSortDirection>("desc");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!live) return;
    let mounted = true;
    const unsubscribe = window.api.browser.diagnostics.onChange((next) => {
      if (mounted) setSnapshot(next);
    });
    void window.api.browser.diagnostics
      .watch(true)
      .then((first) => {
        if (mounted && first) setSnapshot(first);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
      void window.api.browser.diagnostics.watch(false).catch(() => undefined);
    };
  }, [live]);

  const rows = useMemo(
    () =>
      snapshot ? sortDiagnosticsRows(snapshot.rows, sortKey, direction) : [],
    [snapshot, sortKey, direction],
  );

  function sortBy(key: DiagnosticsSortKey): void {
    if (key === sortKey)
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(key === "name" || key === "pid" ? "asc" : "desc");
    }
  }

  async function kill(row: DiagnosticsRow): Promise<void> {
    const what =
      row.tabIds.length > 0
        ? `${row.label}. Its tab${row.tabIds.length === 1 ? "" : "s"} will need a reload.`
        : row.label;
    if (!window.confirm(`Kill process ${row.pid}?\n\n${what}`)) return;
    const killed = await window.api.browser.diagnostics
      .kill(row.pid)
      .catch(() => false);
    setMessage(
      killed
        ? `Killed process ${row.pid}.`
        : `Could not kill process ${row.pid}.`,
    );
  }

  const totals = snapshot?.totals;
  return (
    <div className="network-view diagnostics-view">
      <header className="network-page-header">
        <div>
          <h1>Diagnostics</h1>
          <p>
            Every Surffish process with its CPU, memory and idle wakeups.
            Samples every {Math.round((snapshot?.intervalMs ?? 2000) / 1000)} s
            only while this page is open. Shift+Esc opens it from anywhere.
          </p>
        </div>
      </header>
      <div className="diagnostics-totals" aria-live="polite">
        <div>
          <span>CPU</span>
          <strong>{totals ? `${totals.cpu.toFixed(1)}%` : "—"}</strong>
        </div>
        <div>
          <span>Memory</span>
          <strong>
            {totals ? formatDiagnosticsMemory(totals.memoryKB) : "—"}
          </strong>
        </div>
        <div>
          <span>Idle wakeups/s</span>
          <strong>{totals ? totals.idleWakeups.toLocaleString() : "—"}</strong>
        </div>
        <div>
          <span>Processes</span>
          <strong>
            {totals
              ? `${totals.processes} (${totals.renderers} renderers)`
              : "—"}
          </strong>
        </div>
      </div>
      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
      <div className="network-request-table-wrap diagnostics-table-wrap">
        <table className="diagnostics-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={column.numeric ? "is-numeric" : ""}
                  aria-sort={
                    sortKey === column.key
                      ? direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button type="button" onClick={() => sortBy(column.key)}>
                    {column.label}
                    {sortKey === column.key
                      ? direction === "asc"
                        ? " ▲"
                        : " ▼"
                      : ""}
                  </button>
                </th>
              ))}
              <th className="diagnostics-actions-heading">
                <span className="new-tab-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isExpanded = expanded === row.pid;
              const tabId = row.tabIds[0];
              return (
                <tr
                  key={row.pid}
                  className={`diagnostics-row diagnostics-kind-${row.kind}${row.cpu >= 25 ? " is-hot" : ""}`}
                >
                  <td className="diagnostics-name">
                    <button
                      type="button"
                      className="diagnostics-name-button"
                      aria-expanded={
                        row.members.length > 1 ? isExpanded : undefined
                      }
                      onClick={() => setExpanded(isExpanded ? null : row.pid)}
                      title={
                        row.members
                          .map(
                            (member) =>
                              `${member.label}${member.detail ? ` — ${member.detail}` : ""}`,
                          )
                          .join("\n") || row.label
                      }
                    >
                      <span className="diagnostics-badge">
                        {kindBadge(row)}
                      </span>
                      <span className="diagnostics-label">{row.label}</span>
                    </button>
                    {isExpanded && row.members.length > 0 && (
                      <ul className="diagnostics-members">
                        {row.members.map((member, index) => (
                          <li key={`${member.kind}-${member.label}-${index}`}>
                            {member.label}
                            {member.detail ? (
                              <span> · {member.detail}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="is-numeric">{row.cpu.toFixed(1)}</td>
                  <td className="is-numeric">
                    {formatDiagnosticsMemory(row.memoryKB)}
                  </td>
                  <td className="is-numeric">
                    {row.idleWakeups.toLocaleString()}
                  </td>
                  <td className="is-numeric">{row.pid}</td>
                  <td className="diagnostics-actions">
                    <div>
                      {tabId && (
                        <button
                          type="button"
                          className="settings-action secondary"
                          onClick={() => {
                            void window.api.browser.diagnostics.reloadTab(
                              tabId,
                            );
                          }}
                          title="Reload tab"
                        >
                          Reload
                        </button>
                      )}
                      {tabId && row.kind === "tab" && (
                        <button
                          type="button"
                          className="settings-action secondary"
                          onClick={() => {
                            void window.api.browser.diagnostics.discardTab(
                              tabId,
                            );
                          }}
                          title="Discard tab: free its memory; it reloads when you select it (not the active tab)"
                        >
                          Discard
                        </button>
                      )}
                      {row.canKill && (
                        <button
                          type="button"
                          className="settings-action secondary is-danger"
                          onClick={() => {
                            void kill(row);
                          }}
                          title="Kill process"
                        >
                          Kill
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {snapshot && snapshot.unattributedWorkers.length > 0 && (
        <p className="settings-help diagnostics-footnote">
          Running service workers without a page:{" "}
          {snapshot.unattributedWorkers.join(", ")}. They account for "no page"
          renderers.
        </p>
      )}
      <p className="settings-help diagnostics-footnote">
        Site isolation can put several tabs of one site in a single renderer,
        and cross-site frames (ads, embeds) in their own. CPU is a share of one
        core.
      </p>
    </div>
  );
}
