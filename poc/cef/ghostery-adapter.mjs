import { Request } from "@ghostery/adblocker";

const CEF_TO_GHOSTERY_TYPE = Object.freeze({
  main_frame: "main_frame",
  sub_frame: "sub_frame",
  stylesheet: "stylesheet",
  script: "script",
  image: "image",
  font: "font",
  object: "object",
  xhr: "xmlhttprequest",
  xmlhttprequest: "xmlhttprequest",
  ping: "ping",
  csp_report: "csp_report",
  media: "media",
  websocket: "websocket",
  other: "other",
});

/**
 * Convert the subset of CEF request context needed by Ghostery's network matcher.
 * CEF's frame URL acts as the source document; service-worker requests without a
 * frame remain an explicit limitation and should not be assigned a guessed page.
 */
export function ghosteryRequestFromCef({
  url,
  frameUrl = "",
  resourceType = "other",
  requestId = "",
}) {
  if (typeof url !== "string" || url.length === 0) {
    throw new TypeError("CEF request URL is required");
  }
  const normalizedType = String(resourceType).toLowerCase();
  return Request.fromRawDetails({
    requestId: String(requestId),
    url,
    sourceUrl: typeof frameUrl === "string" ? frameUrl : "",
    type: CEF_TO_GHOSTERY_TYPE[normalizedType] ?? "other",
  });
}

/**
 * Return a small native-friendly decision packet. Ghostery's `match` is true
 * only when a blocking filter survives exception matching. `redirect` and
 * `rewrite` are separate operations and are surfaced rather than misreported
 * as an unconditional block.
 */
export function evaluateCefRequest(engine, cefDetails) {
  const request = ghosteryRequestFromCef(cefDetails);
  const response = engine.match(request);
  if (response.match) {
    if (response.redirect?.dataUrl) {
      return {
        action: "redirect",
        url: response.redirect.dataUrl,
        filter: response.filter?.toString(),
      };
    }
    return { action: "block", filter: response.filter?.toString() };
  }
  if (response.rewrite?.url) {
    return { action: "rewrite", url: response.rewrite.url };
  }
  return {
    action: "allow",
    exception: response.exception?.toString(),
  };
}
