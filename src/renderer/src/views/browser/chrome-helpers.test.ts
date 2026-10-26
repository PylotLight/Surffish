import { describe, expect, test } from "bun:test";
import Browser from "../Browser";
import {
  httpOrigin,
  historyHost,
  isIntegrationsMode,
  isSettingsSection,
  settingsNavMode,
} from "./chrome-helpers";

describe("Browser public export contract", () => {
  test("continues to expose the Browser component as the default export", () => {
    expect(typeof Browser).toBe("function");
  });
});

describe("browser chrome helpers", () => {
  test("recognizes the settings section families and integrations children", () => {
    expect(isSettingsSection("settings")).toBe(true);
    expect(isSettingsSection("feeds")).toBe(true);
    expect(isSettingsSection("tabs")).toBe(false);
    expect(isIntegrationsMode("readaloud")).toBe(true);
    expect(isIntegrationsMode("privacy")).toBe(false);
    expect(settingsNavMode("feeds")).toBe("integrations");
    expect(settingsNavMode("privacy")).toBe("privacy");
  });

  test("normalizes web origins and leaves non-web or malformed URLs out", () => {
    expect(httpOrigin("https://www.example.test:8443/path?q=1")).toBe(
      "https://www.example.test:8443",
    );
    expect(httpOrigin("file:///tmp/page.html")).toBeNull();
    expect(httpOrigin("not a URL")).toBeNull();
    expect(historyHost("https://example.test/path")).toBe("example.test");
    expect(historyHost("bad URL")).toBe("bad URL");
  });
});
