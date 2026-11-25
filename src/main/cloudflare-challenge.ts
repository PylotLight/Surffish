import {
  CHALLENGE_PLATFORM_HOST,
  addConnectSrcHost,
  cloudflareChallengeTarget,
  isCloudflareChallengeUrl,
  isCloudflareRewriteEnabled,
} from "../shared/cloudflare-challenge";
import { onPageSessionCreated } from "./browser-session";
import {
  addRequestGate,
  addResponseHeadersHook,
  type HeaderRecord,
} from "./request-gate";

/**
 * Cloudflare assigns Chromium clients a Turnstile round whose asset hosts are dead
 * (`brunhild` has no working address, `hagen` hangs in TLS), so the widget retries forever and
 * TorBox rejects the login. A passing WebKit client loads those assets from the platform host.
 *
 * Scope: a request gate redirects only the three dead challenge hosts, and a response-header
 * hook widens connect-src only on challenges.cloudflare.com responses. No other traffic is
 * touched, no certificate checks are relaxed, and the app's proxy/SSH routing stays in charge.
 *
 * Disabled by default: the probe showed the rewritten asset request 404s on the platform host,
 * so today it only changes how the challenge fails. Set SURFFISH_CF_REWRITE=1 to experiment.
 */
export function initializeCloudflareChallengeRewrite(): void {
  if (!isCloudflareRewriteEnabled(process.env)) return;

  addRequestGate((details) => {
    const redirectURL = cloudflareChallengeTarget(details.url);
    if (!redirectURL) return null;
    console.debug("[cf-challenge]", details.url, "->", redirectURL);
    return { redirectURL };
  });

  void onPageSessionCreated((target) => {
    addResponseHeadersHook(target, (details, headers) => {
      if (!isCloudflareChallengeUrl(details.url)) return null;
      const key = Object.keys(headers).find(
        (name) => name.toLowerCase() === "content-security-policy",
      );
      if (!key) return null;
      const value = headers[key];
      if (value === undefined) return null;
      if (Array.isArray(value)) {
        const patched = value
          .map((csp) => addConnectSrcHost(csp, CHALLENGE_PLATFORM_HOST))
          .filter((csp): csp is string => csp !== null);
        if (patched.length === 0) return null;
        const next: HeaderRecord = { ...headers, [key]: patched };
        return next;
      }
      const patched = addConnectSrcHost(value, CHALLENGE_PLATFORM_HOST);
      return patched ? { ...headers, [key]: patched } : null;
    });
  });
}
