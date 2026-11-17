/** Native macOS traffic lights are outside the renderer layers hidden in app fullscreen. */
export function applyNativeFullscreenWindowButtons(
  platform: string,
  nativeFullscreen: boolean,
  setWindowButtonVisibility: (visible: boolean) => void,
): void {
  if (platform !== "darwin") return;
  setWindowButtonVisibility(!nativeFullscreen);
}
