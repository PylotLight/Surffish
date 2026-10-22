import { useStoredState } from "../lib/stored-state";

/** The Network inspector is a debug tool: off by default, opt in from Settings → General → Developer. */
export function useNetworkToolEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useStoredState(
    "surffish.devtools.networkInspectorEnabled",
    false,
  );
  return [
    enabled,
    (next) => {
      setEnabled(next);
      if (!next) void window.api.browser.network.disable();
    },
  ];
}
