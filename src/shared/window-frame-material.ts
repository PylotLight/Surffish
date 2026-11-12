export type WindowFrameMaterial = "macos-sidebar" | "windows-mica" | "solid";

/** Electron's Windows system backdrop support starts at Windows 11 22H2 (build 22621). */
export const WINDOWS_MICA_MIN_BUILD = 22621;

function windowsBuild(osRelease: string): number | null {
  const rawBuild = osRelease.split(".")[2];
  if (!rawBuild || !/^\d+$/.test(rawBuild)) return null;
  const build = Number(rawBuild);
  return Number.isSafeInteger(build) ? build : null;
}

export function resolveWindowFrameMaterial(input: {
  platform: string;
  osRelease: string;
  supportsWindowsBackgroundMaterial: boolean;
}): WindowFrameMaterial {
  if (input.platform === "darwin") return "macos-sidebar";
  if (
    input.platform === "win32" &&
    input.supportsWindowsBackgroundMaterial &&
    (windowsBuild(input.osRelease) ?? 0) >= WINDOWS_MICA_MIN_BUILD
  )
    return "windows-mica";
  return "solid";
}
