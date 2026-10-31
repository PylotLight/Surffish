// Diagnostics probe: what does the real production ad-filter engine do to the URLs involved in
// the TorBox login failure? Runs the same lists/config as the app (uBO uAssets + FULL_FILTER_CONFIG
// + the uBO `!#if` environment) and asks the engine about each request. No Electron, no login.
//   bun run scripts/probe-torbox-engine.ts
import { Request } from "@ghostery/adblocker-electron";
import {
  applyFilterEnvironment,
  compileFilterEngine,
  downloadFilterLists,
} from "../src/main/adblock-filters.ts";

const lists = await downloadFilterLists(fetch);
console.log(
  `engine built: ${lists.loadedLists.length} lists (${lists.failedLists.length} failed: ${lists.failedLists.join(", ") || "none"})`,
);
const engine = applyFilterEnvironment(compileFilterEngine(lists));

interface Scenario {
  label: string;
  url: string;
  resourceType: string;
  sourceUrl?: string;
  referrer?: string;
}

const PAGE = "https://www.torbox.app/login";
const scenarios: Scenario[] = [
  { label: "main document", url: PAGE, resourceType: "mainFrame" },
  {
    label: "CF insights beacon",
    url: "https://static.cloudflareinsights.com/beacon.min.js",
    resourceType: "script",
    sourceUrl: PAGE,
    referrer: PAGE,
  },
  {
    label: "CF challenge iframe",
    url: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/flexible?lang=auto",
    resourceType: "subFrame",
    sourceUrl: PAGE,
    referrer: PAGE,
  },
  {
    label: "CF challenge platform POST (zone)",
    url: "https://www.torbox.app/cdn-cgi/challenge-platform/h/0/a52835856cbb662e",
    resourceType: "xhr",
    sourceUrl: PAGE,
    referrer: PAGE,
  },
  {
    label: "CF challenge platform POST (challenges host)",
    url: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/0/a52835856cbb662e",
    resourceType: "xhr",
    sourceUrl: PAGE,
    referrer: PAGE,
  },
  {
    label: "auth API",
    url: "https://api.torbox.app/v1/api/user/auth",
    resourceType: "xhr",
    sourceUrl: PAGE,
    referrer: PAGE,
  },
  {
    label: "CF font on challenges host",
    url: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/fonts/font.woff2",
    resourceType: "font",
    sourceUrl:
      "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/flexible?lang=auto",
  },
  {
    label: "CF script on challenges host",
    url: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/orchestrate/chlapi/v1?ray=abc",
    resourceType: "script",
    sourceUrl:
      "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/flexible?lang=auto",
  },
];

for (const scenario of scenarios) {
  const details = {
    url: scenario.url,
    method: "GET",
    resourceType: scenario.resourceType,
    referrer: scenario.referrer ?? "",
    initiator: "",
  };
  let response: {
    cancel?: boolean;
    redirectURL?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string | string[]>;
  } = {};
  engine.onBeforeRequest(details as never, (r) => {
    response = r as typeof response;
  });
  const parts: string[] = [];
  if (response.cancel) parts.push("CANCELLED");
  if (response.redirectURL) parts.push(`REDIRECT -> ${response.redirectURL}`);
  if (response.requestHeaders)
    parts.push(`reqHeaders: ${JSON.stringify(response.requestHeaders)}`);

  // Response side: CSP injection for document-type requests.
  const headersIn = { "content-type": "text/html" };
  let headersOut: Record<string, string | string[]> = {};
  engine.onHeadersReceived(
    { ...details, responseHeaders: headersIn } as never,
    (r) => {
      headersOut =
        (r as { responseHeaders?: typeof headersOut }).responseHeaders ?? {};
    },
  );
  const csp = headersOut["content-security-policy"];
  if (csp) parts.push(`CSP INJECTED: ${JSON.stringify(csp)}`);

  // Which rules matched, and what cosmetics apply.
  const request = Request.fromRawDetails({
    url: scenario.url,
    sourceUrl: scenario.sourceUrl ?? "",
  });
  let matchedNames: string[] = [];
  try {
    const result = engine.match(request, true) as unknown as {
      matchedFilters?: Array<{ source?: string; filter?: { filter?: string } }>;
      blocked?: boolean;
      redirect?: string;
    };
    matchedNames = (result.matchedFilters ?? [])
      .map((filter) => filter.filter?.filter ?? "?")
      .slice(0, 5);
  } catch {
    // match() may be shaped differently across versions; the onBeforeRequest answer above stands.
  }
  let cosmetic = "";
  try {
    const url = new URL(scenario.url);
    const hostname = url.hostname;
    const cos = engine.getCosmeticsFilters({
      url: scenario.url,
      hostname,
      domain: hostname.replace(/^www\./, ""),
      getBaseRules: true,
      getInjectionRules: true,
      getRulesFromHostname: true,
      getRulesFromDOM: false,
      getExtendedRules: false,
    });
    if (cos.active)
      cosmetic = `cosmetics: ${cos.styles ? `${cos.styles.length}B css` : ""} ${cos.scripts.length} scriptlets`;
  } catch {
    // not a web page shape
  }
  const summary = parts.length > 0 ? parts.join(" | ") : "allowed";
  const rules =
    matchedNames.length > 0 ? `  rules: ${matchedNames.join("; ")}` : "";
  const cosPart = cosmetic ? `  ${cosmetic}` : "";
  console.log(`\n${scenario.label}\n  ${summary}${rules}${cosPart}`);
}
