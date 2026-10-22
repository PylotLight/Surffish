/**
 * chrome.declarativeNetRequest rule matching for Web Store extensions, done by Surffish itself.
 *
 * Electron 44 ships the DNR API and would enforce rules natively, but only while the session has
 * no webRequest listeners of its own. Surffish always has one (ad blocker, request gates), so the
 * native engine never sees a request. Surffish parses each extension's rules (static rulesets from
 * the manifest, plus the dynamic/session rules the extension sets) and evaluates them here, from the
 * single webRequest handler the ad blocker owns.
 *
 * Pure logic (no Electron): parsing/validation, an indexed matcher, Chrome's priority and action
 * precedence, redirect building and header operations.
 *
 * Semantics follow https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest:
 *  - urlFilter: `*` wildcard, `|` start/end anchor, `||` domain anchor, `^` separator; case-insensitive
 *    unless isUrlFilterCaseSensitive.
 *  - Highest priority wins; ties go allow > allowAllRequests > block > upgradeScheme > redirect, then
 *    session > dynamic > static rulesets. modifyHeaders rules apply when no allow/allowAllRequests
 *    rule of equal or higher priority matched, in descending priority.
 */
import { getDomain } from "tldts-experimental";

export const DNR_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
] as const;
export type DnrResourceType = (typeof DNR_RESOURCE_TYPES)[number];

export const DNR_ACTION_TYPES = [
  "block",
  "redirect",
  "allow",
  "upgradeScheme",
  "modifyHeaders",
  "allowAllRequests",
] as const;
export type DnrActionType = (typeof DNR_ACTION_TYPES)[number];

export type DnrRulesetKind = "session" | "dynamic" | "static";

export interface DnrHeaderInfo {
  header: string;
  operation: "append" | "set" | "remove";
  value?: string;
}

export interface DnrQueryKeyValue {
  key: string;
  value: string;
  replaceOnly?: boolean;
}

export interface DnrUrlTransform {
  scheme?: string;
  host?: string;
  port?: string;
  path?: string;
  query?: string;
  queryTransform?: {
    removeParams?: string[];
    addOrReplaceParams?: DnrQueryKeyValue[];
  };
  fragment?: string;
  username?: string;
  password?: string;
}

export interface DnrRedirect {
  url?: string;
  extensionPath?: string;
  transform?: DnrUrlTransform;
  regexSubstitution?: string;
}

export interface DnrRuleInput {
  id: number;
  priority?: number;
  action: {
    type: DnrActionType;
    redirect?: DnrRedirect;
    requestHeaders?: DnrHeaderInfo[];
    responseHeaders?: DnrHeaderInfo[];
  };
  condition: Record<string, unknown>;
}

/** What a request looks like to the matcher. */
export interface DnrRequest {
  url: string;
  /** Origin (or URL) of the document that made the request; empty for browser-initiated navigations. */
  initiator?: string;
  method?: string;
  type: DnrResourceType;
  tabId?: number;
  /** Priority of an allowAllRequests rule covering the request's frame, if any. */
  allowAllRequestsPriority?: number;
}

const RESOURCE_TYPE_BITS = new Map<string, number>(
  DNR_RESOURCE_TYPES.map((type, index) => [type, 1 << index]),
);
const ALL_TYPES_BUT_MAIN_FRAME = DNR_RESOURCE_TYPES.reduce(
  (mask, type) =>
    type === "main_frame"
      ? mask
      : mask | (RESOURCE_TYPE_BITS.get(type) as number),
  0,
);
const FRAME_TYPES =
  (RESOURCE_TYPE_BITS.get("main_frame") as number) |
  (RESOURCE_TYPE_BITS.get("sub_frame") as number);
const REQUEST_METHODS = new Set([
  "connect",
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "other",
]);
/** Condition keys Surffish evaluates. Anything else makes the rule unenforceable (reported, skipped). */
const SUPPORTED_CONDITION_KEYS = new Set([
  "urlFilter",
  "regexFilter",
  "isUrlFilterCaseSensitive",
  "requestDomains",
  "excludedRequestDomains",
  "initiatorDomains",
  "excludedInitiatorDomains",
  "domains",
  "excludedDomains",
  "resourceTypes",
  "excludedResourceTypes",
  "requestMethods",
  "excludedRequestMethods",
  "tabIds",
  "excludedTabIds",
  "domainType",
]);
const ACTION_RANK: Record<DnrActionType, number> = {
  allow: 5,
  allowAllRequests: 4,
  block: 3,
  upgradeScheme: 2,
  redirect: 1,
  modifyHeaders: 0,
};
const RULESET_RANK: Record<DnrRulesetKind, number> = {
  session: 2,
  dynamic: 1,
  static: 0,
};

