import { ipcRenderer } from "electron";
import {
  WAKE_SNAPSHOT_FADE_CHANNEL,
  WAKE_SNAPSHOT_FADED_CHANNEL,
  WAKE_SNAPSHOT_HIDE_CHANNEL,
  WAKE_SNAPSHOT_INPUT_CHANNEL,
  WAKE_SNAPSHOT_SHOW_CHANNEL,
  type WakeSnapshotInput,
  type WakeSnapshotShowMessage,
} from "../shared/wake-snapshot";

function subscribe<T>(
  channel: string,
  callback: (value: T) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void =>
    callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/** window.api.browser.wakeSnapshot: the toolbar surface draws a waking tab's last picture over the page area. */
export const wakeSnapshotApi = {
  onShow: (
    callback: (message: WakeSnapshotShowMessage) => void,
  ): (() => void) => subscribe(WAKE_SNAPSHOT_SHOW_CHANNEL, callback),
  onFade: (callback: (token: number) => void): (() => void) =>
    subscribe(WAKE_SNAPSHOT_FADE_CHANNEL, callback),
  onHide: (callback: (token: number) => void): (() => void) =>
    subscribe(WAKE_SNAPSHOT_HIDE_CHANNEL, callback),
  /** Input that landed on the picture: main hands it to the page. */
  input: (token: number, input: WakeSnapshotInput): void =>
    ipcRenderer.send(WAKE_SNAPSHOT_INPUT_CHANNEL, token, input),
  faded: (token: number): void =>
    ipcRenderer.send(WAKE_SNAPSHOT_FADED_CHANNEL, token),
};
