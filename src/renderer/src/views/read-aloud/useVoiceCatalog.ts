import { useEffect, useState } from "react";
import type { ReadAloudCatalogInfo } from "../../../../shared/read-aloud";
import { MODEL_VOICE } from "../../../../shared/read-aloud-voices";

const EMPTY: ReadAloudCatalogInfo = {
  status: "needs-model",
  voices: [MODEL_VOICE],
  conditioners: [],
  error: "",
};

/**
 * The voice list for a picker (Settings, the player): asked of main when the picker mounts and again
 * once the model is ready (main fetches the catalog the first time, then reads it from the profile).
 */
export function useVoiceCatalog(modelReady: boolean): ReadAloudCatalogInfo {
  const [catalog, setCatalog] = useState<ReadAloudCatalogInfo>(EMPTY);
  useEffect(() => {
    let live = true;
    void window.api.browser.readAloud
      .catalog()
      .then((next) => {
        if (live)
          setCatalog(
            next.voices.length > 0 ? next : { ...next, voices: [MODEL_VOICE] },
          );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [modelReady]);
  return catalog;
}