export interface CompiledDnrRule {
  id: number;
  priority: number;
  ruleset: string;
  kind: DnrRulesetKind;
  action: DnrRuleInput["action"];
  typeMask: number;
  methods: Set<string> | null;
  excludedMethods: Set<string> | null;
  tabIds: Set<number> | null;
  excludedTabIds: Set<number> | null;
  domainType: "firstParty" | "thirdParty" | null;
  requestDomains: Set<string> | null;
  excludedRequestDomains: Set<string> | null;
  initiatorDomains: Set<string> | null;
  excludedInitiatorDomains: Set<string> | null;
  /** Literal fast path (no wildcards/anchors): lower-cased unless case sensitive. */
  literal: string | null;
  caseSensitive: boolean;
  pattern: RegExp | null;
  /** Candidate indexing tokens (empty: the rule is checked for every request). */
  tokens: string[];
  /** Evaluation stamp: a rule found through several URL tokens is tested once per request. */
  seen: number;
}

export interface DnrRejectedRule {
  id: unknown;
  reason: string;
}

export interface ParsedDnrRules {
  rules: CompiledDnrRule[];
  rejected: DnrRejectedRule[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`${field} must be a list of strings`);
  return value as string[];
}

function domainSet(value: unknown, field: string): Set<string> | null {
  const list = stringArray(value, field);
  if (!list) return null;
  if (
    field === "requestDomains" ||
    field === "initiatorDomains" ||
    field === "domains"
  ) {
    if (list.length === 0) throw new Error(`${field} must not be empty`);
  }
  return new Set(list.map((entry) => entry.toLowerCase().replace(/\.$/, "")));
}

/** Characters that make up a token for indexing. Everything else is a boundary. */
const TOKEN_CHAR = /[a-z0-9%]/;
const URL_TOKENS = /[a-z0-9%]{2,}/g;

/**
 * Tokens from the urlFilter that are guaranteed to appear as whole tokens in every URL the filter
 * matches: runs of token characters bounded on both sides by a literal non-token character or an
 * anchor (never by `*` or an unanchored pattern edge, where the URL could continue the run).
 */
export function urlFilterTokens(urlFilter: string): string[] {
  let filter = urlFilter.toLowerCase();
  let leftBounded = false;
  let rightBounded = false;
  if (filter.startsWith("||")) {
    filter = filter.slice(2);
    leftBounded = true;
  } else if (filter.startsWith("|")) {
    filter = filter.slice(1);
    leftBounded = true;
  }
  if (filter.endsWith("|")) {
    filter = filter.slice(0, -1);
    rightBounded = true;
  }
  const tokens: string[] = [];
  let start = -1;
  for (let index = 0; index <= filter.length; index += 1) {
    const char = filter[index];
    const isToken = char !== undefined && TOKEN_CHAR.test(char);
    if (isToken && start < 0) start = index;
    if (!isToken && start >= 0) {
      const before =
        start === 0 ? (leftBounded ? "|" : "") : (filter[start - 1] as string);
      const after = char === undefined ? (rightBounded ? "|" : "") : char;
      const token = filter.slice(start, index);
      if (
        before !== "" &&
        before !== "*" &&
        after !== "" &&
        after !== "*" &&
        token.length >= 2
      )
        tokens.push(token);
      start = -1;
    }
  }
  return tokens;
}

/** Tokens nearly every URL has: indexing a rule under one of them saves nothing. */
const WEAK_TOKENS = new Set([
  "http",
  "https",
  "www",
  "com",
  "net",
  "org",
  "js",
  "css",
  "html",
  "php",
  "png",
  "jpg",
  "gif",
  "svg",
]);

/** The longest usable token (the matcher re-picks among all of them by bucket size). */
export function urlFilterToken(urlFilter: string): string | null {
  return urlFilterTokens(urlFilter).reduce<string | null>(
    (best, token) => (!best || token.length > best.length ? token : best),
    null,
  );
}

