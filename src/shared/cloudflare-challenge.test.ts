import { describe, expect, test } from "bun:test";
import {
  CHALLENGE_PLATFORM_HOST,
  addConnectSrcHost,
  cloudflareChallengeTarget,
  isCloudflareChallengeHost,
  isCloudflareChallengeUrl,
  isCloudflareRewriteEnabled,
  isDeadChallengeRoundHost,
} from "./cloudflare-challenge.ts";

describe("cloudflareChallengeTarget", () => {
  test("rewrites dead round hosts to the platform host, keeping path/query/hash", () => {
    expect(
      cloudflareChallengeTarget(
        "https://brunhild.challenges.cloudflare.com/i/a52e7abc/asset.js?v=3#x",
      ),
    ).toBe(`https://${CHALLENGE_PLATFORM_HOST}/i/a52e7abc/asset.js?v=3#x`);
    expect(
      cloudflareChallengeTarget(
        "https://hagen.challenges.cloudflare.com/cdn-cgi/challenge-platform/x",
      ),
    ).toBe(`https://${CHALLENGE_PLATFORM_HOST}/cdn-cgi/challenge-platform/x`);
    expect(
      cloudflareChallengeTarget(
        "https://ca2-cdn-cfchl.cloudflarechallenges.com/foo",
      ),
    ).toBe(`https://${CHALLENGE_PLATFORM_HOST}/foo`);
  });

  test("leaves the platform host, canary hosts and ordinary sites alone", () => {
    for (const url of [
      `https://${CHALLENGE_PLATFORM_HOST}/i/round/asset`,
      "https://abc.alg13.dnstest.challenges.cloudflare.com/x",
      "https://abc.mldsa44.dnstest.challenges.cloudflare.com/x",
      "https://dnstest.dev/x",
      "https://torbox.app/login",
      "http://brunhild.challenges.cloudflare.com/x",
      "https://brunhild.challenges.cloudflare.com:8443/x",
      "https://brunhild.challenges.cloudflare.evil.test/x",
      "not a url",
    ])
      expect(cloudflareChallengeTarget(url)).toBeNull();
  });

  test("host checks are case-insensitive and ignore a trailing dot", () => {
    expect(
      isDeadChallengeRoundHost("BRUNHILD.challenges.cloudflare.com."),
    ).toBe(true);
    expect(isCloudflareChallengeHost("Challenges.CloudFlare.com.")).toBe(true);
    expect(isCloudflareChallengeHost("foo.challenges.cloudflare.com")).toBe(
      true,
    );
    expect(isCloudflareChallengeHost("cloudflare.com")).toBe(false);
    expect(
      isCloudflareChallengeHost("challenges.cloudflare.com.evil.test"),
    ).toBe(false);
    expect(
      isCloudflareChallengeUrl(
        "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x",
      ),
    ).toBe(true);
    expect(isCloudflareChallengeUrl("https://torbox.app/login")).toBe(false);
    expect(isCloudflareChallengeUrl("not a url")).toBe(false);
  });
});

describe("isCloudflareRewriteEnabled", () => {
  test("only the explicit opt-in turns the workaround on", () => {
    expect(isCloudflareRewriteEnabled({})).toBe(false);
    expect(isCloudflareRewriteEnabled({ SURFFISH_CF_REWRITE: "0" })).toBe(
      false,
    );
    expect(isCloudflareRewriteEnabled({ SURFFISH_CF_REWRITE: "true" })).toBe(
      false,
    );
    expect(isCloudflareRewriteEnabled({ SURFFISH_CF_REWRITE: "1" })).toBe(true);
  });
});

describe("addConnectSrcHost", () => {
  test("adds the platform host to a normal CSP header once", () => {
    const csp =
      "default-src 'self'; connect-src 'self' https://hagen.challenges.cloudflare.com; style-src 'self'";
    const patched = addConnectSrcHost(csp, CHALLENGE_PLATFORM_HOST);
    expect(patched).toBe(
      "default-src 'self'; connect-src 'self' https://hagen.challenges.cloudflare.com challenges.cloudflare.com; style-src 'self'",
    );
    expect(addConnectSrcHost(patched!, CHALLENGE_PLATFORM_HOST)).toBeNull();
  });

  test("widens the challenge's meta CSP with entity-encoded quotes", () => {
    const csp =
      "default-src &#39;self&#39;; connect-src &#39;self&#39;; style-src &#39;self&#39;";
    expect(addConnectSrcHost(csp, CHALLENGE_PLATFORM_HOST)).toBe(
      "default-src &#39;self&#39;; connect-src &#39;self&#39; challenges.cloudflare.com; style-src &#39;self&#39;",
    );
  });

  test("handles plain and double-quoted values without a trailing directive", () => {
    expect(addConnectSrcHost("connect-src 'self'", "https://x.test")).toBe(
      "connect-src 'self' https://x.test",
    );
    expect(addConnectSrcHost('connect-src "self"', "https://x.test")).toBe(
      'connect-src "self" https://x.test',
    );
    expect(
      addConnectSrcHost(
        "script-src 'self'; connect-src data:",
        "https://x.test",
      ),
    ).toBe("script-src 'self'; connect-src data: https://x.test");
  });

  test("leaves CSPs without connect-src untouched", () => {
    expect(
      addConnectSrcHost("default-src 'self'", "https://x.test"),
    ).toBeNull();
  });
});
