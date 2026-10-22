import { useEffect, useState } from "react";
import {
  DEFAULT_TAB_ARCHIVE_SETTINGS,
  type TabArchiveSnapshot,
} from "../../../../shared/tab-archive";

const EMPTY: TabArchiveSnapshot = {
  settings: DEFAULT_TAB_ARCHIVE_SETTINGS,
  tabs: [],
};

/** Archived tabs and auto-archive settings, kept in sync with main (every surface gets the broadcast). */
export function useTabArchive(): TabArchiveSnapshot & { loaded: boolean } {
  const [snapshot, setSnapshot] = useState<TabArchiveSnapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    let received = false;
    const unsubscribe = window.api.browser.tabArchive.onChange((next) => {
      received = true;
      if (!mounted) return;
      setSnapshot(next);
      setLoaded(true);
    });
    void window.api.browser.tabArchive
      .get()
      .then((initial) => {
        if (!mounted || received) return;
        setSnapshot(initial);
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  return { ...snapshot, loaded };
}