/** Compile a Chrome urlFilter into a RegExp (used when the literal fast path does not apply). */
export function compileUrlFilter(
  urlFilter: string,
  caseSensitive: boolean,
): RegExp {
  let filter = urlFilter;
  let prefix = "";
  let suffix = "";
  if (filter.startsWith("||")) {
    filter = filter.slice(2);
    // Start of the host or of one of its labels (after the scheme and any user info).
    prefix = "^[a-z][a-z0-9+.\\-]*:\\/\\/(?:[^\\/?#@]*@)?(?:[^\\/?#:@]*\\.)?";
  } else if (filter.startsWith("|")) {
    filter = filter.slice(1);
    prefix = "^";
  }
  if (filter.endsWith("|")) {
    filter = filter.slice(0, -1);
    suffix = "$";
  }
  let body = "";
  for (const char of filter) {
    if (char === "*") body += ".*";
    else if (char === "^") body += "(?:[^a-zA-Z0-9_\\-.%]|$)";
    else body += char.replace(/[.+?${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(prefix + body + suffix, caseSensitive ? "" : "i");
}

function compileCondition(
  rule: Record<string, unknown>,
  ruleset: string,
  kind: DnrRulesetKind,
): CompiledDnrRule {
  if (!Number.isInteger(rule.id) || (rule.id as number) < 1)
    throw new Error("id must be a positive integer");
  const priority = rule.priority === undefined ? 1 : rule.priority;
  if (!Number.isInteger(priority) || (priority as number) < 1)
    throw new Error("priority must be a positive integer");
  if (
    !isRecord(rule.action) ||
    !DNR_ACTION_TYPES.includes(rule.action.type as DnrActionType)
  )
    throw new Error("unknown action type");
  const action = rule.action as unknown as DnrRuleInput["action"];
  const condition = rule.condition === undefined ? {} : rule.condition;
  if (!isRecord(condition)) throw new Error("condition must be an object");
  for (const key of Object.keys(condition)) {
    if (!SUPPORTED_CONDITION_KEYS.has(key))
      throw new Error(`condition.${key} is not supported by Surffish`);
  }

  if (action.type === "redirect") {
    const redirect = action.redirect;
    if (
      !isRecord(redirect) ||
      (redirect.url === undefined &&
        redirect.extensionPath === undefined &&
        redirect.transform === undefined &&
        redirect.regexSubstitution === undefined)
    ) {
      throw new Error("redirect action needs a redirect target");
    }
    if (
      redirect.regexSubstitution !== undefined &&
      typeof condition.regexFilter !== "string"
    )
      throw new Error("regexSubstitution needs a regexFilter");
    if (
      redirect.extensionPath !== undefined &&
      (typeof redirect.extensionPath !== "string" ||
        !redirect.extensionPath.startsWith("/"))
    )
      throw new Error("redirect.extensionPath must start with /");
    if (redirect.url !== undefined) {
      try {
        new URL(String(redirect.url));
      } catch {
        throw new Error("redirect.url is not a valid URL");
      }
    }
  }
  if (action.type === "modifyHeaders") {
    const lists = [action.requestHeaders, action.responseHeaders];
    if (lists.every((list) => list === undefined))
      throw new Error("modifyHeaders needs requestHeaders or responseHeaders");
    for (const list of lists) {
      if (list === undefined) continue;
      if (!Array.isArray(list) || list.length === 0)
        throw new Error("modifyHeaders header lists must be non-empty");
      for (const info of list) {
        if (
          !isRecord(info) ||
          typeof info.header !== "string" ||
          !info.header ||
          !["append", "set", "remove"].includes(info.operation as string)
        )
          throw new Error("invalid header operation");
        if (info.operation !== "remove" && typeof info.value !== "string")
          throw new Error("append/set need a value");
      }
    }
  }

  const urlFilter = condition.urlFilter;
  const regexFilter = condition.regexFilter;
  if (urlFilter !== undefined && regexFilter !== undefined)
    throw new Error("urlFilter and regexFilter are mutually exclusive");
  if (
    urlFilter !== undefined &&
    (typeof urlFilter !== "string" ||
      urlFilter === "" ||
      /[^\x20-\x7e]/.test(urlFilter))
  )
    throw new Error("urlFilter must be a non-empty ASCII string");
  if (typeof urlFilter === "string" && urlFilter.startsWith("||*"))
    throw new Error("urlFilter must not start with ||*");
  if (
    regexFilter !== undefined &&
    (typeof regexFilter !== "string" || regexFilter === "")
  )
    throw new Error("regexFilter must be a non-empty string");
  const caseSensitive = condition.isUrlFilterCaseSensitive === true;

  const resourceTypes = stringArray(condition.resourceTypes, "resourceTypes");
  const excludedResourceTypes = stringArray(
    condition.excludedResourceTypes,
    "excludedResourceTypes",
  );
  if (resourceTypes && excludedResourceTypes)
    throw new Error(
      "resourceTypes and excludedResourceTypes are mutually exclusive",
    );
  for (const type of [
    ...(resourceTypes ?? []),
    ...(excludedResourceTypes ?? []),
  ]) {
    if (!RESOURCE_TYPE_BITS.has(type))
      throw new Error(`unknown resource type ${type}`);
  }
  let typeMask = resourceTypes
    ? resourceTypes.reduce(
        (mask, type) => mask | (RESOURCE_TYPE_BITS.get(type) as number),
        0,
      )
    : ALL_TYPES_BUT_MAIN_FRAME;
  if (excludedResourceTypes) {
    typeMask = DNR_RESOURCE_TYPES.reduce(
      (mask, type) => mask | (RESOURCE_TYPE_BITS.get(type) as number),
      0,
    );
    for (const type of excludedResourceTypes)
      typeMask &= ~(RESOURCE_TYPE_BITS.get(type) as number);
  }
  if (resourceTypes && resourceTypes.length === 0)
    throw new Error("resourceTypes must not be empty");
  if (action.type === "allowAllRequests") {
    if (!resourceTypes || (typeMask & ~FRAME_TYPES) !== 0)
      throw new Error(
        "allowAllRequests rules may only use main_frame/sub_frame resource types",
      );
  }

  const methodSet = (value: unknown, field: string): Set<string> | null => {
    const list = stringArray(value, field);
    if (!list) return null;
    for (const method of list)
      if (!REQUEST_METHODS.has(method))
        throw new Error(`unknown request method ${method}`);
    return new Set(list);
  };
  const tabSet = (value: unknown, field: string): Set<number> | null => {
    if (value === undefined) return null;
    if (kind !== "session")
      throw new Error(`${field} is only allowed in session rules`);
    if (
      !Array.isArray(value) ||
      value.some((entry) => !Number.isInteger(entry))
    )
      throw new Error(`${field} must be a list of integers`);
    return new Set(value as number[]);
  };
  const domainType =
    condition.domainType === undefined ? null : condition.domainType;
  if (
    domainType !== null &&
    domainType !== "firstParty" &&
    domainType !== "thirdParty"
  )
    throw new Error("domainType must be firstParty or thirdParty");

  let literal: string | null = null;
  let pattern: RegExp | null = null;
  let tokens: string[] = [];
  if (typeof urlFilter === "string") {
    if (!/[*^|]/.test(urlFilter)) {
      literal = caseSensitive ? urlFilter : urlFilter.toLowerCase();
      // A literal sits inside the URL anywhere, so only interior tokens are safe to index.
      tokens = urlFilterTokens(`*${urlFilter}*`);
    } else {
      pattern = compileUrlFilter(urlFilter, caseSensitive);
      tokens = urlFilterTokens(urlFilter);
    }
  } else if (typeof regexFilter === "string") {
    try {
      pattern = new RegExp(regexFilter, caseSensitive ? "" : "i");
    } catch {
      throw new Error("regexFilter is not a valid regular expression");
    }
  }

  // `domains`/`excludedDomains` are the deprecated names of the initiator conditions.
  const initiatorDomains =
    domainSet(condition.initiatorDomains, "initiatorDomains") ??
    domainSet(condition.domains, "domains");
  const excludedInitiatorDomains =
    domainSet(condition.excludedInitiatorDomains, "excludedInitiatorDomains") ??
    domainSet(condition.excludedDomains, "excludedDomains");

  return {
    id: rule.id as number,
    priority: priority as number,
    ruleset,
    kind,
    action,
    typeMask,
    methods: methodSet(condition.requestMethods, "requestMethods"),
    excludedMethods: methodSet(
      condition.excludedRequestMethods,
      "excludedRequestMethods",
    ),
    tabIds: tabSet(condition.tabIds, "tabIds"),
    excludedTabIds: tabSet(condition.excludedTabIds, "excludedTabIds"),
    domainType,
    requestDomains: domainSet(condition.requestDomains, "requestDomains"),
    excludedRequestDomains: domainSet(
      condition.excludedRequestDomains,
      "excludedRequestDomains",
    ),
    initiatorDomains,
    excludedInitiatorDomains,
    literal,
    caseSensitive,
    pattern,
    tokens,
    seen: 0,
  };
}

/** Validate and compile a list of rules (a static ruleset file, or dynamic/session rules). Bad rules are skipped and reported. */
export function parseDnrRules(
  input: unknown,
  ruleset: string,
  kind: DnrRulesetKind,
  disabledIds: ReadonlySet<number> = new Set(),
): ParsedDnrRules {
  const rules: CompiledDnrRule[] = [];
  const rejected: DnrRejectedRule[] = [];
  if (!Array.isArray(input))
    return {
      rules,
      rejected: [{ id: null, reason: "the ruleset is not a JSON list" }],
    };
  const ids = new Set<number>();
  for (const entry of input) {
    const id = isRecord(entry) ? entry.id : undefined;
    try {
      if (!isRecord(entry)) throw new Error("rule must be an object");
      const compiled = compileCondition(entry, ruleset, kind);
      if (ids.has(compiled.id)) throw new Error("duplicate rule id");
      ids.add(compiled.id);
      if (!disabledIds.has(compiled.id)) rules.push(compiled);
    } catch (error) {
      rejected.push({
        id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { rules, rejected };
}

// ---------------------------------------------------------------------------
// Matching

function hostOf(url: string): string {
  const match =
    /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]*)/i.exec(url);
  return match ? (match[1] as string).toLowerCase() : "";
}

/** The host and each parent domain (a.b.c → a.b.c, b.c, c), computed once per request. */
function domainSuffixes(host: string): string[] {
  if (!host) return [];
  const suffixes = [host];
  let index = host.indexOf(".");
  while (index >= 0) {
    suffixes.push(host.slice(index + 1));
    index = host.indexOf(".", index + 1);
  }
  return suffixes;
}

function domainMatches(
  suffixes: readonly string[],
  domains: Set<string>,
): boolean {
  for (const suffix of suffixes) if (domains.has(suffix)) return true;
  return false;
}

/** Per-request facts computed once and shared by every rule tested. */
interface PreparedRequest {
  url: string;
  lowerUrl: string;
  host: string;
  initiatorHost: string;
  typeBit: number;
  method: string;
  tabId: number;
  thirdParty: boolean | null;
  hostSuffixes: string[] | null;
  initiatorSuffixes: string[] | null;
  request: DnrRequest;
}

function prepare(request: DnrRequest): PreparedRequest {
  return {
    url: request.url,
    lowerUrl: request.url.toLowerCase(),
    host: hostOf(request.url),
    initiatorHost: request.initiator ? hostOf(request.initiator) : "",
    typeBit:
      RESOURCE_TYPE_BITS.get(request.type) ??
      (RESOURCE_TYPE_BITS.get("other") as number),
    method: (request.method ?? "GET").toLowerCase(),
    tabId: request.tabId ?? -1,
    thirdParty: null,
    hostSuffixes: null,
    initiatorSuffixes: null,
    request,
  };
}

function hostSuffixes(request: PreparedRequest): string[] {
  request.hostSuffixes ??= domainSuffixes(request.host);
  return request.hostSuffixes;
}

function initiatorSuffixes(request: PreparedRequest): string[] {
  request.initiatorSuffixes ??= domainSuffixes(request.initiatorHost);
  return request.initiatorSuffixes;
}

function isThirdParty(prepared: PreparedRequest): boolean {
  if (prepared.thirdParty === null) {
    if (!prepared.initiatorHost) {
      prepared.thirdParty = false;
    } else {
      const requestDomain = getDomain(prepared.host) ?? prepared.host;
      const initiatorDomain =
        getDomain(prepared.initiatorHost) ?? prepared.initiatorHost;
      prepared.thirdParty = requestDomain !== initiatorDomain;
    }
  }
  return prepared.thirdParty;
}

function ruleMatches(rule: CompiledDnrRule, request: PreparedRequest): boolean {
  if ((rule.typeMask & request.typeBit) === 0) return false;
  // Cheapest discriminating test first: most candidate rules fail on the URL substring.
  if (
    rule.literal !== null &&
    !(rule.caseSensitive ? request.url : request.lowerUrl).includes(
      rule.literal,
    )
  )
    return false;
  if (
    rule.methods &&
    !rule.methods.has(
      REQUEST_METHODS.has(request.method) ? request.method : "other",
    )
  )
    return false;
  if (
    rule.excludedMethods &&
    rule.excludedMethods.has(
      REQUEST_METHODS.has(request.method) ? request.method : "other",
    )
  )
    return false;
  if (rule.tabIds && !rule.tabIds.has(request.tabId)) return false;
  if (rule.excludedTabIds && rule.excludedTabIds.has(request.tabId))
    return false;
  if (
    rule.requestDomains &&
    !domainMatches(hostSuffixes(request), rule.requestDomains)
  )
    return false;
  if (
    rule.excludedRequestDomains &&
    domainMatches(hostSuffixes(request), rule.excludedRequestDomains)
  )
    return false;
  // A request with no initiator (typed navigation) never matches an initiatorDomains condition.
  if (
    rule.initiatorDomains &&
    !domainMatches(initiatorSuffixes(request), rule.initiatorDomains)
  )
    return false;
  if (
    rule.excludedInitiatorDomains &&
    domainMatches(initiatorSuffixes(request), rule.excludedInitiatorDomains)
  )
    return false;
  if (
    rule.domainType &&
    (rule.domainType === "thirdParty") !== isThirdParty(request)
  )
    return false;
  if (rule.pattern) return rule.pattern.test(request.url);
  return true;
}

/** The outcome of evaluating one extension's rules for one request. */
export interface DnrMatch {
  /** The winning blocking-stage rule (allow/allowAllRequests/block/upgradeScheme/redirect), if any. */
  rule: CompiledDnrRule | null;
  /** modifyHeaders rules that apply, highest priority first. */
  headerRules: CompiledDnrRule[];
}

function outranks(
  candidate: CompiledDnrRule,
  current: CompiledDnrRule | null,
): boolean {
  if (!current) return true;
  if (candidate.priority !== current.priority)
    return candidate.priority > current.priority;
  const actionDelta =
    ACTION_RANK[candidate.action.type] - ACTION_RANK[current.action.type];
  if (actionDelta !== 0) return actionDelta > 0;
  return RULESET_RANK[candidate.kind] > RULESET_RANK[current.kind];
}

function compareHeaderRules(a: CompiledDnrRule, b: CompiledDnrRule): number {
  return (
    b.priority - a.priority ||
    RULESET_RANK[b.kind] - RULESET_RANK[a.kind] ||
    a.id - b.id
  );
}

/**
 * An indexed set of compiled rules (all enabled rulesets of one extension). Rules are bucketed by a
 * token their URL must contain, so a request only tests the rules whose token appears in its URL
 * plus the few rules that have none.
 */
export class DnrMatcher {
  readonly size: number;
  readonly hasHeaderRules: boolean;
  readonly hasRequestHeaderRules: boolean;
  readonly hasResponseHeaderRules: boolean;
  readonly hasAllowAllRequests: boolean;
  private readonly buckets = new Map<string, CompiledDnrRule[]>();
  private readonly generic: CompiledDnrRule[] = [];
  private stamp = 0;

  constructor(rules: readonly CompiledDnrRule[]) {
    this.size = rules.length;
    let request = false;
    let response = false;
    let allowAll = false;
    for (const rule of rules) {
      rule.seen = 0;
      if (rule.action.type === "modifyHeaders") {
        if (rule.action.requestHeaders) request = true;
        if (rule.action.responseHeaders) response = true;
      }
      if (rule.action.type === "allowAllRequests") allowAll = true;
      // Like uBO: file the rule under its rarest strong token so far (fewest rules tested per hit).
      let token: string | null = null;
      let tokenCount = Infinity;
      for (const candidate of rule.tokens) {
        const count =
          (this.buckets.get(candidate)?.length ?? 0) +
          (WEAK_TOKENS.has(candidate) ? 1000 : 0);
        if (
          count < tokenCount ||
          (count === tokenCount &&
            token !== null &&
            candidate.length > token.length)
        ) {
          token = candidate;
          tokenCount = count;
        }
      }
      if (token) {
        const bucket = this.buckets.get(token);
        if (bucket) bucket.push(rule);
        else this.buckets.set(token, [rule]);
      } else {
        this.generic.push(rule);
      }
    }
    this.hasRequestHeaderRules = request;
    this.hasResponseHeaderRules = response;
    this.hasHeaderRules = request || response;
    this.hasAllowAllRequests = allowAll;
  }

  /** Every rule matching the request (unordered). */
  matchAll(request: DnrRequest): CompiledDnrRule[] {
    const prepared = prepare(request);
    const stamp = ++this.stamp;
    const matches: CompiledDnrRule[] = [];
    const test = (rule: CompiledDnrRule): void => {
      if (rule.seen === stamp) return;
      rule.seen = stamp;
      if (ruleMatches(rule, prepared)) matches.push(rule);
    };
    for (const rule of this.generic) test(rule);
    if (this.buckets.size > 0) {
      URL_TOKENS.lastIndex = 0;
      for (const match of prepared.lowerUrl.matchAll(URL_TOKENS)) {
        const bucket = this.buckets.get(match[0]);
        if (bucket) for (const rule of bucket) test(rule);
      }
    }
    return matches;
  }

  /** Apply Chrome's priority rules to the matching set. */
  match(request: DnrRequest): DnrMatch {
    if (this.size === 0) return { rule: null, headerRules: [] };
    const matches = this.matchAll(request);
    let best: CompiledDnrRule | null = null;
    let allowPriority = request.allowAllRequestsPriority ?? 0;
    const headerCandidates: CompiledDnrRule[] = [];
    for (const rule of matches) {
      if (rule.action.type === "modifyHeaders") {
        headerCandidates.push(rule);
        continue;
      }
      // allowAllRequests only acts on the frame request that it matched (it then covers the frame).
      if (outranks(rule, best)) best = rule;
      if (
        (rule.action.type === "allow" ||
          rule.action.type === "allowAllRequests") &&
        rule.priority > allowPriority
      )
        allowPriority = rule.priority;
    }
    // An allowAllRequests rule covering the frame outranks lower-priority rules.
    if (
      best &&
      request.allowAllRequestsPriority !== undefined &&
      request.allowAllRequestsPriority >= best.priority &&
      best.action.type !== "allow" &&
      best.action.type !== "allowAllRequests"
    ) {
      best = null;
    }
    const headerRules = headerCandidates
      .filter((rule) => rule.priority > allowPriority)
      .sort(compareHeaderRules);
    return { rule: best, headerRules };
  }
}

// ---------------------------------------------------------------------------
// Actions

/** The URL a redirect or upgradeScheme rule sends the request to, or null when it does not apply. */
export function dnrRedirectUrl(
  rule: CompiledDnrRule,
  requestUrl: string,
  extensionId: string,
): string | null {
  if (rule.action.type === "upgradeScheme") {
    const upgraded = requestUrl
      .replace(/^http:/i, "https:")
      .replace(/^ws:/i, "wss:");
    return upgraded !== requestUrl ? upgraded : null;
  }
  if (rule.action.type !== "redirect" || !rule.action.redirect) return null;
  const redirect = rule.action.redirect;
  let target: string | null = null;
  if (typeof redirect.regexSubstitution === "string" && rule.pattern) {
    const substitution = redirect.regexSubstitution
      .replace(/\$/g, "$$$$")
      .replace(/\\(\d)/g, (_all, digit: string) =>
        digit === "0" ? "$&" : `$${digit}`,
      );
    if (!rule.pattern.test(requestUrl)) return null;
    // Non-global pattern: only the first match is replaced, as in Chrome.
    target = requestUrl.replace(rule.pattern, substitution);
  } else if (typeof redirect.extensionPath === "string") {
    target = `chrome-extension://${extensionId}${redirect.extensionPath}`;
  } else if (redirect.transform) {
    target = applyUrlTransform(requestUrl, redirect.transform);
  } else if (typeof redirect.url === "string") {
    target = redirect.url;
  }
  if (!target) return null;
  try {
    const url = new URL(target);
    if (!/^(https?|wss?|ftp|data|chrome-extension):$/.test(url.protocol))
      return null;
    return url.href === requestUrl ? null : url.href;
  } catch {
    return null;
  }
}

export function applyUrlTransform(
  input: string,
  transform: DnrUrlTransform,
): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (typeof transform.scheme === "string") {
    if (!/^(http|https|ftp|chrome-extension)$/.test(transform.scheme))
      return null;
    url.protocol = `${transform.scheme}:`;
  }
  if (typeof transform.host === "string") url.hostname = transform.host;
  if (typeof transform.port === "string") url.port = transform.port;
  if (typeof transform.path === "string") url.pathname = transform.path || "/";
  if (typeof transform.query === "string") {
    url.search = transform.query === "" ? "" : transform.query;
  } else if (transform.queryTransform) {
    const params = new URLSearchParams(url.search);
    for (const name of transform.queryTransform.removeParams ?? [])
      params.delete(name);
    for (const entry of transform.queryTransform.addOrReplaceParams ?? []) {
      if (params.has(entry.key)) params.set(entry.key, entry.value);
      else if (!entry.replaceOnly) params.append(entry.key, entry.value);
    }
    const search = params.toString();
    url.search = search ? `?${search}` : "";
  }
  if (typeof transform.fragment === "string")
    url.hash = transform.fragment === "" ? "" : transform.fragment;
  if (typeof transform.username === "string") url.username = transform.username;
  if (typeof transform.password === "string") url.password = transform.password;
  return url.href;
}

export type HeaderRecord = Record<string, string | string[]>;

/**
 * Apply modifyHeaders rules (already sorted, highest priority first) to a header record.
 * Chrome's merge rules: once a header was set or removed, lower-priority rules can't touch it; once
 * appended to, lower-priority rules may only append. Returns null when nothing changed.
 */
export function applyDnrHeaderRules(
  headers: HeaderRecord,
  rules: readonly CompiledDnrRule[],
  which: "requestHeaders" | "responseHeaders",
): HeaderRecord | null {
  const result: HeaderRecord = { ...headers };
  const keyFor = new Map<string, string>();
  for (const key of Object.keys(result)) keyFor.set(key.toLowerCase(), key);
  const locked = new Map<string, "final" | "append">();
  let changed = false;
  for (const rule of rules) {
    for (const info of rule.action[which] ?? []) {
      const lower = info.header.toLowerCase();
      const state = locked.get(lower);
      if (
        state === "final" ||
        (state === "append" && info.operation !== "append")
      )
        continue;
      const existingKey = keyFor.get(lower);
      if (info.operation === "remove") {
        if (existingKey !== undefined) {
          delete result[existingKey];
          keyFor.delete(lower);
          changed = true;
        }
        locked.set(lower, "final");
      } else if (info.operation === "set") {
        if (existingKey !== undefined && existingKey !== info.header)
          delete result[existingKey];
        result[info.header] = info.value ?? "";
        keyFor.set(lower, info.header);
        locked.set(lower, "final");
        changed = true;
      } else {
        const value = info.value ?? "";
        if (existingKey === undefined) {
          result[info.header] = value;
          keyFor.set(lower, info.header);
        } else if (which === "responseHeaders") {
          // Response headers can repeat (Set-Cookie): add another value.
          const current = result[existingKey] as string | string[];
          result[existingKey] = [
            ...(Array.isArray(current) ? current : [current]),
            value,
          ];
        } else {
          const current = result[existingKey] as string | string[];
          result[existingKey] =
            `${Array.isArray(current) ? current.join(", ") : current}, ${value}`;
        }
        locked.set(lower, "append");
        changed = true;
      }
    }
  }
  return changed ? result : null;
}

/** Map an Electron webRequest resourceType to the DNR resource type. */
export function dnrResourceType(
  electronType: string | undefined,
): DnrResourceType {
  switch (electronType) {
    case "mainFrame":
      return "main_frame";
    case "subFrame":
      return "sub_frame";
    case "stylesheet":
      return "stylesheet";
    case "script":
      return "script";
    case "image":
      return "image";
    case "font":
      return "font";
    case "object":
      return "object";
    case "xhr":
      return "xmlhttprequest";
    case "ping":
      return "ping";
    case "cspReport":
      return "csp_report";
    case "media":
      return "media";
    case "webSocket":
      return "websocket";
    default:
      return "other";
  }
}

/** Static rulesets declared in a manifest (`declarative_net_request.rule_resources`). */
export interface DnrRulesetDeclaration {
  id: string;
  path: string;
  enabled: boolean;
}

export function manifestDnrRulesets(
  manifest: unknown,
): DnrRulesetDeclaration[] {
  const dnr =
    isRecord(manifest) && isRecord(manifest.declarative_net_request)
      ? manifest.declarative_net_request
      : null;
  const resources =
    dnr && Array.isArray(dnr.rule_resources) ? dnr.rule_resources : [];
  const seen = new Set<string>();
  const result: DnrRulesetDeclaration[] = [];
  for (const entry of resources) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      entry.id.startsWith("_") ||
      typeof entry.path !== "string" ||
      seen.has(entry.id)
    )
      continue;
    seen.add(entry.id);
    result.push({
      id: entry.id,
      path: entry.path,
      enabled: entry.enabled === true,
    });
  }
  return result;
}

/** Install-time summary of static rulesets (`rules: null` = unreadable), for the compatibility gate. */
export function summarizeDnrRulesets(
  rulesets: ReadonlyArray<{ id: string; rules: unknown }>,
): {
  total: number;
  unsupported: number;
  reasons: string[];
  unreadable: string[];
} {
  const unreadable = rulesets
    .filter((ruleset) => !Array.isArray(ruleset.rules))
    .map((ruleset) => ruleset.id);
  return {
    ...unsupportedDnrRuleCount(
      rulesets.filter((ruleset) => Array.isArray(ruleset.rules)),
    ),
    unreadable,
  };
}

/** Rules in a ruleset Surffish can't enforce, for the install compatibility summary. */
export function unsupportedDnrRuleCount(
  rulesets: ReadonlyArray<{ rules: unknown }>,
): { total: number; unsupported: number; reasons: string[] } {
  let total = 0;
  let unsupported = 0;
  const reasons = new Set<string>();
  for (const ruleset of rulesets) {
    const list = Array.isArray(ruleset.rules) ? ruleset.rules : [];
    total += list.length;
    const parsed = parseDnrRules(list, "check", "static");
    unsupported += parsed.rejected.length;
    for (const entry of parsed.rejected)
      if (/not supported by Surffish/.test(entry.reason))
        reasons.add(entry.reason);
  }
  return { total, unsupported, reasons: [...reasons].sort() };
}
