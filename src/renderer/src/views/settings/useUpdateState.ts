import { useEffect, useState } from "react";
import type { UpdateState } from "../../../../shared/update-feed";

/** Live update-check state from the main process (the renderer never fetches the feed itself). */
export function useUpdateState(): [
  UpdateState | null,
  (state: UpdateState) => void,
] {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let cancelled = false;
    // A push can arrive before the initial get() reply (separate IPC channels); once one has,
    // the get() result is older and must not overwrite it (e.g. re-showing a snoozed badge).
    let pushed = false;
    const unsubscribe = window.api.browser.updates.onChange((next) => {
      pushed = true;
      setState(next);
    });
    void window.api.browser.updates
      .get()
      .then((next) => {
        if (!cancelled && !pushed) setState(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return [state, setState];
}
