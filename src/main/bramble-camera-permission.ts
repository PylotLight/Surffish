/**
 * Camera for Bramble's Join a device "Scan QR" (src/shared/bramble-qr-join-page.cjs). The session's
 * permission policy (proxy.ts) asks here first: video-only `media` from the loaded Bramble extension's
 * own pages is allowed, after macOS camera consent; Bramble asking for the microphone is denied like
 * any site, visibly. Everything else goes to the normal site policy.
 */
import { systemPreferences } from "electron";
import {
  brambleCameraDecision,
  type BrambleCameraDecision,
} from "../shared/bramble-camera";

let extensionIdProvider: () => string | null = () => null;

/** bramble-poc.ts registers how to read the loaded Bramble extension's ID (null when not loaded). */
export function registerBrambleExtensionIdProvider(
  provider: () => string | null,
): void {
  extensionIdProvider = provider;
}

function currentExtensionId(): string | null {
  try {
    return extensionIdProvider();
  } catch {
    return null;
  }
}

export function brambleCameraRequestDecision(
  permission: string,
  requestingUrl: string,
  mediaTypes: readonly string[] | undefined,
): BrambleCameraDecision {
  return brambleCameraDecision(
    permission,
    requestingUrl,
    currentExtensionId(),
    { mediaTypes: mediaTypes ?? [] },
  );
}

export function brambleCameraCheckDecision(
  permission: string,
  requestingOrigin: string,
  mediaType: string | undefined,
): BrambleCameraDecision {
  return brambleCameraDecision(
    permission,
    requestingOrigin,
    currentExtensionId(),
    { mediaType },
  );
}

/** macOS: Surffish needs the system camera permission too (NSCameraUsageDescription in Info.plist). */
export async function ensureSystemCameraAccess(): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  try {
    const status = systemPreferences.getMediaAccessStatus("camera");
    if (status === "granted") return true;
    if (status === "not-determined")
      return await systemPreferences.askForMediaAccess("camera");
    return false;
  } catch (error) {
    console.warn("[bramble] could not check macOS camera access:", error);
    return false;
  }
}
