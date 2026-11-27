import { describe, expect, test } from "bun:test";
import {
  isCookieDomainAllowed,
  isTorBoxLoginUrl,
  TORBOX_COOKIE_DOMAIN,
  TORBOX_LOGIN_URL,
} from "./webkit-login.ts";

describe("isTorBoxLoginUrl", () => {
  test("matches the login page on torbox.app and its subdomains", () => {
    for (const url of [
      TORBOX_LOGIN_URL,
      "https://torbox.app/login",
      "https://www.torbox.app/login?next=%2Fdashboard",
      "https://www.torbox.app/login#form",
    ])
      expect(isTorBoxLoginUrl(url)).toBe(true);
  });

  test("leaves the rest of TorBox and other sites alone", () => {
    for (const url of [
      "https://www.torbox.app/",
      "https://www.torbox.app/dashboard",
      "https://www.torbox.app/logins",
      "http://www.torbox.app/login",
      "https://torbox.app.evil.test/login",
      "https://example.com/login",
      "not a url",
      null,
      undefined,
    ])
      expect(isTorBoxLoginUrl(url)).toBe(false);
  });
});

describe("isCookieDomainAllowed", () => {
  test("accepts the site and its subdomains, with or without a leading dot", () => {
    const domains = [TORBOX_COOKIE_DOMAIN];
    for (const domain of [
      "torbox.app",
      ".torbox.app",
      "www.torbox.app",
      "API.TorBox.App.",
    ])
      expect(isCookieDomainAllowed(domain, domains)).toBe(true);
  });

  test("rejects lookalikes, unrelated hosts and an empty allowlist", () => {
    const domains = [TORBOX_COOKIE_DOMAIN];
    for (const domain of [
      "torbox.app.evil.test",
      "nottorbox.app",
      "cloudflare.com",
    ])
      expect(isCookieDomainAllowed(domain, domains)).toBe(false);
    expect(isCookieDomainAllowed("torbox.app", [])).toBe(false);
  });
});
