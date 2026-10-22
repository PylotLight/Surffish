/**
 * Camera access for Bramble's own pages (the "Scan QR" Surffish adds to Bramble's Join a device form,
 * see bramble-qr-join-page.cjs). Only the loaded Bramble extension's origin, only `media`, and only
 * video: a request that also wants the microphone is refused like any other site's.
 */
export type BrambleCameraDecision = "allow" | "deny" | "not-bramble";

/** True when `url` is a page of the loaded Bramble extension (`chrome-extension://<id>/…`). */
export function isBrambleExtensionOrigin(
  url: string | undefined,
  extensionId: string | null,
): boolean {
  if (!url || !extensionId) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "chrome-extension:" &&
      parsed.host === extensionId &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port
    );
  } catch {
    return false;
  }
}

/**
 * A permission request (`mediaTypes`, from setPermissionRequestHandler) or check (`mediaType`, from
 * setPermissionCheckHandler) from Bramble. 'not-bramble' leaves it to the normal site policy.
 */
export function brambleCameraDecision(
  permission: string,
  url: string | undefined,
  extensionId: string | null,
  media: { mediaTypes?: readonly string[]; mediaType?: string },
): BrambleCameraDecision {
  if (permission !== "media" || !isBrambleExtensionOrigin(url, extensionId))
    return "not-bramble";
  if (media.mediaTypes !== undefined) {
    return media.mediaTypes.length > 0 &&
      media.mediaTypes.every((type) => type === "video")
      ? "allow"
      : "deny";
  }
  return media.mediaType === "video" ? "allow" : "deny";
}
