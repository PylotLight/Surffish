import { useEffect, useState } from "react";

export type FeedsSnapshot = Awaited<
  ReturnType<typeof window.api.browser.feeds.list>
>;

/** Live Feeds state from main (the renderer never fetches a feed itself). */
export function useFeeds(enabled = true): FeedsSnapshot | null {
  const [snapshot, setSnapshot] = useState<FeedsSnapshot | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void window.api.browser.feeds
      .list()
      .then((next) => {
        if (live && next && "feeds" in next) setSnapshot(next);
      })
      .catch(() => undefined);
    const off = window.api.browser.feeds.onChange((next) => setSnapshot(next));
    return () => {
      live = false;
      off();
    };
  }, [enabled]);
  return snapshot;
}

/** Unread items across feeds, for the Integrations nav and Feeds tab badges (only while Settings is open). */
export function useUnreadFeedCount(enabled = true): number {
  return useFeeds(enabled)?.totalUnread ?? 0;
}
