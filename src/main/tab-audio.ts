import type { WebContents } from "electron";
import {
  audibleReleaseInMs,
  isShownAudible,
  nextTabAudio,
  NO_TAB_AUDIO,
  type TabAudioActivity,
  type TabAudioEvent,
} from "../shared/tab-audio";

/**
 * Per-tab audible tracking for the speaker (see shared/tab-audio.ts). Kept per WebContents, so a
 * hibernated / discarded tab wakes with a fresh state.
 */
const activity = new WeakMap<WebContents, TabAudioActivity>();
const releaseTimers = new WeakMap<WebContents, ReturnType<typeof setTimeout>>();

/** Start tracking a tab's page; `changed` runs when its speaker may show or hide. Call once per tab WebContents. */
export function trackTabAudio(
  contents: WebContents,
  changed: () => void,
): void {
  const record = (event: TabAudioEvent): void => {
    const before = activity.get(contents) ?? NO_TAB_AUDIO;
    const after = nextTabAudio(before, event, Date.now());
    if (after === before) return;
    activity.set(contents, after);
    const pending = releaseTimers.get(contents);
    if (pending) clearTimeout(pending);
    releaseTimers.delete(contents);
    const release = audibleReleaseInMs(after, Date.now());
    if (release !== null) {
      releaseTimers.set(
        contents,
        setTimeout(() => {
          releaseTimers.delete(contents);
          if (!contents.isDestroyed()) changed();
        }, release + 20),
      );
    }
    changed();
  };
  contents.on("audio-state-changed", (event) =>
    record({ type: "audible", audible: event.audible }),
  );
  contents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) record({ type: "reset" });
    },
  );
  contents.on("render-process-gone", () => record({ type: "reset" }));
  contents.once("destroyed", () => {
    const pending = releaseTimers.get(contents);
    if (pending) clearTimeout(pending);
  });
}

/** What the speaker needs: audible (with the short release hold) and whether this document was ever heard. */
export function tabAudioState(
  contents: WebContents | null | undefined,
  now = Date.now(),
): { audible: boolean; heard: boolean } {
  if (!contents || contents.isDestroyed())
    return { audible: false, heard: false };
  const state = activity.get(contents) ?? NO_TAB_AUDIO;
  // isCurrentlyAudible covers a page that was audible before tracking started (e.g. adopted contents).
  return {
    audible: contents.isCurrentlyAudible() || isShownAudible(state, now),
    heard: state.heard || contents.isCurrentlyAudible(),
  };
}
