import { describe, expect, test } from "bun:test";
import {
  createPermissionToastThrottle,
  isAlwaysAllowedPermission,
  permissionDeniedMessage,
} from "./site-permissions.ts";

describe("isAlwaysAllowedPermission", () => {
  test("clipboard writes, fullscreen and pointer lock are allowed like Chrome", () => {
    for (const permission of [
      "clipboard-sanitized-write",
      "fullscreen",
      "pointerLock",
    ])
      expect(isAlwaysAllowedPermission(permission)).toBe(true);
  });
  test("clipboard reads and sensitive permissions still need site settings", () => {
    for (const permission of [
      "clipboard-read",
      "media",
      "geolocation",
      "notifications",
      "openExternal",
    ]) {
      expect(isAlwaysAllowedPermission(permission)).toBe(false);
    }
  });
});

describe("permissionDeniedMessage", () => {
  test("points at Site settings for permissions it can allow", () => {
    expect(
      permissionDeniedMessage("clipboard-read", "https://github.com"),
    ).toBe("Clipboard blocked on github.com · allow in Site settings");
  });
  test("plain message for the rest, raw name for unknown ones", () => {
    expect(permissionDeniedMessage("usb", "https://a.test")).toBe(
      "USB devices blocked on a.test",
    );
    expect(permissionDeniedMessage("weird-thing", "")).toBe(
      "weird-thing blocked",
    );
  });
  test("extension pages point at macOS camera access, not Site settings", () => {
    expect(permissionDeniedMessage("media", "chrome-extension://abc")).toBe(
      "Camera/mic blocked for this extension · check System Settings → Privacy & Security → Camera",
    );
    expect(
      permissionDeniedMessage("geolocation", "chrome-extension://abc"),
    ).toBe("Location blocked for this extension");
  });
});

describe("createPermissionToastThrottle", () => {
  test("shows once per origin+permission per window", () => {
    let time = 0;
    const shouldShow = createPermissionToastThrottle(1000, () => time);
    expect(shouldShow("clipboard-read", "https://a.test")).toBe(true);
    expect(shouldShow("clipboard-read", "https://a.test")).toBe(false);
    expect(shouldShow("media", "https://a.test")).toBe(true);
    time = 1500;
    expect(shouldShow("clipboard-read", "https://a.test")).toBe(true);
  });
});
