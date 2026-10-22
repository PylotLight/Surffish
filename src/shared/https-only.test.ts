import { describe, expect, test } from "bun:test";
import {
  CHROMIUM_HTTPS_UPGRADE_FEATURES,
  httpFallbackUrl,
  httpsUpgradeTarget,
  isHttpsUpgradeFailure,
  isInsecurePageUrl,
  isLocalOrPrivateHost,
  localHttpFallbackUrl,
  mergeFeatureList,
  normalizeHttpsExceptions,
  pageTransportSecurity,
} from "./https-only.ts";

const none = new Set<string>();

describe("httpsUpgradeTarget", () => {
  test("upgrades plain http on the default port", () => {
    expect(httpsUpgradeTarget("http://example.com/a?b=1#c", none)).toBe(
      "https://example.com/a?b=1#c",
    );
  });
  test("never upgrades local, private, intranet or non-default ports", () => {
    for (const url of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://app.localhost/",
      "http://printer.local/",
      "http://192.168.1.10/",
      "http://10.0.0.2/",
      "http://172.20.0.1/",
      "http://169.254.1.1/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://nas/",
      "http://example.com:8080/",
    ]) {
      expect(httpsUpgradeTarget(url, none)).toBeNull();
    }
  });
  test("leaves https, other schemes and excepted hosts alone", () => {
    expect(httpsUpgradeTarget("https://example.com/", none)).toBeNull();
    expect(httpsUpgradeTarget("ftp://example.com/", none)).toBeNull();
    expect(
      httpsUpgradeTarget("http://old.example/", new Set(["old.example"])),
    ).toBeNull();
  });
  test("public addresses that look private are still upgraded", () => {
    expect(isLocalOrPrivateHost("172.32.0.1")).toBe(false);
    expect(isLocalOrPrivateHost("8.8.8.8")).toBe(false);
    expect(httpFallbackUrl("https://example.com/x")).toBe(
      "http://example.com/x",
    );
  });
});

describe("isHttpsUpgradeFailure", () => {
  test("certificate, TLS and connection errors count", () => {
    for (const error of [
      "net::ERR_CERT_AUTHORITY_INVALID",
      "net::ERR_SSL_PROTOCOL_ERROR",
      "net::ERR_CONNECTION_REFUSED",
      "ERR_TOO_MANY_REDIRECTS",
      "ERR_CONNECTION_TIMED_OUT (-118)",
    ])
      expect(isHttpsUpgradeFailure(error)).toBe(true);
  });
  test("DNS failures and aborts do not (http would fail too)", () => {
    for (const error of [
      "net::ERR_NAME_NOT_RESOLVED",
      "net::ERR_ABORTED",
      "net::ERR_BLOCKED_BY_CLIENT",
    ])
      expect(isHttpsUpgradeFailure(error)).toBe(false);
  });
});

describe("misc", () => {
  test("Not secure marker for http pages except loopback", () => {
    expect(isInsecurePageUrl("http://example.com/")).toBe(true);
    expect(isInsecurePageUrl("http://192.168.1.1/")).toBe(true);
    expect(isInsecurePageUrl("http://localhost:3000/")).toBe(false);
    expect(isInsecurePageUrl("https://example.com/")).toBe(false);
  });
  test("exceptions are hostnames, deduped", () => {
    expect(
      normalizeHttpsExceptions([
        "A.example",
        "a.example",
        "bad host",
        "x/y",
        3,
      ]),
    ).toEqual(["a.example"]);
  });
  test("transport label: LAN http is its own (milder) Not secure; loopback is a secure context", () => {
    expect(pageTransportSecurity("https://192.168.1.1/")).toBe("https");
    expect(pageTransportSecurity("http://localhost:3000/")).toBe("loopback");
    expect(pageTransportSecurity("http://[::1]/")).toBe("loopback");
    for (const url of [
      "http://192.168.1.10/",
      "http://10.1.2.3:8080/",
      "http://printer.local/",
      "http://nas/",
      "http://[fd00::1]/",
      "http://100.64.0.1/",
    ])
      expect(pageTransportSecurity(url)).toBe("http-local-network");
    expect(pageTransportSecurity("http://example.com/")).toBe("http");
    expect(pageTransportSecurity("surffish://newtab")).toBe("other");
    expect(pageTransportSecurity("not a url")).toBe("other");
    expect(isInsecurePageUrl("http://192.168.1.10/")).toBe(true);
    expect(isInsecurePageUrl("surffish://newtab")).toBe(false);
  });
});

describe("localHttpFallbackUrl", () => {
  test("offers http for a local host whose https failed (TLS, certificate, refused)", () => {
    expect(
      localHttpFallbackUrl("https://192.168.1.10/", "ERR_SSL_PROTOCOL_ERROR"),
    ).toBe("http://192.168.1.10/");
    expect(
      localHttpFallbackUrl(
        "https://192.168.1.10/setup?a=1",
        "net::ERR_SSL_PROTOCOL_ERROR",
      ),
    ).toBe("http://192.168.1.10/setup?a=1");
    expect(
      localHttpFallbackUrl("https://nas.local/", "ERR_CERT_AUTHORITY_INVALID"),
    ).toBe("http://nas.local/");
    expect(
      localHttpFallbackUrl(
        "https://10.0.0.2/",
        "ERR_CONNECTION_REFUSED (-102)",
      ),
    ).toBe("http://10.0.0.2/");
  });
  test("never for public hosts, explicit https ports, http pages or unrelated errors", () => {
    expect(
      localHttpFallbackUrl("https://example.com/", "ERR_SSL_PROTOCOL_ERROR"),
    ).toBeNull();
    expect(
      localHttpFallbackUrl(
        "https://192.168.1.10:8443/",
        "ERR_SSL_PROTOCOL_ERROR",
      ),
    ).toBeNull();
    expect(
      localHttpFallbackUrl("http://192.168.1.10/", "ERR_CONNECTION_REFUSED"),
    ).toBeNull();
    expect(
      localHttpFallbackUrl("https://192.168.1.10/", "ERR_NAME_NOT_RESOLVED"),
    ).toBeNull();
    expect(localHttpFallbackUrl("https://192.168.1.10/", null)).toBeNull();
  });
});

describe("Chromium upgrade features", () => {
  test("merged into an existing --disable-features value once", () => {
    expect(mergeFeatureList("", ["HttpsUpgrades"])).toBe("HttpsUpgrades");
    expect(
      mergeFeatureList("Foo, HttpsUpgrades", ["HttpsUpgrades", "Bar"]),
    ).toBe("Foo,HttpsUpgrades,Bar");
    expect(CHROMIUM_HTTPS_UPGRADE_FEATURES).toContain("HttpsUpgrades");
    expect(CHROMIUM_HTTPS_UPGRADE_FEATURES).toContain("HttpsFirstBalancedMode");
  });
});
