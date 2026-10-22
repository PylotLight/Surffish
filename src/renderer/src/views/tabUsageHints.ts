import { useEffect, useState } from "react";
import {
  formatTabUsageHint,
  type DiagnosticsTabUsage,
} from "../../../shared/diagnostics";

/**
 * Per-tab CPU/memory for the sidebar tooltips. Empty unless a Diagnostics view is sampling, so
 * the sidebar costs nothing extra the rest of the time.
 */
export function useTabUsageHints(
  enabled: boolean,
): Record<string, DiagnosticsTabUsage> {
  const [usage, setUsage] = useState<Record<string, DiagnosticsTabUsage>>({});
  useEffect(() => {
    if (!enabled) return;
    return window.api.browser.diagnostics.onChange((snapshot) =>
      setUsage(snapshot?.tabs ?? {}),
    );
  }, [enabled]);
  return enabled ? usage : {};
}

export function withTabUsageHint(
  title: string,
  usage: DiagnosticsTabUsage | undefined,
): string {
  const hint = formatTabUsageHint(usage);
  return hint ? `${title}\n${hint}` : title;
}
