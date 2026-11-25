/**
 * Cloudflare Turnstile's post-quantum "flavour" round routes the challenge's asset requests to
 * hosts that are broken at Cloudflare's end (`brunhild` has no working address, `hagen` hangs in
 * TLS). Helpers for a narrow, Cloudflare-only rewrite of those hosts onto the platform host —
 * an experiment, not a fix: the probe showed the rewritten asset request 404s there, so the round
 * assets are host-bound. Pure: no Electron or network access.
 */

export const CHALLENGE_PLATFORM_HOST = "challenges.cloudflare.com";

/** Only these dead hosts are redirected. The canary/dnstest hosts work already and are left alone. */
export const CHALLENGE_ROUND_HOSTS = [
  "brunhild.challenges.cloudflare.com",
  "hagen.challenges.cloudflare.com",
  "ca2-cdn-cfchl.cloudflarechallenges.com",
] as const;

const ROUND_HOSTS = new Set<string>(CHALLENGE_ROUND_HOSTS);

/** Hosts of the Cloudflare challenge document/frame — the only responses whose CSP we touch. */
export function isCloudflareChallengeHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  if (normalized === CHALLENGE_PLATFORM_HOST) return true;
  return normalized.endsWith(`.${CHALLENGE_PLATFORM_HOST}`);
}

export function isDeadChallengeRoundHost(host: string): boolean {
  return ROUND_HOSTS.has(host.trim().toLowerCase().replace(/\.$/, ""));
}

/** True when `url` is a Cloudflare challenge document/frame response (safe on malformed URLs). */
export function isCloudflareChallengeUrl(url: string): boolean {
  try {
    return isCloudflareChallengeHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * The rewrite is currently disabled: the probe showed the round assets 404 on the platform host,
 * so it only changes how the challenge fails. Opt in with SURFFISH_CF_REWRITE=1 for experiments.
 */
export function isCloudflareRewriteEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env["SURFFISH_CF_REWRITE"] === "1";
}

/**
 * The URL to load instead of `url`, or null for anything outside the dead challenge hosts.
 * Only default-port https is rewritten; path, query and fragment are preserved so the round id
 * and asset name still identify the same resource.
 */
export function cloudflareChallengeTarget(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.port !== "" ||
    parsed.username ||
    parsed.password ||
    !isDeadChallengeRoundHost(parsed.hostname)
  )
    return null;
  parsed.host = CHALLENGE_PLATFORM_HOST;
  return parsed.toString();
}

/**
 * Add `host` to every connect-src directive of a CSP, or null when there is nothing to change.
 * Directives end at `; ` or end of string — a bare `;` is not enough, because the challenge's meta
 * tag writes `'self'` as `&#39;self&#39;` and the entity's semicolon is not a separator. The quotes
 * are source keywords, not a wrapper, so the host is appended after them.
 */
export function addConnectSrcHost(csp: string, host: string): string | null {
  let changed = false;
  const next = csp.replace(
    /(connect-src\s+)([\s\S]*?)(?=;\s|$)/gi,
    (whole, prefix: string, value: string) => {
      if (value.split(/\s+/).includes(host)) return whole;
      changed = true;
      const trailing = /\s*$/.exec(value)?.[0] ?? "";
      return (
        prefix +
        value.slice(0, value.length - trailing.length) +
        " " +
        host +
        trailing
      );
    },
  );
  return changed ? next : null;
}
