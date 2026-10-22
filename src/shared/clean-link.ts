/**
 * "Copy Clean Link": drop click-tracking and share-attribution query parameters so a copied
 * link carries only what the page needs. Unknown parameters are kept; the raw encoding of
 * whatever survives is left exactly as it was.
 */

// Tracking parameters removed on every site (compared lowercased).
const GLOBAL_TRACKING_PARAMS = new Set([
  // ad click ids
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "li_fat_id",
  "epik",
  "rdt_cid",
  "scclid",
  "irclickid",
  "srsltid",
  // email / marketing platforms
  "mc_eid",
  "mc_cid",
  "_hsenc",
  "_hsmi",
  "__hssc",
  "__hstc",
  "__hsfp",
  "hsctatracking",
  "mkt_tok",
  "oly_anon_id",
  "oly_enc_id",
  "vero_id",
  "vero_conv",
  "wickedid",
  "rb_clickid",
  "s_cid",
  "ml_subscriber",
  "ml_subscriber_hash",
  // analytics cross-domain linkers
  "_ga",
  "_gl",
  "_ke",
  "_kx",
  // social share attribution
  "igshid",
  "igsh",
  "ref_src",
  "ref_url",
]);

// Prefixes removed everywhere (utm_source, utm_medium, ... and Piwik/Matomo pk_ / mtm_).
const GLOBAL_TRACKING_PREFIXES = ["utm_", "pk_", "mtm_"];

// Parameters that are only tracking on particular sites (elsewhere `si` or `t` can be real state).
const SITE_TRACKING_PARAMS: ReadonlyArray<{
  hosts: readonly string[];
  params: ReadonlySet<string>;
}> = [
  {
    hosts: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    params: new Set(["si", "feature", "pp"]),
  },
  {
    hosts: ["spotify.com", "spotify.link"],
    params: new Set(["si", "context", "nd"]),
  },
  { hosts: ["twitter.com", "x.com"], params: new Set(["s", "t"]) },
  { hosts: ["instagram.com"], params: new Set(["igsh", "img_index"]) },
  {
    hosts: ["tiktok.com"],
    params: new Set([
      "_r",
      "_t",
      "is_from_webapp",
      "sender_device",
      "is_copy_url",
      "share_app_id",
      "share_link_id",
    ]),
  },
  {
    hosts: ["linkedin.com"],
    params: new Set(["trk", "trkinfo", "lipi", "licu", "rcm"]),
  },
  { hosts: ["reddit.com"], params: new Set(["share_id", "rdt"]) },
  { hosts: ["facebook.com"], params: new Set(["mibextid", "sfnsn"]) },
  {
    hosts: [
      "amazon.com",
      "amazon.co.uk",
      "amazon.com.au",
      "amazon.de",
      "amazon.ca",
    ],
    params: new Set([
      "pd_rd_r",
      "pd_rd_w",
      "pd_rd_wg",
      "pf_rd_p",
      "pf_rd_r",
      "pd_rd_i",
      "content-id",
      "ref",
      "qid",
      "sr",
      "crid",
      "sprefix",
      "dib",
      "dib_tag",
    ]),
  },
];

function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

export function isTrackingParam(name: string, hostname = ""): boolean {
  const key = name.toLowerCase();
  if (GLOBAL_TRACKING_PARAMS.has(key)) return true;
  if (GLOBAL_TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix)))
    return true;
  const host = hostname.toLowerCase();
  return SITE_TRACKING_PARAMS.some(
    (site) =>
      site.params.has(key) &&
      site.hosts.some((candidate) => hostMatches(host, candidate)),
  );
}

function decodeParamName(raw: string): string {
  try {
    return decodeURIComponent(raw.replaceAll("+", " "));
  } catch {
    return raw;
  }
}

/** Returns the link without tracking parameters; non-http(s) or unparsable input comes back unchanged. */
export function cleanLinkUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return input;
  const query = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  if (query) {
    const kept = query.split("&").filter((part) => {
      if (!part) return false;
      const name = decodeParamName(part.split("=", 1)[0] ?? "");
      return !isTrackingParam(name, url.hostname);
    });
    url.search = kept.length > 0 ? `?${kept.join("&")}` : "";
  }
  // Some sites put utm params in the fragment (#utm_source=...); drop a fragment made only of them.
  if (url.hash.length > 1 && url.hash.includes("=")) {
    const parts = url.hash.slice(1).split("&");
    if (
      parts.every((part) =>
        isTrackingParam(
          decodeParamName(part.split("=", 1)[0] ?? ""),
          url.hostname,
        ),
      )
    )
      url.hash = "";
  }
  return url.toString();
}
